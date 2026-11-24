import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { renderShadowCanvas } from './shadow-engine';
import type { BorderRadiusConfig, ShadowConfig } from './types';

export interface DecodedGifFrame {
  canvas: HTMLCanvasElement;
  delayMs: number;
}

export interface DecodedGifResult {
  frames: DecodedGifFrame[];
  width: number;
  height: number;
}

/**
 * Decodifica um arquivo GIF em frames compostos (respeitando disposalType e delays).
 * Retorna null se o GIF possuir apenas 1 frame (estático).
 */
export async function decodeAnimatedGif(file: File): Promise<DecodedGifResult | null> {
  const buffer = await file.arrayBuffer();
  const gif = parseGIF(buffer);
  const rawFrames = decompressFrames(gif, true);

  if (rawFrames.length <= 1) {
    return null;
  }

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const compositeCanvas = document.createElement('canvas');
  compositeCanvas.width = width;
  compositeCanvas.height = height;
  const compositeCtx = compositeCanvas.getContext('2d', { willReadFrequently: true });
  if (!compositeCtx) {
    throw new Error('Contexto 2D indisponível para decodificar GIF');
  }

  const patchCanvas = document.createElement('canvas');
  const patchCtx = patchCanvas.getContext('2d');
  if (!patchCtx) {
    throw new Error('Contexto auxiliar indisponível para decodificar GIF');
  }

  const frames: DecodedGifFrame[] = [];
  let previousImageData: ImageData | null = null;

  for (const frame of rawFrames) {
    if (frame.disposalType === 3) {
      previousImageData = compositeCtx.getImageData(0, 0, width, height);
    }

    const { width: fw, height: fh, left, top } = frame.dims;
    if (fw > 0 && fh > 0) {
      patchCanvas.width = fw;
      patchCanvas.height = fh;
      const patchImageData = new ImageData(
        new Uint8ClampedArray(frame.patch),
        fw,
        fh
      );
      patchCtx.putImageData(patchImageData, 0, 0);
      compositeCtx.drawImage(patchCanvas, left, top);
    }

    const frameSnapshot = document.createElement('canvas');
    frameSnapshot.width = width;
    frameSnapshot.height = height;
    const snapCtx = frameSnapshot.getContext('2d');
    if (snapCtx) {
      snapCtx.drawImage(compositeCanvas, 0, 0);
    }

    frames.push({
      canvas: frameSnapshot,
      delayMs: Math.max(20, frame.delay || 100),
    });

    if (frame.disposalType === 2) {
      compositeCtx.clearRect(left, top, fw, fh);
    } else if (frame.disposalType === 3 && previousImageData) {
      compositeCtx.putImageData(previousImageData, 0, 0);
    }
  }

  return { frames, width, height };
}

/**
 * Renderiza todos os frames com sombra aplicada e codifica um GIF animado client-side.
 * Usa fundo branco sólido para preservar a suavidade do blur gaussiano da sombra.
 */
export async function encodeAnimatedGifToBlob(
  frames: DecodedGifFrame[],
  shadowConfig: ShadowConfig,
  onProgress?: (current: number, total: number) => void,
  borderRadius?: BorderRadiusConfig
): Promise<Blob> {
  const gif = GIFEncoder();
  const frameCanvas = document.createElement('canvas');

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const { width, height } = renderShadowCanvas(frameCanvas, frame.canvas, shadowConfig, {
      fillBackground: '#ffffff',
      borderRadius,
    });

    const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Falha ao ler pixels do frame GIF');
    }

    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);

    gif.writeFrame(index, width, height, {
      palette,
      delay: frame.delayMs,
      repeat: i === 0 ? 0 : undefined,
    });

    onProgress?.(i + 1, frames.length);

    // Cede o event loop periodicamente para não travar a UI em GIFs longos
    if (i % 6 === 5) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  gif.finish();
  const bytes = gif.bytes();
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}
