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

``report.json`` lists every case with its sha256.
"""
from __future__ import annotations

import json
import sys

from playwright.sync_api import expect, sync_playwright

import capture as base  # noqa: E402  (module-level setup reads argv[1] and prepares OUT)
from capture import ERRORS, OUT, REPORT, SERVER, api, log, map_shots, new_player, open_game, shot, snap

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


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
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
            for context in contexts:
                context.close()
        browser.close()
    REPORT['errors'] = ERRORS
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
