#!/usr/bin/env python3
"""Cities & Knights core browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  CK_PORT=3032 python3 scripts/cities-knights/capture.py <new-empty-output-dir>

Rooms are created through the lobby (``ck-2025`` and ``ck-paired-2025`` are
enabled). Real games through the real UI and API (no mocked snapshots):

1. Lobby: the Cities & Knights expansion is offered.
2. A live 4-player game (ck-2025). After setup, a test-only fixture writes a
   city, cards and two progress cards for player 1 while the service is
   stopped; then, through the UI, player 1 recruits, activates and moves a
   knight (two-step target), builds a city wall and buys a city improvement
   from the panel. The barbarians are then moved next to the island (fixture)
   and the bot plays on until they attack; the attack panel and the score
   marks are captured. Other seats and filler turns are played over the API
   by a simple bot.
3. The 6-player paired map (ck-paired-2025) during setup.

Captures cover SVG and 3D on desktop and phone. Each step asserts the DOM
state it captures. ``report.json`` lists every case with its sha256. The
progress cards are covered by ``progress.py``.
"""
import json
import os
import sys

from playwright.sync_api import expect, sync_playwright

import ckkit
from ckkit import (
    ERRORS, SERVER, DESKTOP, PHONE, Table, api, ck_hints, close_panel, complete_setup, edge_endpoints, log,
    new_player, open_actions, open_game, open_panel, phone_context, play_until, shot, snap, start_ck_game,
    take, ui_click_target, ui_confirm,
)

# --------------------------------------------------------------------------- main

def main():
    ckkit.init(sys.argv)
    SERVER.start()
    try:
        run()
    finally:
        SERVER.stop()


