import type { ShadowConfig } from './types';

export interface SmartPadding {
  padTop: number;
  padRight: number;
  padBottom: number;
  padLeft: number;
}

export interface RenderDimensions extends SmartPadding {
  width: number;
  height: number;
}

const BLUR_SPREAD_FACTOR = 1.35;

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeShadowConfig(config: ShadowConfig): ShadowConfig {
  return {
    offsetX: clampFinite(config.offsetX, -200, 200, 0),
    offsetY: clampFinite(config.offsetY, -200, 200, 0),
    blur: clampFinite(config.blur, 0, 200, 20),
    opacity: clampFinite(config.opacity, 0, 1, 0.35),
    extraPadding: clampFinite(config.extraPadding, 0, 300, 0),
  };
}

/**
 * Calcula a margem (padding) direcional automática por lado para acomodar o
 * decaimento gaussiano do blur (~1.35x blur) considerando a direção do offset,
 * evitando bordas vazias excessivas sem cortar a sombra nas extremidades.
 */
export function calculateSmartPadding(rawConfig: ShadowConfig): SmartPadding {
  const config = sanitizeShadowConfig(rawConfig);
  const extra = Math.ceil(config.extraPadding);

  const hasVisibleShadow =
    config.opacity > 0 && (config.blur > 0 || config.offsetX !== 0 || config.offsetY !== 0);

  if (!hasVisibleShadow) {
    return { padTop: extra, padRight: extra, padBottom: extra, padLeft: extra };
  }

  const baseSpread = Math.ceil(config.blur * BLUR_SPREAD_FACTOR);

  return {
    padLeft: Math.max(0, baseSpread - Math.round(config.offsetX)) + extra,
    padRight: Math.max(0, baseSpread + Math.round(config.offsetX)) + extra,
    padTop: Math.max(0, baseSpread - Math.round(config.offsetY)) + extra,
    padBottom: Math.max(0, baseSpread + Math.round(config.offsetY)) + extra,
  };
}

/**
 * Renderiza a imagem com sombra projetada no elemento <canvas> informado.
 * Caso `fillBackground` seja especificado (ex: exportação JPEG), preenche o
 * fundo antes de desenhar a sombra e a imagem.
 */
export function renderShadowCanvas(
  canvas: HTMLCanvasElement,
  source: HTMLImageElement | HTMLCanvasElement,
  rawConfig: ShadowConfig,
  options?: { fillBackground?: string }
): RenderDimensions {
  const config = sanitizeShadowConfig(rawConfig);
  const { padTop, padRight, padBottom, padLeft } = calculateSmartPadding(config);
  const sourceWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const sourceHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const width = sourceWidth + padLeft + padRight;
  const height = sourceHeight + padTop + padBottom;

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { width, height, padTop, padRight, padBottom, padLeft };
  }

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  if (options?.fillBackground) {
    ctx.fillStyle = options.fillBackground;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.shadowColor = `rgba(0, 0, 0, ${config.opacity})`;
  ctx.shadowBlur = config.blur;
  ctx.shadowOffsetX = config.offsetX;
  ctx.shadowOffsetY = config.offsetY;

  ctx.drawImage(source, padLeft, padTop);
  ctx.restore();

  return { width, height, padTop, padRight, padBottom, padLeft };
}
