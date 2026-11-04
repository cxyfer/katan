# Traders & Barbarians captures

Production build in headless Chromium (software WebGL) via
`scripts/traders-barbarians/capture.py --live` (30 cases, all PASS; see
`report.json`, source head `16983c4`). Images are colour-quantised copies
(256 colours) of the harness output to keep the repository small.

Per scenario (`tb-fishing`, `tb-rivers`, `tb-merchant-trains`,
`tb-barbarian-attack`, `tb-traders-barbarians`):

| File | What it shows |
|---|---|
| `<scenario>-svg-desktop.png`, `<scenario>-r3f-desktop.png` | the board in the SVG and 3D renderers, 1366×900, English, from an engine-projected fixture with scenario pieces |
| `<scenario>-svg-mobile.png`, `<scenario>-r3f-mobile.png` | the same at 390×844, Traditional Chinese |
| `<scenario>-panel-detail.png` | the Scenario tool panel of that fixture |
| `<scenario>-live-board.png`, `<scenario>-live-panel.png` | a real three-player game against the production server after setup and the first roll; the Traders & Barbarians one shows the end-of-turn wagon move with its board targets |

Limitations: Chromium only, no physical devices or screen readers; fixtures
place scenario pieces directly to show them, the live games only reach the
first turn.
