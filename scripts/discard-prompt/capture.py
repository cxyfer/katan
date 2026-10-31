"""拍攝棄牌提示：持有張數、每種資源上限，以及送出後等待其他玩家的狀態。

用法（先 pnpm build 並啟動服務，輸出目錄須為全新空目錄）：
  python3 scripts/discard-prompt/capture.py <output-dir>

以真實三人對局進行：只擲骰與結束回合，直到 7 同時要求至少兩位玩家棄牌。
第一位玩家在 UI 把手牌點進棄牌區（含拿光某種資源、從棄牌區放回、選滿後送出），
另一位玩家仍待棄牌，因此可拍到「等待其他玩家棄牌」。各尺寸都斷言五種資源與
送出按鈕完整落在訊息區內，且不蓋住手牌 dock（320×480 例外：面板本身列出全部
手牌，允許蓋到 dock）。

畫面斷言只覆蓋這次修改的 UI 狀態；規則本身由 packages/rules/test/seven.test.ts
與 packages/web/test 的單元測試負責。只拍照，不做完整對局驗證。
"""
import os
import sys
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3000')
if len(sys.argv) != 2:
    sys.exit('usage: discard-capture.py <new empty output directory>')
OUT = Path(sys.argv[1])
if OUT.exists() and any(OUT.iterdir()):
    sys.exit(f'output directory must be empty: {OUT}')
OUT.mkdir(parents=True, exist_ok=True)
errors = []
RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']


def api(context, method, path):
    response = context.request.fetch(BASE + path, method=method)
    payload = response.json()
    assert payload.get('ok'), (path, response.status, payload)
    return payload['data']


def fetch_view(context, path):
    return api(context, 'GET', path)['view']


def send(context, game_id, revision, command):
    response = context.request.post(
        f'{BASE}/api/games/{game_id}/commands',
        data={'commandId': str(uuid.uuid4()), 'expectedRevision': revision, 'command': command},
    )
    payload = response.json()
    return bool(payload.get('ok')) and payload['data']['outcome'] == 'accepted'


def settle(page):
    page.wait_for_timeout(500)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


def shot(page, name):
    settle(page)
    page.screenshot(path=str(OUT / f'{name}.png'), animations='disabled')
    print('CAPTURE', f'{name}.png', flush=True)


def prompt_layout(page):
    return page.evaluate("""() => {
      const q = (selector) => document.querySelector(selector);
      const rect = (element) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      };
      const messages = q('.game__messages');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        messages: messages
          ? { rect: rect(messages), height: messages.clientHeight, scrollHeight: messages.scrollHeight }
          : null,
        prompt: rect(q('[data-testid="required-action-prompt"]')),
        cards: [...document.querySelectorAll('[data-testid^="discard-add-"]')].map(rect),
        submit: rect(q('[data-testid="discard-submit"]')),
        hand: rect(q('[data-testid="hand-panel"]')),
      };
    }""")


def assert_prompt_fits(page, label, allow_hand_overlap=False):
    # 必要回應必須完整落在訊息區內，包含最下方的送出按鈕；不能只剩上半部。
    data = prompt_layout(page)
    assert data['messages'] is not None, (label, data)
    assert data['prompt'] is not None, (label, data)
    assert data['submit'] is not None, (label, data)
    assert data['messages']['scrollHeight'] <= data['messages']['height'] + 1, (label, data)
    for item in ('prompt', 'submit'):
        assert data[item]['top'] >= data['messages']['rect']['top'] - 1, (label, item, data)
        assert data[item]['bottom'] <= data['messages']['rect']['bottom'] + 1, (label, item, data)
        assert data[item]['left'] >= data['messages']['rect']['left'] - 1, (label, item, data)
        assert data[item]['right'] <= data['messages']['rect']['right'] + 1, (label, item, data)
        assert data[item]['bottom'] <= data['viewport']['height'] + 1, (label, item, data)
    # 五種資源卡都要完整可見，不能被訊息區裁掉。
    assert len(data['cards']) == 5, (label, data)
    for card in data['cards']:
        assert card['top'] >= data['messages']['rect']['top'] - 1, (label, card, data)
        assert card['bottom'] <= data['messages']['rect']['bottom'] + 1, (label, card, data)
        assert card['left'] >= data['messages']['rect']['left'] - 1, (label, card, data)
        assert card['right'] <= data['messages']['rect']['right'] + 1, (label, card, data)
    # 不可蓋住手牌 dock；手牌是下一個可操作區域。
    if data['hand'] is not None and not allow_hand_overlap:
        assert data['prompt']['bottom'] <= data['hand']['top'] + 1, (label, data)
        assert data['submit']['bottom'] <= data['hand']['top'] + 1, (label, data)
    print('FITS', label, {key: data[key] for key in ('viewport', 'messages', 'prompt', 'submit', 'hand')}, flush=True)


