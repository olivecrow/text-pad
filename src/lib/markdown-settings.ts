export const markdownHeadingLevels = [1, 2, 3, 4, 5, 6] as const;

export type MarkdownHeadingLevel = (typeof markdownHeadingLevels)[number];
export type MarkdownHeadingWeight = '400' | '500' | '600' | '700' | '800';

export interface MarkdownHeadingStyle {
  sizePercent: number;
  fontWeight: MarkdownHeadingWeight;
}

export interface MarkdownRenderSettings {
  hideHeadingMarkers: boolean;
  showHeadingDividers: boolean;
  headings: Record<MarkdownHeadingLevel, MarkdownHeadingStyle>;
}

const defaultHeadingStyles: Record<MarkdownHeadingLevel, MarkdownHeadingStyle> = {
  1: { sizePercent: 145, fontWeight: '700' },
  2: { sizePercent: 135, fontWeight: '700' },
  3: { sizePercent: 125, fontWeight: '600' },
  4: { sizePercent: 115, fontWeight: '600' },
  5: { sizePercent: 108, fontWeight: '600' },
  6: { sizePercent: 100, fontWeight: '600' }
};

export function createDefaultMarkdownRenderSettings(): MarkdownRenderSettings {
  return {
    hideHeadingMarkers: true,
    showHeadingDividers: true,
    headings: Object.fromEntries(
      markdownHeadingLevels.map((level) => [level, { ...defaultHeadingStyles[level] }])
    ) as Record<MarkdownHeadingLevel, MarkdownHeadingStyle>
  };
}

function normalizeHeadingSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(80, Math.min(145, Math.round(value)))
    : fallback;
}

function normalizeHeadingWeight(value: unknown, fallback: MarkdownHeadingWeight): MarkdownHeadingWeight {
  return value === '400' || value === '500' || value === '600' || value === '700' || value === '800'
    ? value
    : fallback;
}

export function normalizeMarkdownRenderSettings(input: unknown): MarkdownRenderSettings {
  const defaults = createDefaultMarkdownRenderSettings();
  if (!input || typeof input !== 'object') return defaults;

  const candidate = input as Partial<MarkdownRenderSettings> & {
    headings?: Partial<Record<MarkdownHeadingLevel, Partial<MarkdownHeadingStyle>>>;
  };
  const normalized = createDefaultMarkdownRenderSettings();
  normalized.hideHeadingMarkers = typeof candidate.hideHeadingMarkers === 'boolean'
    ? candidate.hideHeadingMarkers
    : defaults.hideHeadingMarkers;
  normalized.showHeadingDividers = typeof candidate.showHeadingDividers === 'boolean'
    ? candidate.showHeadingDividers
    : defaults.showHeadingDividers;

  for (const level of markdownHeadingLevels) {
    const current = candidate.headings?.[level];
    normalized.headings[level] = {
      sizePercent: normalizeHeadingSize(current?.sizePercent, defaults.headings[level].sizePercent),
      fontWeight: normalizeHeadingWeight(current?.fontWeight, defaults.headings[level].fontWeight)
    };
  }

  return normalized;
}
