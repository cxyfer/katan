#!/usr/bin/env python3
"""Cities & Knights browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  CK_PORT=3032 python3 scripts/cities-knights/capture.py <new-empty-output-dir>

The Cities & Knights profiles are implemented but not enabled (progress-card
effects are pending), so the lobby never offers them. The harness therefore
uses a test-only path: it creates a base room over the API, readies every
seat, stops the service, rewrites the room's ``profile_id`` in its private
SQLite file and starts it again; the game then starts normally.

Real games through the real UI and API (no mocked snapshots):

1. Lobby: no Cities & Knights expansion is offered.
2. A live 4-player game (ck-2025). After setup, a test-only fixture writes a
   city, cards and two progress cards for player 1 while the service is
   stopped; then, through the UI, player 1 recruits, activates and moves a
   knight (two-step target), builds a city wall and buys a city improvement
   from the panel. The barbarians are then moved next to the island (fixture)
   and the bot plays on until they attack; the attack panel and the score
   marks are captured. Other seats and filler turns are played over the API
   by a simple bot.
3. The 6-player paired map (ck-paired-2025) during setup.

Captures cover SVG and 3D on desktop and phone. Each step asserts the DOM
state it captures. ``report.json`` lists every case with its sha256.
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
PORT = int(os.environ.get('CK_PORT', '3032'))
BASE = f'http://127.0.0.1:{PORT}'
if len(sys.argv) != 2:
    sys.exit('usage: capture.py <new empty output directory>')
OUT = Path(sys.argv[1])
if OUT.exists() and any(OUT.iterdir()):
    sys.exit(f'output directory must be empty: {OUT}')
OUT.mkdir(parents=True, exist_ok=True)

RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']
COMMODITIES = ['paper', 'cloth', 'coin']
DESKTOP = {'width': 1366, 'height': 900}
PHONE = {'width': 390, 'height': 844}
REPORT: dict = {'base': BASE, 'cases': []}
ERRORS: list[str] = []


def log(*parts):
    print(*parts, flush=True)


# ------------------------------------------------------------------------ server

class Server:
    """The built service on a private SQLite file, restartable for fixture patches."""

    def __init__(self):
        self.data = Path(tempfile.mkdtemp(prefix='katan-ck-'))
        self.sqlite = self.data / 'ck.sqlite'
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

    def patch_room_profile(self, room_id, profile_id):
        """Test-only: the lobby never offers a disabled profile."""
        self.stop()
        with sqlite3.connect(self.sqlite) as db:
            db.execute('UPDATE rooms SET profile_id = ? WHERE id = ?', (profile_id, room_id))
        self.start()

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
    accepted = bool(payload.get('ok')) and payload['data']['outcome'] == 'accepted'
    if not accepted and os.environ.get('CK_DEBUG'):
        log('REJECTED', command, payload)
    return accepted


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


def start_ck_game(browser, count, names, base_profile, ck_profile):
    players = [new_player(browser, name) for name in names[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = contexts[0]
    room = api(host, 'POST', '/api/rooms', {'visibility': 'private', 'capacity': count, 'profileId': base_profile, 'setupMode': 'fixed'})
    for context in contexts[1:]:
        api(context, 'POST', '/api/rooms/join', {'code': room['code']})
    for context in contexts:
        api(context, 'POST', f"/api/rooms/{room['id']}/ready", {'ready': True})
    SERVER.patch_room_profile(room['id'], ck_profile)
    game_id = api(host, 'POST', f"/api/rooms/{room['id']}/start")['gameId']
    identity = [api(context, 'GET', '/api/session')['player']['id'] for context in contexts]
    view = snap(host, f'/api/games/{game_id}')['view']
    assert view['engineVersion'].startswith('ck-'), view['engineVersion']
    assert view['victoryTarget'] == 13, view['victoryTarget']
    return contexts, pages, identity, game_id


def phone_context(browser, context):
    phone = browser.new_context(storage_state=context.storage_state(), viewport=PHONE, locale='zh-TW',
                                reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    page = phone.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    page.set_default_timeout(20000)
    return phone, page


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

    def me(self, player):
        view = self.snapshot(player)['view']
        return next(p for p in view['players'] if p['id'] == player), view


def edge_endpoints(topology_id):
    return json.loads(subprocess.run(
        ['node', '--experimental-strip-types', str(ROOT / 'scripts/cities-knights/topology.mjs'), topology_id],
        check=True, capture_output=True, text=True, cwd=ROOT).stdout)['edges']


def ck_hints(view):
    return view['hints']['modules']['citiesKnights']


def resolve_pending(table: Table, view, revision):
    pending = view['pending']
    kind = pending['kind']
    if kind == 'discard':
        for pid in pending['waitingFor']:
            me, _ = table.me(pid)
            hand = {**me['resources'], **(me.get('commodities') or {})}
            pool = [card for card in sorted(hand, key=lambda c: -hand[c]) for _ in range(hand[card])]
            assert table.act(pid, {'type': 'pending.discard', 'resources': pool[:pending['required'][pid]]})
        return
    if kind == 'moveRobber':
        for hex_ in range(len(view['board']['terrain'])):
            if send(table.by_id[pending['actor']], table.game_id, revision, {'type': 'pending.moveRobber', 'hex': (hex_ * 7 + view['seq']) % len(view['board']['terrain'])}):
                return
        raise AssertionError('no robber target')
    if kind == 'steal':
        assert send(table.by_id[pending['actor']], table.game_id, revision, {'type': 'pending.steal', 'victim': pending['candidates'][0]})
        return
    responders = pending.get('responders') or []
    if not responders:
        raise AssertionError(f'continuation frame left pending: {pending}')
    pid = responders[0]
    me, mine = table.me(pid)
    hints = ck_hints(mine)
    if kind == 'citiesKnights.pillage':
        assert table.act(pid, {'type': 'barbarians.pillage', 'vertex': hints['pillage'][0]})
    elif kind == 'citiesKnights.displaced':
        assert table.act(pid, {'type': 'knight.retreat', 'vertex': hints['retreat'][0]})
    elif kind == 'citiesKnights.defenderDraw':
        assert table.act(pid, {'type': 'barbarians.chooseDeck', 'track': hints['defenderDecks'][0]})
    elif kind == 'citiesKnights.progressDiscard':
        for responder in responders:
            player, _ = table.me(responder)
            required = pending['data']['required'][responder]
            assert table.act(responder, {'type': 'progress.discard', 'cards': player['progressCards'][:required]})
    elif kind == 'citiesKnights.scienceBonus':
        assert table.act(pid, {'type': 'science.take', 'resource': None})
    else:
        raise AssertionError(f'unhandled pending {pending}')


def play_until(table: Table, goal, p1_turn, limit=3000):
    """Roll/end turns over the API until `goal(view)`; `p1_turn` may act for player 1."""
    for _ in range(limit):
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
        mine = table.snapshot(actor)['view']
        if mine['hints']['canRoll']:
            assert table.act(actor, {'type': 'turn.roll'})
            continue
        excess = ck_hints(mine)['progressExcess']
        if excess > 0:
            player = next(p for p in mine['players'] if p['id'] == actor)
            assert table.act(actor, {'type': 'progress.discard', 'cards': player['progressCards'][:excess]})
            continue
        if actor == table.identity[0] and p1_turn(view):
            continue
        assert table.act(actor, {'type': 'turn.end'})
    raise AssertionError(f'goal not reached in {limit} steps')


def complete_setup(table: Table):
    while True:
        snapshot = table.snapshot()
        turn = snapshot['view']['turn']
        if turn['phase'] != 'setup':
            return
        actor = turn['playerId']
        hints = table.snapshot(actor)['view']['hints']
        stage = turn['setup']['stage']
        command = ({'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]} if stage == 'road'
                   else {'type': 'setup.placeBuilding', 'vertex': hints['legalSettlements'][len(hints['legalSettlements']) // 2]})
        assert table.act(actor, command), command


# ------------------------------------------------------------------------ UI steps

def ui_click_target(page, kind, index, confirm=True):
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached()
    target.click(force=True)
    if confirm:
        expect(page.get_by_test_id('confirm-selection')).to_be_visible()


def ui_confirm(page):
    page.get_by_test_id('confirm-selection').click()
    page.wait_for_timeout(600)


def open_actions(page):
    rail = page.get_by_test_id('action-rail-toggle')
    if rail.count() and rail.get_attribute('aria-expanded') != 'true':
        rail.click()


def open_panel(page):
    tab = page.get_by_test_id('tool-tab-citiesKnights')
    expect(tab).to_be_visible()
    if tab.get_attribute('aria-expanded') != 'true':
        tab.click()
    expect(page.get_by_test_id('ck-panel')).to_be_visible()


def close_panel(page):
    if page.get_by_test_id('tool-tab-citiesKnights').get_attribute('aria-expanded') == 'true':
        page.get_by_test_id('tool-close').click()


# --------------------------------------------------------------------------- main

def main():
    SERVER.start()
    try:
        run()
    finally:
        SERVER.stop()


def run():
    names = ['騎士團長', 'Mira', '阿卡', 'Jonas', 'Ilse', 'Tomas']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

        # 1. The lobby never offers Cities & Knights.
        context, page = new_player(browser, 'Lobby')
        options = page.locator('[data-testid="expansion-select"] option').evaluate_all('(nodes) => nodes.map((n) => n.value)')
        assert not any('citiesKnights' in value for value in options), options
        REPORT['cases'].append({'name': 'lobby-no-cities-knights', 'status': 'PASS', 'note': f'expansions offered: {options}'})
        context.close()

        # 2. The live 4-player game.
        contexts, pages, identity, game_id = start_ck_game(browser, 4, names, 'base-2025', 'ck-2025')
        try:
            live_game(browser, contexts, pages, identity, game_id)
        except Exception:
            for index, seat_page in enumerate(pages):
                seat_page.screenshot(path=str(OUT / f'failure-seat{index}.png'))
            raise
        for context in contexts:
            context.close()

        # 3. The 6-player paired map during setup.
        if not os.environ.get('CK_SKIP_SIX'):
            contexts, pages, identity, game_id = start_ck_game(browser, 6, names, 'base-paired-2025', 'ck-paired-2025')
            for renderer in ('svg', 'r3f'):
                open_game(pages[0], game_id, renderer)
                expect(pages[0].get_by_test_id('ck-badge')).to_be_visible()
                shot(pages[0], f'map-6p-{renderer}-desktop', 'ck-paired-2025 setup board', ms=2500 if renderer == 'r3f' else 700)
            for context in contexts:
                context.close()
        browser.close()

    REPORT['errors'] = ERRORS
    (OUT / 'report.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
    log('CASES', len(REPORT['cases']), 'ERRORS', len(ERRORS))
    if ERRORS:
        sys.exit(1)


def take(bank, hand, card, amount):
    moved = min(amount, bank[card])
    bank[card] -= moved
    hand[card] += moved


def live_game(browser, contexts, pages, identity, game_id):
    table = Table(contexts, pages, identity, game_id)
    p1 = identity[0]
    page = pages[0]
    complete_setup(table)
    log('SETUP DONE')

    # Player 1's action phase.
    def p1_action(view):
        return view['turn']['playerId'] == p1 and view['turn']['phase'] == 'action' and view['pending'] is None
    play_until(table, p1_action, lambda view: False)

    def fixture(state):
        player = next(p for p in state['players'] if p['id'] == p1)
        own = [index for index, building in enumerate(state['board']['buildings']) if building and building['player'] == p1]
        state['board']['buildings'][own[0]]['city'] = True
        for card, amount in (('wool', 3), ('ore', 4), ('grain', 3), ('brick', 4), ('lumber', 2)):
            take(state['bank'], player['resources'], card, amount)
        for card, amount in (('paper', 3), ('cloth', 2), ('coin', 1)):
            take(state['commodityBank'], player['commodities'], card, amount)
        for track in ('science', 'politics'):
            deck = state['progressDecks'][track]
            index = next(i for i, card in enumerate(deck) if card not in ('printing', 'constitution'))
            player['progressCards'].append(deck.pop(index))
    SERVER.patch_game(game_id, fixture)
    me, view = table.me(p1)
    city = next(index for index, building in enumerate(view['board']['buildings']) if building and building['player'] == p1 and building['city'])

    # Recruit a knight through the UI.
    open_game(page, game_id, 'svg')
    expect(page.get_by_test_id('ck-badge')).to_be_visible()
    open_actions(page)
    page.get_by_test_id('action-knight.recruit').click()
    sites = ck_hints(table.snapshot(p1)['view'])['recruitSites']
    assert sites, 'no recruit site'
    ui_click_target(page, 'vertex', sites[0])
    shot(page, 'live-knight-recruit-svg', 'recruit: free intersections on the own routes, knight preview')
    ui_confirm(page)
    knight = sites[0]
    expect(page.locator(f'[data-testid="knight-{knight}"]')).to_have_attribute('data-active', 'false')

    # Activate it.
    open_actions(page)
    page.get_by_test_id('action-knight.activate').click()
    ui_click_target(page, 'vertex', knight)
    ui_confirm(page)
    expect(page.locator(f'[data-testid="knight-{knight}"]')).to_have_attribute('data-active', 'true')

    # A city wall.
    open_actions(page)
    page.get_by_test_id('action-build.wall').click()
    ui_click_target(page, 'vertex', city)
    shot(page, 'live-wall-target-svg', 'city wall: own cities without a wall')
    ui_confirm(page)
    expect(page.locator(f'[data-testid="wall-{city}"]')).to_be_visible()

    # A city improvement from the panel.
    open_panel(page)
    page.get_by_test_id('ck-improve-science').click()
    page.wait_for_timeout(800)
    expect(page.get_by_test_id('ck-track-science')).to_have_attribute('data-level', '1')
    shot(page, 'live-panel-svg', 'panel: barbarian track, event roll, improvement chart, progress hand (not playable)')
    close_panel(page)
    assert table.act(p1, {'type': 'turn.end'})

    # Next turn: move the knight in two steps.
    play_until(table, p1_action, lambda view: False)
    def knight_hint():
        return next(k for k in ck_hints(table.snapshot(p1)['view'])['knights'] if k['vertex'] == knight)
    # Give the knight somewhere to go: extend player 1's route from the knight over the API.
    view = table.snapshot(p1)['view']
    endpoints = edge_endpoints(view['board']['topologyId'])
    for edge in view['hints']['legalRoads']:
        if knight_hint()['moves']:
            break
        if knight in endpoints[edge]:
            table.act(p1, {'type': 'build.road', 'edge': edge})
    adjacent = [e for e in view['hints']['legalRoads'] if knight in endpoints[e]]
    if not knight_hint()['moves'] and adjacent:
        # Fallback fixture (test-only): lay the road directly while the service is down.
        def lay_road(state):
            state['board']['roads'][adjacent[0]] = {'player': p1, 'ship': False}
        SERVER.patch_game(game_id, lay_road)
    hint = knight_hint()
    log('KNIGHT', knight, hint, adjacent)
    if hint['moves']:
        open_game(page, game_id, 'svg')
        open_actions(page)
        page.get_by_test_id('action-knight.move').click()
        ui_click_target(page, 'vertex', knight, confirm=False)
        expect(page.get_by_test_id(f"target-vertex-{hint['moves'][0]}")).to_be_attached()
        shot(page, 'live-knight-move-targets-svg', 'move knight: second step, reachable intersections')
        ui_click_target(page, 'vertex', hint['moves'][0])
        ui_confirm(page)
        knight = hint['moves'][0]
        expect(page.locator(f'[data-testid="knight-{knight}"]')).to_be_visible()
        # Reactivate the knight when the hand allows it, so it defends.
        me, _ = table.me(p1)
        if not knight_hint()['active'] and me['resources']['grain'] > 0:
            open_actions(page)
            page.get_by_test_id('action-knight.activate').click()
            ui_click_target(page, 'vertex', knight)
            ui_confirm(page)
    else:
        log('NOTE knight has no move target; move capture skipped')
    open_game(page, game_id, 'r3f')
    shot(page, 'live-board-3d', 'knight, wall and city in 3D', ms=2500)

    phone, phone_page = phone_context(browser, contexts[0])
    for renderer in ('svg', 'r3f'):
        open_game(phone_page, game_id, renderer)
        shot(phone_page, f'live-board-{renderer}-phone', 'phone table with the C&K badge', ms=2500 if renderer == 'r3f' else 700)
    open_game(phone_page, game_id, 'svg')
    open_panel(phone_page)
    shot(phone_page, 'live-panel-phone', 'phone: C&K panel')
    phone.close()
    assert table.act(p1, {'type': 'turn.end'})

    # The barbarians: one ship away (fixture), then the bot plays until they attack.
    def near(state):
        state['moduleState']['citiesKnights']['barbarian'] = 6
        # Player 2 gets a second city, so losing means choosing which one is pillaged.
        p2 = identity[1]
        settlement = next(b for b in state['board']['buildings'] if b and b['player'] == p2 and not b['city'])
        settlement['city'] = True
    SERVER.patch_game(game_id, near)
    def attacked(view):
        pending = view['pending']
        return view['modules']['citiesKnights']['lastAttack'] is not None and (pending is None or pending['kind'] == 'citiesKnights.pillage')
    captured = False
    while True:
        view = play_until(table, attacked, lambda view: False)
        pending = view['pending']
        if pending is None:
            break
        # A losing player chooses the pillaged city through their own UI.
        loser = pending['responders'][0]
        loser_page = table.page_of[loser]
        open_game(loser_page, game_id, 'svg')
        expect(loser_page.get_by_test_id('ck-pillage')).to_be_visible()
        if not captured:
            shot(loser_page, 'live-pillage-prompt-svg', 'barbarians won: the weakest defender picks a city to pillage')
            captured = True
        loser_page.locator('[data-testid^="ck-pillage-"]').first.click()
        loser_page.wait_for_timeout(800)
    attack = view['modules']['citiesKnights']['lastAttack']
    log('ATTACK', attack)
    open_game(page, game_id, 'svg')
    assert view['modules']['citiesKnights']['robberActive'], 'robber not in play after the attack'
    expect(page.get_by_test_id('robber')).to_be_visible()
    open_panel(page)
    expect(page.get_by_test_id('ck-attack')).to_have_attribute('data-outcome', attack['outcome'])
    shot(page, 'live-attack-svg', f"barbarian attack: {attack['barbarians']} vs {attack['defenders']} ({attack['outcome']})")
    close_panel(page)
    if attack['defender']:
        seat = next(p['seat'] for p in view['players'] if p['id'] == attack['defender'])
        expect(page.get_by_test_id(f'players-defender-{seat}')).to_be_attached()
    open_game(page, game_id, 'r3f')
    shot(page, 'live-after-attack-3d', 'after the attack: the robber is on the island', ms=2500)


if __name__ == '__main__':
    main()
