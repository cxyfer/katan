"""Capture the trade offer card from the proposer's and recipient's seats.

Prerequisite (from the repository root):

    pnpm build
    PORT=3111 SQLITE_PATH=.tmp/trade-perspective.sqlite \
      WEB_DIST_PATH=packages/web/dist node packages/server/dist/server.mjs

Then:

    python3 scripts/trade-offer-perspective/capture.py <new empty output directory>

The script creates a temporary three-player room, finishes setup through the
API, rolls once and has the turn player propose a table-wide offer. It only
captures the two perspective shots; assertions are limited to the card text.
"""

import os
import sys
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get('UI_BASE_URL', 'http://127.0.0.1:3111')
RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']

if len(sys.argv) != 2:
    sys.exit('usage: capture.py <new empty output directory>')
OUT = Path(sys.argv[1])
if OUT.exists() and any(OUT.iterdir()):
    sys.exit(f'output directory must be empty: {OUT}')
OUT.mkdir(parents=True, exist_ok=True)


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
    page.wait_for_timeout(300)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    page.screenshot(path=str(OUT / f'{name}.png'), animations='disabled')
    print('CAPTURE', f'{name}.png', flush=True)


def shot_offer(page, offer_id, name):
    card = page.get_by_test_id(f'offer-{offer_id}')
    card.scroll_into_view_if_needed()
    box = card.bounding_box()
    assert box and box['width'] > 200 and box['height'] > 80, box
    card.screenshot(path=str(OUT / f'{name}.png'), animations='disabled')
    print('CAPTURE', f'{name}.png', box, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
    contexts = [
        browser.new_context(viewport={'width': 1366, 'height': 768}, locale='zh-TW', reduced_motion='reduce')
        for _ in range(3)
    ]
    pages = [context.new_page() for context in contexts]

    # Three seats: the host creates the room, the other two join and everyone readies.
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
    game_id = api(contexts[0], 'GET', '/api/games')['games'][0]['gameId']
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

    # A seven can leave a forced choice behind; resolve it so the shot is clean.
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
            target = next(hex_index for hex_index in range(len(own['view']['board']['terrain'])) if hex_index != robber)
            command = {'type': 'pending.moveRobber', 'hex': target}
        elif pending['kind'] == 'steal':
            command = {'type': 'pending.steal', 'victim': pending['candidates'][0]}
        else:
            raise AssertionError(f'unexpected pending effect after a roll: {pending}')
        assert send(by_id[actor], game_id, revision, command), command

    own = fetch(turn_context, path)
    assert send(
        turn_context,
        game_id,
        own['revision'],
        {'type': 'trade.offer', 'to': 'all', 'give': {'wool': 1}, 'want': {'ore': 1}},
    ), 'offer rejected'
    view = fetch(contexts[0], path)['view']
    assert len(view['offers']) == 1, view['offers']
    offer_id = view['offers'][0]['id']

    proposer_index = identity.index(turn_actor)
    recipient_index = next(index for index in range(3) if index != proposer_index)
    for index in (proposer_index, recipient_index):
        page = pages[index]
        page.get_by_test_id('locale-switch-game').select_option('zh-Hant')
        page.get_by_test_id('tool-tab-trade').click()
        expect(page.get_by_test_id(f'offer-terms-{offer_id}')).to_be_visible()

    recipient_terms = pages[recipient_index].get_by_test_id(f'offer-terms-{offer_id}')
    expect(recipient_terms).to_have_text('你付出: 1×礦石 · 你獲得: 1×羊毛')
    proposer_terms = pages[proposer_index].get_by_test_id(f'offer-terms-{offer_id}')
    expect(proposer_terms).to_have_text('你付出: 1×羊毛 · 你獲得: 1×礦石')

    shot(pages[proposer_index], 'trade-offer-proposer-1366x768-zh-Hant')
    shot(pages[recipient_index], 'trade-offer-recipient-1366x768-zh-Hant')
    shot_offer(pages[proposer_index], offer_id, 'trade-offer-card-proposer-zh-Hant')
    shot_offer(pages[recipient_index], offer_id, 'trade-offer-card-recipient-zh-Hant')

    browser.close()
    print('DONE', flush=True)
