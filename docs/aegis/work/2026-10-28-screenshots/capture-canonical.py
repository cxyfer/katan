"""Recapture the canonical docs/screenshots states from the current build.

Drives a real three-player game through the existing service on :3000 (no
fixtures, no direct database writes) and saves the reviewed states at
deviceScaleFactor 2. Every page capture also asserts that the state it records
has no document overflow, no duplicate ids, and — in game — that the board,
required-action prompt and hand stay inside the viewport.
"""
import json
import os
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3000')
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / os.environ.get('UI_SHOT_DIR', 'docs/screenshots')
REPORT = HERE / 'capture-report.json'
SCALE = 2
DESKTOP = {'width': 1366, 'height': 768}
TABLET = {'width': 768, 'height': 1024}
MOBILE = {'width': 390, 'height': 844}

checks, captures, errors, notes = [], [], [], []

METRICS = '''() => {
  const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null;
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  return {
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
    board: rect('[data-testid=board-svg]'),
    prompt: rect('[data-testid=required-action-prompt]'),
    hand: rect('[data-testid=hand-panel]'),
    players: rect('[data-testid=players-panel]'),
  };
}'''


def check(name, condition):
    checks.append({'name': name, 'ok': bool(condition)})
    assert condition, name


def api(context, method, path, body=None):
    response = context.request.fetch(BASE + path, method=method, data=body)
    payload = response.json()
    assert payload.get('ok'), (method, path, response.status, payload)
    return payload['data']


def settle(page):
    page.evaluate('document.fonts.ready')
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')


def set_locale(page, locale):
    for test_id in ('locale-switch-game', 'locale-switch'):
        switch = page.get_by_test_id(test_id).first
        if switch.count() and switch.is_visible():
            switch.select_option(locale)
            settle(page)
            return
    raise AssertionError(f'no visible locale switch on {page.url}')


def shot(page, name, target=None, game=False):
    settle(page)
    metrics = page.evaluate(METRICS)
    check(f'{name}: no horizontal overflow', metrics['scrollWidth'] <= metrics['width'] + 1)
    if game:
        check(f'{name}: the game table fits the viewport', metrics['scrollHeight'] <= metrics['height'] + 1)
    else:
        check(f'{name}: the document height is measured, not clipped', metrics['scrollHeight'] >= metrics['height'])
    check(f'{name}: unique ids', not metrics['duplicateIds'])
    if game:
        check(f'{name}: board visible', metrics['board'] is not None and metrics['board']['height'] >= 100)
        check(f'{name}: board inside viewport', metrics['board']['bottom'] <= metrics['height'] + 1)
        if metrics['prompt'] is not None:
            check(f'{name}: required prompt inside viewport', metrics['prompt']['top'] >= 0 and metrics['prompt']['bottom'] <= metrics['height'])
        check(f'{name}: hand inside viewport', metrics['hand']['bottom'] <= metrics['height'] + 1)
    path = OUT / f'{name}.png'
    # 遊戲桌固定為視窗高度；入口頁目前高於 768，完整文件才不會截掉內容。
    full_page = not game and target is None
    if target is not None:
        target.screenshot(path=str(path), animations='disabled')
    else:
        page.screenshot(path=str(path), animations='disabled', full_page=full_page)
    captures.append({
        'file': str(path.relative_to(ROOT)),
        'viewport': [metrics['width'], metrics['height']],
        'document': [metrics['scrollWidth'], metrics['scrollHeight']],
        'fullPage': full_page,
        'deviceScaleFactor': SCALE,
        'element': target is not None,
        'metrics': metrics,
    })
    print('CAPTURE', name, flush=True)


