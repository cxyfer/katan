#!/usr/bin/env python3
"""Explorers & Pirates browser evidence against the built service.

Usage (``pnpm build`` first; the output directory must be new and empty):

  EP_PORT=3062 python3 -I scripts/explorers-pirates/capture.py <new-empty-output-dir> [mission ...]

Missions (default: all, in book order): land-ho pirate-lairs fish spices explorers-pirates.

For each mission the harness creates a room through the lobby UI, starts it
with human seats only (bots are refused for E&P) and plays a whole game to
its result on the real service. Decisions come from the scripted fixture bot
(``bot.mjs``, the same bot as ``packages/rules/test/ep-sim.ts``), which reads
the persisted state; every decision is sent through the real HTTP API as the
owning player, except that player 1 acts **through the browser UI** the first
times each command type comes up:

* the command is executed in one renderer (alternating SVG / 3D per type), and
* in the other renderer the same choice is reached (prompt button visible and
  enabled, or the board target armed with its preview open, then cancelled).

Each step asserts the DOM state it needs and that the service accepted the
command. ``report.json`` lists the captures (sha256), per-mission command
coverage (executed / reached per renderer, and command types the bot used only
over the API) and any page errors.
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

# `python3 -I` drops the user site directory; append it (after the standard
# library) so a user-level Playwright install is still found.
import site  # noqa: E402

if site.getusersitepackages() not in sys.path:
    sys.path.append(site.getusersitepackages())

from playwright.sync_api import TimeoutError as PlaywrightTimeout, expect, sync_playwright  # noqa: E402

# A loaded CI box renders WebGL in software; give DOM expectations room.
expect.set_options(timeout=45000)

ROOT = Path(__file__).resolve().parents[2]
PORT = int(os.environ.get('EP_PORT', '3062'))
BASE = f'http://127.0.0.1:{PORT}'
ARGS = sys.argv[1:]
if not ARGS:
    sys.exit('usage: capture.py <new empty output directory> [mission ...]')
OUT = Path(ARGS[0])
if OUT.exists() and any(OUT.iterdir()):
    sys.exit(f'output directory must be empty: {OUT}')
OUT.mkdir(parents=True, exist_ok=True)

# (scenario, profile, players, setup mode, scenario index in the lobby)
MISSIONS = [
    ('land-ho', 'ep-land-ho-2025', 4, 'fixed', 0),
    ('pirate-lairs', 'ep-pirate-lairs-2025', 3, 'fixed', 1),
    ('fish', 'ep-fish-2025', 3, 'variable', 2),
    ('spices', 'ep-spices-2025', 4, 'variable', 3),
    ('explorers-pirates', 'ep-full-2025', 3, 'variable', 4),
]
CHOSEN = ARGS[1:] or [mission[0] for mission in MISSIONS]
DESKTOP = {'width': 1366, 'height': 900}
PHONE = {'width': 390, 'height': 844}
REPORT: dict = {'base': BASE, 'missions': {}, 'cases': []}
ERRORS: list[str] = []
MAX_STEPS = int(os.environ.get('EP_MAX_STEPS', '20000'))

# Commands player 1 performs through the UI (the rest of base play — discards,
# bank trades — is covered by the base harnesses and goes over the API).
# Legal moves the fixture bot never picks; player 1 makes them through the prompt when they come up.
EXTRA_UI = {'ep.sellForGold': ('action', 'ep-sell-'), 'ep.unload': ('movement', 'ep-unload-'), 'ep.swap': ('movement', 'ep-swap-')}
EXTRA_TRIES = 8

UI_COMMANDS = {
    'turn.roll', 'turn.end', 'build.settlement', 'build.road',
    'ep.setupHarbor', 'ep.setupSettlement', 'ep.setupShip', 'ep.setupRoad',
    'ep.buildHarbor', 'ep.buildShip', 'ep.buildSettler', 'ep.buildCrew',
    'ep.buyResource', 'ep.sellForGold', 'ep.fastGold', 'ep.extraMove', 'ep.startMovement',
    'ep.fishRoll', 'ep.moveShip', 'ep.found', 'ep.load', 'ep.unload', 'ep.swap',
    'ep.dropCrew', 'ep.pickCrew', 'ep.loadFish', 'ep.loadSpice', 'ep.deliver', 'ep.chase',
    'ep.placePirate', 'ep.robPlayer', 'trade.bank', 'pending.discard',
}


def log(*parts):
    print(*parts, flush=True)


# ------------------------------------------------------------------------ server

class Server:
    """The built service on a private SQLite file."""

    def __init__(self):
        self.data = Path(tempfile.mkdtemp(prefix='katan-ep-'))
        self.sqlite = self.data / 'ep.sqlite'
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

    def state(self, game_id):
        with sqlite3.connect(self.sqlite) as db:
            (raw,) = db.execute('SELECT state_json FROM games WHERE id = ?', (game_id,)).fetchone()
        return raw


SERVER = Server()


class Bot:
    """The fixture bot as a line-protocol child process."""

    def __init__(self):
        self.child = subprocess.Popen(['node', '--experimental-transform-types', '--no-warnings', str(ROOT / 'scripts/explorers-pirates/bot.mjs')], cwd=ROOT,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

    def decide(self, state_json):
        self.child.stdin.write(json.dumps({'state': json.loads(state_json)}) + '\n')
        self.child.stdin.flush()
        answer = json.loads(self.child.stdout.readline())
        if answer.get('error'):
            raise AssertionError(answer['error'])
        return answer

    def close(self):
        self.child.stdin.close()
        self.child.wait(timeout=10)


# --------------------------------------------------------------------------- API

def api(context, method, path, data=None):
    response = context.request.fetch(BASE + path, method=method, data=data)
    payload = response.json()
    assert payload.get('ok'), (path, response.status, payload)
    return payload['data']


def send(context, game_id, revision, command):
    response = context.request.post(f'{BASE}/api/games/{game_id}/commands', data={
        'commandId': str(uuid.uuid4()), 'expectedRevision': revision, 'command': command})
    payload = response.json()
    return bool(payload.get('ok')) and payload['data']['outcome'] == 'accepted'


# ------------------------------------------------------------------------ capture

def settle(page, ms=700):
    page.mouse.move(1, 1)
    page.wait_for_timeout(ms)
    page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


def shot(page, name, note='', ms=700):
    settle(page, ms)
    path = OUT / f'{name}.png'
    # A shared, heavily loaded box can stall one compositor frame; retry before giving up.
    for attempt in range(3):
        try:
            page.screenshot(path=str(path), animations='disabled', timeout=120000)
            break
        except PlaywrightTimeout:
            if attempt == 2:
                raise
            log('RETRY', name)
            page.wait_for_timeout(5000)
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
    # The home panels animate in; retry the tab switch instead of waiting on one stalled click.
    for _ in range(4):
        if resume.is_visible():
            break
        try:
            page.locator('#home-tab-resume').click(timeout=10000)
        except PlaywrightTimeout:
            pass
        page.wait_for_timeout(500)
    resume.click()
    wait_renderer(page, renderer)


def new_player(browser, name, viewport=DESKTOP, locale='zh-TW'):
    context = browser.new_context(viewport=viewport, locale=locale, reduced_motion='reduce', service_workers='block')
    page = context.new_page()
    page.on('pageerror', lambda error: ERRORS.append(f'{name}: {error}'))
    page.set_default_timeout(60000)
    page.goto(BASE)
    page.get_by_test_id('nickname-input').fill(name)
    page.locator('form button[type=submit]').click()
    expect(page.get_by_test_id('create-room')).to_be_visible()
    return context, page


def start_game(browser, mission, names, lobby_shot=None):
    scenario, profile, count, setup_mode, scenario_index = mission
    players = [new_player(browser, name, locale='zh-TW' if index == 0 else 'en-US') for index, name in enumerate(names[:count])]
    contexts = [context for context, _ in players]
    pages = [page for _, page in players]
    host = pages[0]
    host.get_by_test_id('expansion-select').select_option('explorersPirates')
    host.get_by_test_id('scenario-select').select_option(index=scenario_index)
    host.locator('#room-capacity').select_option(str(count))
    if host.locator('#room-setup option').count() > 1:
        host.locator('#room-setup').select_option(setup_mode)
    expect(host.get_by_test_id('resolved-profile')).to_be_visible()
    if lobby_shot:
        shot(host, lobby_shot, f'lobby: Explorers & Pirates / {scenario}')
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
    expect(host.get_by_test_id('board')).to_be_visible(timeout=60000)
    identity = [api(context, 'GET', '/api/session')['player']['id'] for context in contexts]
    game = api(contexts[0], 'GET', '/api/games')['games'][0]
    assert game.get('profileId', profile) == profile, game
    return contexts, pages, identity, game['gameId']


# ----------------------------------------------------------------------- UI moves

def open_actions(page):
    # The rail expands on hover or focus; hover its toggle so a stale hover state cannot leave it collapsed.
    rail = page.get_by_test_id('action-rail')
    if not rail.count():
        return
    toggle = page.get_by_test_id('action-rail-toggle')
    toggle.hover()
    if rail.get_attribute('data-expanded') != 'true':
        toggle.click()
    expect(rail).to_have_attribute('data-expanded', 'true')


def click_target(page, kind, index):
    target = page.get_by_test_id(f'target-{kind}-{index}')
    expect(target).to_be_attached()
    target.click(force=True)
    # Close targets in 3D open the picker list instead of selecting directly.
    confirm = page.get_by_test_id('confirm-selection')
    picker = page.get_by_test_id(f'picker-{kind}-{index}')
    expect(confirm.or_(picker).first).to_be_visible()
    if not confirm.is_visible() and picker.is_visible():
        picker.click()
    expect(confirm).to_be_visible()


def button(page, test_id):
    element = page.get_by_test_id(test_id)
    expect(element).to_be_visible()
    expect(element).to_be_enabled()
    return element


def holder_id(command):
    return f"h{command['harbor']}" if 'harbor' in command else command['ship']


def ship_key(command):
    """Prompt button test id for a per-ship Movement action."""
    kind = command['type']
    ship = command['ship']
    if kind == 'ep.load':
        return f"ep-load-{command['piece']}-{command['harbor']}-{ship}"
    if kind == 'ep.unload':
        return f"ep-unload-{command['piece']}-{command['harbor']}-{ship}"
    if kind == 'ep.swap':
        return f"ep-swap-{command['harbor']}-{ship}"
    if kind == 'ep.dropCrew':
        return f"ep-drop-{command['hex']}-{ship}"
    if kind == 'ep.pickCrew':
        return f"ep-pick-{command['hex']}-{ship}"
    if kind == 'ep.loadFish':
        return f"ep-fish-{command['hex']}-{ship}"
    if kind == 'ep.loadSpice':
        return f"ep-spice-{command['hex']}-{ship}"
    if kind == 'ep.deliver':
        return f'ep-deliver-{ship}'
    if kind == 'ep.chase':
        return f'ep-chase-{ship}'
    if kind == 'ep.extraMove':
        return f'ep-extra-{ship}'
    raise KeyError(kind)


def arm(page, command):
    """Bring up the UI for `command`. Returns the element to click, or None once a board preview is open."""
    kind = command['type']
    if kind == 'turn.roll':
        return button(page, 'prompt-roll')
    if kind == 'turn.end':
        return button(page, 'prompt-end-turn')
    if kind == 'pending.discard':
        expect(page.get_by_test_id('discard-picker')).to_be_visible()
        for resource in command['resources']:
            button(page, f'discard-add-{resource}').click()
        return button(page, 'discard-submit')
    if kind == 'trade.bank':
        # E&P bank trades are 3:1 (the module's bank rate); the shared exchange panel shows it.
        panel = page.get_by_test_id('exchange-panel')
        if not panel.is_visible():
            button(page, 'tool-tab-exchange').click()
        expect(panel).to_be_visible()
        page.get_by_test_id('bank-give').select_option(command['give'])
        page.get_by_test_id('bank-receive').select_option(command['receive'])
        expect(page.get_by_test_id('bank-rate')).to_contain_text('3:1')
        return button(page, 'bank-submit')
    if kind == 'ep.startMovement':
        return button(page, 'ep-start-movement')
    if kind == 'ep.fishRoll':
        return button(page, 'ep-fish-roll')
    if kind == 'ep.buyResource':
        return button(page, f"ep-buy-{command['receive']}")
    if kind == 'ep.sellForGold':
        return button(page, f"ep-sell-{command['give']}")
    if kind == 'ep.fastGold':
        return button(page, f"ep-fast-{command['give']}")
    if kind in ('ep.buildSettler', 'ep.buildCrew'):
        piece = 'settler' if kind == 'ep.buildSettler' else 'crew'
        return button(page, f'ep-build-{piece}-{holder_id(command)}')
    if kind == 'ep.robPlayer':
        return button(page, f"ep-rob-{command['victim']}")
    if kind in ('ep.load', 'ep.unload', 'ep.swap', 'ep.dropCrew', 'ep.pickCrew', 'ep.loadFish',
                'ep.loadSpice', 'ep.deliver', 'ep.chase', 'ep.extraMove'):
        return button(page, ship_key(command))
    # Board targets.
    if kind in ('ep.setupHarbor', 'ep.setupSettlement'):
        click_target(page, 'vertex', command['vertex'])
    elif kind == 'ep.setupShip':
        click_target(page, 'edge', command['edge'])
    elif kind == 'ep.setupRoad':
        toggle = page.get_by_test_id('ep-setup-road')
        if toggle.count():
            toggle.click()
        click_target(page, 'edge', command['edge'])
    elif kind in ('build.settlement', 'ep.buildHarbor'):
        open_actions(page)
        button(page, f"action-{'build.settlement' if kind == 'build.settlement' else 'ep.buildHarbor'}").click()
        click_target(page, 'vertex', command['vertex'])
    elif kind == 'build.road':
        open_actions(page)
        button(page, 'action-build.road').click()
        click_target(page, 'edge', command['edge'])
    elif kind == 'ep.buildShip':
        if command.get('replace'):
            button(page, f"ep-rebuild-{command['replace']}").click()
        else:
            open_actions(page)
            button(page, 'action-ep.buildShip').click()
        click_target(page, 'edge', command['edge'])
    elif kind == 'ep.moveShip':
        sail = page.get_by_test_id(f"ep-sail-{command['ship']}")
        expect(sail).to_be_visible()
        if sail.is_enabled():
            sail.click()
        click_target(page, 'edge', command['edge'])
    elif kind == 'ep.found':
        button(page, f"ep-found-{command['ship']}").click()
        click_target(page, 'vertex', command['vertex'])
    elif kind == 'ep.placePirate':
        click_target(page, 'hex', command['hex'])
    else:
        raise KeyError(kind)
    return None


def cancel(page):
    cancel_button = page.get_by_test_id('cancel-selection')
    if cancel_button.count() and cancel_button.is_visible():
        cancel_button.click()
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)


# ----------------------------------------------------------------------- the game

class Table:
    def __init__(self, contexts, pages, identity, game_id):
        self.contexts = contexts
        self.pages = pages
        self.identity = identity
        self.by_id = dict(zip(identity, contexts))
        self.game_id = game_id
        self.path = f'/api/games/{game_id}'

    def snapshot(self, player=None):
        return api(self.by_id[player] if player else self.contexts[0], 'GET', self.path)


def play_mission(browser, mission, names, first):
    scenario = mission[0]
    contexts, pages, identity, game_id = start_game(browser, mission, names, lobby_shot=f'{scenario}-lobby' if first else None)
    table = Table(contexts, pages, identity, game_id)
    p1, page = identity[0], pages[0]
    coverage = {'svg': {'executed': set(), 'reached': set()}, 'r3f': {'executed': set(), 'reached': set()}}
    api_only: dict[str, int] = {}
    counts: dict[str, int] = {}
    current = {'renderer': None, 'stale': True}
    bot = Bot()
    shots = {'explored': False, 'movement': False}

    def ensure(renderer):
        if current['renderer'] != renderer or current['stale']:
            open_game(page, game_id, renderer)
            current['renderer'] = renderer
            current['stale'] = False

    for renderer in ('svg', 'r3f'):
        ensure(renderer)
        shot(page, f'{scenario}-start-{renderer}', f'{scenario}: board at the start', ms=2500 if renderer == 'r3f' else 700)
    # Finished games leave the resume list, so two other seats watch live in one renderer each for the final board.
    watchers = {'svg': pages[1], 'r3f': pages[2]}
    for renderer, watcher in watchers.items():
        open_game(watcher, game_id, renderer)
    if scenario == 'fish':
        phone_ctx = browser.new_context(storage_state=contexts[0].storage_state(), viewport=PHONE, locale='zh-TW',
                                        reduced_motion='reduce', service_workers='block', is_mobile=True, has_touch=True)
        phone = phone_ctx.new_page()
        phone.on('pageerror', lambda error: ERRORS.append(f'phone: {error}'))
        for renderer in ('svg', 'r3f'):
            open_game(phone, game_id, renderer)
            shot(phone, f'{scenario}-start-{renderer}-phone', 'phone layout', ms=2500 if renderer == 'r3f' else 700)
        phone_ctx.close()

    def try_extra(snapshot, tries):
        view = snapshot['view']
        hints = ((view.get('hints') or {}).get('modules') or {}).get('explorersPirates') or {}
        phase = hints.get('phase')
        if view['turn']['playerId'] != p1 or view['pending'] or not phase:
            return False
        harbors_near = any(ship['harbors'] for ship in hints.get('ships', []))
        for kind, (wanted, prefix) in EXTRA_UI.items():
            if kind in coverage['svg']['executed'] or phase != wanted or tries.get(kind, 0) >= EXTRA_TRIES:
                continue
            if wanted == 'movement' and not harbors_near:
                continue
            tries[kind] = tries.get(kind, 0) + 1
            ensure('svg')
            buttons = page.locator(f'[data-testid^="{prefix}"]:enabled')
            if not buttons.count():
                continue
            # Reach it in 3D first, then make the move in SVG.
            ensure('r3f')
            if page.locator(f'[data-testid^="{prefix}"]:enabled').count():
                coverage['r3f']['reached'].add(kind)
            current['stale'] = True
            ensure('svg')
            buttons = page.locator(f'[data-testid^="{prefix}"]:enabled')
            if not buttons.count():
                continue
            revision = snapshot['revision']
            buttons.first.click()
            deadline = time.time() + 15
            while time.time() < deadline and table.snapshot()['revision'] == revision:
                page.wait_for_timeout(150)
            assert table.snapshot()['revision'] > revision, f'extra UI command not accepted: {kind}'
            coverage['svg']['executed'].add(kind)
            counts[kind] = counts.get(kind, 0) + 1
            log(scenario, 'extra', 'UI', 'svg', kind)
            return True
        return False

    try:
        extra_tries: dict[str, int] = {}
        for step in range(MAX_STEPS):
            snapshot = table.snapshot()
            if snapshot['view']['result']:
                break
            if try_extra(snapshot, extra_tries):
                continue
            decision = bot.decide(SERVER.state(game_id))
            actor, command = decision.get('actor'), decision.get('command')
            assert actor, f'bot found no move at step {step}: {snapshot["view"]["turn"]} {snapshot["view"]["pending"]}'
            kind = command['type']
            counts[kind] = counts.get(kind, 0) + 1
            revision = snapshot['revision']
            done = coverage['svg']['executed'] | coverage['r3f']['executed']
            use_ui = actor == p1 and kind in UI_COMMANDS and not (
                kind in coverage['svg']['executed'] and kind in coverage['r3f']['executed'])
            if not use_ui:
                if actor == p1 and kind not in UI_COMMANDS:
                    api_only[kind] = api_only.get(kind, 0) + 1
                assert send(table.by_id[actor], game_id, revision, command), (actor, command)
                if actor == p1:
                    current['stale'] = True
                continue
            # Execute where this command type has not run yet (SVG first), reach it in the other renderer.
            execute_in = 'svg' if kind not in coverage['svg']['executed'] else 'r3f'
            other = 'r3f' if execute_in == 'svg' else 'svg'
            if kind not in done and kind not in coverage[other]['reached']:
                ensure(other)
                element = arm(page, command)
                coverage[other]['reached'].add(kind)
                if element is None:
                    cancel(page)
                current['stale'] = True  # leave the half-armed page behind
            ensure(execute_in)
            element = arm(page, command)
            if element is not None:
                element.click()
            else:
                page.get_by_test_id('confirm-selection').click()
            deadline = time.time() + 15
            while time.time() < deadline and table.snapshot()['revision'] == revision:
                page.wait_for_timeout(150)
            assert table.snapshot()['revision'] > revision, f'UI command not accepted: {command}'
            coverage[execute_in]['executed'].add(kind)
            log(scenario, step, 'UI', execute_in, kind)
            if kind == 'trade.bank' and page.get_by_test_id('tool-close').is_visible():
                page.get_by_test_id('tool-close').click()
            view = table.snapshot(p1)['view']
            ep = view['modules']['explorersPirates']
            if kind == 'ep.moveShip' and not shots['explored'] and len(ep['fog']) < len(snapshot['view']['modules']['explorersPirates']['fog']):
                shots['explored'] = True
                shot(page, f'{scenario}-explored-{execute_in}', 'a ship explored a fog hex through the UI', ms=2500 if execute_in == 'r3f' else 900)
            if kind == 'ep.startMovement' and not shots['movement']:
                shots['movement'] = True
                shot(page, f'{scenario}-movement-{execute_in}', 'Movement phase: per-ship actions in the prompt', ms=2500 if execute_in == 'r3f' else 700)
        else:
            raise AssertionError(f'{scenario}: no result after {MAX_STEPS} steps')
    except Exception:
        for index, other_page in enumerate(pages):
            other_page.screenshot(path=str(OUT / f'failure-{scenario}-seat{index}.png'))
        raise
    finally:
        bot.close()

    result = table.snapshot()['view']['result']
    for renderer, watcher in watchers.items():
        result_screen = watcher.get_by_test_id('result-screen')
        try:
            result_screen.wait_for(state='visible', timeout=30000)
        except PlaywrightTimeout:
            # A seat's own API command is not echoed to its socket; a reconnect pulls the final snapshot.
            watcher.context.set_offline(True)
            watcher.wait_for_timeout(2000)
            watcher.context.set_offline(False)
            result_screen.wait_for(state='visible', timeout=60000)
        shot(watcher, f'{scenario}-final-{renderer}', f'{scenario}: result with the final board', ms=2500 if renderer == 'r3f' else 700)
    REPORT['missions'][scenario] = {
        'profile': mission[1], 'players': mission[2], 'steps': sum(counts.values()), 'result': result,
        'commands': counts,
        'ui': {renderer: {key: sorted(value) for key, value in data.items()} for renderer, data in coverage.items()},
        'p1ApiOnly': api_only,
        'uiNotReached': sorted(kind for kind in counts if kind in UI_COMMANDS and kind not in
                               (coverage['svg']['executed'] | coverage['r3f']['executed'])),
    }
    log('MISSION', scenario, 'result', json.dumps(result)[:200])
    for context in contexts:
        context.close()


def main():
    SERVER.start()
    try:
        names = ['探險隊長', 'Mira', 'Jonas', 'Ilse']
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            for index, mission in enumerate(m for m in MISSIONS if m[0] in CHOSEN):
                log('MISSION START', mission[0])
                play_mission(browser, mission, names, index == 0)
            browser.close()
    finally:
        SERVER.stop()
        REPORT['errors'] = ERRORS
        (OUT / 'report.json').write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding='utf-8')
        log('CASES', len(REPORT['cases']), 'ERRORS', len(ERRORS))
    if ERRORS:
        sys.exit(1)


if __name__ == '__main__':
    main()
