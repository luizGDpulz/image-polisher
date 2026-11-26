import {
  detectBorderRadiusPreset,
  MAX_BORDER_RADIUS,
} from '../lib/border-radius';
import { encodeAnimatedGifToBlob } from '../lib/gif-engine';
import {
  copyCanvasToClipboard,
  detectSupportedExportFormats,
  encodeCanvasToBlob,
  extractImagesFromClipboard,
  extractImagesFromDrop,
  formatByteSize,
  isSupportedMediaFile,
  loadImageFromFile,
  triggerBlobDownload,
  type LoadedImageResult,
} from '../lib/image-io';
import {
  hideAnimatedElement,
  prefersReducedMotion,
  showAnimatedElement,
  waitForElementAnimations,
} from '../lib/panel-transitions';
import { renderShadowCanvas } from '../lib/shadow-engine';
import {
  ANIMATED_FORMAT_OPTIONS,
  BORDER_RADIUS_PRESETS,
  DEFAULT_VIDEO_FPS,
  FORMAT_OPTIONS,
  HARD_MAX_FRAMES,
  SHADOW_PRESETS,
  type AnimatedExportConfig,
  type AnimatedFormat,
  type BorderRadiusConfig,
  type BorderRadiusPresetName,
  type ExportConfig,
  type ImageFormat,
  type MediaKind,
  type PresetName,
  type ShadowConfig,
  type StageTheme,
  type ToolId,
  type VideoConfig,
} from '../lib/types';
import {
  computeVideoExportPlan,
  createVideoFrameSource,
  disposeVideoAsset,
  isVideoFile,
  sanitizeVideoConfig,
  seekVideoToTime,
} from '../lib/video-engine';
import { encodeAnimatedWebpToBlob } from '../lib/webp-engine';
import { yieldToMain } from '../lib/yield-main';

interface NumericControlPair {
  range: HTMLInputElement;
  number: HTMLInputElement;
}

interface QueueItem extends LoadedImageResult {
  id: string;
}

function getQueueBadgeLabel(mediaKind: MediaKind): string | null {
  if (mediaKind === 'video') return 'VÍDEO';
  if (mediaKind === 'gif') return 'GIF';
  if (mediaKind === 'animated-webp') return 'WEBP';
  return null;
}

/**
 * Gera um print demonstrativo em memória (estilo card de sistema) caso o usuário
 * queira testar os controles antes de colar um print real.
 */
function createSampleScreenshotFile(): Promise<File> {
  return new Promise((resolve, reject) => {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 640;
    sampleCanvas.height = 360;
    const sCtx = sampleCanvas.getContext('2d');
    if (!sCtx) {
      reject(new Error('Contexto 2D indisponível'));
      return;
    }

    sCtx.fillStyle = '#ffffff';
    sCtx.fillRect(0, 0, 640, 360);

    sCtx.fillStyle = '#f3f4f6';
    sCtx.fillRect(0, 0, 640, 44);

    const dots = [
      { x: 22, color: '#ef4444' },
      { x: 42, color: '#f59e0b' },
      { x: 62, color: '#10b981' },
    ];
    for (const d of dots) {
      sCtx.fillStyle = d.color;
      sCtx.beginPath();
      sCtx.arc(d.x, 22, 6, 0, Math.PI * 2);
      sCtx.fill();
    }

    sCtx.fillStyle = '#374151';
    sCtx.font = '600 13px Inter, system-ui, sans-serif';
    sCtx.fillText('Image Polisher — Print de Exemplo', 90, 27);

    sCtx.fillStyle = '#6741d9';
    sCtx.beginPath();
    sCtx.roundRect(28, 70, 140, 28, 6);
    sCtx.fill();

    sCtx.fillStyle = '#ffffff';
    sCtx.font = '600 12px Inter, system-ui, sans-serif';
    sCtx.fillText('Status: Aprovado', 46, 88);

    const rows = [124, 172, 220, 268];
    for (let i = 0; i < rows.length; i++) {
      const y = rows[i]!;
      sCtx.fillStyle = i % 2 === 0 ? '#f9fafb' : '#ffffff';
      sCtx.fillRect(28, y, 584, 38);
      sCtx.strokeStyle = '#e5e7eb';
      sCtx.strokeRect(28, y, 584, 38);

      sCtx.fillStyle = '#6b7280';
      sCtx.beginPath();
      sCtx.roundRect(44, y + 13, 120 + (i % 2) * 40, 12, 4);
      sCtx.fill();

      sCtx.fillStyle = '#9ca3af';
      sCtx.beginPath();
      sCtx.roundRect(260, y + 13, 90, 12, 4);
      sCtx.fill();

      sCtx.fillStyle = '#10b981';
      sCtx.beginPath();
      sCtx.roundRect(520, y + 11, 72, 16, 8);
      sCtx.fill();
    }

    sCtx.strokeStyle = '#d1d5db';
    sCtx.lineWidth = 1;
    sCtx.strokeRect(0.5, 0.5, 639, 359);

    sampleCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Falha ao criar imagem de exemplo'));
        return;
      }
      resolve(new File([blob], 'print-exemplo.png', { type: 'image/png' }));
    }, 'image/png');
  });
}

