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
  BORDER_RADIUS_PRESETS,
  FORMAT_OPTIONS,
  SHADOW_PRESETS,
  type BorderRadiusConfig,
  type BorderRadiusPresetName,
  type ExportConfig,
  type ImageFormat,
  type PresetName,
  type ShadowConfig,
  type StageTheme,
  type ToolId,
} from '../lib/types';

interface NumericControlPair {
  range: HTMLInputElement;
  number: HTMLInputElement;
}

interface QueueItem extends LoadedImageResult {
  id: string;
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

    // Card base retangular para evidenciar o arredondamento de bordas ao testar
    sCtx.fillStyle = '#ffffff';
    sCtx.fillRect(0, 0, 640, 360);

    // Barra superior de janela
    sCtx.fillStyle = '#f3f4f6';
    sCtx.fillRect(0, 0, 640, 44);

    // Três botões da janela
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

    // Título simulado
    sCtx.fillStyle = '#374151';
    sCtx.font = '600 13px Inter, system-ui, sans-serif';
    sCtx.fillText('Image Polisher — Print de Exemplo', 90, 27);

    // Conteúdo simulado de sistema
    sCtx.fillStyle = '#6741d9';
    sCtx.beginPath();
    sCtx.roundRect(28, 70, 140, 28, 6);
    sCtx.fill();

    sCtx.fillStyle = '#ffffff';
    sCtx.font = '600 12px Inter, system-ui, sans-serif';
    sCtx.fillText('Status: Aprovado', 46, 88);

    // Linhas de tabela simuladas
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

    // Borda sutil do print
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

  const uploadInput = document.getElementById('upload') as HTMLInputElement | null;
  const uploadAppendInput = document.getElementById('upload-append') as HTMLInputElement | null;
  const dropzoneLabel = document.getElementById('dropzone-label');
  const fileNameBadge = document.getElementById('file-name-badge');
  const dimensionsBadge = document.getElementById('dimensions-badge');
  const sizeEstimateBadge = document.getElementById('size-estimate-badge');
  const statusToast = document.getElementById('status-toast');

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
  const toolPropertiesPanel = document.getElementById('tool-properties-panel');
  const toolPanelInner = document.getElementById('tool-panel-inner');
  const toolPaneStack = document.getElementById('tool-pane-stack');
  const activePresetLabel = document.getElementById('active-preset-label');
  const activeRadiusPresetLabel = document.getElementById('active-radius-preset-label');
  const radiusMixedHint = document.getElementById('radius-mixed-hint');
  const btnSyncCorners = document.getElementById('btn-sync-corners') as HTMLButtonElement | null;
  const radiusAllRange = document.getElementById('radiusAll') as HTMLInputElement | null;
  const radiusAllNumber = document.getElementById('numRadiusAll') as HTMLInputElement | null;

  const qualityFieldset = document.getElementById('quality-control-wrapper');
  const qualityRange = document.getElementById('quality') as HTMLInputElement | null;
  const qualityNumber = document.getElementById('numQuality') as HTMLInputElement | null;
  const formatHint = document.getElementById('format-hint');
  const gifFormatNote = document.getElementById('gif-format-note');

  if (!canvas) return;

  let queue: QueueItem[] = [];
  let activeIndex = -1;
  let isBatchExporting = false;
  let estimateTimer: number | null = null;
  let gifTimer: number | null = null;
  let gifFrameIndex = 0;

  function stopGifAnimation(): void {
    if (gifTimer !== null) {
      window.clearTimeout(gifTimer);
      gifTimer = null;
    }
  }

