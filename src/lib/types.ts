export type ImageFormat = 'image/png' | 'image/webp' | 'image/jpeg' | 'image/avif';

export type AnimatedFormat = 'image/gif' | 'image/webp';

export type MediaKind = 'image' | 'gif' | 'animated-webp' | 'video';

export type ToolId = 'shadow' | 'corners' | 'video';

export type PresetName = 'nenhum' | 'leve' | 'medio' | 'forte' | 'flutuante';

export type BorderRadiusPresetName = 'nenhum' | 'sutil' | 'medio' | 'forte';

export type StageTheme = 'checkerboard' | 'light' | 'dark';

export interface ShadowConfig {
  offsetX: number;
  offsetY: number;
  blur: number;
  opacity: number;
  extraPadding: number;
}

export interface BorderRadiusConfig {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface ExportConfig {
  format: ImageFormat;
  quality: number;
}

export interface AnimatedExportConfig {
  format: AnimatedFormat;
  dithering: boolean;
  loop: boolean;
}

export interface VideoConfig {
  fps: number;
  maxWidth: number;
  trimStart: number;
  trimEnd: number;
}

export interface AnimationFrameChunk {
  canvas: HTMLCanvasElement;
  delayMs: number;
}

export interface AnimationFrameSource {
  totalFrames: number;
  iterateFrames: (signal?: AbortSignal) => AsyncIterable<AnimationFrameChunk>;
}

export interface FormatOption {
  mime: ImageFormat;
  label: string;
  extension: string;
  supportsLossyQuality: boolean;
  supportsTransparency: boolean;
}

export interface AnimatedFormatOption {
  mime: AnimatedFormat;
  label: string;
  shortLabel: string;
  extension: string;
  supportsLossyQuality: boolean;
  supportsTransparency: boolean;
}

export const DEFAULT_VIDEO_FPS = 15;

export const VIDEO_FPS_PRESETS = [10, 15, 20, 24, 30] as const;

export const VIDEO_WIDTH_PRESETS = [
  { value: 0, label: 'Orig.' },
  { value: 1280, label: '1280' },
  { value: 960, label: '960' },
  { value: 720, label: '720' },
  { value: 480, label: '480' },
] as const;

export const RECOMMENDED_MAX_FRAMES = 240;

export const HARD_MAX_FRAMES = 600;

export const ANIMATED_FORMAT_OPTIONS: readonly AnimatedFormatOption[] = [
  {
    mime: 'image/webp',
    label: 'WebP Animado (16M cores / Transparente)',
    shortLabel: 'WEBP',
    extension: 'webp',
    supportsLossyQuality: true,
    supportsTransparency: true,
  },
  {
    mime: 'image/gif',
    label: 'GIF (Compatibilidade Universal)',
    shortLabel: 'GIF',
    extension: 'gif',
    supportsLossyQuality: false,
    supportsTransparency: false,
  },
] as const;

export const FORMAT_OPTIONS: readonly FormatOption[] = [
  {
    mime: 'image/png',
    label: 'PNG (Sem perdas / Transparente)',
    extension: 'png',
    supportsLossyQuality: false,
    supportsTransparency: true,
  },
  {
    mime: 'image/webp',
    label: 'WebP (Leve / Transparente)',
    extension: 'webp',
    supportsLossyQuality: true,
    supportsTransparency: true,
  },
  {
    mime: 'image/avif',
    label: 'AVIF (Ultra Comprimido)',
    extension: 'avif',
    supportsLossyQuality: true,
    supportsTransparency: true,
  },
  {
    mime: 'image/jpeg',
    label: 'JPEG (Fundo Branco)',
    extension: 'jpg',
    supportsLossyQuality: true,
    supportsTransparency: false,
  },
] as const;

export const SHADOW_PRESETS: Record<PresetName, ShadowConfig> = {
  nenhum: {
    offsetX: 0,
    offsetY: 0,
    blur: 0,
    opacity: 0,
    extraPadding: 0,
  },
  leve: {
    offsetX: 0,
    offsetY: 4,
    blur: 14,
    opacity: 0.22,
    extraPadding: 0,
  },
  medio: {
    offsetX: 0,
    offsetY: 8,
    blur: 24,
    opacity: 0.35,
    extraPadding: 0,
  },
  forte: {
    offsetX: 0,
    offsetY: 12,
    blur: 36,
    opacity: 0.48,
    extraPadding: 0,
  },
  flutuante: {
    offsetX: 0,
    offsetY: 18,
    blur: 48,
    opacity: 0.42,
    extraPadding: 0,
  },
};

export const BORDER_RADIUS_PRESETS: Record<BorderRadiusPresetName, BorderRadiusConfig> = {
  nenhum: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
  sutil: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
  medio: { topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 },
  forte: { topLeft: 28, topRight: 28, bottomRight: 28, bottomLeft: 28 },
};
