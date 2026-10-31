"""拍攝橫向一頁式介面：入口、首頁、大廳、牌桌與結算頁在常見橫向尺寸的畫面。

用法（先 pnpm build 並啟動服務，輸出目錄須為全新空目錄）：
  python3 scripts/landscape-ui/capture.py <output-dir>

以真實三人對局進行：入口、建房、加入與開局都經由 UI；初始放置與之後的回合
以各玩家自己的 hints 經 API 推進（與 scripts/screenshots/capture-current.py
相同的簡單策略），直到輪到房主行動，再拍牌桌；最後下完整局拍結算頁。

唯一的斷言：每個橫向尺寸的頁面本身都不能捲動（documentElement 的捲動
寬高不超過視窗）。直屏仍允許單欄捲動，只拍照不斷言。
"""
import os
import sys
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3000')
if len(sys.argv) != 2:
    sys.exit('usage: capture.py <new empty output directory>')
OUT = Path(sys.argv[1])
if OUT.exists() and any(OUT.iterdir()):
    sys.exit(f'output directory must be empty: {OUT}')
OUT.mkdir(parents=True, exist_ok=True)
errors = []
overflow = []
RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']
LANDSCAPE = [(1366, 768), (1920, 1080), (1280, 720), (1024, 600), (844, 390)]


def check(page, name, width, height, settle_ms=500, save=False):
    # 每個尺寸都檢查橫屏不捲動；只有 save=True 的尺寸才存成截圖
    page.set_viewport_size({'width': width, 'height': height})
    page.wait_for_timeout(settle_ms)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    if save:
        page.screenshot(path=str(OUT / f'{name}-{width}x{height}-zh-Hant.png'), animations='disabled')
    scroll = page.evaluate('() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]')
    if width > height and (scroll[0] > width or scroll[1] > height):
        overflow.append((name, width, height, scroll))
    print('CAPTURE' if save else 'CHECK', name, width, height, 'scroll', scroll, flush=True)


def sweep(page, name, saved, settle_ms=500):
    # 所有橫向尺寸都斷言，另外拍下 saved 指定的尺寸（可含直屏）
    for width, height in dict.fromkeys(LANDSCAPE + saved):
        check(page, name, width, height, settle_ms, (width, height) in saved)


def api(context, method, path):
    response = context.request.fetch(BASE + path, method=method)
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


def turn_moves(view, hints, me):
    if hints['canRoll']:
        return [{'type': 'turn.roll'}]
    resources = next(p for p in view['players'] if p['id'] == me)['resources']
    moves = [{'type': 'build.city', 'vertex': v} for v in hints['legalCities']]
    moves += [{'type': 'build.settlement', 'vertex': v} for v in hints['legalSettlements']]
    moves.append({'type': 'build.devCard'})
    if not hints['legalSettlements'] and hints['legalRoads']:
        moves.append({'type': 'build.road', 'edge': hints['legalRoads'][0]})
    for give in RESOURCES:
        if resources[give] >= hints['bankRates'][give]:
            receive = min((r for r in RESOURCES if r != give), key=lambda r: resources[r])
            moves.append({'type': 'trade.bank', 'give': give, 'receive': receive})
    moves.append({'type': 'turn.end'})
    return moves


