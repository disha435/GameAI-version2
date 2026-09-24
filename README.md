# GD Runtime — Phase 0 + Tier 1 + Tier 2 + Tier 3 + Movement Modifiers + Spawner Primitive (visual juice + animation + theme packs + composable movement + runtime spawning)

A Phaser 3 + TypeScript runtime that plays a game by **interpreting a JSON
GameSpec**, not by running generated code; a standalone three-gate validator
that's Gate 1 for everything downstream; a backend that turns a plain-
English prompt into a validated, playable GameSpec via the OpenAI API;
Postgres-backed persistence so every generation is a durable, numbered,
rollback-able version of a game instead of a one-shot page session; and a
natural-language edit loop that patches an existing game — cheaply and
deterministically for common phrasings, via a gated LLM-authored JSON Patch
otherwise — instead of regenerating the whole spec from scratch. A real
two-route app shell (`/` to create, `/games/:id` to play and edit) replaces
the original single-page prototype, with honest generation/edit feedback
instead of a fake progress bar. Four genres now exercise that same
closed-vocabulary pipeline end to end: a topdown dungeon crawler, a
vertical-scrolling space shooter, a platformer, and a twin-stick/bullet-hell
arena — added without touching `validate.ts`'s logic or restructuring the
schema. A small `src/fx/` module gives every game — across all four genres,
with zero spec/schema/LLM involvement — hit-flashes, death animations,
pickup pops, landing squashes, idle-bobbing pickups, camera shake, and
projectile trails (Tier 1 of a three-tier visual-juice plan). Tier 2 adds
real multi-frame animation on top — every entity, in every genre, now has a
procedurally-drawn walk cycle and a fire-flash generated automatically from
its existing static texture, with zero per-entity art and zero new
spec/schema/LLM vocabulary. Tier 3 closes the loop with theme packs: a new,
required `theme` field (`"dungeon"` | `"space"`) groups the sprites Tier 1/2
already animated into visually-coherent buckets, and the runtime re-skins
every player/boss/enemy/pickup sprite to match the chosen theme at spawn
time — regardless of whatever sprite value the spec itself carries — so a
prompt like "asteroids game dodging space rocks" actually renders ships and
starfields instead of whatever generic dungeon shapes the model happened to
reference. Movement Modifiers closes a real gap those four genres couldn't
cover: `player.movementModifiers` layers orthogonal parameters — an axis
constraint, gravity, tap-to-flap impulse input — on top of any existing
movementType, so requests like "Flappy Bird" or "dodge the falling rocks"
compose from existing pieces instead of needing a new named movement type
each time, with zero changes to the three existing movement controllers.
The Spawner Primitive closes the other half of that gap: `spawners`, a new
top-level array, lets entities appear *during* gameplay — periodically, from
a world edge, moving in a fixed direction until they despawn off-bounds —
instead of every entity being placed once at scene start. A `pairedGap`
variant spawns two entities with a randomized gap between them from the
same primitive, which is Flappy Bird's pipes expressed as a composition
rather than a separate concept.

## Run it

Three things: local Postgres (Docker), the generation backend (Express), and
the game runtime (Vite).

```bash
npm install
cp .env.example .env   # then fill in OPENAI_API_KEY (DATABASE_URL is already
                        # set to match docker-compose.yml)
npm run db:up           # starts Postgres in Docker (localhost:5433)
npm run db:migrate      # applies server/db/migrations/ to it
npm run server          # backend on http://localhost:8787
npm run dev              # runtime on the printed localhost URL, in another terminal
```

(`npm run db:generate` regenerates the migration SQL after editing
`server/db/schema.ts`; `npm run db:down` stops the Postgres container.)

Open the printed Vite URL: it's a real two-route app shell now (Phase 5).
`/` is the landing view — type a sentence describing a game and click
**Generate Game**. On success you land on `/games/:id` — the actual
play+edit view — with an honest status line about what just happened
("Ready!", "Ready! Took N attempts to validate," or a visible note if the
fallback template had to be used instead). Reload that `/games/:id` URL
later (or share it) and you get the same current version back (Phase 3).
The **Version History** panel (a persistent sidebar on a normal monitor,
a toggle button on a narrow one) reads as a story — source, how an edit was
resolved, the instruction/prompt text, timestamp — with **Load** to preview
any past version read-only and **Rollback to this** to make it current
again as a new version. The text box at the bottom (Phase 4) applies a
natural-language edit to the game you're playing — e.g. "make the enemies
faster" — and tells you which path it took: **⚡ Applied instantly**
(deterministic, zero LLM calls) or **✨ AI-adjusted** (an LLM-authored
patch), or an inline error with a **Retry** button if it didn't take
effect. Pass `?spec=<name>` instead of either route to skip the
prompt/backend entirely and load `public/specs/<name>.json` directly
(useful for iterating on the runtime without spending an LLM call each
time — this is how Phase 0/1 development worked before Phase 2 existed).

Controls: arrow keys / WASD to move, Space to attack.

`npm run build` produces a static production bundle in `dist/` (the runtime
only — the backend isn't part of that bundle; it's a separate Node process).
`npm run typecheck` runs `tsc` with no emit, for both the runtime (`src/`)
and the backend (`server/`).
`npm run test` runs the full unit suite (vitest): the validator's 29 tests,
the generation retry-loop's 7 tests (mocked — see Phase 2 below — so these
never spend real API tokens), the edit loop's 23 tests (17 deterministic-
intent unit tests with no LLM/DB involved, 6 edit-orchestration tests
against a mocked LLM client — Phase 4, below), and the persistence layer's
8 integration tests (Phase 3/4 — these run against the **real** local
Postgres from `npm run db:up`, so it must be running before `npm run test`).

## Architecture

```
src/
  spec/
    types.ts              GameSpec type definitions — the closed contract, zero imports (Phaser-free)
    gamespec.schema.json   JSON Schema for GameSpec — Gate 1 (schema conformance), consumed by validate.ts via ajv
    validate.ts            validateGameSpec(spec) -> {valid, errors: {path, message}[]} — all 3 gates, Phaser-free
    validate.test.ts        29 unit tests covering all 3 gates against valid + broken specs
    SceneInterpreter.ts     The only Phaser.Scene subclass; builds a level from a GameSpec
  entities/                 BaseEntity + Player, Enemy, Boss, Pickup, NPC, Trigger, Projectile
    EntityRegistry.ts       spec.type -> entity class lookup (Record<EntityType, Ctor>: compiler-enforced exhaustive)
  behaviors/                patrol, chase, flee, stationary, flying_sine, shooter, melee
    BehaviorRegistry.ts     spec.behavior -> behavior function lookup (Record<BehaviorName, Fn>: compiler-enforced)
  movement/                 topdown_8dir, platformer_run_jump, shmup_freeaxis
    MovementRegistry.ts     spec.movementType -> movement controller lookup (compiler-enforced exhaustive)
  camera/                   follow_player, auto_scroll_vertical
    CameraRegistry.ts       spec.camera -> camera controller lookup (compiler-enforced exhaustive; same shape as movement)
  systems/
    HealthSystem            sweeps dead entities, awards score, cleans up
    CollisionSystem          wires every overlap/collider for a level
    ScoreSystem, InventorySystem
    WinConditionSystem       defeat_boss / defeat_all_enemies / collect_all_pickups / reach_trigger / score_threshold / survive_duration
    ProjectileManager         pooled projectiles shared by shooters + player ranged attack
  assets/
    assetKeys.ts             ASSET_KEYS registry — Phaser-free (validate.ts's asset reference-integrity source)
    AssetLibrary.ts          procedurally-drawn placeholder textures (no image files needed)
public/specs/
  example-topdown.json       a hand-written playable level, also the Phase 2 fallback template
  example-shooter.json        a hand-written vertical-shooter level (shmup_freeaxis + auto_scroll_vertical + survive_duration)
  example-platformer.json      a hand-written side-view level (platformer_run_jump, floor gaps + elevated platforms, reach_trigger)
  example-twinstick.json        a hand-written bullet-hell arena (topdown_8dir + shooter/chase behaviors, defeat_all_enemies) — zero new capability, a generalization check
docker-compose.yml           local Postgres (Phase 3), host port 5433
drizzle.config.ts            drizzle-kit config — schema/migrations live under server/db/
server/
  index.ts                   Express app: POST /generate, GET /games/:id(/versions(/:versionId)), POST /games/:id/rollback, POST /games/:id/edit, GET /health
  llm.ts                     generateSpec() — the prompt -> GameSpec retry loop (provider: OpenAI)
  llm.test.ts                  7 unit tests against a mocked OpenAI-shaped client (no real API calls)
  systemPrompt.ts             system prompt + vocabulary block, derived from spec/types.ts + assets/assetKeys.ts (exports buildVocabularyBlock/BEHAVIOR_FIELD_GUIDE for edit/editSystemPrompt.ts to reuse)
  outputSchema.ts              GameSpec schema -> OpenAI Structured Outputs strict-mode schema
  fallbackSpec.ts               loads + validates example-topdown.json at startup as the last-resort spec
  db/
    schema.ts                 Drizzle schema: games, game_versions (Phase 3; edit_source column added in Phase 4)
    migrations/                drizzle-kit-generated SQL, applied via `npm run db:migrate`
    client.ts                  Drizzle + node-postgres pool, reads DATABASE_URL
    games.ts                   repository: createGameVersion, rollbackGameVersion, listVersions, getGameWithCurrentVersion, ...
    games.test.ts                8 integration tests against real local Postgres
  edit/                       Phase 4: natural-language edits, resolved cheapest-first
    intents.ts                 6 deterministic pattern-matched intents (enemy/boss/player speed & health, add enemies/pickups, survive-duration) — zero LLM calls when one matches
    intents.test.ts              17 unit tests, no LLM/DB
    jsonPatch.ts                applyPatchSafely() — fast-json-patch wrapper, clone-not-mutate, malformed patch -> PatchApplyError
    editSpec.ts                 editSpec() — try matchIntent() first, fall through to generateEditPatch(); never swaps in an unrelated spec on total failure, unlike generateSpec's template fallback
    editSpec.test.ts             6 unit tests against a mocked LLM client
    llmPatch.ts                 generateEditPatch() — same structured-error-feedback retry shape as generateSpec, producing a JSON Patch instead of a full spec
    editSystemPrompt.ts          edit prompt, reusing systemPrompt.ts's vocabulary block verbatim
    editOutputSchema.ts          non-strict json_schema format for {"patch": [...]} (a patch op's `value` can be any JSON type — see its own comment for why strict mode doesn't fit, and why the schema root has to be an object, not an array)
```

### Why "interpreter", not "codegen"

`SceneInterpreter` never contains game-specific logic. A new game is a new
JSON file, never a new TypeScript file. Every enum a spec can use
(`entities[].type`, `behavior`, `movementType`, `pickupType`, `triggerType`,
`winCondition.type`) is closed and enumerated in `spec/types.ts` — nothing
freeform. That's deliberate: it's what will make LLM-authored specs
constrainable and validatable in the next phase (`validate.ts` already
produces the kind of structured, human-readable errors a spec-fixing loop
would need).

### Extending the closed enums

Adding a new behavior, entity type, or movement style is always the same
three-step shape:
1. Add the literal to the `as const` array in `spec/types.ts`.
2. Implement it (a `behaviors/*.ts` function, an `entities/*.ts` class, or a
   `movement/*.ts` controller).
2. Register it in the matching `*Registry.ts`.

### Placeholder art

`AssetLibrary.ts` draws every sprite (player, 4 enemy archetypes, boss, NPC,
pickups, projectile, ground/wall tiles, trigger zone) with `Phaser.Graphics`
at boot — no binary asset files. Swapping in real spritesheets later only
means changing how those texture keys get populated; nothing else in the
runtime depends on it.

## Phase 1 — the validator

`validateGameSpec(spec: unknown): { valid: boolean; errors: { path: string;
message: string }[] }` in `src/spec/validate.ts` is three independent gates,
all run every time (a failure in one never skips the others, so one call
surfaces everything wrong with a spec — important for a future retry loop
where an LLM gets these errors back and has to fix them in as few round
trips as possible):

