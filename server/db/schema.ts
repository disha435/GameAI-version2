import { desc, sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { GameSpec } from '../../src/spec/types';
import type { ValidationError } from '../../src/spec/validate';

// One row per user-created game "project". current_version_id is what makes
// "what's the current spec for this game" a single indexed lookup instead of
// a MAX(version_number) scan, and what makes rollback trivial — rollback
// only ever repoints this column, it never rewrites game_versions history.
export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(), // placeholder FK — no auth table yet
  title: text('title').notNull(),
  currentVersionId: uuid('current_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only log of every spec a game has had. Never mutated or renumbered
// in place — a regenerate is a new row with the next version_number, and a
// rollback is a new row (source: 'rollback') copying an old spec forward,
// never a rewind of current_version_id to point at the old row directly.
// attempt_count/used_fallback/validation_errors are captured per version so
// "how did this generation go" is answerable from the row alone, without
// re-running generateSpec or reconstructing it from manual logging.
export const gameVersions = pgTable(
  'game_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    specJson: jsonb('spec_json').notNull().$type<GameSpec>(),
    source: text('source', { enum: ['generate', 'edit', 'rollback'] }).notNull(),
    // How an 'edit' version was actually resolved — 'source' says it was an
    // edit, this says whether it took the free deterministic-intent path or
    // needed an LLM-authored patch. Null for 'generate'/'rollback' rows.
    // This is the diagnostic signal that answers "are users' edits mostly
    // hitting the cheap path, or mostly falling through to the LLM" — which
    // intent to add next, without re-running anything.
    editSource: text('edit_source', { enum: ['deterministic', 'llm_patch'] }),
    prompt: text('prompt'), // the user's original text; null for rollback
    attemptCount: integer('attempt_count').notNull(),
    usedFallback: boolean('used_fallback').notNull().default(false),
    validationErrors: jsonb('validation_errors').$type<ValidationError[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('game_versions_game_id_version_number_key').on(table.gameId, table.versionNumber),
    index('idx_game_versions_game_id').on(table.gameId, desc(table.versionNumber)),
    // Drizzle's text({ enum: [...] }) above only narrows the TypeScript type
    // — it emits a plain `text` column with no DB-level constraint, so this
    // CHECK is what actually stops a bad 'source' value from being written
    // by anything other than this app's own type-checked code path.
    check('game_versions_source_check', sql`${table.source} IN ('generate', 'edit', 'rollback')`),
    check('game_versions_edit_source_check', sql`${table.editSource} IS NULL OR ${table.editSource} IN ('deterministic', 'llm_patch')`),
    check('game_versions_edit_source_scope_check', sql`${table.editSource} IS NULL OR ${table.source} = 'edit'`),
  ],
);
