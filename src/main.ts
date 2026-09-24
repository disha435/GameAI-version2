import Phaser from 'phaser';
import { SceneInterpreter } from './spec/SceneInterpreter';
import type { GameSpec } from './spec/types';
import { validateGameSpec } from './spec/validate';
import { deriveInstructions } from './ui/deriveInstructions';

// Local-dev assumption: the backend from server/ runs on this fixed port.
// Revisit with a real config mechanism if this ever needs to point anywhere
// else (a deployed API, a different port).
const BACKEND_URL = 'http://localhost:8787';

const EXAMPLE_PROMPT =
  'a tiny wizard collecting magic crystals while avoiding goblins, with a dragon boss at the end';

// ---------------------------------------------------------------------------
// Router: "/" is the landing/creation view, "/games/:id" is the play+edit
// view. ?spec=<name> is a third, backend-free debug mode that can appear at
// either path (checked first) — it's how Phase 0/1 development worked
// before there was a backend to talk to at all.
// ---------------------------------------------------------------------------

type Route = { kind: 'landing' } | { kind: 'game'; gameId: string } | { kind: 'static'; specName: string };

function resolveRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const specName = params.get('spec');
  if (specName) return { kind: 'static', specName };

  const match = window.location.pathname.match(/^\/games\/([^/]+)\/?$/);
  if (match) return { kind: 'game', gameId: decodeURIComponent(match[1]) };

  return { kind: 'landing' };
}

// Pushes the URL only — does not itself fetch/boot anything. Used right
// after a fresh /generate response, which already carries the spec we need;
// going through the generic dispatchRoute() there would mean throwing that
// away and immediately re-fetching the same game.
function pushGameUrl(gameId: string): void {
  window.history.pushState(null, '', `/games/${gameId}`);
}

// ---------------------------------------------------------------------------
// Shared game-boot plumbing
// ---------------------------------------------------------------------------

// The game currently on screen, if any — reset on every route change.
let activeGameId: string | null = null;
let currentVersionId: string | null = null;
let activeGame: Phaser.Game | null = null;

// Set right before navigating away from a fresh /generate success, so the
// play view's first render can show an honest "took N attempts" / fallback
// summary instead of the outcome silently landing nowhere once the URL
// changes out from under the landing page's own status line.
let pendingGenerationOutcome: { attemptCount: number; usedFallback: boolean } | null = null;

let lastPrompt: string | null = null;
let lastEditInstruction: string | null = null;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

function showLandingView(): void {
  el('landing-view').hidden = false;
  el('play-view').hidden = true;
}

function showPlayView(): void {
  el('landing-view').hidden = true;
  el('play-view').hidden = false;
}

type GameStageState = 'loading' | 'error' | 'lobby' | 'ready';

function setGameStageState(state: GameStageState): void {
  el('game-loading').hidden = state !== 'loading';
  el('game-fatal-error').hidden = state !== 'error';
  el('game-lobby').hidden = state !== 'lobby';
  el('canvas-wrap').hidden = state !== 'ready';
}

// Shows derived controls/objective and waits for an explicit Play click
// before anything is booted — a fresh Phaser.Game (with input listeners,
// physics, etc.) doesn't exist yet at this point, only the validated spec.
// Reused across every entry path (generate, direct /games/:id load, static
// ?spec= debug mode) via enterLobby() below; version preview/rollback and
// post-edit reboots skip this deliberately — the player is already mid
// session there, so re-showing a Play gate would just be friction.
function showLobby(spec: GameSpec, onPlay: () => void): void {
  const instructions = deriveInstructions(spec);
  el('lobby-title').textContent = spec.meta.title;
  el('lobby-objective').textContent = instructions.objective;
  const list = el<HTMLUListElement>('lobby-controls');
  list.innerHTML = '';
  for (const line of instructions.controls) {
    const li = document.createElement('li');
    li.textContent = line;
    list.appendChild(li);
  }
  // Reassigning .onclick (not addEventListener) is deliberate: this element
  // is reused across every game the tab ever shows, so a fresh assignment
  // here can never stack listeners from a previous game's lobby.
  el<HTMLButtonElement>('lobby-play-btn').onclick = onPlay;
}

