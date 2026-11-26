import type { DecodedGifFrame, DecodedGifResult } from './gif-engine';
import { renderShadowCanvas } from './shadow-engine';
import {
  HARD_MAX_FRAMES,
  type AnimationFrameSource,
  type BorderRadiusConfig,
  type ShadowConfig,
} from './types';
import { iterateAnimationSource, throwIfAborted, yieldToMain } from './yield-main';

export interface WebpFrameChunksResult {
  chunks: Uint8Array;
  hasAlpha: boolean;
}

export interface WebpMuxFrameInput {
  chunks: Uint8Array;
  width: number;
  height: number;
  durationMs: number;
}

export interface WebpMuxOptions {
  width: number;
  height: number;
  loopCount?: number;
  hasAlpha?: boolean;
  backgroundColorBGRA?: readonly [number, number, number, number];
}

export interface WebpEncodeOptions {
  borderRadius?: BorderRadiusConfig;
  quality?: number;
  loop?: boolean;
  onProgress?: (current: number, total: number) => void;
  signal?: AbortSignal;
}

const MAX_WEBP_DIMENSION = 16777216;

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!
  );
}

function writeFourCC(target: Uint8Array, offset: number, fourCC: string): void {
  target[offset] = fourCC.charCodeAt(0);
  target[offset + 1] = fourCC.charCodeAt(1);
  target[offset + 2] = fourCC.charCodeAt(2);
  target[offset + 3] = fourCC.charCodeAt(3);
}

function writeUint24LE(target: Uint8Array, offset: number, value: number): void {
  const v = Math.max(0, Math.min(0xffffff, value | 0));
  target[offset] = v & 0xff;
  target[offset + 1] = (v >>> 8) & 0xff;
  target[offset + 2] = (v >>> 16) & 0xff;
}

function writeUint32LE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function buildEvenChunk(fourCC: string, payload: Uint8Array): Uint8Array {
  const size = payload.byteLength;
  const paddedSize = size + (size & 1);
  const out = new Uint8Array(8 + paddedSize);
  writeFourCC(out, 0, fourCC);
  writeUint32LE(out, 4, size);
  out.set(payload, 8);
  return out;
}

/**
 * Extrai apenas os chunks de bitstream de um quadro WebP (`ALPH`, `VP8 `, `VP8L`),
 * removendo containers extras (`VP8X`, `ICCP`, `EXIF`, `XMP `) e garantindo
 * ordenação válida (`ALPH` antes de `VP8 `) e alinhamento par conforme RFC 9649.
 */
