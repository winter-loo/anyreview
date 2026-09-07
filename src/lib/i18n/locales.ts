export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function normalizeLocale(input: string | null | undefined): Locale {
	if (!input) return DEFAULT_LOCALE;
	const first = input.split(',')[0]?.trim();
	if (!first) return DEFAULT_LOCALE;
	const lower = first.toLowerCase();
	if (lower === 'zh' || lower === 'zh-cn' || lower.startsWith('zh-')) return 'zh-CN';
	if (lower === 'en' || lower.startsWith('en-')) return 'en';
	return DEFAULT_LOCALE;
}
