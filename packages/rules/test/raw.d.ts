/** Vite `?raw` imports used by fixtures that inspect engine source text. */
declare module '*?raw' {
  const content: string;
  export default content;
}

/** Vite `import.meta.glob`, used to scan rules-module sources. */
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>;
}
