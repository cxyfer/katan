#!/usr/bin/env python3
"""Seafarers + Cities & Knights (Heading for New Shores combined) browser evidence.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SFCK_PORT=3042 python3 scripts/seafarers-cities-knights/capture.py <new-empty-output-dir>

The harness reuses ``scripts/cities-knights/ckkit.py`` (built service on a
private SQLite file, restartable for test-only fixture patches). Real games
through the real UI and API (no mocked snapshots):

1. Lobby: the "Cities & Knights + Seafarers" expansion set resolves to
   Heading for New Shores; a 4-player room is created through the lobby UI.
2. 4 players (sf-ck-new-shores-2025). Player 1 starts on the coast with a
   starting ship. After setup a test-only fixture (service stopped) puts the
   game after the first barbarian attack, lays a second ship, places three
   knights (one on the ships, two on roads) and the pirate next to the ship
   knight. Through the UI player 1 then chases the pirate with the knight on
   the ships (SVG, desktop; COMB-6), chases the robber with a land knight and
   sees land targets only (SVG, phone; SFCK-4) and moves the third knight
   across the ships (3D, desktop; COMB-2/3). A last fixture writes island
   bonus, metropolis, defender, merchant and Longest Trade Route so the score
   breakdown shows them together.
3. 3 players (sf-ck-new-shores-2025): the pirate chase in 3D on desktop and
   the board on a phone in SVG.
4. 6 players (sf-ck-new-shores-paired-2025): the pirate chase on a phone in
   3D and the board in SVG on desktop.

Other seats and filler turns are played over the API by a simple bot. Each
step asserts the DOM or game state it captures; ``report.json`` lists every
case with its sha256.
"""
import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'cities-knights'))
os.environ['CK_PORT'] = os.environ.get('SFCK_PORT', '3042')

from playwright.sync_api import expect, sync_playwright  # noqa: E402

import ckkit  # noqa: E402
from ckkit import (  # noqa: E402
    ERRORS, SERVER, Table, api, ck_hints, log, new_player, open_actions, open_game,
    phone_context, shot, snap, take, ui_confirm,
)

ROOT = HERE.parents[1]
NAMES = ['航海騎士', 'Mira', '阿卡', 'Jonas', 'Ilse', 'Tomas']
TOPOLOGY: dict = {}
# Generous: other harnesses may share the machine's software GL.
TIMEOUT = int(os.environ.get('SFCK_TIMEOUT_MS', '60000'))
expect.set_options(timeout=min(TIMEOUT, 20000))


def is_phone(page):
    return (page.viewport_size or {}).get('width', 9999) < 700


def press(page, locator, force=False):
    """Tap on a phone (a mouse click would hover the seats panel open again)."""
    if is_phone(page):
        locator.tap(force=force)
    else:
        locator.click(force=force)


def collapse_rail(page):
    """A narrow table opens the action rail over the board; fold it before a board click."""
    rail = page.get_by_test_id('action-rail')
    if rail.count() and rail.get_attribute('data-expanded') == 'true':
        press(page, page.get_by_test_id('action-rail-toggle'))
        page.wait_for_timeout(400)
    # On a phone the expanded seats panel covers the left half of the board.
    players = page.get_by_test_id('players-panel')
    if players.count() and players.get_attribute('data-expanded') == 'true':
        press(page, page.get_by_test_id('players-toggle'))
        page.wait_for_timeout(400)


HIT_TEST = '''([x, y, id]) => { const e = document.elementFromPoint(x, y); return !!e && !!e.closest(`[data-testid="${id}"]`); }'''


def bring_into_view(page, target, test_id):
    """Pan the board (a drag, as a player would) when panels cover the target."""
    for attempt in range(4):
        box = target.bounding_box()
        if not box:
            return
        cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        if page.evaluate(HIT_TEST, [cx, cy, test_id]):
            return
        width, height = page.viewport_size['width'], page.viewport_size['height']
        # A whole board fits the view and cannot pan; zoom in first.
        if attempt > 0:
            press(page, page.get_by_test_id('zoom-in'))
            page.wait_for_timeout(300)
        # Start right of centre (the seats panel sits on the left) and park the
        # pointer back on the board so no panel opens on hover.
        start_x, start_y = width * 0.6, height * 0.5
        end_x = min(max(start_x + width * 0.55 - cx, 5), width - 5)
        end_y = min(max(start_y + height * 0.5 - cy, 5), height - 5)
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(end_x, end_y, steps=12)
        page.mouse.up()
        page.mouse.move(start_x, start_y)
        page.wait_for_timeout(400)
        collapse_rail(page)


