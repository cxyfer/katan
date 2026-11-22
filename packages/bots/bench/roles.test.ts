/**
 * bench 的 `hard0` 角色：走凍結的舊 hard 基線（docs/aegis/specs/2026-11-22-hard-bot-v2.md V8），不碰 `src/hard/`；
 * 基線目錄的內容用雜湊鎖住，之後改 `src/hard/` 不會讓基線漂移。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { requireProfile } from '@katan/rules';
import { describe, expect, it, vi } from 'vitest';
import { policyOf } from './roles.ts';
import { baseProfileFor, runBotGame } from '../test/harness.ts';

const calls = vi.hoisted(() => ({ hard: 0 }));

// 計 `src/hard/` 的策略被呼叫幾次；行為照舊。
vi.mock('../src/hard/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/hard/index.ts')>();
  return {
    ...actual,
    hardPolicy: (...args: Parameters<typeof actual.hardPolicy>) => {
      const policy = actual.hardPolicy(...args);
      return {
        decide: (...decideArgs: Parameters<typeof policy.decide>) => {
          calls.hard += 1;
          return policy.decide(...decideArgs);
        },
      };
    },
  };
});

const profile = requireProfile(baseProfileFor(3));

function playBriefly(roles: readonly ('hard' | 'hard0' | 'standard')[]): void {
  runBotGame({
    seats: roles.map((role, index) => ({
      id: `bot${index + 1}`,
      level: role === 'hard0' ? 'hard' : role,
      policy: policyOf(role, profile),
    })),
    seed: 10_000,
    maxSteps: 400,
  });
}

describe('bench role hard0', () => {
  it('never reaches src/hard, while the hard role does', () => {
    calls.hard = 0;
    playBriefly(['hard0', 'standard', 'standard']);
    expect(calls.hard).toBe(0);
    playBriefly(['hard', 'standard', 'standard']);
    expect(calls.hard).toBeGreaterThan(0);
  });
});

describe('frozen hard baseline files', () => {
  // `src/hard/` 在 ffca6dc 的原樣複製（相對匯入改指向 ../../src/）；index.ts 另有說明標頭與改名。要改基線就是要
  // 換掉整個比較對象，必須在 PR 說明並重跑基準，不能只更新這份雜湊。
  const FROZEN: Readonly<Record<string, string>> = {
    'action.ts': '5aa5663f206d1dbd51f1a356f36a4c693947cdf33f694ba331d3a4568ee2782e',
    'build.ts': 'a2e0d3b9c1ad596c69210dc54fbbb6ef6b2cf826c73941568612fa897e8b5a6d',
    'cards.ts': 'f309c2aced5f7394c756a33d5fedcc24ccdbb118ed76620fe29984674cd544da',
    'economy.ts': 'a01d3014ecb2f2b92ef3d8fa180771ec2f3472b03bd1ae9e8e73fa176cc74358',
    'endgame.ts': '180955943d6260f20fa2e7802ef1133e012483ec31b921c84b615db180ccb20b',
    'index.ts': '4d39718ab1d1ee048756fd1f06e7e7f2c69444697be15257b2daa02548c8f8f2',
    'position.ts': '1dbfb3a5eb38328b203186efb409967d176126c5aa88ee3b3f7b43f5b755cf82',
    'robber.ts': '3d9a815c5c04739df000645a4b94dcc6ad7da588089751bab2f1acb9328041d1',
    'setup.ts': '90a44f130da564e69f1611942f22fb5eb749356af186d3a8c0306ee392b17efe',
    'trade.ts': 'f5933d02c51b8959d6eb7ef5391c30a2eff3e87049e8ffe81ac83504117e136b',
    'turn.ts': '376199ea69cdc04ef8678ea0e4079e407ad19a7420bcb9f2c2adc40925b409f3',
  };

  it.each(Object.entries(FROZEN))('%s is unchanged', (name, hash) => {
    const text = readFileSync(new URL(`./hard-baseline/${name}`, import.meta.url));
    expect(createHash('sha256').update(text).digest('hex')).toBe(hash);
  });
});