function enterLobby(spec: GameSpec): void {
  setGameStageState('lobby');
  showLobby(spec, () => {
    setGameStageState('ready');
    bootGame(spec);
  });
}

function hideEndScreen(): void {
  el('game-end-overlay').hidden = true;
}

function showEndScreen(kind: 'win' | 'lose', spec: GameSpec): void {
  const headline = el('end-headline');
  headline.textContent = kind === 'win' ? 'You Win!' : 'Game Over';
  headline.className = kind;
  el('end-objective-recap').textContent = deriveInstructions(spec).objective;
  el<HTMLButtonElement>('end-play-again-btn').onclick = () => bootGame(spec);
  el('game-end-overlay').hidden = false;
}

function showEditControls(visible: boolean): void {
  el('edit-bar-wrap').hidden = !visible;
  el('history-sidebar').hidden = !visible;
  el('history-toggle-btn').hidden = !visible;
}

function bootGame(spec: GameSpec): void {
  // Loading another version (preview or post-rollback) replaces whatever is
  // currently playing. Without tracking this, each load would stack another
  // Phaser instance/canvas inside #app on top of the last one.
  activeGame?.destroy(true);
  setGameStageState('ready');
  hideEndScreen(); // clear a stale win/lose overlay from whatever was playing before

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'app',
    width: spec.meta.width,
    height: spec.meta.height,
    backgroundColor: spec.world.backgroundColor,
    pixelArt: true,
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
  });
  activeGame = game;
  // Added with autoStart + initial data directly, rather than starting a
  // scene declared in the game config, to avoid a race between Phaser's own
  // auto-start of the first configured scene and a manual .start().
  // The end-screen hook travels through init data (onGameEnd), not the
  // return value of .add() — that return value is null whenever the
  // SceneManager isn't booted yet, which it reliably isn't at this exact
  // point, so a scene.events.on(...) wired off it here would silently never
  // fire.
  game.scene.add('SceneInterpreter', SceneInterpreter, true, {
    spec,
    onGameEnd: (result: 'win' | 'lose') => showEndScreen(result, spec),
  });
}

function showFatalError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  el('game-fatal-error').textContent = `Failed to load game.\n\n${message}`;
  setGameStageState('error');
}

// Dev/debug path: ?spec=<name> loads public/specs/<name>.json directly,
// bypassing the prompt UI and the backend entirely — useful for iterating
// on the runtime itself without spending an LLM call every time. No gameId
// exists here, so the edit bar and history sidebar have nothing to attach
// to and stay hidden.
async function runStaticSpecMode(name: string): Promise<void> {
  setGameStageState('loading');
  showEditControls(false);
  const res = await fetch(`/specs/${name}.json`);
  if (!res.ok) throw new Error(`Failed to load spec "${name}": HTTP ${res.status}`);
  const json = await res.json();
  const { valid, errors } = validateGameSpec(json);
  if (!valid) {
    throw new Error(`Spec "${name}" failed validation:\n- ${errors.map((e) => `${e.path}: ${e.message}`).join('\n- ')}`);
  }
  el('game-title').textContent = (json as GameSpec).meta.title;
  enterLobby(json as GameSpec);
}

// ---------------------------------------------------------------------------
// Backend response shapes
// ---------------------------------------------------------------------------

interface GenerateResponse {
  gameId: string;
  versionId: string;
  versionNumber: number;
  spec: GameSpec;
  usedFallback: boolean;
  attemptCount: number;
  error?: string;
}

interface GameResponse {
  gameId: string;
  title: string;
  currentVersion: { versionNumber: number; spec: GameSpec; createdAt: string } | null;
  error?: string;
}

type EditSourceKind = 'deterministic' | 'llm_patch';

interface VersionSummary {
  versionId: string;
  versionNumber: number;
  source: 'generate' | 'edit' | 'rollback';
  editSource: EditSourceKind | null;
  prompt: string | null;
  createdAt: string;
  attemptCount: number;
  usedFallback: boolean;
}

interface VersionDetail {
  specJson: GameSpec;
  error?: string;
}

