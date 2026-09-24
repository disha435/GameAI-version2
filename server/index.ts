import 'dotenv/config';
import express from 'express';
import type { GameSpec } from '../src/spec/types';
import { createGameVersion, getGame, getGameWithCurrentVersion, getVersionById, listVersions, rollbackGameVersion } from './db/games';
import { editSpec } from './edit/editSpec';
import { generateSpec } from './llm';

// Placeholder until Phase 4/auth introduces a real users table — every game
// created through this server today belongs to this one fixed id.
const PLACEHOLDER_USER_ID = '00000000-0000-0000-0000-000000000001';

const app = express();
app.use(express.json({ limit: '256kb' }));

// Local-dev-only CORS: the Vite dev server and this backend run on different
// ports, so the browser refuses the cross-origin fetch without this. Not
// meant to survive past a local prototype.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Generates a spec and persists it as a new version — creating the game
// shell too if gameId is omitted. This is "generate" (from a prompt, from
// scratch), distinct from Phase 4's "edit" (patch an existing spec) and from
// rollback (copy an old version forward); all three just differ in what
// `source` and `specJson` a new game_versions row gets.
app.post('/generate', async (req, res) => {
  const prompt: unknown = req.body?.prompt;
  const gameId: unknown = req.body?.gameId;
  const title: unknown = req.body?.title;

  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'body.prompt must be a non-empty string' });
    return;
  }
  if (gameId !== undefined && typeof gameId !== 'string') {
    res.status(400).json({ error: 'body.gameId must be a string if provided' });
    return;
  }

  try {
    if (gameId) {
      const existing = await getGame(gameId);
      if (!existing) {
        res.status(404).json({ error: `no game with id "${gameId}"` });
        return;
      }
    }

    const result = await generateSpec(prompt.trim());
    const { gameId: resolvedGameId, version } = await createGameVersion({
      gameId,
      userId: PLACEHOLDER_USER_ID,
      title: typeof title === 'string' ? title : undefined,
      specJson: result.spec,
      source: 'generate',
      prompt: prompt.trim(),
      attemptCount: result.attempts,
      usedFallback: result.usedFallback,
      validationErrors: result.lastErrors ?? null,
    });

    res.json({
      gameId: resolvedGameId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      spec: result.spec,
      usedFallback: result.usedFallback,
      attemptCount: result.attempts,
      // Dropped silently when /generate was rewired for Phase 3's
      // persistence (the pre-persistence handler had this) — the data was
      // never lost, since it's also written to validation_errors below, but
      // a caller shouldn't need a DB round-trip just to see why a
      // multi-attempt generation took more than one try.
      ...(result.lastErrors ? { lastErrors: result.lastErrors } : {}),
    });
  } catch (err) {
    // generateSpec itself is designed to never throw; a throw here means the
    // DB write failed, which is a real 500 (nothing was persisted).
    console.error('Unexpected error in /generate:', err);
    res.status(500).json({ error: 'internal error generating spec' });
  }
});

// What the frontend loads on page open: the game's title and its current
// version's spec, ready to hand straight to SceneInterpreter.
app.get('/games/:id', async (req, res) => {
  try {
    const row = await getGameWithCurrentVersion(req.params.id);
    if (!row) {
      res.status(404).json({ error: `no game with id "${req.params.id}"` });
      return;
    }
    res.json({
      gameId: row.gameId,
      title: row.title,
      currentVersion:
        row.versionNumber === null
          ? null
          : { versionNumber: row.versionNumber, spec: row.specJson, createdAt: row.createdAt },
    });
  } catch (err) {
    console.error('Unexpected error in GET /games/:id:', err);
    res.status(500).json({ error: 'internal error loading game' });
  }
});

// The light version-history list for a rollback UI — spec_json is
// deliberately omitted per row (fetch a specific version's full spec via
// GET /games/:id/versions/:versionId on demand instead).
app.get('/games/:id/versions', async (req, res) => {
  try {
    const game = await getGame(req.params.id);
    if (!game) {
      res.status(404).json({ error: `no game with id "${req.params.id}"` });
      return;
    }
    const versions = await listVersions(req.params.id);
    res.json(versions);
  } catch (err) {
    console.error('Unexpected error in GET /games/:id/versions:', err);
    res.status(500).json({ error: 'internal error loading version history' });
  }
});

