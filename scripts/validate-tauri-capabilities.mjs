import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function assertExactSet(actual, expected, label) {
  if (!Array.isArray(actual)) {
    throw new Error(`${label} must be an array.`);
  }

  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((entry) => !actualSet.has(entry));
  const unexpected = actual.filter((entry) => !expectedSet.has(entry));
  if (actualSet.size !== actual.length || missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} does not match its least-privilege contract. Missing: ${missing.join(', ') || 'none'}. `
      + `Unexpected: ${unexpected.join(', ') || 'none'}.`
    );
  }
}

function commandPermission(command) {
  return `allow-${command.replaceAll('_', '-')}`;
}

const mainCapability = readJson(path.join('src-tauri', 'capabilities', 'default.json'));
const settingsCapability = readJson(path.join('src-tauri', 'capabilities', 'settings.json'));
const tauriBuildSource = fs.readFileSync(path.join(root, 'src-tauri', 'build.rs'), 'utf8');
const frontendSource = fs.readFileSync(path.join(root, 'src', 'routes', '+page.svelte'), 'utf8');
const desktopFileServiceSource = fs.readFileSync(
  path.join(root, 'src', 'lib', 'desktop-file-service.ts'),
  'utf8'
);

const generatedCommands = [...tauriBuildSource.matchAll(/^\s*"([a-z_]+)",?$/gm)]
  .map((match) => match[1]);
const expectedGeneratedCommands = [
  'get_startup_files',
  'open_file_dialog',
  'open_file_paths',
  'save_file_dialog',
  'write_file_content',
  'setup_editor_window_wheel',
  'take_pending_open_files'
];
assertExactSet(generatedCommands, expectedGeneratedCommands, 'Tauri app command manifest');

const desktopFileCommandBlockStart = desktopFileServiceSource.indexOf('export const desktopFileCommands');
const desktopFileCommandBlockEnd = desktopFileServiceSource.indexOf('} as const;', desktopFileCommandBlockStart);
if (desktopFileCommandBlockStart < 0 || desktopFileCommandBlockEnd < 0) {
  throw new Error('The desktop file command adapter contract could not be located.');
}
const desktopFileCommands = [
  ...desktopFileServiceSource
    .slice(desktopFileCommandBlockStart, desktopFileCommandBlockEnd)
    .matchAll(/^\s+[a-zA-Z]+:\s*'([a-z_]+)',?$/gm)
].map((match) => match[1]);
assertExactSet(desktopFileCommands, expectedGeneratedCommands, 'Desktop file adapter commands');

if (/\binvoke\s*\(/.test(frontendSource)) {
  throw new Error('The page must use the desktop file adapter instead of invoking Tauri commands directly.');
}

assertExactSet(mainCapability.windows, ['main', 'editor-*'], 'Editor capability windows');
assertExactSet(
  mainCapability.permissions?.filter((permission) => permission.startsWith('allow-')),
  expectedGeneratedCommands.map(commandPermission),
  'Editor app command permissions'
);

const expectedSettingsPermissions = [
  'core:event:default',
  'core:window:default',
  'core:window:allow-hide',
  commandPermission('open_file_dialog'),
  commandPermission('save_file_dialog')
];
assertExactSet(settingsCapability.windows, ['settings'], 'Settings capability windows');
assertExactSet(
  settingsCapability.permissions,
  expectedSettingsPermissions,
  'Settings capability permissions'
);

const settingsTransferStart = frontendSource.indexOf('async function handleExportSettings()');
const settingsTransferEnd = frontendSource.indexOf('function normalizeHexColor', settingsTransferStart);
if (settingsTransferStart < 0 || settingsTransferEnd < 0) {
  throw new Error('The settings transfer handlers could not be located.');
}
const settingsTransferSource = frontendSource.slice(settingsTransferStart, settingsTransferEnd);
const settingsTransferAdapterCalls = [
  ...settingsTransferSource.matchAll(/\bdesktopFiles\.([a-zA-Z]+)\s*\(/g)
].map((match) => match[1]);
assertExactSet(
  settingsTransferAdapterCalls,
  ['openFileDialog', 'saveFileDialog'],
  'Settings window desktop file adapter calls'
);

console.log(
  `Validated Tauri capability boundaries for editor and settings windows (${generatedCommands.length} app commands).`
);
