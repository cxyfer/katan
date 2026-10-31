# Procedural sound effects and generative music

## Scope

The table had no sound. The request: research how to produce game audio, then
design and ship event sounds and background audio. Starting snapshot:
`origin/master` at `d940bc0`, worktree `.worktrees/game-audio` on
`feat/game-audio`.

## Research and decision

| Option | Cost | Fit |
|---|---|---|
| Recorded files + Howler | ~9 kB library plus ~720 kB per minute of 96 kbps music; licensing per asset | Best realism, but every sound is a download and a licence to track |
| Tone.js | ~51 kB brotli for a minimal app | Full synthesis framework; far more than a board game needs |
| ZzFX / ZzFXM | < 1 kB | One oscillator voice per sound, tracker-style music; too limited for bells, brass and an ocean bed |
| **Own Web Audio synthesis (chosen)** | ~8.7 kB gzip for engine, recipes, music, hook and settings UI | Original sounds, zero assets and dependencies, deterministic and testable |

Browser constraints that shaped the engine:

- Autoplay policy: an `AudioContext` must be created or resumed inside a user
  gesture. iOS Safari only honours `resume()` on the gesture's synchronous call
  stack, so the provider unlocks from capture-phase `pointerdown`/`keydown`/
  `touchend` listeners and again from the settings controls themselves.
- iOS leaves Web Audio in the `ambient` audio session, so the ringer switch
  silences it. We keep that default instead of forcing `playback`, which would
  also pause the player's own music apps.
- Hidden tabs throttle timers, so the context is suspended when the document is
  hidden and the music scheduler skips missed bars on return instead of
  replaying them.

## Design

- `audio/cues.ts`: pure map from rule events to 28 cues. Cues depend only on
  public parameters and on whether the viewer is a party, never on the stolen
  resource or the bought card (SPEC §8.3). Rolls follow the dice presentation:
  the rattle starts on arrival, the landing knock plays at
  `DICE_ROLL_DURATION_MS`, and consequences wait for
  `DICE_PRESENTATION_DURATION_MS`, so the sound never reveals the result early.
  Distinct cues in one batch are staggered 320 ms in event order and capped
  by priority.
- `audio/synth.ts`: primitives (tone, filtered noise, knock, marimba, bell,
  pluck, brass, coin, swish) and one recipe per cue, scheduled on absolute
  audio-clock times so the same code runs live or in an `OfflineAudioContext`.
- `audio/music.ts`: generative score. `composeBar` is pure and seeded (chord
  bed, bass, sparse pentatonic melody); the sequencer schedules about 1.2 s
  ahead. There are two scenes: *harbor* (D major, 58 bpm, entry/home/lobby/result)
  and *island* (G major, 68 bpm, table). Both sit over two LFO-swelled
  filtered-noise ocean layers. Each playback session has its own gain nodes,
  so stopping fades out notes that were already scheduled.
- `audio/engine.ts`: bus graph (effects and music each with dry and reverb
  sends) → master → compressor. It creates no context before a gesture, drops
  cues fired before unlock or while muted or hidden, and ignores the same cue
  repeated within 60 ms.
- `audio/useGameSounds.ts`: one hook at the app root. It keeps an event cursor
  keyed by game id and sync generation, so open, resume, reconnect and gap
  refetches take a baseline and never replay history, and an event heard
  through the events packet is not heard again when its projection arrives.
  It also plays "your move" when an obligation passes to the viewer (setup,
  roll, discard, robber; dice presentation and projection catch-up are
  transient), rejections, target selection, and chat from unmuted players.
- `components/SoundSettings.tsx`: mute, effect volume and music volume
  (persisted in `catan.audio`), plus a test sound. It sits next to the language
  switch on entry, home, lobby, table and result.
- `?preview=sounds`: a lazily loaded palette page with play buttons and
  offline-rendered waveforms.

## Defect found during verification

Rendering every cue offline showed `dev.buy` and `trade.bank` peaking at
0.93/0.87 while their parts peaked below 0.2 alone. A `GainNode` starts at
gain 1 until its first automation event. When a source's start time rounded to
an earlier sample frame than the envelope's `setValueAtTime`, one unattenuated
noise sample leaked out as a click. Every envelope now sets the current value to
silence first. Peaks afterwards: 0.035–0.50.

The first live run also showed the panel underneath board markers and the
action prompt. The panel's `z-index` only counts inside the status strip's
stacking context, so the strip is raised while the panel is open, following
`.board__toolbar:has([open])`. On phones the panel is pinned to the viewport
edges.

## Verification

- `pnpm verify`: typecheck, rules 138, protocol 7, server 96 (+11 PostgreSQL
  skips), web 483 tests, build, smoke 13/13, dev runner 1/1.
- New web tests: cue mapping, privacy invariance, roll timing, staggering and
  caps; preference storage; music determinism and harmony; engine lifecycle on
  a fake `AudioContext` (no context before a gesture, mute/suspend, hidden tab,
  scheduler, dispose); event cursor, attention transitions and hook
  integration; settings persistence and unlock through `App`.
- `scripts/audio/verify.py` ([report](2026-10-31-game-audio/palette-report.json)):
  all 28 cues render audible without clipping; no live context before the
  first click; island music RMS ≈ 0.025 while running and fading out after
  stopping; a live `build.city` peaks at 0.43.
- `scripts/audio/live.py` ([report](2026-10-31-game-audio/live-report.json)):
  a built service with a real three-player setup driven over HTTP. All eleven
  placements and the host's roll arriving over the WebSocket are audible
  (peaks 0.17–0.28). The host's placement while muted is silent with the context
  suspended. The only console error is the existing pre-session WebSocket 401
  on the entry screen.
- Screenshots: [`docs/screenshots/game-audio/`](../../screenshots/game-audio/README.md).

## Limits

Headless Chromium proves that signal reaches the destination, not how it
sounds on real speakers. Safari/iOS unlock behaviour follows the documented
rules but was not run on a device. Loudness balance was set by measured peaks
and RMS, not by a listening panel.
