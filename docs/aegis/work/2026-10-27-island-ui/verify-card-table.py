"""Real Chromium acceptance for the immersive card table; existing service on :3000.
Creates disposable verification identities/room, plays setup through UI, saves fresh captures.
"""
import json
import os
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3000')
ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / os.environ.get('UI_EVIDENCE_DIR', 'docs/screenshots/card-table')
OUT.mkdir(parents=True, exist_ok=True)
checks, captures, errors = [], [], []
SIZES = [(1366, 768), (800, 450), (844, 390), (768, 1024), (390, 844), (360, 640)]

def check(name, condition):
    checks.append({'name': name, 'ok': bool(condition)})
    assert condition, name

def api(context, method, path, body=None):
    response = context.request.fetch(BASE + path, method=method, data=body)
    payload = response.json()
    assert payload.get('ok'), (path, response.status, payload)
    return payload['data']

def capture(page, scenario, sizes=SIZES):
    for width, height in sizes:
        page.set_viewport_size({'width': width, 'height': height})
        for locale in ['zh-Hant', 'en']:
            page.get_by_test_id('locale-switch-game').select_option(locale)
            page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
            metrics = page.evaluate('''() => {
              const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
              const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
              return {width: innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
                duplicateIds:[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))],
                board:rect('[data-testid=board-svg]'),hand:rect('[data-testid=hand-panel]'),prompt:rect('[data-testid=required-action-prompt]'),actions:rect('[data-testid=action-bar]'),
                visibleCards: [...document.querySelectorAll('.resource-card__inspect')].map(el=>({name:el.getAttribute('aria-label'),rect:el.getBoundingClientRect().toJSON()}))};
            }''')
            label = f'{scenario}/{width}x{height}/{locale}'
            check(label+': no page overflow', metrics['documentWidth'] <= width+1 and metrics['documentHeight'] <= height+1)
            check(label+': unique ids', not metrics['duplicateIds'])
            check(label+': board visible', metrics['board']['height'] >= 100)
            check(label+': all five named cards', len(metrics['visibleCards']) == 5 and all(c['name'] for c in metrics['visibleCards']))
            check(label+': prompt inside viewport', metrics['prompt']['y'] >= 0 and metrics['prompt']['bottom'] <= height)
            check(label+': hand fully inside viewport', metrics['hand']['y'] >= 0 and metrics['hand']['bottom'] <= height and metrics['documentHeight'] <= height+1)
            filename = f'{scenario}-{width}x{height}-{locale}.png'
            page.screenshot(path=str(OUT/filename), animations='disabled')
            captures.append({'scenario':scenario,'viewport':[width,height],'locale':locale,'screenshot':str((OUT/filename).relative_to(ROOT)),'metrics':metrics})
            print('CAPTURE', filename, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    contexts = [browser.new_context(viewport={'width':1366,'height':768}, locale='zh-TW', reduced_motion='reduce') for _ in range(3)]
    pages = [c.new_page() for c in contexts]
    for page, name in zip(pages, ['海岸領航員', '小美', 'ABCDEFGHIJKLMNOPQRSTUVWX']):
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(12000)
        page.goto(BASE)
        page.get_by_test_id('nickname-input').fill(name)
        page.locator('form button[type=submit]').click()
        expect(page.get_by_test_id('create-room')).to_be_visible()
        metrics = page.evaluate('() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight })')
        check(f'{name}: home has no document overflow', metrics['documentWidth'] <= metrics['width'] + 1 and metrics['documentHeight'] <= metrics['height'] + 1)
        check(f'{name}: base room defaults to three seats', page.locator('#room-capacity').input_value() == '3')
    host = pages[0]
    host.locator('#room-capacity').select_option('3')
    host.get_by_test_id('create-room').click()
    code = host.get_by_test_id('room-code').inner_text()
    lobby_metrics = host.evaluate('() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight })')
    check('lobby has no document overflow', lobby_metrics['documentWidth'] <= lobby_metrics['width'] + 1 and lobby_metrics['documentHeight'] <= lobby_metrics['height'] + 1)
    for page in pages[1:]:
        page.locator('#join-code').fill(code)
        page.get_by_test_id('join-room').click()
        expect(page.get_by_test_id('toggle-ready')).to_be_visible()
    for page in pages:
        page.get_by_test_id('toggle-ready').click()
    expect(host.get_by_test_id('start-game')).to_be_enabled()
    host.get_by_test_id('start-game').click()
    expect(host.get_by_test_id('board-svg')).to_be_visible()
    expect(host.get_by_test_id('setup-guide')).to_be_visible()
    guide_text = host.get_by_test_id('setup-guide').inner_text()
    check('setup guide names remaining placements', any(character.isdigit() for character in guide_text))
    identity = [api(c,'GET','/api/session')['player']['id'] for c in contexts]
    game_id = api(contexts[0],'GET','/api/games')['games'][0]['gameId']
    path = '/api/games/'+game_id
    snapshot = api(contexts[0],'GET',path)
    check('tools initially collapsed', host.get_by_test_id('tool-panel-trade').is_hidden())
    capture(host, '01-setup', [(1366,768),(800,450),(390,844)])
    steps = 0
    while snapshot['view']['turn']['phase'] == 'setup':
        actor_index = identity.index(snapshot['view']['turn']['playerId'])
        actor = pages[actor_index]
        actor.set_viewport_size({'width':1366,'height':768})
        current = api(contexts[actor_index],'GET',path)
        road = current['view']['turn']['setup']['stage'] == 'road'
        index = current['view']['hints']['legalRoads' if road else 'legalSettlements'][0]
        target = actor.get_by_test_id(f'target-{"edge" if road else "vertex"}-{index}')
        expect(target).to_be_visible()
        target.focus()
        target.press('Enter')
        expect(actor.get_by_test_id('selection-preview')).to_be_visible()
        if steps == 0:
            check('selection itself does not commit', api(contexts[actor_index],'GET',path)['revision'] == current['revision'])
            actor.get_by_test_id('cancel-selection').click()
            check('cancel has no side effect', api(contexts[actor_index],'GET',path)['revision'] == current['revision'])
            target.press('Enter')
        actor.get_by_test_id('confirm-selection').click()
        expect(actor.get_by_test_id('selection-preview')).to_have_count(0)
        snapshot = api(contexts[0],'GET',path)
        check('confirmed placement advances revision', snapshot['revision'] == current['revision']+1)
        steps += 1
        assert steps <= 12
    check('twelve placements complete', steps == 12)
    host.set_viewport_size({'width':1366,'height':768})
    host.get_by_test_id('locale-switch-game').select_option('zh-Hant')
    actor_index = identity.index(snapshot['view']['turn']['playerId'])
    pages[actor_index].get_by_test_id('action-roll').click()
    expect(host.locator('.board__die')).to_have_count(2)
    rolled = api(contexts[0], 'GET', path)['view']['turn']['dice']
    check('server returned two dice', len(rolled) == 2 and all(isinstance(value, int) for value in rolled))
    for page in pages:
        expect(page.get_by_test_id('dice-roll-animation')).to_contain_text(str(rolled[0]))
        expect(page.get_by_test_id('dice-roll-animation')).to_contain_text(str(rolled[1]))
    host.get_by_test_id('zoom-in').click()
    expect(host.get_by_test_id('zoom-readout')).to_contain_text('125%')
    host.get_by_test_id('reset-view').click()
    expect(host.get_by_test_id('board')).to_have_attribute('data-zoom', '1')
    # New game-card inspection is local only.
    current = api(contexts[0],'GET',path)
    host.get_by_test_id('hand-pin').click()
    card = host.get_by_test_id('resource-lumber').locator('button')
    card.click()
    expect(card).to_have_attribute('aria-pressed','true')
    check('inspection does not issue game command', api(contexts[0],'GET',path)['revision'] == current['revision'])
    host.screenshot(path=str(OUT/'03-card-inspection-1366x768-zh-Hant.png'))
    card.press('Escape')
    expect(card).to_have_attribute('aria-pressed','false')
    card.blur()
    capture(host, '02-game')
    host.set_viewport_size({'width':1366,'height':768})
    host.get_by_test_id('tool-tab-trade').click()
    host.get_by_test_id('give-add-lumber').click()
    host.get_by_test_id('tool-tab-chat').click()
    host.get_by_test_id('chat-input').fill('航向新海岸！')
    host.get_by_test_id('tool-tab-trade').click()
    check('trade draft preserved', host.get_by_test_id('give-lumber').inner_text() == '1')
    host.get_by_test_id('tool-tab-chat').click()
    check('chat draft preserved', host.get_by_test_id('chat-input').input_value() == '航向新海岸！')
    host.set_viewport_size({'width':844,'height':390})
    check('draft survives landscape resize', host.get_by_test_id('chat-input').input_value() == '航向新海岸！')
    host.get_by_test_id('chat-send').click()
    expect(host.get_by_test_id('chat-panel')).to_contain_text('航向新海岸！')
    check('mandatory prompt outside tool surface', host.locator('.game-tools__surface').get_by_test_id('required-action-prompt').count() == 0)
    host.get_by_test_id('tool-tab-chat').focus()
    host.get_by_test_id('tool-tab-chat').press('Escape')
    expect(host.get_by_test_id('tool-panel-chat')).to_be_hidden()
    expect(host.get_by_test_id('tool-tab-chat')).to_be_focused()
    host.set_viewport_size({'width':390,'height':844})
    host.get_by_test_id('tool-tab-trade').click()
    check('trade draft survives portrait resize', host.get_by_test_id('give-lumber').inner_text() == '1')
    host.screenshot(path=str(OUT/'04-trade-390x844-zh-Hant.png'))
    host.get_by_test_id('tool-close').click()
    expect(host.get_by_test_id('tool-tab-trade')).to_be_focused()
    # Browser-managed full-screen enter and external exit.
    host.set_viewport_size({'width':1366,'height':768})
    fullscreen = host.get_by_test_id('toggle-fullscreen')
    if fullscreen.is_enabled():
        fullscreen.click()
        expect(fullscreen).to_have_attribute('aria-pressed','true')
        check('actual full-screen element is game stage', host.evaluate('document.fullscreenElement?.dataset.testid === "game-stage"'))
        host.evaluate('document.exitFullscreen()')
        expect(fullscreen).to_have_attribute('aria-pressed','false')
        check('browser exit synchronizes button', fullscreen.get_attribute('aria-pressed') == 'false')
    host.get_by_test_id('table-menu').locator('summary').click()
    expect(host.get_by_test_id('save-and-leave')).to_be_visible()
    expect(host.get_by_test_id('suspend-propose')).to_be_visible()
    check('save and suspend reachable', host.get_by_test_id('save-and-leave').is_visible())
    host.get_by_test_id('table-menu').locator('summary').press('Escape')
    view = api(contexts[0],'GET',path)['view']
    check('opponent private resources absent', all('resources' not in player for player in view['players'] if player['id'] != identity[0]))
    check('no runtime exceptions', not errors)
    report = {'base':BASE,'browser':browser.version,'checks':checks,'captures':captures,'runtimeErrors':errors,'roomCode':code,'scope':'Real three-player UI setup, roll, card inspection, drafts/chat, responsive game stage and native fullscreen. No physical-device or screen-reader acceptance.'}
    (OUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(f'PASS {len(checks)} assertions; {len(captures)+2} screenshots; no browser exceptions',flush=True)
    browser.close()
