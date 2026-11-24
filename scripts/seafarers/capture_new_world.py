#!/usr/bin/env python3
"""New World (SF25 p. 20) browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 SF_TIMEOUT=180000 python3 scripts/seafarers/capture_new_world.py <new-empty-output-dir>

Reuses the New Shores harness (``capture.py``: private-SQLite service, Playwright
helpers, report format) and only adds the New World flow. Real games through the real
UI and API (no mocked snapshots); every command receipt must be accepted:

1. Lobby: Seafarers -> New World, 3-4 players only.
2. Maps: the random 42-hex map for 3 and 4 players in SVG and 3D (phone for 3); no
   printed ports, ten to be placed by the players.
3. Regeneration through the UI (3 players): the host proposes, a non-host sees no
   propose button, one player declines (the proposal is cancelled and the board is
   unchanged), the host proposes again and both others approve (the board changes,
   the revision goes up by one, the port counter restarts).
4. Port placement through the UI: player 1 in SVG, player 2 in 3D and player 3 on the
   phone (390 px, target list); the other seven ports over the API; a regeneration is
   no longer offered once the first port is down. The ten ports keep one edge apart.
5. Starting settlements over the API (a legal spot each); the help panel shows the rules.
6. A live finish for player 1: while the service is stopped a test-only fixture gives
   player 1 the turn, 8 bonus points and the resources for a settlement, and lays a road
   (``world_fixture.mjs plan``) beside a free corner on a non-home island. Through the UI
   player 1 builds the settlement there: +1 for the settlement, +1 island bonus = 12 VP
   and the result screen.
   The run FAILS if a count is wrong or the result screen is missing.
4 players: maps in both renderers, the ten ports and the settlements over the API.

``report.json`` lists every case with its sha256; only the curated captures
are kept (``committed: true``), the other images are deleted after the run.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

from playwright.sync_api import expect, sync_playwright

import capture as base  # noqa: E402  (module-level setup reads argv[1] and prepares OUT)
from capture import ERRORS, OUT, PHONE, REPORT, SERVER, TIMEOUT, api, log, new_player, open_actions, open_game, shot, snap, ui_confirm

expect.set_options(timeout=TIMEOUT)

REPORT.clear()
REPORT.update({'scenario': 'new-world', 'profile': 'sf-new-world-2025', 'base': base.BASE, 'cases': []})

NAMES = ['海岸領航員', 'Mira', '阿卡', 'Jonas']
FIXTURE = str(base.ROOT / 'scripts/seafarers/world_fixture.mjs')
CURATED = {
    'lobby-new-world', 'map-3p-svg-desktop', 'map-4p-r3f-desktop', 'regenerate-vote-svg', 'map-3p-svg-regenerated',
    'harbor-targets-svg', 'harbor-targets-3d', 'harbor-placed-3d', 'harbor-targets-phone', 'map-3p-svg-ports',
    'help-world-svg-desktop', 'live-island-bonus-svg', 'live-result',
}


def click_target(page, kind, index, confirm=True):
    """Click a board target (the phone uses the target list: the seat panel covers part of the board)."""
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached(timeout=TIMEOUT)
    if page.viewport_size['width'] < 600:
        page.get_by_test_id('open-target-picker').click()
        page.get_by_test_id(f'picker-{kind}-{index}').click()
        if confirm:
            expect(page.get_by_test_id('confirm-selection')).to_be_visible(timeout=TIMEOUT)
        return
    target.click(force=True)
    picker = page.get_by_test_id('target-picker')
    page.wait_for_timeout(300)
    if picker.count() and picker.is_visible():
        log('PICKER', kind, index)
        page.get_by_test_id(f'picker-{kind}-{index}').click()
    if confirm:
        expect(page.get_by_test_id('confirm-selection')).to_be_visible(timeout=TIMEOUT)


def fixture(*args, state):
    out = subprocess.run(['node', '--experimental-strip-types', FIXTURE, *args], input=json.dumps(state), check=True,
                         capture_output=True, text=True, cwd=base.ROOT).stdout
    return json.loads(out)


def start_world(browser, count, lobby_shot=None):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.get_by_test_id('scenario-select').select_option('new-world')
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    options = host.locator('#room-capacity option').evaluate_all('(items) => items.map((item) => item.value)')
    assert options == ['3', '4'], options
    if lobby_shot:
        shot(host, lobby_shot, 'lobby: Seafarers / New World, 3-4 players only')
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


def tally(values):
    out = {}
    for value in values:
        out[str(value)] = out.get(str(value), 0) + 1
    return out


def check_board(view, count):
    board = view['board']
    assert board['topologyId'] == 'sf-new-world', board['topologyId']
    assert view['victoryTarget'] == 12 and view['engineVersion'] == 'sf-2025.3'
    assert tally(board['terrain']) == {'sea': 19, 'fields': 5, 'hills': 4, 'mountains': 4, 'pasture': 5, 'forest': 5}, tally(board['terrain'])
    assert tally([n for n in board['numbers'] if n is not None]) == {'2': 1, '3': 3, '4': 3, '5': 3, '6': 2, '8': 2, '9': 3, '10': 3, '11': 2, '12': 1}
    assert board['robber'] == -1 and board['pirate'] is None
    assert len(board['terrain']) == 42


def map_shots(browser, contexts, pages, game_id, count, phone=False):
    """3 / 4 player maps in SVG and 3D: the same random 42 hexes, no printed ports."""
    host_ctx, host = contexts[0], pages[0]
    view = snap(host_ctx, f'/api/games/{game_id}')['view']
    check_board(view, count)
    for renderer in ('svg', 'r3f'):
        open_game(host, game_id, renderer)
        if renderer == 'svg':
            assert host.locator('[data-testid^="hex-"]').count() == 42
            assert host.locator('[data-testid^="harbor-"]').count() == 0
        expect(host.get_by_test_id('world-harbor')).to_be_visible()
        shot(host, f'map-{count}p-{renderer}-desktop', 'random map, port stage: ' + view['board']['topologyId'], ms=2500 if renderer == 'r3f' else 700)
    if not phone:
        return
    phone_ctx = browser.new_context(storage_state=host_ctx.storage_state(), viewport=PHONE, locale='zh-TW',
                                    reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    page = phone_ctx.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    page.set_default_timeout(TIMEOUT)
    open_game(page, game_id, 'svg')
    shot(page, f'map-{count}p-svg-phone', view['board']['topologyId'])
    phone_ctx.close()


def board(contexts, game_id):
    return snap(contexts[0], f'/api/games/{game_id}')


def regenerate_flow(contexts, pages, identity, game_id):
    """Host proposes; p2 sees no button; p3 declines (cancelled, unchanged); host proposes again, p2 and p3 approve."""
    host, second, third = pages[0], pages[1], pages[2]
    for page in (second, third):
        open_game(page, game_id, 'svg')
    open_game(host, game_id, 'svg')
    before = board(contexts, game_id)
    layout = json.dumps([before['view']['board']['terrain'], before['view']['board']['numbers']])
    expect(host.get_by_test_id('world-regenerate')).to_be_visible()
    assert second.get_by_test_id('world-regenerate').count() == 0
    expect(second.get_by_test_id('world-regenerate-note')).to_be_visible()

    host.get_by_test_id('world-regenerate').click()
    expect(second.get_by_test_id('regenerate-proposal')).to_be_visible()
    expect(host.get_by_test_id('regenerate-waiting')).to_be_visible()
    shot(second, 'regenerate-vote-svg', 'a non-host seat sees the vote: agree or decline (every human must agree)')
    third.get_by_test_id('regenerate-reject').click()
    expect(host.get_by_test_id('regenerate-proposal')).to_have_count(0)
    after = board(contexts, game_id)
    assert after['revision'] == before['revision'], (before['revision'], after['revision'])
    assert json.dumps([after['view']['board']['terrain'], after['view']['board']['numbers']]) == layout, 'a refusal must not redraw'

    host.get_by_test_id('world-regenerate').click()
    expect(second.get_by_test_id('regenerate-proposal')).to_be_visible()
    second.get_by_test_id('regenerate-approve').click()
    expect(host.get_by_test_id('regenerate-waiting')).to_be_visible()
    # 還差一位時版圖不動（房主單方也無法重排）。
    middle = board(contexts, game_id)
    assert middle['revision'] == before['revision']
    third.get_by_test_id('regenerate-approve').click()
    host.wait_for_function("() => !document.querySelector('[data-testid=\"regenerate-proposal\"]')", timeout=TIMEOUT)
    done = board(contexts, game_id)
    assert done['revision'] == before['revision'] + 1, (before['revision'], done['revision'])
    assert json.dumps([done['view']['board']['terrain'], done['view']['board']['numbers']]) != layout, 'every seat agreed: the board must change'
    check_board(done['view'], 3)
    world = done['view']['modules']['seafarers']['world']
    assert world['rerolls'] == 1 and world['placed'] == 0 and world['canRegenerate'], world
    open_game(host, game_id, 'svg')
    shot(host, 'map-3p-svg-regenerated', 'after every seat agreed: a new random board, port counter back at 1 of 10')
    REPORT['regenerate'] = {'declined': True, 'revisionBefore': before['revision'], 'revisionAfter': done['revision'], 'rerolls': world['rerolls']}


def harbors_over_api(contexts, identity, game_id, until=10):
    by_id = dict(zip(identity, contexts))
    path = f'/api/games/{game_id}'
    step = 0
    while True:
        current = snap(contexts[0], path)
        world = current['view']['modules']['seafarers']['world']
        if world['placed'] >= until or current['view']['turn']['setup']['stage'] != 'harbor':
            return current
        actor = current['view']['turn']['playerId']
        mine = snap(by_id[actor], path)
        edges = mine['view']['hints']['modules']['seafarers']['harborChoices']['edges']
        command = {'type': 'world.harbor', 'edge': edges[(step * 7) % len(edges)]}
        step += 1
        response = by_id[actor].request.post(f'{base.BASE}{path}/commands', data={
            'commandId': f'nw-h{step}-{world["placed"]}-{current["revision"]}', 'expectedRevision': mine['revision'], 'command': command})
        body = response.json()
        assert body['ok'] and body['data']['outcome'] == 'accepted', (command, body)


def place_by_ui(page, contexts, identity, game_id, seat, label, renderer):
    """The acting player picks the edge on the board and confirms; the placed port must show up in the snapshot."""
    path = f'/api/games/{game_id}'
    current = snap(contexts[0], path)
    assert current['view']['turn']['playerId'] == identity[seat], current['view']['turn']
    mine = snap(contexts[seat], path)
    choices = mine['view']['hints']['modules']['seafarers']['harborChoices']
    drawn = current['view']['modules']['seafarers']['world']['drawn']
    assert choices['harbors'] == [drawn] and len(choices['edges']) > 10, (choices, drawn)
    placed = len(current['view']['board']['harbors'])
    edge = choices['edges'][seat * 5 % len(choices['edges'])]
    expect(page.get_by_test_id('world-harbor-drawn')).to_be_visible()
    expect(page.get_by_test_id('world-harbor-choose')).to_be_visible()
    for target in choices['edges']:
        expect(page.get_by_test_id(f'target-edge-{target}')).to_be_attached()
    if label:
        shot(page, label, f'{renderer}: the legal coast edges for the drawn port ({drawn})', ms=2500 if renderer == 'r3f' else 700)
    click_target(page, 'edge', edge)
    ui_confirm(page)
    after = snap(contexts[0], path)['view']
    assert len(after['board']['harbors']) == placed + 1, after['board']['harbors']
    assert {'edge': edge, 'type': drawn} in after['board']['harbors'], (edge, drawn, after['board']['harbors'])
    return edge


def setup_over_api(contexts, identity, game_id):
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
        assert turn['setup']['stage'] in ('building', 'road'), turn['setup']
        if turn['setup']['stage'] == 'building':
            legal = hints['legalSettlements']
            command = {'type': 'setup.placeBuilding', 'vertex': legal[(step * 37) % len(legal)]}
            step += 1
        else:
            command = {'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]}
        response = by_id[actor].request.post(f'{base.BASE}{path}/commands', data={
            'commandId': f'nw-s{step}-{len(REPORT["cases"])}-{command["type"]}-{view["seq"]}',
            'expectedRevision': mine['revision'], 'command': command})
        body = response.json()
        assert body['ok'] and body['data']['outcome'] == 'accepted', (command, body)


def ports_by_ui(browser, contexts, pages, identity, game_id):
    # --- p1：SVG ---------------------------------------------------------------------
    open_game(pages[0], game_id, 'svg')
    place_by_ui(pages[0], contexts, identity, game_id, 0, 'harbor-targets-svg', 'svg')
    after = snap(contexts[0], f'/api/games/{game_id}')['view']
    assert after['modules']['seafarers']['world']['canRegenerate'] is False
    expect(pages[0].get_by_test_id('world-regenerate')).to_have_count(0)
    # --- p2：3D ----------------------------------------------------------------------
    open_game(pages[1], game_id, 'r3f')
    place_by_ui(pages[1], contexts, identity, game_id, 1, 'harbor-targets-3d', 'r3f')
    pages[1].wait_for_timeout(800)
    shot(pages[1], 'harbor-placed-3d', 'port placed through the 3D board; it shows on the chosen edge', ms=2500)
    # --- p3：手機（目標清單）--------------------------------------------------------------
    phone_ctx = browser.new_context(storage_state=contexts[2].storage_state(), viewport=PHONE, locale='zh-TW',
                                    reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    phone = phone_ctx.new_page()
    phone.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    phone.set_default_timeout(TIMEOUT)
    open_game(phone, game_id, 'svg')
    place_by_ui(phone, [contexts[0], contexts[1], phone_ctx], identity, game_id, 2, 'harbor-targets-phone', 'phone svg')
    phone_ctx.close()


def finish_live(contexts, pages, identity, game_id):
    p1 = identity[0]
    plan = {}
    path = f'/api/games/{game_id}'

    def prepare(state):
        seat = next(i for i, player in enumerate(state['players']) if player['id'] == p1)
        plan.update(fixture('plan', p1, state=state))
        player = state['players'][seat]
        player['resources'] = {'lumber': 1, 'brick': 1, 'wool': 1, 'grain': 1, 'ore': 0}
        # 2 起始村落 + 8 = 10；蓋村落 +1、非 home 島 +1 = 12。
        player['bonusPoints'] = 8
        state['board']['roads'][plan['edge']] = {'player': p1, 'ship': False}
        state['turn'].update({'seat': seat, 'phase': 'action', 'dice': [3, 4], 'setup': None})
        state['pending'] = None
        state['windowId'] += 1
    SERVER.patch_game(game_id, prepare)
    for other in pages:
        other.reload()
    page = pages[0]
    open_game(page, game_id, 'svg')
    hints = snap(contexts[0], path)['view']['hints']
    assert plan['vertex'] in hints['legalSettlements'], ('free corner on a non-home island is not legal', plan)
    home = snap(contexts[0], path)['view']['modules']['seafarers']['home'][p1]
    assert plan['island'] not in home, (plan, home)
    open_actions(page)
    page.get_by_test_id('action-build.settlement').click()
    click_target(page, 'vertex', plan['vertex'])
    shot(page, 'live-island-bonus-svg', 'first settlement on a non-home island: +1 settlement, +1 island bonus = 12 VP (preview)')
    ui_confirm(page)
    view = snap(contexts[0], path)['view']
    assert view['result'] and view['result']['playerId'] == p1 and view['result']['reason'] == 'victory', view['result']
    sea = view['modules']['seafarers']
    assert sea['islandBonus'][p1] == [plan['island']], sea['islandBonus']
    expect(page.get_by_test_id('result-screen')).to_be_visible()
    expect(page.get_by_test_id('result-winner')).to_be_visible()
    shot(page, 'live-result', '12 VP on their own turn: result screen')
    REPORT['finish'] = {'plan': plan, 'result': view['result']}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        # --- 3 玩家：完整流程 -----------------------------------------------------------
        contexts, pages, identity, game_id = start_world(browser, 3, lobby_shot='lobby-new-world')
        map_shots(browser, contexts, pages, game_id, 3, phone=True)
        regenerate_flow(contexts, pages, identity, game_id)
        ports_by_ui(browser, contexts, pages, identity, game_id)
        current = harbors_over_api(contexts, identity, game_id)
        view = current['view']
        assert len(view['board']['harbors']) == 10 and view['turn']['setup']['stage'] == 'building', view['turn']
        topology_edges = {harbor['edge'] for harbor in view['board']['harbors']}
        assert len(topology_edges) == 10
        assert tally([h['type'] for h in view['board']['harbors']]) == {'lumber': 1, 'brick': 1, 'wool': 1, 'grain': 1, 'ore': 1, 'generic': 5}
        open_game(pages[0], game_id, 'svg')
        assert pages[0].locator('[data-testid^="harbor-"]').count() >= 10
        shot(pages[0], 'map-3p-svg-ports', 'ten ports placed by the players, one edge apart; starting settlements next')
        setup_over_api(contexts, identity, game_id)
        view = snap(contexts[0], f'/api/games/{game_id}')['view']
        home = view['modules']['seafarers']['home']
        assert sorted(home) == sorted(identity) and all(1 <= len(islands) <= 2 for islands in home.values()), home
        host = pages[0]
        open_game(host, game_id, 'svg')
        host.locator('#tool-help').click()
        for key in ('setup', 'ports', 'bandits', 'bonus', 'regenerate', 'win'):
            expect(host.get_by_test_id(f'help-world-{key}')).to_be_visible()
        shot(host, 'help-world-svg-desktop', 'ports and settlements done; help panel shows the New World rules')
        finish_live(contexts, pages, identity, game_id)
        for context in contexts:
            context.close()
        # --- 4 玩家：地圖與 API 設置 ------------------------------------------------------
        contexts, pages, identity, game_id = start_world(browser, 4)
        map_shots(browser, contexts, pages, game_id, 4)
        harbors_over_api(contexts, identity, game_id)
        setup_over_api(contexts, identity, game_id)
        view = snap(contexts[0], f'/api/games/{game_id}')['view']
        assert len(view['board']['harbors']) == 10 and view['turn']['phase'] != 'setup'
        REPORT['fourPlayers'] = {'harbors': len(view['board']['harbors']), 'home': view['modules']['seafarers']['home']}
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
