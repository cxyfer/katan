"""重新拍攝目前建置的正式畫面（真實三人對局，連線既有服務）。

用法（先 pnpm build 並啟動服務，輸出目錄須為全新空目錄）：
  python3 scripts/screenshots/capture-current.py docs/screenshots/current

涵蓋對局中的桌面 / 平板 / 手機畫面，以及賽後統計結算頁（#22）。結算頁需要
整局完成：對局其餘部分改以 API 依 hints 與待決效果下完，不經 UI。

只拍照，不做斷言；斷言式驗證請使用 scripts/board-3d 等既有 runner。
"""
import os
import sys
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3000')
if len(sys.argv) != 2:
    sys.exit('usage: capture-current.py <new empty output directory>')
OUT = Path(sys.argv[1])
if OUT.exists() and any(OUT.iterdir()):
    sys.exit(f'output directory must be empty: {OUT}')
OUT.mkdir(parents=True, exist_ok=True)
errors = []
RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']


def shot(page, name, width, height, locale=None, settle_ms=0, full_page=False):
    # 切換語系後等兩個動畫影格，讓 React 狀態與版面穩定再截圖
    page.set_viewport_size({'width': width, 'height': height})
    if locale:
        page.locator('[data-testid=locale-switch-game], [data-testid=locale-switch]').first.select_option(locale)
    page.wait_for_timeout(settle_ms)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    page.screenshot(path=str(OUT / f'{name}.png'), animations='disabled', full_page=full_page)
    print('CAPTURE', f'{name}.png', flush=True)


def api(context, method, path):
    response = context.request.fetch(BASE + path, method=method)
    payload = response.json()
    assert payload.get('ok'), (path, response.status, payload)
    return payload['data']


def fetch_view(context, path):
    # 以該玩家的 session 讀取投影，hints 與自己的手牌只有本人看得到
    return api(context, 'GET', path)['view']


def send(context, game_id, revision, command):
    # 被拒絕的指令回傳 false，由呼叫端改試下一個候選
    response = context.request.post(
        f'{BASE}/api/games/{game_id}/commands',
        data={'commandId': str(uuid.uuid4()), 'expectedRevision': revision, 'command': command},
    )
    payload = response.json()
    return bool(payload.get('ok')) and payload['data']['outcome'] == 'accepted'


def turn_candidates(view, hints, me):
    # 與 packages/rules/test/simulate.ts 相同的簡單策略：先擲骰，之後蓋城、蓋村、買發展卡、銀行交易，最後結束回合
    if hints['canRoll']:
        return [{'type': 'turn.roll'}]
    own = next(player for player in view['players'] if player['id'] == me)
    resources = own['resources']
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


