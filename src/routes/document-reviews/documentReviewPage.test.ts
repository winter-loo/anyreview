import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageSource = readFileSync(resolve('src/routes/document-reviews/[id]/+page.svelte'), 'utf8');
const serverSource = readFileSync(resolve('src/routes/document-reviews/[id]/+page.server.ts'), 'utf8');

describe('document review page markup', () => {
	it('routes image documents to the region annotation viewer', () => {
		expect(pageSource).toContain("import ImageRegionReview from '$lib/components/review/ImageRegionReview.svelte'");
		expect(pageSource).toMatch(/\{#if data.document.format === 'image'\}[\s\S]*<ImageRegionReview[\s\S]*reviewId=\{data.review.id\}[\s\S]*documentPath=\{markdownPath\}[\s\S]*\{comments\}[\s\S]*\{:else\}\s*<main/);
	});

	it('captures rendered Markdown selections and offers direct or batched submission', () => {
		expect(pageSource).toContain('class="annotation-toggle"');
		expect(pageSource).toContain('onpointerup={captureSelection}');
		expect(pageSource).toContain('data-block-id={block.id}');
		expect(pageSource).toContain('name="selectedText" value={selectionDraft.selectedText}');
		expect(pageSource).toContain('name="prefix" value={selectionDraft.prefix}');
		expect(pageSource).toContain('name="suffix" value={selectionDraft.suffix}');
		expect(pageSource).toContain('name="delivery" value="send"');
		expect(pageSource).toContain('name="delivery" value="save"');
		expect(pageSource).toContain('trigger-comments');
		expect(pageSource).toContain("registry.set('reviewloop-annotations'");
	});

	it('renders a left sidebar section-title navigation from markdown headings', () => {
		expect(pageSource).toContain('const sectionLinks = $derived(renderedBlocks.filter(hasHeading));');
		expect(pageSource).toContain('<aside class="section-navigation" aria-label="Document section navigation">');
		expect(pageSource).toContain("<h2>{t('document.sections')}</h2>");
		expect(pageSource).toContain('{#each sectionLinks as section (section.id)}');
		expect(pageSource).toContain('href={`#${section.id}`}');
		expect(pageSource).toContain('{section.headingText}');
		expect(pageSource).toContain('class:subsection={section.headingLevel > 2}');
		expect(pageSource).toContain('data-section-link={section.id}');
		expect(pageSource).toContain("document.querySelectorAll('[data-section-anchor]')");
		expect(pageSource).toContain("link.setAttribute('aria-current', 'location')");
		expect(pageSource).toContain('grid-template-columns: minmax(320px, 18vw) minmax(0, 1fr) 340px;');
		expect(pageSource).toContain('max-height: calc(100vh - 36px);');
		expect(pageSource).toContain('overflow-y: auto;');
	});

	it('uses the full viewport width with compact gutters', () => {
		expect(pageSource).not.toContain('max-width: 1440px;');
		expect(pageSource).not.toContain('margin: 0 auto;');
		expect(pageSource).toContain('width: 100%;');
		expect(pageSource).toContain('padding: 16px;');
		expect(pageSource).toContain('grid-template-columns: minmax(320px, 18vw) minmax(0, 1fr) 340px;');
		expect(pageSource).toContain('gap: 12px;');
	});

	it('collapses review controls into a compact touch-friendly mobile gutter', () => {
		expect(pageSource).toContain('<div class="review-gutter">');
		expect(pageSource).toContain('@media (max-width: 640px)');
		expect(pageSource).toContain('grid-template-columns: 48px minmax(0, 1fr);');
		expect(pageSource).toContain('width: min(360px, calc(100vw - 24px));');
		expect(pageSource).toMatch(/\.composer-actions button \{[\s\S]*min-height: 44px;/);
		expect(pageSource).toMatch(/\.md-content :global\(:not\(pre\) > code\) \{[\s\S]*overflow-wrap: anywhere;/);
	});

	it('supports opening and submitting comments without client-side hydration', () => {
		expect(serverSource).toContain("url.searchParams.get('commentLine')");
		expect(serverSource).toContain('export const actions: Actions');
		expect(serverSource).toContain('addComment: async');
		expect(serverSource).toContain('store.addComment');
		expect(serverSource).toContain('throw redirect(303');
		expect(serverSource).toContain('documentVersion !== latestVersion.version');
		expect(serverSource).toContain('block.text.slice(startOffset, endOffset) !== selectedText');
	});
});
