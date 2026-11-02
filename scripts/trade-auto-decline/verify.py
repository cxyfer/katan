"""Verify the trade panel's opt-in automatic decline in a real browser.

Prerequisite (from the repository root):

    pnpm build
    PORT=3112 SQLITE_PATH=.tmp/trade-auto-decline.sqlite \
      WEB_DIST_PATH=packages/web/dist node packages/server/dist/server.mjs

Then:

    python3 scripts/trade-auto-decline/verify.py <new empty output directory>

The script seats three players in a real room. The recipient's browser starts
with `catan.trade.autoDecline` already stored and its trade panel closed. A
table-wide offer nobody can cover is proposed through the API; the recipient's
client must decline it without any pointer or keyboard input. A second,
affordable offer must stay unanswered. Finally the checkbox is read, toggled
and captured on desktop and phone widths.
"""

import json
import os
import sys
import time
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3112')
RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']
STORAGE_KEY = 'catan.trade.autoDecline'

if len(sys.argv) != 2:
    sys.exit('usage: verify.py <new empty output directory>')
OUT = Path(sys.argv[1])
if OUT.exists() and any(OUT.iterdir()):
    sys.exit(f'output directory must be empty: {OUT}')
OUT.mkdir(parents=True, exist_ok=True)
ERRORS = []
RESULTS = []


def api(context, method, path, data=None):
    response = context.request.fetch(BASE + path, method=method, data=data)
    payload = response.json()
    assert payload.get('ok'), (path, response.status, payload)
    return payload['data']


def fetch(context, path):
    return api(context, 'GET', path)


def send(context, game_id, revision, command):
    response = context.request.post(
        f'{BASE}/api/games/{game_id}/commands',
        data={'commandId': str(uuid.uuid4()), 'expectedRevision': revision, 'command': command},
    )
    payload = response.json()
    return bool(payload.get('ok')) and payload['data']['outcome'] == 'accepted'


def shot(page, name):
    page.wait_for_timeout(250)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    page.screenshot(path=str(OUT / f'{name}.png'), animations='disabled')
    print('CAPTURE', f'{name}.png', flush=True)


def response_of(snapshot, offer_id, player_id):
    offer = next(candidate for candidate in snapshot['view']['offers'] if candidate['id'] == offer_id)
    return offer['responses'].get(player_id)


