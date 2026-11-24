#!/usr/bin/env python3
"""Cloth for Catan (SF25 pp. 14-15) browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 SF_TIMEOUT=180000 python3 scripts/seafarers/capture_cloth_for_catan.py <new-empty-output-dir>

Reuses the New Shores harness (``capture.py``: private-SQLite service, Playwright
helpers, report format) and only adds the Cloth for Catan flow. Real games through
the real UI and API (no mocked snapshots); every command receipt must be accepted:

1. Lobby: Seafarers -> Cloth for Catan, 3-4 players only.
2. Maps: the shared 42-hex map for 3 and 4 players in SVG and 3D during setup
   (9 harbours, 8 tribe discs with 5 cloth each in both renderers: DOM markers
   in SVG, ``data-tribe-markers`` / ``data-tribe-cloth`` on the 3D canvas); phone for 4.
3. Setup finished over the API: every seat places THREE settlements (the third
   round is checked through ``turn.setup.third``); ``cloth_fixture.mjs check``
   confirms nothing touches a small island.
4. A live game for player 1 through the UI: while the service is stopped, a test-only
   fixture gives player 1 the turn, ships for builds and two coastal settlements
   each one ship away from a tribe, and player 2 a ship and 2 cloth beside a sea hex.
   Through the UI player 1
   - in SVG builds a ship to the first tribe (trade opens: +1 cloth, tribe 5 -> 4,
     player mark and link dot);
   - in 3D builds a ship to the second tribe (canvas cloth stacks change);
   - with the pirate to move (test-only pending frame), moves it onto player 2's sea
     hex in 3D and chooses "steal cloth" in the prompt;
   - after a second fixture (5 tribes emptied, players 1 and 3 tied on score and cloth)
     ends the turn: the cloth runs out, the result screen shows the SHARED victory
     without any target score (desktop and phone).
   The run FAILS if a count, link or result is wrong.

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

# capture.py 的 REPORT 預先放了 New Shores 的 fixtures；這份報告只含布匹產地資料。
REPORT.clear()
REPORT.update({'scenario': 'cloth-for-catan', 'profile': 'sf-cloth-for-catan-2025', 'base': base.BASE, 'cases': []})

NAMES = ['海岸領航員', 'Mira', '阿卡', 'Jonas']
FIXTURE = str(base.ROOT / 'scripts/seafarers/cloth_fixture.mjs')
CURATED = {
    'lobby-cloth-for-catan', 'map-3p-svg-desktop', 'map-4p-svg-desktop', 'map-4p-r3f-desktop', 'map-4p-svg-phone',
    'help-cloth-svg-desktop', 'live-trade-svg', 'live-trade-3d', 'live-steal-3d', 'live-result-shared',
    'live-result-shared-phone', 'live-steal-svg-phone',
}


def click_target(page, kind, index, confirm=True):
    """Click a board target; close targets may open the ambiguity list (target picker): choose there."""
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached(timeout=TIMEOUT)
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


def start_cloth(browser, count, lobby_shot=None):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.get_by_test_id('scenario-select').select_option('cloth-for-catan')
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    options = host.locator('#room-capacity option').evaluate_all('(items) => items.map((item) => item.value)')
    assert options == ['3', '4'], options
    if lobby_shot:
        shot(host, lobby_shot, 'lobby: Seafarers / Cloth for Catan, 3-4 players only')
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
    """3 / 4 player maps in SVG and 3D: the same 42 hexes, 9 harbours and 8 tribes in both renderers."""
    host_ctx, host = contexts[0], pages[0]
    view = snap(host_ctx, f'/api/games/{game_id}')['view']
    cloth = view['modules']['seafarers']['cloth']
    assert len(cloth['tribes']) == 8 and len(view['board']['terrain']) == 42 and len(view['board']['harbors']) == 9, (len(cloth['tribes']), len(view['board']['terrain']))
    assert [tribe['cloth'] for tribe in cloth['tribes']] == [5] * 8 and cloth['supply'] == 10
    for renderer in ('svg', 'r3f'):
        open_game(host, game_id, renderer)
        if renderer == 'svg':
            assert host.locator('[data-testid^="hex-"]').count() == 42
            assert host.locator('[data-testid^="harbor-"]').count() == 9
            assert host.locator('[data-tribe-number]').count() == 8
            expect(host.get_by_test_id('players-cloth-0')).to_be_attached()
        else:
            host.wait_for_function("() => document.querySelector('canvas')?.dataset.tribeMarkers === '8'", timeout=TIMEOUT)
            host.wait_for_function("() => document.querySelector('canvas')?.dataset.tribeCloth === '5,5,5,5,5,5,5,5'", timeout=TIMEOUT)
        shot(host, f'map-{count}p-{renderer}-desktop', view['board']['topologyId'], ms=2500 if renderer == 'r3f' else 700)
    if not phone:
        return
    phone_ctx = browser.new_context(storage_state=host_ctx.storage_state(), viewport=PHONE, locale='zh-TW',
                                    reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    page = phone_ctx.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    page.set_default_timeout(TIMEOUT)
    open_game(page, game_id, 'svg')
    assert page.locator('[data-tribe-number]').count() == 8
    shot(page, f'map-{count}p-svg-phone', view['board']['topologyId'])
    phone_ctx.close()


def setup_over_api(contexts, identity, game_id, count):
    """Every seat takes a different legal spot (the server only offers large-island corners), road first legal.
    Three rounds: the third one carries ``turn.setup.third``."""
    by_id = dict(zip(identity, contexts))
    path = f'/api/games/{game_id}'
    step = 0
    third_seen = 0
    while True:
        view = snap(contexts[0], path)['view']
        turn = view['turn']
        if turn['phase'] != 'setup':
            assert third_seen == count, ('third-round placements', third_seen)
            return view
        actor = turn['playerId']
        mine = snap(by_id[actor], path)
        hints = mine['view']['hints']
        setup = turn['setup']
        if setup['stage'] == 'building':
            legal = hints['legalSettlements']
            if setup.get('third'):
                third_seen += 1
            command = {'type': 'setup.placeBuilding', 'vertex': legal[(step * 37) % len(legal)]}
            step += 1
        else:
            command = {'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]}
        response = by_id[actor].request.post(f'{base.BASE}{path}/commands', data={
            'commandId': f'cfc-{step}-{len(REPORT["cases"])}-{command["type"]}-{setup["stage"]}-{view["seq"]}',
            'expectedRevision': mine['revision'], 'command': command})
        body = response.json()
        # 不只看 HTTP ok：回執必須是 accepted，被拒就失敗，不重送同一個命令 ID。
        assert body['ok'] and body['data']['outcome'] == 'accepted', (command, body)


def score_of(state, pid):
    """The score formula for a test-only tie (no cities or awards in this fixture)."""
    player = next(p for p in state['players'] if p['id'] == pid)
    total = sum(2 if b['city'] else 1 for b in state['board']['buildings'] if b and b['player'] == pid)
    total += player['bonusPoints'] + player['hiddenBonusPoints']
    total += sum(1 for card in player['devCards'] + player['newDevCards'] if card == 'victoryPoint')
    total += state['moduleState']['seafarers']['cloth']['cloth'][pid] // 2
    for award in ('longestRoad', 'largestArmy'):
        if state['awards'][award] == pid:
            total += 2
    return total


def browser_phone(host_context):
    return host_context.browser.new_context(storage_state=host_context.storage_state(), viewport=PHONE, locale='zh-TW',
                                            reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)


def finish_live(contexts, pages, identity, game_id):
    p1, p2, p3 = identity[0], identity[1], identity[2]
    plan = {}
    path = f'/api/games/{game_id}'

    def prepare(state):
        seat = next(i for i, player in enumerate(state['players']) if player['id'] == p1)
        checked = fixture('check', state=state)
        assert checked['largeOnly'] and set(checked['perPlayer'].values()) == {3}, checked
        plan.update(fixture('plan', p1, p2, state=state), settled=checked['settled'])
        state['players'][seat]['resources'] = {'lumber': 4, 'brick': 0, 'wool': 4, 'grain': 0, 'ore': 0}
        for route in plan['routes']:
            state['board']['buildings'][route['start']] = {'player': p1, 'city': False}
        # 玩家 2：海盜將去的海格旁有一艘船、2 枚布匹（從供應堆拿，總數仍是 50）、2 張牌。
        state['board']['roads'][plan['pirate']['edge']] = {'player': p2, 'ship': True}
        state['board']['roads'][plan['pirate2']['edge']] = {'player': p2, 'ship': True}
        cloth = state['moduleState']['seafarers']['cloth']
        cloth['cloth'][p2] = 2
        cloth['supply'] -= 2
        other = next(p for p in state['players'] if p['id'] == p2)
        other['resources'] = {'lumber': 0, 'brick': 0, 'wool': 0, 'grain': 2, 'ore': 0}
        state['bank']['grain'] -= 2
        state['turn'].update({'seat': seat, 'phase': 'action', 'dice': [3, 4], 'setup': None})
        state['pending'] = None
        state['windowId'] += 1
    SERVER.patch_game(game_id, prepare)
    first, second, pirate, pirate2 = plan['routes'][0], plan['routes'][1], plan['pirate'], plan['pirate2']
    page = pages[0]
    for other in pages:
        other.reload()

    def cloth_view():
        return snap(contexts[0], path)['view']['modules']['seafarers']['cloth']

    def build_ship(edge):
        open_actions(page)
        page.get_by_test_id('action-build.ship').click()
        legal = snap(contexts[0], path)['view']['hints']['modules']['seafarers']['legalShips']
        assert edge in legal, ('route edge is not a legal ship edge', edge, legal, plan)
        click_target(page, 'edge', edge)
        ui_confirm(page)

    # --- SVG：第一艘船碰到部落，建立貿易、拿 1 枚布匹 ------------------------------
    open_game(page, game_id, 'svg')
    assert page.locator('[data-tribe-number]').count() == 8
    build_ship(first['edge'])
    view = cloth_view()
    assert view['links'][p1] == [first['tribe']] and view['cloth'][p1] == 1 and view['tribes'][first['tribe']]['cloth'] == 4, view
    tribe_node = page.locator(f"[data-testid=\"tribe-{first['tribe']}\"]")
    expect(tribe_node).to_have_attribute('data-tribe-cloth', '4')
    expect(tribe_node).to_have_attribute('data-tribe-linked', NAMES[0])
    expect(page.get_by_test_id('players-cloth-0')).to_have_attribute('aria-label', '1 枚布匹 = 0 分: 1')
    assert sum(view['cloth'].values()) + sum(t['cloth'] for t in view['tribes']) + view['supply'] == 50, view
    shot(page, 'live-trade-svg', 'first ship reaches a tribe in SVG: trade opens, +1 cloth, the tribe shows 4 and the player link')

    # --- 3D：第二艘船碰到另一個部落 ----------------------------------------------
    open_game(page, game_id, 'r3f')
    page.wait_for_function("() => document.querySelector('canvas')?.dataset.tribeMarkers === '8'", timeout=TIMEOUT)
    build_ship(second['edge'])
    view = cloth_view()
    assert view['links'][p1] == [first['tribe'], second['tribe']] and view['cloth'][p1] == 2, view
    expected = ','.join(str(t['cloth']) for t in view['tribes'])
    page.wait_for_function("(expected) => document.querySelector('canvas')?.dataset.tribeCloth === expected", arg=expected, timeout=TIMEOUT)
    expect(page.get_by_test_id('board')).to_have_attribute('data-effective-renderer', 'r3f')
    expect(page.get_by_test_id('players-cloth-0')).to_have_attribute('aria-label', '2 枚布匹 = 1 分: 2')
    shot(page, 'live-trade-3d', 'second ship reaches another tribe in 3D: the cloth stacks change, 2 cloth = 1 VP', ms=2500)

    # --- 3D：海盜（test-only：留一個待移動海盜的 pending），搬到玩家 2 的船旁並偷布匹 ---------
    def give_pirate(state):
        seat = next(i for i, player in enumerate(state['players']) if player['id'] == p1)
        state['turn'].update({'seat': seat, 'phase': 'action'})
        state['pending'] = {'kind': 'moveRobber', 'actor': p1, 'cause': 'seven', 'pirate': False}
    SERVER.patch_game(game_id, give_pirate)
    open_game(page, game_id, 'r3f')
    hints = snap(contexts[0], path)['view']['hints']['modules']['seafarers']
    assert pirate['hex'] in hints['pirateTargets'], (pirate, hints['pirateTargets'])
    click_target(page, 'hex', pirate['hex'])
    ui_confirm(page)
    prompt = snap(contexts[0], path)['view']
    # 公開的 steal frame 不帶 pirate 旗標；改由提示的 clothVictims 判斷這是海盜的偷取。
    assert prompt['pending']['kind'] == 'steal' and prompt['pending']['candidates'] == [p2], prompt['pending']
    assert prompt['hints']['modules']['seafarers']['clothVictims'] == [p2], prompt['hints']['modules']['seafarers']
    expect(page.get_by_test_id(f'steal-cloth-{p2}')).to_be_visible()
    expect(page.get_by_test_id(f'steal-{p2}')).to_be_visible()
    shot(page, 'live-steal-3d', 'the pirate moved beside player 2 in 3D: steal a card or a cloth token', ms=2500)
    page.get_by_test_id(f'steal-cloth-{p2}').click()
    page.wait_for_timeout(800)
    view = cloth_view()
    assert view['cloth'][p1] == 3 and view['cloth'][p2] == 1, view['cloth']
    assert snap(contexts[0], path)['view']['pending'] is None

    # --- 手機 SVG：海盜再移動一次（test-only pending），在手機視窗用觸控頁面送出移動與偷牌 ---------
    SERVER.patch_game(game_id, give_pirate)
    phone_ctx = browser_phone(contexts[0])
    phone = phone_ctx.new_page()
    phone.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    phone.set_default_timeout(TIMEOUT)
    open_game(phone, game_id, 'svg')
    hints = snap(contexts[0], path)['view']['hints']['modules']['seafarers']
    assert pirate2['hex'] in hints['pirateTargets'], (pirate2, hints['pirateTargets'])
    grain_before = next(p for p in snap(contexts[0], path)['view']['players'] if p['id'] == p1)['resources']['grain']
    click_target(phone, 'hex', pirate2['hex'])
    ui_confirm(phone)
    assert snap(contexts[0], path)['view']['board']['pirate'] == pirate2['hex']
    expect(phone.get_by_test_id(f'steal-cloth-{p2}')).to_be_visible()
    shot(phone, 'live-steal-svg-phone', 'the pirate moved on a phone in SVG: steal a card or a cloth token')
    phone.get_by_test_id(f'steal-{p2}').click()
    phone.wait_for_timeout(800)
    after = snap(contexts[0], path)['view']
    assert after['pending'] is None, after['pending']
    grain_after = next(p for p in after['players'] if p['id'] == p1)['resources']['grain']
    assert grain_after == grain_before + 1, (grain_before, grain_after)  # 玩家 2 只有穀物，偷牌必是 1 張穀物
    phone_ctx.close()

    # --- 布匹耗盡：5 個部落沒有布匹，玩家 1 與 3 的分數與布匹數相同，回合結束 → 共同勝利 ------------
    def exhaust(state):
        cloth = state['moduleState']['seafarers']['cloth']
        for tribe in cloth['tribes'][:5]:
            cloth['supply'] += tribe['cloth']
            tribe['cloth'] = 0
        delta = cloth['cloth'][p1] - cloth['cloth'][p3]
        cloth['cloth'][p3] += delta
        cloth['supply'] -= delta
        assert cloth['supply'] >= 0
        low, high = sorted((p1, p3), key=lambda pid: score_of(state, pid))
        next(p for p in state['players'] if p['id'] == low)['bonusPoints'] += score_of(state, high) - score_of(state, low)
        assert score_of(state, p1) == score_of(state, p3)
        assert all(score_of(state, p1) > score_of(state, other) for other in (p2, identity[3]))
    SERVER.patch_game(game_id, exhaust)
    open_game(page, game_id, 'svg')
    expect(page.get_by_test_id('cloth-status')).to_have_attribute('data-empty-tribes', '5')
    expect(page.get_by_test_id('prompt-end-turn')).to_be_visible()
    page.get_by_test_id('prompt-end-turn').click()
    expect(page.get_by_test_id('result-screen')).to_be_visible()
    view = snap(contexts[0], path)['view']
    assert view['result'] and view['result']['cause'] == 'clothExhausted' and view['result']['playerIds'] == [p1, p3], view['result']
    assert view['result']['playerId'] == p1 and view['turn']['phase'] == 'gameOver'
    winners = page.get_by_test_id('result-winners')
    expect(winners).to_be_visible()
    assert NAMES[0] in winners.inner_text() and NAMES[2] in winners.inner_text(), winners.inner_text()
    expect(page.get_by_test_id('result-reason')).to_have_attribute('data-cause', 'clothExhausted')
    assert '勝利目標' not in page.get_by_test_id('result-screen').inner_text()
    # 另一位勝者（玩家 3）與沒贏的玩家 2 從各自的連線讀到同一個結果（權威視圖一致）。
    for index in (1, 2):
        seen = snap(contexts[index], path)['view']['result']
        assert seen['playerIds'] == [p1, p3] and seen['cause'] == 'clothExhausted', (index, seen)
    shot(page, 'live-result-shared', 'the turn ends with 5 empty tribes: shared victory, no target score')
    # 手機版面：結束的對局不在「繼續對局」清單裡，所以直接把同一個頁面縮成手機視窗再截圖。
    page.set_viewport_size(PHONE)
    expect(page.get_by_test_id('result-winners')).to_be_visible()
    assert page.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), 'result screen overflows horizontally on a phone'
    shot(page, 'live-result-shared-phone', 'the same shared result in a phone-sized viewport')
    REPORT['finish'] = {'plan': plan, 'result': view['result']}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for count in ((4,) if os.environ.get('SF_ONLY_LIVE') else (3, 4)):
            contexts, pages, identity, game_id = start_cloth(browser, count, lobby_shot='lobby-cloth-for-catan' if count == 3 else None)
            view = snap(contexts[0], f'/api/games/{game_id}')['view']
            assert view['board']['topologyId'] == 'sf-cloth-for-catan', view['board']['topologyId']
            assert view['victoryTarget'] == 14 and view['engineVersion'] == 'sf-2025.3'
            assert view['board']['terrain'][view['board']['robber']] == 'fields' and view['board']['numbers'][view['board']['robber']] == 12
            assert view['board']['pirate'] is None
            assert view['turn']['setup']['remaining'] == count * 3
            if not os.environ.get('SF_ONLY_LIVE'):
                map_shots(browser, contexts, pages, game_id, count, phone=count == 4)
            if count == 4:
                setup_over_api(contexts, identity, game_id, count)
                host = pages[0]
                open_game(host, game_id, 'svg')
                host.locator('#tool-help').click()
                for key in ('setup', 'trade', 'produce', 'score', 'ships', 'pirate', 'win'):
                    expect(host.get_by_test_id(f'help-cloth-{key}')).to_be_visible()
                shot(host, 'help-cloth-svg-desktop', 'setup done with three settlements each; help panel shows the Cloth for Catan rules')
                finish_live(contexts, pages, identity, game_id)
            for context in contexts:
                context.close()
        browser.close()
    REPORT['errors'] = ERRORS
    assert 'sf-new-shores' not in json.dumps(REPORT), 'New Shores data leaked into the report'
    # 只保留精選截圖；其餘刪除並在報告標 committed: false。
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
