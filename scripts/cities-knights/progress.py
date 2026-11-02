#!/usr/bin/env python3
"""Cities & Knights progress cards through the browser, against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  CK_PORT=3032 python3 scripts/cities-knights/progress.py <new-empty-output-dir>

Real 4-player game (``ck-2025``, created through the lobby). The setup and the
filler turns run over the API; every card is played by player 1 through the UI,
and every answer another seat owes is given in that seat's own page. A
test-only fixture (``Server.patch_game``, the service is stopped while it
edits the persisted snapshot) writes hands, knights and score before each
group of cards so the cards have something to act on.

Passes 1 and 2 (desktop) play all 23 playable card types in the SVG renderer
and then again in 3D: Alchemy before the roll, then the science, trade and
politics decks (responder prompts for Commercial Harbor, Guild Dues, Espionage,
Sabotage, Wedding, Treason, Intrigue and Diplomacy, each in the page of the
seat that owes the answer, in the pass's renderer). Passes 3 and 4 play the
board-target cards on a phone in SVG and 3D. The two victory cards are never
played (CK25 p. 10); a fixture shows them revealed in the panel. After the
cards, the merchant's 2:1 rate and point are checked through the API.

Each step asserts the DOM and the API state it captures. ``report.json`` lists
every case with its sha256 and the cards played per pass.
"""
import json
import os
import sys

from playwright.sync_api import expect, sync_playwright

import ckkit
from ckkit import (
    ERRORS, SERVER, Table, ck_hints, complete_setup, edge_endpoints, log, new_player, open_game, phone_context,
    play_until, shot, start_ck_game, take, ui_click_target, ui_confirm,
)

SCIENCE = ['alchemy', 'crane', 'engineering', 'invention', 'irrigation', 'medicine', 'mining', 'roadBuilding', 'smithing']
TRADE = ['commercialHarbor', 'guildDues', 'merchant', 'merchantFleet', 'resourceMonopoly', 'tradeMonopoly']
POLITICS = ['diplomacy', 'encouragement', 'espionage', 'intrigue', 'sabotage', 'taxation', 'treason', 'wedding']
ALL_CARDS = SCIENCE + TRADE + POLITICS
BOARD_CARDS = ['merchant', 'taxation', 'engineering', 'medicine', 'treason', 'intrigue', 'diplomacy']
PLAYED: dict = {}
# Cards played per renderer; the renderer the pages are opened in is `CURRENT`.
PLAYED_BY: dict = {}
CURRENT = {'renderer': 'svg'}


# ---------------------------------------------------------------------- fixtures

def deck_of(card):
    if card in SCIENCE:
        return 'science'
    return 'trade' if card in TRADE else 'politics'


def give(state, pid, cards):
    """Test-only: replace a player's progress hand, taking the cards from their decks."""
    player = next(p for p in state['players'] if p['id'] == pid)
    for card in player['progressCards']:
        state['progressDecks'][deck_of(card)].append(card)
    player['progressCards'] = []
    for card in cards:
        deck = state['progressDecks'][deck_of(card)]
        if card in deck:
            deck.remove(card)
        player['progressCards'].append(card)


def hand(state, pid, resources=None, commodities=None):
    """Test-only: set a player's resource and commodity cards (bank adjusted)."""
    player = next(p for p in state['players'] if p['id'] == pid)
    for kind, amount in list(player['resources'].items()):
        state['bank'][kind] += amount
        player['resources'][kind] = 0
    for kind, amount in list(player['commodities'].items()):
        state['commodityBank'][kind] += amount
        player['commodities'][kind] = 0
    for kind, amount in (resources or {}).items():
        take(state['bank'], player['resources'], kind, amount)
    for kind, amount in (commodities or {}).items():
        take(state['commodityBank'], player['commodities'], kind, amount)


def ck_state(state):
    return state['moduleState']['citiesKnights']


def place_knight(state, pid, vertex, level=1, active=False):
    ck_state(state)['knights'].append({'player': pid, 'vertex': vertex, 'level': level, 'active': active})


def reset_knights_and_walls(state):
    ck = ck_state(state)
    ck['knights'] = []
    ck['walls'] = []
    for player in state['players']:
        player['cityWalls'] = 0


