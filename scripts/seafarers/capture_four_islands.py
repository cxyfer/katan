#!/usr/bin/env python3
"""The Four Islands (SF25 pp. 6-7) browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 python3 scripts/seafarers/capture_four_islands.py <new-empty-output-dir>

Reuses the New Shores harness (``capture.py``: private-SQLite service, Playwright
helpers, report format) and only adds the Four Islands flow. Real games through
the real UI and API (no mocked snapshots):

1. Lobby: Seafarers -> The Four Islands, 3-4 players only, required boxes shown.
2. Maps: the 3- and 4-player boards in SVG and 3D, desktop and phone, during
   setup (no main island, harbors facing the frame, pirate on the frame).
3. Setup finished over the API with the starting settlements spread over the
   islands; the typed view records each player's home islands; SVG capture and
   the in-game help panel showing the Four Islands special rules.
4. A live finish for player 1 through the UI: while the service is stopped, a
   test-only fixture gives player 1 the turn, two sets of building cards,
   5 other bonus points and a road to an empty spot on each of two non-home
   islands (`four_islands_fixture.mjs`). Then, through the UI, player 1 settles
   the first new island (+2 island bonus: token in SVG and 3D, island list in
   the player panel), and the second one (+2 again), which reaches 13 VP and
   shows the result screen. The run FAILS if a token or the result screen is
   missing.

``report.json`` lists every case with its sha256.
"""
from __future__ import annotations

import json
import subprocess
import sys

from playwright.sync_api import expect, sync_playwright

import capture as base  # noqa: E402  (module-level setup reads argv[1] and prepares OUT)
from capture import ERRORS, OUT, REPORT, SERVER, api, log, map_shots, new_player, open_game, open_actions, shot, snap, ui_click_target, ui_confirm

# capture.py 的 REPORT 預先放了 New Shores 的 fixtures；這份報告只含四島資料。
REPORT.clear()
REPORT.update({'scenario': 'four-islands', 'profile': 'sf-four-islands-2025', 'base': base.BASE, 'cases': []})

NAMES = ['海岸領航員', 'Mira', '阿卡', 'Jonas']


def start_four_islands(browser, count, lobby_shot=None):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.get_by_test_id('scenario-select').select_option('four-islands')
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    options = host.locator('#room-capacity option').evaluate_all('(items) => items.map((item) => item.value)')
    assert options == ['3', '4'], options
    if lobby_shot:
        shot(host, lobby_shot, 'lobby: Seafarers / The Four Islands, 3-4 players only')
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


def setup_over_api(contexts, identity, game_id):
    """Every seat takes a different legal spot (spread over the islands), road first legal."""
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
            'commandId': f'fi-{step}-{len(REPORT["cases"])}-{command["type"]}-{turn["setup"]["stage"]}-{view["seq"]}',
            'expectedRevision': mine['revision'], 'command': command})
        assert response.json()['ok'], response.json()


browser_ref = {}