def wait_for(predicate, timeout=15.0, interval=0.2):
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        value = predicate()
        if value:
            return time.monotonic() - started
        time.sleep(interval)
    return None


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    contexts = [
        browser.new_context(viewport={'width': 1366, 'height': 768}, locale='zh-TW', reduced_motion='reduce')
        for _ in range(3)
    ]
    # The recipient already turned the option on in an earlier session.
    contexts[1].add_init_script(f"localStorage.setItem('{STORAGE_KEY}', 'true')")
    pages = [context.new_page() for context in contexts]
    for page in pages:
        page.on('pageerror', lambda error: ERRORS.append(str(error)))

    for page, name in zip(pages, ['海岸領航員', '小美', '阿明']):
        page.goto(BASE)
        page.get_by_test_id('nickname-input').fill(name)
        page.locator('form button[type=submit]').click()
        expect(page.get_by_test_id('create-room')).to_be_visible()
    pages[0].locator('#room-capacity').select_option('3')
    pages[0].get_by_test_id('create-room').click()
    code = pages[0].get_by_test_id('room-code').inner_text()
    for page in pages[1:]:
        page.locator('#join-code').fill(code)
        page.get_by_test_id('join-room').click()
        expect(page.get_by_test_id('toggle-ready')).to_be_visible()
    for page in pages:
        page.get_by_test_id('toggle-ready').click()
    expect(pages[0].get_by_test_id('start-game')).to_be_enabled()
    pages[0].get_by_test_id('start-game').click()
    for page in pages:
        expect(page.get_by_test_id('game-stage')).to_be_visible()

    identity = [api(context, 'GET', '/api/session')['player']['id'] for context in contexts]
    by_id = dict(zip(identity, contexts))
    games = api(contexts[0], 'GET', '/api/games')['games']
    game = next((candidate for candidate in games if candidate['roomCode'] == code), None)
    assert game, games
    game_id = game['gameId']
    path = '/api/games/' + game_id

    # Finish initial placement through the API; the browser seats only observe.
    for _ in range(12):
        snapshot = fetch(contexts[0], path)
        view = snapshot['view']
        if view['turn']['phase'] != 'setup':
            break
        actor = view['turn']['playerId']
        own = fetch(by_id[actor], path)
        stage = own['view']['turn']['setup']['stage']
        command = (
            {'type': 'setup.placeBuilding', 'vertex': own['view']['hints']['legalSettlements'][0]}
            if stage == 'building'
            else {'type': 'setup.placeRoad', 'edge': own['view']['hints']['legalRoads'][0]}
        )
        assert send(by_id[actor], game_id, own['revision'], command), command
    snapshot = fetch(contexts[0], path)
    assert snapshot['view']['turn']['phase'] != 'setup', 'setup did not finish'

    turn_actor = snapshot['view']['turn']['playerId']
    turn_context = by_id[turn_actor]
    own = fetch(turn_context, path)
    assert send(turn_context, game_id, own['revision'], {'type': 'turn.roll'})

    # A seven can leave a forced choice behind; resolve it so the offers are clean.
    for _ in range(20):
        view = fetch(contexts[0], path)['view']
        pending = view['pending']
        if pending is None:
            break
        actor = pending.get('actor') or pending['waitingFor'][0]
        own = fetch(by_id[actor], path)
        revision = own['revision']
        if pending['kind'] == 'discard':
            player = next(player for player in own['view']['players'] if player['id'] == actor)
            need = pending['required'][actor]
            pool = [resource for resource in RESOURCES for _ in range(player['resources'][resource])]
            command = {'type': 'pending.discard', 'resources': pool[:need]}
        elif pending['kind'] == 'moveRobber':
            robber = own['view']['board']['robber']
            target = next(index for index in range(len(own['view']['board']['terrain'])) if index != robber)
            command = {'type': 'pending.moveRobber', 'hex': target}
        elif pending['kind'] == 'steal':
            command = {'type': 'pending.steal', 'victim': pending['candidates'][0]}
        else:
            raise AssertionError(f'unexpected pending effect after a roll: {pending}')
        assert send(by_id[actor], game_id, revision, command), command

    proposer_index = identity.index(turn_actor)
    recipient_index = next(index for index in range(3) if index != proposer_index)
    recipient_id = identity[recipient_index]

    # 1. An offer nobody can cover: five ore this early is impossible.
    own = fetch(turn_context, path)
    assert send(
        turn_context,
        game_id,
        own['revision'],
        {'type': 'trade.offer', 'to': 'all', 'give': {'wool': 1}, 'want': {'ore': 5}},
    ), 'offer rejected'
    snapshot = fetch(contexts[0], path)
    unaffordable_id = snapshot['view']['offers'][-1]['id']
    assert response_of(snapshot, unaffordable_id, recipient_id) is None
    elapsed = wait_for(
        lambda: response_of(fetch(contexts[0], path), unaffordable_id, recipient_id) == 'declined'
    )
    assert elapsed is not None, 'the recipient never auto-declined the unaffordable offer'
    print(f'PASS auto-declined {unaffordable_id} after {elapsed:.2f}s with the trade panel closed', flush=True)
    RESULTS.append({'case': 'auto-declines-unaffordable', 'offerId': unaffordable_id, 'seconds': round(elapsed, 3)})

    # 2. An offer the recipient can cover stays unanswered until they choose.
    own_recipient = fetch(by_id[recipient_id], path)
    recipient_player = next(
        player for player in own_recipient['view']['players'] if player['id'] == recipient_id
    )
    holding = next(
        (resource for resource in RESOURCES if recipient_player['resources'][resource] > 0),
        None,
    )
    assert holding, own_recipient['view']['players']
    own = fetch(turn_context, path)
    assert send(
        turn_context,
        game_id,
        own['revision'],
        {'type': 'trade.offer', 'to': 'all', 'give': {'wool': 1}, 'want': {holding: 1}},
    ), 'offer rejected'
    snapshot = fetch(contexts[0], path)
    affordable_id = snapshot['view']['offers'][-1]['id']
    time.sleep(2.5)
    snapshot = fetch(contexts[0], path)
    assert response_of(snapshot, affordable_id, recipient_id) is None, 'an affordable offer was auto-declined'
    print(f'PASS left affordable {affordable_id} unanswered', flush=True)
    RESULTS.append({'case': 'leaves-affordable-open', 'offerId': affordable_id})

    # 3. The stored preference shows up as a checked box in the trade panel.
    recipient_page = pages[recipient_index]
    recipient_page.get_by_test_id('tool-tab-trade').click()
    checkbox = recipient_page.get_by_test_id('trade-auto-decline')
    expect(checkbox).to_be_checked()
    row = recipient_page.get_by_test_id(f'offer-{unaffordable_id}')
    expect(row.locator('.response-list')).to_contain_text('拒絕')
    expect(recipient_page.get_by_test_id(f'consent-{affordable_id}')).to_be_visible()
    # The tools panel scrolls; bring the answered card (and the checkbox above
    # it) into the capture instead of leaving both below the fold.
    row.scroll_into_view_if_needed()
    shot(recipient_page, 'trade-auto-decline-1366x768-zh-Hant')
    RESULTS.append({'case': 'checkbox-and-responses', 'checked': True})

    # 4. Toggling writes the preference next to the other browser keys.
    checkbox.uncheck()
    assert recipient_page.evaluate(f"() => localStorage.getItem('{STORAGE_KEY}')") == 'false'
    checkbox.check()
    assert recipient_page.evaluate(f"() => localStorage.getItem('{STORAGE_KEY}')") == 'true'
    print('PASS checkbox persists through browser storage', flush=True)
    RESULTS.append({'case': 'checkbox-persistence', 'stored': True})

    # 5. Phone width keeps the option inside the trade tool.
    recipient_page.set_viewport_size({'width': 390, 'height': 844})
    expect(checkbox).to_be_visible()
    box = checkbox.bounding_box()
    assert box and box['x'] >= 0 and box['x'] + box['width'] <= 390, box
    shot(recipient_page, 'trade-auto-decline-390x844-zh-Hant')
    RESULTS.append({'case': 'phone-layout', 'x': round(box['x'], 1), 'width': round(box['width'], 1)})

    assert not ERRORS, f'browser runtime errors: {ERRORS}'
    (OUT / 'report.json').write_text(
        json.dumps({'base': BASE, 'gameId': game_id, 'results': RESULTS, 'errors': ERRORS}, ensure_ascii=False, indent=2)
    )
    browser.close()
    print('DONE', flush=True)
