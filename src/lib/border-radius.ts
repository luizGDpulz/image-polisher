import {
  BORDER_RADIUS_PRESETS,
  type BorderRadiusConfig,
  type BorderRadiusPresetName,
} from './types';

export const MAX_BORDER_RADIUS = 500;

let reusableMaskCanvas: HTMLCanvasElement | null = null;

function clampRadius(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_BORDER_RADIUS, Math.max(0, value));
}

/**
 * Normaliza e limita os raios de borda individuais ao intervalo válido [0, MAX_BORDER_RADIUS].
 */
export function sanitizeBorderRadiusConfig(
  raw?: Partial<BorderRadiusConfig>
): BorderRadiusConfig {
  return {
    topLeft: clampRadius(raw?.topLeft),
    topRight: clampRadius(raw?.topRight),
    bottomRight: clampRadius(raw?.bottomRight),
    bottomLeft: clampRadius(raw?.bottomLeft),
  };
}

/**
 * Indica se há pelo menos um canto com arredondamento ativo (> 0).
 */
export function hasActiveBorderRadius(config?: BorderRadiusConfig): boolean {
  if (!config) return false;
  return (
    config.topLeft > 0 ||
    config.topRight > 0 ||
    config.bottomRight > 0 ||
    config.bottomLeft > 0
  );
}

/**
 * Escala os quatro raios proporcionalmente quando a soma de dois cantos
 * adjacentes ultrapassa a largura ou altura da imagem (especificação CSS border-radius).
 */
export function normalizeRadiiForBox(
  width: number,
  height: number,
  config: BorderRadiusConfig
): [number, number, number, number] {
  if (width <= 0 || height <= 0) {
    return [0, 0, 0, 0];
  }

  const tl = clampRadius(config.topLeft);
  const tr = clampRadius(config.topRight);
  const br = clampRadius(config.bottomRight);
  const bl = clampRadius(config.bottomLeft);

  const factors = [1];
  if (tl + tr > 0) factors.push(width / (tl + tr));
  if (bl + br > 0) factors.push(width / (bl + br));
  if (tl + bl > 0) factors.push(height / (tl + bl));
  if (tr + br > 0) factors.push(height / (tr + br));

  const scale = Math.min(...factors);
  return [tl * scale, tr * scale, br * scale, bl * scale];
}

/**
 * Traça um retângulo arredondado no contexto 2D com fallback caso `roundRect` não exista.
 */
export function traceRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: [number, number, number, number]
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radii);
    return;
  }

  const [tl, tr, br, bl] = radii;
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  else ctx.lineTo(x + w, y);

  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  else ctx.lineTo(x + w, y + h);

  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  else ctx.lineTo(x, y + h);

  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl);
  else ctx.lineTo(x, y);

  ctx.closePath();
}

/**
 * Aplica recorte (clip) arredondado em um canvas auxiliar reutilizado para preservar
 * transparências pré-existentes e permitir que a sombra siga a curva exata dos cantos.
 */
export function createRoundedSourceCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
  config: BorderRadiusConfig
): HTMLCanvasElement {
  if (!reusableMaskCanvas) {
    reusableMaskCanvas = document.createElement('canvas');
  }
  if (reusableMaskCanvas.width !== sourceWidth) {
    reusableMaskCanvas.width = sourceWidth;
  }
  if (reusableMaskCanvas.height !== sourceHeight) {
    reusableMaskCanvas.height = sourceHeight;
  }

  const mCtx = reusableMaskCanvas.getContext('2d');
  if (!mCtx) {
    return reusableMaskCanvas;
  }

  const radii = normalizeRadiiForBox(sourceWidth, sourceHeight, config);

  mCtx.clearRect(0, 0, sourceWidth, sourceHeight);
  mCtx.save();
  mCtx.beginPath();
  traceRoundedRectPath(mCtx, 0, 0, sourceWidth, sourceHeight, radii);
  mCtx.clip();
  mCtx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
  mCtx.restore();

  return reusableMaskCanvas;
}

/**
 * Identifica se os quatro cantos correspondem a algum preset predefinido de borda.
 */
export function detectBorderRadiusPreset(
  config: BorderRadiusConfig
): BorderRadiusPresetName | null {
  const { topLeft, topRight, bottomRight, bottomLeft } = config;
  if (topLeft !== topRight || topLeft !== bottomRight || topLeft !== bottomLeft) {
    return null;
  }

  const entries = Object.entries(BORDER_RADIUS_PRESETS) as [
    BorderRadiusPresetName,
    BorderRadiusConfig,
  ][];
  for (const [name, preset] of entries) {
    if (preset.topLeft === topLeft) {
      return name;
    }
  }
  return null;
}
