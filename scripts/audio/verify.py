#!/usr/bin/env python3
"""音效瀏覽器檢查。

用法：python3 -I scripts/audio/verify.py <base-url> <全新的空輸出目錄>

1. 開啟 `?preview=sounds`，等每個提示的離線渲染完成，確認都有聲音且不爆音。
2. 以點擊（使用者手勢）啟動即時 AudioContext，量測背景音樂與效果音確實輸出訊號。
3. 擷取展示頁截圖，並把結果寫入 report.json。
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

# 在頁面腳本執行前攔截：所有接到喇叭的節點同時接一個分析器，才能量測即時輸出。
TAP_SCRIPT = """
(() => {
  const contexts = [];
  window.__audioContexts = contexts;
  const original = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = original.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode && this.context instanceof AudioContext) {
      const ctx = this.context;
      if (!ctx.__tap) {
        ctx.__tap = ctx.createAnalyser();
        ctx.__tap.fftSize = 2048;
        contexts.push(ctx);
      }
      original.call(this, ctx.__tap);
    }
    return result;
  };
  window.__measure = async (ms) => {
    const ctx = contexts.at(-1);
    if (!ctx) return { state: 'none', peak: 0, rms: 0 };
    const data = new Float32Array(ctx.__tap.fftSize);
    let peak = 0, sum = 0, count = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      ctx.__tap.getFloatTimeDomainData(data);
      for (const value of data) { peak = Math.max(peak, Math.abs(value)); sum += value * value; count += 1; }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return { state: ctx.state, time: ctx.currentTime, peak, rms: Math.sqrt(sum / Math.max(1, count)) };
  };
})();
"""


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    base = sys.argv[1].rstrip('/')
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=False)
    report: dict = {'base': base, 'cues': {}, 'failures': []}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=user-gesture-required'])
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        errors: list[str] = []
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script(TAP_SCRIPT)
        page.goto(f'{base}/?preview=sounds')
        page.wait_for_selector('[data-testid=sound-preview]')
        cues = page.eval_on_selector_all('[data-testid^=cue-]', 'nodes => nodes.map((n) => n.dataset.testid.slice(4))')
        page.wait_for_function(
            'count => document.querySelectorAll("[data-testid^=cue-][data-peak]").length === count',
            arg=len(cues), timeout=60000)
        for cue in cues:
            peak = float(page.get_attribute(f'[data-testid="cue-{cue}"]', 'data-peak'))
            report['cues'][cue] = peak
            if not 0.01 <= peak <= 1.0:
                report['failures'].append(f'{cue}: offline peak {peak} outside [0.01, 1.0]')

        before = page.evaluate('() => window.__audioContexts.length')
        report['contextsBeforeGesture'] = before
        if before != 0:
            report['failures'].append('AudioContext was created before any user gesture')

        page.click('[data-testid=music-island]')
        page.wait_for_timeout(2500)
        music = page.evaluate('() => window.__measure(3000)')
        report['music'] = music
        if music['state'] != 'running' or music['rms'] < 0.0005:
            report['failures'].append(f'music not audible: {music}')

        page.click('[data-testid=music-island]')
        page.wait_for_timeout(1500)
        quiet = page.evaluate('() => window.__measure(800)')
        report['musicStopped'] = quiet

        page.click('[data-testid="cue-build.city"]')
        effect = page.evaluate('() => window.__measure(1200)')
        report['effect'] = effect
        if effect['peak'] < 0.02 or effect['peak'] > 1.0:
            report['failures'].append(f'live effect peak out of range: {effect}')
        if quiet['rms'] > music['rms'] * 0.5:
            report['failures'].append(f'music did not fade after stopping: {quiet} vs {music}')

        page.screenshot(path=str(out / 'sound-preview.png'), full_page=True)
        report['consoleErrors'] = errors
        if errors:
            report['failures'].extend(f'console: {text}' for text in errors)
        browser.close()

    (out / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({key: report[key] for key in ('music', 'musicStopped', 'effect', 'failures')}, indent=2))
    return 1 if report['failures'] else 0


if __name__ == '__main__':
    sys.exit(main())
