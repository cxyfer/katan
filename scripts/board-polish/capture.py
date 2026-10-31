"""拍攝 SVG 與 3D 棋盤的對照截圖（真實三人對局，連線既有服務）。

用法（先 pnpm build 並啟動服務，輸出目錄須為全新空目錄）：
  python3 scripts/board-polish/capture.py <新的空輸出目錄>

對局以 HTTP API 完成初始放置並推進數個回合，讓棋盤上有村莊、城市、道路與
移動過的強盜；再以同一位玩家的瀏覽器分別用 ?renderer=svg 與 ?renderer=r3f
拍攝桌面與手機畫面、放大特寫、展開的手牌、入口頁島嶼插畫，以及 ?preview=island 的島嶼展示（含六人延伸島嶼
與輕量畫質）。

只拍照，不做斷言；遇到瀏覽器執行期錯誤即失敗。
"""
import os
import sys
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3000')
TURNS = int(os.environ.get('BOARD_TURNS', '45'))
if len(sys.argv) != 2:
    sys.exit('usage: capture.py <new empty output directory>')
OUT = Path(sys.argv[1])
if OUT.exists() and any(OUT.iterdir()):
    sys.exit(f'output directory must be empty: {OUT}')
OUT.mkdir(parents=True, exist_ok=True)
errors = []
RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']


def api(context, method, path, data=None):
    response = context.request.fetch(BASE + path, method=method, data=data)
    payload = response.json()
    assert payload.get('ok'), (path, response.status, payload)
    return payload['data']


def send(context, game_id, revision, command):
    response = context.request.post(
        f'{BASE}/api/games/{game_id}/commands',
        data={'commandId': str(uuid.uuid4()), 'expectedRevision': revision, 'command': command},
    )
    payload = response.json()
    return bool(payload.get('ok')) and payload['data']['outcome'] == 'accepted'


