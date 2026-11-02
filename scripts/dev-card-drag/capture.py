"""拍攝拖曳發展卡出牌，以及壟斷／豐收之年的資源選擇器（真實三人對局，連線既有服務）。

用法（先 pnpm build 並啟動服務，輸出目錄須為全新空目錄）：
  UI_BASE_URL=http://127.0.0.1:3000 python3 scripts/dev-card-drag/capture.py <output-dir>

開局放置經由 API 完成，輪到房主的第一個回合（擲骰前即可出發展卡）。發展卡只在瀏覽器端
改寫本人投影（HTTP 與 WebSocket 快照）塞入，不送出任何出牌指令：拖曳、放置區與選擇器
都是送出前的客戶端互動。斷言拖過手牌上緣時放置區轉為可放開、放開後開啟對應的選擇器，
以及壟斷改選、豐收之年選兩張的狀態；規則本身由 packages/web/test 與 rules 的單元測試負責。
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
DEV_CARDS = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly']


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

    snapshot = api(contexts[0], 'GET', path)
    assert snapshot['view']['turn']['playerId'] == identity[0], snapshot['view']['turn']

    def inflate(snapshot):
        for player in snapshot['view']['players']:
            if player['id'] == identity[0]:
                player['devCards'] = list(DEV_CARDS)
                player['devCardCount'] = len(DEV_CARDS)
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
    staged.set_default_timeout(15000)
    staged.route(f'**/api/games/{game_id}', rewrite_http)
    staged.route_web_socket('**/ws', rewrite_ws)
    staged.goto(BASE)
    staged.locator('#home-tab-resume').click()
    staged.get_by_test_id(f'resume-{game_id}').click()
    expect(staged.get_by_test_id('hand-panel')).to_be_visible()
    staged.locator('[data-testid=locale-switch-game]').select_option('zh-Hant')

    def card_face(kind):
        return staged.locator(f'.development-card--{kind}[data-draggable] .development-card__inspect').first

    def hover_hand():
        # 收合的手牌 overflow: clip，Playwright 的 hover() 等不到穩定命中點；直接把滑鼠移進 dock。
        box = staged.get_by_test_id('hand-panel').bounding_box()
        staged.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] - 12)
        expect(staged.get_by_test_id('hand-panel')).to_have_attribute('data-expanded', 'true')
        staged.wait_for_timeout(400)

    def drag(kind, to, shot_name=None):
        hover_hand()
        box = card_face(kind).bounding_box()
        x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 3
        staged.mouse.move(x, y)
        staged.mouse.down()
        staged.mouse.move(x, y - 30, steps=4)
        expect(staged.get_by_test_id('card-drag')).to_be_visible()
        staged.mouse.move(to[0], to[1], steps=10)
        if shot_name:
            shot(staged, shot_name)
        return lambda: staged.mouse.up()

    staged.set_viewport_size({'width': 1366, 'height': 768})
    hover_hand()
    shot(staged, 'hand-expanded-1366x768-zh-Hant')

    # 往上拖但仍停在手牌範圍：放置區只提示、不會打出；放開後卡片回到手上。
    box = card_face('knight').bounding_box()
    release = drag('knight', (box['x'] + box['width'] / 2, box['y'] + 10), 'drag-not-armed-1366x768-zh-Hant')
    assert staged.get_by_test_id('card-drag').get_attribute('data-armed') is None
    release()
    expect(staged.get_by_test_id('card-drag')).to_have_count(0)
    expect(staged.get_by_test_id('devcard-choice')).to_have_count(0)

    # 拖到桌面中央：放置區轉為可放開，放開後在上方開啟壟斷的資源選擇器。
    release = drag('monopoly', (683, 330), 'drag-armed-monopoly-1366x768-zh-Hant')
    expect(staged.get_by_test_id('card-drag')).to_have_attribute('data-armed', 'true')
    release()
    expect(staged.get_by_test_id('devcard-choice')).to_have_attribute('data-card', 'monopoly')
    shot(staged, 'monopoly-picker-empty-1366x768-zh-Hant')
    staged.get_by_test_id('choice-add-grain').click()
    staged.get_by_test_id('choice-add-ore').click()
    expect(staged.get_by_test_id('choice-add-ore')).to_have_attribute('aria-pressed', 'true')
    expect(staged.get_by_test_id('choice-add-grain')).to_have_attribute('aria-pressed', 'false')
    expect(staged.get_by_test_id('choice-submit')).to_be_enabled()
    shot(staged, 'monopoly-picker-ore-1366x768-zh-Hant')
    staged.get_by_test_id('choice-cancel').click()
    expect(staged.get_by_test_id('devcard-choice')).to_have_count(0)

    # 豐收之年：同一種可選兩次，選滿後其餘資源停用。
    drag('yearOfPlenty', (683, 300))()
    expect(staged.get_by_test_id('devcard-choice')).to_have_attribute('data-card', 'yearOfPlenty')
    staged.get_by_test_id('choice-add-wool').click()
    shot(staged, 'year-of-plenty-picker-one-1366x768-zh-Hant')
    staged.get_by_test_id('choice-add-wool').click()
    expect(staged.get_by_test_id('choice-add-ore')).to_have_attribute('aria-disabled', 'true')
    expect(staged.get_by_test_id('choice-submit')).to_be_enabled()
    shot(staged, 'year-of-plenty-picker-full-1366x768-zh-Hant')
    staged.locator('[data-testid=locale-switch-game]').select_option('en')
    shot(staged, 'year-of-plenty-picker-full-1366x768-en')
    staged.locator('[data-testid=locale-switch-game]').select_option('zh-Hant')
    staged.keyboard.press('Escape')
    expect(staged.get_by_test_id('devcard-choice')).to_have_count(0)

    # 鍵盤／輔助科技的替代路徑：點開卡片才出現「使用」按鈕。
    staged.mouse.move(1180, 420)
    staged.wait_for_timeout(600)
    staged.set_viewport_size({'width': 390, 'height': 844})
    hand = staged.get_by_test_id('hand-panel')
    hand.dispatch_event('pointerdown', {'pointerType': 'touch'})
    hand.dispatch_event('click')
    expect(staged.get_by_test_id('play-yearOfPlenty-2')).to_be_hidden()
    # 窄螢幕的扇形裡卡片互相重疊，改用鍵盤聚焦後按 Enter 放大檢視。
    card_face('yearOfPlenty').focus()
    staged.keyboard.press('Enter')
    expect(staged.get_by_test_id('play-yearOfPlenty-2')).to_be_visible()
    shot(staged, 'inspect-play-button-390x844-zh-Hant')
    staged.get_by_test_id('play-yearOfPlenty-2').click()
    staged.get_by_test_id('choice-add-lumber').click()
    staged.get_by_test_id('choice-add-ore').click()
    shot(staged, 'year-of-plenty-picker-390x844-zh-Hant')
    staged.get_by_test_id('choice-cancel').click()

    staged.set_viewport_size({'width': 844, 'height': 390})
    staged.mouse.move(700, 120)
    staged.wait_for_timeout(600)
    drag('monopoly', (422, 150))()
    staged.get_by_test_id('choice-add-brick').click()
    shot(staged, 'monopoly-picker-844x390-zh-Hant')

    browser.close()
    assert not errors, f'browser runtime errors: {errors}'
    print('DONE', flush=True)
