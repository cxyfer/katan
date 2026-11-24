#!/usr/bin/env python3
"""The Wonders of Catan (SF25 pp. 18-19) browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 SF_TIMEOUT=180000 python3 scripts/seafarers/capture_wonders_of_catan.py <new-empty-output-dir>

Reuses the New Shores harness (``capture.py``: private-SQLite service, Playwright
helpers, report format) and only adds the Wonders of Catan flow. Real games through
the real UI and API (no mocked snapshots); the service state is checked after every
command the UI sends (a rejected command would leave the wonder state unchanged):

1. Lobby: Seafarers -> The Wonders of Catan, 3-4 players only.
2. Maps: the shared 49-hex map for 3 and 4 players in SVG and 3D during setup
   (9 harbours; 5 Great Wall, 2 Great Bridge and 4 X markers in both renderers: DOM
   markers in SVG, ``data-wonder-markers`` on the 3D canvas; no pirate); phone for 4.
3. Setup finished over the API; ``wonders_fixture.mjs check`` confirms every starting
   settlement is on the large island and off all 11 markers.
4. A live game for player 1 through the UI: while the service is stopped, a test-only
   fixture gives player 1 the turn, a settlement on a Great Wall marker and the resources
   for four levels, and player 2 a started Great Bridge. Through the UI player 1
   - in SVG claims the Great Wall (wonders panel) and builds level 1;
   - in 3D builds level 2;
   - on a phone-sized viewport builds level 3;
   - back on desktop builds level 4: the wonder is complete and the result screen shows
     the wonder ending without any target score (desktop and phone).
   The run FAILS if a count, level or result is wrong.

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
from capture import ERRORS, OUT, PHONE, REPORT, SERVER, TIMEOUT, api, log, new_player, open_actions, open_game, shot, snap

expect.set_options(timeout=TIMEOUT)

REPORT.clear()
REPORT.update({'scenario': 'wonders-of-catan', 'profile': 'sf-wonders-of-catan-2025', 'base': base.BASE, 'cases': []})

NAMES = ['海岸領航員', 'Mira', '阿卡', 'Jonas']
FIXTURE = str(base.ROOT / 'scripts/seafarers/wonders_fixture.mjs')
CURATED = {
    'lobby-wonders-of-catan', 'map-3p-svg-desktop', 'map-4p-svg-desktop', 'map-4p-r3f-desktop', 'map-4p-svg-phone',
    'help-wonders-svg-desktop', 'live-claim-svg', 'live-build-3d', 'live-build-phone', 'live-result-wonder',
    'live-result-wonder-phone',
}
GREAT_WALL_COST = {'brick': 3, 'lumber': 1, 'grain': 1}


def fixture(*args, state):
    out = subprocess.run(['node', '--experimental-strip-types', FIXTURE, *args], input=json.dumps(state), check=True,
                         capture_output=True, text=True, cwd=base.ROOT).stdout
    return json.loads(out)


def start_wonders(browser, count, lobby_shot=None):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.get_by_test_id('scenario-select').select_option('wonders-of-catan')
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    options = host.locator('#room-capacity option').evaluate_all('(items) => items.map((item) => item.value)')
    assert options == ['3', '4'], options
    if lobby_shot:
        shot(host, lobby_shot, 'lobby: Seafarers / The Wonders of Catan, 3-4 players only')
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
    """3 / 4 player maps in SVG and 3D: the same 49 hexes, 9 harbours and 11 markers in both renderers."""
    host_ctx, host = contexts[0], pages[0]
    view = snap(host_ctx, f'/api/games/{game_id}')['view']
    wonders = view['modules']['seafarers']['wonders']
    assert [len(wonders['markers'][k]) for k in ('greatWall', 'greatBridge', 'x')] == [5, 2, 4]
    assert len(view['board']['terrain']) == 49 and len(view['board']['harbors']) == 9
    for renderer in ('svg', 'r3f'):
        open_game(host, game_id, renderer)
        if renderer == 'svg':
            assert host.locator('[data-testid^="hex-"]').count() == 49
            assert host.locator('[data-testid^="harbor-"]').count() == 9
            assert [host.locator(f'[data-wonder-marker="{k}"]').count() for k in ('greatWall', 'greatBridge', 'x')] == [5, 2, 4]
            assert host.locator('[data-testid^="pirate-"]').count() == 0
        else:
            host.wait_for_function("() => document.querySelector('canvas')?.dataset.wonderMarkers === '5,2,4'", timeout=TIMEOUT)
        shot(host, f'map-{count}p-{renderer}-desktop', view['board']['topologyId'], ms=2500 if renderer == 'r3f' else 700)
    if not phone:
        return
    phone_ctx = browser_phone(host_ctx)
    page = phone_ctx.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    page.set_default_timeout(TIMEOUT)
    open_game(page, game_id, 'svg')
    assert page.locator('[data-wonder-marker]').count() == 11
    shot(page, f'map-{count}p-svg-phone', view['board']['topologyId'])
    phone_ctx.close()


def browser_phone(host_context):
    return host_context.browser.new_context(storage_state=host_context.storage_state(), viewport=PHONE, locale='zh-TW',
                                            reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)


def setup_over_api(contexts, identity, game_id):
    """Every seat takes a different legal spot (the server only offers large-island corners off the markers)."""
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
            'commandId': f'woc-{step}-{len(REPORT["cases"])}-{command["type"]}-{setup["stage"]}-{view["seq"]}',
            'expectedRevision': mine['revision'], 'command': command})
        body = response.json()
        assert body['ok'] and body['data']['outcome'] == 'accepted', (command, body)


def finish_live(contexts, pages, identity, game_id):
    p1, p2 = identity[0], identity[1]
    plan = {}
    path = f'/api/games/{game_id}'

    def prepare(state):
        seat = next(i for i, player in enumerate(state['players']) if player['id'] == p1)
        checked = fixture('check', state=state)
        assert checked['largeOnly'] and checked['offMarkers'] and set(checked['perPlayer'].values()) == {2}, checked
        plan.update(fixture('plan', state=state))
        state['board']['buildings'][plan['wall']] = {'player': p1, 'city': False}
        me = next(p for p in state['players'] if p['id'] == p1)
        # 4 層 = 4 倍費用（磚 12、木 4、麥 4）；從銀行拿，供應量守恆。
        for resource, amount in GREAT_WALL_COST.items():
            me['resources'][resource] += amount * 4
            state['bank'][resource] -= amount * 4
        wonders = state['moduleState']['seafarers']['wonders']
        wonders['owned'][p2] = 'greatBridge'
        wonders['levels'][p2] = 1
        state['turn'].update({'seat': seat, 'phase': 'action', 'dice': [3, 4], 'setup': None})
        state['pending'] = None
        state['windowId'] += 1
    SERVER.patch_game(game_id, prepare)
    page = pages[0]
    for other in pages:
        other.reload()

    def wonders_view():
        return snap(contexts[0], path)['view']['modules']['seafarers']['wonders']

    # --- SVG：認領長城、蓋第 1 層 -----------------------------------------------------
    open_game(page, game_id, 'svg')
    open_actions(page)
    assert page.locator('[data-wonder-marker]').count() == 11
    hints = snap(contexts[0], path)['view']['hints']['modules']['seafarers']['wonders']
    assert hints['claimable'] == ['greatWall'], hints
    assert page.get_by_test_id('wonder-claim-greatBridge').count() == 0  # 已被玩家 2 拿走，沒有認領鈕
    expect(page.get_by_test_id('wonder-status-greatBridge')).to_contain_text(NAMES[1])
    page.get_by_test_id('wonder-claim-greatWall').click()
    expect(page.get_by_test_id('wonder-build')).to_be_visible()
    view = wonders_view()
    assert view['owned'][p1] == 'greatWall' and view['levels'][p1] == 0, view
    shot(page, 'live-claim-svg', 'player 1 meets the Great Wall requirement and claims it in SVG (player 2 already holds the Great Bridge)')
    page.get_by_test_id('wonder-build').click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"wonder-card-greatWall\"]')?.dataset.level === '1'", timeout=TIMEOUT)
    view = wonders_view()
    assert view['levels'][p1] == 1, view
    hand = next(p for p in snap(contexts[0], path)['view']['players'] if p['id'] == p1)['resources']
    assert (hand['brick'], hand['lumber']) == (9, 3), hand  # 起始手牌可能另有麥，只檢查磚與木

    # --- 3D：蓋第 2 層 ---------------------------------------------------------------
    open_game(page, game_id, 'r3f')
    page.wait_for_function("() => document.querySelector('canvas')?.dataset.wonderMarkers === '5,2,4'", timeout=TIMEOUT)
    open_actions(page)
    page.get_by_test_id('wonder-build').click()
    page.wait_for_function("() => document.querySelector('[data-testid=\"wonder-card-greatWall\"]')?.dataset.level === '2'", timeout=TIMEOUT)
    assert wonders_view()['levels'][p1] == 2
    expect(page.get_by_test_id('board')).to_have_attribute('data-effective-renderer', 'r3f')
    shot(page, 'live-build-3d', 'level 2 built in 3D: markers stand on their vertices, the panel shows the level', ms=2500)

    # --- 手機 SVG：蓋第 3 層 ---------------------------------------------------------
    phone_ctx = browser_phone(contexts[0])
    phone = phone_ctx.new_page()
    phone.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    phone.set_default_timeout(TIMEOUT)
    open_game(phone, game_id, 'svg')
    open_actions(phone)
    build = phone.get_by_test_id('wonder-build')
    if not build.is_visible():
        # 手機版的行動列在抽屜裡：打開手牌／行動分頁。
        for toggle in ('drawer-tab-hand', 'drawer-toggle', 'mobile-tab-hand'):
            tab = phone.get_by_test_id(toggle)
            if tab.count():
                tab.first.click()
                break
    expect(build).to_be_visible()
    shot(phone, 'live-build-phone', 'the wonders panel on a phone: level 2 of 4, build level 3')
    build.click()
    phone.wait_for_function("() => document.querySelector('[data-testid=\"wonder-card-greatWall\"]')?.dataset.level === '3'", timeout=TIMEOUT)
    assert wonders_view()['levels'][p1] == 3
    phone_ctx.close()

    # --- 桌面 SVG：蓋第 4 層，奇觀完成，遊戲結束 -----------------------------------------
    open_game(page, game_id, 'svg')
    open_actions(page)
    page.get_by_test_id('wonder-build').click()
    expect(page.get_by_test_id('result-screen')).to_be_visible()
    view = snap(contexts[0], path)['view']
    assert view['result'] and view['result']['cause'] == 'wonderComplete' and view['result']['playerIds'] == [p1], view['result']
    assert view['result']['playerId'] == p1 and view['turn']['phase'] == 'gameOver'
    expect(page.get_by_test_id('result-reason')).to_have_attribute('data-cause', 'wonderComplete')
    assert '勝利目標' not in page.get_by_test_id('result-screen').inner_text()
    for index in (1, 2):
        seen = snap(contexts[index], path)['view']['result']
        assert seen['playerIds'] == [p1] and seen['cause'] == 'wonderComplete', (index, seen)
    state_events = [e['type'] for e in snap(contexts[0], path)['view']['events']]
    assert state_events.count('wonder.built') >= 1 and 'game.finished' in state_events, state_events
    shot(page, 'live-result-wonder', 'level 4 completed: the wonder ending, no target score')
    page.set_viewport_size(PHONE)
    expect(page.get_by_test_id('result-reason')).to_be_visible()
    assert page.evaluate('() => document.documentElement.scrollWidth <= window.innerWidth + 1'), 'result screen overflows horizontally on a phone'
    shot(page, 'live-result-wonder-phone', 'the same result in a phone-sized viewport')
    REPORT['finish'] = {'plan': {k: v for k, v in plan.items() if k != 'markers'}, 'result': view['result']}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for count in ((4,) if os.environ.get('SF_ONLY_LIVE') else (3, 4)):
            contexts, pages, identity, game_id = start_wonders(browser, count, lobby_shot='lobby-wonders-of-catan' if count == 3 else None)
            view = snap(contexts[0], f'/api/games/{game_id}')['view']
            assert view['board']['topologyId'] == 'sf-wonders-of-catan', view['board']['topologyId']
            assert view['victoryTarget'] == 10 and view['engineVersion'] == 'sf-2025.3'
            assert view['board']['terrain'][view['board']['robber']] == 'desert'
            assert view['board']['pirate'] is None
            if not os.environ.get('SF_ONLY_LIVE'):
                map_shots(browser, contexts, pages, game_id, count, phone=count == 4)
            if count == 4:
                setup_over_api(contexts, identity, game_id)
                host = pages[0]
                open_game(host, game_id, 'svg')
                host.locator('#tool-help').click()
                for key in ('setup', 'bonus', 'claim', 'build', 'win'):
                    expect(host.get_by_test_id(f'help-wonders-{key}')).to_be_visible()
                shot(host, 'help-wonders-svg-desktop', 'setup done; help panel shows the Wonders of Catan rules')
                finish_live(contexts, pages, identity, game_id)
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
