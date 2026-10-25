import { describe, expect, it } from 'vitest';
import { createTranslator } from './translate';
import { normalizeLocale } from './locales';

describe('i18n locale normalization', () => {
	it('normalizes Chinese language tags to zh-CN and defaults unsupported locales to English', () => {
		expect(normalizeLocale('zh')).toBe('zh-CN');
		expect(normalizeLocale('zh-CN')).toBe('zh-CN');
		expect(normalizeLocale('zh-Hans')).toBe('zh-CN');
		expect(normalizeLocale('en-US')).toBe('en');
		expect(normalizeLocale('fr-FR')).toBe('en');
	});
});

describe('createTranslator', () => {
	it('translates the live review home page to Simplified Chinese', () => {
		const t = createTranslator('zh-CN');

		expect(t('home.title')).toBe('生成链接，评审本地文件。');
	});

	it('translates the CLI prompt', () => {
		const zh = createTranslator('zh-CN');
		expect(zh('home.command')).toContain('review <文件>');
	});
});
