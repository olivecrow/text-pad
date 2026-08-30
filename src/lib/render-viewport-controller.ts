export interface RenderViewportScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
}

export interface RenderViewportControllerOptions {
  scheduler: RenderViewportScheduler;
  resizeDebounceMs: number;
  caretRevealSettleDelayMs: number;
  isWrapSettlingEnabled: () => boolean;
  onViewportWidthChange: (width: number) => void;
  onViewportHeightChange: (height: number) => void;
  onWrapSettlingChange: (isSettling: boolean) => void;
  onCaretSync: (revealCaret: boolean) => void;
}

export function createBrowserRenderViewportScheduler(): RenderViewportScheduler {
  return {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle)
  };
}

export class RenderViewportController {
  private readonly scheduler: RenderViewportScheduler;
  private readonly resizeDebounceMs: number;
  private readonly caretRevealSettleDelayMs: number;
  private readonly isWrapSettlingEnabled: () => boolean;
  private readonly onViewportWidthChange: (width: number) => void;
  private readonly onViewportHeightChange: (height: number) => void;
  private readonly onWrapSettlingChange: (isSettling: boolean) => void;
  private readonly onCaretSync: (revealCaret: boolean) => void;

  private isDisposed = false;
  private isViewportConnected = false;
  private hasObservedViewportResize = false;
  private pendingViewportWidth = 0;
  private viewportResizeTimer: number | null = null;
  private wrapSettleGeneration = 0;
  private wrapSettleFirstFrame: number | null = null;
  private wrapSettleSecondFrame: number | null = null;
  private isWrapSettling = false;

  private caretRevealGeneration = 0;
  private pendingCaretRevealGeneration: number | null = null;
  private caretRevealSettleTimer: number | null = null;

  constructor(options: RenderViewportControllerOptions) {
    this.scheduler = options.scheduler;
    this.resizeDebounceMs = options.resizeDebounceMs;
    this.caretRevealSettleDelayMs = options.caretRevealSettleDelayMs;
    this.isWrapSettlingEnabled = options.isWrapSettlingEnabled;
    this.onViewportWidthChange = options.onViewportWidthChange;
    this.onViewportHeightChange = options.onViewportHeightChange;
    this.onWrapSettlingChange = options.onWrapSettlingChange;
    this.onCaretSync = options.onCaretSync;
  }

  connectViewport(width: number, height: number): void {
    if (this.isDisposed) return;

    this.disconnectViewport();
    this.isViewportConnected = true;
    this.pendingViewportWidth = width;
    this.onViewportWidthChange(width);
    this.onViewportHeightChange(height);
  }

  observeViewportSize(width: number, height: number): void {
    if (this.isDisposed || !this.isViewportConnected) return;

    const widthChanged = Math.abs(width - this.pendingViewportWidth) > 0.5;
    this.pendingViewportWidth = width;
    this.onViewportHeightChange(height);

    if (this.hasObservedViewportResize && widthChanged) {
      this.invalidateWrapSettleFrames();
      if (this.isWrapSettlingEnabled()) {
        this.setWrapSettling(true);
      }
    }

    if (this.viewportResizeTimer !== null) {
      this.scheduler.clearTimeout(this.viewportResizeTimer);
    }
    this.viewportResizeTimer = this.scheduler.setTimeout(
      () => this.flushViewportWidth(),
      this.resizeDebounceMs
    );
    this.hasObservedViewportResize = true;
  }

  disconnectViewport(): void {
    this.isViewportConnected = false;
    this.hasObservedViewportResize = false;

    if (this.viewportResizeTimer !== null) {
      this.scheduler.clearTimeout(this.viewportResizeTimer);
      this.viewportResizeTimer = null;
    }

    this.invalidateWrapSettleFrames();
    this.setWrapSettling(false);
  }

  requestCaretReveal(): void {
    if (this.isDisposed) return;

    const generation = this.caretRevealGeneration + 1;
    this.caretRevealGeneration = generation;
    this.pendingCaretRevealGeneration = generation;
    this.onCaretSync(true);
    this.scheduleCaretRevealCompletion(generation);
  }

  syncCaretAfterLayout(): void {
    if (this.isDisposed) return;

    const generation = this.pendingCaretRevealGeneration;
    if (generation === null) {
      this.onCaretSync(false);
      return;
    }

    this.onCaretSync(true);
    this.scheduleCaretRevealCompletion(generation);
  }

  cancelCaretReveal(): void {
    this.caretRevealGeneration += 1;
    this.pendingCaretRevealGeneration = null;
    if (this.caretRevealSettleTimer !== null) {
      this.scheduler.clearTimeout(this.caretRevealSettleTimer);
      this.caretRevealSettleTimer = null;
    }
  }

  dispose(): void {
    if (this.isDisposed) return;

    this.cancelCaretReveal();
    this.disconnectViewport();
    this.isDisposed = true;
  }

  private flushViewportWidth(): void {
    this.viewportResizeTimer = null;
    if (!this.isViewportConnected || this.isDisposed) return;

    this.onViewportWidthChange(this.pendingViewportWidth);
    this.finishWrapSettlingAfterPaint();
  }

  private finishWrapSettlingAfterPaint(): void {
    this.invalidateWrapSettleFrames();
    const generation = this.wrapSettleGeneration;

    this.wrapSettleFirstFrame = this.scheduler.requestAnimationFrame(() => {
      this.wrapSettleFirstFrame = null;
      if (generation !== this.wrapSettleGeneration || !this.isViewportConnected) return;

      this.wrapSettleSecondFrame = this.scheduler.requestAnimationFrame(() => {
        this.wrapSettleSecondFrame = null;
        if (
          generation === this.wrapSettleGeneration
          && this.isViewportConnected
          && !this.isDisposed
        ) {
          this.setWrapSettling(false);
        }
      });
    });
  }

  private invalidateWrapSettleFrames(): void {
    this.wrapSettleGeneration += 1;
    if (this.wrapSettleFirstFrame !== null) {
      this.scheduler.cancelAnimationFrame(this.wrapSettleFirstFrame);
      this.wrapSettleFirstFrame = null;
    }
    if (this.wrapSettleSecondFrame !== null) {
      this.scheduler.cancelAnimationFrame(this.wrapSettleSecondFrame);
      this.wrapSettleSecondFrame = null;
    }
  }

  private setWrapSettling(isSettling: boolean): void {
    if (this.isWrapSettling === isSettling) return;

    this.isWrapSettling = isSettling;
    this.onWrapSettlingChange(isSettling);
  }

  private scheduleCaretRevealCompletion(generation: number): void {
    if (this.caretRevealSettleTimer !== null) {
      this.scheduler.clearTimeout(this.caretRevealSettleTimer);
    }

    this.caretRevealSettleTimer = this.scheduler.setTimeout(() => {
      if (generation !== this.pendingCaretRevealGeneration || this.isDisposed) return;

      this.onCaretSync(true);
      this.pendingCaretRevealGeneration = null;
      this.caretRevealSettleTimer = null;
    }, this.caretRevealSettleDelayMs);
  }
}
