import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const layoutServerSource = readFileSync(resolve('src/routes/+layout.server.ts'), 'utf8');
const hooksSource = readFileSync(resolve('src/hooks.server.ts'), 'utf8');
const homeSource = readFileSync(resolve('src/routes/+page.svelte'), 'utf8');
const reviewsSource = readFileSync(resolve('src/routes/reviews/+page.svelte'), 'utf8');
const documentReviewSource = readFileSync(resolve('src/routes/document-reviews/[id]/+page.svelte'), 'utf8');
const documentReviewServerSource = readFileSync(resolve('src/routes/document-reviews/[id]/+page.server.ts'), 'utf8');

describe('SvelteKit i18n wiring', () => {
	it('resolves locale server-side from query/cookie/accept-language and exposes it to page data', () => {
		expect(hooksSource).toContain("event.url.searchParams.get('lang')");
		expect(hooksSource).toContain("event.cookies.get('reviewloop_locale')");
		expect(hooksSource).toContain("event.request.headers.get('accept-language')");
		expect(hooksSource).toContain("reviewloop_locale");
		expect(hooksSource).toContain('transformPageChunk');
		expect(layoutServerSource).toContain('locals.locale');
	});

	it('uses typed translations instead of hard-coded English for primary pages', () => {
		expect(homeSource).toContain("t('home.title')");
		expect(reviewsSource).toContain("t('reviews.title')");
		expect(documentReviewSource).toContain("t('document.sections')");
		expect(documentReviewSource).toContain("t('document.openComments')");
		expect(documentReviewSource).toContain("t('comment.addToReview')");
		expect(documentReviewSource).toContain("t('comment.sendNow')");
		expect(documentReviewSource).not.toContain('<h2>Sections</h2>');
		expect(documentReviewSource).not.toContain('<h2>Open comments</h2>');
		expect(documentReviewSource).not.toContain('Save comment</button>');
	});

	it('returns translation keys for document-review form errors so locale changes affect error text', () => {
		expect(documentReviewServerSource).toContain('formErrorKey');
		expect(documentReviewServerSource).toContain("error.commentBodyRequired");
		expect(documentReviewSource).toContain('formErrorKey');
		expect(documentReviewSource).toContain('{t(formErrorKey)}');
	});
});
