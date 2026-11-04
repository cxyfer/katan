/**
 * Decision helper for the Explorers & Pirates browser harness. It reads one
 * JSON line per request from stdin — `{"state": <persisted GameState>}` — and
 * answers with the scripted fixture bot's next command for whoever owes one:
 * `{"actor": "...", "command": {...}}` or `{"actor": null}`.
 *
 * The bot is the same one the rules fixtures play whole games with
 * (packages/rules/test/ep-sim.ts). The harness sends the command through the
 * real HTTP API as that player, so the service applies it with its own dice.
 *
 * Usage: node --experimental-transform-types scripts/explorers-pirates/bot.mjs   (long-running, line protocol)
 */

import { createInterface } from 'node:readline';
import { seededRng } from '../../packages/rules/src/index.ts';
import { epBotStep } from '../../packages/rules/test/ep-sim.ts';

const rng = seededRng(Number(process.env.EP_BOT_SEED ?? 20251));
const memo = { turnNo: 0 };
let step = 0;

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let answer;
  try {
    const { state } = JSON.parse(line);
    const decision = epBotStep(state, rng, step++, memo);
    answer = decision ? { actor: decision.actor, command: decision.command } : { actor: null };
  } catch (error) {
    answer = { actor: null, error: String(error?.stack ?? error) };
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}
