"""Shared helpers of the Cities & Knights browser harnesses (``capture.py``, ``progress.py``).

``init(out_dir)`` reads ``CK_PORT`` (default 3032), checks that the output
directory is new and empty, and sets the module globals the helpers use. The
service is the built bundle on a private SQLite file; rooms are created through
the lobby (the profiles are enabled) and ``Server.patch_game`` is the only
test-only fixture path.
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

from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[2]
PORT = 3032
BASE = ''
OUT: Path = Path('.')
REPORT: dict = {}
ERRORS: list[str] = []


def init(argv):
    global PORT, BASE, OUT, REPORT
    PORT = int(os.environ.get('CK_PORT', '3032'))
    BASE = f'http://127.0.0.1:{PORT}'
    if len(argv) != 2:
        sys.exit(f'usage: {argv[0]} <new empty output directory>')
    OUT = Path(argv[1])
    if OUT.exists() and any(OUT.iterdir()):
        sys.exit(f'output directory must be empty: {OUT}')
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT = {'base': BASE, 'cases': []}


RESOURCES = ['lumber', 'brick', 'wool', 'grain', 'ore']
COMMODITIES = ['paper', 'cloth', 'coin']
DESKTOP = {'width': 1366, 'height': 900}
PHONE = {'width': 390, 'height': 844}
def log(*parts):
    print(*parts, flush=True)


# ------------------------------------------------------------------------ server

class Server:
    """The built service on a private SQLite file, restartable for fixture patches."""

    def __init__(self):
        self.data = Path(tempfile.mkdtemp(prefix='katan-ck-'))
        self.sqlite = self.data / 'ck.sqlite'
        self.child = None

    def start(self):
        env = {**os.environ, 'PORT': str(PORT), 'HOST': '127.0.0.1', 'SQLITE_PATH': str(self.sqlite),
               'WEB_DIST_PATH': str(ROOT / 'packages/web/dist'), 'LOG_LEVEL': 'warn'}
        self.child = subprocess.Popen(['node', str(ROOT / 'packages/server/dist/server.mjs')], cwd=ROOT, env=env,
                                      stdout=open(self.data / 'server.log', 'ab'), stderr=subprocess.STDOUT)
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f'{BASE}/healthz', timeout=1) as response:
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

    def patch_game(self, game_id, mutate):
        """Test-only fixture: edit the persisted snapshot while the service is down."""
        self.stop()
        with sqlite3.connect(self.sqlite) as db:
            (raw,) = db.execute('SELECT state_json FROM games WHERE id = ?', (game_id,)).fetchone()
            state = json.loads(raw)
            mutate(state)
            db.execute('UPDATE games SET state_json = ? WHERE id = ?', (json.dumps(state), game_id))
        self.start()


SERVER = Server()


# --------------------------------------------------------------------------- API

def api(context, method, path, data=None):
    response = context.request.fetch(BASE + path, method=method, data=data)
    payload = response.json()
    assert payload.get('ok'), (path, response.status, payload)
    return payload['data']


def snap(context, path):
    return api(context, 'GET', path)


def send(context, game_id, revision, command):
    response = context.request.post(f'{BASE}/api/games/{game_id}/commands', data={
        'commandId': str(uuid.uuid4()), 'expectedRevision': revision, 'command': command})
    payload = response.json()
    accepted = bool(payload.get('ok')) and payload['data']['outcome'] == 'accepted'
    if not accepted and os.environ.get('CK_DEBUG'):
        log('REJECTED', command, payload)
    return accepted


# ------------------------------------------------------------------------ capture

def settle(page, ms=700):
    page.mouse.move(1, 1)
    page.wait_for_timeout(ms)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


def shot(page, name, note='', ms=700):
    settle(page, ms)
    path = OUT / f'{name}.png'
    page.screenshot(path=str(path), animations='disabled')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    REPORT['cases'].append({'name': name, 'status': 'PASS', 'note': note, 'sha256': digest,
                            'viewport': page.viewport_size})
    log('CAPTURE', name, note)


def wait_renderer(page, renderer):
    page.wait_for_function(
        "(renderer) => document.querySelector('[data-testid=\"board\"]')?.dataset.effectiveRenderer === renderer",
        arg=renderer, timeout=30000)
    if renderer == 'r3f':
        page.wait_for_function(
            "() => document.querySelector('[data-testid=\"board\"]')?.dataset.rendererStatus === 'ready'", timeout=30000)


def open_game(page, game_id, renderer):
    page.goto(f'{BASE}/?renderer={renderer}')
    resume = page.get_by_test_id(f'resume-{game_id}')
    resume.wait_for(state='attached')
    if not resume.is_visible():
        page.locator('#home-tab-resume').click()
    resume.click()
    wait_renderer(page, renderer)


def new_player(browser, name, viewport=DESKTOP):
    context = browser.new_context(viewport=viewport, locale='zh-TW', reduced_motion='reduce', service_workers='block')
    page = context.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'{name}: {error}'))
    page.set_default_timeout(20000)
    page.goto(BASE)
    page.get_by_test_id('nickname-input').fill(name)
    page.locator('form button[type=submit]').click()
    expect(page.get_by_test_id('create-room')).to_be_visible()
    return context, page


def start_ck_game(browser, count, names, ck_profile):
    players = [new_player(browser, name) for name in names[:count]]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = contexts[0]
    room = api(host, 'POST', '/api/rooms', {'visibility': 'private', 'capacity': count, 'profileId': ck_profile, 'setupMode': 'fixed'})
    for context in contexts[1:]:
        api(context, 'POST', '/api/rooms/join', {'code': room['code']})
    for context in contexts:
        api(context, 'POST', f"/api/rooms/{room['id']}/ready", {'ready': True})
    game_id = api(host, 'POST', f"/api/rooms/{room['id']}/start")['gameId']
    identity = [api(context, 'GET', '/api/session')['player']['id'] for context in contexts]
    view = snap(host, f'/api/games/{game_id}')['view']
    assert view['engineVersion'].startswith('ck-'), view['engineVersion']
    assert view['victoryTarget'] == 13, view['victoryTarget']
    return contexts, pages, identity, game_id


def phone_context(browser, context):
    phone = browser.new_context(storage_state=context.storage_state(), viewport=PHONE, locale='zh-TW',
                                reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
    page = phone.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
    page.set_default_timeout(20000)
    return phone, page


# --------------------------------------------------------------------------- bot

class Table:
    def __init__(self, contexts, pages, identity, game_id):
        self.contexts = contexts
        self.pages = pages
        self.identity = identity
        self.by_id = dict(zip(identity, contexts))
        self.page_of = dict(zip(identity, pages))
        self.game_id = game_id
        self.path = f'/api/games/{game_id}'

    def snapshot(self, player=None):
        return snap(self.by_id[player] if player else self.contexts[0], self.path)

    def act(self, player, command):
        return send(self.by_id[player], self.game_id, self.snapshot()['revision'], command)

    def me(self, player):
        view = self.snapshot(player)['view']
        return next(p for p in view['players'] if p['id'] == player), view


def edge_endpoints(topology_id):
    return json.loads(subprocess.run(
        ['node', '--experimental-strip-types', str(ROOT / 'scripts/cities-knights/topology.mjs'), topology_id],
        check=True, capture_output=True, text=True, cwd=ROOT).stdout)['edges']


def ck_hints(view):
    return view['hints']['modules']['citiesKnights']


def resolve_pending(table: Table, view, revision):
    pending = view['pending']
    kind = pending['kind']
    if kind == 'discard':
        for pid in pending['waitingFor']:
            me, _ = table.me(pid)
            hand = {**me['resources'], **(me.get('commodities') or {})}
            pool = [card for card in sorted(hand, key=lambda c: -hand[c]) for _ in range(hand[card])]
            assert table.act(pid, {'type': 'pending.discard', 'resources': pool[:pending['required'][pid]]})
        return
    if kind == 'moveRobber':
        for hex_ in range(len(view['board']['terrain'])):
            if send(table.by_id[pending['actor']], table.game_id, revision, {'type': 'pending.moveRobber', 'hex': (hex_ * 7 + view['seq']) % len(view['board']['terrain'])}):
                return
        raise AssertionError('no robber target')
    if kind == 'steal':
        assert send(table.by_id[pending['actor']], table.game_id, revision, {'type': 'pending.steal', 'victim': pending['candidates'][0]})
        return
    responders = pending.get('responders') or []
    if not responders:
        raise AssertionError(f'continuation frame left pending: {pending}')
    pid = responders[0]
    me, mine = table.me(pid)
    hints = ck_hints(mine)
    if kind == 'citiesKnights.pillage':
        assert table.act(pid, {'type': 'barbarians.pillage', 'vertex': hints['pillage'][0]})
    elif kind == 'citiesKnights.displaced':
        assert table.act(pid, {'type': 'knight.retreat', 'vertex': hints['retreat'][0]})
    elif kind == 'citiesKnights.defenderDraw':
        assert table.act(pid, {'type': 'barbarians.chooseDeck', 'track': hints['defenderDecks'][0]})
    elif kind == 'citiesKnights.progressDiscard':
        for responder in responders:
            player, _ = table.me(responder)
            required = pending['data']['required'][responder]
            assert table.act(responder, {'type': 'progress.discard', 'cards': player['progressCards'][:required]})
    elif kind == 'citiesKnights.scienceBonus':
        assert table.act(pid, {'type': 'science.take', 'resource': None})
    else:
        raise AssertionError(f'unhandled pending {pending}')


def play_until(table: Table, goal, p1_turn, limit=3000):
    """Roll/end turns over the API until `goal(view)`; `p1_turn` may act for player 1."""
    for _ in range(limit):
        snapshot = table.snapshot()
        view = snapshot['view']
        if goal(view):
            return view
        if view['result']:
            raise AssertionError('game ended before the goal')
        if view['pending'] is not None:
            resolve_pending(table, view, snapshot['revision'])
            continue
        actor = view['turn']['playerId']
        mine = table.snapshot(actor)['view']
        if mine['hints']['canRoll']:
            assert table.act(actor, {'type': 'turn.roll'})
            continue
        excess = ck_hints(mine)['progressExcess']
        if excess > 0:
            player = next(p for p in mine['players'] if p['id'] == actor)
            assert table.act(actor, {'type': 'progress.discard', 'cards': player['progressCards'][:excess]})
            continue
        if actor == table.identity[0] and p1_turn(view):
            continue
        assert table.act(actor, {'type': 'turn.end'})
    raise AssertionError(f'goal not reached in {limit} steps')


def complete_setup(table: Table):
    while True:
        snapshot = table.snapshot()
        turn = snapshot['view']['turn']
        if turn['phase'] != 'setup':
            return
        actor = turn['playerId']
        hints = table.snapshot(actor)['view']['hints']
        stage = turn['setup']['stage']
        command = ({'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]} if stage == 'road'
                   else {'type': 'setup.placeBuilding', 'vertex': hints['legalSettlements'][len(hints['legalSettlements']) // 2]})
        assert table.act(actor, command), command


# ------------------------------------------------------------------------ UI steps

def ui_click_target(page, kind, index, confirm=True):
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached()
    target.click(force=True)
    if confirm:
        expect(page.get_by_test_id('confirm-selection')).to_be_visible()


def ui_confirm(page):
    page.get_by_test_id('confirm-selection').click()
    page.wait_for_timeout(600)


def open_actions(page):
    rail = page.get_by_test_id('action-rail-toggle')
    if rail.count() and rail.get_attribute('aria-expanded') != 'true':
        rail.click()


def open_panel(page):
    tab = page.get_by_test_id('tool-tab-citiesKnights')
    expect(tab).to_be_visible()
    if tab.get_attribute('aria-expanded') != 'true':
        tab.click()
    expect(page.get_by_test_id('ck-panel')).to_be_visible()


def close_panel(page):
    if page.get_by_test_id('tool-tab-citiesKnights').get_attribute('aria-expanded') == 'true':
        page.get_by_test_id('tool-close').click()


def take(bank, hand, card, amount):
    moved = min(amount, bank[card])
    bank[card] -= moved
    hand[card] += moved