export function extractWebpFrameChunks(webpBytes: Uint8Array): WebpFrameChunksResult {
  if (webpBytes.byteLength < 12) {
    throw new Error('Arquivo WebP inválido: cabeçalho RIFF muito curto.');
  }
  if (readFourCC(webpBytes, 0) !== 'RIFF' || readFourCC(webpBytes, 8) !== 'WEBP') {
    throw new Error('Arquivo WebP inválido: assinatura RIFF/WEBP ausente.');
  }

  const view = new DataView(webpBytes.buffer, webpBytes.byteOffset, webpBytes.byteLength);
  let offset = 12;
  let alphChunk: Uint8Array | null = null;
  let vp8Chunk: Uint8Array | null = null;
  let vp8lChunk: Uint8Array | null = null;
  let hasAlpha = false;

  while (offset + 8 <= webpBytes.byteLength) {
    const fourCC = readFourCC(webpBytes, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;

    if (dataEnd > webpBytes.byteLength) {
      throw new Error(`Chunk WebP '${fourCC}' truncado além do fim do buffer.`);
    }

    const payload = webpBytes.subarray(dataStart, dataEnd);

    if (fourCC === 'ALPH') {
      hasAlpha = true;
      alphChunk = buildEvenChunk('ALPH', payload);
    } else if (fourCC === 'VP8 ') {
      vp8Chunk = buildEvenChunk('VP8 ', payload);
    } else if (fourCC === 'VP8L') {
      if (payload.byteLength >= 5 && payload[0] === 0x2f) {
        const vp8lHeader = view.getUint32(dataStart + 1, true);
        if (((vp8lHeader >>> 28) & 1) === 1) {
          hasAlpha = true;
        }
      }
      vp8lChunk = buildEvenChunk('VP8L', payload);
    }

    const pad = chunkSize & 1;
    offset = dataEnd + pad;
  }

  if (vp8Chunk) {
    if (alphChunk) {
      const combined = new Uint8Array(alphChunk.byteLength + vp8Chunk.byteLength);
      combined.set(alphChunk, 0);
      combined.set(vp8Chunk, alphChunk.byteLength);
      return { chunks: combined, hasAlpha: true };
    }
    return { chunks: vp8Chunk, hasAlpha };
  }

  if (vp8lChunk) {
    return { chunks: vp8lChunk, hasAlpha };
  }

  throw new Error('WebP inválido: nenhum chunk de imagem (VP8 ou VP8L) encontrado.');
}

/**
 * Monta um arquivo WebP animado em container RIFF (VP8X + ANIM + ANMF[]) conforme RFC 9649.
 * Usa flags ANMF `0x03` (sem blending + dispose para fundo transparente) para preservar
 * sombras suaves sem acúmulo entre frames.
 */
export function muxAnimatedWebp(
  frames: WebpMuxFrameInput[],
  options: WebpMuxOptions
): Uint8Array {
  if (frames.length === 0) {
    throw new Error('É necessário ao menos 1 frame para montar um WebP animado.');
  }

  const width = Math.trunc(options.width);
  const height = Math.trunc(options.height);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_WEBP_DIMENSION ||
    height > MAX_WEBP_DIMENSION
  ) {
    throw new Error(`Dimensões de canvas WebP inválidas: ${options.width}x${options.height}`);
  }

  let totalAnmfBytes = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const fw = Math.trunc(frame.width);
    const fh = Math.trunc(frame.height);
    if (
      !Number.isFinite(fw) ||
      !Number.isFinite(fh) ||
      fw < 1 ||
      fh < 1 ||
      fw > MAX_WEBP_DIMENSION ||
      fh > MAX_WEBP_DIMENSION
    ) {
      throw new Error(`Dimensões inválidas no frame WebP #${i + 1}: ${frame.width}x${frame.height}`);
    }
    if (frame.chunks.byteLength === 0) {
      throw new Error(`Frame WebP #${i + 1} sem chunks de bitstream.`);
    }

    const payloadLen = 16 + frame.chunks.byteLength;
    const paddedLen = payloadLen + (payloadLen & 1);
    totalAnmfBytes += 8 + paddedLen;
  }

  // RIFF header (12) + VP8X chunk (18) + ANIM chunk (14) + ANMF chunks
  const totalBytes = 12 + 18 + 14 + totalAnmfBytes;
  const out = new Uint8Array(totalBytes);

  // RIFF Header
  writeFourCC(out, 0, 'RIFF');
  writeUint32LE(out, 4, totalBytes - 8);
  writeFourCC(out, 8, 'WEBP');

  // VP8X Chunk (10 bytes payload)
  writeFourCC(out, 12, 'VP8X');
  writeUint32LE(out, 16, 10);
  // 0x10 = Alpha flag, 0x02 = Animation flag
  out[20] = (options.hasAlpha ? 0x10 : 0x00) | 0x02;
  out[21] = 0;
  out[22] = 0;
  out[23] = 0;
  writeUint24LE(out, 24, width - 1);
  writeUint24LE(out, 27, height - 1);

  // ANIM Chunk (6 bytes payload)
  writeFourCC(out, 30, 'ANIM');
  writeUint32LE(out, 34, 6);
  const bg = options.backgroundColorBGRA ?? [0, 0, 0, 0];
  out[38] = bg[0] & 0xff;
  out[39] = bg[1] & 0xff;
  out[40] = bg[2] & 0xff;
  out[41] = bg[3] & 0xff;
  const loopCount = Math.max(0, Math.min(0xffff, Math.trunc(options.loopCount ?? 0)));
  out[42] = loopCount & 0xff;
  out[43] = (loopCount >>> 8) & 0xff;

  // ANMF Chunks
  let cursor = 44;
  for (const frame of frames) {
    const payloadLen = 16 + frame.chunks.byteLength;
    const duration = Math.max(10, Math.min(0xffffff, Math.round(frame.durationMs)));

    writeFourCC(out, cursor, 'ANMF');
    writeUint32LE(out, cursor + 4, payloadLen);

    // Frame X / 2 (3B) = 0, Frame Y / 2 (3B) = 0
    writeUint24LE(out, cursor + 8, 0);
    writeUint24LE(out, cursor + 11, 0);
    writeUint24LE(out, cursor + 14, Math.trunc(frame.width) - 1);
    writeUint24LE(out, cursor + 17, Math.trunc(frame.height) - 1);
    writeUint24LE(out, cursor + 20, duration);
    // Flags: bit 1 (Do not blend = 1) + bit 0 (Dispose to background = 1) => 0x03
    out[cursor + 23] = 0x03;

    out.set(frame.chunks, cursor + 24);
    cursor += 8 + payloadLen + (payloadLen & 1);
  }

  return out;
}

function canvasToWebpBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob || blob.type !== 'image/webp') {
          reject(
            new Error(
              'Este navegador não suporta codificação nativa de WebP. Utilize o formato GIF.'
            )
          );
          return;
        }
        try {
          const buf = await blob.arrayBuffer();
          resolve(new Uint8Array(buf));
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Falha ao ler bytes do frame WebP.'));
        }
      },
      'image/webp',
      quality
    );
  });
}

/**
 * Renderiza todos os frames com bordas e sombra transparente (alfa de 8 bits)
 * e gera um WebP animado em loop via RIFF muxer client-side.
 */