def expand_hand(page, pin=False):
    panel = page.get_by_test_id('hand-panel')
    if pin and page.get_by_test_id('hand-pin').get_attribute('aria-pressed') != 'true':
        page.get_by_test_id('hand-pin').click()
    if panel.get_attribute('data-expanded') != 'true':
        page.get_by_test_id('hand-toggle').click()
    expect(panel).to_have_attribute('data-expanded', 'true')


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    contexts = [
        browser.new_context(viewport=DESKTOP, locale='zh-TW', reduced_motion='reduce', device_scale_factor=SCALE)
        for _ in range(3)
    ]
    pages = [context.new_page() for context in contexts]
    for page in pages:
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(15000)
        page.goto(BASE)
        expect(page.get_by_test_id('nickname-input')).to_be_visible()

    host = pages[0]
    set_locale(host, 'zh-Hant')
    shot(host, '01-entry-zh')
    check('entry keeps the nickname field empty', host.get_by_test_id('nickname-input').input_value() == '')

    for page, nickname in zip(pages, ['海岸領航員', '小美', '林默娘']):
        page.get_by_test_id('nickname-input').fill(nickname)
        page.locator('form button[type=submit]').click()
        expect(page.get_by_test_id('create-room')).to_be_visible()
    set_locale(host, 'zh-Hant')
    shot(host, '02-home-zh')

    host.locator('#room-capacity').select_option('3')
    host.get_by_test_id('create-room').click()
    code = host.get_by_test_id('room-code').inner_text()
    for page in pages[1:]:
        page.locator('#join-code').fill(code)
        page.get_by_test_id('join-room').click()
        expect(page.get_by_test_id('toggle-ready')).to_be_visible()
    expect(host.get_by_test_id('lobby-seats').locator('li')).to_have_count(3)
    host.get_by_test_id('toggle-ready').click()
    pages[1].get_by_test_id('toggle-ready').click()
    expect(host.get_by_test_id('start-game')).to_be_disabled()
    expect(host.get_by_test_id('start-blockers')).to_be_visible()
    check('the lobby names at least one start blocker', host.get_by_test_id('start-blockers').locator('li').count() >= 1)
    set_locale(host, 'zh-Hant')
    shot(host, '03-lobby-zh')

    pages[2].get_by_test_id('toggle-ready').click()
    expect(host.get_by_test_id('start-game')).to_be_enabled()
    host.get_by_test_id('start-game').click()
    expect(host.get_by_test_id('board-svg')).to_be_visible()
    expect(host.get_by_test_id('setup-guide')).to_be_visible()
    set_locale(host, 'zh-Hant')
    shot(host, '04-setup-zh', game=True)

    identity = [api(context, 'GET', '/api/session')['player']['id'] for context in contexts]
    game_id = api(contexts[0], 'GET', '/api/games')['games'][0]['gameId']
    path = f'/api/games/{game_id}'
    snapshot = api(contexts[0], 'GET', path)

    steps = 0
    while snapshot['view']['turn']['phase'] == 'setup':
        actor_index = identity.index(snapshot['view']['turn']['playerId'])
        actor = pages[actor_index]
        actor.set_viewport_size(DESKTOP)
        current = api(contexts[actor_index], 'GET', path)
        road = current['view']['turn']['setup']['stage'] == 'road'
        index = current['view']['hints']['legalRoads' if road else 'legalSettlements'][0]
        target = actor.get_by_test_id(f'target-{"edge" if road else "vertex"}-{index}')
        expect(target).to_be_visible()
        target.focus()
        target.press('Enter')
        expect(actor.get_by_test_id('selection-preview')).to_be_visible()
        if steps == 0:
            check('selecting a placement does not commit it', api(contexts[actor_index], 'GET', path)['revision'] == current['revision'])
            actor.get_by_test_id('cancel-selection').click()
            check('cancelling a placement has no side effect', api(contexts[actor_index], 'GET', path)['revision'] == current['revision'])
            target.press('Enter')
        actor.get_by_test_id('confirm-selection').click()
        expect(actor.get_by_test_id('selection-preview')).to_have_count(0)
        snapshot = api(contexts[0], 'GET', path)
        check('confirmed placement advances the revision', snapshot['revision'] == current['revision'] + 1)
        steps += 1
        assert steps <= 12
    check('all twelve opening placements go through the UI', steps == 12 and snapshot['view']['turn']['phase'] == 'preroll')

    actor_index = identity.index(snapshot['view']['turn']['playerId'])
    pages[actor_index].set_viewport_size(DESKTOP)
    pages[actor_index].get_by_test_id('action-roll').click()
    expect(host.locator('.board__die')).to_have_count(2)
    rolled = api(contexts[0], 'GET', path)['view']['turn']['dice']
    check('the roll is a server outcome', len(rolled) == 2)

    host.set_viewport_size(DESKTOP)
    set_locale(host, 'zh-Hant')
    expand_hand(host)
    expect(host.get_by_test_id('tool-panel-trade')).to_be_hidden()
    shot(host, '05-table-zh', game=True)

    other = pages[1]
    other.set_viewport_size(DESKTOP)
    set_locale(other, 'zh-Hant')
    expand_hand(other)
    expect(other.get_by_test_id('board-svg')).to_be_visible()
    other_view = api(contexts[1], 'GET', path)['view']
    check(
        'the other seat projection hides every opponent resource pile',
        all('resources' not in player for player in other_view['players'] if player['id'] != identity[1]),
    )
    check('the other seat still sees its own resource cards', other.locator('.resource-card').count() == 5)
    shot(other, '06-other-seat-zh', game=True)

    set_locale(host, 'en')
    shot(host, '08-table-en', game=True)
    set_locale(host, 'zh-Hant')

    host.get_by_test_id('tool-tab-trade').click()
    host.get_by_test_id('give-add-lumber').click()
    check('the structured trade builder records the added resource', host.get_by_test_id('give-lumber').inner_text() == '1')
    shot(host, '07a-trade-panel-zh', target=host.get_by_test_id('tool-panel-trade'))

    host.get_by_test_id('tool-tab-chat').click()
    message = '準備航向新海岸'
    host.get_by_test_id('chat-input').fill(message)
    host.get_by_test_id('chat-send').click()
    expect(host.get_by_test_id('chat-panel')).to_contain_text(message)
    shot(host, '07b-chat-panel-zh', target=host.get_by_test_id('tool-panel-chat'))

    host.get_by_test_id('tool-tab-log').click()
    expect(host.get_by_test_id('event-list')).to_be_visible()
    shot(host, '15-panel-log', target=host.get_by_test_id('event-log'))
    host.get_by_test_id('tool-close').click()
    expect(host.get_by_test_id('tool-panel-log')).to_be_hidden()

    devcard = host.get_by_test_id('action-build.devCard')
    owner = None
    for page in pages:
        button = page.get_by_test_id('action-build.devCard')
        if button.count() and button.is_enabled():
            button.click()
            settle(page)
            check('the bought development card reaches the hand', page.get_by_test_id('devcards-panel').locator('.card-list li').count() >= 1)
            owner = page
            print('BOUGHT a development card for 14-panel-devcards', flush=True)
            break
    if owner is None:
        check(
            'the empty development area states that no card is held',
            host.get_by_test_id('devcards-panel').locator('p.muted').count() >= 1,
        )
        notes.append('No seat could afford a development card in this deal; 14-panel-devcards records the empty development area.')
        print('SKIP development-card purchase: no seat could afford one in this deal', flush=True)

    if host.get_by_test_id('players-panel').get_attribute('data-expanded') != 'true':
        host.get_by_test_id('players-toggle').click()
    expect(host.get_by_test_id('players-panel')).to_have_attribute('data-expanded', 'true')
    shot(host, '12-panel-seats', target=host.get_by_test_id('players-panel'))

    expand_hand(host, pin=True)
    check('the pinned hand stays expanded', host.get_by_test_id('hand-panel').get_attribute('data-expanded') == 'true')
    shot(host, '13-panel-hand', target=host.get_by_test_id('hand-panel'))
    devcards_page = owner or host
    if devcards_page is not host:
        devcards_page.set_viewport_size(DESKTOP)
        expand_hand(devcards_page, pin=True)
    shot(devcards_page, '14-panel-devcards', target=devcards_page.get_by_test_id('devcards-panel'))
    shot(host, '16-panel-actions', target=host.get_by_test_id('action-bar'))

    legend = host.get_by_test_id('board').get_by_test_id('legend')
    if not legend.evaluate('el => el.open'):
        legend.locator('summary').click()
    check('the legend reports itself open', legend.evaluate('el => el.open'))
    shot(host, '17-panel-legend', target=legend)
    legend.locator('summary').click()

    host.set_viewport_size(MOBILE)
    set_locale(host, 'zh-Hant')
    expect(host.get_by_test_id('mobile-drawer')).to_have_count(0)
    shot(host, '09-mobile-table-zh', game=True)

    host.get_by_test_id('tool-tab-trade').click()
    shot(host, '10-mobile-tools-zh', game=True)
    for panel in ('trade', 'chat', 'log', 'help'):
        if host.get_by_test_id(f'tool-panel-{panel}').is_hidden():
            host.get_by_test_id(f'tool-tab-{panel}').click()
        expect(host.get_by_test_id(f'tool-panel-{panel}')).to_be_visible()
        shot(host, f'19-mobile-tool-{panel}', target=host.locator('.game-tools__surface'))
    host.get_by_test_id('tool-close').click()

    host.set_viewport_size(TABLET)
    set_locale(host, 'zh-Hant')
    shot(host, '11-tablet-zh', game=True)

    check('no browser runtime exceptions', not errors)
    report = {
        'base': BASE,
        'browser': browser.version,
        'deviceScaleFactor': SCALE,
        'scope': 'Real three-player game driven through the UI; no fixtures and no direct database writes. Captures are review states, not visual-regression baselines.',
        'captures': captures,
        'checks': checks,
        'runtimeErrors': errors,
        'notes': notes,
        'visualReview': 'Captured at deviceScaleFactor 2; the capture model has no image input, so no subjective visual approval is claimed.',
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'PASS {len(checks)} assertions; {len(captures)} screenshots; no browser runtime exceptions', flush=True)
    browser.close()
