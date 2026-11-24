let supportsDisplayTransition: boolean | undefined;

/**
 * Detecta suporte real à transição discreta da propriedade `display`
 * (contorna browsers como Firefox 129+ que fazem parse de `allow-discrete`
 * sem animar a saída de `display: none`).
 */
export function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (
    typeof window === 'undefined' ||
    !window.CSS?.supports?.('transition-behavior', 'allow-discrete') ||
    !document.body
  ) {
    return false;
  }

  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

/**
 * Aguarda as animações/transições ativas em um elemento (e opcionalmente em um alvo auxiliar)
 * com timeout de segurança para nunca travar quando não há transições ativas.
 */
export async function waitForElementAnimations(
  el: HTMLElement,
  timeoutMs = 420,
  extraTarget?: HTMLElement | null
): Promise<void> {
  const animations = [...el.getAnimations({ subtree: false })];
  if (extraTarget) {
    animations.push(...extraTarget.getAnimations({ subtree: false }));
  }

  if (animations.length === 0) return;

  await Promise.race([
    Promise.allSettled(animations.map((anim) => anim.finished)),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Exibe um elemento previamente ocultado por `[hidden]` ou `[data-closing]`,
 * disparando sua transição de entrada via `@starting-style`.
 */
export function showAnimatedElement(el: HTMLElement): void {
  el.removeAttribute('data-closing');
  el.hidden = false;
}

/**
 * Oculta um elemento executando a transição de saída de forma nativa quando suportado
 * ou via `[data-closing]` + `getAnimations()` nos demais navegadores.
 */
export async function hideAnimatedElement(
  el: HTMLElement,
  options?: {
    extraTarget?: HTMLElement | null;
    isCurrent?: () => boolean;
    timeoutMs?: number;
  }
): Promise<void> {
  if (canTransitionDisplay()) {
    el.hidden = true;
    return;
  }

  el.setAttribute('data-closing', '');
  await waitForElementAnimations(el, options?.timeoutMs ?? 420, options?.extraTarget);

  if (el.hasAttribute('data-closing') && (options?.isCurrent ? options.isCurrent() : true)) {
    el.removeAttribute('data-closing');
    el.hidden = true;
  }
}

/**
 * Retorna verdadeiro quando o usuário prefere movimento reduzido no sistema operacional.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
