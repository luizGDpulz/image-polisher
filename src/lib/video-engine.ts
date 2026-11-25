import {
  DEFAULT_VIDEO_FPS,
  HARD_MAX_FRAMES,
  RECOMMENDED_MAX_FRAMES,
  type AnimationFrameSource,
  type VideoConfig,
} from './types';
import { throwIfAborted } from './yield-main';

export interface VideoExportPlan {
  config: VideoConfig;
  width: number;
  height: number;
  clipDuration: number;
  frameCount: number;
  delayMs: number;
  timestamps: number[];
  isHighFrameCount: boolean;
  wasCapped: boolean;
}

export interface LoadedVideoAsset {
  video: HTMLVideoElement;
  objectUrl: string;
  duration: number;
  nativeWidth: number;
  nativeHeight: number;
  thumbDataUrl: string;
  posterCanvas: HTMLCanvasElement;
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg'] as const;

/**
 * Gera uma miniatura compacta (Data URL) a partir de imagem ou canvas para o rodapé de lote.
 */
export function createThumbnailDataUrl(
  source: HTMLImageElement | HTMLCanvasElement,
  maxDim = 64
): string {
  const srcW = source instanceof HTMLImageElement ? source.naturalWidth || 1 : source.width || 1;
  const srcH = source instanceof HTMLImageElement ? source.naturalHeight || 1 : source.height || 1;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = targetW;
  thumbCanvas.height = targetH;
  const tCtx = thumbCanvas.getContext('2d');
  if (tCtx) {
    tCtx.drawImage(source, 0, 0, targetW, targetH);
  }

  try {
    const webpUrl = thumbCanvas.toDataURL('image/webp', 0.78);
    if (webpUrl.startsWith('data:image/webp')) {
      return webpUrl;
    }
  } catch {
    // Fallback para PNG caso o ambiente não suporte data URL WebP
  }

  return thumbCanvas.toDataURL('image/png');
}

/**
 * Identifica arquivos de vídeo por MIME type ou extensão suportada pelos navegadores.
 */
export function isVideoFile(file: { type?: string; name?: string }): boolean {
  const mime = (file.type ?? '').toLowerCase();
  if (mime.startsWith('video/')) {
    return true;
  }
  if (mime && !mime.startsWith('application/')) {
    return false;
  }
  const lowerName = (file.name ?? '').toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/**
 * Calcula dimensões proporcionais de exportação limitadas a `maxWidth` sem fazer upscale.
 */
export function computeScaledVideoDimensions(
  nativeWidth: number,
  nativeHeight: number,
  maxWidth: number
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(Number.isFinite(nativeWidth) ? nativeWidth : 1));
  const safeH = Math.max(1, Math.round(Number.isFinite(nativeHeight) ? nativeHeight : 1));
  const limit = Number.isFinite(maxWidth) && maxWidth > 0 ? Math.round(maxWidth) : 0;

  if (limit === 0 || safeW <= limit) {
    return { width: safeW, height: safeH };
  }

  const ratio = limit / safeW;
  return {
    width: Math.max(1, limit),
    height: Math.max(1, Math.round(safeH * ratio)),
  };
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Normaliza parâmetros de FPS, largura máxima e intervalo de recorte do vídeo.
 */
export function sanitizeVideoConfig(
  raw: Partial<VideoConfig>,
  duration: number
): VideoConfig {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0.1;
  const minSpan = Math.min(0.1, safeDuration);

  const rawFps = typeof raw.fps === 'number' && Number.isFinite(raw.fps) ? raw.fps : DEFAULT_VIDEO_FPS;
  const fps = Math.min(30, Math.max(5, Math.round(rawFps)));

  const rawMaxW =
    typeof raw.maxWidth === 'number' && Number.isFinite(raw.maxWidth) ? raw.maxWidth : 0;
  const maxWidth = rawMaxW > 0 ? Math.max(64, Math.round(rawMaxW)) : 0;

  const maxStart = Math.max(0, roundTwoDecimals(safeDuration - minSpan));
  const rawStart =
    typeof raw.trimStart === 'number' && Number.isFinite(raw.trimStart) ? raw.trimStart : 0;
  const trimStart = roundTwoDecimals(Math.min(maxStart, Math.max(0, rawStart)));

  const minEnd = Math.min(safeDuration, roundTwoDecimals(trimStart + minSpan));
  const rawEnd =
    typeof raw.trimEnd === 'number' && Number.isFinite(raw.trimEnd) ? raw.trimEnd : safeDuration;
  const trimEnd = roundTwoDecimals(Math.min(safeDuration, Math.max(minEnd, rawEnd)));

  return {
    fps,
    maxWidth,
    trimStart,
    trimEnd,
  };
}

/**
 * Gera o plano determinístico de amostragem de frames e dimensões para preview/exportação de vídeo.
 */
export function computeVideoExportPlan(
  nativeWidth: number,
  nativeHeight: number,
  duration: number,
  rawConfig: Partial<VideoConfig>
): VideoExportPlan {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0.1;
  const config = sanitizeVideoConfig(rawConfig, safeDuration);
  const { width, height } = computeScaledVideoDimensions(nativeWidth, nativeHeight, config.maxWidth);

  const clipDuration = Math.max(0.05, roundTwoDecimals(config.trimEnd - config.trimStart));
  const delayMs = Math.max(20, Math.round(1000 / config.fps));
  const rawCount = Math.max(1, Math.round(clipDuration * config.fps));
  const wasCapped = rawCount > HARD_MAX_FRAMES;
  const frameCount = Math.min(rawCount, HARD_MAX_FRAMES);
  const isHighFrameCount = frameCount > RECOMMENDED_MAX_FRAMES;

  const maxSafeTime = Math.max(0, safeDuration - 0.005);
  const timestamps: number[] = [];

  for (let i = 0; i < frameCount; i++) {
    const rawTime =
      frameCount === 1
        ? config.trimStart
        : config.trimStart + (i / frameCount) * clipDuration;
    timestamps.push(Math.min(maxSafeTime, Math.max(0, rawTime)));
  }

  return {
    config,
    width,
    height,
    clipDuration,
    frameCount,
    delayMs,
    timestamps,
    isHighFrameCount,
    wasCapped,
  };
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function waitForVideoLoadedData(
  video: HTMLVideoElement,
  signal?: AbortSignal,
  timeoutMs = 12000
): Promise<void> {
  if (video.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    throwIfAborted(signal);

    let settled = false;
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      window.clearTimeout(timer);
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };

    const onLoaded = () => finish();
    const onError = () =>
      finish(new Error('Não foi possível decodificar o vídeo selecionado neste navegador.'));
    const onAbort = () =>
      finish(new DOMException('Exportação cancelada pelo usuário.', 'AbortError'));

    const timer = window.setTimeout(
      () => finish(new Error('Tempo limite excedido ao carregar metadados do vídeo.')),
      timeoutMs
    );

    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Posiciona um elemento `<video>` no instante desejado garantindo flush do decoder.
 */
export async function seekVideoToTime(
  video: HTMLVideoElement,
  targetTime: number,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal);

  const clamped = Math.max(0, targetTime);
  if (Math.abs(video.currentTime - clamped) < 0.0005 && video.readyState >= 2) {
    await nextAnimationFrame();
    throwIfAborted(signal);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      window.clearTimeout(timer);
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };

    const onSeeked = () => finish();
    const onError = () => finish(new Error('Falha ao avançar frame do vídeo durante leitura.'));
    const onAbort = () =>
      finish(new DOMException('Exportação cancelada pelo usuário.', 'AbortError'));

    const timer = window.setTimeout(
      () => finish(new Error('Tempo limite ao posicionar frame do vídeo.')),
      3000
    );

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });

    video.currentTime = clamped;
  });

  await nextAnimationFrame();
  throwIfAborted(signal);
}