export async function encodeAnimatedWebpToBlob(
  source: DecodedGifFrame[] | AnimationFrameSource,
  shadowConfig: ShadowConfig,
  options?: WebpEncodeOptions
): Promise<Blob> {
  const totalFrames = Array.isArray(source) ? source.length : source.totalFrames;
  if (totalFrames <= 0) {
    throw new Error('Nenhum frame disponível para codificar WebP animado.');
  }

  const rawQuality = options?.quality ?? 0.88;
  const clampedQuality = Math.min(1, Math.max(0.05, rawQuality));
  const loopCount = options?.loop === false ? 1 : 0;

  const frameCanvas = document.createElement('canvas');
  const muxFrames: WebpMuxFrameInput[] = [];
  let canvasWidth = 0;
  let canvasHeight = 0;
  let anyHasAlpha = false;
  let frameIdx = 0;

  for await (const frame of iterateAnimationSource(source, options?.signal)) {
    throwIfAborted(options?.signal);

    const { width, height } = renderShadowCanvas(frameCanvas, frame.canvas, shadowConfig, {
      borderRadius: options?.borderRadius,
    });

    canvasWidth = width;
    canvasHeight = height;

    const webpBytes = await canvasToWebpBytes(frameCanvas, clampedQuality);
    throwIfAborted(options?.signal);

    const extracted = extractWebpFrameChunks(webpBytes);
    if (extracted.hasAlpha) {
      anyHasAlpha = true;
    }

    muxFrames.push({
      chunks: extracted.chunks,
      width,
      height,
      durationMs: frame.delayMs,
    });

    frameIdx++;
    options?.onProgress?.(frameIdx, totalFrames);
    await yieldToMain();
  }

  throwIfAborted(options?.signal);

  const muxedBytes = muxAnimatedWebp(muxFrames, {
    width: canvasWidth,
    height: canvasHeight,
    loopCount,
    hasAlpha: anyHasAlpha,
  });

  const safeBuffer = new Uint8Array(muxedBytes);
  return new Blob([safeBuffer], { type: 'image/webp' });
}

interface ImageDecoderTrackLike {
  frameCount: number;
}

interface ImageDecoderResultLike {
  image: VideoFrame;
}

interface ImageDecoderInstanceLike {
  tracks: {
    ready: Promise<void>;
    selectedTrack: ImageDecoderTrackLike | null;
  };
  decode(options?: { frameIndex?: number }): Promise<ImageDecoderResultLike>;
  close(): void;
}

interface ImageDecoderConstructorLike {
  new (init: { data: BufferSource; type: string }): ImageDecoderInstanceLike;
  isTypeSupported(type: string): Promise<boolean>;
}

export interface DecodeWebpOptions {
  onProgress?: (current: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Decodifica um arquivo WebP animado usando a API nativa `ImageDecoder`
 * com cedência cooperativa à thread principal, progresso e suporte a cancelamento.
 * Retorna `null` se for estático ou se o navegador não suportar `ImageDecoder`.
 */
export async function decodeAnimatedWebp(
  file: File,
  options?: DecodeWebpOptions
): Promise<DecodedGifResult | null> {
  throwIfAborted(options?.signal);

  const DecoderCtor = (globalThis as { ImageDecoder?: ImageDecoderConstructorLike }).ImageDecoder;
  if (!DecoderCtor || typeof DecoderCtor.isTypeSupported !== 'function') {
    return null;
  }

  const supported = await DecoderCtor.isTypeSupported('image/webp').catch(() => false);
  if (!supported) {
    return null;
  }

  const buffer = await file.arrayBuffer();
  throwIfAborted(options?.signal);

  const decoder = new DecoderCtor({ data: buffer, type: 'image/webp' });

  try {
    await decoder.tracks.ready;
    throwIfAborted(options?.signal);

    const total = decoder.tracks.selectedTrack?.frameCount ?? 0;
    if (total <= 1) {
      return null;
    }

    const limit = Math.min(total, HARD_MAX_FRAMES);
    const frames: DecodedGifFrame[] = [];
    let outWidth = 0;
    let outHeight = 0;
    let lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now();

    for (let i = 0; i < limit; i++) {
      throwIfAborted(options?.signal);

      const decoded = await decoder.decode({ frameIndex: i });
      const vf = decoded.image;

      try {
        const w = vf.displayWidth || vf.codedWidth || 1;
        const h = vf.displayHeight || vf.codedHeight || 1;
        outWidth = w;
        outHeight = h;

        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = w;
        frameCanvas.height = h;
        const ctx = frameCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(vf as unknown as CanvasImageSource, 0, 0, w, h);
        }

        const durationUs = vf.duration ?? 100_000;
        const delayMs = Math.max(20, Math.round(durationUs / 1000));
        frames.push({ canvas: frameCanvas, delayMs });
      } finally {
        vf.close();
      }

      options?.onProgress?.(i + 1, limit);

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastYield >= 12) {
        await yieldToMain();
        lastYield = typeof performance !== 'undefined' ? performance.now() : Date.now();
      }
    }

    if (frames.length <= 1) {
      return null;
    }

    return {
      frames,
      width: outWidth,
      height: outHeight,
    };
  } finally {
    decoder.close();
  }
}