def road_ends(view, topology_edges, pid):
    """Free far ends of a player's roads (vertices without a building) for knights."""
    out = []
    for edge, road in enumerate(view['board']['roads']):
        if road and road['player'] == pid and not road['ship']:
            for vertex in topology_edges[edge]:
                if view['board']['buildings'][vertex] is None:
                    out.append(vertex)
    return out


# ------------------------------------------------------------------------- UI

def open_tool(page):
    tab = page.get_by_test_id('tool-tab-citiesKnights')
    expect(tab).to_be_visible()
    if tab.get_attribute('aria-expanded') != 'true':
        tab.click()
    expect(page.get_by_test_id('ck-panel')).to_be_visible()


def close_tool(page):
    tab = page.get_by_test_id('tool-tab-citiesKnights')
    if tab.count() and tab.get_attribute('aria-expanded') == 'true':
        page.get_by_test_id('tool-close').click()


def hand_of(table, pid):
    return table.me(pid)[0]['progressCards']


def hand_shot(page, name, note, ms=700):
    page.get_by_test_id('ck-progress-hand').scroll_into_view_if_needed()
    shot(page, name, note, ms=ms)


def card_button(page, card):
    return page.get_by_test_id(f'ck-play-{card}')


def start_card(table, page, pid, card):
    """Click Play on a card in the panel; returns once the card is expected to be playable."""
    open_tool(page)
    row = page.get_by_test_id(f'ck-card-{card}')
    expect(row).to_have_attribute('data-playable', 'true')
    before = hand_of(table, pid).count(card)
    card_button(page, card).click()
    return before


def played(table, pid, card, before):
    for _ in range(40):
        if hand_of(table, pid).count(card) == before - 1:
            PLAYED.setdefault(card, 0)
            PLAYED[card] += 1
            PLAYED_BY.setdefault(CURRENT['renderer'], {}).setdefault(card, 0)
            PLAYED_BY[CURRENT['renderer']][card] += 1
            return
        table.pages[0].wait_for_timeout(250)
    raise AssertionError(f'{card} was not played (hand {hand_of(table, pid)})')


def play_direct(table, page, pid, card):
    before = start_card(table, page, pid, card)
    played(table, pid, card, before)
    log('PLAYED', card)


def play_target(table, page, pid, card, kind, index, snapshot_name=None, close=True):
    """Cards with one board target: click Play, then the target on the board, then confirm."""
    before = start_card(table, page, pid, card)
    if close:
        close_tool(page)
    ui_click_target(page, kind, index)
    if snapshot_name:
        shot(page, snapshot_name, f'{card}: board target selected')
    ui_confirm(page)
    played(table, pid, card, before)
    log('PLAYED', card, kind, index)


def hints_for(table, pid, card):
    hint = next(h for h in ck_hints(table.me(pid)[1])['progress'] if h['card'] == card)
    assert hint['playable'], (card, hint)
    return hint


def pick_other(table, pid, count=1):
    return [other for other in table.identity if other != pid][:count]


def wait_prompt(page, testid, timeout=15000):
    prompt = page.get_by_test_id(testid)
    expect(prompt).to_be_visible(timeout=timeout)
    return prompt


def answer_picker(page, testid, kinds):
    """Fill a card picker (guild dues, sabotage, wedding) with the given kinds and submit."""
    for kind in kinds:
        page.get_by_test_id(f'{testid}-add-{kind}').click()
    page.get_by_test_id(f'{testid}-submit').click()
    page.wait_for_timeout(500)


def no_pending(table, timeout=15):
    for _ in range(timeout * 4):
        if table.snapshot()['view']['pending'] is None:
            return
        table.pages[0].wait_for_timeout(250)
    raise AssertionError(f"pending left: {table.snapshot()['view']['pending']}")



