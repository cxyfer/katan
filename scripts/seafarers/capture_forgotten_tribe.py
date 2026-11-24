#!/usr/bin/env python3
"""The Forgotten Tribe (SF25 pp. 12-13) browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 SF_TIMEOUT=180000 python3 scripts/seafarers/capture_forgotten_tribe.py <new-empty-output-dir>

Reuses the New Shores harness (``capture.py``: private-SQLite service, Playwright
helpers, report format) and only adds the Forgotten Tribe flow. Real games through
the real UI and API (no mocked snapshots); every command receipt must be accepted:

1. Lobby: Seafarers -> The Forgotten Tribe, 3-4 players only.
2. Maps: the shared 49-hex map for 3 and 4 players in SVG and 3D during setup
   (18 gifts drawn in both renderers: DOM markers in SVG, ``data-gift-markers``
   on the 3D canvas; pirate on its sea hex); phone for 4.
3. Setup finished over the API (every step a legal spot on the large island);
   ``tribe_fixture.mjs check`` confirms it; the help panel shows the tribe rules.
4. A live finish for player 1 through the UI: while the service is stopped, a
   test-only fixture gives player 1 the turn, ships for 3 builds, 8 other bonus
   points, a coastal settlement on the large island and floating ships beside
   four gifts (``tribe_fixture.mjs plan``; the development card gift is fixed to
   a knight so the score is exact). Through the UI player 1
   - in 3D builds a ship onto a port gift and places that port on the board, then
     MOVES a ship onto a VP token (+1);
   - on the phone (390 px, SVG) builds a ship onto a port gift and handles the
     harbour placement;
   - in SVG places a third port, takes the development card gift (as bought this
     turn) and builds onto the second VP token: 13 VP and the result screen.
   The run FAILS if a gift does not disappear, a count is wrong or the result
   screen is missing.

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

# 忙碌的機器上預設的 5 秒 expect 逾時太短；沿用 SF_TIMEOUT。
expect.set_options(timeout=TIMEOUT)

# capture.py 的 REPORT 預先放了 New Shores 的 fixtures；這份報告只含世外部落資料。
REPORT.clear()
REPORT.update({'scenario': 'forgotten-tribe', 'profile': 'sf-forgotten-tribe-2025', 'base': base.BASE, 'cases': []})

NAMES = ['海岸領航員', 'Mira', '阿卡', 'Jonas']
FIXTURE = str(base.ROOT / 'scripts/seafarers/tribe_fixture.mjs')
CURATED = {
    'lobby-forgotten-tribe', 'map-4p-svg-desktop', 'map-4p-r3f-desktop', 'map-4p-svg-phone',
    'help-tribe-svg-desktop', 'live-port-targets-3d', 'live-port-placed-3d', 'live-ship-move-gift-3d', 'live-port-pending-phone',
    'live-gifts-svg', 'live-result',
}


def click_target(page, kind, index, confirm=True):
    """Click a board target; gift edges sit close together, so the ambiguity list (target picker) may open: choose there."""
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached(timeout=TIMEOUT)
    if page.viewport_size['width'] < 600:
        # 手機：座位面板與工具列蓋住部分棋盤，改用目標清單（無障礙替代操作）選位置。
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
        try:
            expect(page.get_by_test_id('confirm-selection')).to_be_visible(timeout=TIMEOUT)
        except AssertionError:
            if os.environ.get('SF_DEBUG'):
                page.screenshot(path='/tmp/claude-1000/ft-debug.png')
                log('DEBUG', page.get_by_test_id('target-picker').count(), page.locator('[data-testid^="picker-"]').count())
            raise


def fixture(*args, state):
    out = subprocess.run(['node', '--experimental-strip-types', FIXTURE, *args], input=json.dumps(state), check=True,
                         capture_output=True, text=True, cwd=base.ROOT).stdout
    return json.loads(out)


def start_tribe(browser, count, lobby_shot=None):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.get_by_test_id('scenario-select').select_option('forgotten-tribe')
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    options = host.locator('#room-capacity option').evaluate_all('(items) => items.map((item) => item.value)')
    assert options == ['3', '4'], options
    if lobby_shot:
        shot(host, lobby_shot, 'lobby: Seafarers / The Forgotten Tribe, 3-4 players only')
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


def map_shots(browser, contexts, pages, game_id, count, phone=False):
    """3 / 4 player maps in SVG and 3D: the same 49 hexes and 18 gifts in both renderers."""
    host_ctx, host = contexts[0], pages[0]
    view = snap(host_ctx, f'/api/games/{game_id}')['view']
    gifts = view['modules']['seafarers']['tribe']['gifts']
    assert len(gifts) == 18 and len(view['board']['terrain']) == 49, (len(gifts), len(view['board']['terrain']))
    for renderer in ('svg', 'r3f'):
        open_game(host, game_id, renderer)
        if renderer == 'svg':
            assert host.locator('[data-testid^="hex-"]').count() == 49
            assert host.locator('[data-gift-kind]').count() == 18
            expect(host.get_by_test_id('pirate-hex')).to_be_visible()
        else:
            host.wait_for_function("() => document.querySelector('canvas')?.dataset.giftMarkers === '18'", timeout=TIMEOUT)
        shot(host, f'map-{count}p-{renderer}-desktop', view['board']['topologyId'], ms=2500 if renderer == 'r3f' else 700)
    if not phone:
        return
    phone_ctx = browser.new_context(storage_state=host_ctx.storage_state(), viewport=PHONE, locale='zh-TW',
                                    reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    page = phone_ctx.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    page.set_default_timeout(TIMEOUT)
    open_game(page, game_id, 'svg')
    assert page.locator('[data-gift-kind]').count() == 18
    shot(page, f'map-{count}p-svg-phone', view['board']['topologyId'])
    phone_ctx.close()


def setup_over_api(contexts, identity, game_id):
    """Every seat takes a different legal spot (the server only offers large-island corners), road first legal."""
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
        if turn['setup']['stage'] == 'building':
            legal = hints['legalSettlements']
            command = {'type': 'setup.placeBuilding', 'vertex': legal[(step * 37) % len(legal)]}
            step += 1
        else:
            command = {'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]}
        response = by_id[actor].request.post(f'{base.BASE}{path}/commands', data={
            'commandId': f'ft-{step}-{len(REPORT["cases"])}-{command["type"]}-{turn["setup"]["stage"]}-{view["seq"]}',
            'expectedRevision': mine['revision'], 'command': command})
        body = response.json()
        # 不只看 HTTP ok：回執必須是 accepted，被拒就失敗，不重送同一個命令 ID。
        assert body['ok'] and body['data']['outcome'] == 'accepted', (command, body)


def finish_live(browser, contexts, pages, identity, game_id):
    p1 = identity[0]
    plan = {}
    path = f'/api/games/{game_id}'

    def prepare(state):
        seat = next(i for i, player in enumerate(state['players']) if player['id'] == p1)
        checked = fixture('check', state=state)
        assert checked['largeOnly'], checked
        plan.update(fixture('plan', p1, state=state), settled=checked['settled'])
        player = state['players'][seat]
        player['resources'] = {'lumber': 6, 'brick': 0, 'wool': 6, 'grain': 0, 'ore': 0}
        # 2 起始村落 + 3 海岸村落 = 5；+6 = 11；移動拿 VP #2（12）、建造拿 VP #1（13）。
        player['bonusPoints'] = 6
        for coast in plan['coasts']:
            state['board']['buildings'][coast['vertex']] = {'player': p1, 'city': False}
        for key in ('portA', 'portB', 'portC', 'devcard', 'vp1'):
            state['board']['roads'][plan[key]['near']] = {'player': p1, 'ship': True}
        for key in ('near', 'anchor'):
            state['board']['roads'][plan['vp2'][key]] = {'player': p1, 'ship': True}
        # 發展牌禮物固定成騎士：分數牌會讓分數不確定。
        for gift in state['moduleState']['seafarers']['tribe']['gifts']:
            if gift['kind'] == 'devcard':
                gift['card'] = 'knight'
        state['turn'].update({'seat': seat, 'phase': 'action', 'dice': [3, 4], 'setup': None})
        state['pending'] = None
        state['windowId'] += 1
    SERVER.patch_game(game_id, prepare)
    for other in pages:
        other.reload()

    def tribe_view():
        return snap(contexts[0], path)['view']

    def build_ship(page, edge):
        legal = snap(contexts[0], path)['view']['hints']['modules']['seafarers']['legalShips']
        assert edge in legal, ('gift edge is not a legal ship edge', edge, legal, plan)
        open_actions(page)
        page.get_by_test_id('action-build.ship').click()
        # 手機上行動面板蓋住棋盤：選好行動後收起，目標才點得到。
        if page.viewport_size['width'] < 600:
            rail = page.get_by_test_id('action-rail-toggle')
            if rail.count() and rail.get_attribute('aria-expanded') == 'true':
                rail.click()
                page.wait_for_timeout(400)
        click_target(page, 'edge', edge)
        ui_confirm(page)

    def place_port(page, key, coast, label, renderer):
        """Build a ship onto the port gift, then place the port at the coastal settlement's edge through the board."""
        port = plan[key]
        before = len(tribe_view()['board']['harbors'])
        build_ship(page, port['gift'])
        view = tribe_view()
        assert view['pending'] and view['pending']['kind'] == 'seafarers.harbor' and view['pending']['responders'] == [p1], view['pending']
        choices = snap(contexts[0], path)['view']['hints']['modules']['seafarers']['harborChoices']
        edge = coast['edges'][0]
        assert choices['harbors'] == [port['harbor']] and edge in choices['edges'], (choices, coast)
        expect(page.get_by_test_id('harbor-choice')).to_be_visible()
        for target in choices['edges']:
            expect(page.get_by_test_id(f'target-edge-{target}')).to_be_attached()
        if label:
            shot(page, label, f'{key} taken in {renderer}: the coast edges are the placement targets', ms=2500 if renderer == 'r3f' else 700)
        click_target(page, 'edge', edge)
        ui_confirm(page)
        view = tribe_view()
        assert view['pending'] is None and len(view['board']['harbors']) == before + 1, view['board']['harbors']
        assert {'edge': edge, 'type': port['harbor']} in view['board']['harbors'], view['board']['harbors']
        return edge

    # --- 3D：建造到港口 A 並放在棋盤上；再「移動」一艘船拿 VP #2 --------------------------
    page = pages[0]
    open_game(page, game_id, 'r3f')
    page.wait_for_function("() => document.querySelector('canvas')?.dataset.giftMarkers === '18'", timeout=TIMEOUT)
    place_port(page, 'portA', plan['coasts'][0], 'live-port-targets-3d', 'r3f')
    page.wait_for_function("() => document.querySelector('canvas')?.dataset.giftMarkers === '17'", timeout=TIMEOUT)
    page.wait_for_timeout(800)
    shot(page, 'live-port-placed-3d', 'port A placed through the 3D board; it works at once', ms=2500)
    open_actions(page)
    page.get_by_test_id('action-ship.move').click()
    click_target(page, 'edge', plan['vp2']['near'], confirm=False)
    click_target(page, 'edge', plan['vp2']['gift'])
    ui_confirm(page)
    view = tribe_view()
    assert view['modules']['seafarers']['tribe']['vp'][p1] == 1, view['modules']['seafarers']['tribe']
    assert view['board']['roads'][plan['vp2']['gift']] is not None
    page.wait_for_function("() => document.querySelector('canvas')?.dataset.giftMarkers === '16'", timeout=TIMEOUT)
    shot(page, 'live-ship-move-gift-3d', 'a ship moved onto a VP token in 3D takes it (gift count 16)', ms=2500)

    # --- 手機：建造到港口 C 並處理港口待辦 ------------------------------------------------
    phone_ctx = browser.new_context(storage_state=contexts[0].storage_state(), viewport=PHONE, locale='zh-TW',
                                    reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    phone = phone_ctx.new_page()
    phone.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    phone.set_default_timeout(TIMEOUT)
    open_game(phone, game_id, 'svg')
    place_port(phone, 'portC', plan['coasts'][2], 'live-port-pending-phone', 'phone svg')
    phone_ctx.close()

    # --- SVG：放港口 B，拿發展牌，再建造拿 VP #1（13 分）---------------------------------
    open_game(page, game_id, 'svg')
    assert page.locator('[data-gift-kind]').count() == 15
    place_port(page, 'portB', plan['coasts'][1], 'live-port-targets-svg', 'svg')
    assert len(tribe_view()['board']['harbors']) == 3
    open_game(page, game_id, 'svg')
    build_ship(page, plan['devcard']['gift'])
    expect(page.locator(f"[data-testid=\"gift-{plan['devcard']['gift']}\"]")).to_have_count(0)
    mine = next(p for p in tribe_view()['players'] if p['id'] == p1)
    assert mine['newDevCards'] == ['knight'] and mine['devCards'] == [], mine
    open_game(page, game_id, 'svg')
    assert tribe_view()['modules']['seafarers']['tribe']['vp'][p1] == 1
    shot(page, 'live-gifts-svg', 'three harbours, the development card and a VP token taken: gifts gone, VP mark on the panel')
    build_ship(page, plan['vp1']['gift'])
    view = tribe_view()
    assert view['result'] and view['result']['playerId'] == p1 and view['result']['reason'] == 'victory', view['result']
    assert view['modules']['seafarers']['tribe']['vp'][p1] == 2
    expect(page.get_by_test_id('result-screen')).to_be_visible()
    expect(page.get_by_test_id('result-winner')).to_be_visible()
    shot(page, 'live-result', 'the second VP token makes 13 VP: result screen')
    REPORT['finish'] = {'plan': plan, 'result': view['result']}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for count in ((4,) if os.environ.get('SF_ONLY_LIVE') else (3, 4)):
            contexts, pages, identity, game_id = start_tribe(browser, count, lobby_shot='lobby-forgotten-tribe' if count == 3 else None)
            view = snap(contexts[0], f'/api/games/{game_id}')['view']
            assert view['board']['topologyId'] == 'sf-forgotten-tribe', view['board']['topologyId']
            assert view['victoryTarget'] == 13 and view['engineVersion'] == 'sf-2025.3'
            assert view['board']['terrain'][view['board']['robber']] == 'desert'
            assert view['board']['terrain'][view['board']['pirate']] == 'sea'
            assert view['board']['harbors'] == []
            if not os.environ.get('SF_ONLY_LIVE'):
                map_shots(browser, contexts, pages, game_id, count, phone=count == 4)
            if count == 4:
                setup_over_api(contexts, identity, game_id)
                host = pages[0]
                open_game(host, game_id, 'svg')
                host.locator('#tool-help').click()
                for key in ('setup', 'discs', 'gifts', 'ports', 'win'):
                    expect(host.get_by_test_id(f'help-tribe-{key}')).to_be_visible()
                shot(host, 'help-tribe-svg-desktop', 'setup done on the large island; help panel shows the Forgotten Tribe rules')
                finish_live(browser, contexts, pages, identity, game_id)
            for context in contexts:
                context.close()
        browser.close()
    REPORT['errors'] = ERRORS
    assert 'sf-new-shores' not in json.dumps(REPORT), 'New Shores data leaked into the report'
    # 只保留精選截圖（約 8–10 張）；其餘刪除並在報告標 committed: false。
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
