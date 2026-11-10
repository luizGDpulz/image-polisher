import { renderShadowCanvas } from './shadow-engine';
import { FORMAT_OPTIONS, type ExportConfig, type ImageFormat, type ShadowConfig } from './types';

export interface LoadedImageResult {
  image: HTMLImageElement;
  baseName: string;
  originalBytes: number;
  width: number;
  height: number;
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

/**
 * Carrega um objeto File de imagem em um HTMLImageElement pronto para desenho em Canvas.
 */
export function loadImageFromFile(file: File): Promise<LoadedImageResult> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        image: img,
        baseName: stripExtension(file.name),
        originalBytes: file.size,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível decodificar a imagem selecionada.'));
    };

    img.src = objectUrl;
  });
}

/**
 * Extrai o primeiro arquivo de imagem presente em um evento de Paste (Ctrl+V).
 */
export function extractImageFromClipboard(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/**
 * Extrai o primeiro arquivo de imagem presente em um evento de Drag & Drop.
 */
export function extractImageFromDrop(event: DragEvent): File | null {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return null;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file && file.type.startsWith('image/')) {
      return file;
    }
  }
  return null;
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
  image: HTMLImageElement,
  shadowConfig: ShadowConfig,
  exportConfig: ExportConfig
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const formatMeta = FORMAT_OPTIONS.find((f) => f.mime === exportConfig.format);
    const needsSolidBackground = formatMeta ? !formatMeta.supportsTransparency : false;

    let targetCanvas = displayCanvas;
    if (needsSolidBackground) {
      targetCanvas = document.createElement('canvas');
      renderShadowCanvas(targetCanvas, image, shadowConfig, { fillBackground: '#ffffff' });
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
export function triggerBlobDownload(blob: Blob, baseName: string, format: ImageFormat): void {
  const formatMeta = FORMAT_OPTIONS.find((f) => f.mime === format);
  const ext = formatMeta?.extension ?? 'png';
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.download = `${baseName} sombreado.${ext}`;
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
