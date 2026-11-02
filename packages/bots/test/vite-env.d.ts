/** Vite 的 `import.meta.glob`：守護測試以它讀取原始碼文字，不需要 Node 型別。 */
interface ImportMeta {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}