export function initImagePolisher(): void {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  const emptyState = document.getElementById('empty-state');
  const canvasContainer = document.getElementById('canvas-container');
  const canvasTransform = document.getElementById('canvas-transform');
  const stageWrapper = document.getElementById('stage-wrapper');
  const zoomToolbar = document.getElementById('zoom-toolbar');
  const btnZoomOut = document.getElementById('btn-zoom-out') as HTMLButtonElement | null;
  const btnZoom100 = document.getElementById('btn-zoom-100') as HTMLButtonElement | null;
  const btnZoomIn = document.getElementById('btn-zoom-in') as HTMLButtonElement | null;
  const btnZoomFit = document.getElementById('btn-zoom-fit') as HTMLButtonElement | null;

  const playbackControlsGroup = document.getElementById('playback-controls-group');
  const btnAnimPlayPause = document.getElementById('btn-anim-play-pause') as HTMLButtonElement | null;
  const iconAnimPause = document.getElementById('icon-anim-pause');
  const iconAnimPlay = document.getElementById('icon-anim-play');
  const animPlaybackLabel = document.getElementById('anim-playback-label');

  const uploadInput = document.getElementById('upload') as HTMLInputElement | null;
  const uploadAppendInput = document.getElementById('upload-append') as HTMLInputElement | null;
  const dropzoneLabel = document.getElementById('dropzone-label');
  const fileNameBadge = document.getElementById('file-name-badge');
  const dimensionsBadge = document.getElementById('dimensions-badge');
  const sizeEstimateBadge = document.getElementById('size-estimate-badge');
  const statusToast = document.getElementById('status-toast');

  const exportProgressCard = document.getElementById('export-progress-card');
  const exportProgressLabel = document.getElementById('export-progress-label');
  const exportProgressEl = document.getElementById('export-progress') as HTMLProgressElement | null;
  const btnExportCancel = document.getElementById('btn-export-cancel') as HTMLButtonElement | null;

  const importLoadingDialog = document.getElementById(
    'import-loading-dialog'
  ) as HTMLDialogElement | null;
  const importLoadingTitle = document.getElementById('import-loading-title');
  const importLoadingDetail = document.getElementById('import-loading-detail');
  const importLoadingCount = document.getElementById('import-loading-count');
  const importLoadingProgress = document.getElementById(
    'import-loading-progress'
  ) as HTMLProgressElement | null;
  const btnImportCancel = document.getElementById('btn-import-cancel') as HTMLButtonElement | null;

  const btnReset = document.getElementById('btn-reset') as HTMLButtonElement | null;
  const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement | null;
  const btnDownload = document.getElementById('btn-download') as HTMLButtonElement | null;
  const btnSample = document.getElementById('btn-sample') as HTMLButtonElement | null;
  const btnThemeToggle = document.getElementById('btn-theme-toggle') as HTMLButtonElement | null;
  const downloadActionLabel = document.getElementById('download-action-label');
  const downloadFormatLabel = document.getElementById('download-format-label');

  const footerSingleInfo = document.getElementById('footer-single-info');
  const footerStatusText = document.getElementById('footer-status-text');
  const batchQueueBar = document.getElementById('batch-queue-bar');
  const batchCountLabel = document.getElementById('batch-count-label');
  const batchQueueList = document.getElementById('batch-queue-list');
  const btnBatchAdd = document.getElementById('btn-batch-add') as HTMLButtonElement | null;
  const btnBatchClear = document.getElementById('btn-batch-clear') as HTMLButtonElement | null;

  const toolRail = document.getElementById('tool-rail');
  const btnToolVideo = document.getElementById('btn-tool-video') as HTMLButtonElement | null;
  const toolPropertiesPanel = document.getElementById('tool-properties-panel');
  const toolPanelInner = document.getElementById('tool-panel-inner');
  const toolPaneStack = document.getElementById('tool-pane-stack');
  const activePresetLabel = document.getElementById('active-preset-label');
  const activeRadiusPresetLabel = document.getElementById('active-radius-preset-label');
  const radiusMixedHint = document.getElementById('radius-mixed-hint');
  const btnSyncCorners = document.getElementById('btn-sync-corners') as HTMLButtonElement | null;
  const radiusAllRange = document.getElementById('radiusAll') as HTMLInputElement | null;
  const radiusAllNumber = document.getElementById('numRadiusAll') as HTMLInputElement | null;

  const videoSummaryBadge = document.getElementById('video-summary-badge');
  const videoResolutionReadout = document.getElementById('video-resolution-readout');
  const videoTrimSummary = document.getElementById('video-trim-summary');
  const videoFramesWarning = document.getElementById('video-frames-warning');
  const videoStartRange = document.getElementById('videoStart') as HTMLInputElement | null;
  const videoStartNumber = document.getElementById('numVideoStart') as HTMLInputElement | null;
  const videoEndRange = document.getElementById('videoEnd') as HTMLInputElement | null;
  const videoEndNumber = document.getElementById('numVideoEnd') as HTMLInputElement | null;

  const staticFormatSection = document.getElementById('static-format-section');
  const animatedFormatSection = document.getElementById('animated-format-section');
  const animatedInfoBadge = document.getElementById('animated-info-badge');
  const animatedFormatHint = document.getElementById('animated-format-hint');
  const animFmtWebpRadio = document.getElementById('anim-fmt-webp') as HTMLInputElement | null;
  const animFmtGifRadio = document.getElementById('anim-fmt-gif') as HTMLInputElement | null;
  const gifDitheringWrapper = document.getElementById('gif-dithering-wrapper');
  const qualityFieldset = document.getElementById('quality-control-wrapper');
  const qualityRange = document.getElementById('quality') as HTMLInputElement | null;
  const qualityNumber = document.getElementById('numQuality') as HTMLInputElement | null;
  const formatHint = document.getElementById('format-hint');

  if (!canvas) return;

  let queue: QueueItem[] = [];
  let activeIndex = -1;
  let isBatchExporting = false;
  let isImporting = false;
  let estimateTimer: number | null = null;
  let gifTimer: number | null = null;
  let videoRafId: number | null = null;
  let videoLastRenderPerf = 0;
  let videoFrameCanvas: HTMLCanvasElement | null = null;
  let gifFrameIndex = 0;
  let isPlaybackPaused = false;
  let pausedByVisibility = false;
  let supportsWebpEncoding = true;
  let hasUserChosenAnimatedFormat = false;
  let exportAbortController: AbortController | null = null;
  let importAbortController: AbortController | null = null;

  function getActiveItem(): QueueItem | null {
    if (activeIndex < 0 || activeIndex >= queue.length) return null;
    return queue[activeIndex] ?? null;
  }

  function isAnimatedFrameItem(item: QueueItem | null): boolean {
    return Boolean(
      item &&
        (item.mediaKind === 'gif' || item.mediaKind === 'animated-webp') &&
        item.gifFrames &&
        item.gifFrames.length > 1
    );
  }

  function isAnimatedQueueItem(item: QueueItem | null): boolean {
    return Boolean(item && (item.mediaKind === 'video' || isAnimatedFrameItem(item)));
  }

  function disposeQueueItem(item: QueueItem): void {
    if (item.videoAsset) {
      disposeVideoAsset(item.videoAsset);
    }
  }

  function stopGifAnimation(): void {
    if (gifTimer !== null) {
      window.clearTimeout(gifTimer);
      gifTimer = null;
    }
  }

  function stopAllPlayback(): void {
    stopGifAnimation();
    if (videoRafId !== null) {
      window.cancelAnimationFrame(videoRafId);
      videoRafId = null;
    }
    for (const item of queue) {
      if (item.videoAsset && !item.videoAsset.video.paused) {
        item.videoAsset.video.pause();
      }
    }
  }

  // Estado de Zoom, Pan e Auto-Fit dentro do palco físico fixo
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 5.0;
  let zoomMode: 'fit' | 'manual' = 'fit';
  let zoomScale = 1;
  let panX = 0;
  let panY = 0;

  function computeFitScale(): number {
    if (!stageWrapper || !canvas || canvas.width === 0 || canvas.height === 0) {
      return 1;
    }
    const rect = stageWrapper.getBoundingClientRect();
    const availW = Math.max(120, rect.width - 64);
    const availH = Math.max(120, rect.height - 104);
    const fitRatio = Math.min(availW / canvas.width, availH / canvas.height, 1);
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitRatio));
  }

  function applyViewportTransform(): void {
    if (canvasTransform) {
      canvasTransform.style.transform = `translate3d(${Math.round(panX)}px, ${Math.round(panY)}px, 0) scale(${zoomScale})`;
    }
    if (btnZoom100) {
      btnZoom100.textContent = `${Math.round(zoomScale * 100)}%`;
    }
    if (btnZoomFit) {
      btnZoomFit.setAttribute('aria-pressed', zoomMode === 'fit' ? 'true' : 'false');
    }
  }

  function fitCanvasToStage(): void {
    zoomMode = 'fit';
    panX = 0;
    panY = 0;
    zoomScale = computeFitScale();
    applyViewportTransform();
  }

  function setManualZoom(nextScale: number, focalClientX?: number, focalClientY?: number): void {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextScale));
    if (focalClientX !== undefined && focalClientY !== undefined && stageWrapper) {
      const rect = stageWrapper.getBoundingClientRect();
      const cursorX = focalClientX - (rect.left + rect.width / 2);
      const cursorY = focalClientY - (rect.top + rect.height / 2);
      const ratio = clamped / zoomScale;
      panX = cursorX - (cursorX - panX) * ratio;
      panY = cursorY - (cursorY - panY) * ratio;
    }
    zoomMode = 'manual';
    zoomScale = clamped;
    applyViewportTransform();
  }

  const shadowState: ShadowConfig = { ...SHADOW_PRESETS.medio };
  const borderRadiusState: BorderRadiusConfig = { ...BORDER_RADIUS_PRESETS.nenhum };
  const exportState: ExportConfig = {
    format: 'image/png',
    quality: 0.88,
  };
  const animatedExportState: AnimatedExportConfig = {
    format: 'image/webp',
    dithering: true,
    loop: true,
  };

  const controlKeys: (keyof ShadowConfig)[] = [
    'offsetX',
    'offsetY',
    'blur',
    'opacity',
    'extraPadding',
  ];

  const controlPairs = {} as Record<keyof ShadowConfig, NumericControlPair>;
  for (const key of controlKeys) {
    const capKey = key.charAt(0).toUpperCase() + key.slice(1);
    const rangeEl = document.getElementById(key) as HTMLInputElement | null;
    const numEl = document.getElementById(`num${capKey}`) as HTMLInputElement | null;
    if (rangeEl && numEl) {
      controlPairs[key] = { range: rangeEl, number: numEl };
    }
  }

  const cornerIdMap: Record<keyof BorderRadiusConfig, { rangeId: string; numberId: string }> = {
    topLeft: { rangeId: 'radiusTL', numberId: 'numRadiusTL' },
    topRight: { rangeId: 'radiusTR', numberId: 'numRadiusTR' },
    bottomRight: { rangeId: 'radiusBR', numberId: 'numRadiusBR' },
    bottomLeft: { rangeId: 'radiusBL', numberId: 'numRadiusBL' },
  };
  const cornerKeys = Object.keys(cornerIdMap) as (keyof BorderRadiusConfig)[];
  const cornerPairs = {} as Record<keyof BorderRadiusConfig, NumericControlPair>;
  for (const key of cornerKeys) {
    const { rangeId, numberId } = cornerIdMap[key];
    const rangeEl = document.getElementById(rangeId) as HTMLInputElement | null;
    const numEl = document.getElementById(numberId) as HTMLInputElement | null;
    if (rangeEl && numEl) {
      cornerPairs[key] = { range: rangeEl, number: numEl };
    }
  }

  function updateRangeProgressFallback(rangeInput: HTMLInputElement): void {
    const min = parseFloat(rangeInput.min) || 0;
    const max = parseFloat(rangeInput.max) || 100;
    const val = parseFloat(rangeInput.value) || 0;
    const span = max - min;
    const pct = span > 0 ? ((val - min) / span) * 100 : 0;
    rangeInput.style.setProperty('--attr-min', String(min));
    rangeInput.style.setProperty('--attr-max', String(max));
    rangeInput.style.setProperty('--control-value', String(val));
    rangeInput.style.setProperty('--progress', `${Math.max(0, Math.min(100, pct))}%`);
  }

  function showToast(message: string): void {
    if (!statusToast) return;
    statusToast.textContent = message;
    statusToast.classList.remove('opacity-0', 'translate-y-2', 'pointer-events-none');
    statusToast.classList.add('opacity-100', 'translate-y-0');
    window.setTimeout(() => {
      statusToast.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
      statusToast.classList.remove('opacity-100', 'translate-y-0');
    }, 2200);
  }

  function showExportProgress(label: string, current: number, total: number): void {
    if (exportProgressCard) {
      exportProgressCard.hidden = false;
    }
    if (exportProgressLabel) {
      exportProgressLabel.textContent = label;
    }
    if (exportProgressEl) {
      if (total > 0) {
        exportProgressEl.max = total;
        exportProgressEl.value = Math.min(total, Math.max(0, current));
      } else {
        exportProgressEl.removeAttribute('value');
      }
    }
  }

  function hideExportProgress(): void {
    if (exportProgressCard) {
      exportProgressCard.hidden = true;
    }
    if (exportProgressEl) {
      exportProgressEl.max = 100;
      exportProgressEl.value = 0;
    }
  }

  const PRESET_LABELS: Record<PresetName, string> = {
    nenhum: 'Nenhum',
    leve: 'Leve',
    medio: 'Médio',
    forte: 'Forte',
    flutuante: 'Flutuante',
  };

  function highlightActivePreset(activePreset: PresetName | null): void {
    const presetButtons = document.querySelectorAll<HTMLButtonElement>('[data-preset]');
    presetButtons.forEach((btn) => {
      const isMatch = btn.dataset.preset === activePreset;
      btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    });
    if (activePresetLabel) {
      activePresetLabel.textContent = activePreset ? PRESET_LABELS[activePreset] : 'Personalizado';
    }
  }

  const RADIUS_PRESET_LABELS: Record<BorderRadiusPresetName, string> = {
    nenhum: 'Nenhum',
    sutil: 'Sutil',
    medio: 'Médio',
    forte: 'Forte',
  };

  function highlightActiveRadiusPreset(activePreset: BorderRadiusPresetName | null): void {
    const presetButtons = document.querySelectorAll<HTMLButtonElement>('[data-radius-preset]');
    presetButtons.forEach((btn) => {
      const isMatch = btn.dataset.radiusPreset === activePreset;
      btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    });
    if (activeRadiusPresetLabel) {
      activeRadiusPresetLabel.textContent = activePreset
        ? RADIUS_PRESET_LABELS[activePreset]
        : 'Personalizado';
    }
  }

  function updatePlaybackToolbarUI(): void {
    const activeItem = getActiveItem();
    const isAnim = isAnimatedQueueItem(activeItem);

    if (playbackControlsGroup) {
      playbackControlsGroup.hidden = !isAnim;
    }

    if (iconAnimPause && iconAnimPlay) {
      iconAnimPause.classList.toggle('hidden', isPlaybackPaused);
      iconAnimPlay.classList.toggle('hidden', !isPlaybackPaused);
    }

    if (btnAnimPlayPause) {
      const label = isPlaybackPaused ? 'Retomar animação' : 'Pausar animação';
      btnAnimPlayPause.setAttribute('aria-label', label);
      btnAnimPlayPause.title = label;
    }

    if (!animPlaybackLabel || !isAnim || !activeItem) return;

    if (activeItem.mediaKind === 'video' && activeItem.videoAsset && activeItem.videoConfig) {
      const curTime = activeItem.videoAsset.video.currentTime;
      const endTime = activeItem.videoConfig.trimEnd;
      animPlaybackLabel.textContent = `${curTime.toFixed(1)}s / ${endTime.toFixed(1)}s`;
    } else if (activeItem.gifFrames && activeItem.gifFrames.length > 0) {
      const total = activeItem.gifFrames.length;
      animPlaybackLabel.textContent = `${(gifFrameIndex % total) + 1}/${total}`;
    }
  }

  function scheduleSizeEstimation(): void {
    const activeItem = getActiveItem();
    if (!activeItem || !canvas) return;

    if (isAnimatedQueueItem(activeItem)) {
      if (sizeEstimateBadge) {
        sizeEstimateBadge.textContent = '—';
      }
      return;
    }

    if (estimateTimer !== null) {
      window.clearTimeout(estimateTimer);
    }
    estimateTimer = window.setTimeout(async () => {
      const current = getActiveItem();
      if (!current || isAnimatedQueueItem(current)) return;
      try {
        const blob = await encodeCanvasToBlob(
          canvas,
          current.image,
          shadowState,
          exportState,
          borderRadiusState
        );
        const formattedOut = formatByteSize(blob.size);
        const formatMeta = FORMAT_OPTIONS.find((f) => f.mime === exportState.format);
        const extUpper = (formatMeta?.extension ?? 'png').toUpperCase();

        if (sizeEstimateBadge) {
          if (current.originalBytes > 0 && blob.size < current.originalBytes) {
            const savings = Math.round((1 - blob.size / current.originalBytes) * 100);
            sizeEstimateBadge.textContent = `${extUpper}: ~${formattedOut} (-${savings}%)`;
          } else {
            sizeEstimateBadge.textContent = `${extUpper}: ~${formattedOut}`;
          }
          sizeEstimateBadge.classList.remove('hidden');
        }
      } catch {
        // Ignora erro silencioso durante estimativa rápida
      }
    }, 120);
  }

  function renderCurrentFrameOnly(): void {
    const activeItem = getActiveItem();
    if (!activeItem || !canvas) return;

    if (activeItem.mediaKind === 'video' && activeItem.videoAsset && activeItem.videoConfig) {
      const { videoAsset, videoConfig } = activeItem;
      const plan = computeVideoExportPlan(
        videoAsset.nativeWidth,
        videoAsset.nativeHeight,
        videoAsset.duration,
        videoConfig
      );

      let drawSource: HTMLImageElement | HTMLCanvasElement = activeItem.image;
      if (videoAsset.video.readyState >= 2) {
        if (!videoFrameCanvas) {
          videoFrameCanvas = document.createElement('canvas');
        }
        if (videoFrameCanvas.width !== plan.width) videoFrameCanvas.width = plan.width;
        if (videoFrameCanvas.height !== plan.height) videoFrameCanvas.height = plan.height;
        const vCtx = videoFrameCanvas.getContext('2d');
        if (vCtx) {
          vCtx.imageSmoothingEnabled = true;
          vCtx.imageSmoothingQuality = 'high';
          vCtx.clearRect(0, 0, plan.width, plan.height);
          vCtx.drawImage(videoAsset.video, 0, 0, plan.width, plan.height);
          drawSource = videoFrameCanvas;
        }
      }

      const dims = renderShadowCanvas(canvas, drawSource, shadowState, {
        borderRadius: borderRadiusState,
      });

      if (dimensionsBadge) {
        dimensionsBadge.textContent = `${plan.width}×${plan.height} → ${dims.width}×${dims.height} px`;
        dimensionsBadge.classList.remove('hidden');
        dimensionsBadge.classList.add('md:inline-flex');
      }

      updatePlaybackToolbarUI();
      return;
    }

    const frames = activeItem.gifFrames;
    const source =
      frames && frames.length > 1
        ? frames[gifFrameIndex % frames.length]!.canvas
        : activeItem.image;

    const dims = renderShadowCanvas(canvas, source, shadowState, {
      borderRadius: borderRadiusState,
    });

    if (dimensionsBadge) {
      dimensionsBadge.textContent = `${activeItem.width}×${activeItem.height} → ${dims.width}×${dims.height} px`;
      dimensionsBadge.classList.remove('hidden');
      dimensionsBadge.classList.add('md:inline-flex');
    }

    updatePlaybackToolbarUI();
  }

  function startPlaybackIfNeeded(): void {
    stopAllPlayback();
    const activeItem = getActiveItem();
    if (!activeItem || isPlaybackPaused) {
      updatePlaybackToolbarUI();
      return;
    }

    if (activeItem.mediaKind === 'video' && activeItem.videoAsset && activeItem.videoConfig) {
      const video = activeItem.videoAsset.video;
      const cfg = activeItem.videoConfig;
      if (video.currentTime < cfg.trimStart || video.currentTime >= cfg.trimEnd - 0.02) {
        video.currentTime = cfg.trimStart;
      }
      video.muted = true;
      void video.play().catch(() => undefined);
      videoLastRenderPerf = 0;

      const step = (now: number) => {
        if (getActiveItem() !== activeItem || isPlaybackPaused) return;
        const latestCfg = activeItem.videoConfig!;
        const frameInterval = 1000 / latestCfg.fps;

        if (video.currentTime >= latestCfg.trimEnd - 0.02 || video.ended) {
          if (animatedExportState.loop) {
            video.currentTime = latestCfg.trimStart;
            if (video.paused) {
              void video.play().catch(() => undefined);
            }
          } else {
            video.pause();
            isPlaybackPaused = true;
            renderCurrentFrameOnly();
            return;
          }
        }

        if (now - videoLastRenderPerf >= frameInterval * 0.92) {
          videoLastRenderPerf = now;
          renderCurrentFrameOnly();
        }
        videoRafId = window.requestAnimationFrame(step);
      };

      videoRafId = window.requestAnimationFrame(step);
      updatePlaybackToolbarUI();
      return;
    }

    const frames = activeItem.gifFrames;
    if (!frames || frames.length <= 1) {
      updatePlaybackToolbarUI();
      return;
    }

    const tick = () => {
      const current = getActiveItem();
      if (!current || current.gifFrames !== frames || isPlaybackPaused) return;

      if (!animatedExportState.loop && gifFrameIndex + 1 >= frames.length) {
        isPlaybackPaused = true;
        updatePlaybackToolbarUI();
        return;
      }

      gifFrameIndex = (gifFrameIndex + 1) % frames.length;
      renderCurrentFrameOnly();
      const nextDelay = frames[gifFrameIndex]!.delayMs;
      gifTimer = window.setTimeout(tick, nextDelay);
    };

    const initialDelay = frames[gifFrameIndex % frames.length]!.delayMs;
    gifTimer = window.setTimeout(tick, initialDelay);
    updatePlaybackToolbarUI();
  }

  function renderCurrent(): void {
    const activeItem = getActiveItem();
    if (!activeItem || !canvas) return;

    renderCurrentFrameOnly();

    if (zoomMode === 'fit') {
      zoomScale = computeFitScale();
      panX = 0;
      panY = 0;
    }
    applyViewportTransform();

    scheduleSizeEstimation();
  }

  function syncControlInputsFromState(): void {
    for (const key of controlKeys) {
      const pair = controlPairs[key];
      if (!pair) continue;
      const val = String(shadowState[key]);
      pair.range.value = val;
      pair.number.value = val;
      updateRangeProgressFallback(pair.range);
    }
  }

  function applyPreset(presetName: PresetName): void {
    const preset = SHADOW_PRESETS[presetName];
    Object.assign(shadowState, preset);
    syncControlInputsFromState();
    highlightActivePreset(presetName);
    renderCurrent();
  }

  function syncRadiusInputsFromState(): void {
    for (const key of cornerKeys) {
      const pair = cornerPairs[key];
      if (!pair) continue;
      const val = borderRadiusState[key];
      pair.range.value = String(Math.min(120, val));
      pair.number.value = String(val);
      updateRangeProgressFallback(pair.range);
    }

    const { topLeft, topRight, bottomRight, bottomLeft } = borderRadiusState;
    const allEqual =
      topLeft === topRight && topLeft === bottomRight && topLeft === bottomLeft;

    radiusMixedHint?.classList.toggle('hidden', allEqual);

    if (radiusAllRange && radiusAllNumber) {
      const summaryVal = allEqual
        ? topLeft
        : Math.max(topLeft, topRight, bottomRight, bottomLeft);
      radiusAllRange.value = String(Math.min(120, summaryVal));
      radiusAllNumber.value = String(summaryVal);
      updateRangeProgressFallback(radiusAllRange);
    }

    highlightActiveRadiusPreset(detectBorderRadiusPreset(borderRadiusState));
  }

  function applyBorderRadiusPreset(presetName: BorderRadiusPresetName): void {
    const preset = BORDER_RADIUS_PRESETS[presetName];
    Object.assign(borderRadiusState, preset);
    syncRadiusInputsFromState();
    renderCurrent();
  }

  function syncVideoInputsFromActiveItem(): void {
    const activeItem = getActiveItem();
    if (!activeItem || activeItem.mediaKind !== 'video' || !activeItem.videoAsset) {
      return;
    }

    const { videoAsset } = activeItem;
    const plan = computeVideoExportPlan(
      videoAsset.nativeWidth,
      videoAsset.nativeHeight,
      videoAsset.duration,
      activeItem.videoConfig ?? {}
    );
    activeItem.videoConfig = plan.config;

    document.querySelectorAll<HTMLButtonElement>('[data-video-fps]').forEach((btn) => {
      const match = Number(btn.dataset.videoFps) === plan.config.fps;
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });

    document.querySelectorAll<HTMLButtonElement>('[data-video-width]').forEach((btn) => {
      const match = Number(btn.dataset.videoWidth) === plan.config.maxWidth;
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    });

    if (videoSummaryBadge) {
      const widthLabel = plan.config.maxWidth > 0 ? `${plan.config.maxWidth}px` : 'Orig.';
      videoSummaryBadge.textContent = `${plan.config.fps} fps • ${widthLabel}`;
    }

    if (videoResolutionReadout) {
      if (plan.width !== videoAsset.nativeWidth || plan.height !== videoAsset.nativeHeight) {
        videoResolutionReadout.textContent = `Saída do vídeo: ${videoAsset.nativeWidth}×${videoAsset.nativeHeight} → ${plan.width}×${plan.height} px`;
      } else {
        videoResolutionReadout.textContent = `Saída do vídeo: ${plan.width}×${plan.height} px (original)`;
      }
    }

    const maxDurationStr = (Math.round(videoAsset.duration * 100) / 100).toFixed(2);
    const startStr = plan.config.trimStart.toFixed(1);
    const endStr = plan.config.trimEnd.toFixed(1);

    if (videoStartRange && videoStartNumber) {
      videoStartRange.min = '0';
      videoStartRange.max = maxDurationStr;
      videoStartRange.value = startStr;
      videoStartNumber.min = '0';
      videoStartNumber.max = maxDurationStr;
      videoStartNumber.value = startStr;
      updateRangeProgressFallback(videoStartRange);
    }

    if (videoEndRange && videoEndNumber) {
      videoEndRange.min = '0';
      videoEndRange.max = maxDurationStr;
      videoEndRange.value = endStr;
      videoEndNumber.min = '0';
      videoEndNumber.max = maxDurationStr;
      videoEndNumber.value = endStr;
      updateRangeProgressFallback(videoEndRange);
    }

    if (videoTrimSummary) {
      videoTrimSummary.textContent = `Trecho: ${startStr}s – ${endStr}s (${plan.frameCount} frames)`;
    }

    if (videoFramesWarning) {
      if (plan.wasCapped) {
        videoFramesWarning.textContent = `Trecho limitado aos primeiros ${HARD_MAX_FRAMES} frames para proteger a memória do navegador. Reduza o FPS ou recorte o trecho.`;
        videoFramesWarning.hidden = false;
      } else if (plan.isHighFrameCount) {
        videoFramesWarning.textContent = `Trecho longo (${plan.frameCount} frames): a exportação pode levar alguns segundos.`;
        videoFramesWarning.hidden = false;
      } else {
        videoFramesWarning.textContent = '';
        videoFramesWarning.hidden = true;
      }
    }
  }

  let scrollHintObserver: IntersectionObserver | null = null;

  function updateScrollHintFallback(): void {
    scrollHintObserver?.disconnect();
    scrollHintObserver = null;
    if (!batchQueueList) return;

    batchQueueList.classList.remove('more-start', 'more-end');

    if (
      typeof window === 'undefined' ||
      window.CSS?.supports?.('animation-timeline', 'scroll()') ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const first = batchQueueList.firstElementChild;
    const last = batchQueueList.lastElementChild;
    if (!first || !last) return;

    scrollHintObserver = new IntersectionObserver(
      (entries) => {
        for (const { target, intersectionRatio } of entries) {
          if (target === first) {
            batchQueueList.classList.toggle('more-start', intersectionRatio < 1);
          }
          if (target === last) {
            batchQueueList.classList.toggle('more-end', intersectionRatio < 1);
          }
        }
      },
      { root: batchQueueList, threshold: 1, rootMargin: '1px' }
    );

    scrollHintObserver.observe(first);
    if (last !== first) {
      scrollHintObserver.observe(last);
    }
  }

  function renderBatchQueueUI(): void {
    if (downloadActionLabel) {
      downloadActionLabel.textContent =
        queue.length > 1 ? `Exportar (${queue.length})` : 'Exportar';
    }

    if (btnBatchClear) {
      btnBatchClear.hidden = queue.length === 0;
    }

    if (footerStatusText) {
      footerStatusText.textContent =
        'Abra ou arraste imagens, GIFs ou vídeos para editar e exportar em lote';
    }

    if (!batchQueueBar || !batchQueueList) return;

    if (queue.length === 0) {
      if (footerSingleInfo) showAnimatedElement(footerSingleInfo);
      batchQueueBar.hidden = true;
      batchQueueList.replaceChildren();
      scrollHintObserver?.disconnect();
      scrollHintObserver = null;
      batchQueueList.classList.remove('more-start', 'more-end');
      return;
    }

    if (footerSingleInfo) footerSingleInfo.hidden = true;
    showAnimatedElement(batchQueueBar);

    if (batchCountLabel) {
      batchCountLabel.textContent =
        queue.length === 1 ? 'Arquivo (1)' : `Lote (${queue.length})`;
    }

    const fragment = document.createDocumentFragment();
    queue.forEach((item, index) => {
      const isActive = index === activeIndex;
      const wrapper = document.createElement('div');
      wrapper.setAttribute('role', 'listitem');
      wrapper.className = isActive
        ? 'batch-item inline-flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-lg text-xs font-medium border border-[var(--color-brand)] bg-[var(--brand-subtle)] text-[var(--color-brand)] shrink-0'
        : 'batch-item inline-flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-lg text-xs font-medium border border-[var(--border-color)] bg-[var(--bg-subtle)] text-[var(--text-main)] hover:border-[var(--border-strong)] shrink-0';

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'inline-flex items-center gap-1.5 cursor-pointer text-left min-w-0';
      selectBtn.title = `${item.baseName} (${formatByteSize(item.originalBytes)})`;
      if (isActive) {
        selectBtn.setAttribute('aria-current', 'true');
      }

      const thumb = document.createElement('img');
      thumb.src = item.thumbDataUrl;
      thumb.alt = '';
      thumb.decoding = 'async';
      thumb.loading = 'lazy';
      thumb.className =
        'w-6 h-6 rounded object-cover shrink-0 border border-[var(--border-color)] bg-[var(--bg-panel)]';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'max-w-[130px] truncate text-left';
      labelSpan.textContent = item.baseName;

      selectBtn.append(thumb, labelSpan);

      const badgeLabel = getQueueBadgeLabel(item.mediaKind);
      if (badgeLabel) {
        const mediaTag = document.createElement('span');
        mediaTag.className =
          'text-[9px] font-mono uppercase px-1 py-0.5 rounded bg-[var(--bg-panel)] border border-[var(--border-color)] text-[var(--text-muted)] shrink-0';
        mediaTag.textContent = badgeLabel;
        selectBtn.appendChild(mediaTag);
      }

      selectBtn.addEventListener('click', () => selectQueueIndex(index));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className =
        'w-5 h-5 rounded flex items-center justify-center text-[12px] opacity-60 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer shrink-0';
      removeBtn.textContent = '×';
      removeBtn.ariaLabel = `Remover ${item.baseName} do lote`;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeQueueIndex(index);
      });

      wrapper.append(selectBtn, removeBtn);
      fragment.appendChild(wrapper);
    });

    batchQueueList.replaceChildren(fragment);

    const activeWrapper = batchQueueList.children[activeIndex] as HTMLElement | undefined;
    activeWrapper?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      inline: 'nearest',
      block: 'nearest',
    });

    updateScrollHintFallback();
  }

  // Controlador de ferramenta ativa e animações (abrir / fechar / trocar de opção)
  const TOOL_ORDER: ToolId[] = ['shadow', 'corners', 'video'];
  let activeTool: ToolId | null = 'shadow';
  let panelTransitionGen = 0;
  let paneSwitchGen = 0;

  const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'));
  const toolPanes = Array.from(document.querySelectorAll<HTMLElement>('[data-tool-pane]'));

  function syncRailAria(tool: ToolId | null): void {
    if (toolRail) {
      toolRail.dataset.panelOpen = tool !== null ? 'true' : 'false';
    }
    for (const btn of toolButtons) {
      const isSelected = btn.dataset.tool === tool;
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      btn.setAttribute('aria-expanded', isSelected ? 'true' : 'false');
    }
  }

  function setImmediatePane(targetTool: ToolId): void {
    for (const pane of toolPanes) {
      pane.removeAttribute('data-leaving');
      pane.removeAttribute('aria-hidden');
      pane.hidden = pane.dataset.toolPane !== targetTool;
    }
  }

  async function switchToolPane(fromTool: ToolId, toTool: ToolId): Promise<void> {
    if (fromTool === toTool || !toolPaneStack) return;

    const leavingPane = toolPanes.find((p) => p.dataset.toolPane === fromTool);
    const enteringPane = toolPanes.find((p) => p.dataset.toolPane === toTool);
    if (!enteringPane) return;

    const gen = ++paneSwitchGen;
    const dir = TOOL_ORDER.indexOf(toTool) > TOOL_ORDER.indexOf(fromTool) ? 'down' : 'up';
    toolPaneStack.dataset.switchDir = dir;

    for (const pane of toolPanes) {
      if (pane !== leavingPane && pane !== enteringPane) {
        pane.removeAttribute('data-leaving');
        pane.removeAttribute('aria-hidden');
        pane.hidden = true;
      }
    }

    if (leavingPane) {
      leavingPane.hidden = false;
      leavingPane.setAttribute('data-leaving', '');
      leavingPane.setAttribute('aria-hidden', 'true');
    }

    enteringPane.removeAttribute('data-leaving');
    enteringPane.removeAttribute('aria-hidden');
    enteringPane.hidden = false;

    if (leavingPane) {
      await waitForElementAnimations(leavingPane, 260);
      if (gen === paneSwitchGen && leavingPane.hasAttribute('data-leaving')) {
        leavingPane.hidden = true;
        leavingPane.removeAttribute('data-leaving');
        leavingPane.removeAttribute('aria-hidden');
      }
    }
  }

  function handleToolSelect(toolId: ToolId): void {
    if (!toolPropertiesPanel) return;

    if (activeTool === toolId) {
      activeTool = null;
      const gen = ++panelTransitionGen;
      syncRailAria(null);
      void hideAnimatedElement(toolPropertiesPanel, {
        extraTarget: toolPanelInner,
        isCurrent: () => gen === panelTransitionGen,
      });
      return;
    }

    if (activeTool === null) {
      activeTool = toolId;
      panelTransitionGen++;
      paneSwitchGen++;
      setImmediatePane(toolId);
      syncRailAria(toolId);
      showAnimatedElement(toolPropertiesPanel);
      return;
    }

    const prev = activeTool;
    activeTool = toolId;
    syncRailAria(toolId);
    void switchToolPane(prev, toolId);
  }

  function ensureVideoToolVisibility(isVideo: boolean): void {
    if (btnToolVideo) {
      btnToolVideo.hidden = !isVideo;
    }
    if (!isVideo && activeTool === 'video') {
      const prev = activeTool;
      activeTool = 'shadow';
      syncRailAria('shadow');
      if (toolPropertiesPanel && !toolPropertiesPanel.hidden) {
        void switchToolPane(prev, 'shadow');
      } else {
        setImmediatePane('shadow');
      }
    }
  }

  function applySmartAnimatedFormatDefault(): void {
    if (hasUserChosenAnimatedFormat) return;
    const hasAnimated = queue.some((item) => isAnimatedQueueItem(item));
    if (!hasAnimated) return;

    const prefersWebp =
      supportsWebpEncoding &&
      queue.some((item) => item.mediaKind === 'video' || item.mediaKind === 'animated-webp');

    const targetFormat: AnimatedFormat = prefersWebp ? 'image/webp' : 'image/gif';
    animatedExportState.format = targetFormat;
    if (animFmtWebpRadio) animFmtWebpRadio.checked = targetFormat === 'image/webp';
    if (animFmtGifRadio) animFmtGifRadio.checked = targetFormat === 'image/gif';
  }

  function clearWorkspace(): void {
    stopAllPlayback();
    for (const item of queue) {
      disposeQueueItem(item);
    }
    gifFrameIndex = 0;
    isPlaybackPaused = false;
    pausedByVisibility = false;
    queue = [];
    activeIndex = -1;
    if (emptyState) emptyState.classList.remove('hidden');
    if (canvasContainer) canvasContainer.classList.add('hidden');
    if (zoomToolbar) zoomToolbar.classList.add('hidden');
    if (dimensionsBadge) {
      dimensionsBadge.textContent = '';
      dimensionsBadge.classList.add('hidden');
      dimensionsBadge.classList.remove('md:inline-flex');
    }
    if (sizeEstimateBadge) sizeEstimateBadge.textContent = '—';
    if (fileNameBadge) fileNameBadge.textContent = 'Cole Ctrl+V ou arraste imagens e vídeos';
    if (btnZoom100) btnZoom100.textContent = '100%';
    if (btnCopy) btnCopy.disabled = true;
    if (btnDownload) btnDownload.disabled = true;
    ensureVideoToolVisibility(false);
    updatePlaybackToolbarUI();
    renderBatchQueueUI();
    updateFormatUI();
  }

  function selectQueueIndex(index: number): void {
    if (index < 0 || index >= queue.length) return;
    stopAllPlayback();
    gifFrameIndex = 0;
    isPlaybackPaused = false;
    pausedByVisibility = false;
    activeIndex = index;
    const activeItem = queue[index]!;

    if (emptyState) emptyState.classList.add('hidden');
    if (canvasContainer) canvasContainer.classList.remove('hidden');
    if (zoomToolbar) zoomToolbar.classList.remove('hidden');

    if (fileNameBadge) {
      const batchSuffix = queue.length > 1 ? ` (${index + 1}/${queue.length})` : '';
      fileNameBadge.textContent = `${activeItem.baseName}${batchSuffix}`;
    }

    if (btnCopy) btnCopy.disabled = false;
    if (btnDownload) btnDownload.disabled = isBatchExporting;

    const isVideo = activeItem.mediaKind === 'video';
    ensureVideoToolVisibility(isVideo);
    if (isVideo) {
      syncVideoInputsFromActiveItem();
    }

    applySmartAnimatedFormatDefault();

    zoomMode = 'fit';
    panX = 0;
    panY = 0;
    renderCurrent();
    startPlaybackIfNeeded();
    renderBatchQueueUI();
    updateFormatUI();
  }

  function removeQueueIndex(index: number): void {
    if (index < 0 || index >= queue.length) return;
    const removedEl = batchQueueList?.children[index] as HTMLElement | undefined;
    const hadFocus = Boolean(removedEl?.contains(document.activeElement));

    const [removed] = queue.splice(index, 1);
    if (removed) {
      disposeQueueItem(removed);
    }

    if (queue.length === 0) {
      clearWorkspace();
      if (hadFocus) btnBatchAdd?.focus();
      return;
    }

    const nextIndex = Math.min(activeIndex, queue.length - 1);
    selectQueueIndex(Math.max(0, nextIndex));

    if (hadFocus) {
      const focusIdx = Math.min(index, queue.length - 1);
      const targetBtn = batchQueueList?.children[focusIdx]?.querySelector('button');
      if (targetBtn) {
        targetBtn.focus();
      } else {
        btnBatchAdd?.focus();
      }
    }
  }

  function waitForNextPaint(): Promise<void> {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        void yieldToMain().then(resolve);
      });
    });
  }

  function updateImportLoadingModal(
    title: string,
    detail: string,
    countText: string,
    percent: number
  ): void {
    if (importLoadingTitle) importLoadingTitle.textContent = title;
    if (importLoadingDetail) importLoadingDetail.textContent = detail;
    if (importLoadingCount) importLoadingCount.textContent = countText;
    if (importLoadingProgress) {
      importLoadingProgress.max = 100;
      importLoadingProgress.value = Math.min(100, Math.max(0, percent));
    }
  }

  function openImportLoadingModal(): void {
    if (!importLoadingDialog) return;
    if (btnImportCancel) btnImportCancel.disabled = false;
    if (!importLoadingDialog.open) {
      importLoadingDialog.showModal();
    }
  }

  function closeImportLoadingModal(): void {
    if (importLoadingDialog?.open) {
      importLoadingDialog.close();
    }
    if (btnImportCancel) btnImportCancel.disabled = false;
  }

  function requestImportCancel(): void {
    if (!importAbortController || importAbortController.signal.aborted) return;
    if (btnImportCancel) btnImportCancel.disabled = true;
    if (importLoadingDetail) importLoadingDetail.textContent = 'Cancelando carregamento...';
    importAbortController.abort();
  }

  btnImportCancel?.addEventListener('click', requestImportCancel);
  importLoadingDialog?.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestImportCancel();
  });

  async function handleFilesSelection(
    files: File[],
    options?: { append?: boolean; sourceLabel?: string }
  ): Promise<void> {
    if (files.length === 0 || isImporting || isBatchExporting) return;

    isImporting = true;
    const wasPaused = isPlaybackPaused;
    stopAllPlayback();

    const controller = new AbortController();
    importAbortController = controller;
    const signal = controller.signal;

    const shouldShowImmediate =
      files.length > 1 ||
      files.some((file) => {
        const lower = file.name.toLowerCase();
        return (
          isVideoFile(file) ||
          file.type === 'image/gif' ||
          file.type === 'image/webp' ||
          lower.endsWith('.gif') ||
          lower.endsWith('.webp') ||
          file.size > 1_500_000
        );
      });

    updateImportLoadingModal(
      files.length > 1 ? `Carregando ${files.length} arquivos...` : 'Carregando arquivo...',
      'Preparando mídia...',
      `0 / ${files.length}`,
      0
    );

    let modalTimer: number | null = null;
    if (shouldShowImmediate) {
      openImportLoadingModal();
      await waitForNextPaint();
    } else {
      modalTimer = window.setTimeout(() => {
        if (isImporting && !signal.aborted) {
          openImportLoadingModal();
        }
      }, 120);
    }

    const loaded: QueueItem[] = [];
    let failedCount = 0;
    let cancelled = false;

    try {
      for (let i = 0; i < files.length; i++) {
        if (signal.aborted) {
          cancelled = true;
          break;
        }

        const file = files[i]!;
        const titleText =
          files.length > 1
            ? `Carregando arquivo ${i + 1} de ${files.length}`
            : 'Carregando arquivo...';
        updateImportLoadingModal(
          titleText,
          file.name,
          `${i + 1} / ${files.length}`,
          (i / files.length) * 100
        );

        try {
          const media = await loadImageFromFile(file, {
            signal,
            onProgress: ({ fraction, detailText }) => {
              const pct = ((i + Math.min(1, Math.max(0, fraction))) / files.length) * 100;
              updateImportLoadingModal(
                titleText,
                detailText ? `${file.name} — ${detailText}` : file.name,
                `${i + 1} / ${files.length}`,
                pct
              );
            },
          });

          const id =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          loaded.push({ ...media, id });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            cancelled = true;
            break;
          }
          failedCount++;
        }

        await yieldToMain();
      }

      if (cancelled || signal.aborted) {
        for (const item of loaded) {
          disposeQueueItem(item);
        }
        showToast('Carregamento cancelado');
        return;
      }

      if (loaded.length === 0) {
        showToast('Não foi possível abrir nenhum dos arquivos selecionados');
        return;
      }

      updateImportLoadingModal(
        'Preparando visualização...',
        loaded[0]!.baseName,
        `${files.length} / ${files.length}`,
        100
      );

      if (options?.append && queue.length > 0) {
        const firstNewIndex = queue.length;
        queue = [...queue, ...loaded];
        selectQueueIndex(firstNewIndex);
      } else {
        for (const oldItem of queue) {
          disposeQueueItem(oldItem);
        }
        queue = loaded;
        selectQueueIndex(0);
      }

      if (loaded.length > 1) {
        const suffix = failedCount > 0 ? ` (${failedCount} falhou)` : '';
        showToast(`${loaded.length} arquivos carregados${suffix}`);
      } else if (options?.sourceLabel) {
        showToast(options.sourceLabel);
      }
    } finally {
      if (modalTimer !== null) {
        window.clearTimeout(modalTimer);
      }
      closeImportLoadingModal();
      importAbortController = null;
      isImporting = false;
      if (cancelled && !wasPaused && isAnimatedQueueItem(getActiveItem())) {
        startPlaybackIfNeeded();
      }
    }
  }

  // Observa redimensionamento do palco físico para auto-redimensionar a imagem quando em modo fit
  if (stageWrapper && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (getActiveItem() && zoomMode === 'fit') {
        zoomScale = computeFitScale();
        panX = 0;
        panY = 0;
        applyViewportTransform();
      }
    });
    ro.observe(stageWrapper);
  }

  // Zoom com a roda do mouse focalizado na posição do cursor
  canvasContainer?.addEventListener(
    'wheel',
    (e) => {
      if (!getActiveItem()) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setManualZoom(zoomScale * factor, e.clientX, e.clientY);
    },
    { passive: false }
  );

  // Pan (Arrastar imagem dentro do palco fixo) via Pointer Events
  let isPanning = false;
  let startPointerX = 0;
  let startPointerY = 0;
  let startPanX = 0;
  let startPanY = 0;

  canvasContainer?.addEventListener('pointerdown', (e) => {
    if (!getActiveItem() || e.button !== 0) return;
    isPanning = true;
    startPointerX = e.clientX;
    startPointerY = e.clientY;
    startPanX = panX;
    startPanY = panY;
    canvasContainer.setPointerCapture(e.pointerId);
  });

  canvasContainer?.addEventListener('pointermove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - startPointerX;
    const dy = e.clientY - startPointerY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      zoomMode = 'manual';
    }
    panX = startPanX + dx;
    panY = startPanY + dy;
    applyViewportTransform();
  });

  const endPan = (e: PointerEvent) => {
    if (!isPanning) return;
    isPanning = false;
    if (canvasContainer?.hasPointerCapture(e.pointerId)) {
      canvasContainer.releasePointerCapture(e.pointerId);
    }
  };

  canvasContainer?.addEventListener('pointerup', endPan);
  canvasContainer?.addEventListener('pointercancel', endPan);

  canvasContainer?.addEventListener('dblclick', () => {
    if (!getActiveItem()) return;
    fitCanvasToStage();
    showToast('Imagem ajustada automaticamente ao palco');
  });

  btnZoomIn?.addEventListener('click', () => {
    if (!getActiveItem()) return;
    setManualZoom(zoomScale * 1.2);
  });

  btnZoomOut?.addEventListener('click', () => {
    if (!getActiveItem()) return;
    setManualZoom(zoomScale / 1.2);
  });

  btnZoom100?.addEventListener('click', () => {
    if (!getActiveItem()) return;
    zoomMode = 'manual';
    zoomScale = 1;
    panX = 0;
    panY = 0;
    applyViewportTransform();
  });

  btnZoomFit?.addEventListener('click', () => {
    if (!getActiveItem()) return;
    fitCanvasToStage();
  });

  btnAnimPlayPause?.addEventListener('click', () => {
    const activeItem = getActiveItem();
    if (!isAnimatedQueueItem(activeItem)) return;

    isPlaybackPaused = !isPlaybackPaused;
    if (isPlaybackPaused) {
      stopAllPlayback();
      renderCurrentFrameOnly();
      return;
    }

    if (activeItem?.mediaKind === 'video' && activeItem.videoAsset && activeItem.videoConfig) {
      const video = activeItem.videoAsset.video;
      if (video.currentTime >= activeItem.videoConfig.trimEnd - 0.05) {
        video.currentTime = activeItem.videoConfig.trimStart;
      }
    } else if (activeItem?.gifFrames && gifFrameIndex >= activeItem.gifFrames.length - 1) {
      gifFrameIndex = 0;
    }

    startPlaybackIfNeeded();
  });

  document.addEventListener('visibilitychange', () => {
    const activeItem = getActiveItem();
    if (document.visibilityState === 'hidden') {
      if (!isPlaybackPaused && isAnimatedQueueItem(activeItem)) {
        pausedByVisibility = true;
        stopAllPlayback();
      }
    } else if (pausedByVisibility) {
      pausedByVisibility = false;
      if (!isPlaybackPaused && isAnimatedQueueItem(activeItem) && !isBatchExporting) {
        startPlaybackIfNeeded();
      }
    }
  });

  // Bindings dos sliders e campos numéricos de sombra
  for (const key of controlKeys) {
    const pair = controlPairs[key];
    if (!pair) continue;

    const onUpdate = (source: HTMLInputElement) => {
      const parsed = parseFloat(source.value);
      if (Number.isNaN(parsed)) return;
      shadowState[key] = parsed;
      pair.range.value = String(parsed);
      pair.number.value = String(parsed);
      updateRangeProgressFallback(pair.range);
      highlightActivePreset(null);
      renderCurrent();
    };

    pair.range.addEventListener('input', () => onUpdate(pair.range));
    pair.number.addEventListener('input', () => onUpdate(pair.number));
  }

  // Botões de Stepper customizado (− / +) substituindo as setinhas nativas
  document.querySelectorAll<HTMLButtonElement>('[data-step-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.stepTarget;
      const dir = btn.dataset.stepDir;
      if (!targetId) return;
      const inputEl = document.getElementById(targetId) as HTMLInputElement | null;
      if (!inputEl) return;

      if (dir === '-1') {
        inputEl.stepDown();
      } else {
        inputEl.stepUp();
      }

      const numericVal = parseFloat(inputEl.value);
      if (!Number.isNaN(numericVal)) {
        inputEl.value = String(Number(numericVal.toFixed(4)));
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // Bindings de Raio Geral e Cantos Individuais de Bordas
  const clampRadiusInput = (raw: number): number =>
    Math.min(MAX_BORDER_RADIUS, Math.max(0, Math.round(raw)));

  if (radiusAllRange && radiusAllNumber) {
    const onAllRadiusUpdate = (source: HTMLInputElement) => {
      const parsed = parseFloat(source.value);
      if (Number.isNaN(parsed)) return;
      const val = clampRadiusInput(parsed);
      borderRadiusState.topLeft = val;
      borderRadiusState.topRight = val;
      borderRadiusState.bottomRight = val;
      borderRadiusState.bottomLeft = val;
      syncRadiusInputsFromState();
      renderCurrent();
    };
    radiusAllRange.addEventListener('input', () => onAllRadiusUpdate(radiusAllRange));
    radiusAllNumber.addEventListener('input', () => onAllRadiusUpdate(radiusAllNumber));
  }

  for (const key of cornerKeys) {
    const pair = cornerPairs[key];
    if (!pair) continue;

    const onCornerUpdate = (source: HTMLInputElement) => {
      const parsed = parseFloat(source.value);
      if (Number.isNaN(parsed)) return;
      borderRadiusState[key] = clampRadiusInput(parsed);
      syncRadiusInputsFromState();
      renderCurrent();
    };

    pair.range.addEventListener('input', () => onCornerUpdate(pair.range));
    pair.number.addEventListener('input', () => onCornerUpdate(pair.number));
  }

  document.querySelectorAll<HTMLButtonElement>('[data-radius-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.radiusPreset as BorderRadiusPresetName | undefined;
      if (preset && preset in BORDER_RADIUS_PRESETS) {
        applyBorderRadiusPreset(preset);
      }
    });
  });

  btnSyncCorners?.addEventListener('click', () => {
    const base =
      borderRadiusState.topLeft > 0
        ? borderRadiusState.topLeft
        : Math.max(
            borderRadiusState.topLeft,
            borderRadiusState.topRight,
            borderRadiusState.bottomRight,
            borderRadiusState.bottomLeft
          );
    borderRadiusState.topLeft = base;
    borderRadiusState.topRight = base;
    borderRadiusState.bottomRight = base;
    borderRadiusState.bottomLeft = base;
    syncRadiusInputsFromState();
    renderCurrent();
  });

  // Bindings do painel de Vídeo (FPS, largura máxima e recorte início/fim)
  function updateActiveVideoConfig(
    patch: Partial<VideoConfig>,
    seekPreviewTime?: number
  ): void {
    const activeItem = getActiveItem();
    if (!activeItem || activeItem.mediaKind !== 'video' || !activeItem.videoAsset) {
      return;
    }

    const duration = activeItem.videoAsset.duration;
    const merged: Partial<VideoConfig> = {
      ...(activeItem.videoConfig ?? {
        fps: DEFAULT_VIDEO_FPS,
        maxWidth: 0,
        trimStart: 0,
        trimEnd: duration,
      }),
      ...patch,
    };

    // Ao recuar o fim abaixo do início atual, recua o início proporcionalmente
    if (
      patch.trimEnd !== undefined &&
      patch.trimStart === undefined &&
      merged.trimStart !== undefined &&
      patch.trimEnd < merged.trimStart + Math.min(0.1, duration)
    ) {
      merged.trimStart = Math.max(0, patch.trimEnd - Math.min(0.1, duration));
    }

    activeItem.videoConfig = sanitizeVideoConfig(merged, duration);
    videoLastRenderPerf = 0;
    syncVideoInputsFromActiveItem();
    updateFormatUI();

    if (seekPreviewTime !== undefined) {
      const target = Math.min(
        Math.max(0, duration - 0.005),
        Math.max(0, seekPreviewTime)
      );
      void seekVideoToTime(activeItem.videoAsset.video, target)
        .then(() => {
          if (getActiveItem() === activeItem) {
            renderCurrent();
          }
        })
        .catch(() => undefined);
    } else {
      renderCurrent();
    }
  }

  document.querySelectorAll<HTMLButtonElement>('[data-video-fps]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fps = Number(btn.dataset.videoFps);
      if (Number.isFinite(fps)) {
        updateActiveVideoConfig({ fps });
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-video-width]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const maxWidth = Number(btn.dataset.videoWidth);
      if (Number.isFinite(maxWidth)) {
        updateActiveVideoConfig({ maxWidth });
      }
    });
  });

  const handleTrimInput = (kind: 'start' | 'end', source: HTMLInputElement) => {
    const parsed = parseFloat(source.value);
    if (Number.isNaN(parsed)) return;
    const activeItem = getActiveItem();
    if (!activeItem || !activeItem.videoAsset) return;

    if (kind === 'start') {
      updateActiveVideoConfig({ trimStart: parsed }, parsed);
    } else {
      const previewAt = Math.max(0, parsed - 0.04);
      updateActiveVideoConfig({ trimEnd: parsed }, previewAt);
    }
  };

  videoStartRange?.addEventListener('input', () => handleTrimInput('start', videoStartRange));
  videoStartNumber?.addEventListener('input', () => handleTrimInput('start', videoStartNumber));
  videoEndRange?.addEventListener('input', () => handleTrimInput('end', videoEndRange));
  videoEndNumber?.addEventListener('input', () => handleTrimInput('end', videoEndNumber));

  for (const btn of toolButtons) {
    btn.addEventListener('click', () => {
      const toolId = btn.dataset.tool as ToolId | undefined;
      if (toolId && TOOL_ORDER.includes(toolId)) {
        handleToolSelect(toolId);
      }
    });
  }

  // Bindings de Presets de sombra
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset as PresetName | undefined;
      if (preset && preset in SHADOW_PRESETS) {
        applyPreset(preset);
      }
    });
  });

  // Seletor de fundo do palco de preview (Quadriculado / Claro / Escuro)
  document.querySelectorAll<HTMLButtonElement>('[data-stage-theme]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.stageTheme as StageTheme | undefined;
      if (!theme || !stageWrapper) return;

      stageWrapper.classList.remove('stage-checkerboard', 'stage-light', 'stage-dark');
      stageWrapper.classList.add(`stage-${theme}`);

      document.querySelectorAll<HTMLButtonElement>('[data-stage-theme]').forEach((b) => {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    });
  });

  // Detecção de formatos suportados pelo navegador (AVIF / WebP) e bindings de formato
  detectSupportedExportFormats().then((supported) => {
    supportsWebpEncoding = supported.has('image/webp');

    const formatRadios = document.querySelectorAll<HTMLInputElement>('input[name="export-format"]');
    formatRadios.forEach((radio) => {
      const mime = radio.value as ImageFormat;
      if (!supported.has(mime)) {
        radio.disabled = true;
        const label = radio.closest('label');
        if (label) {
          label.classList.add('opacity-40', 'cursor-not-allowed');
          label.title = 'Formato não suportado pelo codificador nativo deste navegador';
        }
      }
    });

    if (!supportsWebpEncoding && animFmtWebpRadio) {
      animFmtWebpRadio.disabled = true;
      animFmtWebpRadio.checked = false;
      const webpLabel = animFmtWebpRadio.closest('label');
      if (webpLabel) {
        webpLabel.classList.add('opacity-40', 'cursor-not-allowed');
        webpLabel.title = 'WebP animado não é suportado pelo codificador nativo deste navegador';
      }
      if (animFmtGifRadio) {
        animFmtGifRadio.checked = true;
      }
      animatedExportState.format = 'image/gif';
      updateFormatUI();
    }
  });

  function updateFormatUI(): void {
    const staticMeta = FORMAT_OPTIONS.find((f) => f.mime === exportState.format);
    const animMeta = ANIMATED_FORMAT_OPTIONS.find((f) => f.mime === animatedExportState.format);
    if (!staticMeta || !animMeta) return;

    const hasAnimated = queue.some((item) => isAnimatedQueueItem(item));
    const hasStatic = queue.some((item) => !isAnimatedQueueItem(item));
    const showStaticSection = queue.length === 0 || hasStatic;

    if (staticFormatSection) {
      staticFormatSection.hidden = !showStaticSection;
    }
    if (animatedFormatSection) {
      animatedFormatSection.hidden = !hasAnimated;
    }

    if (downloadFormatLabel) {
      if (queue.length === 0 || !hasAnimated) {
        downloadFormatLabel.textContent = staticMeta.extension.toUpperCase();
      } else if (!hasStatic) {
        downloadFormatLabel.textContent = animMeta.shortLabel;
      } else {
        downloadFormatLabel.textContent = `${staticMeta.extension.toUpperCase()} / ${animMeta.shortLabel}`;
      }
    }

    if (animatedInfoBadge && hasAnimated) {
      const activeItem = getActiveItem();
      if (activeItem?.mediaKind === 'video' && activeItem.videoAsset && activeItem.videoConfig) {
        const plan = computeVideoExportPlan(
          activeItem.videoAsset.nativeWidth,
          activeItem.videoAsset.nativeHeight,
          activeItem.videoAsset.duration,
          activeItem.videoConfig
        );
        animatedInfoBadge.textContent = `${plan.frameCount} frames • ${plan.config.fps} fps`;
      } else if (activeItem && isAnimatedFrameItem(activeItem)) {
        animatedInfoBadge.textContent = `${activeItem.gifFrames!.length} frames`;
      } else {
        const animCount = queue.filter((it) => isAnimatedQueueItem(it)).length;
        animatedInfoBadge.textContent = `${animCount} animado(s)`;
      }
    }

    if (animatedFormatHint) {
      animatedFormatHint.textContent =
        animatedExportState.format === 'image/webp'
          ? '16M cores, arquivo leve e sombra com transparência real em loop.'
          : 'Compatível com qualquer app/e-mail; 256 cores sobre fundo branco.';
    }

    if (gifDitheringWrapper) {
      gifDitheringWrapper.hidden = !hasAnimated || animatedExportState.format !== 'image/gif';
    }

    if (qualityFieldset) {
      const needsQuality =
        (showStaticSection && staticMeta.supportsLossyQuality) ||
        (hasAnimated && animMeta.supportsLossyQuality);
      qualityFieldset.classList.toggle('hidden', !needsQuality);
    }

    if (formatHint) {
      if (staticMeta.mime === 'image/png') {
        formatHint.textContent = 'Sem perda de qualidade (Lossless) com fundo 100% transparente.';
      } else if (staticMeta.mime === 'image/webp') {
        formatHint.textContent = 'Alta compressão com suporte total a sombra transparente.';
      } else if (staticMeta.mime === 'image/avif') {
        formatHint.textContent = 'Compressão de última geração com transparência.';
      } else {
        formatHint.textContent = 'Sem transparência: preenche o fundo com branco automaticamente.';
      }
    }

    scheduleSizeEstimation();
  }

  document.querySelectorAll<HTMLInputElement>('input[name="export-format"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        exportState.format = radio.value as ImageFormat;
        updateFormatUI();
      }
    });
  });

  document
    .querySelectorAll<HTMLInputElement>('input[name="animated-export-format"]')
    .forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          hasUserChosenAnimatedFormat = true;
          animatedExportState.format = radio.value as AnimatedFormat;
          updateFormatUI();
        }
      });
    });

  document.querySelectorAll<HTMLButtonElement>('[data-gif-dither]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const enabled = btn.dataset.gifDither === 'on';
      animatedExportState.dithering = enabled;
      document.querySelectorAll<HTMLButtonElement>('[data-gif-dither]').forEach((b) => {
        b.setAttribute('aria-pressed', (b.dataset.gifDither === 'on') === enabled ? 'true' : 'false');
      });
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-anim-loop]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const loopEnabled = btn.dataset.animLoop === 'true';
      animatedExportState.loop = loopEnabled;
      document.querySelectorAll<HTMLButtonElement>('[data-anim-loop]').forEach((b) => {
        b.setAttribute('aria-pressed', (b.dataset.animLoop === 'true') === loopEnabled ? 'true' : 'false');
      });
    });
  });

  if (qualityRange && qualityNumber) {
    const syncQuality = (source: HTMLInputElement) => {
      const val = Math.min(100, Math.max(10, parseInt(source.value, 10) || 88));
      qualityRange.value = String(val);
      qualityNumber.value = String(val);
      exportState.quality = val / 100;
      updateRangeProgressFallback(qualityRange);
      scheduleSizeEstimation();
    };
    qualityRange.addEventListener('input', () => syncQuality(qualityRange));
    qualityNumber.addEventListener('input', () => syncQuality(qualityNumber));
    updateRangeProgressFallback(qualityRange);
  }

  // Upload via input file (suporta múltiplos arquivos de imagem e vídeo)
  uploadInput?.addEventListener('change', () => {
    const files = Array.from(uploadInput.files ?? []).filter((f) => isSupportedMediaFile(f));
    if (files.length > 0) {
      void handleFilesSelection(files, { sourceLabel: 'Arquivo carregado' });
      uploadInput.value = '';
    }
  });

  // Adicionar mais arquivos ao lote existente
  btnBatchAdd?.addEventListener('click', () => {
    uploadAppendInput?.click();
  });

  uploadAppendInput?.addEventListener('change', () => {
    const files = Array.from(uploadAppendInput.files ?? []).filter((f) => isSupportedMediaFile(f));
    if (files.length > 0) {
      void handleFilesSelection(files, {
        append: true,
        sourceLabel: 'Arquivo adicionado ao lote',
      });
      uploadAppendInput.value = '';
    }
  });

  btnBatchClear?.addEventListener('click', () => {
    clearWorkspace();
    showToast('Fila de arquivos limpa');
  });

  // Permite rolar horizontalmente a fila do rodapé usando a roda do mouse
  batchQueueList?.addEventListener(
    'wheel',
    (e) => {
      if (batchQueueList.scrollWidth <= batchQueueList.clientWidth) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        batchQueueList.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );

  // Drag & Drop fluido por contador único (evita mutações de DOM a cada pixel em dragover)
  const setDropHighlight = (active: boolean) => {
    const targets = [dropzoneLabel, stageWrapper].filter(Boolean) as HTMLElement[];
    targets.forEach((el) => {
      el.classList.toggle('border-[var(--color-brand)]', active);
      el.classList.toggle('bg-[var(--brand-subtle)]', active);
    });
  };

  let dragDepth = 0;

  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    if (dragDepth === 1) {
      setDropHighlight(true);
    }
  });

  window.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  window.addEventListener('dragleave', () => {
    if (dragDepth <= 0) return;
    dragDepth--;
    if (dragDepth === 0) {
      setDropHighlight(false);
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    setDropHighlight(false);
    const files = extractImagesFromDrop(e);
    if (files.length > 0) {
      void handleFilesSelection(files, { sourceLabel: 'Arquivo carregado via Drag & Drop' });
    }
  });

  // Colar print/vídeo via Ctrl+V em qualquer lugar da página
  window.addEventListener('paste', (e) => {
    const files = extractImagesFromClipboard(e);
    if (files.length > 0) {
      e.preventDefault();
      void handleFilesSelection(files, {
        sourceLabel: 'Arquivo colado da Área de Transferência (Ctrl+V)',
      });
    }
  });

  // Botão Resetar
  btnReset?.addEventListener('click', () => {
    zoomMode = 'fit';
    panX = 0;
    panY = 0;
    applyPreset('medio');
    applyBorderRadiusPreset('nenhum');

    const activeItem = getActiveItem();
    if (activeItem?.mediaKind === 'video' && activeItem.videoAsset) {
      updateActiveVideoConfig(
        {
          fps: DEFAULT_VIDEO_FPS,
          maxWidth: 0,
          trimStart: 0,
          trimEnd: activeItem.videoAsset.duration,
        },
        0
      );
    }

    showToast('Ajustes e enquadramento restaurados');
  });

  // Botão Carregar Exemplo
  btnSample?.addEventListener('click', async () => {
    const sampleFile = await createSampleScreenshotFile();
    await handleFilesSelection([sampleFile], { sourceLabel: 'Print de exemplo carregado' });
  });

  // Ação de Copiar para Área de Transferência
  async function handleCopyAction(): Promise<void> {
    if (!getActiveItem() || !canvas) return;
    try {
      await copyCanvasToClipboard(canvas);
      showToast('Frame/imagem copiada para a Área de Transferência! (Ctrl+V para colar)');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao copiar imagem');
    }
  }

  btnCopy?.addEventListener('click', handleCopyAction);

  // Atalho Ctrl+C quando nenhum input de texto/número estiver focado
  window.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement?.tagName;
    const isInputFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
    if (!isInputFocused && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && getActiveItem()) {
      const selection = window.getSelection()?.toString();
      if (!selection) {
        e.preventDefault();
        void handleCopyAction();
      }
    }
  });

  btnExportCancel?.addEventListener('click', () => {
    exportAbortController?.abort();
  });

  async function exportAnimatedItem(
    item: QueueItem,
    prefix: string,
    signal: AbortSignal
  ): Promise<{ blob: Blob; format: AnimatedFormat }> {
    const source =
      item.mediaKind === 'video' && item.videoAsset
        ? createVideoFrameSource(
            item.videoAsset.objectUrl,
            item.videoAsset.nativeWidth,
            item.videoAsset.nativeHeight,
            item.videoAsset.duration,
            item.videoConfig ?? {}
          )
        : item.gifFrames!;

    const total = Array.isArray(source) ? source.length : source.totalFrames;
    const format: AnimatedFormat = animatedExportState.format;
    const shortLabel = format === 'image/webp' ? 'WebP' : 'GIF';

    showExportProgress(`${prefix}Codificando ${shortLabel} (0/${total})...`, 0, total);
    const onProgress = (cur: number, tot: number) => {
      showExportProgress(`${prefix}Codificando ${shortLabel} (${cur}/${tot})...`, cur, tot);
    };

    if (format === 'image/webp') {
      const blob = await encodeAnimatedWebpToBlob(source, shadowState, {
        borderRadius: borderRadiusState,
        quality: exportState.quality,
        loop: animatedExportState.loop,
        onProgress,
        signal,
      });
      return { blob, format };
    }

    const blob = await encodeAnimatedGifToBlob(source, shadowState, {
      borderRadius: borderRadiusState,
      dithering: animatedExportState.dithering,
      loop: animatedExportState.loop,
      onProgress,
      signal,
    });
    return { blob, format };
  }

  // Botão de Download / Exportação (individual ou em lote, estático ou animado)
  btnDownload?.addEventListener('click', async () => {
    if (queue.length === 0 || !canvas || isBatchExporting) return;

    const staticMeta = FORMAT_OPTIONS.find((f) => f.mime === exportState.format);
    const extUpper = (staticMeta?.extension ?? 'png').toUpperCase();

    if (queue.length === 1 && !isAnimatedQueueItem(queue[0]!)) {
      const single = queue[0]!;
      try {
        const blob = await encodeCanvasToBlob(
          canvas,
          single.image,
          shadowState,
          exportState,
          borderRadiusState
        );
        triggerBlobDownload(blob, single.baseName, exportState.format);
        showToast(`Exportado em ${extUpper} (${formatByteSize(blob.size)})`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Falha na exportação');
      }
      return;
    }

    const wasPaused = isPlaybackPaused;
    stopAllPlayback();
    isBatchExporting = true;
    btnDownload.disabled = true;
    exportAbortController = new AbortController();
    const signal = exportAbortController.signal;
    const offscreenCanvas = document.createElement('canvas');

    try {
      for (let i = 0; i < queue.length; i++) {
        if (signal.aborted) {
          throw new DOMException('Exportação cancelada pelo usuário.', 'AbortError');
        }

        const item = queue[i]!;
        const prefix = queue.length > 1 ? `[${i + 1}/${queue.length}] ${item.baseName}: ` : '';

        if (isAnimatedQueueItem(item)) {
          const { blob, format } = await exportAnimatedItem(item, prefix, signal);
          triggerBlobDownload(blob, item.baseName, format);
          if (queue.length === 1) {
            const label = format === 'image/webp' ? 'WebP animado' : 'GIF';
            showToast(`${label} exportado (${formatByteSize(blob.size)})`);
          }
        } else {
          showExportProgress(`${prefix}Exportando ${extUpper}...`, i + 1, queue.length);
          renderShadowCanvas(offscreenCanvas, item.image, shadowState, {
            borderRadius: borderRadiusState,
          });
          const blob = await encodeCanvasToBlob(
            offscreenCanvas,
            item.image,
            shadowState,
            exportState,
            borderRadiusState
          );
          triggerBlobDownload(blob, item.baseName, exportState.format);
        }

        if (i < queue.length - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 160));
        }
      }

      if (queue.length > 1) {
        showToast(`${queue.length} arquivos exportados!`);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        showToast('Exportação cancelada');
      } else {
        showToast(err instanceof Error ? err.message : 'Falha na exportação');
      }
    } finally {
      hideExportProgress();
      exportAbortController = null;
      isBatchExporting = false;
      btnDownload.disabled = queue.length === 0;
      if (!wasPaused && isAnimatedQueueItem(getActiveItem())) {
        startPlaybackIfNeeded();
      }
    }
  });

  // Two-state Dark Mode Toggle (seguindo modern-web-guidance: dark-mode-toggle)
  function getMetaScheme(): HTMLMetaElement | null {
    return document.querySelector('meta[name="color-scheme"]');
  }

  function getSystemScheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function getRenderedScheme(): 'light' | 'dark' {
    const metaVal = getMetaScheme()?.content;
    if (metaVal === 'light' || metaVal === 'dark') {
      return metaVal;
    }
    return getSystemScheme();
  }

  btnThemeToggle?.addEventListener('click', () => {
    const currentRendered = getRenderedScheme();
    const targetScheme: 'light' | 'dark' = currentRendered === 'dark' ? 'light' : 'dark';
    const systemScheme = getSystemScheme();
    const meta = getMetaScheme();

    try {
      if (targetScheme === systemScheme) {
        localStorage.removeItem('color-scheme');
        if (meta) meta.content = 'light dark';
      } else {
        localStorage.setItem('color-scheme', targetScheme);
        if (meta) meta.content = targetScheme;
      }
    } catch {
      if (meta) meta.content = targetScheme;
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'color-scheme') {
      const meta = getMetaScheme();
      if (meta) {
        meta.content = e.newValue ?? 'light dark';
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    stopAllPlayback();
    for (const item of queue) {
      disposeQueueItem(item);
    }
  });

  // Inicializa estado padrão
  applyPreset('medio');
  applyBorderRadiusPreset('nenhum');
  updateFormatUI();
  syncRailAria('shadow');
}
