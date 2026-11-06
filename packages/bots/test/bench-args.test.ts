/** bench 的命令列解析：缺值、被吃掉的值、重複與不認得的選項都要報錯，不能默默忽略。 */

import { describe, expect, it } from 'vitest';
import { BenchArgError, parseBenchArgs } from '../bench/args.ts';

describe('parseBenchArgs', () => {
  it('uses 100 games and no profile by default', () => {
    expect(parseBenchArgs([])).toEqual({ games: 100, filter: undefined, profileId: undefined, markdown: undefined });
  });

  it('reads the game count, the name filter and the options in any order', () => {
    expect(parseBenchArgs(['10'])).toMatchObject({ games: 10 });
    expect(parseBenchArgs(['10', '4p'])).toMatchObject({ games: 10, filter: '4p' });
    expect(parseBenchArgs(['10', '--profile', 'base-2025'])).toMatchObject({ games: 10, profileId: 'base-2025' });
    expect(parseBenchArgs(['--profile=base-paired-2025', '5', '6p'])).toMatchObject({
      games: 5,
      filter: '6p',
      profileId: 'base-paired-2025',
    });
    expect(parseBenchArgs(['3', '--markdown', '/tmp/out.md', '--profile', 'base-2025'])).toMatchObject({
      markdown: '/tmp/out.md',
      profileId: 'base-2025',
    });
  });

  it('rejects --profile without a value, or with a value that looks like another option', () => {
    expect(() => parseBenchArgs(['10', '--profile'])).toThrow(BenchArgError);
    expect(() => parseBenchArgs(['10', '--profile'])).toThrow('--profile needs a value');
    expect(() => parseBenchArgs(['10', '--profile='])).toThrow('--profile needs a value');
    // 漏打 profile id，--markdown 被當成值吞掉：必須報錯，而不是用 "--markdown" 當 profile。
    expect(() => parseBenchArgs(['10', '--profile', '--markdown', 'out.md'])).toThrow(
      '--profile needs a value, got "--markdown"',
    );
    expect(() => parseBenchArgs(['--profile=--x'])).toThrow('--profile needs a value');
  });

  it('rejects --markdown without a value', () => {
    expect(() => parseBenchArgs(['--markdown'])).toThrow('--markdown needs a value');
    expect(() => parseBenchArgs(['--markdown', '--profile', 'base-2025'])).toThrow('--markdown needs a value');
  });

  it('rejects an option given twice', () => {
    expect(() => parseBenchArgs(['--profile', 'a', '--profile', 'b'])).toThrow('--profile was given twice');
    expect(() => parseBenchArgs(['--profile=a', '--profile', 'b'])).toThrow('--profile was given twice');
  });

  it('rejects unknown options, including near misses and single dashes', () => {
    for (const bad of ['--profil', '--profiles', '--verbose', '-p', '--', '--help']) {
      expect(() => parseBenchArgs(['10', bad]), bad).toThrow(`unknown option ${bad}`);
    }
    // 值寫成 `--profile` 的前綴相同但不是它：不能被當成 --profile=。
    expect(() => parseBenchArgs(['--profilebase-2025'])).toThrow('unknown option --profilebase-2025');
  });

  it('rejects a game count that is not a positive decimal integer', () => {
    for (const bad of ['0', '-3', '2.5', 'ten', '1e1', '0x10', '010']) {
      expect(() => parseBenchArgs([bad]), bad).toThrow(BenchArgError);
    }
  });

  it('rejects stray extra arguments', () => {
    expect(() => parseBenchArgs(['10', '4p', 'extra'])).toThrow('unexpected argument "extra"');
  });
});
