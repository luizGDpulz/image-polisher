export type ImageFormat = 'image/png' | 'image/webp' | 'image/jpeg' | 'image/avif';

export type PresetName = 'leve' | 'medio' | 'forte' | 'flutuante';

export type StageTheme = 'checkerboard' | 'light' | 'dark';

export interface ShadowConfig {
  offsetX: number;
  offsetY: number;
  blur: number;
  opacity: number;
  extraPadding: number;
}

export interface ExportConfig {
  format: ImageFormat;
  quality: number;
}

export interface FormatOption {
  mime: ImageFormat;
  label: string;
  extension: string;
  supportsLossyQuality: boolean;
  supportsTransparency: boolean;
}

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
  leve: {
    offsetX: 0,
    offsetY: 4,
    blur: 16,
    opacity: 0.2,
    extraPadding: 8,
  },
  medio: {
    offsetX: 0,
    offsetY: 8,
    blur: 26,
    opacity: 0.35,
    extraPadding: 12,
  },
  forte: {
    offsetX: 0,
    offsetY: 14,
    blur: 42,
    opacity: 0.5,
    extraPadding: 16,
  },
  flutuante: {
    offsetX: 0,
    offsetY: 22,
    blur: 56,
    opacity: 0.42,
    extraPadding: 24,
  },
};
