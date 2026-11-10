import type { ShadowConfig } from './types';

export interface RenderDimensions {
  width: number;
  height: number;
  padX: number;
  padY: number;
}

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
 * Calcula a margem (padding) automática por lado para garantir que o raio
 * gaussiano do blur (aprox. 2x blur) somado ao deslocamento (offsetX/offsetY)
 * nunca seja cortado na borda do canvas.
 */
export function calculateSmartPadding(rawConfig: ShadowConfig): { padX: number; padY: number } {
  const config = sanitizeShadowConfig(rawConfig);
  const blurRadius = config.blur * 2;
  const extra = config.extraPadding;

  const hasVisibleShadow =
    config.opacity > 0 && (config.blur > 0 || config.offsetX !== 0 || config.offsetY !== 0);

  const baseSpread = hasVisibleShadow ? Math.ceil(blurRadius) : 0;

  const padX = Math.ceil(baseSpread + Math.abs(config.offsetX) + extra);
  const padY = Math.ceil(baseSpread + Math.abs(config.offsetY) + extra);

  return { padX, padY };
}

/**
 * Renderiza a imagem com sombra projetada no elemento <canvas> informado.
 * Caso `fillBackground` seja especificado (ex: exportação JPEG), preenche o
 * fundo antes de desenhar a sombra e a imagem.
 */
export function renderShadowCanvas(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  rawConfig: ShadowConfig,
  options?: { fillBackground?: string }
): RenderDimensions {
  const config = sanitizeShadowConfig(rawConfig);
  const { padX, padY } = calculateSmartPadding(config);
  const width = image.naturalWidth + padX * 2;
  const height = image.naturalHeight + padY * 2;

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { width, height, padX, padY };
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

  ctx.drawImage(image, padX, padY);
  ctx.restore();

  return { width, height, padX, padY };
}