def respond_picks(table, pages, prefix, shot_name, note):
    """Every responder of a Sabotage / Wedding frame picks the required cards in their own page."""
    first = True
    for _ in range(12):
        pending = table.snapshot()['view']['pending']
        if pending is None:
            return
        for pid in list(pending['responders']):
            responder_page = pages[table.identity.index(pid)]
            open_game(responder_page, table.game_id, CURRENT['renderer'])
            wait_prompt(responder_page, f'ck-{prefix}')
            if first:
                shot(responder_page, shot_name, note)
                first = False
            required = table.snapshot(pid)['view']['pending']['data']['required'][pid]
            me = table.me(pid)[0]
            cards = {**me['resources'], **me['commodities']}
            picks = []
            for kind in sorted(cards, key=lambda k: -cards[k]):
                for _ in range(cards[kind]):
                    if len(picks) < required:
                        picks.append(kind)
            for kind in picks:
                responder_page.get_by_test_id(f'ck-{prefix}-pick-add-{kind}').click()
            responder_page.get_by_test_id(f'ck-{prefix}-pick-submit').click()
            responder_page.wait_for_timeout(600)
    no_pending(table)


# ------------------------------------------------------------------- scenarios

def standard_fixture(table, p1, hands, extra=None):
    """Player 1 gets `hands`; the others get public score and cards the cards can act on."""
    p2, p3, p4 = pick_other(table, p1, 3)
    view = table.me(p1)[1]
    edges = edge_endpoints(view['board']['topologyId'])
    roads = [dict(road) if road else None for road in view['board']['roads']]
    ends_p1 = list(dict.fromkeys(road_ends(view, edges, p1)))
    new_roads = []
    # Three free route vertices for player 2's knights and two for player 1's; extend a road where there are fewer.
    while len(ends_p1) < 5:
        edge = next(e for e, (a, b) in enumerate(edges) if roads[e] is None and (a in ends_p1) != (b in ends_p1)
                    and view['board']['buildings'][a if a not in ends_p1 else b] is None)
        roads[edge] = {'player': p1, 'ship': False}
        new_roads.append(edge)
        ends_p1 = list(dict.fromkeys(road_ends({'board': {'roads': roads, 'buildings': view['board']['buildings']}}, edges, p1)))

    def fixture(state):
        reset_knights_and_walls(state)
        ck = ck_state(state)
        ck['attacks'] = 1
        ck['harbor'] = None
        ck['fleets'] = []
        ck['alchemy'] = None
        buildings = [i for i, b in enumerate(state['board']['buildings']) if b and b['player'] == p1]
        for number, vertex in enumerate(buildings):
            state['board']['buildings'][vertex]['city'] = number == 0
        give(state, p1, hands)
        hand(state, p1, {'lumber': 3, 'brick': 3, 'wool': 3, 'grain': 3, 'ore': 3}, {'paper': 3, 'cloth': 2, 'coin': 2})
        # p2 leads (2 VP cards), p3 equals p1's +1, p4 trails; hands differ so the answers need choices.
        ck['progressVp'][p2] = ['printing', 'constitution']
        ck['progressVp'][p3] = ['printing']
        ck['progressVp'][p1] = []
        hand(state, p2, {'lumber': 2, 'brick': 1, 'wool': 2}, {'paper': 2, 'cloth': 1})
        hand(state, p3, {'grain': 2, 'ore': 2, 'brick': 2}, {'coin': 2})
        hand(state, p4, {'lumber': 1}, {})
        give(state, p2, ['mining', 'tradeMonopoly', 'treason'])
        # Knights: two basic ones for player 1, three for player 2 at the ends of player 1's roads.
        for vertex in ends_p1[3:5]:
            place_knight(state, p1, vertex)
        for edge in new_roads:
            state['board']['roads'][edge] = {'player': p1, 'ship': False}
        for vertex, level in zip(ends_p1, (1, 1, 2)):
            if not any(k['vertex'] == vertex for k in ck['knights']):
                place_knight(state, p2, vertex, level=level, active=True)
        if extra:
            extra(state)

    SERVER.patch_game(table.game_id, fixture)
    return p2, p3, p4


def reach_action(table, p1):
    def action(view):
        return view['turn']['playerId'] == p1 and view['turn']['phase'] == 'action' and view['pending'] is None
    return play_until(table, action, lambda view: False)


