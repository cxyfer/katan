#!/usr/bin/env python3
"""Action rail captures: the grouped collapsed dock and the expanded cards.

Usage (``pnpm build`` first; the output directory must be new and empty):

  CK_PORT=3034 python3 scripts/action-rail/capture.py <new-empty-output-dir>

For the base game, Cities & Knights and Seafarers + Cities & Knights, a real
4-player game is set up over the API until player 1's action phase. A
test-only fixture then fills player 1's hand so that most actions are
available. Each table is captured with the rail collapsed and expanded, on
desktop (1366x768), phone (390x844) and a phone held sideways (844x390,
touch, the compact-landscape layout),
plus English on desktop and one capture from another seat (not their turn,
one shared reason). File names end in ``-<width>x<height>-<locale>``.
"""
import json
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'cities-knights'))
import ckkit  # noqa: E402
from ckkit import ERRORS, SERVER, Table, api, complete_setup, log, new_player, resolve_pending, settle, snap  # noqa: E402

VIEWPORTS = {'desktop': {'width': 1366, 'height': 768}, 'phone': {'width': 390, 'height': 844},
             'landscape': {'width': 844, 'height': 390}}
PROFILES = [(slug, profile) for slug, profile in [('base', 'base-2025'), ('ck', 'ck-2025'), ('sfck', 'sf-ck-new-shores-2025')]
            if not __import__('os').environ.get('RAIL_ONLY') or slug in __import__('os').environ['RAIL_ONLY'].split(',')]


def start_game(browser, profile):
    players = [new_player(browser, name) for name in ['Alex', 'Mira', '阿卡', 'Jonas']]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    room = api(contexts[0], 'POST', '/api/rooms', {'visibility': 'private', 'capacity': 4, 'profileId': profile, 'setupMode': 'fixed'})
    for context in contexts[1:]:
        api(context, 'POST', '/api/rooms/join', {'code': room['code']})
    for context in contexts:
        api(context, 'POST', f"/api/rooms/{room['id']}/ready", {'ready': True})
    game_id = api(contexts[0], 'POST', f"/api/rooms/{room['id']}/start")['gameId']
    identity = [api(context, 'GET', '/api/session')['player']['id'] for context in contexts]
    return Table(contexts, pages, identity, game_id)


def until_p1_action(table):
    p1 = table.identity[0]
    for _ in range(3000):
        snapshot = table.snapshot()
        view = snapshot['view']
        if view['turn']['playerId'] == p1 and view['turn']['phase'] == 'action' and view['pending'] is None:
            return
        if view['pending'] is not None:
            resolve_pending(table, view, snapshot['revision'])
            continue
        actor = view['turn']['playerId']
        mine = table.snapshot(actor)['view']
        if mine['hints']['canRoll']:
            assert table.act(actor, {'type': 'turn.roll'})
            continue
        ck = (mine['hints'].get('modules') or {}).get('citiesKnights')
        if ck and ck['progressExcess'] > 0:
            player = next(p for p in mine['players'] if p['id'] == actor)
            assert table.act(actor, {'type': 'progress.discard', 'cards': player['progressCards'][:ck['progressExcess']]})
            continue
        assert table.act(actor, {'type': 'turn.end'})
    raise AssertionError('player 1 action phase not reached')


def fill_hand(table):
    p1 = table.identity[0]

    def fixture(state):
        player = next(p for p in state['players'] if p['id'] == p1)
        for card in ('lumber', 'brick', 'wool', 'grain', 'ore'):
            moved = min(4, state['bank'][card])
            state['bank'][card] -= moved
            player['resources'][card] += moved
    SERVER.patch_game(table.game_id, fixture)


