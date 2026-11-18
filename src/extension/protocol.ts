export type WebviewMessage =
  | { type: 'run'; prompt: string }
  | { type: 'accept' | 'reject' | 'preview'; proposalId: string; hunkId: string }
  | { type: 'ready' | 'cancel' | 'undo' | 'settings' };

export function parseMessage(value: unknown): WebviewMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== 'string') return;
  if (message.type === 'run' && Object.keys(message).length === 2 && typeof message.prompt === 'string' && message.prompt.trim() && message.prompt.length <= 32000) {
    return { type: 'run', prompt: message.prompt.trim() };
  }
  if (['accept', 'reject', 'preview'].includes(String(message.type)) && Object.keys(message).length === 3 && [message.proposalId, message.hunkId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) {
    return message as WebviewMessage;
  }
  if (['ready', 'cancel', 'undo', 'settings'].includes(String(message.type)) && Object.keys(message).length === 1) return message as WebviewMessage;
  return;
}
