import {
  copyCanvasToClipboard,
  detectSupportedExportFormats,
  encodeCanvasToBlob,
  extractImageFromClipboard,
  extractImageFromDrop,
  formatByteSize,
  loadImageFromFile,
  triggerBlobDownload,
} from '../lib/image-io';
import { renderShadowCanvas } from '../lib/shadow-engine';
import {
  FORMAT_OPTIONS,
  SHADOW_PRESETS,
  type ExportConfig,
  type ImageFormat,
  type PresetName,
  type ShadowConfig,
  type StageTheme,
} from '../lib/types';

interface NumericControlPair {
  range: HTMLInputElement;
  number: HTMLInputElement;
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

    // Card base com cantos arredondados
    sCtx.fillStyle = '#ffffff';
    sCtx.beginPath();
    sCtx.roundRect(0, 0, 640, 360, 12);
    sCtx.fill();

    // Barra superior de janela
    sCtx.fillStyle = '#f3f4f6';
    sCtx.beginPath();
    sCtx.roundRect(0, 0, 640, 44, [12, 12, 0, 0]);
    sCtx.fill();

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
    sCtx.fillText('Secullum Ponto Web — Comprovante de Ajuste (PF)', 90, 27);

    // Conteúdo simulado de sistema
    sCtx.fillStyle = '#7c3aed';
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
    sCtx.beginPath();
    sCtx.roundRect(0.5, 0.5, 639, 359, 12);
    sCtx.stroke();

    sampleCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Falha ao criar imagem de exemplo'));
        return;
      }
      resolve(new File([blob], 'pf-secullum-exemplo.png', { type: 'image/png' }));
    }, 'image/png');
  });
}

