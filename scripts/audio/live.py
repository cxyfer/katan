#!/usr/bin/env python3
"""實機音效檢查：真正的伺服器、真正的對局、真正的瀏覽器輸出。

用法：python3 scripts/audio/live.py <全新的空輸出目錄> [--port 3017]
需要先 `pnpm build`。

瀏覽器扮演房主（第一次點擊即解鎖音訊），另外兩位玩家透過 HTTP 加入並下指令。
每個權威事件經 WebSocket 抵達後，量測喇叭端分析器的峰值，確認：
- 他人的建造、擲骰會發聲；輪到自己時有提示；
- 全部靜音後，同樣的事件不再發聲；
- 過程中沒有主控台錯誤。
同時擷取音效設定面板在大廳、牌桌（桌機、手機、雙語）的截圖。
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

TAP_SCRIPT = """
(() => {
  const contexts = [];
  window.__audioContexts = contexts;
  const original = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = original.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode && this.context instanceof AudioContext) {
      const ctx = this.context;
      if (!ctx.__tap) { ctx.__tap = ctx.createAnalyser(); ctx.__tap.fftSize = 2048; contexts.push(ctx); }
      original.call(this, ctx.__tap);
    }
    return result;
  };
  window.__measure = async (ms) => {
    const ctx = contexts.at(-1);
    if (!ctx) return { state: 'none', peak: 0 };
    const data = new Float32Array(ctx.__tap.fftSize);
    let peak = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      ctx.__tap.getFloatTimeDomainData(data);
      for (const value of data) peak = Math.max(peak, Math.abs(value));
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return { state: ctx.state, peak };
  };
})();
"""

AUDIBLE = 0.01


class Bot:
    """以 HTTP 操作的玩家；cookie 由 urllib 的 opener 保存。"""

    def __init__(self, base: str, nickname: str):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
        self.player = self.call('POST', '/api/session', {'nickname': nickname, 'locale': 'en'})['player']

    def call(self, method: str, path: str, body: dict | None = None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, method=method,
                                         headers={'content-type': 'application/json'})
        with self.opener.open(request) as response:
            payload = json.loads(response.read())
        if not payload.get('ok'):
            raise RuntimeError(f'{method} {path}: {payload}')
        return payload['data']

    def command(self, game_id: str, command: dict) -> dict:
        snapshot = self.call('GET', f'/api/games/{game_id}')
        receipt = self.call('POST', f'/api/games/{game_id}/commands', {
            'commandId': str(uuid.uuid4()), 'expectedRevision': snapshot['revision'], 'command': command})
        if receipt['outcome'] != 'accepted':
            raise RuntimeError(f'{command}: {receipt}')
        return receipt


class HostActor(Bot):
    """瀏覽器裡的房主：透過頁面的 request（共用 cookie）下指令，事件仍經 WebSocket 回到畫面。"""

    def __init__(self, page, base: str):
        self.page = page
        self.base = base
        self.player = self.call('GET', '/api/session')['player']

    def call(self, method: str, path: str, body: dict | None = None):
        response = self.page.request.fetch(self.base + path, method=method, data=body)
        payload = response.json()
        if not payload.get('ok'):
            raise RuntimeError(f'{method} {path}: {payload}')
        return payload['data']


def wait_ready(base: str, timeout: float = 20) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(base + '/readyz') as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError('server did not become ready')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('out')
    parser.add_argument('--port', type=int, default=3017)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    base = f'http://127.0.0.1:{args.port}'
    data_dir = tempfile.mkdtemp(prefix='catan-audio-')
    env = {**os.environ, 'PORT': str(args.port), 'HOST': '127.0.0.1',
           'SQLITE_PATH': str(Path(data_dir) / 'catan.sqlite'),
           'WEB_DIST_PATH': str(ROOT / 'packages/web/dist')}
    log = open(out / 'server.log', 'w')
    server = subprocess.Popen(['node', str(ROOT / 'packages/server/dist/server.mjs')], env=env, stdout=log, stderr=log)
    report: dict = {'checks': [], 'failures': []}

    def check(name: str, measured: dict, audible: bool) -> None:
        ok = (measured['peak'] >= AUDIBLE) == audible
        report['checks'].append({'name': name, 'expectAudible': audible, **measured, 'ok': ok})
        if not ok:
            report['failures'].append(f'{name}: expected {"sound" if audible else "silence"}, peak {measured["peak"]:.4f}')

    try:
        wait_ready(base)
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--autoplay-policy=user-gesture-required'])
            context = browser.new_context(viewport={'width': 1366, 'height': 768}, locale='zh-TW')
            context.add_init_script("localStorage.setItem('catan.locale', 'zh-Hant');")
            context.add_init_script(TAP_SCRIPT)
            page = context.new_page()
            errors: list[str] = []
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.on('pageerror', lambda error: errors.append(str(error)))

            page.goto(base + '/?renderer=svg')
            page.get_by_test_id('nickname-input').fill('浮浮酱')
            page.locator('form button[type=submit]').first.click()
            page.get_by_test_id('create-room').click()
            page.get_by_test_id('room-code').wait_for()
            report['contextAfterFirstClick'] = page.evaluate('() => window.__audioContexts.map((c) => c.state)')
            if report['contextAfterFirstClick'] != ['running']:
                report['failures'].append(f'context not running after gesture: {report["contextAfterFirstClick"]}')
            code = page.get_by_test_id('room-code').inner_text().strip().split()[-1]
            page.get_by_test_id('lobby-capacity').select_option('3')
            if page.get_by_test_id('save-settings').is_enabled():
                page.get_by_test_id('save-settings').click()
                page.wait_for_timeout(400)

            # 大廳：只開效果音，關掉音樂，讓後續量測只看事件提示。
            page.locator('.sound-settings__toggle').click()
            page.get_by_test_id('sound-music').fill('0')
            page.wait_for_timeout(300)
            page.screenshot(path=str(out / 'lobby-sound-settings-zh-Hant.png'))
            page.keyboard.press('Escape')

            bots = [Bot(base, name) for name in ('Mika', 'Bo')]
            room = None
            # 有人加入會重設準備狀態：先全部入座，再一起按準備。
            for bot, color in zip(bots, ('blue', 'orange')):
                room = bot.call('POST', '/api/rooms/join', {'code': code})
                bot.call('POST', f'/api/rooms/{room["id"]}/seat', {'color': color})
            for bot in bots:
                bot.call('POST', f'/api/rooms/{room["id"]}/ready', {'ready': True})
            if page.locator('[data-testid^=seat-color-]').count():
                page.locator('[data-testid^=seat-color-]').first.click()
            page.get_by_test_id('toggle-ready').click()
            try:
                page.wait_for_function("!document.querySelector('[data-testid=start-game]').disabled", timeout=8000)
            except Exception:
                print('server room:', json.dumps(bots[0].call('GET', f'/api/rooms/{room["id"]}'), ensure_ascii=False)[:1500])
                print('blockers:', page.get_by_test_id('start-blockers').inner_text(),
                      'capacity:', page.get_by_test_id('lobby-capacity').input_value())
                raise
            page.get_by_test_id('start-game').click()
            page.get_by_test_id('board').wait_for()
            game_id = bots[0].call('GET', f'/api/rooms/{room["id"]}')['gameId']
            host = HostActor(page, base)
            players = {host.player['id']: host, **{bot.player['id']: bot for bot in bots}}

            def measure(ms: int) -> dict:
                return page.evaluate(f'() => window.__measure({ms})')

            def open_sound_panel() -> None:
                page.get_by_test_id('sound-settings-game').locator('summary').click()
                page.wait_for_timeout(250)

            # 開局蛇形擺放（0→1→2→2→1→0）。每次擺放的事件經 WebSocket 抵達瀏覽器後都應發聲；
            # 房主第二輪的村莊在全部靜音下擺放，應保持安靜。
            screenshot_taken = False
            for _ in range(12):
                view = bots[0].call('GET', f'/api/games/{game_id}')['view']
                setup = view['turn']['setup']
                if setup is None:
                    break
                actor = players[view['turn']['playerId']]
                hints = actor.call('GET', f'/api/games/{game_id}')['view']['hints']
                name = f"{actor.player['nickname']} round {setup['round']} {setup['stage']}"
                if setup['stage'] == 'building':
                    command = {'type': 'setup.placeBuilding', 'vertex': hints['legalSettlements'][0]}
                else:
                    command = {'type': 'setup.placeRoad', 'edge': hints['legalRoads'][0]}
                muted = actor is host and setup['round'] == 2 and setup['stage'] == 'building'
                if muted:
                    if not screenshot_taken:
                        open_sound_panel()
                        page.screenshot(path=str(out / 'table-sound-settings-zh-Hant.png'))
                        page.keyboard.press('Escape')
                        screenshot_taken = True
                    open_sound_panel()
                    page.get_by_test_id('sound-mute').check()
                    page.keyboard.press('Escape')
                    page.wait_for_timeout(300)
                actor.command(game_id, command)
                check(name + (' (muted)' if muted else ''), measure(1200), not muted)
                if muted:
                    open_sound_panel()
                    page.get_by_test_id('sound-mute').uncheck()
                    page.keyboard.press('Escape')
                    page.wait_for_timeout(300)

            # 開局結束後輪到房主擲骰：骰子聲應在演出期間響起。
            view = host.call('GET', f'/api/games/{game_id}')['view']
            report['afterSetup'] = {'turn': view['turn']['playerId'] == host.player['id'], 'phase': view['turn']['phase']}
            if view['turn']['playerId'] == host.player['id'] and view['hints']['canRoll']:
                host.command(game_id, {'type': 'turn.roll'})
                check('host roll', measure(1800), True)
            else:
                report['failures'].append(f'host could not roll after setup: {report["afterSetup"]}')

            # 英文介面、手機寬度的截圖。
            page.wait_for_timeout(2500)
            page.get_by_test_id('locale-switch-game').select_option('en')
            open_sound_panel()
            page.screenshot(path=str(out / 'table-sound-settings-en.png'))
            page.keyboard.press('Escape')
            page.set_viewport_size({'width': 390, 'height': 844})
            page.wait_for_timeout(500)
            open_sound_panel()
            page.screenshot(path=str(out / 'table-sound-settings-mobile-en.png'))
            page.keyboard.press('Escape')
            report['consoleErrors'] = errors
            # 入口畫面尚未建立身分時 WebSocket 會先被拒一次（master 既有行為，與音效無關）。
            unexpected = [text for text in errors if 'no valid credentials' not in text]
            report['failures'].extend(f'console: {text}' for text in unexpected)
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
        log.close()

    (out / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 1 if report['failures'] else 0


if __name__ == '__main__':
    sys.exit(main())