def resources_of(context, path, pid):
    view = fetch_view(context, path)
    return next(p for p in view['players'] if p['id'] == pid)['resources']


def resolve_pending(contexts, identity, path, game_id):
    """Submit one legal move for the current pending effect. Returns after a move."""
    by_id = dict(zip(identity, contexts))
    snapshot = api(contexts[0], 'GET', path)
    view, revision = snapshot['view'], snapshot['revision']
    pending = view['pending']
    candidates = []
    if pending['kind'] == 'discard':
        for pid in pending['waitingFor']:
            resources = resources_of(by_id[pid], path, pid)
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
        raise AssertionError(f'unhandled pending: {pending}')
    if not any(send(c, game_id, revision, m) for c, m in candidates):
        raise AssertionError(f'no legal move for {pending}')
    return pending['kind']


def advance_to_multi_discard(contexts, identity, path, game_id, limit=600):
    by_id = dict(zip(identity, contexts))
    seven_events = 0
    for _ in range(limit):
        snapshot = api(contexts[0], 'GET', path)
        view, revision = snapshot['view'], snapshot['revision']
        pending = view['pending']
        if pending is not None:
            if pending['kind'] == 'discard':
                seven_events += 1
                if len(pending['waitingFor']) >= 2:
                    print('MULTI-DISCARD', pending, flush=True)
                    return pending
            resolve_pending(contexts, identity, path, game_id)
            continue
        actor = view['turn']['playerId']
        actor_view = fetch_view(by_id[actor], path)
        hints = actor_view['hints']
        if hints['canRoll']:
            command = {'type': 'turn.roll'}
        else:
            command = {'type': 'turn.end'}
        if not send(by_id[actor], game_id, revision, command):
            raise AssertionError(f'no legal turn move for {actor}')
    raise AssertionError(f'no multi-player discard after {limit} steps ({seven_events} sevens)')


