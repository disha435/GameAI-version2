import { and, desc, eq, max } from 'drizzle-orm';
import type { GameSpec } from '../../src/spec/types';
import type { ValidationError } from '../../src/spec/validate';
import { db } from './client';
import { games, gameVersions } from './schema';

export type VersionSource = 'generate' | 'edit' | 'rollback';
export type EditSourceColumn = 'deterministic' | 'llm_patch';

export async function getGame(gameId: string) {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  return game;
}

// What GET /games/:id needs in one query: the game plus its current
// version's spec. A left join (not inner) because a game can theoretically
// exist with no current version yet, and this should report that as
// "no current version" rather than silently omitting the game.
export async function getGameWithCurrentVersion(gameId: string) {
  const [row] = await db
    .select({
      gameId: games.id,
      title: games.title,
      currentVersionId: games.currentVersionId,
      versionNumber: gameVersions.versionNumber,
      specJson: gameVersions.specJson,
      createdAt: gameVersions.createdAt,
    })
    .from(games)
    .leftJoin(gameVersions, eq(games.currentVersionId, gameVersions.id))
    .where(eq(games.id, gameId));
  return row;
}

// Deliberately excludes spec_json — that's the one field big enough to make
// a history list heavy, and the only one a rollback UI doesn't need until
// the user actually picks a version (fetch it on demand via
// getVersionById). Everything else here is small scalar diagnostic data —
// attemptCount/validationErrors included, not just usedFallback — since the
// whole point of capturing it per version is that it's inspectable without
// re-running generation or reconstructing it from logs.
export async function listVersions(gameId: string) {
  return db
    .select({
      versionId: gameVersions.id,
      versionNumber: gameVersions.versionNumber,
      source: gameVersions.source,
      editSource: gameVersions.editSource,
      prompt: gameVersions.prompt,
      createdAt: gameVersions.createdAt,
      attemptCount: gameVersions.attemptCount,
      usedFallback: gameVersions.usedFallback,
      validationErrors: gameVersions.validationErrors,
    })
    .from(gameVersions)
    .where(eq(gameVersions.gameId, gameId))
    .orderBy(desc(gameVersions.versionNumber));
}

export async function getVersionById(gameId: string, versionId: string) {
  const [version] = await db
    .select()
    .from(gameVersions)
    .where(and(eq(gameVersions.id, versionId), eq(gameVersions.gameId, gameId)));
  return version;
}

export interface CreateGameVersionInput {
  gameId?: string; // omit to create a new game
  userId: string;
  title?: string; // only used when creating a new game
  specJson: GameSpec;
  source: VersionSource;
  editSource?: EditSourceColumn; // only meaningful when source === 'edit'
  prompt: string | null;
  attemptCount: number;
  usedFallback: boolean;
  validationErrors: ValidationError[] | null;
}

// Creates the next version for a game — and the game itself, if gameId is
// omitted — then repoints games.current_version_id at it, all inside one
// transaction. That's what keeps "new spec becomes current" atomic: a crash
// partway through can never leave a game pointing at a version that doesn't
// exist, or a version_number gap from a half-committed insert.
export async function createGameVersion(input: CreateGameVersionInput) {
  return db.transaction(async (tx) => {
    let gameId = input.gameId;
    if (!gameId) {
      const [game] = await tx
        .insert(games)
        .values({ userId: input.userId, title: input.title ?? 'Untitled Game' })
        .returning();
      gameId = game.id;
    }

    const [{ maxVersion }] = await tx
      .select({ maxVersion: max(gameVersions.versionNumber) })
      .from(gameVersions)
      .where(eq(gameVersions.gameId, gameId));
    const versionNumber = (maxVersion ?? 0) + 1;

    const [version] = await tx
      .insert(gameVersions)
      .values({
        gameId,
        versionNumber,
        specJson: input.specJson,
        source: input.source,
        editSource: input.editSource ?? null,
        prompt: input.prompt,
        attemptCount: input.attemptCount,
        usedFallback: input.usedFallback,
        validationErrors: input.validationErrors,
      })
      .returning();

    await tx.update(games).set({ currentVersionId: version.id, updatedAt: new Date() }).where(eq(games.id, gameId));

    return { gameId, version };
  });
}

// Rollback never mutates or renumbers history — it reads an old version's
// spec and appends it as a brand-new version (source: 'rollback'), then
// repoints current_version_id at that new row. History always shows a
// rollback happened; it never looks like the old version just quietly
// became current again. Returns undefined if toVersionId doesn't belong to
// this game (or doesn't exist), so the route can 404 instead of silently
// rolling back to nothing.
export async function rollbackGameVersion(gameId: string, toVersionId: string) {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(gameVersions)
      .where(and(eq(gameVersions.id, toVersionId), eq(gameVersions.gameId, gameId)));
    if (!source) return undefined;

    const [{ maxVersion }] = await tx
      .select({ maxVersion: max(gameVersions.versionNumber) })
      .from(gameVersions)
      .where(eq(gameVersions.gameId, gameId));
    const versionNumber = (maxVersion ?? 0) + 1;

    const [version] = await tx
      .insert(gameVersions)
      .values({
        gameId,
        versionNumber,
        specJson: source.specJson,
        source: 'rollback',
        prompt: null,
        attemptCount: 0,
        usedFallback: false,
        validationErrors: null,
      })
      .returning();

    await tx.update(games).set({ currentVersionId: version.id, updatedAt: new Date() }).where(eq(games.id, gameId));

    return version;
  });
}