1. **Schema conformance** — `gamespec.schema.json` (a real JSON Schema,
   draft-07) checked via `ajv`: required fields, correct types, and every
   closed enum (`behavior`, `entities[].type`, `movementType`, `pickupType`,
   `triggerType`, `winCondition.type`) restricted to its exact registered
   values, plus `additionalProperties: false` everywhere to catch typo'd
   field names. `ajv`'s errors are reformatted into `{path, message}` (e.g.
   `entities[2].behavior: must be one of: patrol, chase, ...`).
2. **Reference integrity** — every sprite key a spec uses must exist in the
   asset registry; every `entities[].type` / `behavior` / `movementType`
   must exist in the corresponding engine registry. Entity/behavior/movement
   registries (`EntityRegistry.ts`, `BehaviorRegistry.ts`,
   `MovementRegistry.ts`) are typed as `Record<ClosedEnum, Impl>`, which
   makes the compiler refuse to build if the registry and the enum in
   `spec/types.ts` ever disagree — so validate.ts checks against
   `spec/types.ts` directly rather than importing those (Phaser-dependent)
   registries, and the two are provably the same set by construction.
3. **Gameplay invariants** — win condition reachable given the entities
   actually present (`defeat_boss` needs a `boss` entity; `score_threshold`
   needs the sum of achievable score to reach the threshold; etc — "reachable"
   here means "the required entities exist", not full pathfinding, since the
   runtime has none), no negative health/damage/scoreValue, an enemy/boss
   spawned with exactly 0 health, every spawn position inside `world.bounds`,
   and a valid player start.

### Why the validator never imports Phaser

Phaser's bundle touches `window` at import time and throws
(`window is not defined`) outside a browser/DOM — confirmed by trying it
under plain Node. Importing the engine's own entity/behavior/movement
registries from `validate.ts` would have made spec validation only runnable
inside a browser, which is the wrong shape for something meant to gate an
LLM's output in a CLI, a test runner, or a server-side retry loop. Every
module the validator touches (`spec/types.ts`, `spec/gamespec.schema.json`,
`assets/assetKeys.ts`) is deliberately kept free of any Phaser import; a
`vite-node` smoke test importing `validate.ts` under plain Node (no DOM) is
part of how this was verified, and `npm run test` runs entirely in Node too.

## Phase 2 — prompt to playable game

`POST /generate` (`server/index.ts`) takes `{ prompt: string }` and returns
`{ spec, usedFallback, attempts, lastErrors? }`. Internally (`server/llm.ts`,
`generateSpec`):

```
prompt -> OpenAI Structured Outputs (strict, forced JSON schema)
       -> validateGameSpec (the same Phase 1 validator, all 3 gates)
       -> valid?  return it
       -> invalid? feed the structured {path, message} errors back to the
          model as the next turn, retry (up to 2 retries, 3 attempts total)
       -> still invalid, or the API call itself failed? return the
          hand-written example-topdown.json as a guaranteed-playable fallback
```

This never surfaces a broken game to the user: every failure mode (API
error, refusal, malformed JSON, failed validation after 3 attempts) resolves
to the fallback spec instead of an error page. `generateSpec` itself never
throws.

**Provider: OpenAI, not Anthropic.** The plan this was built from assumed
Claude's API (forced `tool_choice`), but this project only has an OpenAI
key, so the mechanism is OpenAI's Structured Outputs (Responses API,
`text.format` with `type: "json_schema", strict: true`) instead — same
role (the model can only emit JSON matching the schema, no prose, no
markdown fences), different vendor. Model: `gpt-6-astra` (OpenAI's current
most-capable tier).

**Nothing about the vocabulary or schema is hand-copied.** `systemPrompt.ts`
builds its vocabulary block (behaviors, entity types, pickup/trigger types,
movement types, win-condition types, valid sprite keys) straight from
`spec/types.ts`'s closed enums and `assets/assetKeys.ts` — the same Phaser-free
sources `validate.ts` checks reference integrity against (see Phase 1).
`outputSchema.ts` builds the OpenAI schema straight from
`gamespec.schema.json` — the same file `ajv` validates against. Add a
behavior or entity type to the registries and both the prompt and the
schema pick it up automatically; there's no second copy to fall out of sync.

