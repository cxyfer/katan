#!/usr/bin/env python3
"""Seafarers (Heading for New Shores) browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 python3 scripts/seafarers/capture.py <new-empty-output-dir>

The harness starts the built service itself on ``SF_PORT`` with a private
SQLite file (so it can restart it for one test-only fixture patch).

Real games through the real UI and API (no mocked snapshots):

1. Lobby: Seafarers → Heading for New Shores, required boxes shown.
2. Maps: the 3-, 4- and 6-player boards in SVG and 3D, desktop and phone,
   captured during setup.
3. A live 4-player game. Player 1 starts on the east coast and places a
   starting ship through the road-or-ship switch; then, through the UI, builds a
   ship, moves a ship, settles the gold island (island bonus), moves the pirate
   and chooses gold; then plays Road Building as road + ship and as two ships
   and a Knight that moves the pirate (the three cards are written into the
   persisted hand while the service is stopped). Other seats and filler turns
   are played over the API by a simple bot (roll, trade with the bank, end the
   turn).
4. The 5-player map in SVG and 3D.

Each step asserts the DOM state it captures (targets present, prompt shown,
board pieces drawn). ``report.json`` lists every case with its sha256.
"""
from __future__ import annotations

import hashlib
import json
import os
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = int(os.environ.get('SF_PORT', '3023'))
BASE = f'http://127.0.0.1:{PORT}'
if len(sys.argv) != 2:
    sys.exit('usage: capture.py <new empty output directory>')
OUT = Path(sys.argv[1])
if OUT.exists() and any(OUT.iterdir()):
    sys.exit(f'output directory must be empty: {OUT}')
OUT.mkdir(parents=True, exist_ok=True)

RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']
DESKTOP = {'width': 1366, 'height': 900}
PHONE = {'width': 390, 'height': 844}
FIX = json.loads(subprocess.run(
    ['node', '--experimental-strip-types', str(ROOT / 'scripts/seafarers/fixtures.mjs')],
    check=True, capture_output=True, text=True, cwd=ROOT).stdout)
REPORT: dict = {'base': BASE, 'fixtures': FIX, 'cases': []}
ERRORS: list[str] = []


def log(*parts):
    print(*parts, flush=True)


# ------------------------------------------------------------------------ server

class Server:
    """The built service on a private SQLite file, restartable for fixture patches."""

    def __init__(self):
        self.data = Path(tempfile.mkdtemp(prefix='katan-seafarers-'))
        self.sqlite = self.data / 'seafarers.sqlite'
        self.child = None

    def start(self):
        env = {**os.environ, 'PORT': str(PORT), 'HOST': '127.0.0.1', 'SQLITE_PATH': str(self.sqlite),
               'WEB_DIST_PATH': str(ROOT / 'packages/web/dist'), 'LOG_LEVEL': 'warn'}
        self.child = subprocess.Popen(['node', str(ROOT / 'packages/server/dist/server.mjs')], cwd=ROOT, env=env,
                                      stdout=open(self.data / 'server.log', 'ab'), stderr=subprocess.STDOUT)
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f'{BASE}/healthz', timeout=1) as response:
                    if response.status == 200:
                        return
            except OSError:
                time.sleep(0.2)
        raise AssertionError('service did not become healthy')

    def stop(self):
        if self.child and self.child.poll() is None:
            self.child.send_signal(signal.SIGTERM)
            self.child.wait(timeout=20)
        self.child = None

    def patch_game(self, game_id, mutate):
        """Test-only fixture: edit the persisted snapshot while the service is down."""
        self.stop()
        with sqlite3.connect(self.sqlite) as db:
            (raw,) = db.execute('SELECT state_json FROM games WHERE id = ?', (game_id,)).fetchone()
            state = json.loads(raw)
            mutate(state)
            db.execute('UPDATE games SET state_json = ? WHERE id = ?', (json.dumps(state), game_id))
        self.start()


SERVER = Server()


# --------------------------------------------------------------------------- API

def api(context, method, path, data=None):
    response = context.request.fetch(BASE + path, method=method, data=data)
    payload = response.json()
    assert payload.get('ok'), (path, response.status, payload)
    return payload['data']


def snap(context, path):
    return api(context, 'GET', path)


