/** Serializes complete CLI exchanges, including the reply, without coalescing distinct commands. */
export function createMeshcoreRepeaterCliQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const queued = (tails.get(key) ?? Promise.resolve()).then(operation);
    const tail = queued.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return queued;
  };
}

export function redactMeshcoreCliSecrets(command: string, response?: string): string {
  const trimmed = command.trim();
  if (/^(?:password\b|(?:get|set)\s+(?:guest\.password|prv\.key)\b)/i.test(trimmed)) {
    if (response !== undefined) return '[redacted]';
    return trimmed.replace(
      /^(password|(?:get|set)\s+(?:guest\.password|prv\.key))\b.*/i,
      '$1 [redacted]',
    );
  }
  return response ?? command;
}

/** Keep the argument delimiter when clearing a firmware string preference. */
export function normalizeMeshcoreCliCommand(command: string): string {
  return /^set\s+(?:name|guest\.password|owner\.info) /i.test(command.trimStart())
    ? command.trimStart()
    : command.trim();
}
