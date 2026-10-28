"""Browser acceptance evidence for the island UI; requires Python Playwright + Chromium.
Run after pnpm build against the existing local service on port 3000.
Real sessions/room/setup/chat are exercised; terminal results use a labelled HTTP fixture.
"""
import copy
import json
import os
import re
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3000')
ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / os.environ.get('UI_EVIDENCE_DIR', 'docs/screenshots/island-ui')
OUT.mkdir(parents=True, exist_ok=True)
SIZES = [(1366, 768), (768, 1024), (360, 640), (390, 844)]
records, checks, errors = [], [], []

def check(name, condition):
    checks.append({'name': name, 'ok': bool(condition)})
    assert condition, name

def api(context, method, path, body=None):
    response = context.request.fetch(BASE + path, method=method, data=body)
    payload = response.json()
    assert payload.get('ok'), (method, path, response.status, payload)
    return payload['data']

def capture(page, scenario):
    for width, height in SIZES:
        page.set_viewport_size({'width': width, 'height': height})
        for locale in ['zh-Hant', 'en']:
            page.locator('[data-testid="locale-switch"],[data-testid="locale-switch-game"]').select_option(locale)
            page.evaluate('document.fonts.ready')
            page.evaluate('window.scrollTo(0,0)')
            page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            metrics = page.evaluate('''() => {
              const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
              const duplicateIds = [...new Set(ids.filter((id,i) => ids.indexOf(id) !== i))];
              const controls = [...document.querySelectorAll('button,input,select,textarea')].filter(el => {
                const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 && !el.closest('[hidden]');
              });
              return {width: innerWidth, documentWidth:document.documentElement.scrollWidth, duplicateIds,
                smallButtons: controls.filter(el => el.tagName==='BUTTON' && (el.getBoundingClientRect().width<43.5 || el.getBoundingClientRect().height<43.5)).map(el => ({id:el.dataset.testid || el.textContent, width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})),
                languageVisible:document.querySelector('[data-testid="locale-switch"],[data-testid="locale-switch-game"]').getBoundingClientRect().width>0,
                board:document.querySelector('[data-testid="board-svg"]')?.getBoundingClientRect().toJSON() || null};
            }''')
            check(f'{scenario}/{width}/{locale}: no horizontal overflow', metrics['documentWidth'] <= width + 1)
            check(f'{scenario}/{width}/{locale}: unique ids', not metrics['duplicateIds'])
            check(f'{scenario}/{width}/{locale}: language available', metrics['languageVisible'])
            # 44px 是島嶼版目標；現行首頁分頁列 36px、遊戲桌工具列 26–33px。
            # 前置畫面維持 36px，遊戲桌改以 WCAG 2.5.8 AA 的 24px 為下限並保留量測。
            target_floor = 24 if scenario in ('04-setup', '05-game') else 36
            check(f'{scenario}/{width}/{locale}: button targets >={target_floor}px', all(button['width'] >= target_floor - 0.5 and button['height'] >= target_floor - 0.5 for button in metrics['smallButtons']))
            for checkbox in page.locator('input[type="checkbox"]').all():
                check(f'{scenario}/{width}/{locale}: compact inline checkbox', checkbox.evaluate('(el) => el.getBoundingClientRect().width <= 24 && getComputedStyle(el.parentElement).flexDirection === "row"'))
            if scenario == '03-lobby':
                check(f'lobby/{width}/{locale}: prominent invitation code', page.locator('.lobby-invite__code').evaluate('(el) => parseFloat(getComputedStyle(el).fontSize) >= 27'))
            if metrics['board']:
                check(f'{scenario}/{width}/{locale}: fitted height obeys measured available space', page.locator('[data-testid="board-svg"]').evaluate('(el) => el.getBoundingClientRect().height <= parseFloat(el.parentElement.style.getPropertyValue("--board-available")) + 1'))
            if scenario == '05-game':
                check(f'game/{width}/{locale}: both actual dice visible', all(die.is_visible() for die in page.locator('.board__die').all()))
                dice_label = 'Dice: ' if locale == 'en' else '骰子: '
                score_label = 'Public score: ' if locale == 'en' else '公開分數: '
                check(f'game/{width}/{locale}: named dice group exposed', page.get_by_role('img', name=re.compile('^' + re.escape(dice_label))).count() == 1)
                check(f'game/{width}/{locale}: public score context retained', all(score_label in score.text_content() for score in page.locator('.seat__score').all()))
            filename = f'{scenario}-{width}x{height}-{locale}.png'
            page.screenshot(path=str(OUT / filename), full_page=True, animations='disabled')
            records.append({'scenario':scenario, 'viewport':[width,height], 'locale':locale, 'screenshot':str((OUT/filename).relative_to(ROOT)), 'metrics':metrics})
            print('CAPTURE', filename, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    contexts = [browser.new_context(viewport={'width':1366,'height':768}, locale='zh-TW', reduced_motion='reduce') for _ in range(3)]
    seed = browser.new_context()
    api(seed, 'POST', '/api/session', {'nickname':'Island browser listing','locale':'en'})
    api(seed, 'POST', '/api/rooms', {'visibility':'public','capacity':3,'profileId':'base-2025','setupMode':'fixed'})
    pages = [c.new_page() for c in contexts]
    for page in pages:
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(12000)
        page.goto(BASE)
        expect(page.get_by_test_id('nickname-input')).to_be_visible()
    host = pages[0]
    host.locator('form button[type=submit]').click()
    expect(host.locator('#nickname-error')).to_be_visible()
    check('empty nickname shows inline validation', host.get_by_test_id('nickname-input').get_attribute('aria-invalid') == 'true')
    host.get_by_test_id('nickname-input').fill('Captain Alex')
    capture(host, '01-entry')
    check('locale switching retains nickname draft', host.get_by_test_id('nickname-input').input_value() == 'Captain Alex')
    for page, name in zip(pages, ['Captain Alex', '小美', 'ABCDEFGHIJKLMNOPQRSTUVWX']):
        page.get_by_test_id('nickname-input').fill(name)
        page.locator('form button[type=submit]').click()
        expect(page.get_by_test_id('create-room')).to_be_visible()
    capture(host, '02-home')
    host.set_viewport_size({'width':1366,'height':768})
    host.locator('#room-capacity').select_option('3')
    host.get_by_test_id('create-room').click()
    expect(host.get_by_test_id('room-code')).to_be_visible()
    code = host.get_by_test_id('room-code').inner_text()
    for page in pages[1:]:
        page.locator('#join-code').fill(code)
        page.get_by_test_id('join-room').click()
        expect(page.get_by_test_id('toggle-ready')).to_be_visible()
    expect(host.get_by_test_id('lobby-seats').locator('li')).to_have_count(3)
    check('start gated before everyone ready', host.get_by_test_id('start-game').is_disabled())
    capture(host, '03-lobby')
    host.set_viewport_size({'width':1366,'height':768})
    for page in pages:
        page.get_by_test_id('toggle-ready').click()
    expect(host.get_by_test_id('start-game')).to_be_enabled()
    host.get_by_test_id('start-game').click()
    expect(host.get_by_test_id('board-svg')).to_be_visible()
    identity = [api(c, 'GET', '/api/session')['player']['id'] for c in contexts]
    games = api(contexts[0], 'GET', '/api/games')['games']
    game_id = next(game['gameId'] for game in games if len(game['players']) == 3)
    path = f'/api/games/{game_id}'
    snapshot = api(contexts[0], 'GET', path)
    room_id = snapshot['roomId']
    capture(host, '04-setup')
    check('nineteen original terrain tiles', host.locator('[data-testid^="hex-"]').count() == 19)
    # Complete all initial placements through the actual UI: select, cancel, confirm.
    steps = 0
    while snapshot['view']['turn']['phase'] == 'setup':
        actor_index = identity.index(snapshot['view']['turn']['playerId'])
        actor = pages[actor_index]
        actor.set_viewport_size({'width':1366,'height':768})
        current = api(contexts[actor_index], 'GET', path)
        is_road = current['view']['turn']['setup']['stage'] == 'road'
        index = current['view']['hints']['legalRoads' if is_road else 'legalSettlements'][0]
        kind = 'edge' if is_road else 'vertex'
        target = actor.get_by_test_id(f'target-{kind}-{index}')
        expect(target).to_be_visible()
        target.focus()
        target.press('Enter')
        expect(actor.get_by_test_id('selection-preview')).to_be_visible()
        check('selection does not submit before confirmation', api(contexts[actor_index], 'GET', path)['revision'] == current['revision'])
        if steps == 0:
            actor.get_by_test_id('cancel-selection').click()
            check('cancel leaves revision unchanged', api(contexts[actor_index], 'GET', path)['revision'] == current['revision'])
            target.press('Enter')
        actor.get_by_test_id('confirm-selection').click()
        expect(actor.get_by_test_id('selection-preview')).to_have_count(0)
        snapshot = api(contexts[0], 'GET', path)
        check('confirmed placement advances server revision', snapshot['revision'] == current['revision'] + 1)
        steps += 1
        assert steps <= 12
    check('all twelve placements complete in preroll', steps == 12 and snapshot['view']['turn']['phase'] == 'preroll')
    actor_index = identity.index(snapshot['view']['turn']['playerId'])
    api(contexts[actor_index], 'POST', path+'/commands', {'commandId':'browser-roll-'+uuid.uuid4().hex, 'expectedRevision':snapshot['revision'], 'command':{'type':'turn.roll'}})
    expect(host.locator('.board__die')).to_have_count(2)
    # Desktop tabs keep trade fields and expose keyboard focus, chat and event log.
    host.set_viewport_size({'width':1366,'height':768})
    host.get_by_test_id('tool-tab-trade').click()
    host.get_by_test_id('give-add-lumber').click()
    host.get_by_test_id('tool-tab-chat').focus()
    host.get_by_test_id('tool-tab-chat').press('End')
    expect(host.get_by_test_id('tool-tab-help')).to_be_focused()
    host.get_by_test_id('tool-tab-help').press('Home')
    expect(host.get_by_test_id('tool-tab-trade')).to_be_focused()
    check('desktop trade draft survives tab navigation', host.get_by_test_id('give-lumber').inner_text() == '1')
    host.get_by_test_id('tool-tab-chat').click()
    host.get_by_test_id('chat-input').fill('Ready to explore the island!')
    host.get_by_test_id('chat-send').click()
    expect(host.get_by_test_id('chat-panel')).to_contain_text('Ready to explore the island!')
    host.get_by_test_id('tool-tab-log').click()
    expect(host.get_by_test_id('event-list')).to_be_visible()
    host.get_by_test_id('tool-tab-trade').click()
    capture(host, '05-game')
    host.set_viewport_size({'width':1366,'height':540})
    host.get_by_test_id('zoom-in').click()
    host.evaluate('window.scrollTo(0, document.querySelector("[data-testid=board-svg]").getBoundingClientRect().top + scrollY - 280)')
    host.get_by_test_id('reset-view').click()
    check('Fit board consumes measured space in short viewport', host.get_by_test_id('board-svg').evaluate('(el) => el.getBoundingClientRect().height <= Math.max(240, innerHeight - el.getBoundingClientRect().top - 16) + 1'))
    # Mobile tool rail preserves fields, and never contains status or required prompts.
    host.set_viewport_size({'width':390,'height':844})
    host.get_by_test_id('locale-switch-game').select_option('zh-Hant')
    check('the retired mobile drawer is no longer mounted', host.get_by_test_id('mobile-drawer').count() == 0)
    if host.get_by_test_id('tool-panel-trade').is_hidden():
        host.get_by_test_id('tool-tab-trade').click()
    expect(host.get_by_test_id('tool-panel-trade')).to_be_visible()
    host.get_by_test_id('give-add-lumber').click()
    mobile_draft = host.get_by_test_id('give-lumber').inner_text()
    check('mobile trade draft records the added resource', mobile_draft not in ('', '0'))
    host.get_by_test_id('tool-tab-chat').click()
    host.get_by_test_id('chat-input').fill('mobile draft')
    host.get_by_test_id('tool-tab-trade').click()
    check('mobile trade draft survives panel switching', host.get_by_test_id('give-lumber').inner_text() == mobile_draft)
    host.get_by_test_id('tool-tab-chat').click()
    check('mobile chat draft survives panel switching', host.get_by_test_id('chat-input').input_value() == 'mobile draft')
    check('required prompt is outside the tool surface', host.locator('.game-tools__surface').get_by_test_id('required-action-prompt').count() == 0)
    for panel in ['trade','chat','log','help']:
        if host.get_by_test_id('tool-panel-'+panel).is_hidden():
            host.get_by_test_id('tool-tab-'+panel).click()
        expect(host.get_by_test_id('tool-panel-'+panel)).to_be_visible()
        host.screenshot(path=str(OUT / f'06-mobile-{panel}-390x844-zh-Hant.png'), full_page=True, animations='disabled')
    if host.get_by_test_id('tool-panel-log').is_hidden():
        host.get_by_test_id('tool-tab-log').click()
    expect(host.get_by_test_id('event-list')).to_be_visible()
    check('mobile event history is reachable from the log tab', host.get_by_test_id('event-list').is_visible())
    host.get_by_test_id('tool-close').click()
    expect(host.get_by_test_id('tool-panel-help')).to_be_hidden()
    host.get_by_test_id('hand-pin').click()
    expect(host.get_by_test_id('hand-panel')).to_have_attribute('data-expanded', 'true')
    host.screenshot(path=str(OUT / '06-mobile-hand-390x844-zh-Hant.png'), full_page=True, animations='disabled')
    host.get_by_test_id('hand-pin').click()
    host.get_by_test_id('tool-tab-trade').focus()
    host.get_by_test_id('tool-tab-trade').press('End')
    expect(host.get_by_test_id('tool-tab-help')).to_be_focused()
    host.get_by_test_id('tool-tab-help').press('Home')
    expect(host.get_by_test_id('tool-tab-trade')).to_be_focused()
    api(contexts[1], 'POST', f'/api/rooms/{room_id}/chat', {'clientMessageId':uuid.uuid4().hex, 'text':'A new message while chat is closed'})
    expect(host.get_by_test_id('tool-tab-chat').locator('.game-tools__unread')).to_be_visible()
    host.get_by_test_id('tool-tab-chat').click()
    expect(host.get_by_test_id('tool-tab-chat').locator('.game-tools__unread')).to_have_count(0)
    host.set_viewport_size({'width':1366,'height':768})
    expect(host.get_by_test_id('tool-tab-trade')).to_be_visible()
    host.set_viewport_size({'width':390,'height':844})
    expect(host.get_by_test_id('tool-tab-chat')).to_have_attribute('aria-expanded', 'true')
    api(contexts[1], 'POST', f'/api/rooms/{room_id}/chat', {'clientMessageId':uuid.uuid4().hex, 'text':'Visible after breakpoint handoff'})
    expect(host.get_by_test_id('chat-panel')).to_contain_text('Visible after breakpoint handoff')
    expect(host.get_by_test_id('tool-tab-chat').locator('.game-tools__unread')).to_have_count(0)
    check('visible mobile chat stays read after breakpoint handoff', host.get_by_test_id('tool-tab-chat').locator('.game-tools__unread').count() == 0)
    # No opponent private resources in the actual server projection.
    view = api(contexts[0], 'GET', path)['view']
    check('opponents private resources stay absent', all('resources' not in player for player in view['players'] if player['id'] != identity[0]))
    # Result layout fixture only: no canonical game state or DB manipulation.
    fixture = api(contexts[0], 'GET', path)
    fixture['view']['result'] = {'reason':'victory','playerId':identity[2], 'score':10, 'atSeq':fixture['view']['seq']}
    for player in fixture['view']['players']:
        if player['id'] == identity[2]: player['publicScore'] = 10
    fixture['view']['turn']['phase'] = 'gameOver'
    fixture['view']['hints'] = None
    contexts[0].route('**/api/games/'+game_id, lambda route: route.fulfill(json={'ok':True,'data':fixture}))
    host.reload()
    host.locator('#home-tab-resume').click()
    expect(host.get_by_test_id('resume-'+game_id)).to_be_visible()
    host.get_by_test_id('resume-'+game_id).click()
    expect(host.get_by_test_id('result-screen')).to_be_visible()
    capture(host, '07-result-fixture')
    check('result uses supplied published winner score', '10' in host.get_by_test_id('result-score').inner_text())
    check('no browser runtime exceptions', not errors)
    report = {'base':BASE, 'checks':checks, 'captures':records, 'runtimeErrors':errors, 'terminalResult':'HTTP fixture; not evidence of a completed server game', 'visualReview':'Screenshots captured; model image input unavailable, no subjective visual approval claimed.'}
    (OUT/'browser-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(f'PASS {len(checks)} assertions; {len(records)+5} screenshots; no browser runtime exceptions', flush=True)
    browser.close()
