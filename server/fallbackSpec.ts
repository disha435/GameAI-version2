import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameSpec } from '../src/spec/types';
import { validateGameSpec } from '../src/spec/validate';

// The UX floor: whatever else goes wrong (the LLM is unreachable, it never
// produces a valid spec within the retry budget, etc.), /generate always
// hands back *something playable* rather than an error page. This reuses
// the same hand-written spec Phase 0/1 already prove is a working game, so
// there's no second "safe template" to keep in sync.
const __dirname = dirname(fileURLToPath(import.meta.url));
const FALLBACK_PATH = resolve(__dirname, '../public/specs/example-topdown.json');

const raw = JSON.parse(readFileSync(FALLBACK_PATH, 'utf-8'));
const result = validateGameSpec(raw);
if (!result.valid) {
  throw new Error(
    `Fallback spec at ${FALLBACK_PATH} failed validation — this file must always be valid, since it's the last resort when the LLM fails every attempt:\n` +
      result.errors.map((e) => `- ${e.path}: ${e.message}`).join('\n'),
  );
}

export const FALLBACK_SPEC: GameSpec = raw as GameSpec;
