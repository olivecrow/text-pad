import { arabicTranslations } from './ar';
import { germanTranslations } from './de';
import { englishTranslations, type TranslationKey, type TranslationValues } from './en';
import { spanishTranslations } from './es';
import { frenchTranslations } from './fr';
import { japaneseTranslations } from './ja';
import { koreanTranslations } from './ko';
import { brazilianPortugueseTranslations } from './pt-BR';
import { russianTranslations } from './ru';
import { simplifiedChineseTranslations } from './zh-CN';

export const supportedLanguages = [
  { code: 'en', nativeName: 'English' },
  { code: 'ko', nativeName: '한국어' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'zh-CN', nativeName: '简体中文' },
  { code: 'es', nativeName: 'Español' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)' },
  { code: 'ru', nativeName: 'Русский' },
  { code: 'ar', nativeName: 'العربية' }
] as const;

export type AppLocale = (typeof supportedLanguages)[number]['code'];
export type LanguagePreference = 'system' | AppLocale;

const translations: Record<AppLocale, Record<TranslationKey, string>> = {
  en: englishTranslations,
  ko: koreanTranslations,
  ja: japaneseTranslations,
  'zh-CN': simplifiedChineseTranslations,
  es: spanishTranslations,
  fr: frenchTranslations,
  de: germanTranslations,
  'pt-BR': brazilianPortugueseTranslations,
  ru: russianTranslations,
  ar: arabicTranslations
};

const localeAliases: Record<string, AppLocale> = {
  en: 'en',
  ko: 'ko',
  ja: 'ja',
  zh: 'zh-CN',
  es: 'es',
  fr: 'fr',
  de: 'de',
  pt: 'pt-BR',
  ru: 'ru',
  ar: 'ar'
};

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return supportedLanguages.some((language) => language.code === value);
}

export function resolveSupportedLocale(value: string | null | undefined): AppLocale | null {
  if (!value) return null;

  const normalized = value.replaceAll('_', '-').toLowerCase();
  const exact = supportedLanguages.find((language) => language.code.toLowerCase() === normalized);
  if (exact) return exact.code;

  const baseLanguage = normalized.split('-')[0];
  return localeAliases[baseLanguage] ?? null;
}

export function resolveSystemLocale(languageTags: readonly string[] = []): AppLocale {
  for (const languageTag of languageTags) {
    const locale = resolveSupportedLocale(languageTag);
    if (locale) return locale;
  }
  return 'en';
}

export function getLanguageNativeName(locale: AppLocale): string {
  return supportedLanguages.find((language) => language.code === locale)?.nativeName ?? 'English';
}

export function isRtlLocale(locale: AppLocale): boolean {
  return locale === 'ar';
}

export function translate(
  locale: AppLocale,
  key: TranslationKey,
  values: TranslationValues = {}
): string {
  const template = translations[locale]?.[key] ?? englishTranslations[key];
  return template.replace(/\{([^}]+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}

export type { TranslationKey, TranslationValues };
