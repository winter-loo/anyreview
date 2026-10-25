import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const layoutServerSource = readFileSync(resolve('src/routes/+layout.server.ts'), 'utf8');
const hooksSource = readFileSync(resolve('src/hooks.server.ts'), 'utf8');
const homeSource = readFileSync(resolve('src/routes/+page.svelte'), 'utf8');

describe('SvelteKit i18n wiring', () => {
	it('resolves locale server-side from query/cookie/accept-language and exposes it to page data', () => {
		expect(hooksSource).toContain("event.url.searchParams.get('lang')");
		expect(hooksSource).toContain("event.cookies.get('anyreview_locale')");
		expect(hooksSource).toContain("event.request.headers.get('accept-language')");
		expect(hooksSource).toContain("anyreview_locale");
		expect(hooksSource).toContain('transformPageChunk');
		expect(layoutServerSource).toContain('locals.locale');
	});

	it('uses typed translations instead of hard-coded English for primary pages', () => {
		expect(homeSource).toContain("t('home.title')");
		expect(homeSource).toContain("t('home.command')");
	});
});
