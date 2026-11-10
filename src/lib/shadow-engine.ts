import type { ShadowConfig } from './types';

export interface RenderDimensions {
  width: number;
  height: number;
  padX: number;
  padY: number;
}

/**
 * Calcula a margem (padding) automática por lado para garantir que o raio
 * gaussiano do blur (aprox. 2x blur) somado ao deslocamento (offsetX/offsetY)
 * nunca seja cortado na borda do canvas.
 */
export function calculateSmartPadding(config: ShadowConfig): { padX: number; padY: number } {
  const blurRadius = Math.max(0, config.blur) * 2;
  const extra = Math.max(0, config.extraPadding);

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
  config: ShadowConfig,
  options?: { fillBackground?: string }
): RenderDimensions {
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

  const clampedOpacity = Math.min(1, Math.max(0, config.opacity));
  ctx.shadowColor = `rgba(0, 0, 0, ${clampedOpacity})`;
  ctx.shadowBlur = Math.max(0, config.blur);
  ctx.shadowOffsetX = config.offsetX;
  ctx.shadowOffsetY = config.offsetY;

  ctx.drawImage(image, padX, padY);
  ctx.restore();

  return { width, height, padX, padY };
}
