"""Capture production board controls without writing game data.

Run from any cwd with the worktree venv. All evidence stays in test-results/.
API and WebSocket fixtures are isolated from the artifact server's temporary DB.
"""
import argparse
import base64
import copy
import hashlib
import importlib.metadata
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path
from urllib.parse import urlparse, urljoin, unquote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'packages/web/dist'
SIZES = [(1366, 768), (800, 450), (844, 390), (768, 1024), (390, 844), (360, 640)]


class Blocked(RuntimeError):
    pass


def sha(data):
    return hashlib.sha256(data).hexdigest()


def command(args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise Blocked(f'{args[0]} exited {result.returncode}: {result.stderr.strip()}')
    return result.stdout.strip()


def relative(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def output_path(value):
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT / 'test-results') or path == ROOT / 'test-results':
        raise ValueError('--out must be a directory inside this worktree\'s test-results/')
    if path.exists() and any(path.iterdir()):
        raise ValueError(f'refusing to overwrite previous evidence: {path}; choose a new --out')
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_report(report, out):
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def case(report, identifier, status, **details):
    item = {'id': identifier, 'status': status, **details}
    report['cases'].append(item)
    print(f'{status} {identifier}', flush=True)
    return item


def environment():
    info = {'os': platform.platform(), 'python': sys.version, 'pythonExecutable': sys.executable,
            'node': command(['node', '--version']), 'pnpm': None,
            'cpu': platform.processor(), 'logicalCpuCount': os.cpu_count(),
            'ramBytes': None, 'gpu': None, 'powerMode': 'not observed', 'refreshRateHz': 'not observed',
            'browserCache': str(ROOT / '.tmp/board-visual-browsers')}
    # pnpm.cmd is needed on Windows; do not depend on shell resolution of pnpm.ps1.
    pnpm = shutil.which('pnpm.cmd' if os.name == 'nt' else 'pnpm')
    if pnpm:
        info['pnpm'] = command([pnpm, '--version'])
    if os.name == 'nt':
        script = "$ErrorActionPreference='Stop'; @{cpu=(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name);ramBytes=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory;gpu=(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,CurrentRefreshRate)} | ConvertTo-Json -Depth 4 -Compress"
        try:
            info.update(json.loads(command(['powershell', '-NoProfile', '-Command', script])))
        except Exception as error:
            info['hardwareQueryLimitation'] = str(error)
    return info


def start_server(out):
    entry = ROOT / 'packages/server/dist/server.mjs'
    if not entry.is_file() or not (DIST / 'index.html').is_file():
        raise Blocked('production artifacts missing; run pnpm build in this worktree')
    temporary = tempfile.TemporaryDirectory(prefix='catan-board-visual-')
    log = (out / 'server.log').open('w', encoding='utf-8')
    child = None
    try:
        # Reserve a free local port, then release immediately before starting Node.
        # A competing bind causes startup failure; never attach to that process.
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        env = {**os.environ, 'HOST': '127.0.0.1', 'PORT': str(port),
               'SQLITE_PATH': str(Path(temporary.name) / 'fixture.sqlite'),
               'DATABASE_URL': '', 'DATABASE_SCHEMA': '', 'WEB_DIST_PATH': str(DIST), 'LOG_LEVEL': 'warn'}
        child = subprocess.Popen(['node', str(entry)], cwd=ROOT, env=env, stdout=log, stderr=log,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        base = f'http://127.0.0.1:{port}'
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise Blocked(f'own artifact server exited {child.returncode}; see server.log')
            try:
                with urlopen(base + '/healthz', timeout=1) as response:
                    if response.status == 200:
                        return base, child, temporary, log
            except OSError:
                time.sleep(0.15)
        raise Blocked('own artifact server did not become healthy within 20s; see server.log')
    except Exception:
        stop_server(child, temporary, log)
        raise


def stop_server(child, temporary, log):
    if child is not None and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)
    if log is not None:
        log.close()
    if temporary is not None:
        temporary.cleanup()


def verify_assets(base, report):
    parsed = urlparse(base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path not in ('', '/'):
        raise ValueError('--base-url must be an HTTP(S) origin without a path')
    expected = {}
    for path in sorted(DIST.rglob('*')):
        if path.is_file() and path.suffix in ('.html', '.js', '.css'):
            key = '/' if path == DIST / 'index.html' else '/' + path.relative_to(DIST).as_posix()
            expected[key] = {'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size}
    if '/' not in expected or not any(key.endswith('.js') for key in expected) or not any(key.endswith('.css') for key in expected):
        raise Blocked('incomplete worktree web dist; run pnpm build')
    report['assetHashes'] = expected
    for path, item in expected.items():
        with urlopen(urljoin(base + '/', path.lstrip('/')), timeout=10) as response:
            actual = sha(response.read())
        item['servedSha256'] = actual
        if actual != item['sha256']:
            case(report, 'T01-source', 'FAIL', path=path, expected=item['sha256'], actual=actual)
            raise RuntimeError(f'source mismatch at {path}; stopped before browser/fixture execution')
    case(report, 'T01-source', 'PASS', detail='All served HTML/JS/CSS match this worktree dist byte for byte.')
    return expected


class Scenario:
    def __init__(self, browser, base, renderer, fixture, board, locale, size, report, out, video=False, motion='reduce', initial='snapshot'):
        self.board, self.fixture, self.report = board, fixture, report
        self.snapshot = copy.deepcopy(board[initial])
        self.sockets, self.errors, self.unmapped, self.assets = [], [], [], {}
        options = {'viewport': {'width': size[0], 'height': size[1]}, 'device_scale_factor': 1,
                   'locale': 'zh-TW' if locale == 'zh-Hant' else 'en-US', 'reduced_motion': motion,
                   'has_touch': size[0] < 900, 'service_workers': 'block'}
        if video:
            options.update(record_video_dir=str(out / 'videos'), record_video_size=options['viewport'])
        self.context = browser.new_context(**options)
        self.context.add_init_script("window.__appRafCalls=0; const originalRaf=window.requestAnimationFrame; window.requestAnimationFrame=function(callback){window.__appRafCalls++;return originalRaf.call(window,callback)}")
        self.context.add_init_script(f"localStorage.setItem('catan.locale', {json.dumps(locale)});")
        self.context.route('**/api/**', self.route)
        self.context.route_web_socket('**/ws', self.connect)
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.on('response', self.response)
        try:
            self.page.goto(base + '/?renderer=' + renderer, wait_until='networkidle')
            self.page.locator('#home-tab-resume').click()
            self.page.get_by_test_id('resume-g1').click()
            self.page.get_by_test_id('board-svg').wait_for(state='visible')
            self.page.evaluate('document.fonts.ready')
            self.page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        except Exception:
            self.close()
            raise

    def response(self, response):
        parsed = urlparse(response.url)
        path = unquote(parsed.path)
        if path == '/' or path.endswith(('.js', '.css', '.html')):
            local = DIST / ('index.html' if path == '/' else path.lstrip('/'))
            if not local.resolve().is_relative_to(DIST) or not local.is_file():
                self.errors.append(f'unrecognized loaded asset: {path}')
                return
            actual = sha(response.body())
            self.assets[path] = actual
            if actual != sha(local.read_bytes()):
                self.errors.append(f'loaded asset hash mismatch: {path}')

    def connect(self, socket_route):
        self.sockets.append(socket_route)
        socket_route.on_message(lambda message: None)

    def route(self, route):
        request = route.request
        path = urlparse(request.url).path
        data = None
        if path == '/api/config':
            data = self.fixture['config']
        elif path == '/api/session':
            data = {'player': self.fixture['identity']}
        elif path == '/api/profiles':
            data = {'profiles': self.fixture['profiles']}
        elif path == '/api/rooms':
            data = {'rooms': []}
        elif path == '/api/games':
            data = {'games': self.board['games']}
        elif path in ('/api/rooms/r1', '/api/games/g1/resume'):
            data = self.board['room']
        elif path == '/api/games/g1':
            data = self.snapshot
        elif path == '/api/games/g1/events':
            data = {'events': self.snapshot['view']['events'], 'revision': self.snapshot['revision']}
        elif path == '/api/rooms/r1/chat':
            data = {'messages': [], 'nextSeq': 0, 'hasMore': False}
        else:
            self.unmapped.append({'method': request.method, 'path': path})
            route.fulfill(status=501, json={'ok': False, 'error': {'code': 'E_INVALID_COMMAND', 'messageId': 'error.E_INVALID_COMMAND'}})
            return
        route.fulfill(status=200, json={'ok': True, 'data': data})

    def send(self, snapshot):
        self.snapshot = copy.deepcopy(snapshot)
        if not self.sockets:
            raise RuntimeError('fixture WebSocket was not connected')
        for socket_route in self.sockets:
            socket_route.send(json.dumps({'type': 'snapshot', 'payload': self.snapshot}))

    def close(self):
        self.context.close()


GEOMETRY = """() => {
 const svg = document.querySelector('[data-testid="board-svg"]');
 const rect = svg.getBoundingClientRect();
 const world = svg.querySelector('g').getBoundingClientRect();
 return {viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,
  locale:document.querySelector('[data-testid="locale-switch-game"]')?.value,
  htmlLang:document.documentElement.lang,board:rect.toJSON(),world:world.toJSON(),
  document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
  hexes:svg.querySelectorAll('[data-testid^="hex-"]').length,
  harbors:svg.querySelectorAll('[data-testid^="harbor-"]').length,
  buildings:svg.querySelectorAll('[data-testid^="building-"]').length,
  roads:svg.querySelectorAll('[data-testid^="road-"]').length,
  diceOverlay:document.querySelectorAll('[data-testid="dice-focus"]').length,
  activeAnimations:document.getAnimations().filter(a=>a.playState==='running').length,
  userAgent:navigator.userAgent,
  renderer:document.querySelector('[data-testid="board-svg"]')?'svg':'unknown'};
}"""


def static_matrix(browser, base, args, fixture, report, out):
    for board in fixture['boards']:
        for locale in ('zh-Hant', 'en'):
            for size in SIZES:
                tag = f'{board["id"]}-{locale}-{size[0]}x{size[1]}'
                scenario = None
                try:
                    scenario = Scenario(browser, base, args.renderer, fixture, board, locale, size, report, out)
                    metrics = scenario.page.evaluate(GEOMETRY)
                    path = out / f'{tag}.png'
                    scenario.page.screenshot(path=str(path), full_page=True, animations='disabled')
                    # Automated checks prove capture geometry/counts, not human readability.
                    okay = (metrics['hexes'] == board['topology']['hexes'] and metrics['diceOverlay'] == 0
                            and metrics['activeAnimations'] == 0 and metrics['renderer'] == args.renderer
                            and metrics['locale'] == locale and metrics['board']['width'] > 0
                            and metrics['board']['height'] > 0 and not scenario.errors and not scenario.unmapped)
                    case(report, 'V01-capture-' + tag, 'PASS' if okay else 'FAIL', fixture=board['id'],
                         topology=board['topologyId'], locale=locale, viewport=list(size), dpr=1,
                         operation='Load history-free static snapshot with reduced motion; capture unchanged production UI.',
                         actual=metrics, errors=scenario.errors, unmapped=scenario.unmapped,
                         loadedAssetHashes=scenario.assets, screenshot=relative(path))
                    report['artifacts'].append(relative(path))
                except Exception as error:
                    case(report, 'V01-capture-' + tag, 'FAIL', error=str(error), traceback=traceback.format_exc())
                finally:
                    if scenario:
                        scenario.close()
    case(report, 'V01-human-acceptance', 'NOT RUN', detail='24 captures are review candidates; visual acceptance requires human review.')


def event_capture(browser, base, args, fixture, report, out):
    for board in fixture['boards']:
        for size in ((1366, 768), (390, 844), (844, 390)):
            tag = f'{board["id"]}-{size[0]}x{size[1]}'
            locale = 'zh-Hant' if args.suite == 'p1b' and board['id'] == 'hex-r56' and size == (1366, 768) else 'en'
            scenario = Scenario(browser, base, args.renderer, fixture, board, locale, size, report, out,
                                video=True, motion='no-preference', initial='baseline')
            trace = out / f'events-{tag}.zip'
            video = scenario.page.video
            scenario.context.tracing.start(screenshots=True, snapshots=True, sources=False)
            try:
                started = time.monotonic()
                checkpoints = []
                for step in board['sequence']:
                    scenario.page.wait_for_timeout(max(0, step['atMs'] - (time.monotonic() - started) * 1000))
                    scenario.send(step['snapshot'])
                    if args.suite == 'p1b':
                        scenario.page.wait_for_timeout(320 if step['command']['type'] == 'turn.roll' else 100)
                        checkpoint = scenario.page.evaluate("""() => ({flights:document.querySelectorAll('[data-testid="production-flight"]').length,
                          drops:document.querySelectorAll('.board__building-drop').length,reveals:document.querySelectorAll('.board__road-reveal').length,
                          overlayPointer:document.querySelector('[data-testid="board-effects"]') ? getComputedStyle(document.querySelector('[data-testid="board-effects"]')).pointerEvents:null,
                          aggregateText:document.querySelector('.board-effects__aggregate text')?.textContent,
                          rollingToolbar:document.querySelectorAll('.board__dice--rolling').length})""")
                        image = out / f'event-{tag}-{step["command"]["type"]}.png'
                        scenario.page.screenshot(path=str(image))
                        checkpoint.update(command=step['command']['type'], screenshot=relative(image))
                        checkpoints.append(checkpoint)
                        if step['command']['type'] == 'turn.roll':
                            scenario.page.wait_for_timeout(290)
                            receipt_image = out / f'event-{tag}-production-receipt.png'
                            scenario.page.screenshot(path=str(receipt_image))
                            checkpoint['receiptScreenshot'] = relative(receipt_image)
                scenario.page.wait_for_timeout(max(0, 10000 - (time.monotonic() - started) * 1000))
                actual = scenario.page.evaluate(GEOMETRY)
                expected = board['sequence'][-1]['snapshot']['view']['board']
                okay = (actual['roads'] == sum(bool(item) for item in expected['roads'])
                        and actual['buildings'] == sum(bool(item) for item in expected['buildings'])
                        and not scenario.errors and not scenario.unmapped)
                if args.suite == 'p1b':
                    expected_grants = next(event['params']['grants'] for event in board['sequence'][0]['snapshot']['view']['events'] if event['type'] == 'production.resolved')
                    grant_types = sum(1 for resources in expected_grants.values() for amount in resources.values() if amount > 0)
                    okay = okay and checkpoints[0]['flights'] == min(24, grant_types) and checkpoints[1]['drops'] == 1 and checkpoints[2]['reveals'] == 1 and all(c['rollingToolbar'] == 0 and c['overlayPointer'] == 'none' for c in checkpoints)
                    if grant_types:
                        okay = okay and checkpoints[0]['aggregateText'] == ('實際彙總配發' if locale == 'zh-Hant' else 'Aggregate allocation')
                case(report, 'T01-sequence-' + tag, 'PASS' if okay else 'FAIL', fixture=board['id'],
                     topology=board['topologyId'], locale=locale, viewport=list(size),
                     operation='Replay recorded authorized full snapshots over mocked WebSocket for 10s.',
                     actual=actual, checkpoints=checkpoints, errors=scenario.errors, unmapped=scenario.unmapped, trace=relative(trace))
            finally:
                scenario.context.tracing.stop(path=str(trace))
                scenario.close()
            video_path = out / f'events-{tag}.webm'
            video.save_as(str(video_path))
            report['artifacts'].extend([relative(trace), relative(video_path)])


# Only sample rAF intervals while an observed CSS animation runs. Idle demand
# gaps are deliberately excluded; this is a scheduler proxy, not GPU render time.
FRAME_SAMPLE = """duration => new Promise(resolve => {
 const raw=[], start=performance.now(); let previous=null;
 function frame(now) {
  const active=document.getAnimations().some(a=>a.playState==='running');
  if(active && previous!==null) raw.push({atMs:now-start,intervalMs:now-previous});
  previous=active?now:null;
  if(now-start<duration) requestAnimationFrame(frame); else resolve(raw);
 } requestAnimationFrame(frame);
})"""


def performance_before(browser, base, args, fixture, report, out):
    board = fixture['boards'][-1]
    records = []
    for label, size in (('desktop', (1366, 768)), ('emulated-mobile', (390, 844))):
        scenario = Scenario(browser, base, args.renderer, fixture, board, 'en', size, report, out,
                            motion='no-preference', initial='baseline')
        try:
            # Warm the existing roll animation before recording three equal windows.
            scenario.send(board['sequence'][0]['snapshot'])
            scenario.page.wait_for_timeout(2000)
            next_seq = board['sequence'][0]['snapshot']['view']['seq']
            next_revision = board['sequence'][0]['snapshot']['revision']
            for repetition in range(3):
                trace = out / f'frames-{label}-{repetition + 1}.zip'
                scenario.context.tracing.start(screenshots=True, snapshots=True, sources=False)
                timeline = None
                completed = []
                if args.browser == 'chromium':
                    timeline = scenario.context.new_cdp_session(scenario.page)
                    timeline.on('Tracing.tracingComplete', lambda event: completed.append(event))
                    timeline.send('Tracing.start', {'categories': 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.frame', 'transferMode': 'ReturnAsStream'})
                scenario.page.evaluate('duration => {window.__boardFrameResult=null; (' + FRAME_SAMPLE + ')(duration).then(r=>window.__boardFrameResult=r)}', 30000)
                started = time.monotonic()
                for pulse in range(10):
                    scenario.page.wait_for_timeout(max(0, pulse * 3000 - (time.monotonic() - started) * 1000))
                    snapshot = copy.deepcopy(board['sequence'][0]['snapshot'])
                    events = [event for event in snapshot['view']['events'] if event['type'] in ('turn.rolled', 'production.resolved')]
                    for event in events:
                        next_seq += 1
                        event['seq'] = next_seq
                    next_revision += 1
                    snapshot['revision'] = next_revision
                    snapshot['view']['seq'] = next_seq
                    snapshot['view']['events'] = events
                    scenario.send(snapshot)
                scenario.page.wait_for_function('window.__boardFrameResult !== null', timeout=35000)
                raw = scenario.page.evaluate('window.__boardFrameResult')
                scenario.context.tracing.stop(path=str(trace))
                timeline_path = None
                if timeline:
                    timeline.send('Tracing.end')
                    deadline = time.monotonic() + 20
                    while not completed and time.monotonic() < deadline:
                        scenario.page.wait_for_timeout(50)
                    if not completed:
                        raise RuntimeError('Chromium timeline did not complete')
                    handle = completed[0]['stream']
                    timeline_path = out / f'frames-{label}-{repetition + 1}.timeline.json'
                    with timeline_path.open('wb') as target:
                        while True:
                            chunk = timeline.send('IO.read', {'handle': handle})
                            target.write(base64.b64decode(chunk['data']) if chunk.get('base64Encoded') else chunk['data'].encode('utf-8'))
                            if chunk.get('eof'):
                                break
                    timeline.send('IO.close', {'handle': handle})
                    timeline.detach()
                    report['artifacts'].append(relative(timeline_path))
                intervals = sorted(item['intervalMs'] for item in raw)
                p95 = intervals[max(0, __import__('math').ceil(len(intervals) * .95) - 1)] if intervals else None
                record = {'device': label, 'viewport': list(size), 'dpr': 1, 'repetition': repetition + 1,
                          'windowMs': 30000, 'activeSamples': len(raw), 'p95Ms': p95,
                          'maxMs': max(intervals) if intervals else None, 'raw': raw, 'trace': relative(trace),
                          'browserTimeline': relative(timeline_path) if timeline_path else None}
                records.append(record)
                report['metrics']['activeFrameIntervals'] = records
                report['artifacts'].append(relative(trace))
                case(report, f'P01-{"after" if args.suite == "p1b" else "before"}-{label}-{repetition + 1}', 'PASS' if raw and not scenario.errors else 'FAIL',
                     operation='Warm then sample 30s; replay roll snapshots every 3s with contiguous monotonic fixture event sequences (presentation load only).',
                     actual={key: value for key, value in record.items() if key != 'raw'}, errors=scenario.errors)
                write_report(report, out)
        finally:
            scenario.close()
    report['metrics']['activeFrameIntervals'] = records
    case(report, 'P01-reference-hardware-targets', 'NOT RUN', detail='Local desktop and emulated mobile capture only; reference mobile hardware and 60Hz/power calibration are unavailable. Sample PASS means evidence captured, not performance acceptance.')


def p1b_checks(browser, base, args, fixture, report, out):
    board = fixture['boards'][-1]
    # Both initial and changing reduced motion use real browser media queries.
    for mode in ('reduce', 'no-preference'):
        scenario = Scenario(browser, base, args.renderer, fixture, board, 'en', (390, 844), report, out, motion=mode, initial='baseline')
        try:
            scenario.send(board['sequence'][0]['snapshot'])
            scenario.page.wait_for_timeout(100)
            before = scenario.page.locator('[data-testid="board-effects"]').count()
            scenario.page.emulate_media(reduced_motion='reduce')
            scenario.page.wait_for_timeout(100)
            after = scenario.page.locator('[data-testid="board-effects"]').count()
            dice = scenario.page.get_by_test_id('dice-roll-animation').inner_text()
            okay = before == (0 if mode == 'reduce' else 1) and after == 0 and '2' in dice and '4' in dice and not scenario.errors
            path = out / f'reduce-{mode}.png'
            scenario.page.screenshot(path=str(path))
            case(report, 'A01-browser-' + mode, 'PASS' if okay else 'FAIL', before=before, after=after, persistentDice=dice, screenshot=relative(path), errors=scenario.errors)
            # Instrumented application rAF only: the fixture runner does not schedule during this window.
            before_raf = scenario.page.evaluate('window.__appRafCalls')
            scenario.page.wait_for_timeout(30000)
            after_raf = scenario.page.evaluate('window.__appRafCalls')
            case(report, 'P02-reduce-' + mode, 'PASS' if before_raf == after_raf else 'FAIL', windowMs=30000, rafCalls=after_raf-before_raf, activeAnimations=scenario.page.evaluate("document.getAnimations().filter(a=>a.playState==='running').length"))
        finally:
            scenario.close()
    scenario = Scenario(browser, base, args.renderer, fixture, board, 'en', (1366, 768), report, out, motion='no-preference', initial='historySnapshot')
    try:
        history = scenario.page.locator('[data-testid="board-effects"],[data-testid="dice-focus"]').count()
        before_raf = scenario.page.evaluate('window.__appRafCalls')
        scenario.page.wait_for_timeout(30000)
        case(report, 'E01-P02-history-idle', 'PASS' if history == 0 and before_raf == scenario.page.evaluate('window.__appRafCalls') else 'FAIL', windowMs=30000, historicalOverlays=history, operation='Load full authorized history; no replay or application RAF during 30s idle.')
    finally:
        scenario.close()
    markup = []
    for item in board['privacy']:
        viewer_fixture = copy.deepcopy(fixture)
        viewer_fixture['identity'] = item['identity']
        viewer_board = copy.deepcopy(board)
        viewer_board['baseline'] = item['baseline']
        scenario = Scenario(browser, base, args.renderer, viewer_fixture, viewer_board, 'en', (1366, 768), report, out, motion='no-preference', initial='baseline')
        trace = out / f'privacy-{item["viewer"]}.zip'
        scenario.context.tracing.start(screenshots=True, snapshots=True, sources=False)
        try:
            scenario.send(item['snapshot'])
            scenario.page.get_by_test_id('neutral-theft').wait_for(state='attached')
            overlay = scenario.page.get_by_test_id('board-effects')
            markup.append(overlay.inner_html())
            screenshot = out / f'privacy-{item["viewer"]}.png'
            scenario.page.screenshot(path=str(screenshot))
            hidden = all(player['id'] == item['viewer'] or 'resources' not in player for player in item['snapshot']['view']['players'])
            case(report, 'A05-projection-' + item['viewer'], 'PASS' if hidden and not scenario.errors and overlay.text_content() == '' else 'FAIL', viewer=item['viewer'], screenshot=relative(screenshot), errors=scenario.errors, operation='Deliver own projected engine theft snapshot over browser WebSocket; overlay contains neutral geometry only.', trace=relative(trace))
        finally:
            scenario.context.tracing.stop(path=str(trace))
            scenario.close()
    case(report, 'V05-neutral-three-seats-outsider', 'PASS' if len(set(markup)) == 1 else 'FAIL', distinctOverlayMarkup=len(set(markup)), viewers=[item['viewer'] for item in board['privacy']], detail='Compares only the presentation overlay; authorized private hand/log content intentionally differs per viewer.')
    case(report, 'P03-P04-P05-P06-device-assistive', 'NOT RUN', detail='No owner registry/heap/GPU trend, cold cache timing, 100-input paint or real 6-seat acknowledgement benchmark; no physical device or screen reader acceptance.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url')
    parser.add_argument('--renderer', choices=('svg', 'pixi', 'r3f'), default='svg')
    parser.add_argument('--out', required=True)
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--browser', choices=('chromium', 'firefox', 'webkit'), default='chromium')
    parser.add_argument('--executable-path')
    parser.add_argument('--suite', choices=('control', 'p1b'), default='control', help='p1b adds animation checkpoints, reduced motion, history and projected theft privacy checks')
    args = parser.parse_args()
    out = output_path(args.out)
    report = {'runId': out.name, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'status': 'BLOCKED', 'commit': None, 'dirty': None, 'mode': 'fixture', 'renderer': args.renderer,
              'assetHashes': {}, 'environment': {}, 'cases': [], 'metrics': {}, 'artifacts': [],
              'limitations': ['API and WebSocket are fixture routes; no real command acknowledgement or P06 measured.',
                              'No physical mobile device, screen reader, input latency, heap/GPU leak proof or visual acceptance.',
                              'rAF intervals are active CSS animation scheduling proxies, not GPU render time.',
                              'P1A baselines historical snapshots without replay. Static comparison still omits history for continuity with the P0 control.',
                              'Existing index.html keeps lang=zh-Hant even with English selected. Captures verify the actual locale switch; document language is recorded as an existing accessibility gap.',
                              'T01 denotes this runner provenance/replay check; acceptance document has no separate T section.']}
    child = temporary = log = None
    try:
        git = ['git', '-c', f'safe.directory={ROOT.as_posix()}']
        report['commit'] = command(git + ['rev-parse', 'HEAD'])
        status = command(git + ['status', '--porcelain'])
        report['dirty'] = bool(status)
        report['workingTreeStatus'] = status.splitlines()
        report['environment'] = environment()
        fixture_path = (ROOT / args.fixture).resolve()
        fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
        report['fixture'] = {'path': relative(fixture_path), 'sha256': sha(fixture_path.read_bytes()), 'seed': fixture['seed']}
        report['limitations'].extend(fixture['limitations'])
        if args.renderer != 'svg':
            raise Blocked('P0 implements SVG comparison only; GPU renderer is not implemented or authorized yet')
        if args.base_url:
            base = args.base_url.rstrip('/')
            report['server'] = {'ownership': 'external, never stopped by runner', 'baseUrl': base}
        else:
            base, child, temporary, log = start_server(out)
            report['server'] = {'ownership': 'runner', 'baseUrl': base, 'pid': child.pid,
                                'temporaryDirectory': temporary.name,
                                'artifactSha256': sha((ROOT / 'packages/server/dist/server.mjs').read_bytes()),
                                'database': 'independent temporary SQLite, deleted in finally'}
        verify_assets(base, report)
        # Import after provenance checks, so a stale external service always fails first.
        try:
            from playwright.sync_api import sync_playwright
            import playwright
            report['environment']['playwright'] = importlib.metadata.version('playwright')
            revisions = Path(playwright.__file__).parent / 'driver/package/browsers.json'
            report['environment']['browserRevisions'] = json.loads(revisions.read_text(encoding='utf-8'))['browsers']
        except ImportError as error:
            raise Blocked('Playwright missing in this Python; use .tmp/board-visual-venv and install playwright') from error
        os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', str(ROOT / '.tmp/board-visual-browsers'))
        with sync_playwright() as playwright_api:
            browser_type = getattr(playwright_api, args.browser)
            executable = args.executable_path or browser_type.executable_path
            report['environment'].update(browser=args.browser, browserExecutable=executable,
                                         executableSha256=sha(Path(executable).read_bytes()) if Path(executable).is_file() else None)
            try:
                browser = browser_type.launch(headless=True, executable_path=executable)
            except Exception as error:
                raise Blocked(f'browser launch failed: {error}; install managed {args.browser} with PLAYWRIGHT_BROWSERS_PATH=.tmp/board-visual-browsers') from error
            report['environment']['browserVersion'] = browser.version
            try:
                static_matrix(browser, base, args, fixture, report, out)
                write_report(report, out)
                event_capture(browser, base, args, fixture, report, out)
                write_report(report, out)
                if args.suite == 'p1b':
                    p1b_checks(browser, base, args, fixture, report, out)
                    write_report(report, out)
                performance_before(browser, base, args, fixture, report, out)
            finally:
                browser.close()
        report['status'] = 'FAIL' if any(item['status'] == 'FAIL' for item in report['cases']) else 'PASS'
    except KeyboardInterrupt:
        report['status'] = 'BLOCKED'
        report['blocker'] = 'Run interrupted; completed evidence retained and own resources cleaned.'
        case(report, 'runner', 'BLOCKED', error=report['blocker'])
    except Blocked as error:
        report['status'] = 'BLOCKED'
        report['blocker'] = str(error)
        case(report, 'runner', 'BLOCKED', error=str(error))
    except Exception as error:
        report['status'] = 'FAIL'
        case(report, 'runner', 'FAIL', error=str(error), traceback=traceback.format_exc())
    finally:
        stop_server(child, temporary, log)
        if 'server' in report and child is not None:
            report['server']['cleanup'] = {'childExitCode': child.returncode, 'temporaryDatabaseRemoved': not Path(temporary.name).exists()}
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        report['artifacts'] = sorted(set(report['artifacts'] + [relative(path) for path in out.rglob('*') if path.is_file()]))
        write_report(report, out)
    print(json.dumps({'status': report['status'], 'cases': len(report['cases']), 'report': relative(out / 'report.json')}, ensure_ascii=False), flush=True)
    return 0 if report['status'] == 'PASS' else 2 if report['status'] == 'BLOCKED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