def alchemy_before_roll(table, p1, page):
    """Player 1's roll phase: Alchemy sets both production dice, then the roll follows them."""
    view = table.snapshot()['view']
    assert view['turn']['playerId'] == p1 and view['turn']['phase'] == 'preroll', view['turn']

    def fixture(state):
        give(state, p1, ['alchemy', 'crane', 'mining'])
    SERVER.patch_game(table.game_id, fixture)
    open_game(page, table.game_id, CURRENT['renderer'])
    open_tool(page)
    # Cards that cannot be played before the roll say why.
    expect(page.get_by_test_id('ck-card-crane')).to_have_attribute('data-playable', 'false')
    expect(page.get_by_test_id('ck-card-crane')).to_have_attribute('data-reason', 'before-roll')
    expect(page.get_by_test_id('ck-card-alchemy')).to_have_attribute('data-playable', 'true')
    hand_shot(page, f'progress-hand-preroll-{CURRENT["renderer"]}', 'hand before the roll: Alchemy playable, the others say "after the roll"')
    before = start_card(table, page, p1, 'alchemy')
    page.get_by_test_id('ck-alchemy-yellow-2').click()
    page.get_by_test_id('ck-alchemy-red-4').click()
    expect(page.get_by_test_id('ck-alchemy-total')).to_contain_text('6')
    shot(page, f'progress-alchemy-dice-{CURRENT["renderer"]}', 'Alchemy: both production dice chosen before the roll')
    page.get_by_test_id('ck-play-confirm').click()
    played(table, p1, 'alchemy', before)
    expect(page.get_by_test_id('ck-alchemy-set')).to_be_visible()
    # The set dice are public to the table.
    other = table.page_of[pick_other(table, p1)[0]]
    open_game(other, table.game_id, CURRENT['renderer'])
    open_tool(other)
    expect(other.get_by_test_id('ck-alchemy-set')).to_be_visible()
    close_tool(other)
    close_tool(page)
    page.get_by_test_id('prompt-roll').click()
    for _ in range(40):
        dice = table.snapshot()['view']['turn']['dice']
        if dice:
            break
        page.wait_for_timeout(250)
    assert sorted(dice) != [] and dice[0] == 2 and dice[1] == 4, dice
    PLAYED['alchemy.dice'] = dice
    log('ALCHEMY dice', dice)
    # The player may not play it twice in a window: the second copy is blocked.
    return dice


def science_pass(table, p1, pages):
    page = pages[0]
    p2, p3, p4 = standard_fixture(table, p1, ['crane', 'invention', 'irrigation', 'mining'])
    open_game(page, table.game_id, CURRENT['renderer'])
    open_tool(page)
    expect(page.get_by_test_id('ck-progress-hand')).to_be_visible()
    hand_shot(page, f'progress-hand-science-{CURRENT["renderer"]}', 'science deck in hand: playable cards with a Play button')

    play_direct(table, page, p1, 'irrigation')
    play_direct(table, page, p1, 'mining')

    # Crane: pick the improvement.
    level = table.me(p1)[0]['improvements']['science']
    before = start_card(table, page, p1, 'crane')
    shot(page, f'progress-crane-choice-{CURRENT["renderer"]}', 'Crane: improvements one commodity cheaper')
    page.get_by_test_id('ck-crane-science').click()
    played(table, p1, 'crane', before)
    assert table.me(p1)[0]['improvements']['science'] == level + 1

    # Invention: two number tokens from the panel.
    hexes = hints_for(table, p1, 'invention')['targets']['hexes']
    board = table.me(p1)[1]['board']
    before_numbers = [board['numbers'][hexes[0]], board['numbers'][hexes[1]]]
    before = start_card(table, page, p1, 'invention')
    page.get_by_test_id(f'ck-invention-{hexes[0]}').click()
    page.get_by_test_id(f'ck-invention-{hexes[1]}').click()
    shot(page, f'progress-invention-choice-{CURRENT["renderer"]}', 'Invention: two number tokens chosen')
    page.get_by_test_id('ck-play-confirm').click()
    played(table, p1, 'invention', before)
    after = table.me(p1)[1]['board']['numbers']
    assert [after[hexes[0]], after[hexes[1]]] == before_numbers[::-1], (before_numbers, after)

    # Smithing and Road Building (a second hand: the hand limit is four).
    standard_fixture(table, p1, ['roadBuilding', 'smithing'])
    open_game(page, table.game_id, CURRENT['renderer'])
    knights = hints_for(table, p1, 'smithing')['targets']['vertices']
    before = start_card(table, page, p1, 'smithing')
    for vertex in knights[:2]:
        page.get_by_test_id(f'ck-smithing-{vertex}').click()
    page.get_by_test_id('ck-play-confirm').click()
    played(table, p1, 'smithing', before)
    levels = sorted(k['level'] for k in table.me(p1)[1]['modules']['citiesKnights']['knights'] if k['player'] == p1)
    assert levels == [2, 2], levels

    # Road Building: two free roads through the board.
    before = start_card(table, page, p1, 'roadBuilding')
    played(table, p1, 'roadBuilding', before)
    close_tool(page)
    for number in range(2):
        edge = table.me(p1)[1]['hints']['legalRoads'][0]
        ui_click_target(page, 'edge', edge)
        if number == 0:
            shot(page, f'progress-road-building-{CURRENT["renderer"]}', 'Road Building: free roads placed on board targets')
        ui_confirm(page)
    no_pending(table)

    # Board cards, then the rest of the decks.
    board_cards(table, p1, pages, CURRENT['renderer'], 'desktop', ['engineering', 'medicine'])
    return p2, p3, p4


