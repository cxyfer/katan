"""拍攝手牌的收合 / 展開狀態（真實三人對局，連線既有服務）。

用法（先 pnpm build 並啟動服務，輸出目錄須為全新空目錄）：
  python3 scripts/hand-cards/capture.py docs/screenshots/hand-cards

開局放置經由 API 完成，之後只擲骰、結束回合累積資源，讓房主持有多張重複的資源牌；
隨後在桌面與手機畫面拍攝收合與展開的手牌、放大檢視與發展卡近照。檔名以拍攝順序
編號。只拍照，不做斷言。
"""
import json
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
RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']
TARGET_CARDS = int(os.environ.get('HAND_TARGET', '9'))


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


def own_resources(context, path, pid):
    view = api(context, 'GET', path)['view']
    return next(p for p in view['players'] if p['id'] == pid)['resources']


def advance(contexts, identity, path, game_id, host_id, limit=400):
    # 只擲骰、處理強盜與棄牌、結束回合，直到房主手牌達到目標張數且輪到房主
    by_id = dict(zip(identity, contexts))
    for _ in range(limit):
        snapshot = api(contexts[0], 'GET', path)
        view, revision = snapshot['view'], snapshot['revision']
        pending, turn = view['pending'], view['turn']
        if pending is None:
            actor = turn['playerId']
            hints = api(by_id[actor], 'GET', path)['view']['hints']
            if hints['canRoll']:
                if actor == host_id and sum(own_resources(by_id[host_id], path, host_id).values()) >= TARGET_CARDS:
                    return
                candidates = [(by_id[actor], {'type': 'turn.roll'})]
            else:
                candidates = [(by_id[actor], {'type': 'turn.end'})]
        elif pending['kind'] == 'discard':
            candidates = []
            for pid in pending['waitingFor']:
                resources = own_resources(by_id[pid], path, pid)
                pool = [r for r in RESOURCES for _ in range(resources[r])]
                candidates.append((by_id[pid], {'type': 'pending.discard', 'resources': pool[:pending['required'][pid]]}))
        elif pending['kind'] == 'moveRobber':
            candidates = [(by_id[pending['actor']], {'type': 'pending.moveRobber', 'hex': h}) for h in range(40)]
        elif pending['kind'] == 'steal':
            candidates = [(by_id[pending['actor']], {'type': 'pending.steal', 'victim': v}) for v in pending['candidates']]
        else:
            raise AssertionError(f'unhandled pending: {pending}')
        if not any(send(c, game_id, revision, m) for c, m in candidates):
            raise AssertionError(f'no legal move: {pending} {turn}')
    raise AssertionError('hand did not reach the target size')


def settle(page):
    page.wait_for_timeout(500)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


_shot_index = 0


def next_name(name):
    # 檔名以拍攝順序編號，讓整組截圖依序瀏覽
    global _shot_index
    _shot_index += 1
    return f'{_shot_index:02d}-{name}.png'


def shot(page, name, clip=None):
    settle(page)
    filename = next_name(name)
    page.screenshot(path=str(OUT / filename), animations='disabled', clip=clip)
    print('CAPTURE', filename, flush=True)