/**
 * Carrega um arquivo de vídeo em `<video>` mudo, resolve duração real (inclusive WebM sem header)
 * e captura o frame inicial como poster e miniatura.
 */
export async function loadVideoAsset(file: File): Promise<LoadedVideoAsset> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  try {
    await waitForVideoLoadedData(video);

    // Alguns arquivos WebM gravados ao vivo reportam duration === Infinity até o seek ao final
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener('timeupdate', done);
          video.removeEventListener('seeked', done);
          window.clearTimeout(timer);
          resolve();
        };
        const timer = window.setTimeout(done, 1500);
        video.addEventListener('timeupdate', done, { once: true });
        video.addEventListener('seeked', done, { once: true });
        video.currentTime = 1e7;
      });
      await seekVideoToTime(video, 0).catch(() => undefined);
    }

    const duration =
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const nativeWidth = Math.max(1, video.videoWidth || 1);
    const nativeHeight = Math.max(1, video.videoHeight || 1);

    const posterCanvas = document.createElement('canvas');
    posterCanvas.width = nativeWidth;
    posterCanvas.height = nativeHeight;
    const pCtx = posterCanvas.getContext('2d');
    if (pCtx) {
      pCtx.drawImage(video, 0, 0, nativeWidth, nativeHeight);
    }

    return {
      video,
      objectUrl,
      duration,
      nativeWidth,
      nativeHeight,
      thumbDataUrl: createThumbnailDataUrl(posterCanvas),
      posterCanvas,
    };
  } catch (err) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

/**
 * Cria uma fonte de frames sob demanda usando um `<video>` oculto dedicado,
 * evitando interferir no player de preview e mantendo uso constante de RAM.
 */
export function createVideoFrameSource(
  objectUrl: string,
  nativeWidth: number,
  nativeHeight: number,
  duration: number,
  config: Partial<VideoConfig>
): AnimationFrameSource {
  const plan = computeVideoExportPlan(nativeWidth, nativeHeight, duration, config);

  return {
    totalFrames: plan.frameCount,
    async *iterateFrames(signal?: AbortSignal) {
      const hiddenVideo = document.createElement('video');
      hiddenVideo.muted = true;
      hiddenVideo.playsInline = true;
      hiddenVideo.preload = 'auto';
      hiddenVideo.src = objectUrl;

      const workCanvas = document.createElement('canvas');
      workCanvas.width = plan.width;
      workCanvas.height = plan.height;
      const wCtx = workCanvas.getContext('2d');
      if (!wCtx) {
        throw new Error('Contexto 2D indisponível para extrair frames do vídeo.');
      }
      wCtx.imageSmoothingEnabled = true;
      wCtx.imageSmoothingQuality = 'high';

      try {
        await waitForVideoLoadedData(hiddenVideo, signal);

        for (const timestamp of plan.timestamps) {
          throwIfAborted(signal);
          await seekVideoToTime(hiddenVideo, timestamp, signal);

          wCtx.clearRect(0, 0, plan.width, plan.height);
          wCtx.drawImage(hiddenVideo, 0, 0, plan.width, plan.height);

          yield {
            canvas: workCanvas,
            delayMs: plan.delayMs,
          };
        }
      } finally {
        hiddenVideo.pause();
        hiddenVideo.removeAttribute('src');
        hiddenVideo.load();
      }
    },
  };
}

/**
 * Libera recursos de memória e ObjectURL associados a um vídeo carregado.
 */
export function disposeVideoAsset(asset?: LoadedVideoAsset): void {
  if (!asset) return;
  asset.video.pause();
  asset.video.removeAttribute('src');
  asset.video.load();
  URL.revokeObjectURL(asset.objectUrl);
}
