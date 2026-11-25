#!/usr/bin/env python3
"""The Pirate Islands (SF25 pp. 16-17) browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 SF_TIMEOUT=180000 python3 scripts/seafarers/capture_pirate_islands.py <new-empty-output-dir>

Reuses the New Shores harness (``capture.py``: private-SQLite service, Playwright helpers, report
format). Real games through the real UI and API (no mocked snapshots); the service state is read back
after every UI command, so a rejected command fails the run.

1. Lobby: Seafarers -> The Pirate Islands, 3-4 players only.
2. Maps: the shared 49-hex map for 3 and 4 players in SVG and 3D during setup (8 harbours, one fortress
   with 3 lair tokens and one beachhead per player, the 14-hex pirate route with its 14 clockwise arrows,
   the pirate on the first hex; DOM counts in SVG, ``data-*`` probes on the 3D canvas); a phone for 4.
3. Setup finished over the API; ``pirate_fixture.mjs check`` confirms every starting settlement is on the
   main island and everyone has 2 + the preset village.
4. A live game for player 1 through the UI. Between steps, while the service is stopped, a test-only fixture
   (``pirate_fixture.mjs``, which uses the rules engine's own commands) prepares the board:
   - ship line: one ship built in SVG, one in 3D (the next-target ring marks the beachhead);
   - a boxed-in line (other players' ships around the end) and the retreat of the end ship in 3D;
   - the pirate's cruise and an attack on player 1 (every die result hits one of his buildings) in SVG, and the
     supply pick after winning against it (nine warships) in 3D;
   - knight -> warship in SVG, the knight button disabled with its reason when every line ship is a warship (3D);
   - the end-of-turn attack on the fortress: a certain win with 9 warships, recapture (banner, no lairs), the pirate
     leaving when every fortress is recaptured, and the 10-point win (result screen on desktop and a phone).
   The run FAILS if a count, event or result is wrong.

``report.json`` lists every case with its sha256; only the curated captures are kept (``committed: true``).
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys

from playwright.sync_api import expect, sync_playwright

import capture as base  # noqa: E402  (module-level setup reads argv[1] and prepares OUT)
from capture import ERRORS, OUT, PHONE, REPORT, SERVER, TIMEOUT, api, log, new_player, open_actions, open_game, shot, snap
from capture import ui_click_target, ui_confirm

expect.set_options(timeout=TIMEOUT)

REPORT.clear()
REPORT.update({'scenario': 'pirate-islands', 'profile': 'sf-pirate-islands-2025', 'base': base.BASE, 'cases': []})

NAMES = ['海岸領航員', 'Mira', '阿卡', 'Jonas']
FIXTURE = str(base.ROOT / 'scripts/seafarers/pirate_fixture.mjs')
CURATED = {
    'lobby-pirate-islands', 'map-3p-svg-desktop', 'map-4p-svg-desktop', 'map-4p-r3f-desktop', 'map-4p-svg-phone',
    'live-line-svg', 'live-line-3d', 'live-boxed-in-svg', 'live-backtrack-3d', 'live-pirate-attack-svg',
    'live-warship-svg', 'live-knight-blocked-3d', 'live-attack-recapture-svg', 'live-recaptured-3d',
    'live-result-pirate', 'live-result-pirate-phone',
}


def fixture(mode, *args, state):
    run = subprocess.run(['node', '--experimental-strip-types', FIXTURE, mode, *args], input=json.dumps(state),
                         capture_output=True, text=True, cwd=base.ROOT)
    if run.returncode != 0:
        raise AssertionError(f'fixture {mode} failed: {run.stderr[-1500:]}')
    return json.loads(run.stdout)


def prepare(game_id, mode=None, *args, edit=None, apply=True):
    """Stop the service, optionally run a fixture mode and a Python edit on the persisted state, restart. Returns the fixture info."""
    info = {}

    def mutate(state):
        if mode:
            result = fixture(mode, *args, state=state)
            info.update(result['info'])
            if apply:
                state.clear()
                state.update(result['state'])
        if edit:
            edit(state)
    SERVER.patch_game(game_id, mutate)
    return info


def turn_of(state, player, phase='action'):
    seat = next(i for i, p in enumerate(state['players']) if p['id'] == player)
    state['turn'].update({'seat': seat, 'phase': phase, 'dice': [3, 4], 'setup': None, 'devCardPlayed': False})
    state['pending'] = None
    state['windowId'] += 1
    seafarers = state['moduleState']['seafarers']
    seafarers['built'] = []
    seafarers['moved'] = False


def give(state, player, resources):
    me = next(p for p in state['players'] if p['id'] == player)
    for resource, amount in resources.items():
        me['resources'][resource] += amount
        state['bank'][resource] -= amount


def hand(state, player, resources):
    """Set a hand exactly, moving the difference to or from the supply (conserved)."""
    me = next(p for p in state['players'] if p['id'] == player)
    for resource in ('lumber', 'brick', 'wool', 'grain', 'ore'):
        want = resources.get(resource, 0)
        state['bank'][resource] += me['resources'][resource] - want
        me['resources'][resource] = want


def pirate_view(context, game_id):
    return snap(context, f'/api/games/{game_id}')['view']['modules']['seafarers']['pirateIslands']


def rail_open(page):
    """Expand the action rail and keep the pointer over it (a collapsed rail hides its buttons)."""
    open_actions(page)
    rail = page.get_by_test_id('action-rail')
    if rail.count():
        rail.hover()
        expect(rail).to_have_attribute('data-expanded', 'true')


def shot_players(page, name, note, ms=700):
    """Screenshot with the players panel expanded (hover keeps it open; ``shot`` parks the pointer in a corner)."""
    panel = page.get_by_test_id('players-panel')
    panel.hover()
    expect(panel).to_have_attribute('data-expanded', 'true')
    page.wait_for_timeout(ms)
    path = OUT / f'{name}.png'
    page.screenshot(path=str(path), animations='disabled', timeout=TIMEOUT)
    REPORT['cases'].append({'name': name, 'status': 'PASS', 'note': note, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                            'viewport': page.viewport_size})
    log('CAPTURE', name, note)


def shot_keep(page, name, note, ms=700):
    """Screenshot without moving the pointer (``shot`` parks it in a corner, which closes the hand fan)."""
    page.wait_for_timeout(ms)
    path = OUT / f'{name}.png'
    page.screenshot(path=str(path), animations='disabled', timeout=TIMEOUT)
    REPORT['cases'].append({'name': name, 'status': 'PASS', 'note': note, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                            'viewport': page.viewport_size})
    log('CAPTURE', name, note)


def inspect_knight(page):
    """Open the hand fan and raise (inspect) the first held knight: only then is its play button shown."""
    page.get_by_test_id('hand-panel').hover()
    expect(page.get_by_test_id('hand-panel')).to_have_attribute('data-expanded', 'true')
    card = page.locator('.development-card--knight:not(.development-card--new) .development-card__inspect').first
    # The card toggles: click it only when it is not raised yet (a raised card hides its play button again on a second click).
    for _ in range(3):
        if card.get_attribute('aria-pressed') != 'true':
            card.click(force=True)
            page.wait_for_timeout(400)
        if page.get_by_test_id('play-knight-0').is_visible():
            return
    expect(page.get_by_test_id('play-knight-0')).to_be_visible()


def expand_players(page):
    toggle = page.get_by_test_id('players-toggle')
    if toggle.count() and toggle.get_attribute('aria-expanded') != 'true':
        toggle.click()


def start_pirate(browser, count, lobby_shot=None):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.get_by_test_id('scenario-select').select_option('pirate-islands')
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    options = host.locator('#room-capacity option').evaluate_all('(items) => items.map((item) => item.value)')
    assert options == ['3', '4'], options
    if lobby_shot:
        shot(host, lobby_shot, 'lobby: Seafarers / The Pirate Islands, 3-4 players only')
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


def browser_phone(host_context):
    return host_context.browser.new_context(storage_state=host_context.storage_state(), viewport=PHONE, locale='zh-TW',
                                            reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)


def map_shots(contexts, pages, game_id, count, phone=False):
    """3 / 4 player maps in SVG and 3D: 49 hexes, 8 harbours, one fortress (3 lairs) and one beachhead per player, 14 route arrows."""
    host_ctx, host = contexts[0], pages[0]
    view = snap(host_ctx, f'/api/games/{game_id}')['view']
    pi = view['modules']['seafarers']['pirateIslands']
    assert len(view['board']['terrain']) == 49 and len(view['board']['harbors']) == 8
    assert len(pi['fortresses']) == count and all(f['lairs'] == 3 for f in pi['fortresses']) and len(pi['beachheads']) == count
    assert len(pi['route']) == 14 and view['board']['pirate'] == pi['route'][0] and view['board']['robber'] == -1
    for renderer in ('svg', 'r3f'):
        open_game(host, game_id, renderer)
        if renderer == 'svg':
            assert host.locator('[data-testid^="hex-"]').count() == 49
            assert host.locator('[data-testid^="harbor-"]').count() == 8
            assert host.locator('[data-testid^="fortress-"][data-lairs="3"]').count() == count
            assert host.locator('[data-testid^="beachhead-"]').count() == count
            assert host.locator('[data-testid^="pirate-route-arrow-"]').count() == 14
            assert host.locator('[data-testid="pirate-hex"]').count() == 1
        else:
            host.wait_for_function(
                "(count) => { const d = document.querySelector('canvas')?.dataset; return d?.lairStacks === Array(count).fill(3).join(',') && d?.beachheadMarkers === String(count) && d?.routeArrows === '14'; }",
                arg=count, timeout=TIMEOUT)
        shot(host, f'map-{count}p-{renderer}-desktop', view['board']['topologyId'], ms=2500 if renderer == 'r3f' else 700)
    if not phone:
        return
    phone_ctx = browser_phone(host_ctx)
    page = phone_ctx.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    page.set_default_timeout(TIMEOUT)
    open_game(page, game_id, 'svg')
    assert page.locator('[data-testid^="beachhead-"]').count() == count
    shot(page, f'map-{count}p-svg-phone', view['board']['topologyId'])
    phone_ctx.close()


def setup_over_api(contexts, identity, game_id):
    """Every seat takes a different legal spot (the server only offers main-island corners)."""
    by_id = dict(zip(identity, contexts))
    path = f'/api/games/{game_id}'
    step = 0
    while True:
        view = snap(contexts[0], path)['view']
        turn = view['turn']
        if turn['phase'] != 'setup':
            return view
        actor = turn['playerId']
        mine = snap(by_id[actor], path)
        hints = mine['view']['hints']
        setup = turn['setup']
        if setup['stage'] == 'building':
            legal = hints['legalSettlements']
            command = {'type': 'setup.placeBuilding', 'vertex': legal[(step * 37) % len(legal)]}
            step += 1
        else:
            command = {'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]}
        response = by_id[actor].request.post(f'{base.BASE}{path}/commands', data={
            'commandId': f'pi-{step}-{len(REPORT["cases"])}-{command["type"]}-{setup["stage"]}-{view["seq"]}',
            'expectedRevision': mine['revision'], 'command': command})
        body = response.json()
        assert body['ok'] and body['data']['outcome'] == 'accepted', (command, body)


def events_of(context, game_id):
    return snap(context, f'/api/games/{game_id}')['view']['events']


def ui_build_ship(page, game_id, renderer, edge):
    open_game(page, game_id, renderer)
    rail_open(page)
    page.get_by_test_id('action-build.ship').click()
    expect(page.get_by_test_id(f'target-edge-{edge}')).to_be_attached()


def finish_live(contexts, pages, identity, game_id, browser):
    p1, p2 = identity[0], identity[1]
    page = pages[0]
    path = f'/api/games/{game_id}'

    def line_len():
        return len(pirate_view(contexts[0], game_id)['lines'][p1]['edges'])

    # --- check: setup left everyone with two starting villages beside the preset one, all on the main island --------------
    checked = {}
    prepare(game_id, edit=lambda state: checked.update(fixture('check', state=state)['info']))
    assert checked['largeOnly'] and set(checked['perPlayer'].values()) == {3} and checked['fortresses'] == 4 and checked['lairs'] == [3] * 4, checked
    assert set(checked['lines'].values()) == {1}, checked

    # --- ship line: the engine plans the next two line ships (shortest path), UI builds one in SVG and one in 3D ----------
    def prep_a(state):
        turn_of(state, p1)
        give(state, p1, {'lumber': 6, 'wool': 6, 'brick': 2, 'grain': 2})
    plan = prepare(game_id, 'line', p1, '2', apply=False)
    prepare(game_id, edit=prep_a)
    for other in pages:
        other.reload()
    planned = plan['added']
    assert len(planned) == 2 and line_len() == 1
    ui_build_ship(page, game_id, 'svg', planned[0])
    shot(page, 'live-line-svg', 'build ship: only the shortest-path step of the ship line (plus free coastal routes) is offered; the next target is ringed')
    ui_click_target(page, 'edge', planned[0])
    ui_confirm(page)
    expect(page.locator(f'[data-testid="ship-{planned[0]}"]')).to_be_visible()
    assert line_len() == 2 and pirate_view(contexts[0], game_id)['lines'][p1]['edges'][-1] == planned[0]
    ui_build_ship(page, game_id, 'r3f', planned[1])
    ui_click_target(page, 'edge', planned[1])
    ui_confirm(page)
    page.wait_for_timeout(1200)
    assert line_len() == 3 and pirate_view(contexts[0], game_id)['lines'][p1]['edges'][-1] == planned[1]
    shot(page, 'live-line-3d', 'the second line ship built in 3D', ms=2500)

    # --- a phone shows the line and the warship line text ---------------------------------------------------------------
    phone_ctx = browser_phone(contexts[0])
    phone = phone_ctx.new_page()
    phone.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    phone.set_default_timeout(TIMEOUT)
    open_game(phone, game_id, 'svg')
    shot(phone, 'live-line-phone', 'phone: the ship line toward the beachhead')
    phone_ctx.close()

    # --- boxed in: other players' ships around the end; the end ship goes back in 3D ----------------------------------------
    walled = {}

    def wall(state):
        turn_of(state, p1)
        result = fixture('wall', p1, state=state)
        walled.update(result['info'])
        state.clear()
        state.update(result['state'])
    SERVER.patch_game(game_id, wall)
    for other in pages:
        other.reload()
    assert walled['stuck'] and walled['targets'], walled
    last = walled['last']
    open_game(page, game_id, 'svg')
    expand_players(page)
    expect(page.get_by_test_id('line-stuck')).to_be_visible()
    assert page.get_by_test_id('line-stuck').get_attribute('data-backtrack') == 'true'
    shot_players(page, 'live-boxed-in-svg', 'the end of the line is walled in by other ships: the panel offers moving the end ship back')
    before = line_len()
    open_game(page, game_id, 'r3f')
    rail_open(page)
    page.get_by_test_id('action-ship.move').click()
    target = walled['targets'][0]
    page.get_by_test_id(f'target-edge-{last}').click(force=True)
    expect(page.get_by_test_id(f'target-edge-{target}')).to_be_attached()
    shot(page, 'live-backtrack-3d', 'ship.move of the end ship: its new places are offered (3D)', ms=2500)
    ui_click_target(page, 'edge', target)
    ui_confirm(page)
    page.wait_for_timeout(1200)
    after_line = pirate_view(contexts[0], game_id)['lines'][p1]['edges']
    assert len(after_line) <= before and last not in after_line, (before, after_line, last)
    assert any(e['type'] == 'ship.moved' for e in events_of(contexts[0], game_id))

    # --- the cruise and an attack: every die result lands beside one of player 1's buildings (no warships: he loses) -------
    ring_vertices = []

    def ring(state):
        turn_of(state, p1, 'preroll')
        hand(state, p1, {'lumber': 2, 'wool': 2, 'ore': 1})
        slot = state['moduleState']['seafarers']['pirateIslands']
        state['board']['pirate'] = slot['route'][0]
        result = fixture('ring', p1, state=state)
        ring_vertices.extend(result['info']['placed'])
        state.clear()
        state.update(result['state'])
    SERVER.patch_game(game_id, ring)
    for other in pages:
        other.reload()
    open_game(page, game_id, 'svg')
    page.get_by_test_id('prompt-roll').click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"pirate-position\"]') !== null", timeout=TIMEOUT)
    view = snap(contexts[0], path)['view']
    assert view['pending'] is None or view['pending']['kind'] in ('seafarers.sevenSteal', 'discard'), view['pending']
    if view['pending'] and view['pending']['kind'] == 'seafarers.sevenSteal':
        page.get_by_test_id('seven-steal-skip').click()
        page.wait_for_timeout(800)
    page.wait_for_timeout(1500)
    events = events_of(contexts[0], game_id)
    cruised = [e for e in events if e['type'] == 'pirate.cruised']
    attacked = [e for e in events if e['type'] == 'pirate.attacked' and e['params']['playerId'] == p1]
    assert cruised and attacked and attacked[-1]['params']['result'] == 'lost' and attacked[-1]['params']['warships'] == 0, attacked
    open_game(page, game_id, 'svg')
    shot(page, 'live-pirate-attack-svg', 'the pirate sailed along its route and attacked player 1 (no warships): the log and the new position ring')

    # --- nine warships beat the pirate whatever the die: the supply pick, in 3D ------------------------------------
    def fleet(state):
        turn_of(state, p1, 'preroll')
        slot = state['moduleState']['seafarers']['pirateIslands']
        slot['warships'][p1] = [900 + i for i in range(9)]
        state['board']['pirate'] = slot['route'][0]
    SERVER.patch_game(game_id, fleet)
    for other in pages:
        other.reload()
    open_game(page, game_id, 'r3f')
    page.get_by_test_id('prompt-roll').click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"pirate-gift\"]') !== null || document.querySelector('[data-testid=\"seven-steal\"]') !== null", timeout=TIMEOUT)
    if page.get_by_test_id('seven-steal').count():
        page.get_by_test_id('seven-steal-skip').click()
        page.wait_for_function("() => document.querySelector('[data-testid=\"pirate-gift\"]') !== null", timeout=TIMEOUT)
    shot(page, 'live-pirate-gift-3d', 'nine warships beat the pirate (any die): pick any 1 card from the supply', ms=2500)
    page.get_by_test_id('pirate-gift-ore').click()
    page.wait_for_timeout(1000)
    won = [e for e in events_of(contexts[0], game_id) if e['type'] == 'pirate.attacked' and e['params']['playerId'] == p1 and e['params']['result'] == 'won']
    assert won, 'no won attack'
    gifted = [e for e in events_of(contexts[0], game_id) if e['type'] == 'pirate.gifted' and e['params']['playerId'] == p1]
    assert gifted and gifted[-1]['params']['resource'] == 'ore', gifted

    # --- a complete line (9 ships), 3 warships and 2 knights: the knight converts a ship in SVG ------------------------------
    def full_line(state):
        slot = state['moduleState']['seafarers']['pirateIslands']
        for key in slot['warships']:
            slot['warships'][key] = []
        # the test-only ring buildings, the walls and the free ships of other players are removed again
        for vertex in ring_vertices:
            state['board']['buildings'][vertex] = None
        for edge, road in enumerate(state['board']['roads']):
            if road and road['ship'] and road['player'] != p1 and edge not in slot['lines'].get(road['player'], {'edges': []})['edges']:
                state['board']['roads'][edge] = None
        turn_of(state, p1)
        state['board']['pirate'] = slot['route'][0]
    SERVER.patch_game(game_id, full_line)

    def finish_line(state):
        result = fixture('line', p1, 'done', state=state)
        state.clear()
        state.update(result['state'])
        slot = state['moduleState']['seafarers']['pirateIslands']
        edges = slot['lines'][p1]['edges']
        assert len(edges) == 9, edges
        slot['warships'][p1] = edges[:3]
        me = next(p for p in state['players'] if p['id'] == p1)
        me['devCards'] = ['knight', 'knight']
        hand(state, p1, {})
        turn_of(state, p1)
    SERVER.patch_game(game_id, finish_line)
    for other in pages:
        other.reload()
    view = pirate_view(contexts[0], game_id)
    assert view['lines'][p1]['next'] == 'done' and len(view['warships'][p1]) == 3
    open_game(page, game_id, 'svg')
    expect(page.get_by_test_id('play-knight-0')).to_be_enabled()
    inspect_knight(page)
    shot_keep(page, 'live-knight-ready-svg', 'the knight card is raised: its button reads "Convert a ship (knight)" and the card text says what it does')
    page.get_by_test_id('play-knight-0').click()
    page.wait_for_timeout(1000)
    assert snap(contexts[0], path)['view']['turn']['devCardPlayed']
    view = pirate_view(contexts[0], game_id)
    assert len(view['warships'][p1]) == 4 and view['warships'][p1] == view['lines'][p1]['edges'][:4], view['warships']
    assert snap(contexts[0], path)['view']['board']['robber'] == -1
    open_game(page, game_id, 'svg')
    assert page.locator('[data-warship="true"]').count() >= 4
    shot(page, 'live-warship-svg', 'a knight converted the ship closest to the starting village: four warships lie on their side')

    # --- end of turn: the automatic attack on the fortress (random die; the result must match the rules) -------------------
    open_game(page, game_id, 'svg')
    page.get_by_test_id('prompt-end-turn').click()
    page.wait_for_timeout(1500)
    attack = [e for e in events_of(contexts[0], game_id) if e['type'] == 'fortress.attacked' and e['params']['playerId'] == p1]
    assert attack, 'no attack on the fortress'
    params = attack[-1]['params']
    expected = 'won' if params['warships'] > params['die'] else 'tie' if params['warships'] == params['die'] else 'lost'
    assert params['warships'] == 4 and params['result'] == expected, params
    assert len(params['removed']) == {'won': 0, 'tie': 1, 'lost': 2}[expected], params
    assert snap(contexts[0], path)['view']['turn']['playerId'] != p1
    open_game(page, game_id, 'svg')
    shot(page, 'live-attack-log', f"automatic attack when ending the turn: die {params['die']} against 4 warships is a {expected}")
    REPORT['attack'] = params

    # --- 9 warships on the line: no ordinary ship left, the knight button is disabled with its reason (3D); the attack wins --
    def ready_win(state):
        # the line may have been shortened by a lost attack: complete it again with the engine, then 9 warships and 1 lair left
        result = fixture('line', p1, 'done', state=state)
        state.clear()
        state.update(result['state'])
        slot = state['moduleState']['seafarers']['pirateIslands']
        edges = slot['lines'][p1]['edges']
        slot['warships'][p1] = edges[:]
        for fortress in slot['fortresses']:
            if fortress['player'] == p1:
                fortress['lairs'] = 1
        me = next(p for p in state['players'] if p['id'] == p1)
        me['devCards'] = ['knight']
        turn_of(state, p1)
    SERVER.patch_game(game_id, ready_win)
    for other in pages:
        other.reload()
    assert lines_done(pirate_view(contexts[0], game_id), p1)
    open_game(page, game_id, 'r3f')
    inspect_knight(page)
    button = page.get_by_test_id('play-knight-0')
    expect(button).to_be_disabled()
    assert page.get_by_test_id('warship-blocked').inner_text().startswith('你的船線上沒有可改裝的一般船'), page.get_by_test_id('warship-blocked').inner_text()
    shot_keep(page, 'live-knight-blocked-3d', 'every ship of the line is a warship: the knight button is disabled and says why (3D)', ms=2500)
    page.get_by_test_id('prompt-end-turn').click()
    page.wait_for_timeout(1500)
    view = pirate_view(contexts[0], game_id)
    fortress = next(f for f in view['fortresses'] if f['player'] == p1)
    assert fortress['lairs'] == 0, fortress
    assert snap(contexts[0], path)['view']['result'] is None
    kinds = [e['type'] for e in events_of(contexts[0], game_id)]
    assert 'fortress.recaptured' in kinds
    open_game(page, game_id, 'r3f')
    page.wait_for_function("() => document.querySelector('canvas')?.dataset.lairStacks?.startsWith('0,') || document.querySelector('canvas')?.dataset.lairStacks?.includes('0')", timeout=TIMEOUT)
    shot(page, 'live-recaptured-3d', 'the recaptured fortress: no lair stack, a banner in the owner colour (3D)', ms=2500)
    open_game(page, game_id, 'svg')
    assert page.locator(f'[data-testid="fortress-{fortress["vertex"]}"][data-lairs="0"]').count() == 1
    shot(page, 'live-attack-recapture-svg', 'fortress recaptured by the end-of-turn attack: the banner replaces the lair stack (SVG)')

    # --- every fortress recaptured: the pirate leaves; 10 points and the recaptured fortress win ------------------------------
    def last_fortress(state):
        slot = state['moduleState']['seafarers']['pirateIslands']
        for entry in slot['fortresses']:
            entry['lairs'] = 0 if entry['player'] != p2 else 1
        slot['warships'][p2] = slot['lines'][p2]['edges'][:] if slot['lines'][p2]['edges'] else []
        result = fixture('line', p2, 'done', state=state)
        state.clear()
        state.update(result['state'])
        slot = state['moduleState']['seafarers']['pirateIslands']
        slot['warships'][p2] = slot['lines'][p2]['edges'][:]
        me = next(p for p in state['players'] if p['id'] == p2)
        # nine warships beat any die; 9 hidden victory points beside the recaptured fortress make 10
        me['devCards'] = ['victoryPoint'] * 7
        turn_of(state, p2)
    SERVER.patch_game(game_id, last_fortress)
    for other in pages:
        other.reload()
    view = snap(contexts[1], path)['view']
    assert view['turn']['playerId'] == p2 and view['board']['pirate'] is not None
    page2 = pages[1]
    open_game(page2, game_id, 'svg')
    page2.get_by_test_id('prompt-end-turn').click()
    expect(page2.get_by_test_id('result-screen')).to_be_visible()
    view = snap(contexts[0], path)['view']
    if view['result'] is None:
        raise AssertionError('no result')
    assert view['result']['cause'] == 'fortressRecaptured' and view['result']['playerId'] == p2, view['result']
    assert view['board']['pirate'] is None, view['board']['pirate']
    assert 'pirate.removed' in [e['type'] for e in view['events']]
    expect(page2.get_by_test_id('result-reason')).to_have_attribute('data-cause', 'fortressRecaptured')
    shot(page2, 'live-result-pirate', 'all fortresses recaptured (the pirate is gone from the final board) and 10 VP: the fortress ending')
    page2.set_viewport_size(PHONE)
    expect(page2.get_by_test_id('result-reason')).to_be_visible()
    assert page2.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), 'result screen overflows horizontally on a phone'
    shot(page2, 'live-result-pirate-phone', 'the same result in a phone-sized viewport')
    REPORT['finish'] = {'result': view['result']}


def lines_done(view, player):
    return view['lines'][player]['next'] == 'done'


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for count in ((4,) if os.environ.get('SF_ONLY_LIVE') else (3, 4)):
            contexts, pages, identity, game_id = start_pirate(browser, count, lobby_shot='lobby-pirate-islands' if count == 3 else None)
            view = snap(contexts[0], f'/api/games/{game_id}')['view']
            assert view['board']['topologyId'] == 'sf-pirate-islands', view['board']['topologyId']
            assert view['victoryTarget'] == 10 and view['engineVersion'] == 'sf-2025.3'
            if not os.environ.get('SF_ONLY_LIVE'):
                map_shots(contexts, pages, game_id, count, phone=count == 4)
            if count == 4:
                setup_over_api(contexts, identity, game_id)
                host = pages[0]
                open_game(host, game_id, 'svg')
                host.locator('#tool-help').click()
                for key in ('line', 'cruise', 'seven', 'warship', 'attack', 'win'):
                    expect(host.get_by_test_id(f'help-pirate-{key}')).to_be_visible()
                shot(host, 'help-pirate-svg-desktop', 'setup done; help panel shows the Pirate Islands rules')
                try:
                    finish_live(contexts, pages, identity, game_id, browser)
                except Exception:
                    try:
                        pages[0].screenshot(path=str(OUT / 'failure.png'), timeout=10000)
                    except Exception as shot_error:  # the page may be busy; the original error matters more
                        log('FAILURE SCREENSHOT FAILED', shot_error)
                    raise
            for context in contexts:
                context.close()
        browser.close()
    REPORT['errors'] = ERRORS
    assert 'sf-new-shores' not in json.dumps(REPORT), 'New Shores data leaked into the report'
    for case in REPORT['cases']:
        keep = case['name'] in CURATED
        case['committed'] = keep
        if not keep:
            (OUT / f"{case['name']}.png").unlink(missing_ok=True)
    (OUT / 'report.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
    log('CASES', len(REPORT['cases']), 'ERRORS', len(ERRORS))
    if ERRORS:
        sys.exit(1)


def main():
    SERVER.start()
    try:
        run()
    finally:
        SERVER.stop()


if __name__ == '__main__':
    main()