// Fetches one historical version's full spec — what a version-history
// panel's "Load" (read-only preview) button calls before booting it into
// SceneInterpreter.
app.get('/games/:id/versions/:versionId', async (req, res) => {
  try {
    const version = await getVersionById(req.params.id, req.params.versionId);
    if (!version) {
      res.status(404).json({ error: `no version "${req.params.versionId}" for game "${req.params.id}"` });
      return;
    }
    res.json(version);
  } catch (err) {
    console.error('Unexpected error in GET /games/:id/versions/:versionId:', err);
    res.status(500).json({ error: 'internal error loading version' });
  }
});

// Rollback never rewrites history — it appends a new version (source:
// 'rollback') copying an old one's spec forward, then repoints
// current_version_id at that new row. See db/games.ts for why.
app.post('/games/:id/rollback', async (req, res) => {
  const toVersionId: unknown = req.body?.toVersionId;
  if (typeof toVersionId !== 'string' || !toVersionId) {
    res.status(400).json({ error: 'body.toVersionId must be a non-empty string' });
    return;
  }

  try {
    const version = await rollbackGameVersion(req.params.id, toVersionId);
    if (!version) {
      res.status(404).json({ error: `no version "${toVersionId}" for game "${req.params.id}"` });
      return;
    }
    res.json({ versionId: version.id, versionNumber: version.versionNumber, spec: version.specJson });
  } catch (err) {
    console.error('Unexpected error in POST /games/:id/rollback:', err);
    res.status(500).json({ error: 'internal error rolling back' });
  }
});

// Applies a natural-language edit to the game's current spec and versions
// the result — resolved cheapest-first (a deterministic pattern match,
// then an LLM-authored JSON Patch; see server/edit/editSpec.ts), gated
// through the exact same validator generation uses. On total failure the
// current version is left untouched and no new row is created — a broken
// edit should never silently swap in something unrelated.
app.post('/games/:id/edit', async (req, res) => {
  const instruction: unknown = req.body?.instruction;
  if (typeof instruction !== 'string' || !instruction.trim()) {
    res.status(400).json({ error: 'body.instruction must be a non-empty string' });
    return;
  }

  try {
    const current = await getGameWithCurrentVersion(req.params.id);
    if (!current) {
      res.status(404).json({ error: `no game with id "${req.params.id}"` });
      return;
    }
    if (current.versionNumber === null) {
      res.status(409).json({ error: `game "${req.params.id}" has no current version to edit` });
      return;
    }

    const result = await editSpec(current.specJson as GameSpec, instruction.trim());

    if (result.source === 'unchanged') {
      // No version row is created here (nothing changed), so this response
      // is the *only* record of why — same reasoning as surfacing
      // lastErrors on /generate's success path (see server/llm.ts): without
      // this, "it failed" and "here's specifically why" require re-running
      // with ad-hoc logging to tell apart.
      res.json({
        gameId: current.gameId,
        spec: result.spec,
        changed: false,
        error: result.error,
        ...(result.lastErrors ? { lastErrors: result.lastErrors } : {}),
      });
      return;
    }

    const { version } = await createGameVersion({
      gameId: current.gameId,
      userId: PLACEHOLDER_USER_ID,
      specJson: result.spec,
      source: 'edit',
      editSource: result.source,
      prompt: instruction.trim(),
      attemptCount: result.attemptCount,
      usedFallback: result.usedFallback,
      validationErrors: result.lastErrors ?? null,
    });

    res.json({
      gameId: current.gameId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      spec: result.spec,
      changed: true,
      editSource: result.source,
      attemptCount: result.attemptCount,
    });
  } catch (err) {
    console.error('Unexpected error in POST /games/:id/edit:', err);
    res.status(500).json({ error: 'internal error applying edit' });
  }
});

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`GD Runtime backend listening on http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY is not set — every /generate call will fail and fall back to the template spec.');
  }
});
