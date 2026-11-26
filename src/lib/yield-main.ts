import type { AnimationFrameChunk, AnimationFrameSource } from './types';

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

/**
 * Itera de forma uniforme sobre frames pré-decodificados ou fontes por streaming.
 */
export async function* iterateAnimationSource(
  source: AnimationFrameChunk[] | AnimationFrameSource,
  signal?: AbortSignal
): AsyncIterable<AnimationFrameChunk> {
  if (Array.isArray(source)) {
    for (const frame of source) {
      throwIfAborted(signal);
      yield frame;
    }
    return;
  }

  for await (const frame of source.iterateFrames(signal)) {
    throwIfAborted(signal);
    yield frame;
  }
}
