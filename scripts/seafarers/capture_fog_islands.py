#!/usr/bin/env python3
"""The Fog Islands (SF25 pp. 8-9) browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 SF_TIMEOUT=180000 python3 scripts/seafarers/capture_fog_islands.py <new-empty-output-dir>

Reuses the New Shores harness (``capture.py``: private-SQLite service, Playwright
helpers, report format) and only adds the Fog Islands flow. Real games through
the real UI and API (no mocked snapshots):

1. Lobby: Seafarers -> The Fog Islands, 3-4 players only, required boxes shown.
2. Maps: the 3- and 4-player boards in SVG and 3D during setup: 12 fog clouds
   (``sf-fog-*`` in SVG, canvas ``data-fog-hexes`` in 3D), pirate on the frame.
3. Setup finished over the API; the in-game help panel shows the fog rules.
4. A live game for player 1 through the UI. While the service is stopped, a
   test-only fixture (``fog_islands_fixture.mjs``) gives player 1 the turn, two
   ships' worth of cards and the ship chains leading to (a) a path that touches
   exactly one unexplored space and (b) a path that touches two. Then, through
   the UI: the single-space ship reveals a hex in the SVG renderer (cloud lifts,
   tile drawn, gold is picked in the gold picker if it turns up); the two-space
   ship raises the choice prompt, the placer picks a hex on the 3D board and it
   is revealed there. The run FAILS if a reveal, the choice frame or a fog count
   is missing. Finally a fixture gives player 1 the last points and a free
   spot; a legal settlement reaches 12 VP and the result screen shows
   (no island bonus: the profile has none).

``report.json`` lists every case with its sha256.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

from playwright.sync_api import expect, sync_playwright

import capture as base  # noqa: E402  (module-level setup reads argv[1] and prepares OUT)
from capture import ERRORS, OUT, REPORT, SERVER, api, log, map_shots, new_player, open_game, open_actions, shot, snap, ui_confirm

# capture.py 的 REPORT 預先放了 New Shores 的 fixtures；這份報告只含未知海域資料。
REPORT.clear()
REPORT.update({'scenario': 'fog-islands', 'profile': 'sf-fog-islands-2025', 'base': base.BASE, 'cases': []})

# expect() 預設只等 5 秒；機器忙碌時棋盤目標要更久才掛上，跟著 SF_TIMEOUT。
expect.set_options(timeout=base.TIMEOUT)

NAMES = ['迷霧領航員', 'Mira', '阿卡', 'Jonas']
FIXTURE = base.ROOT / 'scripts/seafarers/fog_islands_fixture.mjs'
browser_ref = {}


def start_fog(browser, count, lobby_shot=None):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.get_by_test_id('scenario-select').select_option('fog-islands')
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    options = host.locator('#room-capacity option').evaluate_all('(items) => items.map((item) => item.value)')
    assert options == ['3', '4'], options
    if lobby_shot:
        shot(host, lobby_shot, 'lobby: Seafarers / The Fog Islands, 3-4 players only')
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
    expect(host.get_by_test_id('board')).to_be_visible()
    identity = [api(context, 'GET', '/api/session')['player']['id'] for context in contexts]
    game_id = api(contexts[0], 'GET', '/api/games')['games'][0]['gameId']
    return contexts, pages, identity, game_id


def setup_over_api(contexts, identity, game_id):
    """Every seat takes a different legal spot (spread over the known islands), road first legal."""
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
            'commandId': f'fog-{step}-{len(REPORT["cases"])}-{command["type"]}-{turn["setup"]["stage"]}-{view["seq"]}',
            'expectedRevision': mine['revision'], 'command': command})
        assert response.json()['ok'], response.json()


def ui_target(page, kind, index):
    """Click a board target; in 3D neighbouring targets can overlap, then the picker list opens and the option is chosen there."""
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached()
    target.click(force=True)
    confirm = page.get_by_test_id('confirm-selection')
    try:
        confirm.wait_for(state='visible', timeout=5000)
    except Exception:
        option = page.get_by_test_id(f'picker-{kind}-{index}')
        if not option.is_visible():
            page.get_by_test_id('open-target-picker').click()
        option.click()
        expect(confirm).to_be_visible()


def fog_count_svg(page):
    return page.locator('[data-testid^="sf-fog-"]').count()


def wait_fog_3d(page, count):
    page.wait_for_function(f"() => document.querySelector('canvas')?.dataset.fogHexes === '{count}'", timeout=60000)


def settle_gold(page):
    """If the reveal was a gold field, pick a resource in the gold picker (UI)."""
    picker = page.get_by_test_id('gold-picker')
    try:
        picker.wait_for(state='visible', timeout=3000)
    except Exception:
        return False
    for resource in base.RESOURCES:
        button = page.get_by_test_id(f'gold-{resource}')
        if button.is_enabled():
            button.click()
            break
    page.get_by_test_id('gold-confirm').click()
    page.wait_for_timeout(600)
    return True


def build_ship_ui(page, game_id, renderer, edge):
    open_game(page, game_id, renderer)
    open_actions(page)
    page.get_by_test_id('action-build.ship').click()
    ui_target(page, 'edge', edge)
    ui_confirm(page)


def live(contexts, pages, identity, game_id):
    p1 = identity[0]
    plan = {}

    def prepare(state):
        seat = next(i for i, player in enumerate(state['players']) if player['id'] == p1)
        out = subprocess.run(['node', '--experimental-strip-types', str(FIXTURE), 'prepare', p1], input=json.dumps(state),
                             check=True, capture_output=True, text=True, cwd=base.ROOT).stdout
        plan.update(json.loads(out))
        if plan['settlement'] is not None:
            state['board']['buildings'][plan['settlement']] = {'player': p1, 'city': False}
        for edge in plan['choice']['prefix'] + plan['choice2']['prefix'] + plan['reveal']['prefix']:
            state['board']['roads'][edge] = {'player': p1, 'ship': True}
        player = state['players'][seat]
        player['resources'] = {'lumber': 3, 'brick': 0, 'wool': 3, 'grain': 0, 'ore': 0}
        state['turn'].update({'seat': seat, 'phase': 'action', 'dice': [3, 4], 'setup': None})
        state['pending'] = None
        state['windowId'] += 1
    SERVER.patch_game(game_id, prepare)
    page = pages[0]
    for other in pages:
        other.reload()
    reveal, choice, choice2 = plan['reveal'], plan['choice'], plan['choice2']
    path = f'/api/games/{game_id}'

    view = snap(contexts[0], path)['view']
    assert len(view['modules']['seafarers']['fog']) == 12 and view['pending'] is None, view['modules']['seafarers']
    assert 'tiles' not in json.dumps(view) and 'discs' not in json.dumps(view), 'deck leaked into the view'

    # 1) 只碰一個空格的船：SVG 渲染器上透過 UI 建造，直接翻開。
    open_game(page, game_id, 'svg')
    open_actions(page)
    page.get_by_test_id('action-build.ship').click()
    hints = snap(contexts[0], path)['view']['hints']['modules']['seafarers']
    log('PLAN', json.dumps(plan), 'legalShips', hints['legalShips'])
    assert reveal['edge'] in hints['legalShips'], (reveal, hints['legalShips'])
    assert fog_count_svg(page) == 12
    shot(page, 'live-fog-before-svg', f"before: 12 clouds; build ship targets include the path {reveal['edge']} that touches one unexplored hex")
    ui_target(page, 'edge', reveal['edge'])
    ui_confirm(page)
    page.wait_for_timeout(800)
    gold = settle_gold(page)
    view = snap(contexts[0], path)['view']
    assert reveal['hex'] not in view['modules']['seafarers']['fog'] and len(view['modules']['seafarers']['fog']) == 11, view['modules']['seafarers']
    tile = view['board']['terrain'][reveal['hex']]
    number = view['board']['numbers'][reveal['hex']]
    assert (tile == 'sea') == (number is None), (tile, number)
    expect(page.locator('[data-testid^="sf-fog-"]')).to_have_count(11)
    shot(page, 'live-fog-reveal-svg', f"ship built through the SVG board revealed hex {reveal['hex']}: {tile} {number}{' (gold picked in the UI)' if gold else ''}; 11 clouds left")

    # 2) 碰兩個空格的船：3D 渲染器建造 -> 選擇 frame -> 在 3D 棋盤上選一個空格。
    open_game(page, game_id, 'r3f')
    wait_fog_3d(page, 11)
    open_actions(page)
    page.get_by_test_id('action-build.ship').click()
    ui_target(page, 'edge', choice['edge'])
    ui_confirm(page)
    page.wait_for_timeout(800)
    view = snap(contexts[0], path)['view']
    assert view['pending'] and view['pending']['kind'] == 'seafarers.fog', view['pending']
    assert sorted(view['pending']['data']['hexes']) == sorted(choice['hexes']), (view['pending'], choice)
    assert len(view['modules']['seafarers']['fog']) == 11
    for hex_index in choice['hexes']:
        expect(page.get_by_test_id(f'target-hex-{hex_index}')).to_be_attached()
    shot(page, 'live-fog-choice-3d', f"the ship touches two unexplored hexes {choice['hexes']}: the placer chooses one on the 3D board", ms=2500)
    pick = choice['hexes'][1]
    ui_target(page, 'hex', pick)
    ui_confirm(page)
    page.wait_for_timeout(800)
    gold = settle_gold(page)
    view = snap(contexts[0], path)['view']
    assert view['pending'] is None and pick not in view['modules']['seafarers']['fog'] and len(view['modules']['seafarers']['fog']) == 10
    assert choice['hexes'][0] in view['modules']['seafarers']['fog']
    tile = view['board']['terrain'][pick]
    wait_fog_3d(page, 10)
    shot(page, 'live-fog-reveal-3d', f"the chosen hex {pick} is revealed in 3D: {tile}{' (gold picked in the UI)' if gold else ''}; 10 fog banks left", ms=2500)

    # 3) 第二個多空格選擇：SVG 渲染器上建造、在 SVG 棋盤上選（預覽顯示「未探索」）。
    open_game(page, game_id, 'svg')
    open_actions(page)
    page.get_by_test_id('action-build.ship').click()
    ui_target(page, 'edge', choice2['edge'])
    ui_confirm(page)
    page.wait_for_timeout(800)
    view = snap(contexts[0], path)['view']
    assert view['pending'] and view['pending']['kind'] == 'seafarers.fog', view['pending']
    assert sorted(view['pending']['data']['hexes']) == sorted(choice2['hexes']), (view['pending'], choice2)
    assert len(view['modules']['seafarers']['fog']) == 10
    for hex_index in choice2['hexes']:
        expect(page.get_by_test_id(f'target-hex-{hex_index}')).to_be_attached()
    pick2 = choice2['hexes'][0]
    ui_target(page, 'hex', pick2)
    expect(page.get_by_test_id('selection-preview')).to_contain_text('未探索')
    shot(page, 'live-fog-choice-svg', f"SVG choice between {choice2['hexes']}: picked hex {pick2}, the confirm preview says unexplored")
    ui_confirm(page)
    page.wait_for_timeout(800)
    gold2 = settle_gold(page)
    view = snap(contexts[0], path)['view']
    assert view['pending'] is None and pick2 not in view['modules']['seafarers']['fog'] and len(view['modules']['seafarers']['fog']) == 9
    expect(page.locator('[data-testid^="sf-fog-"]')).to_have_count(9)
    shot(page, 'live-fog-reveal-choice-svg', f"the chosen hex {pick2} is revealed on the SVG board: {view['board']['terrain'][pick2]}{' (gold picked in the UI)' if gold2 else ''}; 9 clouds left")

    # 手機寬度：迷霧與翻開後的格。
    phone_ctx = browser_ref['browser'].new_context(storage_state=contexts[0].storage_state(), viewport=base.PHONE, locale='zh-TW',
                                                   reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    phone = phone_ctx.new_page()
    phone.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    phone.set_default_timeout(base.TIMEOUT)
    open_game(phone, game_id, 'svg')
    assert fog_count_svg(phone) == 9
    shot(phone, 'live-fog-phone', 'phone width: 9 clouds left, three hexes revealed')
    phone_ctx.close()

    # 3) 收尾：給最後的分數與一個空位，合法的蓋村落命令達 12 分（沒有島嶼獎勵）。
    finish = {}

    def finish_state(state):
        out = subprocess.run(['node', '--experimental-strip-types', str(FIXTURE), 'finish', p1], input=json.dumps(state),
                             check=True, capture_output=True, text=True, cwd=base.ROOT).stdout
        finish.update(json.loads(out))
        seat = next(i for i, player in enumerate(state['players']) if player['id'] == p1)
        state['board']['roads'][finish['edge']] = {'player': p1, 'ship': False}
        owned = sum(1 for b in state['board']['buildings'] if b and b['player'] == p1 and not b['city']) \
            + 2 * sum(1 for b in state['board']['buildings'] if b and b['player'] == p1 and b['city'])
        player = state['players'][seat]
        player['resources'] = {'lumber': 1, 'brick': 1, 'wool': 1, 'grain': 1, 'ore': 0}
        player['bonusPoints'] = 12 - owned - 1
        state['turn'].update({'seat': seat, 'phase': 'action', 'dice': [3, 4], 'setup': None})
        state['pending'] = None
        state['windowId'] += 1
    SERVER.patch_game(game_id, finish_state)
    for other in pages:
        other.reload()
    view = snap(contexts[0], path)['view']
    assert view['result'] is None
    open_game(page, game_id, 'svg')
    open_actions(page)
    page.get_by_test_id('action-build.settlement').click()
    ui_target(page, 'vertex', finish['vertex'])
    ui_confirm(page)
    view = snap(contexts[0], path)['view']
    assert view['result'] and view['result']['playerId'] == p1 and view['result']['reason'] == 'victory', view['result']
    assert view['modules']['seafarers']['islandBonus'][p1] == [], 'fog islands has no island bonus'
    expect(page.get_by_test_id('result-screen')).to_be_visible()
    expect(page.get_by_test_id('result-winner')).to_be_visible()
    shot(page, 'live-result', 'a legal settlement reaches 12 VP (no island bonus): result screen')
    REPORT['live'] = {'reveal': reveal, 'choice': choice, 'finish': finish, 'result': view['result']}


def run():
    with sync_playwright() as p:
        browser = browser_ref['browser'] = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for count in ((4,) if os.environ.get('SF_ONLY_4') else (3, 4)):
            contexts, pages, identity, game_id = start_fog(browser, count, lobby_shot='lobby-fog-islands' if count == 3 else None)
            view = snap(contexts[0], f'/api/games/{game_id}')['view']
            assert view['board']['topologyId'] == f'sf-fog-islands-{count}', view['board']['topologyId']
            assert view['victoryTarget'] == 12 and view['engineVersion'] == 'sf-2025.3'
            assert view['board']['pirate'] is None
            assert len(view['modules']['seafarers']['fog']) == 12
            map_shots(browser, contexts, pages, game_id, count, phone=False)
            host = pages[0]
            open_game(host, game_id, 'svg')
            assert fog_count_svg(host) == 12, fog_count_svg(host)
            open_game(host, game_id, 'r3f')
            wait_fog_3d(host, 12)
            if count == 4:
                setup_over_api(contexts, identity, game_id)
                open_game(host, game_id, 'svg')
                host.locator('#tool-help').click()
                expect(host.get_by_test_id('help-fog-islands-explore')).to_be_visible()
                expect(host.get_by_test_id('help-fog-islands-win')).to_be_visible()
                shot(host, 'help-fog-islands-svg-desktop', 'setup done; help panel shows the Fog Islands rules')
                try:
                    live(contexts, pages, identity, game_id)
                except Exception:
                    import traceback
                    traceback.print_exc()
                    try:
                        pages[0].screenshot(path=str(OUT / 'failure.png'), timeout=10000)
                    except Exception:
                        pass
                    raise
            for context in contexts:
                context.close()
        browser.close()
    REPORT['errors'] = ERRORS
    assert 'sf-new-shores' not in json.dumps(REPORT), 'New Shores data leaked into the report'
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