def complete_setup(contexts, identity, path, game_id):
    by_id = dict(zip(identity, contexts))
    while True:
        snapshot = api(contexts[0], 'GET', path)
        turn = snapshot['view']['turn']
        if turn['phase'] != 'setup':
            return
        actor = turn['playerId']
        hints = fetch_view(by_id[actor], path)['hints']
        road = turn['setup']['stage'] == 'road'
        command = (
            {'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]}
            if road
            else {'type': 'setup.placeBuilding', 'vertex': hints['legalSettlements'][0]}
        )
        assert send(by_id[actor], game_id, snapshot['revision'], command), command


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    contexts = [
        browser.new_context(viewport={'width': 1366, 'height': 768}, locale='zh-TW', reduced_motion='reduce')
        for _ in range(3)
    ]
    pages = [c.new_page() for c in contexts]
    for page in pages:
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(20000)

    names = ['海岸領航員', '小美', '阿卡']
    for page, name in zip(pages, names):
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
    complete_setup(contexts, identity, path, game_id)
    advance_to_multi_discard(contexts, identity, path, game_id)

    snapshot = api(contexts[0], 'GET', path)
    view = snapshot['view']
    pending = view['pending']
    waiting = pending['waitingFor']
    required = pending['required']
    print('WAITING', waiting, 'REQUIRED', required, flush=True)
    print('HANDS', {pid: sum(resources_of(dict(zip(identity, contexts))[pid], path, pid).values()) for pid in waiting}, flush=True)

    first = waiting[0]
    page = pages[identity.index(first)]
    page.locator('[data-testid=locale-switch-game]').select_option('zh-Hant')
    expect(page.get_by_test_id('discard-submit')).to_be_visible()
    resources = resources_of(dict(zip(identity, contexts))[first], path, first)
    quota = required[first]
    for resource in RESOURCES:
        expect(page.get_by_test_id(f'discard-left-{resource}')).to_have_text(str(resources[resource]))
        expect(page.get_by_test_id(f'discard-add-{resource}')).to_be_visible()
    expect(page.get_by_test_id('discard-counts')).to_have_text(f'0 / {quota}')
    expect(page.get_by_test_id('discard-submit')).to_have_text(f'還要選 {quota} 張')
    assert_prompt_fits(page, '1366x768-empty')
    shot(page, 'discard-empty-1366x768-zh-Hant')

    # 拿光一種低於配額的資源：手上變 0 並停用；從棄牌區點回一張後可以再選。
    candidates = [r for r in RESOURCES if 0 < resources[r] < quota]
    target = min(candidates, key=lambda r: resources[r]) if candidates else None
    picked = {r: 0 for r in RESOURCES}
    if target is not None:
        for _ in range(resources[target]):
            page.get_by_test_id(f'discard-add-{target}').click()
        picked[target] = resources[target]
        expect(page.get_by_test_id(f'discard-left-{target}')).to_have_text('0')
        expect(page.get_by_test_id(f'discard-add-{target}')).to_have_attribute('aria-disabled', 'true')
        page.get_by_test_id('discard-slot-0').click()
        expect(page.get_by_test_id(f'discard-left-{target}')).to_have_text('1')
        expect(page.get_by_test_id(f'discard-add-{target}')).to_have_attribute('aria-disabled', 'false')
        page.get_by_test_id(f'discard-add-{target}').click()
        expect(page.get_by_test_id('discard-counts')).to_have_text(f'{resources[target]} / {quota}')
        assert_prompt_fits(page, '1366x768-owned-cap')
        shot(page, 'discard-owned-cap-1366x768-zh-Hant')
    else:
        print('SKIP per-resource cap: every held pile reaches the quota', flush=True)

    # Second waiting player: phone, then every short viewport, with a few picks.
    other = waiting[1]
    other_page = pages[identity.index(other)]
    other_page.locator('[data-testid=locale-switch-game]').select_option('zh-Hant')
    other_resources = resources_of(dict(zip(identity, contexts))[other], path, other)
    expect(other_page.get_by_test_id('discard-submit')).to_be_visible()
    held = [r for r in RESOURCES if other_resources[r] > 0]
    for resource in held[:2]:
        other_page.get_by_test_id(f'discard-add-{resource}').click()
    other_page.set_viewport_size({'width': 390, 'height': 844})
    assert_prompt_fits(other_page, '390x844-selecting')
    shot(other_page, 'discard-selecting-390x844-zh-Hant')
    for width, height in [(844, 390), (667, 375), (640, 360), (568, 320), (320, 480)]:
        other_page.set_viewport_size({'width': width, 'height': height})
        assert_prompt_fits(other_page, f'{width}x{height}-selecting', allow_hand_overlap=(width, height) == (320, 480))
        if (width, height) in [(844, 390), (320, 480)]:
            shot(other_page, f'discard-selecting-{width}x{height}-zh-Hant')

    # Finish the first player's selection (respecting each cap) and submit.
    remaining = quota - sum(picked.values())
    for resource in RESOURCES:
        if remaining <= 0:
            break
        if resource == target:
            continue
        take = min(resources[resource], remaining)
        for _ in range(take):
            page.get_by_test_id(f'discard-add-{resource}').click()
        picked[resource] += take
        remaining -= take
    assert remaining == 0, (picked, required[first])
    expect(page.get_by_test_id('discard-submit')).to_be_enabled()
    expect(page.get_by_test_id('discard-submit')).to_have_text(f'棄掉 {quota} 張')
    assert_prompt_fits(page, '1366x768-full')
    shot(page, 'discard-full-1366x768-zh-Hant')
    page.get_by_test_id('discard-submit').click()

    expect(page.get_by_test_id('discard-submit')).to_have_count(0)
    waiting_prompt = page.get_by_test_id('required-action-prompt')
    expect(waiting_prompt).to_have_attribute('data-mine', 'false')
    expect(waiting_prompt).to_contain_text('等待其他玩家棄牌')
    expect(waiting_prompt).to_contain_text(f'{names[identity.index(other)]}（{required[other]} 張）')
    expect(page.get_by_test_id('discard-add-lumber')).to_have_count(0)
    print('WAITING_BOX', waiting_prompt.bounding_box(), flush=True)
    shot(page, 'discard-waiting-1366x768-zh-Hant')

    page.set_viewport_size({'width': 390, 'height': 844})
    shot(page, 'discard-waiting-390x844-zh-Hant')

    # 英文較長：確認卡名與按鈕文字在手機直屏不溢出。
    other_page.locator('[data-testid=locale-switch-game]').select_option('en')
    other_page.set_viewport_size({'width': 390, 'height': 844})
    expect(other_page.get_by_test_id('discard-submit')).to_contain_text('more')
    assert_prompt_fits(other_page, '390x844-selecting-en')
    shot(other_page, 'discard-selecting-390x844-en')

    if errors:
        print('PAGE ERRORS', errors, flush=True)
        raise SystemExit(1)
    print('OK', flush=True)
