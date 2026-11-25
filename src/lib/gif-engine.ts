import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { renderShadowCanvas } from './shadow-engine';
import type {
  AnimationFrameSource,
  BorderRadiusConfig,
  ShadowConfig,
} from './types';
import { iterateAnimationSource, throwIfAborted, yieldToMain } from './yield-main';

export interface DecodedGifFrame {
  canvas: HTMLCanvasElement;
  delayMs: number;
}

export interface DecodedGifResult {
  frames: DecodedGifFrame[];
  width: number;
  height: number;
}

export interface GifEncodeOptions {
  borderRadius?: BorderRadiusConfig;
  dithering?: boolean;
  loop?: boolean;
  backgroundColor?: string;
  onProgress?: (current: number, total: number) => void;
  signal?: AbortSignal;
}

function findNearestPaletteIndex(
  r: number,
  g: number,
  b: number,
  palette: number[][]
): number {
  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < palette.length; i++) {
    const entry = palette[i]!;
    const dr = r - entry[0]!;
    const dg = g - entry[1]!;
    const db = b - entry[2]!;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      if (dist === 0) break;
    }
  }

  return bestIdx;
}

/**
 * Aplica a paleta de cores com difusão de erro Floyd-Steinberg e cache RGB565,
 * suavizando gradientes de vídeo e sombras sem mutar o buffer `rgba` de entrada.
 */
export function applyPaletteWithDithering(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  palette: number[][]
): Uint8Array {
  const pixelCount = Math.max(0, width) * Math.max(0, height);
  const out = new Uint8Array(pixelCount);
  if (pixelCount === 0 || palette.length === 0) {
    return out;
  }

  // Cache preguiçoso RGB565 (65.536 entradas) evita varrer 256 cores por pixel
  const rgb565Cache = new Int16Array(65536).fill(-1);
  const stride = (width + 2) * 3;
  let curErr = new Float32Array(stride);
  let nextErr = new Float32Array(stride);

  for (let y = 0; y < height; y++) {
    nextErr.fill(0);
    const rowPixelOffset = y * width;

    for (let x = 0; x < width; x++) {
      const srcIdx = (rowPixelOffset + x) * 4;
      const errIdx = (x + 1) * 3;

      const rawR = rgba[srcIdx]! + curErr[errIdx]!;
      const rawG = rgba[srcIdx + 1]! + curErr[errIdx + 1]!;
      const rawB = rgba[srcIdx + 2]! + curErr[errIdx + 2]!;

      const cr = rawR < 0 ? 0 : rawR > 255 ? 255 : rawR;
      const cg = rawG < 0 ? 0 : rawG > 255 ? 255 : rawG;
      const cb = rawB < 0 ? 0 : rawB > 255 ? 255 : rawB;

      const ir = (cr + 0.5) | 0;
      const ig = (cg + 0.5) | 0;
      const ib = (cb + 0.5) | 0;
      const key = ((ir & 0xf8) << 8) | ((ig & 0xfc) << 3) | (ib >> 3);

      let palIdx = rgb565Cache[key]!;
      if (palIdx < 0) {
        palIdx = findNearestPaletteIndex(ir, ig, ib, palette);
        rgb565Cache[key] = palIdx;
      }

      out[rowPixelOffset + x] = palIdx;

      const chosen = palette[palIdx]!;
      const errR = cr - chosen[0]!;
      const errG = cg - chosen[1]!;
      const errB = cb - chosen[2]!;

      // (x + 1, y) += 7/16
      const rightIdx = errIdx + 3;
      curErr[rightIdx] = curErr[rightIdx]! + errR * (7 / 16);
      curErr[rightIdx + 1] = curErr[rightIdx + 1]! + errG * (7 / 16);
      curErr[rightIdx + 2] = curErr[rightIdx + 2]! + errB * (7 / 16);

      // (x - 1, y + 1) += 3/16
      const downLeftIdx = errIdx - 3;
      nextErr[downLeftIdx] = nextErr[downLeftIdx]! + errR * (3 / 16);
      nextErr[downLeftIdx + 1] = nextErr[downLeftIdx + 1]! + errG * (3 / 16);
      nextErr[downLeftIdx + 2] = nextErr[downLeftIdx + 2]! + errB * (3 / 16);

      // (x, y + 1) += 5/16
      nextErr[errIdx] = nextErr[errIdx]! + errR * (5 / 16);
      nextErr[errIdx + 1] = nextErr[errIdx + 1]! + errG * (5 / 16);
      nextErr[errIdx + 2] = nextErr[errIdx + 2]! + errB * (5 / 16);

      // (x + 1, y + 1) += 1/16
      nextErr[rightIdx] = nextErr[rightIdx]! + errR * (1 / 16);
      nextErr[rightIdx + 1] = nextErr[rightIdx + 1]! + errG * (1 / 16);
      nextErr[rightIdx + 2] = nextErr[rightIdx + 2]! + errB * (1 / 16);
    }

    const swap = curErr;
    curErr = nextErr;
    nextErr = swap;
  }

  return out;
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
 * Renderiza todos os frames com sombra e bordas aplicadas e codifica um GIF animado client-side.
 * Suporta lista em memória ou streaming de frames (`AnimationFrameSource`), dithering e cancelamento.
 */
export async function encodeAnimatedGifToBlob(
  source: DecodedGifFrame[] | AnimationFrameSource,
  shadowConfig: ShadowConfig,
  options?: GifEncodeOptions
): Promise<Blob> {
  const totalFrames = Array.isArray(source) ? source.length : source.totalFrames;
  if (totalFrames <= 0) {
    throw new Error('Nenhum frame disponível para codificar GIF.');
  }

  const useDithering = options?.dithering !== false;
  const repeatValue = options?.loop === false ? -1 : 0;
  const backgroundColor = options?.backgroundColor ?? '#ffffff';

  const gif = GIFEncoder();
  const frameCanvas = document.createElement('canvas');
  let frameIdx = 0;

  for await (const frame of iterateAnimationSource(source, options?.signal)) {
    throwIfAborted(options?.signal);

    const { width, height } = renderShadowCanvas(frameCanvas, frame.canvas, shadowConfig, {
      fillBackground: backgroundColor,
      borderRadius: options?.borderRadius,
    });

    const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Falha ao ler pixels do frame GIF');
    }

    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = useDithering
      ? applyPaletteWithDithering(data, width, height, palette)
      : applyPalette(data, palette, 'rgb565');

    gif.writeFrame(index, width, height, {
      palette,
      delay: Math.max(20, Math.round(frame.delayMs)),
      repeat: frameIdx === 0 ? repeatValue : undefined,
    });

    frameIdx++;
    options?.onProgress?.(frameIdx, totalFrames);
    await yieldToMain();
  }

  throwIfAborted(options?.signal);
  gif.finish();
  const bytes = gif.bytes();
  return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
}