interface EditResponse {
  gameId: string;
  spec: GameSpec;
  changed: boolean;
  versionId?: string;
  versionNumber?: number;
  editSource?: EditSourceKind;
  attemptCount?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Generation-outcome banner (play view) — honest, not a fake progress bar:
// it only ever states what the response actually said (attempts taken,
// whether the fallback template was used), never a live blow-by-blow of
// server-side attempts we have no way to observe without streaming.
// ---------------------------------------------------------------------------

function hideGenerationBanner(): void {
  el('generation-banner').hidden = true;
}

function renderGenerationBanner(outcome: { attemptCount: number; usedFallback: boolean }): void {
  const banner = el('generation-banner');
  const text = el<HTMLSpanElement>('generation-banner-text');
  const closeBtn = el<HTMLButtonElement>('generation-banner-close');
  const attempts = `${outcome.attemptCount} attempt${outcome.attemptCount === 1 ? '' : 's'}`;

  banner.hidden = false;
  if (outcome.usedFallback) {
    banner.className = 'notice';
    text.textContent = `Couldn't quite build that after ${attempts} — here's a starter game instead. Try describing it differently?`;
    closeBtn.hidden = false;
    return;
  }

  closeBtn.hidden = true;
  banner.className = 'ok';
  if (outcome.attemptCount > 1) {
    text.textContent = `Ready! Took ${attempts} to validate.`;
    setTimeout(hideGenerationBanner, 2200);
  } else {
    text.textContent = 'Ready!';
    setTimeout(hideGenerationBanner, 1200);
  }
}

// ---------------------------------------------------------------------------
// Presenting a game (booting its spec + wiring the game-specific controls)
// ---------------------------------------------------------------------------

function presentGame(gameId: string, spec: GameSpec): void {
  activeGameId = gameId;
  el('game-title').textContent = spec.meta.title;
  enterLobby(spec);
  showEditControls(true);
  void loadVersionList();
}

// Route-entry path (direct load of /games/:id, or back/forward navigation):
// fetches the game's current version and boots it — "reload a game later
// and get the same spec back."
async function loadGame(gameId: string): Promise<void> {
  setGameStageState('loading');
  showEditControls(false);
  const res = await fetch(`${BACKEND_URL}/games/${gameId}`);
  const body = (await res.json()) as GameResponse;
  if (!res.ok || !body.currentVersion) {
    throw new Error(body.error ?? `Failed to load game "${gameId}" (HTTP ${res.status})`);
  }
  presentGame(gameId, body.currentVersion.spec);
  hideGenerationBanner();
}

// ---------------------------------------------------------------------------
// Version history sidebar
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function describeVersion(v: VersionSummary): string {
  if (v.source === 'rollback') return 'Rolled back';
  if (v.source === 'generate') return 'Generated';
  if (v.editSource === 'deterministic') return 'Edited (instant)';
  if (v.editSource === 'llm_patch') return 'Edited (AI-adjusted)';
  return 'Edited';
}

// Renders the version list as a readable story — "generated → made enemies
// faster (instant) → asked for a shield (AI-adjusted) → rolled back" — not
// just a flat log of raw column values.
async function loadVersionList(): Promise<void> {
  const list = el<HTMLUListElement>('version-list');
  if (!activeGameId) return;

  const res = await fetch(`${BACKEND_URL}/games/${activeGameId}/versions`);
  if (!res.ok) {
    list.innerHTML = '<li>Failed to load version history.</li>';
    return;
  }
  const versions = (await res.json()) as VersionSummary[];
  // Server returns versions ordered by versionNumber desc, so [0] (the
  // highest version_number) is always the current one.
  currentVersionId = versions.length > 0 ? versions[0].versionId : null;

  list.innerHTML = '';
  for (const v of versions) {
    const li = document.createElement('li');
    li.className = 'version-row' + (v.versionId === currentVersionId ? ' is-current' : '');

    const headline = document.createElement('div');
    headline.className = 'version-row-headline';
    headline.append(`v${v.versionNumber}`);

    const badge = document.createElement('span');
    badge.className = 'version-row-badge' + (v.editSource ? ` ${v.editSource}` : '');
    badge.textContent = describeVersion(v);
    headline.appendChild(badge);

    if (v.usedFallback) {
      const fallbackBadge = document.createElement('span');
      fallbackBadge.className = 'version-row-badge fallback';
      fallbackBadge.textContent = 'fallback used';
      headline.appendChild(fallbackBadge);
    }
    li.appendChild(headline);

    const meta = document.createElement('div');
    meta.className = 'version-row-meta';
    meta.textContent = `${v.attemptCount} attempt${v.attemptCount === 1 ? '' : 's'} — ${formatTimestamp(v.createdAt)}`;
    li.appendChild(meta);

    if (v.prompt) {
      const promptEl = document.createElement('div');
      promptEl.className = 'version-row-prompt';
      promptEl.textContent = `"${v.prompt}"`;
      li.appendChild(promptEl);
    }

    const actions = document.createElement('div');
    actions.className = 'version-row-actions';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.textContent = 'Load';
    loadBtn.title = 'Preview this version without changing what is current';
    loadBtn.addEventListener('click', () => void previewVersion(v.versionId));
    actions.appendChild(loadBtn);

    const rollbackBtn = document.createElement('button');
    rollbackBtn.type = 'button';
    rollbackBtn.textContent = 'Rollback to this';
    rollbackBtn.disabled = v.versionId === currentVersionId;
    rollbackBtn.addEventListener('click', () => void rollbackToVersion(v.versionId));
    actions.appendChild(rollbackBtn);

    li.appendChild(actions);
    list.appendChild(li);
  }
}

// Read-only preview: boots a historical version's spec without touching
// which version the game considers current server-side.
async function previewVersion(versionId: string): Promise<void> {
  if (!activeGameId) return;
  const res = await fetch(`${BACKEND_URL}/games/${activeGameId}/versions/${versionId}`);
  const body = (await res.json()) as VersionDetail;
  if (!res.ok) {
    window.alert(body.error ?? 'Failed to load that version.');
    return;
  }
  bootGame(body.specJson);
  el('game-title').textContent = body.specJson.meta.title;
}

// Appends a new version copying the target's spec forward and repoints
// current_version_id at it server-side — then reboots with the result and
// refreshes the panel so the new row (and its "current" highlight) shows up.
async function rollbackToVersion(toVersionId: string): Promise<void> {
  if (!activeGameId) return;
  const res = await fetch(`${BACKEND_URL}/games/${activeGameId}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toVersionId }),
  });
  const body = (await res.json()) as { spec: GameSpec; error?: string };
  if (!res.ok) {
    window.alert(body.error ?? 'Failed to roll back.');
    return;
  }
  bootGame(body.spec);
  el('game-title').textContent = body.spec.meta.title;
  await loadVersionList();
}

function setupHistorySidebar(): void {
  // Only relevant on the narrow-layout media query — see index.html's CSS.
  // On a normal monitor the sidebar is always visible and this button is
  // display:none, but the click handler is harmless to keep wired either way.
  el('history-toggle-btn').addEventListener('click', () => {
    const sidebar = el('history-sidebar');
    sidebar.hidden = !sidebar.hidden;
  });
  el('generation-banner-close').addEventListener('click', hideGenerationBanner);
}

// ---------------------------------------------------------------------------
// Edit bar
// ---------------------------------------------------------------------------

// A 200 response is always a genuine EditResponse (changed true or false);
// a non-2xx response (400/404/500) or a network failure is just an error
// string with no spec/gameId to speak of — kept as a separate case rather
// than faking the rest of EditResponse's shape to fit it.
type EditOutcome = { kind: 'success'; body: EditResponse } | { kind: 'error'; message: string };

function renderEditOutcome(outcome: EditOutcome): void {
  const status = el('edit-status');
  const retryBtn = el<HTMLButtonElement>('edit-retry-btn');
  status.hidden = false;

  if (outcome.kind === 'error') {
    status.className = 'error';
    status.textContent = outcome.message;
    retryBtn.hidden = false;
    return;
  }

  const { body } = outcome;
  if (!body.changed) {
    status.className = 'error';
    status.textContent = body.error ?? "That edit didn't take effect.";
    retryBtn.hidden = false;
    return;
  }

  retryBtn.hidden = true;
  status.className = 'ok';
  if (body.editSource === 'deterministic') {
    status.textContent = '⚡ Applied instantly';
  } else if (body.editSource === 'llm_patch') {
    const attempts = body.attemptCount ?? 1;
    status.textContent = `✨ AI-adjusted (${attempts} attempt${attempts === 1 ? '' : 's'})`;
  } else {
    status.textContent = 'Applied.';
  }
  setTimeout(() => {
    status.hidden = true;
  }, 3500);
}

// The Phase 4 milestone with Phase 5's honest feedback layered on top: an
// instruction against an existing game produces a new version, resolved as
// cheaply as possible server-side, and the UI tells you which path it took
// — not just "something happened."
function setupEditBar(): void {
  const input = el<HTMLInputElement>('edit-input');
  const btn = el<HTMLButtonElement>('edit-btn');
  const retryBtn = el<HTMLButtonElement>('edit-retry-btn');

  const submitEdit = async (instruction: string) => {
    if (!instruction || !activeGameId) return;
    lastEditInstruction = instruction;
    btn.disabled = true;
    retryBtn.hidden = true;
    el('edit-status').hidden = true;

    try {
      const res = await fetch(`${BACKEND_URL}/games/${activeGameId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      });

      if (!res.ok) {
        const errorBody = (await res.json()) as { error?: string };
        renderEditOutcome({ kind: 'error', message: errorBody.error ?? `Server error (HTTP ${res.status}).` });
        return;
      }

      const body = (await res.json()) as EditResponse;
      renderEditOutcome({ kind: 'success', body });
      if (body.changed) {
        input.value = '';
        bootGame(body.spec);
        el('game-title').textContent = body.spec.meta.title;
        await loadVersionList();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      renderEditOutcome({ kind: 'error', message: `Couldn't reach the backend (${message}).` });
    } finally {
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', () => void submitEdit(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submitEdit(input.value.trim());
  });
  retryBtn.addEventListener('click', () => {
    if (lastEditInstruction) void submitEdit(lastEditInstruction);
  });
}