def turn_candidates(view, hints):
    if hints['canRoll']:
        return [{'type': 'turn.roll'}]
    own = next(player for player in view['players'] if player['id'] == view['turn']['playerId'])
    resources = own['resources']
    moves = [{'type': 'build.city', 'vertex': v} for v in hints['legalCities']]
    moves += [{'type': 'build.settlement', 'vertex': v} for v in hints['legalSettlements']]
    if hints['legalRoads']:
        moves.append({'type': 'build.road', 'edge': hints['legalRoads'][len(hints['legalRoads']) // 2]})
    for give in RESOURCES:
        if resources[give] >= hints['bankRates'][give]:
            receive = min((r for r in RESOURCES if r != give), key=lambda r: resources[r])
            moves.append({'type': 'trade.bank', 'give': give, 'receive': receive})
    moves.append({'type': 'turn.end'})
    return moves


def advance(contexts, identity, path, game_id, turns):
    """以 API 推進：初始放置後再走指定回合數，處理棄牌、強盜與搶奪。"""
    by_id = dict(zip(identity, contexts))
    ended = 0
    for step in range(4000):
        snapshot = api(contexts[0], 'GET', path)
        view, revision = snapshot['view'], snapshot['revision']
        if view['result'] or ended >= turns:
            return
        pending = view['pending']
        turn_id = view['turn']['playerId']
        if view['turn']['phase'] == 'setup':
            own = api(by_id[turn_id], 'GET', path)['view']
            hints = own['hints']
            road = view['turn']['setup']['stage'] == 'road'
            options = hints['legalRoads' if road else 'legalSettlements']
            pick = options[(len(options) * 3) // 7]
            command = {'type': 'setup.placeRoad', 'edge': pick} if road else {'type': 'setup.placeBuilding', 'vertex': pick}
            candidates = [(by_id[turn_id], command)]
        elif pending is None:
            own = api(by_id[turn_id], 'GET', path)['view']
            candidates = [(by_id[turn_id], move) for move in turn_candidates(own, own['hints'])]
        elif pending['kind'] == 'discard':
            candidates = []
            for pid in pending['waitingFor']:
                own = api(by_id[pid], 'GET', path)['view']
                resources = next(p for p in own['players'] if p['id'] == pid)['resources']
                pool = [r for r in RESOURCES for _ in range(resources[r])]
                candidates.append((by_id[pid], {'type': 'pending.discard', 'resources': pool[:pending['required'][pid]]}))
        elif pending['kind'] == 'moveRobber':
            candidates = [(by_id[pending['actor']], {'type': 'pending.moveRobber', 'hex': h}) for h in (4, 13, 8, 2, 16, 0, 5)]
        elif pending['kind'] == 'steal':
            candidates = [(by_id[pending['actor']], {'type': 'pending.steal', 'victim': v}) for v in pending['candidates']]
        else:
            raise AssertionError(f'unhandled pending kind: {pending}')
        accepted = None
        for context, command in candidates:
            if send(context, game_id, revision, command):
                accepted = command
                break
        assert accepted is not None, f'no legal move at step {step}: {pending} {view["turn"]}'
        if accepted['type'] == 'turn.end':
            ended += 1


def settle(page, renderer):
    if renderer == 'r3f':
        page.wait_for_function("document.querySelector('[data-testid=board]')?.dataset.rendererStatus === 'ready'", timeout=30000)
    page.evaluate('document.fonts.ready')
    page.wait_for_timeout(600)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


def shot(page, name, clip=None):
    # 游標移到角落，避免停在棋盤上觸發地塊說明
    page.mouse.move(2, page.viewport_size['height'] - 2)
    page.wait_for_timeout(150)
    page.screenshot(path=str(OUT / f'{name}.png'), animations='disabled', clip=clip)
    print('CAPTURE', f'{name}.png', flush=True)


def board_clip(page):
    box = page.get_by_test_id('board-surface').bounding_box()
    return {'x': box['x'], 'y': box['y'], 'width': box['width'], 'height': box['height']}


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    contexts = [browser.new_context(viewport={'width': 1366, 'height': 768}, locale='zh-TW', reduced_motion='reduce') for _ in range(3)]
    pages = [c.new_page() for c in contexts]
    for page in pages:
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(20000)

    # 入口頁的島嶼插畫與棋盤共用地形圖示
    pages[0].goto(BASE)
    expect(pages[0].get_by_test_id('nickname-input')).to_be_visible()
    pages[0].evaluate('document.fonts.ready')
    pages[0].wait_for_timeout(600)
    shot(pages[0], 'entry-1366x768')
    for page, name in zip(pages, ['海岸領航員', '小美', 'Alex']):
        page.goto(BASE)
        page.get_by_test_id('nickname-input').fill(name)
        page.locator('form button[type=submit]').click()
        expect(page.get_by_test_id('create-room')).to_be_visible()
    host = pages[0]
    host.locator('#room-capacity').select_option('3')
    host.get_by_test_id('create-room').click()
    code = host.get_by_test_id('room-code').inner_text()
    for page in pages[1:]:
        page.locator('#join-code').fill(code)
        page.get_by_test_id('join-room').click()
        expect(page.get_by_test_id('toggle-ready')).to_be_visible()
    for page in pages:
        page.get_by_test_id('toggle-ready').click()
    expect(host.get_by_test_id('start-game')).to_be_enabled()
    host.get_by_test_id('start-game').click()
    expect(host.get_by_test_id('board')).to_be_visible()

    identity = [api(c, 'GET', '/api/session')['player']['id'] for c in contexts]
    game_id = api(contexts[0], 'GET', '/api/games')['games'][0]['gameId']
    path = '/api/games/' + game_id
    advance(contexts, identity, path, game_id, TURNS)
    for page in pages[1:]:
        page.close()

    for renderer in ('svg', 'r3f'):
        for width, height, tag in ((1366, 768, 'desktop'), (390, 844, 'phone')):
            host.set_viewport_size({'width': width, 'height': height})
            host.goto(f'{BASE}/?renderer={renderer}')
            # 重新整理後可能停在首頁的「繼續對局」，也可能直接回到牌桌
            resume = host.get_by_test_id(f'resume-{game_id}')
            tab = host.locator('#home-tab-resume')
            expect(tab.or_(host.get_by_test_id('board')).first).to_be_visible()
            if tab.is_visible():
                tab.click()
                resume.click()
            expect(host.get_by_test_id('board')).to_be_visible()
            settle(host, renderer)
            shot(host, f'{renderer}-{tag}-{width}x{height}')
            if tag == 'desktop':
                shot(host, f'{renderer}-board-{width}x{height}', board_clip(host))
                for _ in range(3):
                    host.get_by_test_id('zoom-in').click()
                settle(host, renderer)
                shot(host, f'{renderer}-closeup-{width}x{height}', board_clip(host))
                if renderer == 'svg':
                    # 展開手牌：資源卡面同樣使用棋盤的地形圖示
                    host.get_by_test_id('hand-panel').hover()
                    host.wait_for_timeout(700)
                    host.screenshot(path=str(OUT / f'hand-{width}x{height}.png'), animations='disabled')
                    print('CAPTURE', f'hand-{width}x{height}.png', flush=True)

    host.set_viewport_size({'width': 1600, 'height': 1000})
    host.goto(f'{BASE}/?preview=island')
    host.wait_for_function("document.querySelector('[data-testid=island-preview]')?.dataset.rendererStatus === 'ready'", timeout=30000)
    host.wait_for_timeout(600)
    shot(host, 'island-preview-1600x1000')
    # 六人延伸島嶼，再切到輕量畫質（無陰影、無反鋸齒）
    host.get_by_test_id('preview-topology').select_option('hex-r56')
    host.wait_for_timeout(300)
    host.wait_for_function("document.querySelector('[data-testid=island-preview]')?.dataset.rendererStatus === 'ready'", timeout=30000)
    host.wait_for_timeout(600)
    shot(host, 'island-preview-r56-1600x1000')
    host.get_by_test_id('preview-quality').select_option('low')
    host.wait_for_timeout(1200)
    shot(host, 'island-preview-r56-low-1600x1000')

    browser.close()
    assert not errors, f'browser runtime errors: {errors}'
    print('DONE: no browser runtime errors', flush=True)