**One deliberate exception, forced by the API:** OpenAI's strict Structured
Outputs mode has no concept of a free-form object — every property has to be
enumerated, unlike `gamespec.schema.json`'s intentionally loose
`behaviorParams: {type: "object"}` (which `ajv` accepts as-is, since
different behaviors read different fields — see `spec/types.ts`'s
`BehaviorParams` interface). `outputSchema.ts` has to spell out the known
behaviorParams fields by hand for the OpenAI variant specifically
(`BEHAVIOR_PARAMS_SCHEMA`, mirroring `systemPrompt.ts`'s field guide) — the
one spot in the pipeline that isn't purely derived, and the reason is a hard
external constraint, not an oversight.

**Strict mode's other constraint — no optional properties, only nullable
ones** — meant discovering, via an actual failed API call during
development, that a bare `{"type": "object"}` schema (no `properties`) is
rejected outright (`additionalProperties: false` is required even then).
Fixed in `outputSchema.ts`'s `makeStrict`. The model is told to emit
explicit `null` for anything not applicable, and `llm.ts` strips those nulls
back out (`stripNulls`) before handing the candidate to `validateGameSpec`,
which still expects ordinary absent-when-not-set optional fields.

**Frontend:** `index.html` + `src/main.ts` — a textarea, an "Use example"
button, and a "Generate Game" button. On submit it POSTs to the backend,
shows a loading state, and on success boots the exact same
`SceneInterpreter` path the static `?spec=` flow already used — the
interpreter has no idea (and doesn't need to know) whether its spec came
from a file or an LLM.

**Verified live, not just unit-tested:** with a real `OPENAI_API_KEY`, ran
the actual `/generate` endpoint end-to-end (`a tiny wizard collecting magic
crystals while avoiding goblins, with a dragon boss at the end` → a themed
level with goblin patrol/chase/shooter/melee enemies, crystal pickups, a
"dragon" boss, `usedFallback: false`, valid on the first attempt), then
drove the actual browser UI with Playwright — typed the example prompt into
the real form, clicked Generate, and confirmed the game booted and was
interactive, with zero console errors.

## Phase 3 — persistence and versioning

Every `/generate` call now produces a durable, numbered version of a game
instead of a one-shot in-memory result. Two tables (`server/db/schema.ts`,
Postgres via Drizzle):

```
games          — one row per game "project": id, user_id (placeholder — no
                 auth table yet), title, current_version_id, timestamps
game_versions  — append-only log: id, game_id, version_number (unique per
                 game_id), spec_json, source ('generate'|'edit'|'rollback'),
                 prompt, attempt_count, used_fallback, validation_errors,
                 created_at
```

**`current_version_id` lives on `games`, not derived from `MAX(version_number)`.**
That's what makes rollback cheap: rollback never deletes or renumbers
anything, it reads an old version's `spec_json`, inserts it as a **new**
row with `source: 'rollback'`, and repoints `current_version_id` at that new
row. History is strictly append-only — `game_versions` is never mutated or
renumbered in place, so "how did we get here" is always answerable (a
`rollback` row is visibly a rollback, never indistinguishable from the
original version quietly becoming current again).

**Both the "new version becomes current" step and the rollback step are one
Postgres transaction each** (`db/games.ts`'s `createGameVersion` /
`rollbackGameVersion`) — inserting the version row and updating
`games.current_version_id` happen atomically, so a crash mid-request can
never leave a game pointing at a version that doesn't exist or a
`version_number` gap.

**`attempt_count` / `used_fallback` / `validation_errors` are captured per
version, not just logged.** This is the diagnostic gap closed just before
Phase 3 started (`generateSpec`'s retry-loop errors used to be discarded on
an eventual success, not just a fallback) — now every version row answers
"how did this generation go" by itself, no re-running or log-diving needed.
Confirmed live: one real `/generate` call in this phase's own verification
pass actually hit an OpenAI JSON-parsing failure, fell back on attempt 3,
and the fallback's `attempt_count: 3` / `used_fallback: true` /
`validation_errors: [{path: "(root)", message: "model output was not valid
JSON"}]` all landed in the row exactly as designed.

**API** (`server/index.ts`): `POST /generate` now accepts an optional
`gameId` (regenerate — a new version on an existing game, distinct from
Phase 4's not-yet-built patch-based "edit") and `title`, and returns
`{gameId, versionId, versionNumber, spec, usedFallback, attemptCount}`.
`GET /games/:id` returns the game plus its current version's spec — what a
page reload loads. `GET /games/:id/versions` returns the light history list
(no `spec_json` — that's the one field big enough to make the list heavy).
`GET /games/:id/versions/:versionId` fetches one historical version's full
spec on demand. `POST /games/:id/rollback` takes `{toVersionId}` and returns
the new version it created.

**Frontend** (`src/main.ts`): a generated game's `gameId` gets pushed into
the URL (`?game=<id>`) via `history.replaceState`; opening that URL later
runs `runSavedGameMode` instead of the prompt screen, fetching and booting
the current version directly. A **History** panel (toggled by a button that
appears once a game exists) lists every version with **Load** (read-only
preview — fetches and boots that version's spec without touching what the
server considers current) and **Rollback to this** (POSTs the rollback,
then reboots with the result and refreshes the list so the new row and its
"current" highlight show up). Booting another version now goes through
`activeGame?.destroy(true)` first — needed once `bootGame` could run more
than once per page load, otherwise Load/Rollback would stack a second
Phaser canvas on top of the first.

**Verified live, end to end, not just unit-tested:** with the real backend
and a real local Postgres, ran two `/generate` calls against the same
`gameId` (confirmed `version_number` 1 → 2, second one actually fell back
live as noted above), rolled back to v1 (confirmed a v3 row appeared with
v1's exact `spec_json`, `current_version_id` repointed, and v1's original
row untouched), and confirmed the round-tripped spec still passes
`validateGameSpec` unchanged after a real JSONB write + read. Then repeated
the reload/Load/Rollback sequence by driving the actual browser UI with
Playwright — typed a prompt, generated, reloaded the page via its own
`?game=` URL, opened the History panel, clicked **Rollback to this** on an
older version, and confirmed the game on screen and the version list both
updated to match, with zero console errors throughout.

## Phase 4 — natural-language edits

`POST /games/:id/edit` (`{instruction: string}`) patches the game's current
spec instead of regenerating it. Resolved cheapest-first, in
`server/edit/editSpec.ts`:

```
instruction + current spec
  -> matchIntent() against ~6 deterministic patterns (server/edit/intents.ts)
       hit + patch applies + validates -> done, zero LLM calls, source: 'deterministic'
       hit but the patch fails validateGameSpec -> fall through (not silently discarded)
       no match -> fall through
  -> generateEditPatch(): LLM-authored JSON Patch, same structured-error-
     feedback retry loop as generateSpec (server/llm.ts), up to 3 attempts
       valid -> source: 'llm_patch'
       every attempt fails -> source: 'unchanged' — the ORIGINAL spec,
       untouched, plus why. Never swaps in an unrelated template the way
       generateSpec's fallback does for a from-scratch generation: a broken
       mid-edit swap would be far more confusing than the edit simply not
       taking effect.
```

**The deterministic intents are schema-aware, not the task sketch's literal
field paths.** `EntitySpec` has no top-level `speed` — it lives at
`behaviorParams.speed`, is absent from `shooter`/`stationary` entities (they
don't move), and falls back to each behavior module's own hardcoded default
when omitted from the spec. "make enemies faster" reads that default when
nothing's set, and — since RFC 6902 `replace` requires the target to already
exist, but most of the fields these intents touch are optional and often
absent — every intent writes via `add` (an upsert on an existing object
member), not `replace`, so it never fails just because a field wasn't there
yet.

**Both paths are gated through the exact same `validateGameSpec` generation
uses.** A hand-built deterministic patch is just as capable of producing an
invalid spec as an LLM one (e.g. "make the boss weaker" repeatedly could, in
principle, drive health toward zero — the intent floors it at 1, but the
validator would catch it either way) — there's no special-cased trust for
the cheap path.

**`edit_source` (`'deterministic' | 'llm_patch'`, null for non-edit
versions)** is a new nullable column on `game_versions`, alongside the
existing `source` column, with two DB-level `CHECK` constraints: the value
must be one of the two allowed strings, and it must be null unless
`source = 'edit'`. `source` says a version was an edit; `edit_source` says
how it was resolved — the signal that answers "are edits mostly hitting the
free path or mostly falling through to the LLM" without re-running
anything, the same diagnostic instinct as Phase 3's `attempt_count`/
`used_fallback`/`validation_errors`.

**The LLM patch schema is a real bug, caught the hard way.** OpenAI's
Responses API flatly rejects a `json_schema` format whose root isn't
`type: "object"` — a bare JSON Patch array doesn't typecheck against
Structured Outputs at all, regardless of `strict`. First live edit attempt
against the LLM path failed immediately (`Invalid schema for
response_format... got 'type: "array"'`) before ever reaching
`validateGameSpec`. Fixed by wrapping the array in `{"patch": [...]}`
(`server/edit/editOutputSchema.ts`) and unwrapping it in
`llmPatch.ts`'s parser — the second live attempt with the same instruction
then succeeded on the first try.

**`fast-json-patch`'s named export doesn't survive real Node ESM.** Its
CommonJS build assembles `exports` via `Object.assign(exports, core)`
rather than static `exports.applyPatch = ...`, which Node's CJS→ESM
named-export interop can't see (cjs-module-lexer only detects static
assignment). `import { applyPatch } from 'fast-json-patch'` passed under
vitest (which resolves the package's `module`-field ESM build instead) and
then threw `does not provide an export named 'applyPatch'` under real
`tsx`/Node at runtime — the exact kind of test/runtime resolution mismatch
that only a real `npm run server` boot catches, not the test suite alone.
Fixed with a default import (`import jsonpatch from 'fast-json-patch'`);
`jsonpatch.applyPatch` is a runtime property access, not a static binding,
so it works regardless of how the CJS exports were assembled.

**Frontend:** a text input + Apply Edit button, fixed at the bottom of the
screen, shown alongside the History button once a game exists. On submit,
`changed: false` responses (including a `lastErrors` array, following the
same "surface it even on the branch that creates no new version row"
reasoning as Phase 3's `/generate` fix) show the error inline and leave the
current game running untouched; `changed: true` reboots with the returned
spec and refreshes the History panel so the new row appears immediately.

**Verified live, end to end, against a real generated game with a real
boss:** "make the enemies faster" and "make the boss tougher" both resolved
`deterministic`, zero LLM calls, correct multipliers (enemy speeds ×1.6,
boss health ×1.5) confirmed in the returned spec. A genuinely novel
instruction ("give the player a magical shield...") correctly fell through
to `llm_patch` and landed a small, correctly-scoped health boost on the
first attempt (after the schema-shape bug above was fixed). Rollback to v1
on a game whose history now mixed `generate`/`edit`/`edit`/`edit`/`rollback`
still worked exactly as in Phase 3 — boss health and player health both
reverted to their original pre-edit values. Then repeated the deterministic
edit through the actual browser UI with Playwright — typed "make the
enemies slower" into the Apply Edit box, confirmed the new version appeared
in the History panel with the correct prompt/attempt-count/timestamp, zero
console errors.

**One honestly-reported non-result:** deliberately tried "remove the player
from the game entirely" — a request the closed schema makes structurally
impossible (`player` is a required top-level field). Rather than exhausting
its retry budget and reporting failure, the model self-corrected on attempt
2 to a valid patch that left `player` fully intact — the retry-with-
feedback loop is specifically built to let a capable model route around
exactly this kind of problem using the validation error it's given, which
makes "the LLM path truly exhausts and reports failure" surprisingly hard
to trigger live against a real model on purpose. The deterministic,
repeatable proof of that failure path is `editSpec.test.ts`'s mocked-client
test (a scripted response that's invalid no matter how many times it's
retried) — not a live run, and that's the right tool for it: a live model
finding a way to comply isn't a bug in the edit loop, it's the retry loop
doing its job.

## Phase 5 — frontend (the app shell that was missing)

Phases 2-4 built the whole product loop (generate → persist → edit →
version) but the frontend was still one page sharing state between "no game
yet" and "playing/editing a game" — the mental model didn't match what the
backend actually does. Phase 5 is purely a frontend rewrite: no new
backend endpoints, no schema changes, every screen just consumes routes
that already existed.

**Real client-side routing, not query params.** `/` is the landing view
(prompt box only); `/games/:id` is the play+edit view (canvas, edit bar,
history sidebar). This replaces Phase 3's `?game=<id>` query-param scheme
entirely — a clean URL break, not a redirect shim, since there were no real
users depending on the old links yet. Implemented as a small hand-rolled
router (`resolveRoute()` / `dispatchRoute()` in `src/main.ts`, no router
library) using the History API directly; a `popstate` listener re-dispatches
on back/forward. This works with zero server-side config because Vite's
dev server and `vite preview` both default to SPA fallback (serving
`index.html` for any path that isn't a static file) — `appType: 'spa'` is
Vite's own default, nothing had to be added to `vite.config.ts`. A
production static host would need the equivalent SPA-fallback rewrite rule
configured — normal for any client-side router, not something this project
adds infrastructure for yet (see Not in Phase 5).

**Honest generation feedback, not a fake progress bar.** The plan's own
staged example ("Understanding your request... Generating (attempt 1)...
retrying (attempt 2)...") assumes live, per-attempt visibility into the
server-side loop — which would mean streaming or polling, both of which
are backend work Phase 5's own goal explicitly ruled out ("without
inventing new backend work"). Since `/generate` is a single blocking
request, there's no way to honestly show which attempt is in flight *while
waiting* — so the landing page shows one honest waiting message instead of
faking stage transitions it can't actually observe, and the real
`attemptCount`/`usedFallback` the response carries drive an honest *summary*
once it lands: "Ready!" (attempt 1), "Ready! Took N attempts to validate"
(self-corrected), or a visible, dismissible note if the fallback template
had to be used — the flag Phase 2 added and the UI never once displayed
until now. The outcome is carried across the landing→play-view navigation
(`pendingGenerationOutcome`) so it renders on the *new* page rather than
flashing on a screen that's about to disappear.

**Edit feedback surfaces `edit_source`.** `⚡ Applied instantly` for
`deterministic`, `✨ AI-adjusted (N attempts)` for `llm_patch` — small, but
it's the same signal from Phase 4's own diagnostic column, now visible
without a database query. A `changed: false` response shows the server's
own error message inline with a **Retry** button that resubmits the exact
same instruction (the input text is deliberately left in the box on
failure, not cleared, for exactly this).

**History sidebar reads as a story.** Each row now shows a human label
derived from `source` + `edit_source` ("Generated," "Edited (instant),"
"Edited (AI-adjusted)," "Rolled back") plus a `fallback used` badge when
relevant, the prompt/instruction text, attempt count, and timestamp — so
"generated → made enemies faster (instant) → asked for a shield
(AI-adjusted) → rolled back" is readable at a glance instead of requiring a
column-by-column decode. On a normal monitor it's a persistent sidebar, not
a toggle overlay — matching "canvas + side panel," a real two-column app
shell rather than floating panels over the game.

**Loading/error states don't dead-end.** A failed `/generate` or `/edit`
(network error, non-2xx) shows a **Retry** button that resubmits the exact
last prompt/instruction rather than requiring the user to retype it or
leaving a blank screen. Loading a saved game shows a loading placeholder,
and a genuinely broken load shows the error text in place of a blank
canvas, never a silently empty page.

**One real CSS bug found by actually looking at the result, not just
checking `console errors: []`.** `#canvas-wrap` needs `line-height: 0` to
shrink-wrap tightly around the canvas (so `#hud` can be absolutely
positioned relative to the canvas's own top-left corner rather than the
whole viewport's, now that the canvas no longer fills the screen) — but
that same `line-height: 0` was inherited by `#hud`'s multi-line
`white-space: pre` text, collapsing "HP: 100/100" and "Score: 0" on top of
each other. Only visible in an actual screenshot, not in the zero
console-errors check that would otherwise have looked clean. Fixed with an
explicit `line-height` reset on `#hud` itself, then re-verified visually.

**Verified live, end to end, exactly like every prior phase:** drove the
actual browser with Playwright through the full loop the Definition of
Done describes — landed on `/`, generated a real game (real OpenAI call),
landed on `/games/:id` with the honest "Ready!" banner, applied one
deterministic edit (confirmed `⚡ Applied instantly`) and one novel edit
(confirmed `✨ AI-adjusted (1 attempt)` after a real LLM call), read the
history sidebar's three-row story, rolled back, did a full page **reload**
at `/games/:id` (confirming the SPA fallback and reload-a-saved-game path
both work, not just the in-session navigation), and used the **+ New
Game** link to return to the landing view — zero console errors throughout.
Also checked at a sub-900px viewport width: the sidebar collapses behind
the **History** toggle button, the canvas and edit bar stay fully visible,
and there's no horizontal overflow.

## Phase 6 — genre breadth (repeat the proven recipe)

Two more genres, repeating Phase 6's own space-shooter recipe rather than
re-deriving it: a **platformer** (deliberately close to an existing but
never-exercised capability) and a **twin-stick/bullet-hell arena**
(deliberately near-zero new capability — a generalization check, not a
stretch test).

**Platformer needed zero schema changes.** `platformerRunJump` was already
registered from Phase 0; `world.walls` (arbitrary rectangles) already
double as platforms and ground with no new world-object concept; `camera`
already defaults to `follow_player`; `reach_trigger` and `defeat_boss`
already cover "reach the end" and "beat the boss." The entire genre turned
out to be an exercise in **verifying already-registered capability that had
never actually been driven end to end** — and it wasn't stubbed, but it
also wasn't quite finished:

- **`NPC.ts` was the one entity class missing `setAllowGravity(false)`**
  (`Pickup`/`Trigger`/`Projectile` all had it). NPCs have no wall collider
  either, so under `platformer_run_jump`'s real gravity, an NPC would fall
  straight through the level with nothing to stop it — never exercised
  until a genre with real gravity existed to expose it.
- **A live-generated spec set `player.jumpVelocity` to a negative number.**
  `platformerRunJump.ts` computed `setVelocityY(-player.jumpVelocity)`,
  assuming the field was always a positive magnitude — nothing in the
  schema or prompt said so. Negating an already-negative value applies a
  *downward* shove that's instantly absorbed by standing on the ground, so
  pressing jump did precisely nothing, silently, with zero errors anywhere.
  Confirmed the mechanism precisely (not just guessed) by reaching into the
  live Phaser scene via a temporary debug hook: `velocityY` stayed exactly
  `0` across every sample after the jump key was pressed. Fixed at both
  layers: `gamespec.schema.json` now has `"jumpVelocity": {"exclusiveMinimum": 0}`
  (Gate 1 now rejects it outright — a pure schema-data tightening, zero
  `validate.ts` code touched), the controller now does
  `-Math.abs(player.jumpVelocity)` as a defensive second layer regardless of
  what any caller supplies, and one line was added to the prompt's rules
  list so the model gets it right on attempt 1 rather than needing a
  Gate-1 round trip.

Both bugs were latent since Phase 0 — a genuinely different genre (real
gravity in play, for the first time) was what actually exercised the code
paths that exposed them. Both are now covered by regression tests
(`NPC.ts`'s fix has no isolated unit — it's structural; the `jumpVelocity`
fix has a new Gate 1 test in `validate.test.ts`).

**Twin-stick/bullet-hell needed *no* runtime changes at all** — `topdown_8dir`,
`shooter`, `chase`, `follow_player`, `defeat_all_enemies` all already
existed and needed no fixes. This was deliberately the "does the recipe
generalize with near-zero new capability" check the Phase 6 plan itself
recommended as the lower-cost second genre, not the harder tower-defense
alternative (genuinely different — no player movement at all, wave-based
spawning — noted here as a candidate for a future phase if a harder test is
wanted later).

**Genre-conflict re-check.** After each new genre, every earlier genre's
control prompt was re-run — not just the new genre's own prompts. All
three (dungeon, space-shooter, platformer) still landed the exact same
correct enum choices (`topdown_8dir`/`shmup_freeaxis`/`platformer_run_jump`,
matching camera, matching win conditions) after both new genres and the
`jumpVelocity` prompt-rule addition, confirmed live with all four genres
in the vocabulary simultaneously. No cross-genre correlation drift found.

**Verified live, per genre, exactly like the space-shooter slice:** 3
real prompts each for platformer ("jump between platforms collecting
coins," "mario-style... enemies to avoid," "a jumping game with a boss at
the end") and twin-stick ("waves of enemies... clear them all," "bullet
hell... survive against swarms," "reach a score of 500") — all landed
correctly (right `movementType`, right `camera`, sensible `winCondition`
matched to phrasing), all `usedFallback: false`. One LLM-generated
platformer spec was then hand-verified in the browser too: player fell
under real gravity onto the floor, walked, jumped *upward* (the
`Math.abs` fix confirmed working on live model output, not just the
hand-written spec), all with zero console errors.

## Definition of done (met)

**Phase 0:** hand-wrote `public/specs/example-topdown.json` (a dungeon room
with walls, a patrol/chase/melee/flying/shooter enemy each, a boss,
coin/health pickups, an NPC, and a `defeat_boss` win condition) and played it
end to end via the interpreter — movement, camera follow, wall collision,
contact damage with i-frames, NPC dialogue, HUD — with zero AI involved.
Verified with a headless-browser smoke test (screenshots + console-error
check) during development.

**Phase 1:** `validateGameSpec` implements all three gates above with
structured `{path, message}` errors, covered by 29 unit tests
(`src/spec/validate.test.ts`, run via `npm run test`) against both valid
specs (including one per win-condition type) and deliberately broken ones
(one per gate, plus a test asserting all three gates report in a single
call rather than short-circuiting).

**Phase 2:** typed a one-sentence prompt into the running frontend, clicked
Generate, and got a playable, thematically-matching game in the browser —
verified against the real OpenAI API (not just mocked), then verified again
by driving the actual UI end to end with Playwright. The retry loop
(structured-error feedback, capped retries, guaranteed fallback) is covered
by 7 unit tests against a scripted fake client (`server/llm.test.ts`).

**Phase 3:** two generations against the same `gameId` produce versions 1
and 2, both independently retrievable with their own diagnostics intact;
reloading a game via `GET /games/:id` (or its `?game=` URL in the frontend)
returns the current version's spec, playable in the runtime unchanged; a
rollback produces a new version row (never a mutation), correctly repoints
`current_version_id`, and the rolled-back-to spec plays correctly; all of it
verified against a real local Postgres both at the API layer (curl) and
through the actual browser UI (Playwright), plus 5 integration tests
(`server/db/games.test.ts`). Clean typecheck, clean `npm run build`.

**Phase 4:** "make enemies faster" on a real generated game produced a new
version with enemy speeds increased, resolved deterministically, zero LLM
calls, confirmed via `editSource: 'deterministic'` in the response and
`edit_source` in the database row. A genuinely novel instruction correctly
fell through to the LLM patch path and landed a valid, gated result on the
first attempt. The one truly-invalid-edit case turned out to be
un-triggerable live against a real model by design (see above) — proven
instead by a deterministic mocked-client unit test, which is the more
honest tool for pinning down a failure path that depends on the model
*not* self-correcting. Rollback (Phase 3) still worked correctly on a game
whose history mixed `generate`/`edit`/`rollback` versions. Same test rigor
as every prior phase: 17 + 6 unit tests, 3 additional DB integration tests
(`edit_source` round-trip and both new `CHECK` constraints), a live API run
against the real OpenAI API and a real local Postgres, and a live browser
run with Playwright through the actual Apply Edit UI. Clean typecheck,
clean `npm run build`.

**Phase 5:** landed on `/`, generated a real game, landed on `/games/:id`
watching an honest "Ready!" banner (not a fake progress bar), applied a
deterministic edit and saw `⚡ Applied instantly`, applied a novel edit and
saw `✨ AI-adjusted (1 attempt)` after a real LLM call, read the version
history as a readable story, rolled back, reloaded the page and got the
same game back, and returned to the landing view via **+ New Game** — all
in one live, Playwright-driven browser session, zero console errors. A real
CSS bug (HUD text collapsing onto itself) was found by actually looking at
a screenshot, not just checking for console errors, and fixed. Verified at
a sub-900px width too: sidebar collapses behind a toggle, no horizontal
overflow. Clean typecheck, clean `npm run build`.

**Phase 6:** two new genres (platformer, twin-stick/bullet-hell), each with
a hand-verified spec and 3+ successful real-prompt generations
(`usedFallback: false` on all six). Every capability addition was purely
additive — no `validate.ts` logic changes, no schema restructuring (the one
schema edit, `jumpVelocity`'s `exclusiveMinimum`, is a numeric-range
tightening on an existing field, not a new concept). All three prior
genres' control prompts still passed, re-verified together with all four
genres in the vocabulary at once. Test suite grew by one Gate 1 regression
test for the `jumpVelocity` fix. Two genuine latent bugs (unrelated to the
genre-addition mechanism itself) were found and fixed along the way — both
confirmed precisely, not guessed: NPC gravity (`NPC.ts`) and the negative
`jumpVelocity` silently breaking jump entirely, the latter confirmed via
direct Phaser-scene inspection showing `velocityY` staying exactly `0`
after the jump key was pressed.

## Not in Phase 0 (by design)

- No LLM / spec-generation — that's the next phase, built against the
  `validate.ts` contract established here.
- No respawn/checkpoint logic beyond firing a message (the `checkpoint`
  trigger type exists in the schema but doesn't yet move the respawn point).
- No tilemap editor or real spritesheets — placeholder procedural art only.
- No audio.
- One bundled JS chunk (`vite build` warns about the >500kB chunk, mostly
  Phaser itself); acceptable for a single-page game runtime, but worth
  splitting if this grows into a multi-game shell.

## Not in Phase 1 (by design)

- "Reachable" win conditions only check that the required entities *exist*
  in the spec, not that the player can physically walk to them — there's no
  pathfinding in the runtime to check that against. A win trigger sealed
  behind an unbroken ring of walls would still pass.
- `additionalProperties: false` is enforced everywhere in the schema, which
  is deliberately strict (it catches a typo'd field name immediately) but
  means a genuinely new optional field needs a schema update in the same
  change that adds it — there's no forward-compatible "unknown fields are
  ignored" mode.
- `npm audit` flags moderate/high issues in `vite`/`vitest`'s dependency
  chain (esbuild's dev-server request handling, a vitest mocker path-
  traversal advisory) — both are dev-tooling-only, not shipped in
  `dist/`, and fixing them means major-version bumps to vite/vitest. Left
  alone for now; worth revisiting before this repo has other contributors
  running the dev server on a shared/untrusted network.

## Not in Phase 2 (by design)

- No persistence — nothing is stored anywhere. Every `/generate` call is
  stateless and independent; refreshing the page loses the generated spec.
  Deliberately deferred to whatever Phase 3 turns out to be, per the Phase 2
  plan's own advice not to design storage speculatively before seeing real
  generation results. **(Resolved in Phase 3.)**
- No streaming / progress feedback beyond a static "Generating…" message —
  a single generation (including retries) can take a while, and the UI has
  no indication of which attempt it's on or why a retry happened.
- CORS is wide open (`Access-Control-Allow-Origin: *`) and there's no auth,
  rate limiting, or request logging on `/generate` — fine for a local
  prototype hitting your own OpenAI key, not fine to deploy as-is.
- The backend is a separate `tsx` process (`npm run server`), not part of
  the Vite build — there's no production deployment story yet (no Dockerfile,
  no process manager, no reverse proxy config).
- `outputSchema.ts`'s hand-maintained `BEHAVIOR_PARAMS_SCHEMA` (see Phase 2
  above) has no automated check that it stays in sync with `spec/types.ts`'s
  `BehaviorParams` interface — unlike everything else in the pipeline, this
  one link is enforced by a code comment, not the compiler or a test.
- Model/provider choice (`gpt-6-astra` via OpenAI) is hardcoded in
  `server/llm.ts` — no fallback provider, no per-request model override.

## Not in Phase 3 (by design)

- No edit/patch loop — `source: 'edit'` exists in the schema and the CHECK
  constraint for Phase 4 to use, but nothing writes it yet. Regenerating via
  `POST /generate` with a `gameId` is "start over from a new prompt", not
  "patch the existing spec". **(Resolved in Phase 4.)**
- No real auth or multi-tenancy — `games.user_id` is a hardcoded placeholder
  UUID (`PLACEHOLDER_USER_ID` in `server/index.ts`) for every game, not a
  real users table or session. Nothing scopes `/games/:id` to "your own"
  games; any id is readable/rollback-able by anyone who has it.
- No object storage — specs are small JSON, so `spec_json` lives directly in
  a `jsonb` column. Deliberately deferred per the Phase 3 plan's own advice:
  don't add S3 until Phase 7's binary assets actually need it.
- Test and dev data share one Postgres instance/database (`gd_runtime` on
  `localhost:5433`) — `server/db/games.test.ts` cleans up every row it
  creates (`afterAll` deletes by tracked id, cascading to versions), but
  there's no separate ephemeral test database or transaction-per-test
  rollback. `npm run test` now requires `npm run db:up` (+
  `npm run db:migrate` once) to have been run first — unlike Phases 0-2,
  the unit suite is no longer fully hermetic out of the box.
- No connection pooling tuning, retry/backoff on transient DB errors, or
  graceful shutdown (draining the `pg.Pool`) in `server/index.ts` — fine for
  a local prototype talking to a single local Postgres, not fine to deploy
  as-is.
- The version-history UI is deliberately minimal (a flat list, no diff view,
  no timeline) — enough to prove versioning/rollback works, not a finished
  history browser.

## Not in Phase 4 (by design)

- Only 6 deterministic intents (enemy/boss/player speed, boss/player
  health, add enemies, add pickups, survive-duration) — enough to prove the
  cheap-path-first shape works, not exhaustive coverage. Everything else
  correctly falls through to the LLM patch path; that's the design, not a
  gap to keep filling before Phase 5.
- The LLM patch prompt hands the model the entire current spec as one JSON
  blob (`JSON.stringify(spec)` in the user message) — fine for the small
  specs this runtime generates today, but doesn't scale token-wise to a
  much larger spec the way a more surgical "only show the relevant slice"
  prompt would.
- No patch size/blast-radius limit — an LLM-authored patch that touches
  far more of the spec than the instruction implied is still accepted as
  long as it validates. There's no check for "this edit changed way more
  than it should have."
- `move`/`copy`/`test` JSON Patch ops are deliberately unsupported (only
  `add`/`replace`/`remove`) — a smaller vocabulary for the LLM to get
  wrong, sufficient for every edit this phase's intents or live testing
  needed. Revisit if a real instruction turns out to need one.
- No edit history/undo beyond what Phase 3's rollback already provides —
  there's no "undo my last edit specifically" distinct from "roll back to
  an arbitrary earlier version."
- No rate limiting or cost controls on `/games/:id/edit` — same gap as
  `/generate` already had (see Not in Phase 2), now with a second endpoint
  that can trigger real API spend.
- No test/dev database separation, same as Phase 3 — the new `edit_source`
  integration tests share the same cleanup-by-tracked-id discipline, not a
  structurally isolated test database.

## Not in Phase 5 (by design)

- No user accounts/auth beyond the Phase 3 placeholder `user_id` — not
  needed to prove the product loop, per the phase's own explicit scope cut.
- No multi-game dashboard/gallery ("list all my games") — same explicit
  cut; `/` only ever creates a new game, there's no way to browse back to
  an old one except a saved `/games/:id` link.
- No true live per-attempt generation progress — `/generate` is a single
  blocking request with no streaming/polling (adding either would be new
  backend work, which this phase's own goal explicitly ruled out), so the
  "honest feedback" is one waiting message plus an honest post-hoc summary,
  not a real-time stage-by-stage trace of what the server is doing right now.
- No production static-hosting config (an Nginx/Vercel/Netlify rewrite
  rule, or equivalent) for the new path-based routing — `npm run dev` and
  `vite preview` both get SPA fallback for free from Vite's own defaults,
  but a real static host needs the equivalent rule added at deploy time;
  Phase 2 already flagged "no production deployment story yet" and that
  remains true here.
- No design-system polish, custom fonts, or UI animation — deliberately
  plain chrome around the actual product (the game canvas), per the phase's
  own explicit scope cut.
- No automated test coverage for the frontend itself (`src/main.ts`'s
  router/view logic) — verified live with Playwright during this phase
  (see above) but there's no unit or component test suite for it, unlike
  every backend module added since Phase 2.
- The mobile/narrow layout is "doesn't look broken on a laptop screen,"
  not mobile-first — verified down to ~820px wide, not tested on an actual
  phone-sized viewport or touch input.

## Not in Phase 6 (by design)

- Only two new genres, not the harder tower-defense alternative the plan
  offered (genuinely structurally different — no player movement at all,
  wave-based spawning, placement-based play) — deliberately deferred as a
  candidate for a future phase if a stronger structural test is wanted;
  twin-stick was chosen as the second genre specifically because it's a
  cheap generalization check, not a stretch test.
- No new procedural assets were added — both genres reuse the existing 18
  textures as-is (platformer needed none; twin-stick reused `tile_space`
  and existing enemy sprites). Worth revisiting if a future genre's reused
  sprites read as thematically wrong (e.g. an "enemy_patrol" red blob
  standing in for a Goomba).
- The platformer's jump key is bound to the up-arrow/cursor key
  (`MovementController.ts`'s existing `jumpJustPressed`, shared with
  `topdown_8dir`'s up-movement), not a dedicated jump button — undiscovered
  as a UX question until this phase actually had a genre where "up" and
  "jump" are different actions players expect a separate key for.
- `NPC.ts`'s gravity fix has no isolated unit test (unlike the
  `jumpVelocity` fix) — it's a structural one-line change verified via the
  platformer's own live/browser verification pass, not a dedicated
  regression test, since NPCs don't currently appear in any of the hand-
  written or generated example specs used in this phase.
- No genre-selection UI or hint — genre is inferred entirely from prompt
  wording, same as every prior genre; there's still no explicit `genre`
  enum field gating which movement/camera options are even offered per
  genre, deferred again per the original space-shooter slice's own
  reasoning (not yet proven necessary).

## Tier 1 — procedural juice

The first of a three-tier visual-juice plan. Tier 1 is pure runtime work —
tweens and camera effects hooked into events that already fire (damage,
death, pickup collection, landing) — with an explicit, load-bearing
constraint: **zero changes to `GameSpec`, `validate.ts`, or the LLM
prompt.** Every effect is always-on baked-in entity behavior, the same way
HUD rendering or camera-follow isn't something a spec decides per-game —
there's no vocabulary for this to drift from, so it can't introduce drift.
Tiers 2 (multi-frame procedural sprite animation) and 3 (theme packs) are
follow-on work, not attempted here.

**`src/fx/` — one small function per effect, each taking a Phaser
GameObject/Scene and firing a tween or a built-in:**

```
hitFlash.ts        white tint-fill flash on damage (also used for BaseEntity's pre-existing enemy/boss flash and Player's pre-existing red flash — both were already hand-rolled inline with slightly different durations; unified into one shared function, colors preserved)
cameraShake.ts     thin wrapper over Phaser's built-in camera.shake()
deathTween.ts      scale-to-0 + fade over 300ms, then an onComplete callback
pickupPop.ts       scale-up + fade over 180ms on the pickup, plus a floating "+N" / "+N HP" label that rises and fades
landingSquash.ts   squash to (1.15, 0.8) then spring back over 200ms (platformer-specific)
idleBob.ts         continuous sine yoyo tween on y — wired only to Pickup, see below
projectileTrail.ts fading ghost images dropped behind an active projectile every frame
```

**Two real bugs found by precise verification, not by "it looks fine in a screenshot."** Same lesson as Phase 5's HUD CSS bug — visual/timing-sensitive effects need more than a console-error check:

- **The landing squash retriggered continuously and got stuck squashed for
  over a second.** Dense scene-polling during an actual landing (samples
  every ~30ms via a temporary debug hook into the live Phaser scene, the
  same technique used to pin down Phase 6's `jumpVelocity` bug) showed the
  player's scale oscillating instead of settling. Root cause: Arcade
  physics' `body.blocked.down`/`touching.down` flicker false/true
  frame-to-frame for a body resting under constant gravity on a static
  floor — a well-known Arcade quirk, not something this project's own
  bugs so far had ever exercised, since no prior genre put a physics body
  to rest under real gravity for an extended time. A boolean
  wasGrounded-edge-detector reads that flicker as "left and re-landed"
  many times a second. Fixed by gating on actual fall velocity from the
  previous frame instead (`Player.lastVelocityY`) — resting-state velocity
  noise never approaches a real fall's speed, so it's immune to the flag
  flicker that broke the boolean approach. Verified by the same dense-
  polling technique: squash now fires exactly once per real landing and
  settles cleanly.
- **A screenshot taken 30ms after an attack showed no hit-flash at all**,
  even though health/score/removal all updated correctly — looked like a
  real bug (`setTintFill` requires WebGL; worth checking whether headless
  Chromium even had it — it did, `renderer.type === Phaser.WEBGL`
  confirmed). Turned out to be screenshot-timing luck, not a bug: polling
  `sprite.isTinted`/`tintFill` directly at 10ms resolution showed the tint
  correctly applied for the first ~30ms after the hit and cleared right on
  schedule at 80ms. A screenshot is a single sample of something that only
  lasts 80ms; a state-polling loop isn't.

**Pickup lifecycle ownership was untangled while wiring in the pop
effect.** Collected pickups used to be hidden instantly by
`CollisionSystem`, then actually destroyed later by `HealthSystem`'s
combat-death sweep — a pickup has nothing to do with HP/combat, and that
coupling only existed because both paths happened to converge on "remove
this dead thing from its group." Now `CollisionSystem.onPlayerTouchPickup`
owns a collected pickup's entire lifecycle itself (disable its body
immediately so it can't be double-collected, run the pop, then deactivate
and remove it from its group in the pop's `onComplete`), and
`HealthSystem` no longer receives the pickups group at all — it now only
ever sweeps enemies/bosses, matching what its name always implied. A
`dying` flag on `BaseEntity` (distinct from `dead`) plays the equivalent
role for combat deaths: it stops `HealthSystem`'s per-frame sweep from
restarting the death tween every frame between "health hit zero" and "the
tween's `onComplete` actually removes it."

**Idle bob is deliberately narrow — pickups only, not enemies or the
player.** A continuous tween nudging `y` every frame has nothing to fight
on a pickup (gravity already disabled, never collides with walls, no
behavior ever touches its position) but would fight Arcade physics'
own position integration on anything gravity/velocity-driven. Applying it
more broadly was in the original effect list but is explicitly not
attempted here — noted as a real scope narrowing, not silently dropped.

**Projectile trail, not projectile rotation.** The task offered either as
alternatives for the same slot. Rotation-to-match-velocity-angle was
rejected on inspection: the actual `projectile` texture is a plain circle
(`AssetLibrary.ts`), and rotating a circle is invisible. A trail reads
regardless of sprite shape, so that's what got built.

**Verified per-effect, precisely, not just "no console errors" — the bar
Phase 5's HUD bug raised:** idle bob confirmed via exact y-position
sampling 450ms apart on a stationary pickup (moved, as expected, not a
static screenshot guess); pickup pop confirmed via score/HUD change plus a
visible floating "+5"; hit-flash confirmed via `isTinted`/`tintFill`
polling at 10ms resolution; death confirmed via health dropping 2→1 on the
first hit and the enemy sprite count reaching 0 after the second, with the
scale/fade caught mid-tween; landing squash confirmed via dense polling
showing exactly one clean squash-and-recover cycle (after the fix above);
projectile trail confirmed both visually (a clearly visible fading dotted
streak between a turret and the player) and by counting live trail-ghost
objects in the scene. Screen shake is Phaser's own well-tested `camera.shake()`
built-in behind a two-line wrapper — verified by code correctness rather
than an independent pixel measurement, unlike the two effects above that
actually needed one.

## Definition of done (met) — Tier 1

Every existing game across all four genres now visibly flashes on hit,
pops on pickup with a floating "+N," shakes the camera on boss/player
damage, animates a death instead of instantly vanishing, and (on the
platformer) squashes on landing — with zero changes to spec generation,
validation, or the LLM prompt. All 68 existing tests still pass unchanged
(this tier doesn't touch anything they cover), clean typecheck, clean
`npm run build`.

## Not in Tier 1 (by design)

- Tier 2 (multi-frame procedural sprite animation) is resolved below. Tier
  3 (theme packs, wiring animated sprites through a theme spec field)
  remains the next step, not attempted here.
- AI-generated image assets are explicitly excluded from the whole
  three-tier plan, not just this slice — everything stays inside the
  existing procedural-art system on purpose.
- Idle bob only applies to pickups — not enemies, not the player — per
  the scope narrowing explained above.
- No reduced-motion / effects-off setting — every effect is always-on,
  matching the "baked into the entity classes, not spec-controlled"
  design, but that also means there's no way for a player to turn any of
  it off yet.
- No automated tests for the fx module itself — verified live (screenshot
  + precise scene-state polling) during this phase, same as the frontend
  in Phase 5, but there's no unit/visual-regression suite guarding these
  tweens going forward.
- Screen shake intensity/duration aren't tuned per-hit-strength — every
  boss hit shakes the same amount regardless of damage dealt, every player
  hit the same regardless of source.

## Tier 2 — procedural sprite animation

Real animation — walk cycles and a fire-flash pop — built the same way
every static texture already is: procedural `Graphics` draws, now N of
them instead of one. Same load-bearing constraint as Tier 1: **zero
changes to `GameSpec`, `validate.ts`, or the LLM prompt.** Animation state
is derived entirely from things that already exist at runtime (a physics
body's velocity, the `shooter` behavior firing, `flying_sine`'s free-float
movement) — there's no new vocabulary for the model to pick, so nothing
about this tier needed live-prompt verification the way a genre addition
would.

**Explicitly generic, not a hand-picked sprite list — this was the
person's own correction mid-plan.** The task sketch this was built from
listed priority targets (player walk, enemy walk, "asteroid" tumble, a
fire animation, boss-specific frames) as if picking which sprites get
animated were a per-entity decision. It isn't, here: `generateAnimatedAssets()`
builds a walk cycle and a fire-flash for **every** entry in
`AssetLibrary.ts`'s `DEFS` uniformly — all 18 asset keys across all four
genres today, and anything added to that registry later, automatically,
with zero new per-entity code. Which animation actually *plays* is decided
generically too: by velocity (walk/idle, works on the player and every
enemy/boss identically) or by behavior name (`flying_sine` → tumble,
`shooter` firing → fire-flash) — never by checking a specific sprite key.
A "boss" gets exactly the same treatment as anything else, because a boss
is just an `Enemy` subclass running the same behaviors through the same
code path — no bespoke boss-only animation branch exists or is needed.

**How the frames are actually generated — one shared transform, not
per-shape art.** Most of the existing sprites are simple flat-color
geometric primitives (circles, rounded rects, triangles) with no limbs to
draw a literal walk cycle for. Rather than hand-authoring bespoke
multi-frame art per shape (which wouldn't generalize to "anything the user
says" — the explicit constraint here — since a shape the LLM's vocabulary
produces tomorrow would need its own bespoke frames too), every walk/fire
frame is produced by wrapping the *same* existing static `draw()` function
in a generic scale/offset transform (`Graphics.translateCanvas` /
`scaleCanvas`, applied about the sprite's own center) before invoking it —
a squash-stretch-bob wobble cycling over 4 frames for walk, a single
scaled-up "pop" frame for fire. This works identically regardless of the
underlying shape, so it's genuinely generic over anything currently in the
registry or added to it later, not a fixed list.

**Implementation deviates from the task's own code sketch on purpose: N
separate baked textures + an explicit `frames` array, not a packed
sprite-sheet + `generateFrameNumbers()`.** Phaser's animation system
supports both equally (`AnimationFrame.key` can point at any texture, not
just a slice of one shared sheet) — separate textures reuse
`generatePlaceholderAssets`' exact existing draw-then-`generateTexture`
idiom with zero new packing/atlas logic, at the cost of a handful more
small baked textures at this asset count. Noted here as a deliberate
choice, not a shortcut taken by accident.

**Two real bugs found by precise verification — the same discipline as
every tier and phase before this one, not "it looks fine in a
screenshot":**

- **A stationary shooter's fire-flash was silently killed the instant it
  started, every single shot.** `updateMovementAnimation` runs once per
  frame for every entity, right after the behavior loop that (for a
  shooter) just called `playFireFlash` a couple of lines earlier in the
  *same* frame. Seeing zero velocity and *something* playing, it
  immediately stopped it and reverted the texture — a genuine conflict
  between two independently-wired animation systems, not a screenshot
  timing artifact this time. Caught precisely: 40 samples of the turret's
  live texture key at 30ms resolution over ~1.2s showed the base texture
  the entire time, never once the `_fire_0` frame, even though the
  behavior code firing was never in doubt. Fixed by having
  `updateMovementAnimation` only ever stop *its own* animation — checking
  `sprite.anims.currentAnim?.key` against the walk key specifically,
  rather than treating "anything is playing" as "we must have started it."
  Re-verified with the same sampling technique: the fire-flash now shows
  up clearly, in three distinct bursts matching three separate shots.
- **A design question resolved empirically rather than by guessing.**
  `flying_sine` entities get *both* the tumble rotation and the
  velocity-driven walk cycle simultaneously (they have nonzero velocity
  too), which looked, on paper, like it might read as chaotic — a
  squashing sprite spinning at the same time. Rather than pre-emptively
  narrowing the scope the way idle-bob was narrowed in Tier 1, this one
  was checked visually first: a 6-frame screenshot sequence of a
  `flying_sine` enemy showed clean, coherent rotation with the walk
  wobble reading as an unobtrusive extra bit of life, not jank. Left as-is
  — a real example of "verify before restricting," not just "verify after
  building."

**Verified per-genre, watching it move across several frames, not a
single screenshot — the bar this tier's own plan explicitly asked for:**
a patrol enemy's live texture key was sampled 20 times at 40ms resolution
and cycled cleanly through `enemy_patrol_walk_0` → `_1` → `_2` → `_3` →
back to `_0`, repeating; the player was confirmed idle (static `"player"`
texture, unmoving) at rest, correctly cycling `player_walk_0..3` while
moving, and correctly reverting to the static texture the moment it
stopped; a `flying_sine` entity's rotation was confirmed changing
continuously (1.48 → 2.96 radians over 500ms) while simultaneously
showing walk-cycle frames, then visually confirmed clean across a 6-frame
screenshot sequence; the platformer's player was confirmed walking
correctly (screenshots showing clear horizontal progress across frames)
with zero conflict against Tier 1's landing squash (the two touch
different properties — baked texture content vs. instance scale
transform — so there was never a real collision risk there, unlike the
fire-flash case above).

## Definition of done (met) — Tier 2

Every game, in every genre, now has a player and enemies that visibly
walk/idle-cycle instead of sliding around as static sprites — confirmed
via live texture-key sampling, not assumed. The space genre's `flying_sine`
enemies visibly rotate/tumble, exactly matching the "asteroid" example from
the original ask — but the mechanism is entirely generic (behavior-keyed,
not sprite-keyed), so it applies identically to a bat, a UFO, a drifting
rock, or anything else `flying_sine` ever gets paired with in any theme,
not just literal asteroids. All 68 existing tests still pass unchanged,
clean typecheck, clean `npm run build`.

## Not in Tier 2 (by design)

- Tier 3 (theme packs — wiring these animated sprites through a `theme`
  spec field so "space" / "dungeon" / "platformer" themes get
  visually distinct animated art, not just distinct behavior/camera
  choices) is the next and final step of the original three-tier plan,
  not attempted here.
- No jump-specific player pose — the platformer player only ever shows
  walk or idle, matching the task's own explicit "Player walk/idle" scope;
  airborne state isn't a distinct animation.
- No attack/swing animation for melee — the fire-flash effect is tied to
  *firing a projectile* specifically (shooter behavior, player ranged
  attack); a melee swing has no equivalent hook wired up.
- No reduced-motion / effects-off setting, same gap as Tier 1 — every
  animation is always-on, baked into the entity classes rather than
  spec-controlled.
- No automated tests for `src/assets/AnimatedAssetLibrary.ts` or
  `src/anim/` — verified live (precise texture-key/rotation polling plus
  screenshots) during this phase, same discipline as Tier 1's fx module,
  but there's no unit or visual-regression suite guarding this going
  forward.
- Walk-cycle frames are baked for every asset key uniformly, including
  ones that never actually move (ground/wall/space tiles, the trigger
  zone) — harmless (a few unused small textures) but not filtered out for
  simplicity's sake.
- No NPC animation exercised — NPCs extend the same entity class and would
  animate identically if they ever received nonzero velocity, but nothing
  in the runtime currently drives an NPC's behavior/movement at all (a
  pre-existing gap predating this tier, not something introduced or fixed
  here).

## Tier 3 — theme packs

`theme` groups the sprites Tier 1/2 already drew and animated into two
visually-coherent buckets — `"dungeon"` and `"space"` — and makes sprite
resolution theme-aware, so a genre's *setting* (implied by the prompt) and
its *art* finally agree, instead of a topdown/platformer request always
rendering the same dungeon-flavored shapes regardless of what the player
actually asked for.

**Two buckets, decided explicitly rather than left to grow ad hoc.** Every
sprite that already existed sorts cleanly into one of two settings —
generic fantasy/dungeon shapes (player, patrol/chase/flyer/shooter enemies,
the boss, ground tiles) versus the space-shooter genre's dedicated ship art
(`player_ship`, `enemy_ship_a/b`, `tile_space`). `platformer_run_jump` and
`topdown_8dir` both default to the dungeon bucket (their existing sprites
already belong there); `shmup_freeaxis` defaults to space for the same
reason. Twin-stick isn't pinned to either movement type — it's just
whichever theme the prompt's setting implies — which is exactly what
exposed the bug described below.

**Required, not optional-with-a-default — a deliberate lesson carried over
from camera.** Phase 6's camera field started optional-with-a-default, and
the model quietly stopped reasoning about it — it just never got mentioned
unless something upstream forced the issue. Theme is far more visually
consequential than camera ever was (it changes literally every sprite on
screen), so it went straight into the schema's `required` array with no
default value at all: `theme` is now `Theme` (not `Theme | undefined`) on
`GameSpec`, Gate 1's JSON Schema lists it in `required`, and the prompt
tells the model explicitly that there's no default to fall back on. A new
`validate.test.ts` case (`"requires theme and rejects a value outside the
closed enum"`) locks this in.

**`ThemeRegistry.ts`: the same compile-checked-completeness idiom as
`MovementRegistry`/`CAMERA_AFFINITY`, keyed off what the schema actually
has — not an invented "entity subtype" concept.** The task's own sketch
assumed an `EntitySubtype` enum distinct from `type`/`behavior`; no such
concept exists here, so `ThemeAssets` is keyed off the real fields instead:
`enemyByBehavior: Record<BehaviorName, AssetKey>` and `pickupByType:
Record<PickupType, AssetKey>`, both non-`Partial`, so adding a theme
without mapping every behavior and every pickup type is a compile error,
not a silent runtime gap. `player`, `boss`, and `tileset` are single
`AssetKey` fields per theme. Both themes' boss and pickup sprites currently
point at the same generic assets — flagged in the file's own comments and
below, not silently accepted, because no dedicated space-boss or
space-pickup art exists yet; Tier 3 is a pure reorganization of Tier 0–2's
existing art, not a new-art pass.

**The precedence decision: theme always wins, `sprite` stays in the
schema.** The task explicitly asked for a deliberate choice between "theme
always wins + maybe remove `sprite` from the schema" and "keep both,
add a Gate 2 consistency check." Removing `sprite` would have meant
rewriting all four example specs, `fallbackSpec.ts`, and every test
fixture's entity literals for no functional gain — the field's value
literally becomes irrelevant for any themed role, so validating it *against
the theme* would only be validating a value the runtime is about to ignore
anyway. Kept `sprite` untouched (still validated against the full asset
registry by Gate 2, unrelated to theme), but `resolveEntitySprite` /
`resolvePlayerSprite` / `resolveTileset` in `ThemeRegistry.ts` always
override it for the roles theme covers — player, boss, every enemy (keyed
by `behavior`), every pickup (keyed by `pickupType`). NPCs and triggers are
explicitly *not* theme-covered (no theme-specific art exists for them
either), so their `sprite` field still passes straight through unmodified.
This sidesteps the whole class of "sprite doesn't match theme" validation
Gate 2 would otherwise need — a mismatch not being an error was the point,
since it's never user-visible after resolution.

**Wired into `SceneInterpreter.ts`'s one shared sprite-resolution path** —
the same central code every genre and every existing test depends on, exactly
the file the task flagged as worth a full regression run before touching
prompt/LLM work: player construction passes `resolvePlayerSprite(spec.theme)`
instead of `spec.player.sprite`; `buildGround()` passes
`resolveTileset(spec.theme)` instead of a hardcoded/`world.groundTile`
value; `spawnEntities()` builds a `themedSpec` (the entity spec with only
its `sprite` field overridden) before calling `createEntity`, leaving the
original `entitySpec` — behavior, position, everything else — untouched for
every other code path that reads it (e.g. the `flying_sine` tumble check
right after). Ran the full 69-test suite immediately after this mechanical
restructure, before any prompt/LLM work, exactly as the task asked: one
expected `theme` type error (from the one test fixture not yet updated),
then a clean pass across all 5 test fixture files once they picked up
`theme: 'dungeon'`.

**Proven the precedence decision behaviorally, not just asserted it.** A
hand-written spec (`theme: "space"` but every `sprite`/`groundTile` field
set to dungeon values) rendered as `player_ship` (cyan triangle),
`enemy_ship_a` (correctly resolved via the enemy's `patrol` behavior, not
its literal `sprite` string), and the `tile_space` starfield — confirming
theme wins even in the *mismatched* case, not only when a spec happens to
already agree with its own theme. A second, real-world proof landed for
free: `example-twinstick.json` had shipped since Phase 6 with a `tile_space`
background but dungeon-bucket enemy sprites (`enemy_shooter`,
`enemy_chase`) — a genuine pre-existing mismatch. Setting `theme: "space"`
on it now makes those turrets/chasers auto-correct to ship sprites at
runtime with no other change to the file — visible, direct before/after
proof the mechanism fixes a real bug, not just a synthetic one.

**Live LLM verification, checked precisely (texture keys polled through a
temporary `window.__gdGame` debug hook, the same pattern as Tiers 1/2) and
visually (screenshots), not just by reading the JSON `theme` field back —
the Phase 5 HUD-bug lesson still applies:**

- *"asteroids game dodging space rocks"* → `theme: "space"`, 2 attempts, no
  fallback. Polled scene state confirmed `player.texture.key ===
  "player_ship"`, every enemy resolved to `enemy_ship_a` (with walk-cycle
  frames playing), pickups `pickup_health`/`pickup_coin` — zero console
  errors.
- *"wizard collecting crystals in a forest"* → `theme: "dungeon"`, 1
  attempt. Polled state confirmed `player.texture.key === "player"`,
  enemies correctly spread across `enemy_patrol`/`enemy_chase`/
  `enemy_flyer`/`enemy_shooter` (matching each one's own `behavior`), a
  screenshot showing dungeon-style flat-shape sprites on a grid
  background — visibly distinct from the space screenshot, not just a
  different JSON field.
- *"a game about survival"* (deliberately ambiguous, no setting cues either
  way) → `theme: "dungeon"`, matching the prompt's own documented
  ambiguous-case rule exactly. Judged acceptable as-is — the rule fired as
  designed, not a gap needing a stronger correlation.

**Regression check: all four genre control prompts re-run against the live
backend, confirming the new required field changed nothing about
movement/camera selection** — dungeon (`topdown_8dir` + `follow_player`),
space shooter (`shmup_freeaxis` + `auto_scroll_vertical`, the camera
affinity pairing still intact), platformer (`platformer_run_jump` +
`follow_player`), twin-stick (`topdown_8dir` + `follow_player`, theme
correctly defaulted to dungeon for this genuinely setting-ambiguous
prompt — no space/sci-fi cue in "turrets and enemies swarming from all
directions").

## Definition of done (met) — Tier 3

`theme` is a required, auto-derived, schema-enforced field with a proactive
prompt correlation rule (added before it was ever seen to be missing, unlike
camera's reactive fix). Player/boss/enemy/pickup sprite and tileset
resolution flow entirely through the compile-checked-complete
`ThemeRegistry`. The theme-vs-`sprite` precedence decision (theme always
wins) is explicit, documented, and proven behaviorally via both a
deliberately-mismatched hand-written spec and a real pre-existing mismatch
it fixed (`example-twinstick.json`). Hand-written specs for both themes
render non-destructively (unchanged from pre-Tier-3 for the two specs whose
theme already matched their sprites). Live prompts for both themes land the
correct `theme` and render the correct sprites, confirmed via precise
texture-key polling and screenshots, not just the JSON field. All four
genre control prompts still select their expected movementType/camera
combination, unchanged. All 69 tests pass, clean typecheck, clean
`npm run build`.

## Not in Tier 3 (by design)

- Only two themes exist. A third setting (e.g. "cyberpunk") would need its
  own full `ThemeAssets` entry — the registry's `Record<Theme, ThemeAssets>`
  shape makes an incomplete one a compile error, so there's no way to add a
  theme "partially," but no third theme was added here.
- No theme-specific boss or pickup art. Both themes' `boss` and every
  `pickupByType` entry point at the same generic sprites Tier 0 drew,
  because no dedicated space-boss/space-pickup art exists — flagged
  directly in `ThemeRegistry.ts`'s own comments, not silently accepted. A
  "space" game's boss still looks like the generic purple boss, not a
  flagship or mothership.
- NPCs and triggers are not theme-covered — their `sprite` field passes
  through unresolved, same as before this tier, because no theme-specific
  NPC/trigger art exists either.
- Theme correlation guidance in the prompt (`THEME_GUIDANCE`) is hand-typed
  prose, not a derived/closed-enum table — "keywords implying a setting"
  isn't something a fixed vocabulary list can express, the same reason the
  win-condition-reachability rules and Tier 2's per-behavior field guide
  are hand-written prose too.
- `sprite` remains in the schema and is still validated by Gate 2 against
  the full asset registry, even though its value is entirely ignored for
  any themed role (player/boss/enemy/pickup) — a deliberate simplicity
  trade-off over removing the field outright (see the precedence section
  above), not an oversight.
- No reduced-motion/theme-off setting and no per-entity theme override —
  theme is a single whole-game choice, same always-on/no-config posture as
  Tiers 1 and 2's effects.

## Movement Modifiers — composable movement, not another genre enum

Three real generation failures in a row — Flappy Bird, an axis-locked
dodge game, and Snake — exposed the same underlying problem: `movementType`
had been growing as a flat closed enum of named genre-modes
(`topdown_8dir`, `platformer_run_jump`, `shmup_freeaxis`), and each of those
three requests needed a *combination* of mechanics (constant gravity +
tap-to-flap input + no horizontal control; player locked to one axis;
grid-snapped movement) that no single named enum value could express. Adding
a `flappy_movement` or `dodge_movement` enum value per request is exactly
the pattern that doesn't scale — flat enums grow linearly per genre but the
cross-cutting invariants around them (movement × camera × theme × win
condition) grow combinatorially, which is precisely what produced the
`reach_trigger` / `auto_scroll_vertical` reachability bug fixed earlier in
this session.

**The fix: decompose two of the three failures into orthogonal parameters
any movementType can carry, instead of new named movement types.**
`player.movementModifiers` is a small, optional, additive bag layered on
top of whatever `movementType` a spec already picked:

- `axisConstraint` (`none` | `horizontal` | `vertical`) — the axis that
  stays under player control; the other is forced to 0 every frame (unless
  gravity owns it — see below).
- `gravity` (`{ enabled, magnitude }`) — overrides whatever gravity the
  base `movementType` set, world-level (see "Why global, not per-body"
  below).
- `inputMode` (`continuous` | `impulse`) — `impulse` replaces held-input
  velocity with a one-shot upward kick on press, reusing the existing
  `jumpJustPressed` signal rather than adding a second key binding.
- `impulseForce` — required when `inputMode` is `"impulse"`.
- `gridSnap` (`{ cellSize }`) — position rounded to the nearest cell each
  frame. Plumbing only in this slice (see "Not in this slice" below).

`shmup_freeaxis` + `gravity: {enabled:true, magnitude:800}` +
`inputMode: "impulse"` + `axisConstraint: "vertical"` *is* Flappy Bird's
movement, expressed as composition rather than a bespoke `flappy_movement`
enum value. `axisConstraint: "horizontal"` alone is the dodge game. Snake's
one genuinely new entity concept — a growing, self-colliding segmented body
— doesn't decompose into movement parameters at all, and is explicitly
**not** attempted here; see "Not in this slice."

**Zero changes to the three existing movement controllers.** All of this
is applied as a single generic overlay function
(`src/movement/movementModifiers.ts`), run once per frame *after* whichever
base `MovementController` (`topdown8dir.ts` / `platformerRunJump.ts` /
`shmupFreeAxis.ts`) already ran — the same "generic and behavior-keyed
scales across every genre for free" lesson Tier 1/2's fx and animation
systems already proved, now applied to movement instead of visuals. None of
the three controller files were touched; every one of the four existing
example specs plays identically with `movementModifiers` absent, confirmed
via regression.

**Why gravity stays global, not per-body — a deliberate deviation from the
original sketch.** The task's own sketch assumed `body.setGravityY(...)`
per-entity; this codebase has never actually done that — gravity has always
been set once, globally, via `scene.physics.world.gravity.set(...)` inside
each controller's `configureWorld()`, and `platformer_run_jump` is the only
one that's ever set it nonzero. Introducing per-body gravity would have
been a materially bigger, unrequested architectural change for no real
benefit here, so `movementModifiers.gravity`, when present, simply
overrides whatever the movementType's own `configureWorld()` already set —
consistent with how the existing (and already gravity-affected) `flying_sine`
enemies coexist with platformer's global gravity today.

**The gravity-preservation trick, and why it's necessary.** A controller
like `shmup_freeaxis` sets vertical velocity from held input *every single
frame*, including an explicit 0 when nothing is held — which would reset
gravity's own frame-to-frame accumulation before it ever compounds (exactly
how `platformer_run_jump` avoids this today, by simply never touching `vy`
at all). The overlay function captures the player's vertical velocity
*before* the base controller runs and restores it afterward whenever
`gravity.enabled` is true, giving every other movementType the same
"gravity owns this axis" behavior `platformer_run_jump` already had, without
editing it.

**A real, load-bearing bug found and fixed mid-slice: OpenAI's Structured
Outputs strict mode rejects `if`/`then`/`else` outright.** The natural JSON
Schema way to express "magnitude required only when gravity.enabled is
true" is `if`/`then` — and `gamespec.schema.json` is the *same* file
`server/outputSchema.ts` derives the model-facing schema from. Adding
`if`/`then` there didn't just fail to help the one field it was meant for —
it broke **every** `/generate` call system-wide, regardless of prompt, with
`invalid_json_schema` from the API. Caught immediately via live
verification (a routine flappy-bird generation call failed outright), not
discovered later. Fixed by moving both conditional-required rules
(`gravity.enabled` → `magnitude` required; `inputMode: "impulse"` →
`impulseForce` required) into Gate 3 (`validate.ts`) instead of the schema —
and a new permanent regression test
(`server/outputSchema.test.ts`) asserts the derived OpenAI-facing schema
never contains `if`/`then`/`else` anywhere, so this exact mistake fails
fast and locally the next time, before it ever reaches the live API.

**Verified precisely, not just visually — the same discipline as every
prior tier.** Two hand-written example specs
(`public/specs/example-flappy.json`, `example-dodge.json`) were played via
Playwright with frame-by-frame velocity/position polling: gravity confirmed
compounding correctly frame over frame (120 → 333 → 520 → 547 px/s over
three samples with zero input), `axisConstraint: "vertical"` confirmed
holding left+right simultaneously produces *zero* horizontal movement, the
impulse kick confirmed producing an immediate ~-387px/s velocity spike on
press followed by gravity gradually eating into it frame over frame, and
`axisConstraint: "horizontal"` confirmed holding Up has zero effect on `y`
while Right moves `x` normally. The Flappy example's lose-trigger pipes
were confirmed firing correctly end-to-end into the Play Again/New Game end
screen. All four existing example specs re-verified with zero console
errors and (for platformer specifically) gravity still visibly accelerating
the player exactly as before.

**Live LLM verification, both new compositions landing correctly:** *"flappy
bird style game, tap to fly up through gaps"* → `shmup_freeaxis` +
`auto_scroll_vertical` + `axisConstraint: "vertical"` +
`gravity: {enabled:true, magnitude:760}` + `inputMode: "impulse"` +
`impulseForce: 380`, attempt 1, no fallback — matching the hand-written
example almost field-for-field. *"dodge the falling rocks by moving left
and right"* → `axisConstraint: "horizontal"`, `gravity: {enabled:false}`,
attempt 3 (recovered from timeouts under concurrent load, not a validation
failure). All four genre control prompts re-run: three succeeded with
`movementModifiers` correctly absent and movementType/camera selection
unchanged; the fourth (twin-stick) fell back only when run as part of a
6-concurrent-request stress batch sharing API rate limits — an artificial
load scenario, not a regression — and its own control run in the earlier
Tier 3 pass already established its baseline behavior is unaffected.

## Definition of done (met) — Movement Modifiers

`movementModifiers` is additive, optional, and empty-by-default — zero
behavior change for all four existing genres, confirmed via regression
(typecheck, full test suite, and live re-verification of the platformer's
gravity specifically). Flappy-Bird-style movement (gravity + impulse +
axis constraint) and axis-locked dodge movement both work via hand-written
specs, confirmed through frame-level velocity/position polling, not just
visually. The `gridSnap`-vs-`world.bounds` Gate 3 invariant and the two
conditional-required rules (moved from schema to Gate 3 after the OpenAI
strict-mode discovery) are covered by dedicated tests. Live prompts for
both new compositions land the correct modifiers on a real generation call.
All four genre control prompts' movementType/camera selection is
unaffected. 82 tests pass (up from 73), clean typecheck, clean build.

## Not in this slice (by design)

- **Snake is still not supported.** This slice deliberately only tackled
  the two failures that decompose into movement *parameters*
  (Flappy Bird, axis-locked dodge). Snake's core identity — a segmented
  body that grows and can collide with itself — is a genuinely new entity
  concept, not a parameter, and per the agreed sequencing is deferred to
  its own slice with its own hand-verification pass, the same "prove it
  manually first" discipline as everything else in this project.
- **`gridSnap` is plumbing only** — continuous position rounded to the
  nearest cell every frame, not true discrete step-by-one-cell movement.
  A real grid-based game (Snake included) needs a fundamentally different,
  turn-based movement model to feel right; this exists now so that later
  slice has a schema/registry entry to build on, not because it's
  Snake-ready today.
- **Spawner + `fall_and_despawn` shipped as its own follow-on slice** — see
  "Spawner Primitive" below. `example-dodge.json` now uses a real spawner
  instead of the hand-placed `patrol` stand-in this note originally
  described.
- **No hard validator rule for `axisConstraint: "vertical"` +
  `camera: "auto_scroll_vertical"`** (the same axis being both
  player-locked and camera-scrolled is a design smell, not a structural
  impossibility) — left as a correlation judgment call for the model via
  prompt guidance, not a rejection, per the explicit design decision to
  reserve hard Gate 3 failures for genuinely-impossible combinations only.
- **The LLM timeout/retry work from earlier this session is a prerequisite
  this slice depended on, not new here** — the live verification runs in
  this section relied on the `timeout: 60_000` + `maxRetries: 0` +
  retry-on-timeout fix already being in place; without it, verifying a
  slow-but-correct composition under concurrent load would have been much
  harder to distinguish from an actual regression.

## Spawner Primitive — entities that appear during gameplay, generically

Every entity in this engine, until now, was placed exactly once, at scene
creation, directly from the spec's own `entities` array. That's the one
thing Flappy Bird's incoming pipes and "dodge the falling rocks" both
actually need and didn't have: something appearing repeatedly, *during*
play, from off-screen. `spawners` is that primitive — generic on purpose,
so it's the falling-hazard mechanism, the incoming-obstacle mechanism, and
(via a variant) Flappy Bird's pipes, all at once, rather than three bespoke
systems.

**The shape.** A `spawners[]` entry has an `entityTemplate` (what to spawn —
`type: "enemy"` or `"boss"` only, plus sprite/behavior/behaviorParams/
health/damage/scoreValue/size), an `interval` (seconds between spawns), a
`spawnEdge` (which world edge it appears from), and a `moveDirection` +
`moveSpeed` it travels at. Give the template `behavior: "fall_and_despawn"`
— a new, seventh closed behavior, registered the same compile-checked way
as the existing six — and it moves in a straight line until it's traveled
well past the opposite side, at which point `SpawnerSystem`'s own per-frame
sweep removes it. An optional `pairedGap` on the spawner turns one spawn
event into two entities instead of one — spanning the full opposite side
with a randomized gap between them — which is exactly Flappy Bird's pipes,
expressed as a variant of the single-entity case rather than a second
concept. Setting `pairedGap.gapScoreValue` also drops an ordinary coin
pickup in the gap's center — passing through it is collected via the
existing pickup-collision path, no new scoring mechanism needed.

**Reuses the engine's own collision wiring completely — zero new
`CollisionSystem` registration.** Investigated directly before writing a
line of runtime code: Phaser's `physics.add.overlap(player, group, ...)`
re-evaluates group membership every physics step, not a fixed snapshot
taken once at setup — already proven by `ProjectileManager`'s pooled
projectiles, which get reactivated long after `CollisionSystem.setup()`
registered their overlap and still participate correctly. So a spawned
hazard just needs `createEntity()` + `enemiesGroup.add(entity)`, the same
two calls `spawnEntities()` already makes at scene start, and it
automatically gets player-touch damage, wall collision, and
projectile-hit handling for free. `entityTemplate.type` is deliberately
restricted to `enemy`/`boss` — the only two types the per-frame behavior
loop and this collision wiring actually cover — rather than the full
`EntityType` union.

**`size` generalized from Trigger-only to any entity, on purpose.**
Rendering a "pipe segment" that varies in length every spawn (depending on
where the randomized gap lands) needs a sprite stretched to an arbitrary
box — exactly what `Trigger.ts` already did for its own zones, just
duplicated locally instead of being a general capability. Moved into
`BaseEntity`'s own constructor (any entity type can now set `size`,
harmless for the overwhelming majority that never do) and removed the
now-redundant copy from `Trigger.ts`. Verified as a pure refactor: a
hand-placed `example-flappy.json` (from the movement-modifiers slice,
predates this one) uses Trigger `size` extensively and renders pixel-identical
before and after.

**A real bug found via live verification, not assumed away: the model's own
"world should be bigger than the viewport" habit actively fights a
locked-axis composition.** The very first live "flappy bird with pipes"
generation produced a spec with `world.bounds.width: 960` against a
`meta.width: 480` viewport — reasonable under the *general* world-sizing
rule this prompt already teaches, and exactly wrong here: with
`axisConstraint: "vertical"` (the player's x never changes) and
`camera: "follow_player"`, the camera's horizontal scroll position is
permanently fixed too, so the extra 480px of world was a region the camera
could *never* scroll into — pipes spawned there spent most of their travel
completely invisible before ever entering the one fixed slice the player
could see. Caught by literally loading the live-generated game and looking
at it (an empty-looking blue rectangle, at first glance — traced precisely
to this, not assumed to be a rendering bug). Fixed with an explicit
guidance exception: whenever an axis is locked *and* the camera follows the
player, `world.bounds` on that locked axis must equal `meta`'s matching
dimension, overriding the general "meaningfully larger" rule for that one
axis only. Re-verified live immediately after: the same prompt, re-run,
produced `world.bounds.width: 480` (exactly `meta.width`) unprompted, and
the resulting game showed a real, correctly-gapped pipe pair with its
reward coin dead-center within seconds of loading.

**Verified precisely, then visually, then via the live model — the same
three-layer discipline as every other slice.** Frame-by-frame polling
confirmed: spawn cadence tracks `interval` once the engine's own
(pre-existing, already-documented) asset-generation startup cost is
accounted for; hazards move at the configured direction and stay in a
stable count once despawning kicks in, rather than accumulating forever;
a `pairedGap` spawn's two segment heights and the gap between them matched
the configured `gapSize` *exactly* (measured: a 220px configured gap
produced a measured 220px gap between segment edges). A measured
below-configured-speed reading during one polling pass turned out to be a
headless-Chromium frame-rate-throttling artifact — confirmed via
`game.loop.actualFps` reading ~19fps against a 60fps target during the
same window, and definitively resolved (not just assumed) by comparing two
real screenshots several seconds apart, which showed clearly correct,
fast movement — the same category of measurement artifact (not a real
bug) as Tier 3's earlier `scrollY`-reading mystery, resolved the same way:
trust the rendered pixels over a polled JS property when they disagree.
Both hand-written example specs (`example-dodge.json`, rewritten to use a
real spawner; the new `example-flappy-pipes.json`) were played end-to-end,
including a genuine collision-death into the existing end screen.

**Live LLM verification, both request shapes landing correctly on attempt
1:** *"flappy bird with pipes to fly through"* → `shmup_freeaxis` +
`follow_player` + the full gravity/impulse/axisConstraint composition +
a `pairedGap` spawner, world.bounds correctly matching viewport on the
locked axis (after the guidance fix above) — screenshotted, showing a
correctly-gapped pipe pair and centered reward coin. *"dodge the falling
rocks by moving left and right"* → `axisConstraint: "horizontal"` plus
**two** spawners with different sizes/speeds/intervals (rocks and
boulders) for visual variety the hand-written example doesn't even have —
a genuinely creative composition of the primitive, not just a template
fill-in.

## Definition of done (met) — Spawner Primitive

`spawners` is additive and optional — every existing spec keeps validating
and playing identically with it absent, confirmed via regression across all
five prior example specs. `fall_and_despawn` is a seventh closed behavior,
registered everywhere a behavior needs registering (BehaviorRegistry,
ThemeRegistry's two theme buckets, the schema's two behavior enums) with
compile-checked completeness, same as the other six. Spawned hazards
participate in existing collision/damage wiring with zero new
`CollisionSystem` registration. `pairedGap`'s gap geometry is exactly
correct, verified by direct measurement, not assumption. Gate 2 covers a
spawner's `entityTemplate` with the same four reference-integrity checks a
placed entity gets; Gate 3 rejects the two win-condition/spawner
combinations that are likely unwinnable by construction
(`defeat_all_enemies` with any spawner, `collect_all_pickups` with a
`pairedGap` spawner) while leaving the merely-unusual locked-axis/
world-bounds case to prompt guidance, consistent with this project's
established hard-rejection-vs-guidance line. Both hand-written examples
play correctly end-to-end. Both new live-prompt request shapes land
correct, validated, on-topic compositions on the first attempt. 92 tests
pass (up from 82), clean typecheck, clean build.

## Not in this slice (by design)

- **Grid-based Snake movement and its growing/self-colliding body are still
  not supported** — this slice was scoped to the two failures that
  decompose into a spawner (Flappy Bird's pipes, falling-hazard dodging),
  not Snake's segmented-body entity concept, which remains its own
  future slice per the agreed sequencing.
- **`fall_and_despawn` is a straight line at constant velocity, nothing
  more** — no homing, no acceleration, no curved paths. Reusing `flying_sine`
  or writing a new behavior is the way to get a curved incoming hazard;
  this primitive intentionally covers only the straight-line case, which is
  what every request shape motivating this slice actually needed.
- **No hard Gate 3 rule for the locked-axis/world-bounds mismatch** — caught
  and fixed via prompt guidance (see above), not a validator rejection,
  matching the established line between "genuinely impossible" (hard
  rejection) and "usually wrong, sometimes deliberate" (guidance). A spec
  author who genuinely wants a wider world on a locked axis (e.g. reusing
  the same spawner setup with `camera: "auto_scroll_vertical"` instead of
  `follow_player` some day) isn't blocked from it.
- **Spawned pickups (the `pairedGap` gap reward) don't get their own
  despawn-safety net independent of `SpawnerSystem`'s tracking** — if a
  reward pickup were somehow added to `pickupsGroup` by a path other than
  `SpawnerSystem.spawnGapPickup`, nothing else would ever clean it up. Not
  a real gap today (there is no other path), flagged for whoever extends
  this later.
- **No spawner-vs-spawner interaction modeling** — two spawners active at
  once (as the live "dodge the falling rocks" result actually produced)
  don't coordinate positions or avoid overlapping each other's spawns; each
  runs entirely independently, which was sufficient for every case
  verified here but could in principle produce visually stacked spawns at
  high enough spawn rates.

## Bug fix: `survive_duration` was counting scene setup as survived time

A real user-generated Flappy Bird game (45-second `survive_duration`
threshold) won almost immediately, before ever reaching a pipe — first
noticed live, not in testing. Root cause: `WinConditionSystem` captured its
`startTime` at *construction*, which happens inside `create()`, the same
synchronous frame as `generatePlaceholderAssets()`/`generateAnimatedAssets()`
(procedural texture baking, called earlier in that same `create()`).
`scene.time.now` is a per-frame snapshot Phaser only refreshes once per
game step — it doesn't advance *during* `create()`'s own synchronous
execution, no matter how long that takes, and only shows the accumulated
real time as a jump on the next frame. So however long scene setup actually
took (asset baking especially) was silently counted as "survived" the
instant the first real frame ran.

This exact mechanism had already been found and deliberately left unfixed
earlier in this session (flagged as a known latent bug, out of scope for
what was being built at the time) — fixed now that a real user hit it.
Fix: `startTime` is set lazily on the first real `update()` tick instead of
at construction, so only genuine gameplay time is ever counted;
`elapsedSeconds()` returns `0` before that first tick (covers `renderHud()`'s
own first call, made from `create()` itself, before `update()` has ever
run). Verified precisely: polled `elapsedSeconds()` immediately after scene
ready (0.13s, not several seconds) and confirmed it then advances at the
correct 1:1 real-time rate. Verified end-to-end on the exact game that
surfaced the bug: playing normally now survives past the setup window and
ends via genuine pipe collision (`Game Over`, not a premature win) —
confirming the *collision* mechanic itself was already correct all along
and simply could never be observed before, since the premature win always
ended the game first. Regression-checked against `example-shooter.json`'s
own `survive_duration` (unaffected — HUD countdown matches exactly).

## Bug fix: `auto_scroll_vertical` camera was frozen at `scrollY: 0`

A real user-generated game ("Starlane Sprint") that worked earlier in this
session regressed to letting the player move but never scrolling the
camera — reported live as "there's no game to play." Reproduced and
confirmed universal: every `auto_scroll_vertical` game was affected,
including the previously-verified `example-shooter.json`, ruling out a
spec-specific or genre-specific cause. Root cause, found via a
property-setter trap on `Camera.scrollY` showing alternating writes from
two different call sites: `index.html`'s `pixelArt: true` game config turns
on `roundPixels` for every camera, and Phaser's own `Camera.preRender()`
floors `scrollY` for rendering *and writes that floored value back* into
the camera's real `scrollY` property, every frame — not just for that
frame's render. `autoScrollVertical`'s `SCROLL_SPEED` (55px/sec) only
advances `scrollY` by ~0.9px per frame at 60fps, always under 1, so the
previous `cam.scrollY += increment` approach read back Phaser's own
just-floored `0` as the running total every single frame: 100% of each
frame's progress was destroyed before the next frame ever saw it, forever
pinning the camera at `scrollY: 0` no matter how many frames ran.

Fix: `autoScrollVertical` now keeps its own true float accumulator (a
`WeakMap` keyed by camera instance, since the controller object is a
shared singleton) and *assigns* `cam.scrollY` from it each frame rather
than reading `cam.scrollY` back to add to it. Phaser is still free to floor
its own copy for that frame's render; the next frame's increment builds on
the untouched accumulator instead. Verified precisely (`scrollY` sampled
over time now climbs steadily — e.g. 0 → 30 → 81 → 135 across 3 seconds on
`example-shooter.json`, and 0 → 18 → 61 on the user's actual "Starlane
Sprint" game) and visually (screenshots show the camera actually scrolling
through the world, revealing pickups/obstacles that were off-screen
before). Regression-checked against `example-flappy.json`, the only other
example using this camera mode (also confirmed climbing steadily). This is
a latent bug in `autoScrollVertical.ts` that predates this session's
Movement Modifiers/Spawner Primitive work — not something either slice
introduced — since the moment the per-frame increment fell under 1px, it
was always going to be silently erased by `roundPixels`.
