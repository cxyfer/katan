#!/usr/bin/env python3
"""Through the Desert (SF25 pp. 10-11) browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 SF_TIMEOUT=180000 python3 scripts/seafarers/capture_through_the_desert.py <new-empty-output-dir>

Reuses the New Shores harness (``capture.py``: private-SQLite service, Playwright
helpers, report format) and only adds the Through the Desert flow. Real games
through the real UI and API (no mocked snapshots):

1. Lobby: Seafarers -> Through the Desert, 3-4 players only.
2. Maps: the 3-player (35-hex frame) and 4-player (42-hex frame) boards in SVG
   and 3D during setup (three deserts, gold, pirate on the frame); phone for 4.
3. Setup finished over the API (every step is a legal spot on the main island
   only); ``desert_fixture.mjs check`` confirms no starting settlement touches
   an unexplored region; the help panel shows the Through the Desert rules.
4. A live finish for player 1 through the UI: while the service is stopped, a
   test-only fixture gives player 1 the turn, two sets of building cards,
   6 other bonus points and a road to two empty corners (``desert_fixture.mjs
   plan``): one between the desert and the land strip, one on a
   small island. Through the UI player 1 settles the desert/strip corner in
   the 3D renderer (+2 and it counts for island 2 only; the canvas carries
   ``data-island-tokens`` for the 3D token, SVG token and player panel are
   checked after), then the small island in SVG (+2 again), which reaches 14 VP
   and shows the result screen. The run FAILS if a token or the result screen
   is missing.

``report.json`` lists every case with its sha256; only the curated captures
are kept (``committed: true``), the other images are deleted after the run.
"""
from __future__ import annotations

import json
import subprocess
import sys

from playwright.sync_api import expect, sync_playwright

import capture as base  # noqa: E402  (module-level setup reads argv[1] and prepares OUT)
from capture import ERRORS, OUT, REPORT, SERVER, api, log, map_shots, new_player, open_game, open_actions, shot, snap, ui_click_target, ui_confirm

# capture.py 的 REPORT 預先放了 New Shores 的 fixtures；這份報告只含穿越荒漠資料。
REPORT.clear()
REPORT.update({'scenario': 'through-the-desert', 'profile': 'sf-through-the-desert-2025', 'base': base.BASE, 'cases': []})

NAMES = ['海岸領航員', 'Mira', '阿卡', 'Jonas']
FIXTURE = str(base.ROOT / 'scripts/seafarers/desert_fixture.mjs')
CURATED = {
    'lobby-through-the-desert', 'map-3p-svg-desktop', 'map-4p-svg-desktop', 'map-4p-r3f-desktop',
    'map-4p-svg-phone', 'help-desert-svg-desktop', 'live-strip-bonus-svg', 'live-strip-bonus-3d', 'live-result',
}


def fixture(*args, state):
    out = subprocess.run(['node', '--experimental-strip-types', FIXTURE, *args], input=json.dumps(state), check=True,
                         capture_output=True, text=True, cwd=base.ROOT).stdout
    return json.loads(out)


def start_desert(browser, count, lobby_shot=None):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.get_by_test_id('scenario-select').select_option('through-the-desert')
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    options = host.locator('#room-capacity option').evaluate_all('(items) => items.map((item) => item.value)')
    assert options == ['3', '4'], options
    if lobby_shot:
        shot(host, lobby_shot, 'lobby: Seafarers / Through the Desert, 3-4 players only')
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
    """Every seat takes a different legal spot (the server only offers main-island corners), road first legal."""
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
            'commandId': f'td-{step}-{len(REPORT["cases"])}-{command["type"]}-{turn["setup"]["stage"]}-{view["seq"]}',
            'expectedRevision': mine['revision'], 'command': command})
        body = response.json()
        # 不只看 HTTP ok：回執必須是 accepted，被拒就失敗，不重送同一個命令 ID。
        assert body['ok'] and body['data']['outcome'] == 'accepted', (command, body)