def run():
    names = ['騎士團長', 'Mira', '阿卡', 'Jonas', 'Ilse', 'Tomas']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

        # 1. The lobby offers Cities & Knights.
        context, page = new_player(browser, 'Lobby')
        options = page.locator('[data-testid="expansion-select"] option').evaluate_all('(nodes) => nodes.map((n) => n.value)')
        assert any('citiesKnights' in value for value in options), options
        ckkit.REPORT['cases'].append({'name': 'lobby-cities-knights', 'status': 'PASS', 'note': f'expansions offered: {options}'})
        context.close()

        # 2. The live 4-player game.
        contexts, pages, identity, game_id = start_ck_game(browser, 4, names, 'ck-2025')
        try:
            live_game(browser, contexts, pages, identity, game_id)
        except Exception:
            for index, seat_page in enumerate(pages):
                seat_page.screenshot(path=str(ckkit.OUT / f'failure-seat{index}.png'))
            raise
        for context in contexts:
            context.close()

        # 3. The 6-player paired map during setup.
        if not os.environ.get('CK_SKIP_SIX'):
            contexts, pages, identity, game_id = start_ck_game(browser, 6, names, 'ck-paired-2025')
            for renderer in ('svg', 'r3f'):
                open_game(pages[0], game_id, renderer)
                expect(pages[0].get_by_test_id('ck-badge')).to_be_visible()
                shot(pages[0], f'map-6p-{renderer}-desktop', 'ck-paired-2025 setup board', ms=2500 if renderer == 'r3f' else 700)
            for context in contexts:
                context.close()
        browser.close()

    ckkit.REPORT['errors'] = ERRORS
    (ckkit.OUT / 'report.json').write_text(json.dumps(ckkit.REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
    log('CASES', len(ckkit.REPORT['cases']), 'ERRORS', len(ERRORS))
    if ERRORS:
        sys.exit(1)


def live_game(browser, contexts, pages, identity, game_id):
    table = Table(contexts, pages, identity, game_id)
    p1 = identity[0]
    page = pages[0]
    complete_setup(table)
    log('SETUP DONE')

    # Player 1's action phase.
    def p1_action(view):
        return view['turn']['playerId'] == p1 and view['turn']['phase'] == 'action' and view['pending'] is None
    play_until(table, p1_action, lambda view: False)

    def fixture(state):
        player = next(p for p in state['players'] if p['id'] == p1)
        own = [index for index, building in enumerate(state['board']['buildings']) if building and building['player'] == p1]
        state['board']['buildings'][own[0]]['city'] = True
        for card, amount in (('wool', 3), ('ore', 4), ('grain', 3), ('brick', 4), ('lumber', 2)):
            take(state['bank'], player['resources'], card, amount)
        for card, amount in (('paper', 3), ('cloth', 2), ('coin', 1)):
            take(state['commodityBank'], player['commodities'], card, amount)
        for track in ('science', 'politics'):
            deck = state['progressDecks'][track]
            index = next(i for i, card in enumerate(deck) if card not in ('printing', 'constitution'))
            player['progressCards'].append(deck.pop(index))
    SERVER.patch_game(game_id, fixture)
    me, view = table.me(p1)
    city = next(index for index, building in enumerate(view['board']['buildings']) if building and building['player'] == p1 and building['city'])

    # Recruit a knight through the UI.
    open_game(page, game_id, 'svg')
    expect(page.get_by_test_id('ck-badge')).to_be_visible()
    open_actions(page)
    page.get_by_test_id('action-knight.recruit').click()
    sites = ck_hints(table.snapshot(p1)['view'])['recruitSites']
    assert sites, 'no recruit site'
    ui_click_target(page, 'vertex', sites[0])
    shot(page, 'live-knight-recruit-svg', 'recruit: free intersections on the own routes, knight preview')
    ui_confirm(page)
    knight = sites[0]
    expect(page.locator(f'[data-testid="knight-{knight}"]')).to_have_attribute('data-active', 'false')

    # Activate it.
    open_actions(page)
    page.get_by_test_id('action-knight.activate').click()
    ui_click_target(page, 'vertex', knight)
    ui_confirm(page)
    expect(page.locator(f'[data-testid="knight-{knight}"]')).to_have_attribute('data-active', 'true')

    # A city wall.
    open_actions(page)
    page.get_by_test_id('action-build.wall').click()
    ui_click_target(page, 'vertex', city)
    shot(page, 'live-wall-target-svg', 'city wall: own cities without a wall')
    ui_confirm(page)
    expect(page.locator(f'[data-testid="wall-{city}"]')).to_be_visible()

    # A city improvement from the panel.
    open_panel(page)
    page.get_by_test_id('ck-improve-science').click()
    page.wait_for_timeout(800)
    expect(page.get_by_test_id('ck-track-science')).to_have_attribute('data-level', '1')
    shot(page, 'live-panel-svg', 'panel: barbarian track, event roll, improvement chart, progress hand (not playable)')
    close_panel(page)
    assert table.act(p1, {'type': 'turn.end'})

    # Next turn: move the knight in two steps.
    play_until(table, p1_action, lambda view: False)
    def knight_hint():
        return next(k for k in ck_hints(table.snapshot(p1)['view'])['knights'] if k['vertex'] == knight)
    # Give the knight somewhere to go: extend player 1's route from the knight over the API.
    view = table.snapshot(p1)['view']
    endpoints = edge_endpoints(view['board']['topologyId'])
    for edge in view['hints']['legalRoads']:
        if knight_hint()['moves']:
            break
        if knight in endpoints[edge]:
            table.act(p1, {'type': 'build.road', 'edge': edge})
    adjacent = [e for e in view['hints']['legalRoads'] if knight in endpoints[e]]
    if not knight_hint()['moves'] and adjacent:
        # Fallback fixture (test-only): lay the road directly while the service is down.
        def lay_road(state):
            state['board']['roads'][adjacent[0]] = {'player': p1, 'ship': False}
        SERVER.patch_game(game_id, lay_road)
    hint = knight_hint()
    log('KNIGHT', knight, hint, adjacent)
    if hint['moves']:
        open_game(page, game_id, 'svg')
        open_actions(page)
        page.get_by_test_id('action-knight.move').click()
        ui_click_target(page, 'vertex', knight, confirm=False)
        expect(page.get_by_test_id(f"target-vertex-{hint['moves'][0]}")).to_be_attached()
        shot(page, 'live-knight-move-targets-svg', 'move knight: second step, reachable intersections')
        ui_click_target(page, 'vertex', hint['moves'][0])
        ui_confirm(page)
        knight = hint['moves'][0]
        expect(page.locator(f'[data-testid="knight-{knight}"]')).to_be_visible()
        # Reactivate the knight when the hand allows it, so it defends.
        me, _ = table.me(p1)
        if not knight_hint()['active'] and me['resources']['grain'] > 0:
            open_actions(page)
            page.get_by_test_id('action-knight.activate').click()
            ui_click_target(page, 'vertex', knight)
            ui_confirm(page)
    else:
        log('NOTE knight has no move target; move capture skipped')
    open_game(page, game_id, 'r3f')
    shot(page, 'live-board-3d', 'knight, wall and city in 3D', ms=2500)

    phone, phone_page = phone_context(browser, contexts[0])
    for renderer in ('svg', 'r3f'):
        open_game(phone_page, game_id, renderer)
        shot(phone_page, f'live-board-{renderer}-phone', 'phone table with the C&K badge', ms=2500 if renderer == 'r3f' else 700)
    open_game(phone_page, game_id, 'svg')
    open_panel(phone_page)
    shot(phone_page, 'live-panel-phone', 'phone: C&K panel')
    phone.close()
    assert table.act(p1, {'type': 'turn.end'})

    # The barbarians: one ship away (fixture), then the bot plays until they attack.
    def near(state):
        state['moduleState']['citiesKnights']['barbarian'] = 6
        # Player 2 gets a second city, so losing means choosing which one is pillaged.
        p2 = identity[1]
        settlement = next(b for b in state['board']['buildings'] if b and b['player'] == p2 and not b['city'])
        settlement['city'] = True
    SERVER.patch_game(game_id, near)
    def attacked(view):
        pending = view['pending']
        return view['modules']['citiesKnights']['lastAttack'] is not None and (pending is None or pending['kind'] == 'citiesKnights.pillage')
    captured = False
    while True:
        view = play_until(table, attacked, lambda view: False)
        pending = view['pending']
        if pending is None:
            break
        # A losing player chooses the pillaged city through their own UI.
        loser = pending['responders'][0]
        loser_page = table.page_of[loser]
        open_game(loser_page, game_id, 'svg')
        expect(loser_page.get_by_test_id('ck-pillage')).to_be_visible()
        if not captured:
            shot(loser_page, 'live-pillage-prompt-svg', 'barbarians won: the weakest defender picks a city to pillage')
            captured = True
        loser_page.locator('[data-testid^="ck-pillage-"]').first.click()
        loser_page.wait_for_timeout(800)
    attack = view['modules']['citiesKnights']['lastAttack']
    log('ATTACK', attack)
    open_game(page, game_id, 'svg')
    assert view['modules']['citiesKnights']['robberActive'], 'robber not in play after the attack'
    expect(page.get_by_test_id('robber')).to_be_visible()
    open_panel(page)
    expect(page.get_by_test_id('ck-attack')).to_have_attribute('data-outcome', attack['outcome'])
    shot(page, 'live-attack-svg', f"barbarian attack: {attack['barbarians']} vs {attack['defenders']} ({attack['outcome']})")
    close_panel(page)
    if attack['defender']:
        seat = next(p['seat'] for p in view['players'] if p['id'] == attack['defender'])
        expect(page.get_by_test_id(f'players-defender-{seat}')).to_be_attached()
    open_game(page, game_id, 'r3f')
    shot(page, 'live-after-attack-3d', 'after the attack: the robber is on the island', ms=2500)


if __name__ == '__main__':
    main()
