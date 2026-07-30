import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(projectRoot, 'static', 'THIRD_PARTY_NOTICES.txt');
const licenseNamePattern = /^(licen[cs]e|copying|copyright|notice)([-_.].*)?$/i;
const bundledFrontendDevPackages = new Set(['svelte']);
const licenseTextIds = new Map();
const licenseTexts = [];

function normalizeLicenseText(text) {
  return text.replace(/[ \t]+$/gm, '').trim();
}

function normalizeRepository(value) {
  const repository = typeof value === 'string' ? value : value?.url;
  if (!repository) return '';
  return repository
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git$/, '');
}

function collectLicenseFiles(packageDirectory) {
  if (!existsSync(packageDirectory)) return [];
  return readdirSync(packageDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && licenseNamePattern.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      text: normalizeLicenseText(readFileSync(join(packageDirectory, entry.name), 'utf8'))
    }))
    .filter((entry) => entry.text.length > 0);
}

function collectNpmPackages() {
  const lock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));
  const packages = [];

  for (const [lockPath, metadata] of Object.entries(lock.packages ?? {})) {
    if (!lockPath.startsWith('node_modules/') || !metadata?.version) continue;
    const packageName = lockPath.slice('node_modules/'.length);
    if (metadata.dev === true && !bundledFrontendDevPackages.has(packageName)) continue;

    const packageDirectory = join(projectRoot, ...lockPath.split('/'));
    const packageJsonPath = join(packageDirectory, 'package.json');
    if (!existsSync(packageJsonPath)) continue;

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    packages.push({
      ecosystem: 'npm',
      name: packageJson.name ?? packageName,
      version: packageJson.version ?? metadata.version,
      license: packageJson.license ?? metadata.license ?? 'UNKNOWN',
      source: normalizeRepository(packageJson.repository) || packageJson.homepage || metadata.resolved || '',
      licenseFiles: collectLicenseFiles(packageDirectory)
    });
  }

  return packages;
}

function collectCargoPackages() {
  const metadata = JSON.parse(execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--locked', '--filter-platform', 'x86_64-pc-windows-msvc'],
    {
      cwd: join(projectRoot, 'src-tauri'),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    }
  ));
  const workspacePackageIds = new Set(metadata.workspace_members ?? []);
  const nodesById = new Map((metadata.resolve?.nodes ?? []).map((node) => [node.id, node]));
  const runtimePackageIds = new Set();
  const pendingIds = [...workspacePackageIds];

  while (pendingIds.length > 0) {
    const packageId = pendingIds.pop();
    const node = nodesById.get(packageId);
    if (!node) continue;

    for (const dependency of node.deps ?? []) {
      const isRuntimeDependency = dependency.dep_kinds?.some((kind) => kind.kind === null) ?? true;
      if (!isRuntimeDependency || runtimePackageIds.has(dependency.pkg)) continue;
      runtimePackageIds.add(dependency.pkg);
      pendingIds.push(dependency.pkg);
    }
  }

  return metadata.packages
    .filter((pkg) => runtimePackageIds.has(pkg.id) && !workspacePackageIds.has(pkg.id))
    .map((pkg) => {
      const packageDirectory = dirname(pkg.manifest_path);
      const licenseFiles = collectLicenseFiles(packageDirectory);
      if (pkg.license_file) {
        const declaredLicensePath = resolve(packageDirectory, pkg.license_file);
        const declaredLicenseName = relative(packageDirectory, declaredLicensePath);
        if (existsSync(declaredLicensePath) && !licenseFiles.some((entry) => entry.name === declaredLicenseName)) {
          licenseFiles.push({
            name: declaredLicenseName,
            text: normalizeLicenseText(readFileSync(declaredLicensePath, 'utf8'))
          });
        }
      }

      return {
        ecosystem: 'Cargo',
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? (pkg.license_file ? 'SEE LICENSE FILE' : 'UNKNOWN'),
        source: pkg.repository ?? pkg.homepage ?? pkg.source ?? '',
        licenseFiles
      };
    });
}

function renderPackage(pkg) {
  const lines = [
    `${pkg.name} ${pkg.version} (${pkg.ecosystem})`,
    `License: ${pkg.license}`,
    `Source: ${pkg.source || 'not declared'}`
  ];

  if (pkg.licenseFiles.length === 0) {
    lines.push('License text: no package-local license file was found; consult the source above.');
    return lines.join('\n');
  }

  for (const file of pkg.licenseFiles) {
    let licenseTextId = licenseTextIds.get(file.text);
    if (licenseTextId === undefined) {
      licenseTextId = licenseTexts.length + 1;
      licenseTextIds.set(file.text, licenseTextId);
      licenseTexts.push(file.text);
    }
    lines.push(`License text ${licenseTextId}: ${file.name}`);
  }
  return lines.join('\n');
}

const packages = [...collectNpmPackages(), ...collectCargoPackages()]
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
const missingLicenseTexts = packages.filter((pkg) => pkg.licenseFiles.length === 0);
const header = [
  'text-pad Third-Party Notices',
  '',
  'This file lists the open-source packages included in the Windows application and includes',
  'the package-local license and notice texts that were available at build time.',
  'The corresponding package license governs each component.',
  '',
  `Generated package count: ${packages.length}`,
  `Packages without a package-local license file: ${missingLicenseTexts.length}`,
  '',
  '='.repeat(80),
  ''
].join('\n');
const renderedPackages = packages.map(renderPackage);
const licenseTextAppendix = licenseTexts
  .map((text, index) => [
    `LICENSE TEXT ${index + 1}`,
    '-'.repeat(80),
    text
  ].join('\n'))
  .join(`\n\n${'='.repeat(80)}\n\n`);
const notice = `${header}${renderedPackages.join(`\n\n${'='.repeat(80)}\n\n`)}\n\n${'='.repeat(80)}\n\nLICENSE TEXTS\n\n${licenseTextAppendix}\n`;

writeFileSync(outputPath, notice, 'utf8');
console.log(`Wrote ${relative(projectRoot, outputPath)} with ${packages.length} package notices.`);
if (missingLicenseTexts.length > 0) {
  console.log(`No package-local license file: ${missingLicenseTexts.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`);
}
