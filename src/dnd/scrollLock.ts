/**
 * Locks a scrollable viewport to its current scroll position for the duration
 * of a drag gesture. Call at pointerdown; call the returned release function
 * at pointerup/pointercancel to remove the lock.
 */
export function lockViewportScroll(viewport: HTMLElement): () => void {
  const anchorLeft = viewport.scrollLeft;
  const anchorTop = viewport.scrollTop;

  function handler() {
    if (viewport.scrollLeft !== anchorLeft) viewport.scrollLeft = anchorLeft;
    if (viewport.scrollTop !== anchorTop) viewport.scrollTop = anchorTop;
  }

  viewport.addEventListener("scroll", handler, { passive: true });

  return function release() {
    viewport.removeEventListener("scroll", handler);
  };
}
