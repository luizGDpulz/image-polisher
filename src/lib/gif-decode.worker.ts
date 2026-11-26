import { decompressFrame, parseGIF } from 'gifuct-js';

interface WorkerDecodeRequest {
  buffer: ArrayBuffer;
  maxFrames: number;
}

interface DedicatedWorkerGlobalScopeLike {
  onmessage: ((event: MessageEvent<WorkerDecodeRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScopeLike;

workerScope.onmessage = (event: MessageEvent<WorkerDecodeRequest>) => {
  try {
    const { buffer, maxFrames } = event.data;
    const gif = parseGIF(buffer);
    const imageFrames = gif.frames.filter(
      (f): f is Extract<(typeof gif.frames)[number], { image: unknown }> =>
        'image' in f && Boolean(f.image)
    );

    if (imageFrames.length <= 1) {
      workerScope.postMessage({ type: 'static' });
      return;
    }

    const limit = Math.min(imageFrames.length, Math.max(2, maxFrames));
    workerScope.postMessage({
      type: 'meta',
      width: gif.lsd.width,
      height: gif.lsd.height,
      total: limit,
    });

    for (let i = 0; i < limit; i++) {
      const frame = decompressFrame(imageFrames[i]!, gif.gct, true);
      const patch =
        frame.patch.byteOffset === 0 && frame.patch.byteLength === frame.patch.buffer.byteLength
          ? frame.patch
          : frame.patch.slice();

      workerScope.postMessage(
        {
          type: 'frame',
          index: i,
          total: limit,
          dims: frame.dims,
          delay: frame.delay,
          disposalType: frame.disposalType,
          patch: patch.buffer,
        },
        [patch.buffer]
      );
    }

    workerScope.postMessage({ type: 'done' });
  } catch (err) {
    workerScope.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Falha ao decodificar GIF em segundo plano.',
    });
  }
};
