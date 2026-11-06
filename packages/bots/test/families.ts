/**
 * Family 登記檔（策略 §4.6；PL-2 建立，各擴充的測試切片各加一筆）。
 *
 * 通用矩陣（`harness.ts` 的 `BOT_TEST_MATRIX`）涵蓋所有 `enabled` 且 Bot 玩得動的 profile。
 * 擴充（Seafarers、T&B、E&P、C&K）各有自己的 family 測試檔，明列自己的 profile，不依賴
 * `BOT_TEST_MATRIX`，所以在 gating 翻轉前就能跑 B-GAME；B-GAME、B-POLICY 與 Q2 計數共用同一批對局。
 *
 * - 沒有 `generic` 的 family：自己的測試檔涵蓋這些 profile，通用矩陣跳過它們，避免重跑。
 * - `generic: true`：由通用矩陣的測試檔涵蓋（目前只有 base），通用矩陣照跑。
 *
 * `matrix.test.ts` 的守門測試會檢查：`BOT_TEST_MATRIX` 的每個 profile 至少登記在一個 family，
 * 登記的測試檔存在，而且檔案內容真的提到這些 profile（或使用通用矩陣）。
 */

export interface BotTestFamily {
  readonly id: string;
  /** 這個 family 明列涵蓋的 profile id。 */
  readonly profiles: readonly string[];
  /** 涵蓋這些 profile 的測試檔，相對於 `test/`。 */
  readonly files: readonly string[];
  /** 由通用矩陣涵蓋（通用矩陣不跳過這些 profile）。 */
  readonly generic?: true;
}

/** 使用通用矩陣的測試檔；它們的內容必須提到 `GENERIC_MATRIX`。 */
export const GENERIC_MATRIX_FILES: readonly string[] = [
  'policy.test.ts',
  'fair.test.ts',
  'fuzz.test.ts',
  'fallback.test.ts',
];

export const BOT_FAMILIES: readonly BotTestFamily[] = [
  {
    id: 'base',
    profiles: ['base-2025', 'base-paired-2025'],
    files: GENERIC_MATRIX_FILES,
    generic: true,
  },
];

/** 有專屬測試檔的 family 所涵蓋的 profile；通用矩陣跳過它們。 */
export function dedicatedProfileIds(families: readonly BotTestFamily[] = BOT_FAMILIES): ReadonlySet<string> {
  return new Set(families.filter((family) => !family.generic).flatMap((family) => family.profiles));
}

/**
 * 登記檔的一致性檢查：回傳問題清單，空陣列表示通過。純函式，`sources` 是測試檔名到原始碼文字的對照。
 *
 * - `profileIds` 的每個 profile 至少登記在一個 family，而且該 family 有一個真實存在的測試檔涵蓋它：
 *   檔案內容提到 profile id，或（`generic` family）提到 `GENERIC_MATRIX`。
 * - family 登記的 profile 與測試檔都必須存在，避免登記了卻沒有測。
 */
export function familyCoverageProblems(
  profileIds: readonly string[],
  families: readonly BotTestFamily[],
  sources: Readonly<Record<string, string>>,
  knownProfileIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const covers = (family: BotTestFamily, file: string, profileId: string): boolean => {
    const text = sources[file];
    if (text === undefined) return false;
    return text.includes(`'${profileId}'`) || (family.generic === true && text.includes('GENERIC_MATRIX'));
  };
  for (const family of families) {
    for (const file of family.files) {
      if (sources[file] === undefined) problems.push(`${family.id}: test file ${file} does not exist`);
    }
    for (const profileId of family.profiles) {
      if (!knownProfileIds.has(profileId)) problems.push(`${family.id}: unknown profile ${profileId}`);
    }
  }
  for (const profileId of profileIds) {
    const covered = families.some(
      (family) =>
        family.profiles.includes(profileId) && family.files.some((file) => covers(family, file, profileId)),
    );
    if (!covered) problems.push(`${profileId}: no test file covers it (register a family in families.ts)`);
  }
  return problems;
}