def trade_pass(table, p1, pages):
    page = pages[0]
    p2, p3, p4 = standard_fixture(table, p1, ['commercialHarbor', 'guildDues', 'merchantFleet', 'resourceMonopoly'])
    open_game(page, table.game_id, CURRENT['renderer'])
    open_tool(page)
    hand_shot(page, f'progress-hand-trade-{CURRENT["renderer"]}', 'trade deck in hand')

    # Commercial Harbor: offers to p2 (must choose a commodity), p3 (one kind: automatic), p4 (none: returned).
    play_direct(table, page, p1, 'commercialHarbor')
    open_tool(page)
    harbor = page.get_by_test_id('ck-harbor')
    expect(harbor).to_be_visible()
    page.get_by_test_id('ck-harbor-resource-lumber').click()
    shot(page, f'progress-harbor-offers-{CURRENT["renderer"]}', 'Commercial Harbor: one offer to each other player')
    page.get_by_test_id(f'ck-harbor-offer-{p4}').click()
    page.wait_for_timeout(600)
    assert table.me(p4)[0]['resources']['lumber'] == 1, 'p4 has no commodity: the resource goes back'
    page.get_by_test_id(f'ck-harbor-offer-{p3}').click()
    page.wait_for_timeout(600)
    assert table.me(p3)[0]['commodities']['coin'] == 1, 'p3 holds one commodity kind: exchanged without a prompt'
    page.get_by_test_id(f'ck-harbor-offer-{p2}').click()
    p2_page = pages[table.identity.index(p2)]
    open_game(p2_page, table.game_id, CURRENT['renderer'])
    wait_prompt(p2_page, 'ck-harbor-answer')
    shot(p2_page, f'progress-harbor-answer-{CURRENT["renderer"]}', 'Commercial Harbor: the receiver chooses the commodity to give back')
    p2_page.get_by_test_id('ck-harbor-give-paper').click()
    no_pending(table)
    assert table.me(p2)[0]['commodities']['paper'] == 1 and table.me(p2)[0]['resources']['lumber'] == 3

    # Guild Dues: take two cards from the richer p2.
    before = start_card(table, page, p1, 'guildDues')
    shot(page, f'progress-guild-dues-target-{CURRENT["renderer"]}', 'Guild Dues: only players with more points are targets')
    page.get_by_test_id(f'ck-target-{p2}').click()
    wait_prompt(page, 'ck-guild-dues')
    played(table, p1, 'guildDues', before)
    close_tool(page)
    shot(page, f'progress-guild-dues-pick-{CURRENT["renderer"]}', 'Guild Dues: the cards of the chosen player, take any two')
    answer_picker(page, 'ck-guild-pick', ['wool', 'cloth'])
    no_pending(table)

    # Merchant Fleet and the monopolies.
    open_tool(page)
    before = start_card(table, page, p1, 'merchantFleet')
    page.get_by_test_id('ck-kind-wool').click()
    played(table, p1, 'merchantFleet', before)
    expect(page.get_by_test_id('ck-two-for-one')).to_be_visible()
    before = start_card(table, page, p1, 'resourceMonopoly')
    page.get_by_test_id('ck-kind-lumber').click()
    played(table, p1, 'resourceMonopoly', before)
    standard_fixture(table, p1, ['tradeMonopoly'])
    open_game(page, table.game_id, CURRENT['renderer'])
    coins = table.me(p1)[0]['commodities']['coin']
    givers = sum(1 for pid in (p2, p3, p4) if table.me(pid)[0]['commodities']['coin'] > 0)
    before = start_card(table, page, p1, 'tradeMonopoly')
    page.get_by_test_id('ck-kind-coin').click()
    played(table, p1, 'tradeMonopoly', before)
    assert table.me(p1)[0]['commodities']['coin'] == coins + givers, table.me(p1)[0]['commodities']
    board_cards(table, p1, pages, CURRENT['renderer'], 'desktop', ['merchant'])


