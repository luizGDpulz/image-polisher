interface SchedulerLike {
  yield?: () => Promise<void>;
}

/**
 * Cede o controle à thread principal priorizando `scheduler.yield()` quando
 * disponível, com fallback para macrotask via `setTimeout(..., 0)`.
 */
export function yieldToMain(): Promise<void> {
  const maybeScheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (maybeScheduler && typeof maybeScheduler.yield === 'function') {
    return maybeScheduler.yield();
  }
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Lança `AbortError` quando o sinal de cancelamento foi acionado.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Exportação cancelada pelo usuário.', 'AbortError');
  }
}