def element_shot(locator, name):
    filename = next_name(name)
    locator.screenshot(path=str(OUT / filename), animations='disabled')
    print('CAPTURE', filename, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    contexts = [browser.new_context(viewport={'width': 1366, 'height': 768}, locale='zh-TW', reduced_motion='reduce') for _ in range(3)]
    pages = [c.new_page() for c in contexts]
    for page in pages:
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(15000)

    for page, name in zip(pages, ['海岸領航員', '小美', '阿卡']):
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
    expect(host.get_by_test_id('setup-guide')).to_be_visible()

    identity = [api(c, 'GET', '/api/session')['player']['id'] for c in contexts]
    game_id = api(contexts[0], 'GET', '/api/games')['games'][0]['gameId']
    path = '/api/games/' + game_id
    by_id = dict(zip(identity, contexts))
    while True:
        snapshot = api(contexts[0], 'GET', path)
        turn = snapshot['view']['turn']
        if turn['phase'] != 'setup':
            break
        actor = turn['playerId']
        hints = api(by_id[actor], 'GET', path)['view']['hints']
        road = turn['setup']['stage'] == 'road'
        command = {'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]} if road else {'type': 'setup.placeBuilding', 'vertex': hints['legalSettlements'][0]}
        assert send(by_id[actor], game_id, snapshot['revision'], command), command

    advance(contexts, identity, path, game_id, identity[0])
    host.wait_for_timeout(1500)
    if not host.get_by_test_id('hand-panel').is_visible():
        host.screenshot(path=str(OUT / 'debug.png'))
    expect(host.get_by_test_id('hand-panel')).to_be_visible()
    print('HAND', own_resources(contexts[0], path, identity[0]), flush=True)

    hand = host.get_by_test_id('hand-panel')
    for locale in ['zh-Hant', 'en']:
        host.set_viewport_size({'width': 1366, 'height': 768})
        host.locator('[data-testid=locale-switch-game]').select_option(locale)
        host.mouse.move(1180, 420)
        shot(host, f'hand-collapsed-1366x768-{locale}')
        hand.hover()
        shot(host, f'hand-expanded-1366x768-{locale}')
        host.mouse.move(1180, 420)
        host.wait_for_timeout(600)

    host.locator('[data-testid=locale-switch-game]').select_option('zh-Hant')
    host.set_viewport_size({'width': 390, 'height': 844})
    shot(host, 'hand-collapsed-390x844-zh-Hant')
    hand.dispatch_event('pointerdown', {'pointerType': 'touch'})
    hand.dispatch_event('click')
    shot(host, 'hand-expanded-390x844-zh-Hant')
    host.keyboard.press('Escape')
    host.set_viewport_size({'width': 844, 'height': 390})
    host.mouse.move(700, 120)
    shot(host, 'hand-collapsed-844x390-zh-Hant')
    hand.hover()
    shot(host, 'hand-expanded-844x390-zh-Hant')
    host.mouse.move(700, 120)

    # 大量手牌只用來檢查版面：在瀏覽器端改寫本人投影（HTTP 與 WebSocket 快照），不送出任何指令
    dense = {'lumber': 3, 'brick': 5, 'wool': 2, 'grain': 4, 'ore': 3}

    def inflate(snapshot):
        for player in snapshot['view']['players']:
            if player['id'] == identity[0]:
                player['resources'] = dense
                player['handSize'] = sum(dense.values())
                player['devCards'] = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly']
                player['devCardCount'] = 4
                player['newDevCards'] = ['victoryPoint']
                player['newDevCardCount'] = 1
        return snapshot

    def rewrite_http(route):
        response = route.fetch()
        payload = response.json()
        if payload.get('ok') and 'view' in payload.get('data', {}):
            inflate(payload['data'])
        route.fulfill(response=response, json=payload)

    def rewrite_ws(ws):
        server = ws.connect_to_server()

        def forward(message):
            data = json.loads(message)
            if data.get('type') == 'snapshot':
                inflate(data['payload'])
            ws.send(json.dumps(data))
        server.on_message(forward)
        ws.on_message(lambda message: server.send(message))

    staged = contexts[0].new_page()
    staged.on('pageerror', lambda error: errors.append(str(error)))
    staged.route(f'**/api/games/{game_id}', rewrite_http)
    staged.route_web_socket('**/ws', rewrite_ws)
    staged.goto(BASE)
    staged.locator('#home-tab-resume').click()
    staged.get_by_test_id(f'resume-{game_id}').click()
    expect(staged.get_by_test_id('hand-panel')).to_be_visible()
    staged.locator('[data-testid=locale-switch-game]').select_option('zh-Hant')
    staged.set_viewport_size({'width': 1366, 'height': 768})
    staged.mouse.move(1180, 420)
    shot(staged, 'hand-dense-collapsed-1366x768-zh-Hant')
    staged.get_by_test_id('hand-panel').hover()
    shot(staged, 'hand-dense-expanded-1366x768-zh-Hant')
    staged.get_by_test_id('resource-card-grain-1').locator('button').press('Enter')
    shot(staged, 'hand-dense-inspect-1366x768-zh-Hant')
    for kind in ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint']:
        card = staged.locator(f'.development-card--{kind}').first
        # #71 之後「使用」按鈕只在點開檢視時出現，單純聚焦不會顯示，因此以 Enter 開啟檢視
        card.locator('.development-card__inspect').press('Enter')
        staged.wait_for_timeout(400)
        element_shot(card, f'devcard-{kind}')
    staged.locator('.development-card--monopoly .development-card__inspect').press('Enter')
    shot(staged, 'hand-dense-devcard-1366x768-zh-Hant')
    staged.locator('[data-testid=locale-switch-game]').select_option('en')
    shot(staged, 'hand-dense-devcard-1366x768-en')
    staged.locator('[data-testid=locale-switch-game]').select_option('zh-Hant')
    staged.keyboard.press('Escape')
    staged.mouse.move(1180, 420)
    staged.wait_for_timeout(600)
    staged.set_viewport_size({'width': 390, 'height': 844})
    hand = staged.get_by_test_id('hand-panel')
    hand.dispatch_event('pointerdown', {'pointerType': 'touch'})
    hand.dispatch_event('click')
    shot(staged, 'hand-dense-expanded-390x844-zh-Hant')

    browser.close()
    assert not errors, f'browser runtime errors: {errors}'
    print('DONE', flush=True)