export function initImagePolisher(): void {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  const emptyState = document.getElementById('empty-state');
  const canvasContainer = document.getElementById('canvas-container');
  const stageWrapper = document.getElementById('stage-wrapper');
  const uploadInput = document.getElementById('upload') as HTMLInputElement | null;
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
  const downloadFormatLabel = document.getElementById('download-format-label');

  const qualityFieldset = document.getElementById('quality-control-wrapper');
  const qualityRange = document.getElementById('quality') as HTMLInputElement | null;
  const qualityNumber = document.getElementById('numQuality') as HTMLInputElement | null;
  const formatHint = document.getElementById('format-hint');

  if (!canvas) return;

  let currentImage: HTMLImageElement | null = null;
  let uploadedBaseName = 'imagem-editada';
  let originalBytes = 0;
  let estimateTimer: number | null = null;

  const shadowState: ShadowConfig = { ...SHADOW_PRESETS.medio };
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

  function updateRangeProgressFallback(rangeInput: HTMLInputElement): void {
    const min = parseFloat(rangeInput.min) || 0;
    const max = parseFloat(rangeInput.max) || 100;
    const val = parseFloat(rangeInput.value) || 0;
    const pct = ((val - min) / (max - min)) * 100;
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

  function highlightActivePreset(activePreset: PresetName | null): void {
    const presetButtons = document.querySelectorAll<HTMLButtonElement>('[data-preset]');
    presetButtons.forEach((btn) => {
      const isMatch = btn.dataset.preset === activePreset;
      btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    });
  }

  function scheduleSizeEstimation(): void {
    if (!currentImage || !canvas) return;
    if (estimateTimer !== null) {
      window.clearTimeout(estimateTimer);
    }
    estimateTimer = window.setTimeout(async () => {
      if (!currentImage) return;
      try {
        const blob = await encodeCanvasToBlob(canvas, currentImage, shadowState, exportState);
        const formattedOut = formatByteSize(blob.size);
        const formatMeta = FORMAT_OPTIONS.find((f) => f.mime === exportState.format);
        const extUpper = (formatMeta?.extension ?? 'png').toUpperCase();

        if (sizeEstimateBadge) {
          if (originalBytes > 0 && blob.size < originalBytes) {
            const savings = Math.round((1 - blob.size / originalBytes) * 100);
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

  function renderCurrent(): void {
    if (!currentImage || !canvas) return;

    const dims = renderShadowCanvas(canvas, currentImage, shadowState);

    if (dimensionsBadge) {
      dimensionsBadge.textContent = `${ currentImage.naturalWidth }×${ currentImage.naturalHeight } → ${ dims.width }×${ dims.height } px`;
      dimensionsBadge.classList.remove('hidden');
    }

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

  async function handleFileSelection(file: File, sourceLabel?: string): Promise<void> {
    try {
      const result = await loadImageFromFile(file);
      currentImage = result.image;
      uploadedBaseName = result.baseName;
      originalBytes = result.originalBytes;

      if (emptyState) emptyState.classList.add('hidden');
      if (canvasContainer) canvasContainer.classList.remove('hidden');

      if (fileNameBadge) {
        fileNameBadge.textContent = `${result.baseName} (${formatByteSize(result.originalBytes)})`;
      }

      if (btnCopy) btnCopy.disabled = false;
      if (btnDownload) btnDownload.disabled = false;

      renderCurrent();
      if (sourceLabel) {
        showToast(sourceLabel);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao abrir imagem');
    }
  }

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

    if (downloadFormatLabel) {
      downloadFormatLabel.textContent = meta.extension.toUpperCase();
    }

    if (qualityFieldset) {
      if (meta.supportsLossyQuality) {
        qualityFieldset.classList.remove('opacity-50', 'pointer-events-none');
      } else {
        qualityFieldset.classList.add('opacity-50', 'pointer-events-none');
      }
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

  // Upload via input file
  uploadInput?.addEventListener('change', () => {
    const file = uploadInput.files?.[0];
    if (file) {
      handleFileSelection(file, 'Imagem carregada');
      uploadInput.value = '';
    }
  });

  // Drag & Drop na página inteira e no dropzone
  const dragTargets = [document.body, dropzoneLabel].filter(Boolean) as HTMLElement[];
  dragTargets.forEach((target) => {
    target.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzoneLabel?.classList.add('border-purple-500', 'bg-purple-500/10');
    });
    target.addEventListener('dragleave', () => {
      dropzoneLabel?.classList.remove('border-purple-500', 'bg-purple-500/10');
    });
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzoneLabel?.classList.remove('border-purple-500', 'bg-purple-500/10');
    const file = extractImageFromDrop(e);
    if (file) {
      handleFileSelection(file, 'Imagem carregada via Drag & Drop');
    }
  });

  // Colar print via Ctrl+V em qualquer lugar da página
  window.addEventListener('paste', (e) => {
    const file = extractImageFromClipboard(e);
    if (file) {
      e.preventDefault();
      handleFileSelection(file, 'Print colado da Área de Transferência (Ctrl+V)');
    }
  });

  // Botão Resetar
  btnReset?.addEventListener('click', () => {
    applyPreset('medio');
    showToast('Ajustes restaurados para o padrão Médio');
  });

  // Botão Carregar Exemplo
  btnSample?.addEventListener('click', async () => {
    const sampleFile = await createSampleScreenshotFile();
    await handleFileSelection(sampleFile, 'Print de exemplo carregado');
  });

  // Ação de Copiar para Área de Transferência
  async function handleCopyAction(): Promise<void> {
    if (!currentImage || !canvas) return;
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
    if (!isInputFocused && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && currentImage) {
      const selection = window.getSelection()?.toString();
      if (!selection) {
        e.preventDefault();
        handleCopyAction();
      }
    }
  });

  // Botão de Download / Exportação no formato e compressão escolhidos
  btnDownload?.addEventListener('click', async () => {
    if (!currentImage || !canvas) return;
    try {
      const blob = await encodeCanvasToBlob(canvas, currentImage, shadowState, exportState);
      triggerBlobDownload(blob, uploadedBaseName, exportState.format);
      const formatMeta = FORMAT_OPTIONS.find((f) => f.mime === exportState.format);
      showToast(
        `Exportado em ${formatMeta?.extension.toUpperCase()} (${formatByteSize(blob.size)})`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha na exportação');
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
  updateFormatUI();
}
