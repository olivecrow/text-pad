export interface FileTabReference {
  id: string;
  filePath: string | null;
}

export function normalizeFilePathForComparison(filePath: string): string {
  let normalized = filePath.replaceAll('/', '\\');

  if (/^\\\\\?\\UNC\\/i.test(normalized)) {
    normalized = `\\\\${normalized.slice(8)}`;
  } else if (/^\\\\\?\\/i.test(normalized)) {
    normalized = normalized.slice(4);
  }

  return normalized.toLowerCase();
}

export function findOpenFileTab<T extends FileTabReference>(
  tabs: readonly T[],
  filePath: string
): T | null {
  const targetPath = normalizeFilePathForComparison(filePath);
  return tabs.find((tab) => (
    tab.filePath !== null
    && normalizeFilePathForComparison(tab.filePath) === targetPath
  )) ?? null;
}
