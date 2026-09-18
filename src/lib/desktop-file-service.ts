import { invoke } from '@tauri-apps/api/core';
import type { TextEncoding } from './editor-session';

export interface DesktopFileDialogFilter {
  name: string;
  extensions: readonly string[];
}

export interface OpenedTextFile {
  path: string;
  content: string;
  encoding: TextEncoding;
}

export interface SavedTextFile {
  path: string;
  encoding: TextEncoding;
}

export interface SaveTextFileOptions {
  defaultName: string;
  content: string;
  encoding: TextEncoding | null;
  filters: readonly DesktopFileDialogFilter[];
}

export interface WriteTextFileOptions {
  path: string;
  content: string;
  encoding: TextEncoding;
}

export type DesktopInvoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

export interface DesktopFileService {
  readDocumentImage(documentPath: string, relativePath: string): Promise<{ mimeType: string; bytes: number[] }>;
  getStartupFiles(): Promise<OpenedTextFile[]>;
  openFileDialog(filters: readonly DesktopFileDialogFilter[]): Promise<OpenedTextFile | null>;
  openFilePaths(paths: readonly string[]): Promise<OpenedTextFile[]>;
  saveFileDialog(options: SaveTextFileOptions): Promise<SavedTextFile | null>;
  setupEditorWindowWheel(): Promise<void>;
  takePendingOpenFiles(): Promise<OpenedTextFile[]>;
  writeFileContent(options: WriteTextFileOptions): Promise<void>;
}

export const desktopFileCommands = {
  readDocumentImage: 'read_document_image',
  getStartupFiles: 'get_startup_files',
  openFileDialog: 'open_file_dialog',
  openFilePaths: 'open_file_paths',
  saveFileDialog: 'save_file_dialog',
  setupEditorWindowWheel: 'setup_editor_window_wheel',
  takePendingOpenFiles: 'take_pending_open_files',
  writeFileContent: 'write_file_content'
} as const;

export function createDesktopFileService(invokeCommand: DesktopInvoke): DesktopFileService {
  return {
    readDocumentImage(documentPath, relativePath) {
      return invokeCommand(desktopFileCommands.readDocumentImage, { documentPath, relativePath });
    },
    getStartupFiles(): Promise<OpenedTextFile[]> {
      return invokeCommand(desktopFileCommands.getStartupFiles);
    },

    openFileDialog(filters: readonly DesktopFileDialogFilter[]): Promise<OpenedTextFile | null> {
      return invokeCommand(desktopFileCommands.openFileDialog, { filters });
    },

    openFilePaths(paths: readonly string[]): Promise<OpenedTextFile[]> {
      return invokeCommand(desktopFileCommands.openFilePaths, { paths });
    },

    saveFileDialog(options: SaveTextFileOptions): Promise<SavedTextFile | null> {
      return invokeCommand(desktopFileCommands.saveFileDialog, { ...options });
    },

    setupEditorWindowWheel(): Promise<void> {
      return invokeCommand(desktopFileCommands.setupEditorWindowWheel);
    },

    takePendingOpenFiles(): Promise<OpenedTextFile[]> {
      return invokeCommand(desktopFileCommands.takePendingOpenFiles);
    },

    writeFileContent(options: WriteTextFileOptions): Promise<void> {
      return invokeCommand(desktopFileCommands.writeFileContent, { ...options });
    }
  };
}

export const desktopFiles = createDesktopFileService(invoke);
