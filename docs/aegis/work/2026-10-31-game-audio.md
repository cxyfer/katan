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
- Hidden tabs throttle timers, so music stops while the document is hidden and
  the scheduler skips missed bars on return instead of replaying them. Only the
  cues that need the player back (`turn.yours`, `trade.offer`) still sound in a
  background tab; muting suspends the context.

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
  cues fired before unlock or while muted (and all but the call-back cues while
  hidden), and ignores the same cue repeated within 60 ms. Going inactive
  swaps in a fresh effects bus so already-scheduled cues cannot replay on
  resume, and every resume/suspend re-checks the wanted state once it settles.
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

## Review follow-ups

Codex review (P2) and an independent reviewer found these problems on
`d7cb5f8`. All of them are fixed, with regression tests:

- **Queued rolls (Codex P2 on `d7cb5f8`; P1 + P2 on `594bdae`):** cues were
  timed from packet arrival, but the board serialises presentations (dice
  2.5 s + effect group 0.8 s per group). A second roll arriving mid-presentation
  could therefore reveal its result early. The first fix still treated a
  multi-roll delta as one group and used a millisecond backlog limit that was
  shorter than the board's real one. `scheduleCues` now mirrors the board
  directly:
  - it splits each delta with `boardEffectGroups`;
  - it queues each group behind the previous one's end;
  - only the dice count during mandatory steps;
  - it applies the board's own group-count overflow rule (more than
    `MAX_EFFECT_GROUPS` queued groups → the board drops its queue and shows
    results, so cues play at once).

  When the board skips the presentation (reduced motion, hidden tab), there is
  no rattle and the result plays at once.
- **Already-scheduled cues (independent review; Codex P2 ×2 on `5c0dcfd`):**
  Web Audio cannot cancel individual scheduled nodes. So `cancelPending()`
  fades out the effects bus and swaps in a fresh one, which drops every cue
  still waiting. It runs when:
  - muting (otherwise the cues replayed on unmute);
  - hiding the tab (otherwise dice/production cues sounded in the background);
  - the board would drop its queue (overflow, presentation turned off);
  - a sync generation changes.
- **Background call-back:** "your move" and trade offers now sound in a hidden
  tab; music and everything else stay silent there.
- **State race:** `ctx.state` lags `resume()`/`suspend()`, so `sync()` runs
  again after each successful transition.
- **Stale receipts:** a stale-revision rejection flips to `rejected` after the
  refresh. It no longer plays the error sound.
- **Attention:** the viewer's whole turn counts as theirs, so "wait for
  discards, then move the robber" doesn't ring twice. Discards are announced by
  the simultaneous `robber.alert` only.
- **Music restart:** restarting the music re-aligns to a chord boundary, so the
  pad/bass bed is never missing.
- **Slider a11y:** the visible percentage is `aria-hidden`, since the slider's
  `aria-valuetext` already announces it. Home/End/Page keys preview too.

## Verification

- `pnpm verify`: typecheck, rules 138, protocol 7, server 96 (+11 PostgreSQL
  skips), web 497 tests, build, smoke 13/13, dev runner 1/1.
- New web tests: cue mapping, privacy invariance, roll timing, staggering and
  caps; preference storage; music determinism and harmony; engine lifecycle on
  a fake `AudioContext` (no context before a gesture, mute/suspend, stale-cue
  discard, hidden-tab call-back, slow-resume race, scheduler, dispose); event
  cursor, presentation timeline, attention transitions, stale receipts and hook
  integration; settings persistence, unlock, Escape/outside-click through `App`.
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