def send(context, game_id, revision, command):
    response = context.request.post(f'{BASE}/api/games/{game_id}/commands', data={
        'commandId': str(uuid.uuid4()), 'expectedRevision': revision, 'command': command})
    payload = response.json()
    return bool(payload.get('ok')) and payload['data']['outcome'] == 'accepted'


# ------------------------------------------------------------------------ capture

def settle(page, ms=700):
    page.mouse.move(1, 1)
    page.wait_for_timeout(ms)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


def shot(page, name, note='', ms=700):
    settle(page, ms)
    path = OUT / f'{name}.png'
    page.screenshot(path=str(path), animations='disabled')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    REPORT['cases'].append({'name': name, 'status': 'PASS', 'note': note, 'sha256': digest,
                            'viewport': page.viewport_size})
    log('CAPTURE', name, note)


def wait_renderer(page, renderer):
    page.wait_for_function(
        "(renderer) => document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === renderer",
        arg=renderer, timeout=30000)
    if renderer == 'r3f':
        page.wait_for_function(
            "() => document.querySelector('[data-testid=\"board\"]')?.dataset.rendererStatus === 'ready'", timeout=30000)


def open_game(page, game_id, renderer):
    page.goto(f'{BASE}/?renderer={renderer}')
    resume = page.get_by_test_id(f'resume-{game_id}')
    resume.wait_for(state='attached')
    if not resume.is_visible():
        page.locator('#home-tab-resume').click()
    resume.click()
    wait_renderer(page, renderer)


def new_player(browser, name, viewport=DESKTOP):
    context = browser.new_context(viewport=viewport, locale='zh-TW', reduced_motion='reduce', service_workers='block')
    page = context.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'{name}: {error}'))
    page.set_default_timeout(20000)
    page.goto(BASE)
    page.get_by_test_id('nickname-input').fill(name)
    page.locator('form button[type=submit]').click()
    expect(page.get_by_test_id('create-room')).to_be_visible()
    return context, page