def open_table(browser, table, seat, viewport):
    source = table.contexts[seat]
    context = browser.new_context(storage_state=source.storage_state(), viewport=VIEWPORTS[viewport], locale='zh-TW',
                                  reduced_motion='reduce', service_workers='block',
                                  is_mobile=viewport != 'desktop', has_touch=viewport != 'desktop')
    page = context.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'{viewport}: {error}'))
    page.set_default_timeout(45000)
    page.goto(f'{ckkit.BASE}/?renderer=svg', timeout=90000)
    resume = page.get_by_test_id(f'resume-{table.game_id}')
    resume.wait_for(state='attached')
    if not resume.is_visible():
        page.locator('#home-tab-resume').click()
    resume.click()
    ckkit.wait_renderer(page, 'svg')
    expect(page.get_by_test_id('action-rail')).to_be_visible()
    return context, page


def capture(page, name, note, locale='zh-Hant'):
    size = page.viewport_size
    name = f"{name}-{size['width']}x{size['height']}-{locale}"
    settle(page, 600)
    path = ckkit.OUT / f'{name}.png'
    page.screenshot(path=str(path), animations='disabled')
    rail = page.get_by_test_id('action-rail')
    box = rail.bounding_box()
    metrics = rail.evaluate("""(rail) => {
      const content = rail.querySelector('.action-rail__content');
      const tile = rail.querySelector('[data-group="build"] li:nth-child(2) .action-list__button');
      return { expanded: rail.dataset.expanded, scroll: content.scrollHeight, client: content.clientHeight,
               overflowX: content.scrollWidth > content.clientWidth, contentWidth: content.clientWidth,
               tileRight: tile ? Math.round(tile.getBoundingClientRect().right - content.getBoundingClientRect().right) : null,
               tileWidth: tile ? Math.round(tile.getBoundingClientRect().width) : null,
               visible: [...rail.querySelectorAll('li[data-action]')].filter((li) => li.checkVisibility()).length };
    }""")
    ckkit.REPORT['cases'].append({'name': name, 'note': note, 'rail': box, **metrics})
    log('CAPTURE', name, json.dumps(metrics), box)


def expand(page, viewport):
    toggle = page.get_by_test_id('action-rail-toggle')
    if viewport != 'desktop':
        toggle.tap()
    else:
        toggle.click()
    expect(page.get_by_test_id('action-rail')).to_have_attribute('data-expanded', 'true')


def main():
    ckkit.init(sys.argv)
    SERVER.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
            for slug, profile in PROFILES:
                table = start_game(browser, profile)
                complete_setup(table)
                until_p1_action(table)
                fill_hand(table)
                for viewport in VIEWPORTS:
                    context, page = open_table(browser, table, 0, viewport)
                    capture(page, f'{slug}-collapsed', f'{profile}: own action phase, rail collapsed')
                    expand(page, viewport)
                    capture(page, f'{slug}-expanded', f'{profile}: own action phase, rail expanded')
                    context.close()
                # 英文標籤較長，在桌機展開檢查換行。
                context, page = open_table(browser, table, 0, 'desktop')
                page.get_by_test_id('locale-switch-game').select_option('en')
                expect(page.get_by_test_id('action-rail')).to_have_attribute('aria-label', 'Actions')
                expand(page, 'desktop')
                capture(page, f'{slug}-expanded', f'{profile}: own action phase, rail expanded, English', 'en')
                page.get_by_test_id('locale-switch-game').select_option('zh-Hant')
                expect(page.get_by_test_id('action-rail')).to_have_attribute('aria-label', '行動')
                page.wait_for_timeout(500)
                context.close()
                context, page = open_table(browser, table, 1, 'desktop')
                capture(page, f'{slug}-waiting-collapsed', f'{profile}: another seat, rail collapsed')
                expand(page, 'desktop')
                capture(page, f'{slug}-waiting-expanded', f'{profile}: another seat, one shared reason')
                context.close()
                for context in table.contexts:
                    context.close()
            browser.close()
    finally:
        SERVER.stop()
    ckkit.REPORT['errors'] = ERRORS
    (ckkit.OUT / 'report.json').write_text(json.dumps(ckkit.REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
    log('CASES', len(ckkit.REPORT['cases']), 'ERRORS', len(ERRORS))
    if ERRORS:
        sys.exit(1)


if __name__ == '__main__':
    main()
