/** B-GUARD：策略只依賴規則套件，不碰網路、時間、環境或非決定性的亂數。 */

import { describe, expect, it } from 'vitest';
import manifest from '../package.json';

const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

/** 把相對 specifier 解析成與 `sources` 鍵相同形式的路徑（不依賴 Node 的 path）。 */
function resolveSpecifier(file: string, specifier: string): string {
  const parts = file.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

describe('B-GUARD source boundaries', () => {
  it('scans every strategy source file', () => {
    const files = Object.keys(sources);
    expect(files).toEqual(expect.arrayContaining(['../src/heuristic.ts', '../src/fallback.ts', '../src/types.ts']));
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('imports only the rules package and files inside src', () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      for (const match of text.matchAll(/\bfrom\s+'([^']+)'/g)) {
        const specifier = match[1]!;
        if (specifier === '@catan/rules') continue;
        const relative = specifier.startsWith('./') || specifier.startsWith('../');
        if (!relative || !resolveSpecifier(file, specifier).startsWith('../src/')) offenders.push(`${file}: ${specifier}`);
      }
      if (/\bimport\s*\(|\brequire\s*\(/.test(text)) offenders.push(`${file}: dynamic import`);
    }
    expect(offenders).toEqual([]);
  });

  it('never reaches the network, clock, environment or Math.random', () => {
    const forbidden: [string, RegExp][] = [
      ['node builtin', /['"]node:/],
      ['fetch', /\bfetch\s*\(/],
      ['sockets', /\b(XMLHttpRequest|WebSocket|EventSource)\b/],
      ['process', /\bprocess\./],
      ['clock', /\b(Date|performance)\b/],
      ['timers', /\b(setTimeout|setInterval|setImmediate|queueMicrotask)\b/],
      ['Math.random', /Math\.random/],
      ['globalThis', /\bglobalThis\b/],
      ['eval', /\b(eval|Function)\s*\(/],
    ];
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      // 註解裡提到這些字不算違規。
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const [label, pattern] of forbidden) if (pattern.test(code)) offenders.push(`${file}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });

  it('declares no runtime dependency besides the rules package', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@catan/rules']);
    expect((manifest as { devDependencies?: unknown }).devDependencies).toBeUndefined();
  });
});
