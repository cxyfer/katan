"""重新產生連結預覽圖 packages/web/public/og-image.png（1200×630）。

用法（先 pnpm build 並啟動服務）：
  python3 scripts/og-image/render.py [輸出路徑]

先在 ?preview=island 以接近俯視的角度拍攝 3D 島嶼（SwiftShader WebGL），
再把拍攝結果放進固定的文字版面合成。島嶼是固定版圖的展示，不含任何對局狀態。
"""
import base64
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3000')
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'packages/web/public/og-image.png'
READY = "document.querySelector('[data-testid=island-preview]')?.dataset.rendererStatus === 'ready'"

TEMPLATE = """<!doctype html><html><head><meta charset="utf-8"><style>
  html, body {{ margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #1d5f7e; }}
  .island {{ position: absolute; left: 430px; top: -36px; width: 840px; height: 690px; object-fit: cover; -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 22%); mask-image: linear-gradient(90deg, transparent 0, #000 22%); }}
  .scrim {{ position: absolute; inset: 0; background: linear-gradient(90deg, #123f55f2 0, #174d66d9 32%, #1d5f7e00 52%); }}
  .copy {{ position: absolute; left: 76px; top: 196px; color: #f8ecd0; font-family: 'Noto Sans TC', sans-serif; }}
  h1 {{ margin: 0; font: 600 92px/1 'Noto Serif TC', 'Noto Serif CJK TC', serif; letter-spacing: 6px; text-shadow: 0 4px 18px #0b2a3a88; }}
  .latin {{ margin: 22px 0 0; color: #e8c56f; font: 700 32px/1 'Noto Sans', sans-serif; letter-spacing: 1px; }}
  hr {{ width: 120px; margin: 24px 0; border: 0; border-top: 2px solid #e8c56f; }}
  p {{ margin: 0 0 10px; font-size: 29px; }}
  p.en {{ color: #d5e6e4; font-size: 27px; }}
</style></head><body>
  <img class="island" src="data:image/png;base64,{island}">
  <div class="scrim"></div>
  <div class="copy">
    <h1>卡坦桌遊桌</h1>
    <div class="latin">CATAN TABLE</div>
    <hr>
    <p>在瀏覽器上和朋友同桌開拓</p>
    <p class="en">Play Catan-style with friends online</p>
  </div>
</body></html>"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1600, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'{BASE}/?preview=island')
    page.wait_for_function(READY, timeout=60000)
    # 接近俯視、略帶傾角，讓山與城鎮仍有立體感
    page.get_by_test_id('preview-elevation').fill('68')
    page.wait_for_timeout(800)
    surface = page.get_by_test_id('island-preview-surface')
    # 隱藏疊在畫面上的標題與控制列，只留下 3D 畫面
    page.add_style_tag(content='.island-preview__intro, .island-preview__navigation, .island-preview__loading { display: none !important; }')
    page.wait_for_timeout(300)
    island = base64.b64encode(surface.screenshot()).decode()

    card = browser.new_page(viewport={'width': 1200, 'height': 630})
    card.set_content(TEMPLATE.format(island=island))
    card.evaluate('document.fonts.ready')
    card.wait_for_timeout(300)
    card.screenshot(path=str(OUT))
    browser.close()
    assert not errors, f'browser runtime errors: {errors}'
    print('WROTE', OUT)
