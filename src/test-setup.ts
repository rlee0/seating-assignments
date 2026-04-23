// Stub ResizeObserver for jsdom test environment
if (typeof ResizeObserver === "undefined") {
  (globalThis as Record<string, unknown>).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