def step(contexts, identity, path, game_id):
    """送出一個被接受的指令；整局結束時回傳 None。"""
    by_id = dict(zip(identity, contexts))
    snapshot = api(contexts[0], 'GET', path)
    view, revision = snapshot['view'], snapshot['revision']
    if view['result']:
        return None
    pending = view['pending']
    if view['turn']['phase'] == 'setup':
        actor = view['turn']['playerId']
        own = api(by_id[actor], 'GET', path)['view']
        road = own['turn']['setup']['stage'] == 'road'
        candidates = [(by_id[actor], {'type': 'setup.placeRoad', 'edge': e} if road else {'type': 'setup.placeBuilding', 'vertex': e})
                      for e in own['hints']['legalRoads' if road else 'legalSettlements'][:5]]
    elif pending is None:
        actor = view['turn']['playerId']
        own = api(by_id[actor], 'GET', path)['view']
        candidates = [(by_id[actor], move) for move in turn_moves(own, own['hints'], actor)]
    elif pending['kind'] == 'discard':
        candidates = []
        for pid in pending['waitingFor']:
            resources = next(p for p in api(by_id[pid], 'GET', path)['view']['players'] if p['id'] == pid)['resources']
            pool = [r for r in RESOURCES for _ in range(resources[r])]
            candidates.append((by_id[pid], {'type': 'pending.discard', 'resources': pool[:pending['required'][pid]]}))
    elif pending['kind'] == 'moveRobber':
        candidates = [(by_id[pending['actor']], {'type': 'pending.moveRobber', 'hex': h}) for h in range(40)]
    elif pending['kind'] == 'steal':
        candidates = [(by_id[pending['actor']], {'type': 'pending.steal', 'victim': v}) for v in pending['candidates']]
    elif pending['kind'] == 'yearOfPlenty':
        candidates = [(by_id[pending['actor']], {'type': 'pending.takeResource', 'resource': r}) for r in RESOURCES]
    elif pending['kind'] == 'freeRoads':
        own = api(by_id[pending['actor']], 'GET', path)['view']
        candidates = [(by_id[pending['actor']], {'type': 'build.road', 'edge': e}) for e in own['hints']['legalRoads']]
    else:
        raise AssertionError(f'unhandled pending kind: {pending}')
    for context, command in candidates:
        if send(context, game_id, revision, command):
            return command['type']
    raise AssertionError(f'no legal move: pending={pending} turn={view["turn"]}')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    contexts = [browser.new_context(viewport={'width': 1366, 'height': 768}, locale='zh-TW', reduced_motion='reduce') for _ in range(3)]
    pages = [c.new_page() for c in contexts]
    for page in pages:
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(20000)
    host = pages[0]

    host.goto(BASE)
    sweep(host, '01-entry', [(1366, 768), (844, 390)])
    for page, name in zip(pages, ['海岸領航員', '小美', 'ABCDEFGHIJKLMNOPQRSTUVWX']):
        page.goto(BASE)
        page.get_by_test_id('nickname-input').fill(name)
        page.locator('form button[type=submit]').click()
        expect(page.get_by_test_id('create-room')).to_be_visible()
    sweep(host, '02-home', [(1366, 768), (844, 390)])

    host.set_viewport_size({'width': 1366, 'height': 768})
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
    sweep(host, '03-lobby', [(1366, 768), (1024, 600), (844, 390), (390, 844)])

    host.get_by_test_id('start-game').click()
    expect(host.get_by_test_id('setup-guide')).to_be_visible()
    identity = [api(c, 'GET', '/api/session')['player']['id'] for c in contexts]
    game_id = api(contexts[0], 'GET', '/api/games')['games'][0]['gameId']
    path = '/api/games/' + game_id
    check(host, '04-setup', 1366, 768, 1500, True)

    while api(contexts[0], 'GET', path)['view']['turn']['phase'] == 'setup':
        step(contexts, identity, path, game_id)
    # 推進幾輪讓棋盤與手牌有內容，再停在房主可行動的回合
    for _ in range(40):
        step(contexts, identity, path, game_id)
    for _ in range(400):
        view = api(contexts[0], 'GET', path)['view']
        if view['turn']['playerId'] == identity[0] and view['pending'] is None:
            if view['hints']['canRoll']:
                step(contexts, identity, path, game_id)
                continue
            break
        step(contexts, identity, path, game_id)
    host.wait_for_timeout(2500)
    sweep(host, '05-table', [(1366, 768), (1920, 1080), (1024, 600), (844, 390), (390, 844)], 900)

    host.set_viewport_size({'width': 1366, 'height': 768})
    host.get_by_test_id('tool-tab-trade').click()
    check(host, '06-trade', 1366, 768, save=True)
    host.get_by_test_id('tool-tab-trade').click()

    for _ in range(8000):
        if step(contexts, identity, path, game_id) is None:
            break
    expect(host.get_by_test_id('result-screen')).to_be_visible(timeout=30000)
    host.wait_for_timeout(1500)
    sweep(host, '07-result', [(1366, 768), (844, 390)], 900)
    host.set_viewport_size({'width': 1366, 'height': 768})
    host.get_by_test_id('stats-tab-timeline').click()
    check(host, '08-result-timeline', 1366, 768, save=True)

    browser.close()
    assert not errors, f'browser runtime errors: {errors}'
    assert not overflow, f'landscape pages scroll: {overflow}'
    print('DONE: no browser runtime errors, no landscape page scroll', flush=True)