def politics_pass(table, p1, pages):
    page = pages[0]
    p2, p3, p4 = standard_fixture(table, p1, ['encouragement', 'espionage', 'sabotage', 'wedding'])
    open_game(page, table.game_id, CURRENT['renderer'])
    open_tool(page)
    hand_shot(page, f'progress-hand-politics-{CURRENT["renderer"]}', 'politics deck in hand')
    play_direct(table, page, p1, 'encouragement')
    assert all(k['active'] for k in table.me(p1)[1]['modules']['citiesKnights']['knights'] if k['player'] == p1)

    # Espionage: the cards of p2 are shown to p1 only.
    before = start_card(table, page, p1, 'espionage')
    page.get_by_test_id(f'ck-target-{p2}').click()
    wait_prompt(page, 'ck-espionage')
    played(table, p1, 'espionage', before)
    close_tool(page)
    shot(page, f'progress-espionage-peek-{CURRENT["renderer"]}', 'Espionage: p2’s progress cards are visible to the player who played it')
    other_pages = [pages[table.identity.index(pid)] for pid in (p3, p4)]
    for other in other_pages:
        open_game(other, table.game_id, CURRENT['renderer'])
        expect(other.get_by_test_id('ck-espionage')).to_have_count(0)
    pending = table.snapshot(p3)['view']['pending']
    assert 'cards' not in (pending.get('data') or {}), pending
    page.get_by_test_id('ck-espionage-take-mining').click()
    no_pending(table)
    assert 'mining' in hand_of(table, p1)

    # Sabotage: p2, p3 and p4 have at least p1's points; each chooses their own discards.
    open_tool(page)
    before = start_card(table, page, p1, 'sabotage')
    played(table, p1, 'sabotage', before)
    close_tool(page)
    respond_picks(table, pages, 'sabotage', f'progress-sabotage-prompt-{CURRENT["renderer"]}', 'Sabotage: an affected player chooses the discards')
    no_pending(table)

    # Wedding: richer players give two cards (p2 and p3 lead).
    open_tool(page)
    before = start_card(table, page, p1, 'wedding')
    played(table, p1, 'wedding', before)
    close_tool(page)
    respond_picks(table, pages, 'wedding', f'progress-wedding-prompt-{CURRENT["renderer"]}', 'Wedding: a richer player chooses the cards to give')
    no_pending(table)
    board_cards(table, p1, pages, CURRENT['renderer'], 'desktop', ['taxation', 'treason', 'intrigue', 'diplomacy'])


def board_cards(table, p1, pages, renderer, viewport, which):
    try:
        board_cards_inner(table, p1, pages, renderer, viewport, which)
    except Exception:
        pages[0].screenshot(path=str(ckkit.OUT / f'failure-board-{renderer}-{viewport}.png'), timeout=60000)
        raise


