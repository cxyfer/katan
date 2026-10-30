# Table interaction browser evidence — 2026-10-27

Final execution: **190/190 checks passed**, **12/12 viewport/locale cases**, **0 failures**, **0 pageerrors**, **8 screenshots**; runner exit status **0**. Python **3.13.5**, headless Chromium **154.0.8037.57** via `/usr/bin/chromium`, against the existing `http://127.0.0.1:3000` service. Every measured matrix state used production assets `index-BN2uccZK.js` and `index-DIALwB7a.css`.

The [complete JSON report](table-interactions-report.json) contains all checks, rectangles, local scroll dimensions, control hit results, API request paths, production asset URLs and runtime versions. The [fixture generator](generate-table-interactions-fixtures.mjs) bundles the existing fixture helpers and canonical rules layout with esbuild; the [runner](verify-table-interactions.py) executes the actual disk-served frontend. All `/api/**` responses and WebSocket traffic are intercepted in the browser. No server, database, implementation source or Git changes were made by this verification owner.

Reproduce after the coordinator rebuilds the existing service artifacts:

```sh
node docs/aegis/work/2026-10-27-island-ui/generate-table-interactions-fixtures.mjs
python3 docs/aegis/work/2026-10-27-island-ui/verify-table-interactions.py
```

The fixture uses six long player names, the canonical deterministic 30-hex paired board with roads/buildings, six held development cards covering all four playable types and victory points, three fresh cards, mixed resource counts including zero brick, a fully empty hand, and a required year-of-plenty response. Both `zh-Hant` and `en` were exercised at 1366×768, 800×450, 844×390, 768×1024, 390×844 and 360×640.

Executed coverage includes document overflow and board size; all six compact score centers after local rail scrolling; desktop rail reservation and narrow overlay/Escape; collapsed hand, pointer entry, delayed close around 320ms, pin, keyboard focus/Escape/focus return and explicit touch toggle; separate resource/development rows and local horizontal reachability; fresh/VP cards without play controls; retained monopoly Ore selection; required decision controls above optional panels; empty resource/development state; persistent accepted feedback and dismiss, prominent rejected/unknown feedback; exact authoritative dice 2+5, centered large overlay, bounded end, restart and reduced motion. A second event after a requested 350ms pause produced two actual `dice-focus-arrive` animation starts **466.8ms apart**, while the first presentation was active. Preview confirmation used normal pointer hit testing and actual confirmation with the hand pinned at 1366×768, 844×390 and 360×640. No force clicks were used.

All eight final captures were directly inspected:

- [Desktop default](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/01-desktop-default-en.png)
- [Desktop expanded hand](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/02-desktop-expanded-en.png)
- [Short landscape expanded hand](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/03-expanded-844x390-zh-Hant.png)
- [Portrait expanded hand](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/03-expanded-390x844-zh-Hant.png)
- [Narrow portrait expanded hand](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/03-expanded-360x640-en.png)
- [Persistent accepted notice](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/04-desktop-accepted-en.png)
- [Centered authoritative dice](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/05-central-dice-en.png)
- [Required prompt above expanded score rail and hand](https://github.com/cxyfer/katan/blob/ca1e8db/docs/screenshots/table-interactions/06-mobile-required-prompt-with-rail-en.png)

Earlier observations were reported to the coordinator: the portrait hand extended beneath the collapsed score rail, and the short-landscape accepted notice overlapped the expanded hand by 34px. The final build passes the corresponding clearance checks. An expanded narrow score rail intentionally covers optional hand controls; Escape closes the rail, and the required response remains exposed above it.

This is isolated presentation/interaction evidence. Live multi-client server behavior, game-rule legality, persistence, physical touch devices, Safari, Firefox, assistive technology and full WCAG conformance are outside this runner's scope. Chromium viewport/touch emulation and DOM focus/live-region observations do not establish those conditions. Confidence: **B**, with the covered browser criteria passing and these bounded limitations retained.