def ui_click_target(page, kind, index, confirm=True):
    collapse_rail(page)
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached()
    bring_into_view(page, target, f'target-{kind}-{index}')
    press(page, target, force=True)
    page.wait_for_timeout(300)
    # Close targets on a small screen open a picker instead of selecting at once.
    if page.get_by_test_id('target-picker').count():
        page.get_by_test_id(f'picker-{kind}-{index}').dispatch_event('click')
    if confirm:
        try:
            expect(page.get_by_test_id('confirm-selection')).to_be_visible()
        except AssertionError:
            box = target.bounding_box()
            hit = page.evaluate('''([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.outerHTML.slice(0, 300) : null; }''',
                                [box['x'] + box['width'] / 2, box['y'] + box['height'] / 2]) if box else None
            log('TARGET MISSED', kind, index, box, hit)
            raise


def topology(topology_id):
    if topology_id not in TOPOLOGY:
        TOPOLOGY[topology_id] = json.loads(subprocess.run(
            ['node', '--experimental-strip-types', str(HERE / 'topology.mjs'), topology_id],
            check=True, capture_output=True, text=True, cwd=ROOT).stdout)
    return TOPOLOGY[topology_id]


def sfck_hints(view):
    return view['hints']['modules']['seafarersCitiesKnights']


def sf_hints(view):
    return view['hints']['modules']['seafarers']


# ------------------------------------------------------------------------- games

def start_game(browser, count, profile, setup_mode, lobby=False):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    for page in pages:
        page.set_default_timeout(TIMEOUT)
    if lobby:
        host = pages[0]
        host.get_by_test_id('expansion-select').select_option('citiesKnights+seafarers')
        host.locator('#room-capacity').select_option(str(count))
        expect(host.get_by_test_id('resolved-profile')).to_be_visible()
        shot(host, 'lobby-combined', 'lobby: Cities & Knights + Seafarers resolves to Heading for New Shores (16 VP)')
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
        game_id = api(contexts[0], 'GET', '/api/games')['games'][0]['gameId']
        # Close the tables: four live 3D boards under software GL starve the
        # run. Each seat gets a fresh, idle page in the same context.
        for index, page in enumerate(pages):
            page.close()
            pages[index] = fresh_page(contexts[index], NAMES[index])
    else:
        room = api(contexts[0], 'POST', '/api/rooms', {'visibility': 'private', 'capacity': count, 'profileId': profile, 'setupMode': setup_mode})
        for context in contexts[1:]:
            api(context, 'POST', '/api/rooms/join', {'code': room['code']})
        for context in contexts:
            api(context, 'POST', f"/api/rooms/{room['id']}/ready", {'ready': True})
        game_id = api(contexts[0], 'POST', f"/api/rooms/{room['id']}/start")['gameId']
    identity = [api(context, 'GET', '/api/session')['player']['id'] for context in contexts]
    view = snap(contexts[0], f'/api/games/{game_id}')['view']
    assert view['engineVersion'] == 'sf-ck-2025.1', view['engineVersion']
    assert view['victoryTarget'] == 16, view['victoryTarget']
    assert view['board']['robber'] == -1 and view['board']['pirate'] is None, view['board']
    return contexts, pages, identity, game_id


def fresh_page(context, name):
    page = context.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'{name}: {error}'))
    page.set_default_timeout(TIMEOUT)
    return page


def is_sea(view, hex_):
    return view['board']['terrain'][hex_] == 'sea'


def coastal_with_sea_path(view, vertex):
    """A building site whose sea edge leads on to a second sea edge."""
    topo = topology(view['board']['topologyId'])
    for e1 in topo['vertices'][vertex]['edges']:
        edge = topo['edges'][e1]
        if not any(is_sea(view, h) for h in edge['hexes']):
            continue
        s1 = next(v for v in edge['vertices'] if v != vertex)
        for e2 in topo['vertices'][s1]['edges']:
            if e2 != e1 and all(is_sea(view, h) for h in topo['edges'][e2]['hexes']):
                return e1
    return None