def start_game(browser, count, names, lobby_shot=None):
    players = [new_player(browser, name) for name in names[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    if lobby_shot:
        shot(host, lobby_shot, 'lobby: Seafarers / Heading for New Shores with required boxes')
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
    identity = [api(context, 'GET', '/api/session')['player']['id'] for context in contexts]
    game_id = api(contexts[0], 'GET', '/api/games')['games'][0]['gameId']
    return contexts, pages, identity, game_id


def map_shots(browser, contexts, pages, game_id, count, phone=True):
    host_ctx, host = contexts[0], pages[0]
    view = snap(host_ctx, f'/api/games/{game_id}')['view']
    log('MAP', count, view['board']['topologyId'])
    for renderer in ('svg', 'r3f'):
        open_game(host, game_id, renderer)
        if renderer == 'svg':
            hexes = host.locator('[data-testid^="hex-"]').count()
            assert hexes == len(view['board']['terrain']), (hexes, len(view['board']['terrain']))
            expect(host.get_by_test_id('pirate-frame')).to_be_visible()
        shot(host, f'map-{count}p-{renderer}-desktop', view['board']['topologyId'], ms=2500 if renderer == 'r3f' else 700)
    if not phone:
        return
    phone_ctx = browser.new_context(storage_state=host_ctx.storage_state(), viewport=PHONE, locale='zh-TW',
                                    reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    page = phone_ctx.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    for renderer in ('svg', 'r3f'):
        open_game(page, game_id, renderer)
        shot(page, f'map-{count}p-{renderer}-phone', view['board']['topologyId'], ms=2500 if renderer == 'r3f' else 700)
    phone_ctx.close()


# --------------------------------------------------------------------------- bot

class Table:
    def __init__(self, contexts, pages, identity, game_id):
        self.contexts = contexts
        self.pages = pages
        self.identity = identity
        self.by_id = dict(zip(identity, contexts))
        self.page_of = dict(zip(identity, pages))
        self.game_id = game_id
        self.path = f'/api/games/{game_id}'

    def snapshot(self, player=None):
        return snap(self.by_id[player] if player else self.contexts[0], self.path)

    def act(self, player, command):
        return send(self.by_id[player], self.game_id, self.snapshot()['revision'], command)

    def hand(self, player):
        view = self.snapshot(player)['view']
        return next(p for p in view['players'] if p['id'] == player)['resources']


def resolve_pending(table: Table, view, revision):
    pending = view['pending']
    kind = pending['kind']
    if kind == 'discard':
        for pid in pending['waitingFor']:
            hand = table.hand(pid)
            pool = [r for r in sorted(RESOURCES, key=lambda r: -hand[r]) for _ in range(hand[r])]
            assert send(table.by_id[pid], table.game_id, table.snapshot()['revision'],
                        {'type': 'pending.discard', 'resources': pool[:pending['required'][pid]]})
        return
    if kind == 'moveRobber':
        hints = table.snapshot(pending['actor'])['view']['hints']['modules']['seafarers']
        for hex_ in hints['robberTargets'] + [h for h in hints['pirateTargets'] if h is not None]:
            if send(table.by_id[pending['actor']], table.game_id, revision, {'type': 'pending.moveRobber', 'hex': hex_}):
                return
        raise AssertionError('no robber target')
    if kind == 'steal':
        assert send(table.by_id[pending['actor']], table.game_id, revision, {'type': 'pending.steal', 'victim': pending['candidates'][0]})
        return
    if kind == 'seafarers.gold':
        pid = pending['responders'][0]
        need = table.snapshot(pid)['view']['hints']['modules']['seafarers']['goldRequired']
        bank = dict(view['bank'])
        picks = []
        for resource in RESOURCES:
            while len(picks) < need and bank[resource] > 0:
                picks.append(resource)
                bank[resource] -= 1
        assert send(table.by_id[pid], table.game_id, revision, {'type': 'gold.choose', 'resources': picks})
        return
    if kind == 'freeRoads':
        hints = table.snapshot(pending['actor'])['view']['hints']
        edges = hints['legalRoads'] or hints['modules']['seafarers']['legalShips']
        command = 'build.road' if hints['legalRoads'] else 'build.ship'
        assert send(table.by_id[pending['actor']], table.game_id, revision, {'type': command, 'edge': edges[0]})
        return
    if kind == 'yearOfPlenty':
        assert send(table.by_id[pending['actor']], table.game_id, revision, {'type': 'pending.takeResource', 'resource': 'wool'})
        return
    raise AssertionError(f'unhandled pending {pending}')


def trade_towards(table: Table, player, wants):
    """Bank-trade surplus cards for the missing ones in `wants` (resource → count)."""
    for _ in range(6):
        snapshot = table.snapshot(player)
        view = snapshot['view']
        hand = next(p for p in view['players'] if p['id'] == player)['resources']
        rates = view['hints']['bankRates']
        missing = [r for r, n in wants.items() if hand[r] < n]
        if not missing:
            return True
        spare = [r for r in RESOURCES if hand[r] - wants.get(r, 0) >= rates[r]]
        if not spare:
            return False
        if not send(table.by_id[player], table.game_id, snapshot['revision'],
                    {'type': 'trade.bank', 'give': spare[0], 'receive': missing[0]}):
            return False
    return False


def complete_setup(table: Table, coast, ship_edge, ui_ship):
    """Setup over the API; player 1's first road step goes through the UI ship switch."""
    p1 = table.identity[0]
    first = True
    while True:
        snapshot = table.snapshot()
        turn = snapshot['view']['turn']
        if turn['phase'] != 'setup':
            return
        actor = turn['playerId']
        hints = table.snapshot(actor)['view']['hints']
        stage = turn['setup']['stage']
        if actor == p1 and first and stage == 'building':
            assert table.act(p1, {'type': 'setup.placeBuilding', 'vertex': coast})
            continue
        if actor == p1 and first and stage == 'road':
            ui_ship(ship_edge)
            first = False
            continue
        command = ({'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]} if stage == 'road'
                   else {'type': 'setup.placeBuilding', 'vertex': hints['legalSettlements'][-1]})
        assert table.act(actor, command), command


def play_until(table: Table, goal, p1_turn, limit=3000):
    """Roll/end turns over the API until `goal(view)`; `p1_turn` may act for player 1."""
    for step in range(limit):
        snapshot = table.snapshot()
        view = snapshot['view']
        if goal(view):
            return view
        if view['result']:
            raise AssertionError('game ended before the goal')
        if view['pending'] is not None:
            resolve_pending(table, view, snapshot['revision'])
            continue
        actor = view['turn']['playerId']
        hints = table.snapshot(actor)['view']['hints']
        if hints['canRoll']:
            assert table.act(actor, {'type': 'turn.roll'})
            continue
        if actor == table.identity[0] and p1_turn(view):
            continue
        assert table.act(actor, {'type': 'turn.end'})
    raise AssertionError(f'goal not reached in {limit} steps')


def ui_click_target(page, kind, index):
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached()
    target.click(force=True)
    expect(page.get_by_test_id('confirm-selection')).to_be_visible()


def ui_confirm(page):
    page.get_by_test_id('confirm-selection').click()
    page.wait_for_timeout(600)


def open_actions(page):
    rail = page.get_by_test_id('action-rail-toggle')
    if rail.count() and rail.get_attribute('aria-expanded') != 'true':
        rail.click()


# --------------------------------------------------------------------------- main

def main():
    SERVER.start()
    try:
        run()
    finally:
        SERVER.stop()


def run():
    names = ['海岸領航員', 'Mira', '阿卡', 'Jonas', 'Ilse', 'Tomas']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

        # Maps for 3 and 6 players (setup boards).
        for count in (() if os.environ.get('SF_SKIP_MAPS') else (3, 5, 6)):
            contexts, pages, _, game_id = start_game(browser, count, names)
            map_shots(browser, contexts, pages, game_id, count, phone=count != 5)
            for context in contexts:
                context.close()

        # The 4-player map, then the live game on it.
        contexts, pages, identity, game_id = start_game(browser, 4, names, lobby_shot='lobby-seafarers')
        try:
            live_game(browser, contexts, pages, identity, game_id)
        except Exception:
            for index, page in enumerate(pages):
                page.screenshot(path=str(OUT / f'failure-seat{index}.png'))
            raise
        browser.close()

    REPORT['errors'] = ERRORS
    (OUT / 'report.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
    log('CASES', len(REPORT['cases']), 'ERRORS', len(ERRORS))
    if ERRORS:
        sys.exit(1)


def live_game(browser, contexts, pages, identity, game_id):
    if not os.environ.get('SF_SKIP_MAPS'):
        map_shots(browser, contexts, pages, game_id, 4)
    if True:
        table = Table(contexts, pages, identity, game_id)
        p1 = identity[0]
        page = pages[0]
        open_game(page, game_id, 'svg')

        def ui_setup_ship(edge):
            # Commands sent over the API by this same seat are not echoed to its
            # own open socket, so reload the table before acting in the UI.
            open_game(page, game_id, 'svg')
            expect(page.get_by_test_id('ship-choice')).to_be_visible()
            shot(page, 'live-setup-ship-choice-svg', 'coastal start: road or ship switch')
            page.get_by_test_id('choose-ship').click()
            ui_click_target(page, 'edge', edge)
            shot(page, 'live-setup-ship-preview-svg', 'starting ship preview')
            ui_confirm(page)
            expect(page.locator(f'[data-testid="ship-{edge}"]')).to_be_visible()

        complete_setup(table, FIX['coast'], FIX['shipNW'], ui_setup_ship)
        log('SETUP DONE')

        state = {'built': False, 'moved': False, 'restored': False, 'settled': False}

        def p1_turn(view):
            board = view['board']
            roads = board['roads']
            if not state['built']:
                if not trade_towards(table, p1, {'lumber': 1, 'wool': 1}):
                    return False
                open_game(page, game_id, 'svg')
                open_actions(page)
                page.get_by_test_id('action-build.ship').click()
                expect(page.get_by_test_id(f"target-edge-{FIX['shipNE']}")).to_be_attached()
                shot(page, 'live-ship-build-targets-svg', 'build ship: legal sea paths highlighted')
                ui_click_target(page, 'edge', FIX['shipNE'])
                ui_confirm(page)
                expect(page.locator(f"[data-testid=\"ship-{FIX['shipNE']}\"]")).to_be_visible()
                shot(page, 'live-ship-built-svg', 'ship built from the starting ship')
                state['built'] = True
                return False
            if not state['moved'] and roads[FIX['shipNE']] and view['modules']['seafarers']['shipsBuiltThisTurn'] == []:
                open_game(page, game_id, 'svg')
                open_actions(page)
                page.get_by_test_id('action-ship.move').click()
                ui_click_target_noconfirm(page, 'edge', FIX['shipNE'])
                expect(page.get_by_test_id(f"target-edge-{FIX['branch']}")).to_be_attached()
                shot(page, 'live-ship-move-targets-svg', 'move ship: chosen ship and its new paths')
                ui_click_target(page, 'edge', FIX['branch'])
                ui_confirm(page)
                expect(page.locator(f"[data-testid=\"ship-{FIX['branch']}\"]")).to_be_visible()
                shot(page, 'live-ship-moved-svg', 'ship moved to the branch path')
                state['moved'] = True
                return False
            if state['moved'] and not state['restored'] and not view['modules']['seafarers']['shipMoved']:
                assert table.act(p1, {'type': 'ship.move', 'from': FIX['branch'], 'to': FIX['shipNE']})
                state['restored'] = True
                return False
            if state['restored'] and not state['settled']:
                if trade_towards(table, p1, {'lumber': 1, 'brick': 1, 'wool': 1, 'grain': 1}):
                    if table.act(p1, {'type': 'build.settlement', 'vertex': FIX['goldVertex']}):
                        state['settled'] = True
                return False
            return False

        play_until(table, lambda view: state['settled'], p1_turn)
        open_game(page, game_id, 'svg')
        expect(page.locator(f"[data-testid=\"island-bonus-{FIX['goldVertex']}\"]")).to_be_visible()
        shot(page, 'live-island-bonus-svg', 'first settlement on a small island: +2 tokens')
        open_game(page, game_id, 'r3f')
        shot(page, 'live-island-bonus-3d', 'ships, tokens and the pirate in 3D', ms=2500)

        # Pirate: the next 7 for any seat, moved through that player's UI.
        def seven(view):
            pending = view['pending']
            return pending is not None and pending['kind'] == 'moveRobber'
        view = play_until(table, seven, lambda view: False)
        actor = view['pending']['actor']
        actor_page = table.page_of[actor]
        open_game(actor_page, game_id, 'svg')
        expect(actor_page.get_by_test_id('bandit-choice')).to_be_visible()
        expect(actor_page.get_by_test_id(f"target-hex-{FIX['seaHex']}")).to_be_attached()
        shot(actor_page, 'live-pirate-choice-svg', 'robber or pirate: land and sea hexes plus the frame')
        ui_click_target(actor_page, 'hex', FIX['seaHex'])
        ui_confirm(actor_page)
        expect(actor_page.get_by_test_id('pirate-hex')).to_be_visible()
        shot(actor_page, 'live-pirate-moved-svg', 'pirate on the sea hex next to the ships')
        open_game(actor_page, game_id, 'r3f')
        shot(actor_page, 'live-pirate-moved-3d', 'pirate in 3D', ms=2500)

        # Gold: the next roll of 10 pays player 1 a resource of choice.
        def gold(view):
            pending = view['pending']
            return pending is not None and pending['kind'] == 'seafarers.gold' and pending['responders'][0] == p1
        play_until(table, gold, lambda view: False)
        open_game(page, game_id, 'svg')
        expect(page.get_by_test_id('gold-picker')).to_be_visible()
        shot(page, 'live-gold-picker-svg', 'gold: choose a resource from the bank')
        required = table.snapshot(p1)['view']['hints']['modules']['seafarers']['goldRequired']
        for _ in range(required):
            page.get_by_test_id('gold-ore').click()
        box = page.get_by_test_id('gold-confirm').bounding_box()
        messages = page.locator('.game__messages').bounding_box()
        assert box and messages and box['y'] + box['height'] <= messages['y'] + messages['height'] + 1, (box, messages)
        assert box['y'] + box['height'] <= page.viewport_size['height'], box
        shot(page, 'live-gold-chosen-svg', 'gold: ore selected; confirm fully visible')
        before = table.hand(p1)['ore']
        page.get_by_test_id('gold-confirm').click()
        page.wait_for_timeout(800)
        assert table.hand(p1)['ore'] >= before + required, 'gold not paid'
        open_game(page, game_id, 'svg')
        shot(page, 'live-after-gold-svg', 'gold paid; seat panel with island bonus')
        open_game(page, game_id, 'r3f')
        shot(page, 'live-board-3d', 'live board in 3D', ms=2500)
        development_cards(table, page, game_id)


def ui_click_target_noconfirm(page, kind, index):
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached()
    target.click(force=True)



def development_cards(table: Table, page, game_id):
    """Road Building with ships (road + ship, then two ships) and a Knight moving the pirate.

    The cards are a test-only fixture written into player 1's persisted hand
    while the service is stopped; everything after that is ordinary play.
    """
    p1 = table.identity[0]

    def give_cards(state):
        player = next(p for p in state['players'] if p['id'] == p1)
        player['devCards'] = ['roadBuilding', 'roadBuilding', 'knight'] + [c for c in player['devCards'] if c not in ('roadBuilding', 'knight')]
    SERVER.patch_game(game_id, give_cards)
    for other in table.pages:
        other.reload()

    def p1_action(view):
        return view['turn']['playerId'] == p1 and view['turn']['phase'] == 'action' and view['pending'] is None

    def p1_preroll(view):
        return view['turn']['playerId'] == p1 and view['turn']['phase'] == 'preroll' and view['pending'] is None

    def play_card(card):
        button = page.get_by_test_id(f'play-{card}-0')
        expect(button).to_be_attached()
        expect(button).to_be_enabled()
        button.dispatch_event('click')

    def free_piece(kind):
        hints = table.snapshot(p1)['view']['hints']
        if kind == 'ship':
            page.get_by_test_id('choose-ship').click()
            edge = hints['modules']['seafarers']['legalShips'][0]
        else:
            edge = hints['legalRoads'][0]
        ui_click_target(page, 'edge', edge)
        ui_confirm(page)
        expect(page.locator(f'[data-testid="{"ship" if kind == "ship" else "road"}-{edge}"]')).to_be_visible()

    # Road Building 1: a road, then a ship.
    play_until(table, p1_action, lambda view: False)
    open_game(page, game_id, 'svg')
    play_card('roadBuilding')
    expect(page.get_by_test_id('ship-choice')).to_be_visible()
    shot(page, 'live-road-building-start-svg', 'Road Building: road by default, ship switch offered')
    free_piece('road')
    expect(page.get_by_test_id('ship-choice')).to_be_visible()
    free_piece('ship')
    view = table.snapshot(p1)['view']
    assert view['pending'] is None, view['pending']
    shot(page, 'live-road-building-road-ship-svg', 'Road Building finished with one road and one ship')
    assert table.act(p1, {'type': 'turn.end'})

    # Road Building 2: two ships.
    play_until(table, p1_action, lambda view: False)
    open_game(page, game_id, 'svg')
    before = sum(1 for road in table.snapshot()['view']['board']['roads'] if road and road['ship'] and road['player'] == p1)
    play_card('roadBuilding')
    free_piece('ship')
    free_piece('ship')
    view = table.snapshot(p1)['view']
    after = sum(1 for road in view['board']['roads'] if road and road['ship'] and road['player'] == p1)
    assert view['pending'] is None and after == before + 2, (view['pending'], before, after)
    shot(page, 'live-road-building-two-ships-svg', 'Road Building finished with two ships')
    assert table.act(p1, {'type': 'turn.end'})

    # Knight before the roll: move the pirate to another sea hex.
    play_until(table, p1_preroll, lambda view: False)
    open_game(page, game_id, 'svg')
    play_card('knight')
    expect(page.get_by_test_id('bandit-choice')).to_be_visible()
    expect(page.get_by_test_id('pirate-to-frame')).to_be_visible()
    shot(page, 'live-knight-pirate-choice-svg', 'Knight: robber on land or pirate at sea / to the frame')
    target = FIX['pirateSea']
    ui_click_target(page, 'hex', target)
    ui_confirm(page)
    view = table.snapshot(p1)['view']
    assert view['board']['pirate'] == target, view['board']['pirate']
    assert view['players'][0]['playedKnights'] >= 1
    open_game(page, game_id, 'r3f')
    shot(page, 'live-knight-pirate-moved-3d', 'pirate moved by a Knight', ms=2500)


if __name__ == '__main__':
    main()