def board_cards_inner(table, p1, pages, renderer, viewport, which):
    """Play board-target cards in `renderer` on `viewport` (the page of player 1 is replaced on phone)."""
    page = pages[0]
    hands = list(which)
    p2, p3, p4 = standard_fixture(table, p1, hands)
    CURRENT['renderer'] = renderer
    tag = f'{renderer}-{viewport}'
    open_game(page, table.game_id, renderer)
    open_tool(page)
    hand_name = f'progress-hand-board-{tag}'
    for card in which:
        expect(page.get_by_test_id(f'ck-card-{card}')).to_have_attribute('data-playable', 'true')
    if len(which) >= 4:
        hand_shot(page, hand_name, f'cards with a board target, {tag}', ms=2500 if renderer == 'r3f' else 700)
    close_tool(page)
    for card in which:
        if card == 'merchant':
            hex_ = hints_for(table, p1, card)['targets']['hexes'][0]
            play_target(table, page, p1, card, 'hex', hex_, f'progress-merchant-target-{tag}')
            assert table.me(p1)[1]['modules']['citiesKnights']['merchant'] == {'player': p1, 'hex': hex_}
            if renderer == 'svg':
                expect(page.get_by_test_id('merchant')).to_have_attribute('data-hex', str(hex_))
            shot(page, f'progress-merchant-placed-{tag}', 'the merchant on its hex with the owner’s colour', ms=2500 if renderer == 'r3f' else 700)
        elif card == 'taxation':
            hex_ = hints_for(table, p1, card)['targets']['hexes'][0]
            play_target(table, page, p1, card, 'hex', hex_, f'progress-taxation-target-{tag}')
        elif card in ('engineering', 'medicine'):
            vertex = hints_for(table, p1, card)['targets']['vertices'][0]
            play_target(table, page, p1, card, 'vertex', vertex, f'progress-{card}-target-{tag}')
        elif card == 'intrigue':
            vertex = hints_for(table, p1, card)['targets']['vertices'][0]
            play_target(table, page, p1, card, 'vertex', vertex, f'progress-intrigue-target-{tag}')
            pending = table.snapshot()['view']['pending']
            if pending is not None:
                victim_page = pages[table.identity.index(pending['responders'][0])]
                open_game(victim_page, table.game_id, renderer if viewport == 'desktop' else 'svg')
                wait_prompt(victim_page, 'ck-retreat')
                shot(victim_page, f'progress-intrigue-retreat-{tag}', 'Intrigue: the displaced knight’s owner chooses where it goes')
                victim_page.locator('[data-testid^="ck-retreat-"]').first.click()
                no_pending(table)
        elif card == 'diplomacy':
            own = [e for e in hints_for(table, p1, card)['targets']['edges'] if table.me(p1)[1]['board']['roads'][e]['player'] == p1]
            edge = (own or hints_for(table, p1, card)['targets']['edges'])[0]
            play_target(table, page, p1, card, 'edge', edge, f'progress-diplomacy-target-{tag}')
            pending = table.snapshot()['view']['pending']
            if pending is not None and pending['kind'] == 'citiesKnights.diplomacyRoad':
                wait_prompt(page, 'ck-diplomacy-road')
                targets = pending['data']['edges']
                ui_click_target(page, 'edge', targets[0])
                shot(page, f'progress-diplomacy-rebuild-{tag}', 'Diplomacy: the removed own road may be rebuilt for free')
                ui_confirm(page)
                no_pending(table)
        elif card == 'treason':
            before = start_card(table, page, p1, card)
            page.get_by_test_id(f'ck-target-{p2}').click()
            played(table, p1, card, before)
            close_tool(page)
            pending = table.snapshot()['view']['pending']
            if pending is not None and pending['kind'] == 'citiesKnights.treasonRemove':
                victim_page = pages[table.identity.index(p2)]
                open_game(victim_page, table.game_id, renderer if viewport == 'desktop' else 'svg')
                wait_prompt(victim_page, 'ck-treason-remove')
                shot(victim_page, f'progress-treason-remove-{tag}', 'Treason: the chosen player removes one of their knights')
                victim_page.locator('[data-testid^="ck-treason-remove-"]').first.click()
            for _ in range(40):
                pending = table.snapshot()['view']['pending']
                if pending is not None and pending['kind'] == 'citiesKnights.treasonPlace':
                    break
                page.wait_for_timeout(250)
            if pending is not None and pending['kind'] == 'citiesKnights.treasonPlace':
                wait_prompt(page, 'ck-treason-place')
                shot(page, f'progress-treason-place-{tag}', 'Treason: the player who played it places a knight of their own')
                if pending['data']['sites'] and pending['data']['levels']:
                    page.get_by_test_id(f"ck-treason-level-{pending['data']['levels'][0]}").click()
                    ui_click_target(page, 'vertex', pending['data']['sites'][0])
                    ui_confirm(page)
                else:
                    page.get_by_test_id('ck-treason-skip').click()
                no_pending(table)
        close_tool(page)
        page.wait_for_timeout(300)