def play_to_result(contexts, identity, path, game_id, limit=5000):
    # 每一步只送出一個被接受的指令，再重新讀取狀態，避免 expectedRevision 過期
    by_id = dict(zip(identity, contexts))
    for step in range(limit):
        snapshot = api(contexts[0], 'GET', path)
        view, revision = snapshot['view'], snapshot['revision']
        if view['result']:
            return step, view['result']
        pending = view['pending']
        if pending is None:
            turn_id = view['turn']['playerId']
            turn_view = fetch_view(by_id[turn_id], path)
            candidates = [(by_id[turn_id], m) for m in turn_candidates(turn_view, turn_view['hints'], turn_id)]
        elif pending['kind'] == 'discard':
            candidates = []
            for pid in pending['waitingFor']:
                own = fetch_view(by_id[pid], path)
                resources = next(p for p in own['players'] if p['id'] == pid)['resources']
                pool = [r for r in RESOURCES for _ in range(resources[r])]
                candidates.append((by_id[pid], {'type': 'pending.discard', 'resources': pool[:pending['required'][pid]]}))
        elif pending['kind'] == 'moveRobber':
            candidates = [(by_id[pending['actor']], {'type': 'pending.moveRobber', 'hex': h}) for h in range(40)]
        elif pending['kind'] == 'steal':
            candidates = [(by_id[pending['actor']], {'type': 'pending.steal', 'victim': v}) for v in pending['candidates']]
        elif pending['kind'] == 'yearOfPlenty':
            candidates = [(by_id[pending['actor']], {'type': 'pending.takeResource', 'resource': r}) for r in RESOURCES]
        elif pending['kind'] == 'freeRoads':
            actor_view = fetch_view(by_id[pending['actor']], path)
            candidates = [(by_id[pending['actor']], {'type': 'build.road', 'edge': e}) for e in actor_view['hints']['legalRoads']]
        else:
            raise AssertionError(f'unhandled pending kind at step {step}: {pending}')
        if not any(send(context, game_id, revision, command) for context, command in candidates):
            raise AssertionError(f'no legal move at step {step}: pending={pending} turn={view["turn"]}')
    raise AssertionError(f'game did not finish within {limit} steps')


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    contexts = [browser.new_context(viewport={'width': 1366, 'height': 768}, locale='zh-TW', reduced_motion='reduce') for _ in range(3)]
    pages = [c.new_page() for c in contexts]
    for page in pages:
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(15000)

    # 入口與首頁：三位玩家各自以暱稱進入
    names = ['海岸領航員', '小美', 'ABCDEFGHIJKLMNOPQRSTUVWX']
    pages[0].goto(BASE)
    shot(pages[0], '01-entry-1366x768-zh-Hant', 1366, 768, 'zh-Hant', 300)
    for page, name in zip(pages, names):
        page.goto(BASE)
        page.get_by_test_id('nickname-input').fill(name)
        page.locator('form button[type=submit]').click()
        expect(page.get_by_test_id('create-room')).to_be_visible()
    shot(pages[0], '02-home-1366x768-zh-Hant', 1366, 768, None, 300)

    # 建房、加入、準備，並截下等待開始與可開始兩種大廳狀態
    host = pages[0]
    host.locator('#room-capacity').select_option('3')
    host.get_by_test_id('create-room').click()
    code = host.get_by_test_id('room-code').inner_text()
    shot(host, '03-lobby-waiting-1366x768-zh-Hant', 1366, 768, None, 300)
    for page in pages[1:]:
        page.locator('#join-code').fill(code)
        page.get_by_test_id('join-room').click()
        expect(page.get_by_test_id('toggle-ready')).to_be_visible()
    for page in pages:
        page.get_by_test_id('toggle-ready').click()
    expect(host.get_by_test_id('start-game')).to_be_enabled()
    shot(host, '03-lobby-ready-1366x768-zh-Hant', 1366, 768, None, 300)
    host.get_by_test_id('start-game').click()
    expect(host.get_by_test_id('setup-guide')).to_be_visible()

    # 開局後以 API 讀取狀態，依回合座位經由 UI 完成 12 次初始放置
    identity = [api(c, 'GET', '/api/session')['player']['id'] for c in contexts]
    game_id = api(contexts[0], 'GET', '/api/games')['games'][0]['gameId']
    path = '/api/games/' + game_id
    snapshot = api(contexts[0], 'GET', path)
    shot(host, '04-setup-1366x768-zh-Hant', 1366, 768, 'zh-Hant', 300)

    steps = 0
    while snapshot['view']['turn']['phase'] == 'setup':
        actor_index = identity.index(snapshot['view']['turn']['playerId'])
        actor = pages[actor_index]
        actor.set_viewport_size({'width': 1366, 'height': 768})
        current = api(contexts[actor_index], 'GET', path)
        road = current['view']['turn']['setup']['stage'] == 'road'
        index = current['view']['hints']['legalRoads' if road else 'legalSettlements'][0]
        target = actor.get_by_test_id(f'target-{"edge" if road else "vertex"}-{index}')
        expect(target).to_be_visible()
        target.focus()
        target.press('Enter')
        expect(actor.get_by_test_id('selection-preview')).to_be_visible()
        actor.get_by_test_id('confirm-selection').click()
        expect(actor.get_by_test_id('selection-preview')).to_have_count(0)
        snapshot = api(contexts[0], 'GET', path)
        steps += 1
        assert steps <= 12, 'setup did not finish in 12 placements'
    assert steps == 12, f'expected 12 setup placements, got {steps}'

    # 擲骰後拍攝桌面、窄橫屏、平板與手機，兩種語系
    actor_index = identity.index(snapshot['view']['turn']['playerId'])
    pages[actor_index].get_by_test_id('prompt-roll').click()
    host.wait_for_timeout(2500)

    shot(host, '05-table-1366x768-zh-Hant', 1366, 768, 'zh-Hant', 300)
    shot(host, '05-table-1366x768-en', 1366, 768, 'en', 300)
    shot(host, '06-table-768x1024-zh-Hant', 768, 1024, 'zh-Hant', 300)
    shot(host, '07-table-390x844-zh-Hant', 390, 844, 'zh-Hant', 300)
    shot(host, '07-table-390x844-en', 390, 844, 'en', 300)
    shot(host, '08-table-844x390-zh-Hant', 844, 390, 'zh-Hant', 300)

    # 工具面板：交易、聊天（送出一則訊息）、手機交易
    host.set_viewport_size({'width': 1366, 'height': 768})
    host.get_by_test_id('locale-switch-game').select_option('zh-Hant')
    host.get_by_test_id('tool-tab-trade').click()
    shot(host, '09-trade-1366x768-zh-Hant', 1366, 768, None, 300)
    host.get_by_test_id('tool-tab-chat').click()
    host.get_by_test_id('chat-input').fill('航向新海岸！')
    host.get_by_test_id('chat-send').click()
    host.wait_for_timeout(500)
    shot(host, '10-chat-1366x768-zh-Hant', 1366, 768, None, 300)
    host.set_viewport_size({'width': 390, 'height': 844})
    host.get_by_test_id('tool-tab-trade').click()
    shot(host, '11-trade-390x844-zh-Hant', 390, 844, None, 300)

    # 賽後：以 API 下完整局，結算頁出現後拍攝總覽、經濟與時間軸分頁（#22），以及手機版
    game_steps, result = play_to_result(contexts, identity, path, game_id)
    print('RESULT', result, f'after {game_steps} steps', flush=True)
    expect(host.get_by_test_id('result-screen')).to_be_visible()
    expect(host.get_by_test_id('game-stats')).to_be_visible()
    shot(host, '12-result-overview-1366x768-zh-Hant', 1366, 768, None, 300, full_page=True)
    shot(host, '12-result-overview-1366x768-en', 1366, 768, 'en', 300, full_page=True)
    host.get_by_test_id('stats-tab-economy').click()
    shot(host, '13-result-economy-1366x768-zh-Hant', 1366, 768, 'zh-Hant', 300, full_page=True)
    host.get_by_test_id('stats-tab-timeline').click()
    shot(host, '14-result-timeline-1366x768-zh-Hant', 1366, 768, None, 300, full_page=True)
    shot(host, '15-result-390x844-zh-Hant', 390, 844, None, 300, full_page=True)

    browser.close()
    assert not errors, f'browser runtime errors: {errors}'
    print('DONE: no browser runtime errors', flush=True)