def finish_live(contexts, pages, identity, game_id):
    """Player 1 settles two new islands through the UI: +2 each, the second reaches 13 VP."""
    p1 = identity[0]
    plan = {}

    def prepare(state):
        seat = next(i for i, player in enumerate(state['players']) if player['id'] == p1)
        out = subprocess.run(['node', '--experimental-strip-types', str(base.ROOT / 'scripts/seafarers/four_islands_fixture.mjs'), p1],
                             input=json.dumps(state), check=True, capture_output=True, text=True, cwd=base.ROOT).stdout
        plan.update(json.loads(out))
        player = state['players'][seat]
        player['resources'] = {'lumber': 2, 'brick': 2, 'wool': 2, 'grain': 2, 'ore': 0}
        player['bonusPoints'] = 5  # 2 起始村落 + 5 = 7；+3 = 10；再 +3 = 13
        for target in plan['targets']:
            state['board']['roads'][target['edge']] = {'player': p1, 'ship': False}
        state['turn'].update({'seat': seat, 'phase': 'action', 'dice': [3, 4], 'setup': None})
        state['pending'] = None
        state['windowId'] += 1
    SERVER.patch_game(game_id, prepare)
    first, second = plan['targets']
    page = pages[0]
    for other in pages:
        other.reload()

    def settle(target, renderer):
        open_game(page, game_id, renderer)
        open_actions(page)
        page.get_by_test_id('action-build.settlement').click()
        ui_click_target(page, 'vertex', target['vertex'])
        ui_confirm(page)

    def expand_players(page_):
        """Open the player panel and pin it (a hover preview closes when the pointer leaves)."""
        toggle = page_.get_by_test_id('players-toggle')
        # 指標移到按鈕上就會開出預覽；先 hover 再看狀態，避免接著的點擊把預覽收掉。
        toggle.hover()
        page_.wait_for_timeout(600)
        if toggle.get_attribute('aria-expanded') != 'true':
            toggle.click()
        pin = page_.get_by_test_id('players-pin')
        expect(pin).to_be_visible()
        if pin.get_attribute('aria-pressed') != 'true':
            pin.click()
        page_.wait_for_timeout(500)
        assert toggle.get_attribute('aria-expanded') == 'true'

    def check_islands_mark(page_, island):
        """The island list is visible text (touch has no title), the wording has no 'small'."""
        mark = page_.get_by_test_id('players-islands-0')
        expect(mark).to_be_visible()
        assert f'島 {island}' in mark.inner_text(), mark.inner_text()
        label = mark.get_attribute('aria-label')
        assert '新島嶼' in label and '小島' not in label, label

    # 第一座新島：SVG 渲染器上建村，展開玩家面板看島號。
    settle(first, 'svg')
    view = snap(contexts[0], f'/api/games/{game_id}')['view']
    assert view['modules']['seafarers']['islandBonus'][p1] == [first['island']], view['modules']['seafarers']
    assert view['result'] is None
    expect(page.get_by_test_id(f"island-bonus-{first['vertex']}")).to_be_attached()
    expand_players(page)
    check_islands_mark(page, first['island'])
    shot(page, 'live-island-bonus-svg', f"first settlement on non-home island {first['island']}: +2 token and the expanded player panel lists the island")

    # 同一狀態的 3D：場景實際畫出的標記數由 canvas 的 data-island-tokens 斷言。
    open_game(page, game_id, 'r3f')
    page.wait_for_function("() => document.querySelector('canvas')?.dataset.islandTokens === '1'", timeout=60000)
    shot(page, 'live-island-bonus-3d', 'the same bonus in the 3D board (canvas data-island-tokens = 1)', ms=2500)

    # 手機寬度：展開玩家面板，島號以可見文字呈現。
    phone_ctx = browser_ref['browser'].new_context(storage_state=contexts[0].storage_state(), viewport=base.PHONE, locale='zh-TW',
                                                   reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    phone = phone_ctx.new_page()
    phone.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    phone.set_default_timeout(base.TIMEOUT)
    open_game(phone, game_id, 'svg')
    expand_players(phone)
    check_islands_mark(phone, first['island'])
    shot(phone, 'live-island-bonus-phone', 'phone width: expanded player panel with the island number as visible text')
    phone_ctx.close()

    # 第二座新島：在 3D 渲染器上透過 UI 完成（每個命令兩個渲染器都 reachable），達 13 分。
    settle(second, 'r3f')
    view = snap(contexts[0], f'/api/games/{game_id}')['view']
    assert view['result'] and view['result']['playerId'] == p1 and view['result']['reason'] == 'victory', view['result']
    assert view['modules']['seafarers']['islandBonus'][p1] == sorted([first['island'], second['island']])
    expect(page.get_by_test_id('result-screen')).to_be_visible()
    expect(page.get_by_test_id('result-winner')).to_be_visible()
    shot(page, 'live-result', 'second new island, settled in the 3D renderer, reaches 13 VP: result screen')
    REPORT['finish'] = {'targets': plan['targets'], 'home': plan['home'], 'result': view['result']}


def run():
    with sync_playwright() as p:
        browser = browser_ref['browser'] = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for count in (3, 4):
            contexts, pages, identity, game_id = start_four_islands(browser, count, lobby_shot='lobby-four-islands' if count == 3 else None)
            view = snap(contexts[0], f'/api/games/{game_id}')['view']
            assert view['board']['topologyId'] == f'sf-four-islands-{count}', view['board']['topologyId']
            assert view['victoryTarget'] == 13 and view['engineVersion'] == 'sf-2025.3'
            assert view['board']['pirate'] is None
            map_shots(browser, contexts, pages, game_id, count)
            if count == 4:
                done = setup_over_api(contexts, identity, game_id)
                home = done['modules']['seafarers'].get('home')
                assert home and set(home) == set(identity) and all(home[i] for i in identity), home
                REPORT['home'] = home
                host = pages[0]
                open_game(host, game_id, 'svg')
                host.locator('#tool-help').click()
                expect(host.get_by_test_id('help-four-islands-setup')).to_be_visible()
                expect(host.get_by_test_id('help-four-islands-bonus')).to_be_visible()
                shot(host, 'help-four-islands-svg-desktop', f'setup done, home islands {home}; help panel shows the Four Islands rules')
            if count == 4:
                try:
                    finish_live(contexts, pages, identity, game_id)
                except Exception:
                    pages[0].screenshot(path=str(OUT / 'failure.png'), timeout=base.TIMEOUT)
                    print('PLAYERS', pages[0].get_by_test_id('players-toggle').get_attribute('aria-expanded'),
                          pages[0].locator('[data-testid^="players-islands"]').count(), flush=True)
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
