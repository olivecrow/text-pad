import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { emit, emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export type DesktopUnlisten = () => void;

export interface DesktopEvent<T> {
  payload: T;
}

export interface DesktopCloseRequestedEvent {
  preventDefault(): void;
}

export type DesktopDragDropPayload =
  | { type: 'drop'; paths: string[]; position?: { x: number; y: number } }
  | { type: 'over'; paths: string[]; position?: { x: number; y: number } }
  | { type: 'cancel' };

export interface DesktopWindowPosition {
  x: number;
  y: number;
}

export interface DesktopWindowSize {
  width: number;
  height: number;
}

export interface DesktopWindowOptions {
  url: string;
  title: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  visible?: boolean;
  decorations?: boolean;
  shadow?: boolean;
  resizable?: boolean;
}

export interface DesktopWindowHandle {
  readonly label: string;
  close(): Promise<void>;
  destroy(): Promise<void>;
  hide(): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
  setTitle(title: string): Promise<void>;
  startDragging(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  outerPosition(): Promise<DesktopWindowPosition>;
  outerSize(): Promise<DesktopWindowSize>;
  setPosition(position: DesktopWindowPosition): Promise<void>;
  listen<T>(eventName: string, listener: (event: DesktopEvent<T>) => void): Promise<DesktopUnlisten>;
  once<T>(eventName: string, listener: (event: DesktopEvent<T>) => void): Promise<DesktopUnlisten>;
  onCloseRequested(
    listener: (event: DesktopCloseRequestedEvent) => void | Promise<void>
  ): Promise<DesktopUnlisten>;
  onDragDropEvent(listener: (event: DesktopEvent<DesktopDragDropPayload>) => void): Promise<DesktopUnlisten>;
  onResized(listener: () => void): Promise<DesktopUnlisten>;
}

type TauriWindowHandle = ReturnType<typeof getCurrentWindow> | WebviewWindow;

class TauriDesktopWindowHandle implements DesktopWindowHandle {
  constructor(private readonly windowHandle: TauriWindowHandle) {}

  get label(): string {
    return this.windowHandle.label;
  }

  close(): Promise<void> {
    return this.windowHandle.close();
  }

  destroy(): Promise<void> {
    return this.windowHandle.destroy();
  }

  hide(): Promise<void> {
    return this.windowHandle.hide();
  }

  show(): Promise<void> {
    return this.windowHandle.show();
  }

  setFocus(): Promise<void> {
    return this.windowHandle.setFocus();
  }

  setTitle(title: string): Promise<void> {
    return this.windowHandle.setTitle(title);
  }

  startDragging(): Promise<void> {
    return this.windowHandle.startDragging();
  }

  minimize(): Promise<void> {
    return this.windowHandle.minimize();
  }

  toggleMaximize(): Promise<void> {
    return this.windowHandle.toggleMaximize();
  }

  isMaximized(): Promise<boolean> {
    return this.windowHandle.isMaximized();
  }

  async outerPosition(): Promise<DesktopWindowPosition> {
    const position = await this.windowHandle.outerPosition();
    return { x: position.x, y: position.y };
  }

  async outerSize(): Promise<DesktopWindowSize> {
    const size = await this.windowHandle.outerSize();
    return { width: size.width, height: size.height };
  }

  setPosition(position: DesktopWindowPosition): Promise<void> {
    return this.windowHandle.setPosition(new PhysicalPosition(position.x, position.y));
  }

  listen<T>(
    eventName: string,
    listener: (event: DesktopEvent<T>) => void
  ): Promise<DesktopUnlisten> {
    return this.windowHandle.listen<T>(eventName, (event) => listener({ payload: event.payload }));
  }

  once<T>(
    eventName: string,
    listener: (event: DesktopEvent<T>) => void
  ): Promise<DesktopUnlisten> {
    return this.windowHandle.once<T>(eventName, (event) => listener({ payload: event.payload }));
  }

  onCloseRequested(
    listener: (event: DesktopCloseRequestedEvent) => void | Promise<void>
  ): Promise<DesktopUnlisten> {
    return this.windowHandle.onCloseRequested(listener);
  }

  onDragDropEvent(
    listener: (event: DesktopEvent<DesktopDragDropPayload>) => void
  ): Promise<DesktopUnlisten> {
    return this.windowHandle.onDragDropEvent((event) => {
      listener({ payload: event.payload as DesktopDragDropPayload });
    });
  }

  onResized(listener: () => void): Promise<DesktopUnlisten> {
    return this.windowHandle.onResized(listener);
  }
}

function isDesktopRuntimeAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return '__TAURI_INTERNALS__' in runtimeWindow || '__TAURI__' in runtimeWindow;
}

export const desktopWindows = {
  isAvailable(): boolean {
    return isDesktopRuntimeAvailable();
  },

  current(): DesktopWindowHandle {
    return new TauriDesktopWindowHandle(getCurrentWindow());
  },

  currentLabel(fallback = 'browser'): string {
    if (!isDesktopRuntimeAvailable()) return fallback;
    try {
      return getCurrentWindow().label;
    } catch {
      return fallback;
    }
  },

  async getAll(): Promise<DesktopWindowHandle[]> {
    return (await WebviewWindow.getAll()).map((windowHandle) => (
      new TauriDesktopWindowHandle(windowHandle)
    ));
  },

  async getByLabel(label: string): Promise<DesktopWindowHandle | null> {
    const windowHandle = await WebviewWindow.getByLabel(label);
    return windowHandle ? new TauriDesktopWindowHandle(windowHandle) : null;
  },

  create(label: string, options: DesktopWindowOptions): DesktopWindowHandle {
    return new TauriDesktopWindowHandle(new WebviewWindow(label, options));
  },

  emit<T>(eventName: string, payload: T): Promise<void> {
    return emit(eventName, payload);
  },

  emitTo<T>(targetWindowLabel: string, eventName: string, payload: T): Promise<void> {
    return emitTo(targetWindowLabel, eventName, payload);
  }
};