def victory_cards_shown(table, p1, page):
    def fixture(state):
        ck_state(state)['progressVp'][p1] = ['printing', 'constitution']
    SERVER.patch_game(table.game_id, fixture)
    open_game(page, table.game_id, CURRENT['renderer'])
    open_tool(page)
    expect(page.get_by_test_id('ck-progress-vp')).to_be_visible()
    shot(page, 'progress-victory-cards-svg', 'Printing and Constitution are revealed when drawn and score at once')
    close_tool(page)


def merchant_rate(table, p1):
    """The controller trades the merchant hex's resource 2:1 (checked on the hints)."""
    view = table.me(p1)[1]
    merchant = view['modules']['citiesKnights']['merchant']
    if merchant is None:
        return
    log('MERCHANT', merchant, ck_hints(view)['twoForOne'])


# ------------------------------------------------------------------------- main

def main():
    ckkit.init(sys.argv)
    SERVER.start()
    try:
        run()
    finally:
        SERVER.stop()


def run():
    names = ['騎士團長', 'Mira', '阿卡', 'Jonas']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        contexts, pages, identity, game_id = start_ck_game(browser, 4, names, 'ck-2025')
        table = Table(contexts, pages, identity, game_id)
        p1 = identity[0]
        try:
            complete_setup(table)
            log('SETUP DONE')
            stages = os.environ.get('CK_STAGES', 'alchemy,science,trade,politics,victory,svg,r3f,phone').split(',')
            # Passes 1 and 2: every card in SVG, then in 3D, on the desktop. Alchemy is the first card of
            # each pass, in player 1's roll phase; the fillers between the passes run over the API.
            for renderer in [r for r in ('svg', 'r3f') if r in stages]:
                CURRENT['renderer'] = renderer
                if renderer == 'r3f':
                    play_until(table, lambda view: view['turn']['playerId'] == p1 and view['turn']['phase'] == 'preroll'
                               and view['pending'] is None, lambda view: False)
                if 'alchemy' in stages:
                    alchemy_before_roll(table, p1, pages[0])
                reach_action(table, p1)
                if 'science' in stages:
                    science_pass(table, p1, pages)
                if 'trade' in stages:
                    trade_pass(table, p1, pages)
                if 'politics' in stages:
                    politics_pass(table, p1, pages)
                if 'victory' in stages:
                    victory_cards_shown(table, p1, pages[0])
            ckkit.REPORT['pass-1'] = dict(PLAYED)
            # Passes 3 and 4: a phone, SVG and 3D.
            if 'phone' in stages:
                phone, phone_page = phone_context(browser, contexts[0])
                phone_pages = [phone_page] + pages[1:]
                for renderer in ('svg', 'r3f'):
                    board_cards(table, p1, phone_pages, renderer, 'phone', ['merchant', 'engineering', 'treason', 'diplomacy'])
                phone.close()
        except Exception:
            for index, seat_page in enumerate(pages):
                try:
                    seat_page.screenshot(path=str(ckkit.OUT / f'failure-seat{index}.png'), timeout=30000)
                except Exception as error:  # a crashed page must not hide the original failure
                    log('NO FAILURE SCREENSHOT', index, error)
            raise
        finally:
            ckkit.REPORT['played'] = dict(PLAYED)
        if 'CK_STAGES' not in os.environ:
            # Every playable card, in both renderers on the desktop (the phone covers the board-target cards).
            for renderer in ('svg', 'r3f'):
                missing = [card for card in ALL_CARDS if card not in PLAYED_BY.get(renderer, {})]
                assert not missing, f'not played through the UI in {renderer}: {missing}'
        for context in contexts:
            context.close()
        browser.close()

    ckkit.REPORT['played-by-renderer'] = PLAYED_BY
    ckkit.REPORT['errors'] = ERRORS
    (ckkit.OUT / 'report.json').write_text(json.dumps(ckkit.REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
    log('PLAYED', len(PLAYED), 'cards;', 'CASES', len(ckkit.REPORT['cases']), 'ERRORS', len(ERRORS))
    if ERRORS:
        sys.exit(1)


if __name__ == '__main__':
    main()