def complete_setup(table: Table):
    """Setup over the API; player 1's first settlement goes on the coast with a starting ship."""
    p1 = table.identity[0]
    first = True
    while True:
        snapshot = table.snapshot()
        view = snapshot['view']
        turn = view['turn']
        if turn['phase'] != 'setup':
            return
        actor = turn['playerId']
        mine = table.snapshot(actor)['view']
        hints = mine['hints']
        if turn['setup']['stage'] == 'building':
            legal = hints['legalSettlements']
            vertex = legal[len(legal) // 2]
            if actor == p1 and first:
                coastal = [v for v in legal if coastal_with_sea_path(view, v) is not None]
                vertex = coastal[len(coastal) // 2]
            assert table.act(actor, {'type': 'setup.placeBuilding', 'vertex': vertex}), vertex
            continue
        ships = sf_hints(mine)['setupShips']
        if actor == p1 and first:
            first = False
            own = turn['setup'].get('lastVertex')
            wanted = coastal_with_sea_path(view, own) if own is not None else None
            if wanted in ships:
                assert table.act(actor, {'type': 'setup.placeShip', 'edge': wanted})
                continue
        command = ({'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]} if hints['legalRoads']
                   else {'type': 'setup.placeShip', 'edge': ships[0]})
        assert table.act(actor, command), command


def resolve_pending(table: Table, view, revision):
    pending = view['pending']
    if pending['kind'] == 'seafarers.gold':
        pid = pending['responders'][0]
        needed = sf_hints(table.snapshot(pid)['view'])['goldRequired']
        bank = view['bank']
        picks = []
        for resource in sorted(bank, key=lambda r: -bank[r]):
            while len(picks) < needed and bank[resource] > picks.count(resource):
                picks.append(resource)
        assert table.act(pid, {'type': 'gold.choose', 'resources': picks})
        return
    ckkit.resolve_pending(table, view, revision)


def play_until(table: Table, goal, limit=3000):
    for _ in range(limit):
        snapshot = table.snapshot()
        view = snapshot['view']
        if goal(view):
            return view
        assert not view['result'], 'game ended before the goal'
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
        assert table.act(actor, {'type': 'turn.end'})
    raise AssertionError(f'goal not reached in {limit} steps')


def p1_action(table):
    p1 = table.identity[0]
    return lambda view: view['turn']['playerId'] == p1 and view['turn']['phase'] == 'action' and view['pending'] is None


# ---------------------------------------------------------------------- fixtures

def plan_line(view, player):
    """Player 1's coastal building and a two-ship line out to sea from it."""
    topo = topology(view['board']['topologyId'])
    board = view['board']
    knights = {k['vertex'] for k in view['modules']['citiesKnights']['knights']}
    def free_vertex(v):
        return board['buildings'][v] is None and v not in knights
    own = [v for v, b in enumerate(board['buildings']) if b and b['player'] == player]
    best = None
    for b in own:
        for e1 in topo['vertices'][b]['edges']:
            road = board['roads'][e1]
            if road and not (road['player'] == player and road['ship']):
                continue
            if not any(is_sea(view, h) for h in topo['edges'][e1]['hexes']):
                continue
            s1 = next(v for v in topo['edges'][e1]['vertices'] if v != b)
            if not free_vertex(s1):
                continue
            for e2 in topo['vertices'][s1]['edges']:
                if e2 == e1 or board['roads'][e2] or not any(is_sea(view, h) for h in topo['edges'][e2]['hexes']):
                    continue
                s2 = next(v for v in topo['edges'][e2]['vertices'] if v != s1)
                if not free_vertex(s2):
                    continue
                pure = all(is_sea(view, h) for h in topo['vertices'][s1]['hexes'])
                score = (2 if pure else 0) + (1 if road else 0)
                if best is None or score > best[0]:
                    best = (score, b, e1, s1, e2, s2)
    assert best, 'no ship line from a player 1 building'
    _, b, e1, s1, e2, s2 = best
    pirate = next(h for h in topo['vertices'][s1]['hexes'] if is_sea(view, h))
    return {'building': b, 'ships': [e1, e2], 'knight': s1, 'end': s2, 'pirate': pirate}


def land_chain(view, player, start, avoid):
    """Two land steps from `start` along free road edges: [start, r, r2]."""
    topo = topology(view['board']['topologyId'])
    board = view['board']
    for e in topo['vertices'][start]['edges']:
        if board['roads'][e] or not any(not is_sea(view, h) for h in topo['edges'][e]['hexes']):
            continue
        r = next(v for v in topo['edges'][e]['vertices'] if v != start)
        if board['buildings'][r] or r in avoid:
            continue
        for f in topo['vertices'][r]['edges']:
            if f == e or board['roads'][f] or not any(not is_sea(view, h) for h in topo['edges'][f]['hexes']):
                continue
            r2 = next(v for v in topo['edges'][f]['vertices'] if v != r)
            if board['buildings'][r2] or r2 in avoid:
                continue
            return [e, f], r, r2
    return None


def pirate_target(view, plan, player):
    """A sea hex for the pirate with no other player's ship, so no theft prompt."""
    topo = topology(view['board']['topologyId'])
    for hex_, terrain in enumerate(view['board']['terrain']):
        if terrain != 'sea' or hex_ == plan['pirate']:
            continue
        foreign = any(view['board']['roads'][e] and view['board']['roads'][e]['player'] != player
                      for e, edge in enumerate(topo['edges']) if hex_ in edge['hexes'])
        if not foreign:
            return hex_
    raise AssertionError('no quiet sea hex')


def after_first_attack(state, player, plan, extra_knights=()):
    ck = state['moduleState']['citiesKnights']
    ck['attacks'] = 1
    ck['barbarian'] = 0
    state['board']['robber'] = state['board']['layout']['robber']
    state['board']['pirate'] = plan['pirate']
    for edge in plan['ships']:
        state['board']['roads'][edge] = {'player': player, 'ship': True}
    ck['knights'].append({'player': player, 'vertex': plan['knight'], 'level': 2, 'active': True})
    for vertex in extra_knights:
        ck['knights'].append({'player': player, 'vertex': vertex, 'level': 1, 'active': True})
    me = next(p for p in state['players'] if p['id'] == player)
    for card, amount in (('grain', 2), ('wool', 2), ('lumber', 1)):
        take(state['bank'], me['resources'], card, amount)


# ---------------------------------------------------------------------- UI flows

def failure_shots(pages, tag):
    traceback.print_exc()
    for index, seat_page in enumerate(pages):
        try:
            seat_page.screenshot(path=str(ckkit.OUT / f'failure-{tag}-seat{index}.png'), timeout=5000)
        except Exception as error:  # best effort only
            log('NOTE failure shot skipped', index, error)


def chase_pirate(table, page, renderer, tag, plan):
    """Player 1 chases the pirate with the knight on the ships, through the UI."""
    p1 = table.identity[0]
    view = table.snapshot(p1)['view']
    assert sfck_hints(view)['pirateChase'] == [plan['knight']], sfck_hints(view)
    target = pirate_target(view, plan, p1)
    slow = 2500 if renderer == 'r3f' else 700
    open_game(page, table.game_id, renderer)
    open_actions(page)
    page.get_by_test_id('action-knight.chasePirate').click()
    ui_click_target(page, 'vertex', plan['knight'])
    shot(page, f'{tag}-chase-pirate-knight', 'COMB-6: an active knight next to the pirate’s sea hex (on the ships) chases it', ms=slow)
    ui_confirm(page)
    expect(page.get_by_test_id('bandit-choice')).to_be_visible()
    expect(page.get_by_test_id('bandit-choice-text')).to_contain_text('海盜')
    expect(page.get_by_test_id('pirate-to-frame')).to_be_visible()
    land = [h for h, t in enumerate(view['board']['terrain']) if t not in ('sea',) and h != view['board']['robber']]
    expect(page.get_by_test_id(f'target-hex-{land[0]}')).to_have_count(0)
    ui_click_target(page, 'hex', target)
    shot(page, f'{tag}-chase-pirate-target', 'COMB-6: the pirate moves to sea hexes (or the frame) only; land is not offered', ms=slow)
    ui_confirm(page)
    after = table.snapshot(p1)['view']
    assert after['board']['pirate'] == target, (after['board']['pirate'], target)
    assert after['pending'] is None, after['pending']
    knight = next(k for k in after['modules']['citiesKnights']['knights'] if k['vertex'] == plan['knight'])
    assert not knight['active'], knight
    log('PIRATE', tag, plan['pirate'], '->', target)


def four_players(browser):
    contexts, pages, identity, game_id = start_game(browser, 4, 'sf-ck-new-shores-2025', 'fixed', lobby=True)
    table = Table(contexts, pages, identity, game_id)
    p1, page = identity[0], pages[0]
    try:
        complete_setup(table)
        play_until(table, p1_action(table))
        view = table.snapshot(p1)['view']
        plan = plan_line(view, p1)
        chain = land_chain(view, p1, plan['building'], {plan['knight'], plan['end']})
        assert chain, 'no land chain from the coastal building'
        roads, mover, chaser = chain
        log('PLAN 4p', plan, 'roads', roads, 'mover', mover, 'chaser', chaser)
        topo = topology(view['board']['topologyId'])
        robber_hex = next(h for h in topo['vertices'][chaser]['hexes'] if not is_sea(view, h))

        def fixture(state):
            after_first_attack(state, p1, plan, extra_knights=(mover, chaser))
            for edge in roads:
                state['board']['roads'][edge] = {'player': p1, 'ship': False}
            state['board']['robber'] = robber_hex
        SERVER.patch_game(game_id, fixture)

        # COMB-6 in SVG on desktop.
        chase_pirate(table, page, 'svg', 'p4-svg-desktop', plan)
        open_game(page, game_id, 'svg')
        expect(page.locator(f"[data-testid=\"knight-{plan['knight']}\"]")).to_have_attribute('data-active', 'false')
        expect(page.get_by_test_id('pirate-hex')).to_be_visible()
        shot(page, 'p4-svg-desktop-after-chase', 'ships, the lying knight on the sea intersection, pirate and robber together')

        # SFCK-4: a robber chase offers land hexes only (SVG, phone).
        phone, phone_page = phone_context(browser, contexts[0])
        phone_page.set_default_timeout(TIMEOUT)
        pages.append(phone_page)
        open_game(phone_page, game_id, 'svg')
        open_actions(phone_page)
        phone_page.get_by_test_id('action-knight.chaseRobber').click()
        ui_click_target(phone_page, 'vertex', chaser)
        ui_confirm(phone_page)
        expect(phone_page.get_by_test_id('bandit-choice-text')).to_contain_text('強盜')
        expect(phone_page.get_by_test_id('pirate-to-frame')).to_have_count(0)
        state_view = table.snapshot(p1)['view']
        assert sfck_hints(state_view)['bandit'] == 'robber', sfck_hints(state_view)
        sea_targets = [h for h in range(len(state_view['board']['terrain'])) if is_sea(state_view, h) and h != state_view['board']['pirate']]
        expect(phone_page.get_by_test_id(f'target-hex-{sea_targets[0]}')).to_have_count(0)
        robber_to = next(h for h, t in enumerate(state_view['board']['terrain']) if t not in ('sea', 'desert') and h != state_view['board']['robber'])
        ui_click_target(phone_page, 'hex', robber_to)
        shot(phone_page, 'p4-svg-phone-chase-robber', 'SFCK-4: a knight chasing the robber moves the robber only: land targets, no pirate frame')
        ui_confirm(phone_page)
        while table.snapshot(p1)['view']['pending'] is not None:
            pending = table.snapshot(p1)['view']['pending']
            assert pending['kind'] == 'steal', pending
            assert table.act(p1, {'type': 'pending.steal', 'victim': pending['candidates'][0]})
        assert table.snapshot(p1)['view']['board']['robber'] == robber_to
        pages.pop()
        phone.close()

        # COMB-2/3: a knight moves across own ships (3D, desktop).
        hint = next(k for k in ck_hints(table.snapshot(p1)['view'])['knights'] if k['vertex'] == mover)
        assert plan['end'] in hint['moves'], (plan, hint)
        open_game(page, game_id, 'r3f')
        open_actions(page)
        page.get_by_test_id('action-knight.move').click()
        ui_click_target(page, 'vertex', mover, confirm=False)
        expect(page.get_by_test_id(f"target-vertex-{plan['end']}")).to_be_attached()
        ui_click_target(page, 'vertex', plan['end'])
        shot(page, 'p4-3d-desktop-knight-across-ships', 'COMB-2: the knight’s targets reach across own roads and ships (junction at the own building)', ms=2500)
        ui_confirm(page)
        moved = table.snapshot(p1)['view']
        assert any(k['vertex'] == plan['end'] for k in moved['modules']['citiesKnights']['knights']), 'knight did not move'
        open_game(page, game_id, 'r3f')
        shot(page, 'p4-3d-desktop-board', '3D: ships, knights on the sea intersection and the coast, pirate and robber', ms=2500)

        # Score breakdown: island bonus, metropolis, defender, merchant and Longest Trade Route.
        def scores(state):
            me = next(p for p in state['players'] if p['id'] == p1)
            city = next(v for v, b in enumerate(state['board']['buildings']) if b and b['player'] == p1 and b['city'])
            ck = state['moduleState']['citiesKnights']
            ck['metropolises']['science'] = {'player': p1, 'vertex': city}
            me['improvements']['science'] = 4
            me['defenders'] = 1
            land_hex = next(h for h in topo['vertices'][city]['hexes'] if not is_sea(view, h) and view['board']['terrain'][h] not in ('gold', 'desert'))
            ck['merchant'] = {'player': p1, 'hex': land_hex}
            sf = state['moduleState']['seafarers']
            sf['islands'] = {p1: [2]}
            sf.setdefault('claims', []).append({'player': p1, 'island': 2, 'vertex': plan['end']})
            me['bonusPoints'] += 2
            state['awards']['longestRoad'] = p1
        SERVER.patch_game(game_id, scores)
        open_game(page, game_id, 'svg')
        # Hovering opens the seats panel; pin it so it stays open.
        page.get_by_test_id('players-toggle').hover()
        pin = page.get_by_test_id('players-pin')
        expect(pin).to_be_visible()
        if pin.get_attribute('aria-pressed') != 'true':
            pin.click()
        for mark in ('islands', 'metropolis', 'defender', 'merchant', 'route'):
            expect(page.get_by_test_id(f'players-{mark}-0')).to_be_visible()
        expect(page.get_by_test_id('players-route-0')).to_have_attribute('aria-label', re.compile(r'\(\+2\)'))
        shot(page, 'p4-svg-desktop-score', 'score: island bonus, metropolis, defender, merchant and Longest Trade Route together')
    except Exception:
        failure_shots(pages, '4p')
        raise
    finally:
        for context in contexts:
            context.close()


def chase_game(browser, count, profile, setup_mode, renderer, phone_renderer, other_renderer, tag):
    contexts, pages, identity, game_id = start_game(browser, count, profile, setup_mode)
    table = Table(contexts, pages, identity, game_id)
    p1 = identity[0]
    try:
        complete_setup(table)
        play_until(table, p1_action(table))
        plan = plan_line(table.snapshot(p1)['view'], p1)
        log('PLAN', tag, plan)
        SERVER.patch_game(game_id, lambda state: after_first_attack(state, p1, plan))
        if renderer == 'phone-r3f':
            phone, page = phone_context(browser, contexts[0])
            page.set_default_timeout(TIMEOUT)
            chase_pirate(table, page, 'r3f', f'{tag}-3d-phone', plan)
            phone.close()
            open_game(pages[0], game_id, other_renderer)
            shot(pages[0], f'{tag}-{other_renderer}-desktop-board', 'board after the pirate chase', ms=2500 if other_renderer == 'r3f' else 700)
        else:
            chase_pirate(table, pages[0], renderer, f'{tag}-{renderer}-desktop', plan)
            phone, page = phone_context(browser, contexts[0])
            page.set_default_timeout(TIMEOUT)
            open_game(page, game_id, phone_renderer)
            expect(page.get_by_test_id('pirate-hex')).to_be_attached() if phone_renderer == 'svg' else None
            shot(page, f'{tag}-{phone_renderer}-phone-board', 'phone board after the pirate chase', ms=2500 if phone_renderer == 'r3f' else 700)
            phone.close()
    except Exception:
        failure_shots(pages, tag)
        raise
    finally:
        for context in contexts:
            context.close()


# --------------------------------------------------------------------------- main

def main():
    ckkit.init(sys.argv)
    SERVER.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            # SFCK_STAGES=p4,p3,p6 (default: all) reruns a subset while debugging.
            stages = os.environ.get('SFCK_STAGES', 'p4,p3,p6').split(',')
            if 'p4' in stages:
                four_players(browser)
            if 'p3' in stages:
                chase_game(browser, 3, 'sf-ck-new-shores-2025', 'fixed', 'r3f', 'svg', None, 'p3')
            if 'p6' in stages:
                chase_game(browser, 6, 'sf-ck-new-shores-paired-2025', 'variable', 'phone-r3f', None, 'svg', 'p6')
            browser.close()
    finally:
        SERVER.stop()
    ckkit.REPORT['errors'] = ERRORS
    (ckkit.OUT / 'report.json').write_text(json.dumps(ckkit.REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
    log('CASES', len(ckkit.REPORT['cases']), 'ERRORS', len(ERRORS))
    if ERRORS:
        sys.exit(1)


if __name__ == '__main__':
    main()