def finish_live(contexts, pages, identity, game_id):
    """Player 1 settles the desert/strip corner and a small island through the UI: +2 each, the second reaches 14 VP."""
    p1 = identity[0]
    plan = {}

    def prepare(state):
        seat = next(i for i, player in enumerate(state['players']) if player['id'] == p1)
        checked = fixture('check', state=state)
        assert checked['mainOnly'], checked
        plan.update(fixture('plan', p1, state=state), settled=checked['settled'])
        player = state['players'][seat]
        player['resources'] = {'lumber': 2, 'brick': 2, 'wool': 2, 'grain': 2, 'ore': 0}
        player['bonusPoints'] = 6  # 2 起始村落 + 6 = 8；+3 = 11；再 +3 = 14
        for target in plan['targets']:
            state['board']['roads'][target['edge']] = {'player': p1, 'ship': False}
        state['turn'].update({'seat': seat, 'phase': 'action', 'dice': [3, 4], 'setup': None})
        state['pending'] = None
        state['windowId'] += 1
    SERVER.patch_game(game_id, prepare)
    first, second = plan['targets']
    assert first['touches'] == [1, 2] and first['island'] == 2, first
    page = pages[0]
    for other in pages:
        other.reload()

    def settle(target, renderer='svg'):
        open_game(page, game_id, renderer)
        open_actions(page)
        page.get_by_test_id('action-build.settlement').click()
        ui_click_target(page, 'vertex', target['vertex'])
        ui_confirm(page)

    # 沙漠與陸地帶交界這一次在 3D 渲染器上透過 UI 點選完成（目標疊層與 SVG 共用）。
    settle(first, 'r3f')
    expect(page.get_by_test_id('board')).to_have_attribute('data-effective-renderer', 'r3f')
    view = snap(contexts[0], f'/api/games/{game_id}')['view']
    # 碰到主島（沙漠）與島 2：只算島 2。
    assert view['modules']['seafarers']['islandBonus'][p1] == [2], view['modules']['seafarers']
    assert view['result'] is None
    # 3D 端的獎勵標記：場景實際畫出的標記數由 canvas 的 data-island-tokens 斷言。
    page.wait_for_function("() => document.querySelector('canvas')?.dataset.islandTokens === '1'", timeout=60000)
    shot(page, 'live-strip-bonus-3d', 'settlement between the desert and the land strip placed in the 3D board: +2 for region 2 only', ms=2500)
    open_game(page, game_id, 'svg')
    expect(page.get_by_test_id(f"island-bonus-{first['vertex']}")).to_be_attached()
    expect(page.get_by_test_id('players-islands-0')).to_be_attached()
    shot(page, 'live-strip-bonus-svg', 'the same bonus in the SVG board (token and player panel)')

    settle(second)
    view = snap(contexts[0], f'/api/games/{game_id}')['view']
    assert view['result'] and view['result']['playerId'] == p1 and view['result']['reason'] == 'victory', view['result']
    assert view['modules']['seafarers']['islandBonus'][p1] == sorted([2, second['island']])
    expect(page.get_by_test_id('result-screen')).to_be_visible()
    expect(page.get_by_test_id('result-winner')).to_be_visible()
    shot(page, 'live-result', 'second region reaches 14 VP: result screen')
    REPORT['finish'] = {'targets': plan['targets'], 'result': view['result']}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for count in (3, 4):
            contexts, pages, identity, game_id = start_desert(browser, count, lobby_shot='lobby-through-the-desert' if count == 3 else None)
            view = snap(contexts[0], f'/api/games/{game_id}')['view']
            assert view['board']['topologyId'] == f'sf-through-the-desert-{count}', view['board']['topologyId']
            assert view['victoryTarget'] == 14 and view['engineVersion'] == 'sf-2025.3'
            assert view['board']['pirate'] is None and view['board']['terrain'][view['board']['robber']] == 'desert'
            assert len(view['board']['terrain']) == (35 if count == 3 else 42)
            map_shots(browser, contexts, pages, game_id, count, phone=count == 4)
            if count == 4:
                done = setup_over_api(contexts, identity, game_id)
                assert 'home' not in done['modules']['seafarers'], done['modules']['seafarers']
                host = pages[0]
                open_game(host, game_id, 'svg')
                host.locator('#tool-help').click()
                expect(host.get_by_test_id('help-desert-setup')).to_be_visible()
                expect(host.get_by_test_id('help-desert-bonus')).to_be_visible()
                assert '金礦' in host.get_by_test_id('help-seafarers').inner_text()
                shot(host, 'help-desert-svg-desktop', 'setup done on the main island; help panel shows the Through the Desert rules and the gold line')
                finish_live(contexts, pages, identity, game_id)
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