// ---------------------------------------------------------------------------
// Landing view (the "/" creation flow)
// ---------------------------------------------------------------------------

// Circumference of #progress-ring's circle (r=34): 2 * PI * 34.
const PROGRESS_RING_CIRCUMFERENCE = 213.63;
// How much of the fill is "free" to animate toward on its own — deliberately
// short of 100%. There's no real per-step progress to report (a single
// opaque LLM call — see the honesty note below), so this is presented as
// what it is: an approximation that gets closer but doesn't claim to know
// the exact finish time. Only the real response arriving ever completes it.
const PROGRESS_ASYMPTOTE = 0.93;
// Controls how fast the approach happens — roughly the time (seconds) to
// reach ~63% of the asymptote, tuned against this app's own observed
// generation times (typically single-digit seconds to under a minute).
const PROGRESS_TIME_CONSTANT_SEC = 9;

function setupLandingView(): void {
  const input = el<HTMLTextAreaElement>('prompt-input');
  const status = el('prompt-status');
  const generateBtn = el<HTMLButtonElement>('generate-btn');
  const exampleBtn = el<HTMLButtonElement>('example-btn');
  const retryBtn = el<HTMLButtonElement>('prompt-retry-btn');
  const actionsRow = el('prompt-actions');
  const progressWrap = el('generate-progress');
  const progressRingFill = document.querySelector<SVGCircleElement>('#progress-ring .ring-fill')!;
  const progressLabel = el('progress-label');

  const setStatus = (text: string, kind: 'loading' | 'error' | 'notice' | null) => {
    status.hidden = !text;
    status.textContent = text;
    status.className = kind ?? '';
  };

  const setRingProgress = (fraction: number) => {
    progressRingFill.style.strokeDashoffset = String(PROGRESS_RING_CIRCUMFERENCE * (1 - fraction));
  };

  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let progressStart = 0;

  const startProgressRing = () => {
    actionsRow.hidden = true;
    progressWrap.classList.remove('done');
    progressWrap.classList.add('active');
    progressLabel.textContent = 'Building your game…';
    setRingProgress(0);
    progressStart = performance.now();
    progressTimer = setInterval(() => {
      const elapsedSec = (performance.now() - progressStart) / 1000;
      const fraction = PROGRESS_ASYMPTOTE * (1 - Math.exp(-elapsedSec / PROGRESS_TIME_CONSTANT_SEC));
      setRingProgress(fraction);
    }, 120);
  };

  const stopProgressRing = () => {
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    progressWrap.classList.remove('active', 'done');
    actionsRow.hidden = false;
  };

  // Only called on real success — fills the rest of the way, holds for a
  // beat so completing the ring actually reads as "done" rather than
  // flickering past, then hands off to the caller (which navigates).
  const finishProgressRing = (): Promise<void> => {
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    progressLabel.textContent = 'Ready!';
    progressWrap.classList.add('done');
    setRingProgress(1);
    return new Promise((resolve) => setTimeout(resolve, 450));
  };

  const setBusy = (busy: boolean) => {
    generateBtn.disabled = busy;
    exampleBtn.disabled = busy;
  };

  exampleBtn.addEventListener('click', () => {
    input.value = EXAMPLE_PROMPT;
    input.focus();
  });

  const submit = async (prompt: string) => {
    if (!prompt) {
      setStatus('Type a short description of the game you want first.', 'error');
      return;
    }
    lastPrompt = prompt;
    retryBtn.hidden = true;
    setBusy(true);
    startProgressRing();
    // Honest about what's actually happening server-side (LLM call, then
    // validation, with up to two automatic retries) without pretending to
    // show live per-attempt progress we have no way to observe without
    // streaming — see README's Phase 5 section for why. The ring above is
    // the same honesty applied visually: it approaches full but never
    // promises an exact finish time either.
    setStatus(
      'This can take a while — the server validates the result and retries automatically if the first attempt doesn’t pass.',
      'loading',
    );

    try {
      const res = await fetch(`${BACKEND_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const body = (await res.json()) as GenerateResponse;

      if (!res.ok) {
        stopProgressRing();
        setStatus(body.error ?? `Server error (HTTP ${res.status}). Is the backend running (npm run server)?`, 'error');
        retryBtn.hidden = false;
        setBusy(false);
        return;
      }

      await finishProgressRing();
      pendingGenerationOutcome = { attemptCount: body.attemptCount, usedFallback: body.usedFallback };
      pushGameUrl(body.gameId);
      showPlayView();
      presentGame(body.gameId, body.spec);
      renderGenerationBanner(pendingGenerationOutcome);
      pendingGenerationOutcome = null;
    } catch (err) {
      stopProgressRing();
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Couldn't reach the backend at ${BACKEND_URL} (${message}). Is it running? (npm run server)`, 'error');
      retryBtn.hidden = false;
      setBusy(false);
    }
  };

  generateBtn.addEventListener('click', () => void submit(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(input.value.trim());
  });
  retryBtn.addEventListener('click', () => {
    if (lastPrompt) void submit(lastPrompt);
  });
}

// ---------------------------------------------------------------------------
// Route dispatch
// ---------------------------------------------------------------------------

function resetPlayViewState(): void {
  activeGameId = null;
  currentVersionId = null;
  activeGame?.destroy(true);
  activeGame = null;
  hideGenerationBanner();
  hideEndScreen();
  el('edit-status').hidden = true;
  el('edit-retry-btn').hidden = true;
}

function dispatchRoute(): void {
  const route = resolveRoute();

  if (route.kind === 'landing') {
    resetPlayViewState();
    showLandingView();
    return;
  }

  resetPlayViewState();
  showPlayView();

  if (route.kind === 'static') {
    runStaticSpecMode(route.specName).catch(showFatalError);
  } else {
    loadGame(route.gameId).catch(showFatalError);
  }
}

setupLandingView();
setupEditBar();
setupHistorySidebar();
window.addEventListener('popstate', dispatchRoute);
dispatchRoute();
