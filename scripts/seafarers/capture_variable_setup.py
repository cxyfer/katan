#!/usr/bin/env python3
"""Seafarers variable setup browser evidence against the built service
(S10a: Four Islands p. 7, Fog Islands p. 9, Through the Desert p. 11;
S10b: Forgotten Tribe p. 13, Cloth for Catan p. 15, Wonders of Catan p. 18).

Usage (``pnpm build`` first; the output directory must be new and empty):

  SF_PORT=3023 SF_TIMEOUT=180000 python3 scripts/seafarers/capture_variable_setup.py <new-empty-output-dir>

Reuses the New Shores harness (``capture.py``: private-SQLite service, Playwright
helpers, report format). Real games through the real UI and API (no mocked snapshots),
for each scenario and 3 / 4 players (``SF_SCENARIOS=cloth-for-catan,...`` runs only some;
``SF_PREV_REPORT=<old report.json>`` merges the earlier entries so the S10a cases are kept):

1. Lobby: Seafarers -> scenario, create the room, the host switches the setup mode to
   ``variable`` in the lobby settings and saves (the saved value is asserted in the
   lobby select and shown in the lobby screenshot; the started game's board proves it).
2. Start the game. The board is read from the API and checked by ``variable_fixture.mjs``
   (rules package, no Python topology): it differs from the fixed map; Four Islands has no
   2/3/11/12 on forest or pasture; Through the Desert has no adjacent red discs and no red
   disc on gold; the robber sits on the 12 disc (Four Islands, Fog Islands) or on the desert
   (Through the Desert); Forgotten Tribe has none of 5/6/8/9 on the three right-edge hexes of the
   large island and the robber on a desert; Wonders of Catan has no red disc on the two land hexes
   beside the desert and the robber on a desert; Cloth for Catan has two 12 discs.
   Cloth for Catan starts in the ``robber`` setup stage: the starting player picks one of the two
   12 hexes on the board (3 players in SVG, 4 players in 3D) and confirms; the API shows the robber
   on the chosen hex and the setup back at the starting settlements.
3. The board is captured in SVG (3 and 4 players) and 3D (4 players) on desktop; the 4-player SVG also on a phone viewport.

``report.json`` lists every case with its sha256; only the curated captures are kept
(``committed: true``), the other images are deleted after the run.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

from playwright.sync_api import expect, sync_playwright

import capture as base  # noqa: E402  (module-level setup reads argv[1] and prepares OUT)
from capture import ERRORS, OUT, PHONE, REPORT, SERVER, TIMEOUT, api, log, new_player, open_game, shot, snap, ui_confirm

REPORT.clear()
REPORT.update({'scenario': 'variable-setup', 'base': base.BASE, 'cases': []})

NAMES = ['海岸領航員', 'Mira', '阿卡', 'Jonas']
FIXTURE = str(base.ROOT / 'scripts/seafarers/variable_fixture.mjs')
SCENARIOS = [
    ('four-islands', 'sf-four-islands-2025'),
    ('fog-islands', 'sf-fog-islands-2025'),
    ('through-the-desert', 'sf-through-the-desert-2025'),
    ('forgotten-tribe', 'sf-forgotten-tribe-2025'),
    ('cloth-for-catan', 'sf-cloth-for-catan-2025'),
    ('wonders-of-catan', 'sf-wonders-of-catan-2025'),
]
# SF_SCENARIOS=through-the-desert,... 可只重拍部分劇本（預設全部）。
_ONLY = [name for name in os.environ.get('SF_SCENARIOS', '').split(',') if name]
if _ONLY:
    SCENARIOS = [item for item in SCENARIOS if item[0] in _ONLY]
CURATED = {
    f'{scenario}-{name}'
    for scenario, _ in SCENARIOS
    for name in ('lobby-variable', 'map-4p-svg-desktop', 'map-4p-r3f-desktop', 'map-3p-svg-desktop', 'map-4p-svg-phone')
} | ({'cloth-for-catan-robber-targets-3p-svg-desktop', 'cloth-for-catan-robber-targets-4p-r3f-desktop'}
     if any(name == 'cloth-for-catan' for name, _ in SCENARIOS) else set())


def check_board(profile, count, board):
    out = subprocess.run(['node', '--experimental-strip-types', FIXTURE], check=True, capture_output=True, text=True,
                         cwd=base.ROOT, input=json.dumps({'profileId': profile, 'playerCount': count, 'board': board})).stdout
    return json.loads(out)


def start_variable(browser, scenario, count, lobby_shot=None):
    players = [new_player(browser, name) for name in NAMES[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('seafarers')
    host.get_by_test_id('scenario-select').select_option(scenario)
    host.locator('#room-capacity').select_option(str(count))
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    host.get_by_test_id('create-room').click()
    code = host.get_by_test_id('room-code').inner_text()
    # 大廳：房主把版圖設定改成 variable 並儲存。
    setup = host.get_by_test_id('lobby-setup')
    options = setup.evaluate('(select) => [...select.options].map((option) => option.value)')
    assert options == ['fixed', 'variable'], options
    setup.select_option('variable')
    host.get_by_test_id('save-settings').click()
    expect(host.get_by_test_id('lobby-setup')).to_have_value('variable')
    if lobby_shot:
        shot(host, lobby_shot, f'lobby: {scenario}, setup mode switched to variable and saved')
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


def choose_robber(page, contexts, identity, game_id, renderer, shot_name):
    """Cloth for Catan variable setup: the starting player picks one of the two 12 hexes on the board and confirms."""
    path = f'/api/games/{game_id}'
    before = snap(contexts[0], path)['view']
    assert before['turn']['setup']['stage'] == 'robber', before['turn']['setup']
    starter = identity.index(before['turn']['playerId'])
    assert starter == 0, starter  # 房主是起始玩家（join order）
    twelves = [hex for hex, disc in enumerate(before['board']['numbers']) if disc == 12]
    assert len(twelves) == 2, twelves
    mine = snap(contexts[starter], path)['view']['hints']['modules']['seafarers']
    assert mine['robberChoice'] == twelves and mine['board']['commandType'] == 'cloth.robber', mine
    open_game(page, game_id, renderer)
    expect(page.get_by_test_id('setup-robber-guide')).to_be_visible(timeout=TIMEOUT)
    for hex in twelves:
        expect(page.get_by_test_id(f'target-hex-{hex}')).to_be_attached(timeout=TIMEOUT)
    shot(page, shot_name, f'{renderer}: the two 12 hexes the starting player may put the robber on', ms=2500 if renderer == 'r3f' else 700)
    target = [hex for hex in twelves if hex != before['board']['robber']][0]
    page.get_by_test_id(f'target-hex-{target}').click(force=True)
    picker = page.get_by_test_id('target-picker')
    page.wait_for_timeout(300)
    if picker.count() and picker.is_visible():
        page.get_by_test_id(f'picker-hex-{target}').click()
    expect(page.get_by_test_id('confirm-selection')).to_be_visible(timeout=TIMEOUT)
    ui_confirm(page)
    after = snap(contexts[0], path)['view']
    assert after['board']['robber'] == target, (after['board']['robber'], target)
    assert after['turn']['setup']['stage'] == 'building', after['turn']['setup']
    log('ROBBER', renderer, 'chose', target, 'of', twelves)
    return target


def board_shots(browser, contexts, pages, game_id, scenario, count):
    """3 players: SVG desktop; 4 players: SVG and 3D desktop plus SVG on a phone viewport (3D is slow under swiftshader)."""
    host_ctx, host = contexts[0], pages[0]
    view = snap(host_ctx, f'/api/games/{game_id}')['view']
    renderers = ('svg',) if count == 3 else ('svg', 'r3f')
    for renderer in renderers:
        open_game(host, game_id, renderer)
        if renderer == 'svg':
            hexes = host.locator('[data-testid^="hex-"]').count()
            assert hexes == len(view['board']['terrain']), (hexes, len(view['board']['terrain']))
        shot(host, f'{scenario}-map-{count}p-{renderer}-desktop', f"variable {view['board']['topologyId']}",
             ms=2500 if renderer == 'r3f' else 700)
    if count == 4:
        phone_ctx = browser.new_context(storage_state=host_ctx.storage_state(), viewport=PHONE, locale='zh-TW',
                                        reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
        page = phone_ctx.new_page()
        page.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
        page.set_default_timeout(base.TIMEOUT)
        open_game(page, game_id, 'svg')
        shot(page, f'{scenario}-map-4p-svg-phone', f"variable {view['board']['topologyId']}")
        phone_ctx.close()


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for scenario, profile in SCENARIOS:
            for count in (3, 4):
                contexts, pages, identity, game_id = start_variable(
                    browser, scenario, count, lobby_shot=f'{scenario}-lobby-variable' if count == 4 else None)
                view = snap(contexts[0], f'/api/games/{game_id}')['view']
                board = view['board']
                checked = check_board(profile, count, board)
                log('VARIABLE', scenario, count, checked)
                assert not checked['sameAsFixed'], checked
                if scenario == 'four-islands':
                    assert not checked['lowOnForestPasture'] and checked['robberOnTwelve'], checked
                elif scenario == 'fog-islands':
                    assert checked['robberOnTwelve'], checked
                elif scenario == 'through-the-desert':
                    assert not checked['redAdjacent'] and not checked['redOnGold'] and checked['robberTerrain'] == 'desert', checked
                elif scenario == 'forgotten-tribe':
                    assert not checked['tribeRestrictedBad'] and checked['robberTerrain'] == 'desert', checked
                elif scenario == 'wonders-of-catan':
                    assert not checked['wondersRedBesideDesert'] and checked['robberTerrain'] == 'desert', checked
                else:
                    # 布匹產地：強盜暫放在第一個 12 號格，之後由起始玩家在兩個 12 號格之間選。
                    assert checked['twelveCount'] == 2 and checked['robberOnTwelve'], checked
                REPORT['cases'].append({'name': f'{scenario}-{count}p-board-check', 'status': 'PASS', 'note': json.dumps(checked),
                                        'sha256': None, 'viewport': None, 'committed': False})
                if scenario == 'cloth-for-catan':
                    # 3 人在 SVG、4 人在 3D 實際選一次強盜（兩個渲染器的棋盤目標都可操作）。
                    renderer = 'svg' if count == 3 else 'r3f'
                    choose_robber(pages[0], contexts, identity, game_id, renderer, f'cloth-for-catan-robber-targets-{count}p-{renderer}-desktop')
                board_shots(browser, contexts, pages, game_id, scenario, count)
                for context in contexts:
                    context.close()
        browser.close()
    REPORT['errors'] = ERRORS
    assert 'sf-new-shores' not in json.dumps(REPORT), 'New Shores data leaked into the report'
    for case in REPORT['cases']:
        if case['sha256'] is None:
            continue
        keep = case['name'] in CURATED
        case['committed'] = keep
        if not keep:
            (OUT / f"{case['name']}.png").unlink(missing_ok=True)
    # 合併先前的報告（S10a 的條目）：同名的以這次為準，其餘保留。
    previous = os.environ.get('SF_PREV_REPORT')
    if previous:
        old = json.loads(open(previous, encoding='utf-8').read())
        names = {case['name'] for case in REPORT['cases']}
        REPORT['cases'] = [case for case in old['cases'] if case['name'] not in names] + REPORT['cases']
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
