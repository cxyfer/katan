#!/usr/bin/env python3
"""Plays every enabled Traders & Barbarians profile's own action through the UI.

Usage (``pnpm build`` first; the output directory must be new and empty):

  TB_PORT_BASE=3052 python3 scripts/traders-barbarians/live.py <new-empty-output-dir> [profile-id ...]

For each enabled T&B profile and each renderer (SVG and 3D) the harness

1. starts the built service (``packages/server/dist/server.mjs``) on its own
   port and private SQLite file (ports ``TB_PORT_BASE`` … ``+7``);
2. creates a real room with three guest sessions over the API, starts it and
   plays the whole setup over the API with legal placements;
3. applies one test-only fixture patch to the persisted snapshot while the
   service is stopped (``patch.mjs``: the engine-computed situation the
   profile's action needs, e.g. a fish hand, a river bridge site, a wagon
   beside the quarry) and restarts the service;
4. opens the game as the acting player in the browser and performs the
   profile's scenario action **through the UI only** (panel buttons, prompt
   choices, board target buttons and the confirm bar), capturing the steps;
5. asserts the result against the service's own projection of the game.

Profile actions: Friendly Robber — move the robber past guarded hexes;
Harbors — upgrade a port settlement and take Strongest Ports; combined —
rob a player whose Strongest Ports lifted their protection; Fishing — spend
fish; Rivers — build a bridge; Merchant Trains — end the turn, bid, place the
wagon; Barbarian Attack — build a card (Capture), then move a knight;
Traders & Barbarians — end the turn and deliver a commodity with the wagon.
``report.json`` lists every case with its sha256.
"""
from __future__ import annotations

import hashlib
import json
import os
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT_BASE = int(os.environ.get('TB_PORT_BASE', '3052'))
DESKTOP = {'width': 1366, 'height': 900}
PROFILES = [
    'tb-friendly-robber-2025', 'tb-harbors-2025', 'tb-friendly-robber-harbors-2025', 'tb-fishing-2025',
    'tb-rivers-2025', 'tb-merchant-trains-2025', 'tb-barbarian-attack-2025', 'tb-traders-barbarians-2025',
]
RENDERERS = ('svg', 'r3f')
REPORT: dict = {'cases': [], 'errors': []}
OUT: Path


def log(*parts):
    print(*parts, flush=True)


class Server:
    """The built service on a private SQLite file, restartable for one fixture patch."""

    def __init__(self, port):
        self.port = port
        self.base = f'http://127.0.0.1:{port}'
        self.data = Path(tempfile.mkdtemp(prefix='katan-tb-live-'))
        self.sqlite = self.data / 'live.sqlite'
        self.child = None

    def start(self):
        env = {**os.environ, 'PORT': str(self.port), 'HOST': '127.0.0.1', 'SQLITE_PATH': str(self.sqlite),
               'WEB_DIST_PATH': str(ROOT / 'packages/web/dist'), 'LOG_LEVEL': 'warn'}
        self.child = subprocess.Popen(['node', str(ROOT / 'packages/server/dist/server.mjs')], cwd=ROOT, env=env,
                                      stdout=open(self.data / 'server.log', 'ab'), stderr=subprocess.STDOUT)
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f'{self.base}/healthz', timeout=1) as response:
                    if response.status == 200:
                        return
            except OSError:
                time.sleep(0.2)
        raise AssertionError('service did not become healthy')

    def stop(self):
        if self.child and self.child.poll() is None:
            self.child.send_signal(signal.SIGTERM)
            self.child.wait(timeout=20)
        self.child = None

    def patch_game(self, game_id, profile_id, actor):
        """Test-only fixture: move the persisted snapshot into the profile's situation."""
        self.stop()
        with sqlite3.connect(self.sqlite) as db:
            (raw,) = db.execute('SELECT state_json FROM games WHERE id = ?', (game_id,)).fetchone()
            result = subprocess.run(
                ['node', '--experimental-strip-types', str(ROOT / 'scripts/traders-barbarians/patch.mjs')],
                input=json.dumps({'profileId': profile_id, 'state': json.loads(raw), 'actor': actor}),
                check=True, capture_output=True, text=True, cwd=ROOT)
            patched = json.loads(result.stdout)
            db.execute('UPDATE games SET state_json = ? WHERE id = ?', (json.dumps(patched['state']), game_id))
        self.start()
        return patched['info']


