import { decodeAnimatedGif, type DecodedGifFrame } from './gif-engine';
import { renderShadowCanvas } from './shadow-engine';
import {
  ANIMATED_FORMAT_OPTIONS,
  DEFAULT_VIDEO_FPS,
  FORMAT_OPTIONS,
  type AnimatedFormat,
  type BorderRadiusConfig,
  type ExportConfig,
  type ImageFormat,
  type MediaKind,
  type ShadowConfig,
  type VideoConfig,
} from './types';
import {
  createThumbnailDataUrl,
  isVideoFile,
  loadVideoAsset,
  sanitizeVideoConfig,
  type LoadedVideoAsset,
} from './video-engine';
import { decodeAnimatedWebp } from './webp-engine';
import { throwIfAborted } from './yield-main';

export interface LoadMediaOptions {
  signal?: AbortSignal;
  onProgress?: (info: { fraction: number; detailText?: string }) => void;
}

export interface LoadedImageResult {
  image: HTMLImageElement | HTMLCanvasElement;
  baseName: string;
  originalBytes: number;
  width: number;
  height: number;
  thumbDataUrl: string;
  mediaKind: MediaKind;
  gifFrames?: DecodedGifFrame[];
  videoAsset?: LoadedVideoAsset;
  videoConfig?: VideoConfig;
}

const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
  '.bmp',
  '.svg',
  '.ico',
] as const;

/**
 * Indica se o arquivo é uma mídia suportada (imagem, GIF, WebP ou vídeo).
 */
export function isSupportedMediaFile(file: File): boolean {
  if (isVideoFile(file)) return true;
  if (file.type.startsWith('image/')) return true;
  if (!file.type || file.type === 'application/octet-stream') {
    const lower = file.name.toLowerCase();
    return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }
  return false;
}

/**
 * Extrai o nome base de um arquivo sem extensão.
 */
export function stripExtension(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return 'imagem-editada';
  const lastDot = trimmed.lastIndexOf('.');
  const raw = lastDot > 0 ? trimmed.substring(0, lastDot) : trimmed;
  return raw === 'image' ? 'print-capturado' : raw;
}

function loadStaticImageElement(file: File, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    throwIfAborted(signal);

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    let settled = false;

    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      img.src = '';
      URL.revokeObjectURL(objectUrl);
      reject(new DOMException('Importação cancelada pelo usuário.', 'AbortError'));
    };

    img.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível decodificar a imagem selecionada.'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    img.src = objectUrl;
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Carrega uma mídia suportada (imagem estática, GIF animado, WebP animado ou vídeo)
 * preparando frames decodificados ou asset de vídeo para preview e exportação sem
 * decodificação dupla.
 */
export async function loadImageFromFile(
  file: File,
  options?: LoadMediaOptions
): Promise<LoadedImageResult> {
  const signal = options?.signal;
  throwIfAborted(signal);

  if (isVideoFile(file)) {
    options?.onProgress?.({ fraction: 0.15, detailText: 'Carregando vídeo...' });
    const videoAsset = await loadVideoAsset(file, signal);
    options?.onProgress?.({ fraction: 1 });

    const videoConfig = sanitizeVideoConfig(
      {
        fps: DEFAULT_VIDEO_FPS,
        maxWidth: 0,
        trimStart: 0,
        trimEnd: videoAsset.duration,
      },
      videoAsset.duration
    );

    return {
      image: videoAsset.posterCanvas,
      baseName: stripExtension(file.name),
      originalBytes: file.size,
      width: videoAsset.nativeWidth,
      height: videoAsset.nativeHeight,
      thumbDataUrl: videoAsset.thumbDataUrl,
      mediaKind: 'video',
      videoAsset,
      videoConfig,
    };
  }

  const lowerName = file.name.toLowerCase();
  const isGif = file.type === 'image/gif' || lowerName.endsWith('.gif');
  const isWebp = file.type === 'image/webp' || lowerName.endsWith('.webp');

  let animatedDecoded = null;
  if (isGif || isWebp) {
    const decodeOpts = {
      signal,
      onProgress: (cur: number, tot: number) => {
        options?.onProgress?.({
          fraction: Math.min(0.95, cur / Math.max(1, tot)),
          detailText: `Decodificando frame ${cur}/${tot}...`,
        });
      },
    };
    try {
      animatedDecoded = isGif
        ? await decodeAnimatedGif(file, decodeOpts)
        : await decodeAnimatedWebp(file, decodeOpts);
    } catch (err) {
      if (isAbortError(err)) throw err;
      animatedDecoded = null;
    }
  }

  throwIfAborted(signal);

  if (animatedDecoded && animatedDecoded.frames.length > 1) {
    const firstCanvas = animatedDecoded.frames[0]!.canvas;
    options?.onProgress?.({ fraction: 1 });
    return {
      image: firstCanvas,
      baseName: stripExtension(file.name),
      originalBytes: file.size,
      width: animatedDecoded.width,
      height: animatedDecoded.height,
      thumbDataUrl: createThumbnailDataUrl(firstCanvas),
      mediaKind: isWebp ? 'animated-webp' : 'gif',
      gifFrames: animatedDecoded.frames,
    };
  }

  options?.onProgress?.({ fraction: 0.4, detailText: 'Decodificando imagem...' });
  const img = await loadStaticImageElement(file, signal);
  options?.onProgress?.({ fraction: 1 });

  return {
    image: img,
    baseName: stripExtension(file.name),
    originalBytes: file.size,
    width: img.naturalWidth,
    height: img.naturalHeight,
    thumbDataUrl: createThumbnailDataUrl(img),
    mediaKind: 'image',
  };
}