  function getActiveItem(): QueueItem | null {
    if (activeIndex < 0 || activeIndex >= queue.length) return null;
    return queue[activeIndex] ?? null;
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
    // Reserva respiro interno para as barras flutuantes superior e inferior
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
    const pct = ((val - min) / (max - min)) * 100;
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

  const PRESET_LABELS: Record<PresetName, string> = {
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

  function scheduleSizeEstimation(): void {
    const activeItem = getActiveItem();
    if (!activeItem || !canvas) return;

    if (activeItem.gifFrames && activeItem.gifFrames.length > 1) {
      if (sizeEstimateBadge) {
        sizeEstimateBadge.textContent = `GIF • ${activeItem.gifFrames.length} frames`;
      }
      return;
    }

    if (estimateTimer !== null) {
      window.clearTimeout(estimateTimer);
    }
    estimateTimer = window.setTimeout(async () => {
      const current = getActiveItem();
      if (!current || (current.gifFrames && current.gifFrames.length > 1)) return;
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
  }

  function startGifAnimationIfNeeded(): void {
    stopGifAnimation();
    const activeItem = getActiveItem();
    const frames = activeItem?.gifFrames;
    if (!frames || frames.length <= 1) return;

    const tick = () => {
      const current = getActiveItem();
      if (!current || current.gifFrames !== frames) return;
      gifFrameIndex = (gifFrameIndex + 1) % frames.length;
      renderCurrentFrameOnly();
      const nextDelay = frames[gifFrameIndex]!.delayMs;
      gifTimer = window.setTimeout(tick, nextDelay);
    };

    const initialDelay = frames[gifFrameIndex % frames.length]!.delayMs;
    gifTimer = window.setTimeout(tick, initialDelay);
  }

  function renderCurrent(): void {
    const activeItem = getActiveItem();
    if (!activeItem || !canvas) return;

    renderCurrentFrameOnly();

    // Se estiver em modo Auto-Ajustar, recalcula automaticamente a escala para caber no palco fixo
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
        queue.length === 1
          ? '1 arquivo aberto — clique em Adicionar para montar um lote'
          : 'Abra ou arraste múltiplos arquivos para editar e exportar em lote';
    }

    if (!batchQueueBar || !batchQueueList) return;

    if (queue.length <= 1) {
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
      batchCountLabel.textContent = `Lote (${queue.length})`;
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
      thumb.className =
        'w-6 h-6 rounded object-cover shrink-0 border border-[var(--border-color)] bg-[var(--bg-panel)]';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'max-w-[130px] truncate text-left';
      labelSpan.textContent = item.baseName;

      selectBtn.append(thumb, labelSpan);

      if (item.gifFrames && item.gifFrames.length > 1) {
        const gifTag = document.createElement('span');
        gifTag.className =
          'text-[9px] font-mono uppercase px-1 py-0.5 rounded bg-[var(--bg-panel)] border border-[var(--border-color)] text-[var(--text-muted)] shrink-0';
        gifTag.textContent = 'GIF';
        selectBtn.appendChild(gifTag);
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

  function clearWorkspace(): void {
    stopGifAnimation();
    gifFrameIndex = 0;
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
    if (fileNameBadge) fileNameBadge.textContent = 'Cole Ctrl+V ou arraste imagens';
    if (btnZoom100) btnZoom100.textContent = '100%';
    if (btnCopy) btnCopy.disabled = true;
    if (btnDownload) btnDownload.disabled = true;
    renderBatchQueueUI();
    updateFormatUI();
  }

  function selectQueueIndex(index: number): void {
    if (index < 0 || index >= queue.length) return;
    stopGifAnimation();
    gifFrameIndex = 0;
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

    // Ao trocar ou carregar imagem, ativa o modo Auto-Ajustar centralizado
    zoomMode = 'fit';
    panX = 0;
    panY = 0;
    renderCurrent();
    startGifAnimationIfNeeded();
    renderBatchQueueUI();
    updateFormatUI();
  }

  function removeQueueIndex(index: number): void {
    if (index < 0 || index >= queue.length) return;
    const removedEl = batchQueueList?.children[index] as HTMLElement | undefined;
    const hadFocus = Boolean(removedEl?.contains(document.activeElement));

    queue.splice(index, 1);
    if (queue.length === 0) {
      clearWorkspace();
      if (hadFocus) btnBatchAdd?.focus();
      return;
    }

    const nextIndex = Math.min(activeIndex, queue.length - 1);
    selectQueueIndex(Math.max(0, nextIndex));

    if (hadFocus) {
      if (queue.length <= 1) {
        btnBatchAdd?.focus();
      } else {
        const focusIdx = Math.min(index, queue.length - 1);
        const targetBtn = batchQueueList?.children[focusIdx]?.querySelector('button');
        targetBtn?.focus();
      }
    }
  }

  async function handleFilesSelection(
    files: File[],
    options?: { append?: boolean; sourceLabel?: string }
  ): Promise<void> {
    if (files.length === 0) return;

    const results = await Promise.allSettled(files.map((file) => loadImageFromFile(file)));
    const loaded: QueueItem[] = [];

    for (const res of results) {
      if (res.status === 'fulfilled') {
        const id =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        loaded.push({ ...res.value, id });
      }
    }

    if (loaded.length === 0) {
      showToast('Não foi possível abrir nenhuma das imagens selecionadas');
      return;
    }

    const failedCount = files.length - loaded.length;

    if (options?.append && queue.length > 0) {
      const firstNewIndex = queue.length;
      queue = [...queue, ...loaded];
      selectQueueIndex(firstNewIndex);
    } else {
      queue = loaded;
      selectQueueIndex(0);
    }

    if (loaded.length > 1) {
      const suffix = failedCount > 0 ? ` (${failedCount} falhou)` : '';
      showToast(`${loaded.length} imagens carregadas${suffix}`);
    } else if (options?.sourceLabel) {
      showToast(options.sourceLabel);
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

  // Duplo clique no palco restaura o Auto-Ajuste
  canvasContainer?.addEventListener('dblclick', () => {
    if (!getActiveItem()) return;
    fitCanvasToStage();
    showToast('Imagem ajustada automaticamente ao palco');
  });

  // Botões da barra flutuante de Zoom
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

  // Controlador de ferramenta ativa e animações (abrir / fechar / trocar de opção)
  const TOOL_ORDER: ToolId[] = ['shadow', 'corners'];
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

  for (const btn of toolButtons) {
    btn.addEventListener('click', () => {
      const toolId = btn.dataset.tool as ToolId | undefined;
      if (toolId && TOOL_ORDER.includes(toolId)) {
        handleToolSelect(toolId);
      }
    });
  }

  // Bindings de Presets
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
  });

  function updateFormatUI(): void {
    const meta = FORMAT_OPTIONS.find((f) => f.mime === exportState.format);
    if (!meta) return;

    const hasGif = queue.some((item) => item.gifFrames && item.gifFrames.length > 1);
    const allGif = queue.length > 0 && queue.every((item) => item.gifFrames && item.gifFrames.length > 1);

    if (downloadFormatLabel) {
      if (allGif) {
        downloadFormatLabel.textContent = 'GIF';
      } else if (hasGif) {
        downloadFormatLabel.textContent = `${meta.extension.toUpperCase()} / GIF`;
      } else {
        downloadFormatLabel.textContent = meta.extension.toUpperCase();
      }
    }

    if (gifFormatNote) {
      gifFormatNote.classList.toggle('hidden', !hasGif);
    }

    if (qualityFieldset) {
      qualityFieldset.classList.toggle('hidden', !meta.supportsLossyQuality);
    }

    if (formatHint) {
      if (meta.mime === 'image/png') {
        formatHint.textContent = 'Sem perda de qualidade (Lossless) com fundo 100% transparente.';
      } else if (meta.mime === 'image/webp') {
        formatHint.textContent = 'Alta compressão com suporte total a sombra transparente.';
      } else if (meta.mime === 'image/avif') {
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

  // Upload via input file (suporta múltiplos arquivos)
  uploadInput?.addEventListener('change', () => {
    const files = Array.from(uploadInput.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) {
      handleFilesSelection(files, { sourceLabel: 'Imagem carregada' });
      uploadInput.value = '';
    }
  });

  // Adicionar mais imagens ao lote existente
  btnBatchAdd?.addEventListener('click', () => {
    uploadAppendInput?.click();
  });

  uploadAppendInput?.addEventListener('change', () => {
    const files = Array.from(uploadAppendInput.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length > 0) {
      handleFilesSelection(files, {
        append: true,
        sourceLabel: 'Imagem adicionada ao lote',
      });
      uploadAppendInput.value = '';
    }
  });

  btnBatchClear?.addEventListener('click', () => {
    clearWorkspace();
    showToast('Fila de imagens limpa');
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

  // Drag & Drop na página inteira e no dropzone
  const setDropHighlight = (active: boolean) => {
    const targets = [dropzoneLabel, stageWrapper].filter(Boolean) as HTMLElement[];
    targets.forEach((el) => {
      el.classList.toggle('border-[var(--color-brand)]', active);
      el.classList.toggle('bg-[var(--brand-subtle)]', active);
    });
  };

  const dragTargets = [document.body, dropzoneLabel, stageWrapper].filter(Boolean) as HTMLElement[];
  dragTargets.forEach((target) => {
    target.addEventListener('dragover', (e) => {
      e.preventDefault();
      setDropHighlight(true);
    });
    target.addEventListener('dragleave', () => {
      setDropHighlight(false);
    });
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    setDropHighlight(false);
    const files = extractImagesFromDrop(e);
    if (files.length > 0) {
      handleFilesSelection(files, { sourceLabel: 'Imagem carregada via Drag & Drop' });
    }
  });

  // Colar print via Ctrl+V em qualquer lugar da página
  window.addEventListener('paste', (e) => {
    const files = extractImagesFromClipboard(e);
    if (files.length > 0) {
      e.preventDefault();
      handleFilesSelection(files, { sourceLabel: 'Print colado da Área de Transferência (Ctrl+V)' });
    }
  });

  // Botão Resetar
  btnReset?.addEventListener('click', () => {
    zoomMode = 'fit';
    panX = 0;
    panY = 0;
    applyPreset('medio');
    applyBorderRadiusPreset('nenhum');
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
      showToast('Imagem copiada para a Área de Transferência! (Ctrl+V para colar)');
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
        handleCopyAction();
      }
    }
  });

  // Botão de Download / Exportação no formato e compressão escolhidos (individual ou em lote)
  btnDownload?.addEventListener('click', async () => {
    if (queue.length === 0 || !canvas || isBatchExporting) return;

    const formatMeta = FORMAT_OPTIONS.find((f) => f.mime === exportState.format);
    const extUpper = (formatMeta?.extension ?? 'png').toUpperCase();

    if (queue.length === 1) {
      const single = queue[0]!;
      if (single.gifFrames && single.gifFrames.length > 1) {
        isBatchExporting = true;
        btnDownload.disabled = true;
        try {
          showToast(`Codificando GIF (${single.gifFrames.length} frames)...`);
          const blob = await encodeAnimatedGifToBlob(
            single.gifFrames,
            shadowState,
            (cur, total) => {
              if (cur === total || cur % 10 === 0) {
                showToast(`Codificando GIF (${cur}/${total})...`);
              }
            },
            borderRadiusState
          );
          triggerBlobDownload(blob, single.baseName, 'image/gif');
          showToast(`GIF exportado (${formatByteSize(blob.size)})`);
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Falha ao exportar GIF');
        } finally {
          isBatchExporting = false;
          btnDownload.disabled = false;
        }
        return;
      }

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

    isBatchExporting = true;
    btnDownload.disabled = true;
    const offscreenCanvas = document.createElement('canvas');

    try {
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i]!;
        showToast(`Exportando ${i + 1}/${queue.length}: ${item.baseName}...`);

        if (item.gifFrames && item.gifFrames.length > 1) {
          const blob = await encodeAnimatedGifToBlob(
            item.gifFrames,
            shadowState,
            undefined,
            borderRadiusState
          );
          triggerBlobDownload(blob, item.baseName, 'image/gif');
        } else {
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

        // Pequena pausa entre downloads para evitar bloqueio/descarte pelo navegador
        if (i < queue.length - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 160));
        }
      }
      showToast(`${queue.length} arquivos exportados!`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha na exportação em lote');
    } finally {
      isBatchExporting = false;
      btnDownload.disabled = queue.length === 0;
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

  // Inicializa estado padrão
  applyPreset('medio');
  applyBorderRadiusPreset('nenhum');
  updateFormatUI();
  syncRailAria('shadow');
}
