import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'supported-text-formats.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.version !== 1 || !Array.isArray(manifest.formats) || manifest.formats.length === 0) {
  throw new Error('supported-text-formats.json must contain a non-empty version 1 formats array.');
}

const ids = new Set();
const extensions = [];
const extensionOwners = new Map();

for (const format of manifest.formats) {
  if (!format || typeof format.id !== 'string' || !/^[a-z][a-z0-9]*$/.test(format.id)) {
    throw new Error(`Invalid format id: ${String(format?.id)}`);
  }
  if (ids.has(format.id)) throw new Error(`Duplicate format id: ${format.id}`);
  ids.add(format.id);

  if (!Array.isArray(format.extensions) || format.extensions.length === 0) {
    throw new Error(`Format ${format.id} must define at least one extension.`);
  }
  for (const extension of format.extensions) {
    if (typeof extension !== 'string' || !/^[a-z0-9][a-z0-9-]{0,15}$/.test(extension)) {
      throw new Error(`Invalid extension for ${format.id}: ${String(extension)}`);
    }
    if (extensionOwners.has(extension)) {
      throw new Error(`Extension ${extension} belongs to both ${extensionOwners.get(extension)} and ${format.id}.`);
    }
    extensionOwners.set(extension, format.id);
    extensions.push(extension);
  }

  if (typeof format.sample !== 'string' || !format.sample.startsWith('samples/')) {
    throw new Error(`Format ${format.id} must point to a file under samples/.`);
  }
  const samplePath = path.join(root, ...format.sample.split('/'));
  if (!fs.existsSync(samplePath) || !fs.statSync(samplePath).isFile()) {
    throw new Error(`Missing sample for ${format.id}: ${format.sample}`);
  }
  if (fs.statSync(samplePath).size === 0) {
    throw new Error(`Sample for ${format.id} is empty: ${format.sample}`);
  }
  const sampleExtension = path.extname(samplePath).slice(1).toLowerCase();
  if (!format.extensions.includes(sampleExtension)) {
    throw new Error(`Sample extension .${sampleExtension} is not registered for ${format.id}.`);
  }
}

const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const associatedExtensions = (tauriConfig.bundle?.fileAssociations || [])
  .flatMap((association) => association.ext || []);
if (JSON.stringify(associatedExtensions) !== JSON.stringify(extensions)) {
  throw new Error('Tauri file associations must exactly match supported-text-formats.json order and extensions.');
}

const frontendSource = fs.readFileSync(path.join(root, 'src', 'lib', 'document-formats.ts'), 'utf8');
const backendSource = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'file_commands.rs'), 'utf8');
if (!frontendSource.includes("from '../../supported-text-formats.json'")) {
  throw new Error('The frontend format registry must import supported-text-formats.json.');
}
if (!backendSource.includes('include_str!("../../supported-text-formats.json")')) {
  throw new Error('The backend file dialogs must embed supported-text-formats.json.');
}

console.log(`Validated ${manifest.formats.length} text formats, ${extensions.length} extensions, samples, and installer associations.`);