export const loadMediaFromFile = loadImageFromFile;

/**
 * Extrai todos os arquivos de mídia suportados de um evento de Paste (Ctrl+V).
 */
export function extractImagesFromClipboard(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items;
  if (!items) return [];

  const result: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && item.kind === 'file') {
      const file = item.getAsFile();
      if (file && isSupportedMediaFile(file)) {
        result.push(file);
      }
    }
  }
  return result;
}

/**
 * Extrai todos os arquivos de mídia suportados de um evento de Drag & Drop.
 */
export function extractImagesFromDrop(event: DragEvent): File[] {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return [];

  const result: File[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file && isSupportedMediaFile(file)) {
      result.push(file);
    }
  }
  return result;
}

/**
 * Verifica quais formatos de imagem o navegador atual suporta codificar via Canvas toBlob.
 */
export async function detectSupportedExportFormats(): Promise<Set<ImageFormat>> {
  const supported = new Set<ImageFormat>(['image/png', 'image/jpeg']);
  const probe = document.createElement('canvas');
  probe.width = 2;
  probe.height = 2;
  const ctx = probe.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#8b3dff';
    ctx.fillRect(0, 0, 2, 2);
  }

  const candidates: ImageFormat[] = ['image/webp', 'image/avif'];
  await Promise.all(
    candidates.map(
      (mime) =>
        new Promise<void>((resolve) => {
          probe.toBlob(
            (blob) => {
              if (blob && blob.type === mime) {
                supported.add(mime);
              }
              resolve();
            },
            mime,
            0.8
          );
        })
    )
  );

  return supported;
}

/**
 * Codifica o resultado sombreado em um Blob no formato e nível de compressão escolhidos.
 * Para formatos sem transparência (JPEG), renderiza sobre fundo branco em um canvas auxiliar.
 */
export function encodeCanvasToBlob(
  displayCanvas: HTMLCanvasElement,
  source: HTMLImageElement | HTMLCanvasElement,
  shadowConfig: ShadowConfig,
  exportConfig: ExportConfig,
  borderRadius?: BorderRadiusConfig
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const formatMeta = FORMAT_OPTIONS.find((f) => f.mime === exportConfig.format);
    const needsSolidBackground = formatMeta ? !formatMeta.supportsTransparency : false;

    let targetCanvas = displayCanvas;
    if (needsSolidBackground) {
      targetCanvas = document.createElement('canvas');
      renderShadowCanvas(targetCanvas, source, shadowConfig, {
        fillBackground: '#ffffff',
        borderRadius,
      });
    }

    const qualityArg = formatMeta?.supportsLossyQuality
      ? Math.min(1, Math.max(0.05, exportConfig.quality))
      : undefined;

    targetCanvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`Falha ao codificar imagem em ${exportConfig.format}`));
          return;
        }
        resolve(blob);
      },
      exportConfig.format,
      qualityArg
    );
  });
}

/**
 * Copia o conteúdo atual do canvas para a Área de Transferência como PNG transparente.
 */
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('Navegador não suporta escrita de imagens na Área de Transferência.');
  }

  const blobPromise = new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Falha ao gerar PNG para a Área de Transferência.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });

  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': blobPromise,
    }),
  ]);
}

/**
 * Dispara o download do Blob gerado com sufixo padronizado e extensão do formato.
 */
export function triggerBlobDownload(
  blob: Blob,
  baseName: string,
  format: ImageFormat | AnimatedFormat
): void {
  const staticMeta = FORMAT_OPTIONS.find((f) => f.mime === format);
  const animMeta = ANIMATED_FORMAT_OPTIONS.find((f) => f.mime === format);
  const ext = staticMeta?.extension ?? animMeta?.extension ?? 'png';
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.download = `${baseName}_sombreado.${ext}`;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Formata bytes em string legível (B, KB, MB).
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}