class Table:
    def __init__(self, server, contexts, game_id):
        self.server = server
        self.contexts = contexts  # [(context, player id)]
        self.by_id = {pid: context for context, pid in contexts}
        self.game_id = game_id

    def get(self, player=None):
        context = self.by_id[player] if player else self.contexts[0][0]
        return api(context, self.server.base, 'GET', f'/api/games/{self.game_id}')

    def view(self, player=None):
        return self.get(player)['view']

    def send(self, player, command):
        snapshot = self.get(player)
        response = self.by_id[player].request.post(f'{self.server.base}/api/games/{self.game_id}/commands', data={
            'commandId': str(uuid.uuid4()), 'expectedRevision': snapshot['revision'], 'command': command})
        payload = response.json()
        assert payload.get('ok') and payload['data']['outcome'] == 'accepted', (command, payload)


def api(context, base, method, path, data=None):
    response = context.request.fetch(base + path, method=method, data=data)
    payload = response.json()
    assert payload.get('ok'), (path, response.status, payload)
    return payload['data']


def create_game(browser, server, profile_id, players=3):
    contexts = []
    for index in range(players):
        context = browser.new_context(base_url=server.base, viewport=DESKTOP, locale='en-US', reduced_motion='reduce',
                                      service_workers='block')
        context.add_init_script("localStorage.setItem('catan.locale', 'en');")
        player = api(context, server.base, 'POST', '/api/session', {'nickname': f'Live {index + 1}', 'locale': 'en'})['player']
        contexts.append((context, player['id']))
    host = contexts[0][0]
    room = api(host, server.base, 'POST', '/api/rooms', {
        'visibility': 'private', 'capacity': players, 'profileId': profile_id, 'setupMode': 'variable'})
    for context, _ in contexts[1:]:
        api(context, server.base, 'POST', '/api/rooms/join', {'code': room['code']})
    for context, _ in contexts:
        api(context, server.base, 'POST', f"/api/rooms/{room['id']}/ready", {'ready': True})
    game_id = api(host, server.base, 'POST', f"/api/rooms/{room['id']}/start")['gameId']
    table = Table(server, contexts, game_id)
    for _ in range(60):
        view = table.view()
        if view['turn']['phase'] != 'setup':
            break
        actor = view['turn']['playerId']
        hints = table.view(actor)['hints']
        if view['turn']['setup']['stage'] == 'road':
            table.send(actor, {'type': 'setup.placeRoad', 'edge': hints['legalRoads'][len(hints['legalRoads']) // 2]})
        else:
            table.send(actor, {'type': 'setup.placeBuilding', 'vertex': hints['legalSettlements'][len(hints['legalSettlements']) // 3]})
    assert table.view()['turn']['phase'] == 'preroll', 'setup did not finish'
    return table


# ------------------------------------------------------------------------------ UI

def settle(page, ms=700):
    page.mouse.move(1, 1)
    page.wait_for_timeout(ms)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


def shot(page, name, note=''):
    settle(page)
    path = OUT / f'{name}.png'
    page.screenshot(path=str(path), animations='disabled')
    REPORT['cases'].append({'name': name, 'status': 'PASS', 'note': note,
                            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    log('CAPTURE', name, note)


def open_game(page, base, game_id, renderer):
    page.goto(f'{base}/?renderer={renderer}')
    resume = page.get_by_test_id(f'resume-{game_id}')
    resume.wait_for(state='attached')
    if not resume.is_visible():
        page.locator('#home-tab-resume').click()
    resume.click()
    page.wait_for_function(
        "(renderer) => document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === renderer",
        arg=renderer, timeout=40000)
    if renderer == 'r3f':
        page.wait_for_function(
            "() => document.querySelector('[data-testid=\"board\"]')?.dataset.rendererStatus === 'ready'", timeout=40000)


def open_actions(page):
    rail = page.get_by_test_id('action-rail-toggle')
    if rail.count() and rail.get_attribute('aria-expanded') != 'true':
        rail.click()


def open_scenario(page):
    page.get_by_test_id('tool-tab-scenario').click()
    page.get_by_test_id('tb-panel').wait_for()


def click_target(page, kind, index):
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached()
    target.click(force=True)
    expect(page.get_by_test_id('confirm-selection')).to_be_visible()


def confirm(page):
    page.get_by_test_id('confirm-selection').click()
    page.wait_for_timeout(700)


def wait_pending(page, kind):
    page.wait_for_function(
        "(kind) => document.querySelector('[data-testid=\"required-action-prompt\"]') !== null || kind === null", arg=kind)


def mine(table, actor):
    return next(p for p in table.view(actor)['players'] if p['id'] == actor)


def tb(table, actor):
    return table.view(actor)['modules']['tradersBarbarians']


# ----------------------------------------------------------------------- the actions

def act_friendly_robber(page, table, actor, info, renderer, combined):
    view = table.view(actor)
    assert view['pending']['kind'] == 'moveRobber', view['pending']
    # Guarded hexes are never offered; free ones are.
    expect(page.get_by_test_id('board-target-overlay')).to_be_attached()
    assert info['guarded'] is not None and info['free'] is not None, info
    expect(page.get_by_test_id(f"target-hex-{info['guarded']}")).to_have_count(0)
    expect(page.get_by_test_id(f"target-hex-{info['free']}")).to_be_attached()
    shot(page, f'{view["profileId"]}-{renderer}-robber-targets', 'moveRobber: guarded hexes carry no target')
    if combined:
        # The rival's Strongest Ports tile lifts its protection: its hex is offered and the steal follows.
        expect(page.get_by_test_id(f"target-hex-{info['rivalHex']}")).to_be_attached()
        click_target(page, 'hex', info['rivalHex'])
        shot(page, f'{view["profileId"]}-{renderer}-robber-preview', 'robber preview on the unprotected rival hex')
        confirm(page)
        expect(page.get_by_test_id(f"steal-{info['rival']}")).to_be_visible()
        page.get_by_test_id(f"steal-{info['rival']}").click()
        page.wait_for_timeout(700)
        after = table.view(actor)
        assert after['board']['robber'] == info['rivalHex'], after['board']['robber']
        assert mine(table, actor)['resources']['ore'] == 1, mine(table, actor)['resources']
        return
    click_target(page, 'hex', info['free'])
    shot(page, f'{view["profileId"]}-{renderer}-robber-preview', 'robber preview on an unguarded hex')
    confirm(page)
    assert table.view(actor)['board']['robber'] == info['free']


def act_harbors(page, table, actor, info, renderer):
    open_actions(page)
    page.get_by_test_id('action-build.city').click()
    click_target(page, 'vertex', info['upgrade'])
    shot(page, f'tb-harbors-2025-{renderer}-upgrade-preview', 'harbour city upgrade preview')
    confirm(page)
    holder = tb(table, actor)['harbors']['holder']
    assert holder == actor, holder
    open_scenario(page)
    expect(page.get_by_test_id('tb-harbors-holder')).to_be_visible()
    shot(page, f'tb-harbors-2025-{renderer}-strongest-ports', 'Strongest Ports awarded after the upgrade')


def act_fishing(page, table, actor, info, renderer):
    open_scenario(page)
    page.get_by_test_id('tb-fish-action-takeResource').click()
    page.get_by_test_id('tb-fish-resource').select_option('ore')
    shot(page, f'tb-fishing-2025-{renderer}-spend', 'fish action: take a resource (4 fish)')
    page.get_by_test_id('tb-fish-submit').click()
    page.wait_for_timeout(700)
    assert mine(table, actor)['resources']['ore'] == 1, mine(table, actor)['resources']
    assert tb(table, actor)['tb-fishing']['mine'] == [], tb(table, actor)['tb-fishing']['mine']


def act_rivers(page, table, actor, info, renderer):
    before = tb(table, actor)['tb-coins']['gold'][actor]
    open_scenario(page)
    page.get_by_test_id('tb-build-bridge').click()
    click_target(page, 'edge', info['site'])
    shot(page, f'tb-rivers-2025-{renderer}-bridge-preview', 'bridge preview on a river site')
    confirm(page)
    view = table.view(actor)
    assert view['board']['roads'][info['site']].get('bridge'), view['board']['roads'][info['site']]
    assert tb(table, actor)['tb-coins']['gold'][actor] == before + 3, (before, tb(table, actor)['tb-coins']['gold'])


def act_trains(page, table, actor, info, renderer):
    page.get_by_test_id('prompt-end-turn').click() if page.get_by_test_id('prompt-end-turn').count() else (
        open_actions(page), page.get_by_test_id('action-endTurn').click())
    page.get_by_test_id('tb-wagon-bid').wait_for()
    shot(page, f'tb-merchant-trains-2025-{renderer}-bid', 'voting round: bid prompt')
    page.get_by_test_id('tb-bid-pass').click()
    page.wait_for_timeout(500)
    for pid in [p['id'] for p in table.view(actor)['players'] if p['id'] != actor]:
        table.send(pid, {'type': 'tb.bidWagon', 'wool': 0, 'grain': 0})
    page.wait_for_timeout(800)
    view = table.view(actor)
    assert view['pending']['kind'] == 'tradersBarbarians.wagonPlace', view['pending']
    edge = info['starts'][0]
    click_target(page, 'edge', edge)
    shot(page, f'tb-merchant-trains-2025-{renderer}-place-preview', 'wagon placement preview')
    confirm(page)
    wagons = tb(table, actor)['tb-merchant-trains']['wagons']
    assert [w['edge'] for w in wagons] == [edge], wagons


def act_barbarians(page, table, actor, info, renderer):
    open_scenario(page)
    page.get_by_test_id('tb-ba-build').click()
    page.wait_for_timeout(700)
    assert table.view(actor)['pending']['kind'] == 'tradersBarbarians.baCapture', table.view(actor)['pending']
    click_target(page, 'hex', info['hex'])
    shot(page, f'tb-barbarian-attack-2025-{renderer}-capture-preview', 'Capture: choose a coastal hex')
    confirm(page)
    assert tb(table, actor)['tb-barbarian-attack']['prisoners'][actor] == 1
    # End of turn: the castle knight must move.
    page.get_by_test_id('prompt-end-turn').click() if page.get_by_test_id('prompt-end-turn').count() else (
        open_actions(page), page.get_by_test_id('action-endTurn').click())
    page.get_by_test_id('tb-knight-moves').wait_for()
    page.get_by_test_id(f"tb-knight-move-{info['knight']}").click()
    targets = page.locator('button[data-testid^="target-edge-"]')
    expect(targets.first).to_be_attached()
    target = targets.first.get_attribute('data-testid').rsplit('-', 1)[1]
    click_target(page, 'edge', int(target))
    shot(page, f'tb-barbarian-attack-2025-{renderer}-knight-preview', 'knight move preview')
    confirm(page)
    knights = tb(table, actor)['tb-barbarian-attack']['knights']
    assert knights[0]['edge'] == int(target), knights
    page.get_by_test_id('tb-knights-done').click()
    page.wait_for_timeout(900)
    assert table.view(actor)['turn']['playerId'] != actor, 'turn did not pass'


def act_traders(page, table, actor, info, renderer):
    page.get_by_test_id('prompt-end-turn').click() if page.get_by_test_id('prompt-end-turn').count() else (
        open_actions(page), page.get_by_test_id('action-endTurn').click())
    page.get_by_test_id('tb-wagon-move').wait_for()
    shot(page, f'tb-traders-barbarians-2025-{renderer}-wagon-move', 'end-of-turn wagon move')
    click_target(page, 'vertex', info['plaza'])
    shot(page, f'tb-traders-barbarians-2025-{renderer}-wagon-preview', 'wagon step onto the quarry plaza')
    confirm(page)
    wagon = tb(table, actor)['tb-traders-barbarians']['wagons'][actor]
    assert wagon['delivered'] == 1, wagon


ACTIONS = {
    'tb-friendly-robber-2025': lambda *a: act_friendly_robber(*a, combined=False),
    'tb-friendly-robber-harbors-2025': lambda *a: act_friendly_robber(*a, combined=True),
    'tb-harbors-2025': act_harbors,
    'tb-fishing-2025': act_fishing,
    'tb-rivers-2025': act_rivers,
    'tb-merchant-trains-2025': act_trains,
    'tb-barbarian-attack-2025': act_barbarians,
    'tb-traders-barbarians-2025': act_traders,
}


def run_case(browser, port_index, profile_id, renderer):
    server = Server(PORT_BASE + port_index)
    name = f'{profile_id}-{renderer}'
    case = {'name': f'{name}-live', 'kind': 'live', 'status': 'FAIL', 'port': server.port}
    REPORT['cases'].append(case)
    table = None
    server.start()
    page = None
    try:
        table = create_game(browser, server, profile_id)
        actor = table.view()['turn']['playerId']
        info = server.patch_game(table.game_id, profile_id, actor)
        case['info'] = info
        context = table.by_id[actor]
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(20000)
        open_game(page, server.base, table.game_id, renderer)
        ACTIONS[profile_id](page, table, actor, info, renderer)
        shot(page, f'{name}-after', 'final state after the UI action')
        assert not errors, errors
        case['status'] = 'PASS'
        # The captures above replace the generic case entry's own sha.
    except Exception as error:  # noqa: BLE001 - recorded and re-raised through the summary
        case['error'] = f'{type(error).__name__}: {error}'
        REPORT['errors'].append(f'{name}: {case["error"]}')
        if page is not None:
            page.screenshot(path=str(OUT / f'{name}-failure.png'))
    finally:
        if table:
            for context, _ in table.contexts:
                context.close()
        server.stop()


def main():
    global OUT
    if len(sys.argv) < 2:
        sys.exit('usage: live.py <new empty output directory> [profile-id ...]')
    OUT = Path(sys.argv[1])
    if OUT.exists() and any(OUT.iterdir()):
        sys.exit(f'output directory must be empty: {OUT}')
    OUT.mkdir(parents=True, exist_ok=True)
    chosen = sys.argv[2:] or PROFILES
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for index, profile_id in enumerate(PROFILES):
            if profile_id not in chosen:
                continue
            for renderer in RENDERERS:
                run_case(browser, index, profile_id, renderer)
        browser.close()
    (OUT / 'report.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
    failed = [case['name'] for case in REPORT['cases'] if case['status'] == 'FAIL']
    log('CASES', len(REPORT['cases']), 'FAILED', failed)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
