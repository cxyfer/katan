/** Client-generated identifiers. `commandId`/`clientMessageId` are UUIDs. */

let counter = 0;

export function newId(prefix: string): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid = cryptoObj?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function newCommandId(): string {
  return newId('cmd');
}

export function newChatId(): string {
  return newId('chat');
}

export function newRequestId(): string {
  return newId('save');
}
