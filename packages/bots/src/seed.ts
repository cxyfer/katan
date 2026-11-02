/** 以 FNV-1a 把片段雜湊成 32-bit 無號整數，作為決策種子。 */
export function botSeed(...parts: readonly (string | number)[]): number {
  const text = parts.join(':');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
