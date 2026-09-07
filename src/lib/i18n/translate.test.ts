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
	it('translates stable UI chrome to Simplified Chinese', () => {
		const t = createTranslator('zh-CN');

		expect(t('document.sections')).toBe('章节');
		expect(t('document.openComments')).toBe('未解决评论');
		expect(t('comment.save')).toBe('保存评论');
	});

	it('interpolates values and falls back to English for missing locale messages', () => {
		const zh = createTranslator('zh-CN');
		expect(zh('line.one', { line: 42 })).toBe('第 42 行');
		expect(zh('review.meta.lines', { count: 857 })).toBe('857 行');
	});
});
