/**
 * bench 的命令列解析（純函式，`test/bench-args.test.ts` 測它）。
 *
 *   bench [局數] [設定名稱片段] [--profile <id>] [--markdown <path>] [--seed <起點>]
 *
 * 選項一律嚴格檢查：缺值、值以 `-` 開頭（多半是漏打值、吃掉了下一個選項）、重複、或不認得的選項都是錯誤，
 * 不會默默忽略。
 */

export interface BenchArgs {
  games: number;
  /** 只跑名稱包含這段文字的設定。 */
  filter: string | undefined;
  profileId: string | undefined;
  /** 把結果表寫成 markdown 檔的路徑。 */
  markdown: string | undefined;
  /** 第一局的種子；預設 10000（舊行為），holdout 用 50000 起。 */
  seed: number;
}

export class BenchArgError extends Error {}

export const DEFAULT_BENCH_SEED = 10_000;

export const BENCH_USAGE = 'usage: bench [games] [name filter] [--profile <profile id>] [--markdown <file>] [--seed <first seed>]';

const VALUE_OPTIONS = ['--profile', '--markdown', '--seed'] as const;
type ValueOption = (typeof VALUE_OPTIONS)[number];

export function parseBenchArgs(argv: readonly string[]): BenchArgs {
  const positional: string[] = [];
  const values: Partial<Record<ValueOption, string>> = {};
  const setValue = (option: ValueOption, value: string | undefined): void => {
    if (value === undefined || value === '' || value.startsWith('-')) {
      throw new BenchArgError(`${option} needs a value${value ? `, got "${value}"` : ''}`);
    }
    if (values[option] !== undefined) throw new BenchArgError(`${option} was given twice`);
    values[option] = value;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const option = VALUE_OPTIONS.find((candidate) => arg === candidate || arg.startsWith(`${candidate}=`));
    if (option) {
      if (arg === option) setValue(option, argv[++index]);
      else setValue(option, arg.slice(option.length + 1));
    } else if (arg.startsWith('-')) {
      throw new BenchArgError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 2) throw new BenchArgError(`unexpected argument "${positional[2]}"`);
  const rawGames = positional[0] ?? '100';
  if (!/^[1-9]\d*$/.test(rawGames)) throw new BenchArgError(`games must be a positive integer, got "${rawGames}"`);
  const rawSeed = values['--seed'];
  if (rawSeed !== undefined && !/^(0|[1-9]\d{0,8})$/.test(rawSeed)) {
    throw new BenchArgError(`--seed must be a non-negative integer, got "${rawSeed}"`);
  }
  return {
    games: Number(rawGames),
    filter: positional[1],
    profileId: values['--profile'],
    markdown: values['--markdown'],
    seed: rawSeed === undefined ? DEFAULT_BENCH_SEED : Number(rawSeed),
  };
}
