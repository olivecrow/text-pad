import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { APP_VERSION_FALLBACK } from '$lib/app-metadata';

function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return '__TAURI_INTERNALS__' in runtimeWindow || '__TAURI__' in runtimeWindow;
}

export async function getInstalledAppVersion(): Promise<string> {
  if (!hasTauriRuntime()) return APP_VERSION_FALLBACK;

  try {
    return await getVersion();
  } catch {
    return APP_VERSION_FALLBACK;
  }
}

export async function checkForAppUpdate(): Promise<Update | null> {
  if (!hasTauriRuntime()) return null;
  return check({ timeout: 20_000 });
}

export async function closeAppUpdate(update: Update): Promise<void> {
  try {
    await update.close();
  } catch {
    // The native resource can already be closed after installation or an updater failure.
  }
}

export async function installAppUpdate(
  update: Update,
  onEvent?: (event: DownloadEvent) => void
): Promise<void> {
  await update.downloadAndInstall(onEvent, { timeout: 120_000 });
  await relaunch();
}

export type { DownloadEvent, Update };
