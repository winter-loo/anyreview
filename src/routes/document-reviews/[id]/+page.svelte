<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ImageRegionReview from '$lib/components/review/ImageRegionReview.svelte';
	import ReviewHero from '$lib/components/review/ReviewHero.svelte';
	import { createTranslator, type MessageKey } from '$lib/i18n/translate';
	import type { Locale } from '$lib/i18n/locales';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form } = $props();

	type ReviewComment = {
		id: string;
		reviewId: string;
		version: number;
		filePath: string | null;
		side: 'old' | 'new' | 'file';
		lineStart: number | null;
		lineEnd: number | null;
		textSelection: {
			blockId: string;
			startOffset: number;
			endOffset: number;
			selectedText: string;
			prefix: string;
			suffix: string;
		} | null;
		pageRegion: { page: number; x: number; y: number; width: number; height: number } | null;
		sentAt: string | null;
		body: string;
		author: string;
		status: 'open' | 'resolved';
		createdAt: string;
		updatedAt: string;
	};

	type RenderedMarkdownBlock = {
		id: string;
		lineStart: number;
		lineEnd: number;
		html: string;
		text: string;
		headingLevel: number | null;
		headingText: string | null;
	};

	type SelectionDraft = NonNullable<ReviewComment['textSelection']> & {
		lineStart: number;
		lineEnd: number;
		left: number;
		top: number;
	};

	type HighlightRegistry = {
		delete(name: string): void;
		set(name: string, highlight: unknown): void;
	};

	const markdownPath = $derived(data.document.path as string);
	const renderedBlocks = $derived((data.renderedBlocks as RenderedMarkdownBlock[]) ?? []);
	const lineCount = $derived((data.document.lineCount as number) ?? 0);
	const comments = $derived((data.comments as ReviewComment[]) ?? []);
	const activeLine = $derived(((form as { activeLine?: number | null } | null | undefined)?.activeLine) ?? ((data as typeof data & { activeLine?: number | null }).activeLine) ?? null);
	const formError = $derived(((form as { formError?: string | null } | null | undefined)?.formError) ?? null);
	const openComments = $derived(comments.filter((comment) => comment.status === 'open'));
	const savedAnnotations = $derived(openComments.filter((comment) => comment.textSelection && !comment.sentAt));
	const sectionLinks = $derived(renderedBlocks.filter(hasHeading));
	const formErrorKey = $derived(((form as { formErrorKey?: MessageKey | null } | null | undefined)?.formErrorKey) ?? null);
	const t = $derived(createTranslator((data as typeof data & { locale: Locale }).locale));
	let annotationMode = $state(false);
	let selectionDraft = $state<SelectionDraft | null>(null);
	let composerTextarea = $state<HTMLTextAreaElement | null>(null);
	let sending = $state(false);
	let notice = $state<string | null>(null);

	function hasHeading(block: RenderedMarkdownBlock): block is RenderedMarkdownBlock & { headingLevel: number; headingText: string } {
		return Boolean(block.headingText && block.headingLevel);
	}

	function lineRangeLabel(block: RenderedMarkdownBlock) {
		return block.lineStart === block.lineEnd ? String(block.lineStart) : `${block.lineStart}-${block.lineEnd}`;
	}

	function lineLabel(line: number | null) {
		return t('line.one', { line: line ?? '' });
	}

	function commentsForLine(line: number) {
		return openComments.filter((comment) => comment.filePath === markdownPath && comment.side === 'new' && comment.lineStart === line);
	}

	function formatCommentTime(timestamp: string) {
		return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
	}

	function contentElement(node: Node | null) {
		const element = node instanceof Element ? node : node?.parentElement;
		return element?.closest<HTMLElement>('.md-content') ?? null;
	}

	function offsetWithin(root: HTMLElement, container: Node, offset: number) {
		const range = document.createRange();
		range.selectNodeContents(root);
		range.setEnd(container, offset);
		return range.toString().length;
	}

	function rangeWithin(root: HTMLElement, startOffset: number, endOffset: number) {
		const range = document.createRange();
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let offset = 0;
		let start: [Text, number] | null = null;
		let end: [Text, number] | null = null;
		for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
			const next = offset + node.data.length;
			if (!start && startOffset >= offset && startOffset <= next) start = [node, startOffset - offset];
			if (endOffset >= offset && endOffset <= next) {
				end = [node, endOffset - offset];
				break;
			}
			offset = next;
		}
		if (!start || !end) return null;
		range.setStart(...start);
		range.setEnd(...end);
		return range;
	}

	function captureSelection() {
		if (!annotationMode) return;
		requestAnimationFrame(() => {
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
			const range = selection.getRangeAt(0);
			const startContent = contentElement(range.startContainer);
			const endContent = contentElement(range.endContainer);
			if (!startContent || startContent !== endContent) return;
			const blockId = startContent.dataset.blockId;
			const block = renderedBlocks.find((candidate) => candidate.id === blockId);
			if (!block) return;
			const startOffset = offsetWithin(startContent, range.startContainer, range.startOffset);
			const endOffset = offsetWithin(startContent, range.endContainer, range.endOffset);
			const text = startContent.textContent ?? '';
			const selectedText = text.slice(startOffset, endOffset);
			if (!selectedText.trim() || selectedText !== range.toString() || selectedText.length > 10_000) return;
			const rect = range.getBoundingClientRect();
			selectionDraft = {
				blockId: block.id,
				lineStart: block.lineStart,
				lineEnd: block.lineEnd,
				startOffset,
				endOffset,
				selectedText,
				prefix: text.slice(Math.max(0, startOffset - 64), startOffset),
				suffix: text.slice(endOffset, endOffset + 64),
				left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 372)),
				top: Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 280))
			};
			queueMicrotask(() => composerTextarea?.focus());
		});
	}

	function clearSelectionDraft() {
		selectionDraft = null;
		window.getSelection()?.removeAllRanges();
	}

	function renderHighlights() {
		if (!document.getElementById('reviewloop-highlight-style')) {
			const style = document.createElement('style');
			style.id = 'reviewloop-highlight-style';
			style.textContent = '::highlight(reviewloop-annotations) { background: #fde68a; color: inherit; }';
			document.head.append(style);
		}
		const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
		const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
		if (!registry || !HighlightClass) return;
		registry.delete('reviewloop-annotations');
		const ranges = openComments.flatMap((comment) => {
			const anchor = comment.textSelection;
			if (!anchor || comment.version !== data.latestVersion.version) return [];
			const root = document.querySelector<HTMLElement>(`.md-content[data-block-id="${CSS.escape(anchor.blockId)}"]`);
			if (!root || (root.textContent ?? '').slice(anchor.startOffset, anchor.endOffset) !== anchor.selectedText) return [];
			const range = rangeWithin(root, anchor.startOffset, anchor.endOffset);
			return range ? [range] : [];
		});
		if (ranges.length) registry.set('reviewloop-annotations', new HighlightClass(...ranges));
	}

	$effect(() => {
		openComments;
		queueMicrotask(renderHighlights);
	});

	async function sendOpenComments() {
		sending = true;
		notice = null;
		try {
			const response = await fetch(`/api/reviews/${data.review.id}/agent/trigger-comments`, { method: 'POST' });
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.message ?? payload.error ?? t('comment.sendError'));
			notice = payload.message;
			await invalidateAll();
		} catch (cause) {
			notice = cause instanceof Error ? cause.message : t('comment.sendError');
		} finally {
			sending = false;
		}
	}

	const enhanceAnnotation: SubmitFunction = ({ submitter }) => {
		const sendNow = submitter instanceof HTMLButtonElement && submitter.value === 'send';
		return async ({ result }) => {
			if (result.type === 'failure' || result.type === 'error') {
				notice = t('comment.saveError');
				return;
			}
			clearSelectionDraft();
			if (sendNow) {
				await sendOpenComments();
			} else {
				notice = t('comment.saved');
				await invalidateAll();
			}
		};
	};
</script>

<svelte:head>
	<title>{t('review.documentTitle', { id: data.review.id })}</title>
	<script>
		(() => {
			const startSectionNavigation = () => {
				const activateSection = (sectionId) => {
					const links = document.querySelectorAll('.section-navigation a[data-section-link]');
					links.forEach((link) => {
						const isCurrent = link.dataset.sectionLink === sectionId;
						link.classList.toggle('current', isCurrent);
						if (isCurrent) {
							link.setAttribute('aria-current', 'location');
							link.scrollIntoView({ block: 'nearest' });
						} else {
							link.removeAttribute('aria-current');
						}
					});
				};

				const sectionAnchors = [...document.querySelectorAll('[data-section-anchor]')];
				if (sectionAnchors.length === 0) return;

				const activateFromHash = () => {
					const targetId = location.hash.slice(1);
					if (!targetId) {
						activateSection(sectionAnchors[0].dataset.sectionAnchor);
						return;
					}

					const target = document.getElementById(targetId);
					const targetLine = Number(target?.dataset.lineStart);
					const current = sectionAnchors
						.filter((anchor) => Number(anchor.dataset.lineStart) <= targetLine)
						.at(-1);
					activateSection(current?.dataset.sectionAnchor ?? targetId);
				};

				const observer = new IntersectionObserver(
					(entries) => {
						const visible = entries
							.filter((entry) => entry.isIntersecting)
							.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
						if (visible?.target instanceof HTMLElement) {
							activateSection(visible.target.dataset.sectionAnchor);
						}
					},
					{ rootMargin: '-18% 0px -70% 0px', threshold: 0 }
				);

				sectionAnchors.forEach((anchor) => observer.observe(anchor));
				activateFromHash();
				window.addEventListener('hashchange', activateFromHash);
			};

			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', startSectionNavigation, { once: true });
			} else {
				startSectionNavigation();
			}
		})();
	</script>
</svelte:head>

{#if data.document.format === 'image'}
	<ImageRegionReview
		reviewId={data.review.id}
		documentPath={markdownPath}
		version={data.latestVersion.version}
		{comments}
		locale={(data as typeof data & { locale: Locale }).locale}
	/>
{:else}
<main class="page">
	<nav><a href={resolve('/reviews')}>{t('review.backToReviews')}</a></nav>
	<ReviewHero
		eyebrow={t('review.markdownEyebrow', { id: data.review.id })}
		title={data.review.title}
		meta={[t('review.meta.version', { version: data.latestVersion.version }), t('review.meta.lines', { count: lineCount }), t('review.meta.openComments', { count: openComments.length })]}
		codeText={markdownPath}
	>
		<p class="hint">{t('document.agentHint')} <code>reviewctl comments --review {data.review.id} --json</code>.</p>
	</ReviewHero>

	<section class="review-layout">
		<aside class="section-navigation" aria-label="Document section navigation">
			<h2>{t('document.sections')}</h2>
			{#if sectionLinks.length === 0}
				<p>{t('document.noSections')}</p>
			{:else}
				<ul>
					{#each sectionLinks as section (section.id)}
						<li class:subsection={section.headingLevel > 2}>
							<a href={`#${section.id}`} data-section-link={section.id}>{section.headingText}</a>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>

		<article class="markdown-card" class:annotating={annotationMode} aria-label="Markdown design document" onpointerup={captureSelection}>
			<header class="annotation-toolbar">
				<button
					class="annotation-toggle"
					class:active={annotationMode}
					type="button"
					aria-pressed={annotationMode}
					title={t('comment.annotationMode')}
					onclick={() => {
						annotationMode = !annotationMode;
						if (!annotationMode) clearSelectionDraft();
					}}
				>+</button>
				{#if annotationMode}<span>{t('comment.annotationHint')}</span>{/if}
				{#if savedAnnotations.length > 0}
					<button class="send-saved" type="button" disabled={sending} onclick={() => void sendOpenComments()}>
						{sending ? t('comment.sending') : t('comment.sendSaved', { count: savedAnnotations.length })}
					</button>
				{/if}
				{#if notice}<span class="annotation-notice" role="status">{notice}</span>{/if}
			</header>
			{#each renderedBlocks as block (block.id)}
				<div class="md-review-item">
					<section class="md-block" class:active={activeLine === block.lineStart} data-section-anchor={block.headingText ? block.id : undefined} data-line-start={block.lineStart}>
						<div class="review-gutter">
							<a class="line-number" href={`#${block.id}`} id={block.id} data-line-start={block.lineStart}>{lineRangeLabel(block)}</a>
						</div>
						<div class="md-content" data-block-id={block.id}>{@html block.html}</div>
					</section>
					{#each commentsForLine(block.lineStart) as comment (comment.id)}
						<section class="comment-thread">
							<strong>{comment.author}</strong>
							<span>{formatCommentTime(comment.createdAt)}</span>
							{#if comment.textSelection}<blockquote>{comment.textSelection.selectedText}</blockquote>{/if}
							<p>{comment.body}</p>
						</section>
					{/each}
				</div>
			{/each}
		</article>

		<aside class="comment-overview">
			<h2>{t('document.openComments')}</h2>
			{#if openComments.length === 0}
				<p>{t('document.noComments')}</p>
			{:else}
				<ul>
					{#each openComments as comment (comment.id)}
						<li>
							<a href={`#L${comment.lineStart}`}>{lineLabel(comment.lineStart)}</a>
							<strong>{comment.author}</strong>
							<span>{comment.body}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>
	</section>

	{#if selectionDraft}
		<form
			class="selection-composer"
			method="POST"
			action={`?/addComment#${selectionDraft.blockId}`}
			use:enhance={enhanceAnnotation}
			style:left={`${selectionDraft.left}px`}
			style:top={`${selectionDraft.top}px`}
		>
			<input type="hidden" name="filePath" value={markdownPath} />
			<input type="hidden" name="side" value="new" />
			<input type="hidden" name="lineStart" value={selectionDraft.lineStart} />
			<input type="hidden" name="lineEnd" value={selectionDraft.lineEnd} />
			<input type="hidden" name="documentVersion" value={data.latestVersion.version} />
			<input type="hidden" name="blockId" value={selectionDraft.blockId} />
			<input type="hidden" name="startOffset" value={selectionDraft.startOffset} />
			<input type="hidden" name="endOffset" value={selectionDraft.endOffset} />
			<input type="hidden" name="selectedText" value={selectionDraft.selectedText} />
			<input type="hidden" name="prefix" value={selectionDraft.prefix} />
			<input type="hidden" name="suffix" value={selectionDraft.suffix} />
			<input type="hidden" name="author" value="reviewer" />
			<span class="selection-label">{t('comment.selectedText')}</span>
			<blockquote>{selectionDraft.selectedText}</blockquote>
			<textarea bind:this={composerTextarea} name="body" rows="3" required placeholder={t('comment.placeholder')}></textarea>
			{#if formErrorKey}<p class="error">{t(formErrorKey)}</p>{:else if formError}<p class="error">{formError}</p>{/if}
			<div class="composer-actions">
				<button class="secondary" type="button" onclick={clearSelectionDraft}>{t('common.cancel')}</button>
				<button class="secondary" type="submit" name="delivery" value="send">{t('comment.sendNow')}</button>
				<button type="submit" name="delivery" value="save">{t('comment.addToReview')}</button>
			</div>
		</form>
	{/if}
</main>
{/if}

<style>
	:global(body) {
		margin: 0;
		background: #f8fafc;
		color: #0f172a;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}
	:global(*) {
		box-sizing: border-box;
	}
	.page {
		width: 100%;
		padding: 16px;
	}
	nav a {
		color: #2563eb;
		font-weight: 700;
		text-decoration: none;
	}
	code {
		overflow-wrap: anywhere;
		color: #334155;
	}
	.hint {
		margin-bottom: 0;
		color: #64748b;
	}
	.review-layout {
		display: grid;
		grid-template-columns: minmax(320px, 18vw) minmax(0, 1fr) 340px;
		gap: 12px;
		align-items: start;
		margin-top: 12px;
	}
	.markdown-card,
	.section-navigation,
	.comment-overview {
		border: 1px solid #dbe3ef;
		border-radius: 18px;
		background: white;
		box-shadow: 0 14px 40px rgba(15, 23, 42, 0.06);
	}
	.markdown-card {
		padding: 0 0 16px;
		overflow: hidden;
	}
	.annotation-toolbar {
		position: sticky;
		top: 0;
		z-index: 4;
		display: flex;
		min-height: 50px;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		border-bottom: 1px solid #e2e8f0;
		background: rgba(255, 255, 255, 0.94);
		backdrop-filter: blur(10px);
		color: #64748b;
		font-size: 0.9rem;
	}
	.annotation-toggle {
		display: inline-grid;
		width: 32px;
		height: 32px;
		place-items: center;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: white;
		color: #2563eb;
		font-size: 1.35rem;
		font-weight: 700;
		cursor: pointer;
	}
	.annotation-toggle.active {
		border-color: #2563eb;
		background: #2563eb;
		color: white;
	}
	.send-saved {
		margin-left: auto;
		border: 0;
		border-radius: 999px;
		padding: 8px 12px;
		background: #2563eb;
		color: white;
		font-weight: 800;
		cursor: pointer;
	}
	.annotation-notice {
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.md-block {
		display: grid;
		grid-template-columns: 72px minmax(0, 1fr);
		gap: 8px;
		align-items: start;
		padding: 4px 20px;
	}
	.review-gutter {
		display: flex;
		justify-content: flex-end;
	}
	.md-block:hover,
	.md-block.active {
		background: #f1f5f9;
	}
	.line-number {
		padding-top: 4px;
		color: #94a3b8;
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.85rem;
		text-align: right;
		text-decoration: none;
	}
	.md-content {
		min-width: 0;
		word-break: break-word;
		font-size: 1rem;
		line-height: 1.65;
	}
	.markdown-card.annotating .md-content {
		cursor: text;
		user-select: text;
	}

	.md-content :global(*) {
		box-sizing: border-box;
	}
	.md-content :global(h1),
	.md-content :global(h2),
	.md-content :global(h3),
	.md-content :global(h4) {
		margin: 1.1em 0 0.45em;
		line-height: 1.25;
		font-weight: 800;
	}
	.md-content :global(h1) {
		font-size: 2rem;
		padding-bottom: 0.25em;
		border-bottom: 1px solid #e2e8f0;
	}
	.md-content :global(h2) {
		font-size: 1.55rem;
		padding-bottom: 0.2em;
		border-bottom: 1px solid #eef2f7;
	}
	.md-content :global(h3) {
		font-size: 1.25rem;
	}
	.md-content :global(p),
	.md-content :global(ul),
	.md-content :global(ol),
	.md-content :global(blockquote),
	.md-content :global(pre),
	.md-content :global(table) {
		margin: 0.65em 0;
	}
	.md-content :global(ul),
	.md-content :global(ol) {
		padding-left: 1.6rem;
	}
	.md-content :global(li + li) {
		margin-top: 0.25rem;
	}
	.md-content :global(blockquote) {
		padding: 0.3rem 0 0.3rem 1rem;
		border-left: 4px solid #bfdbfe;
		color: #475569;
	}
	.md-content :global(pre) {
		overflow-x: auto;
		padding: 14px 16px;
		border-radius: 12px;
		background: #0f172a;
		color: #e2e8f0;
	}
	.md-content :global(code) {
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.92em;
	}
	.md-content :global(:not(pre) > code) {
		padding: 0.12rem 0.32rem;
		border-radius: 6px;
		background: #e2e8f0;
		color: #0f172a;
		overflow-wrap: anywhere;
		word-break: normal;
	}
	.md-content :global(table) {
		width: 100%;
		border-collapse: collapse;
		display: block;
		overflow-x: auto;
	}
	.md-content :global(th),
	.md-content :global(td) {
		padding: 8px 10px;
		border: 1px solid #cbd5e1;
		vertical-align: top;
	}
	.md-content :global(th) {
		background: #f1f5f9;
		font-weight: 800;
	}
	.md-content :global(a) {
		color: #2563eb;
		font-weight: 700;
	}
	.comment-thread {
		margin: 8px 20px 12px 92px;
		padding: 12px;
		border-left: 4px solid #2563eb;
		border-radius: 10px;
		background: #eff6ff;
	}
	.comment-thread strong {
		margin-right: 8px;
	}
	.comment-thread span {
		color: #64748b;
		font-size: 0.85rem;
	}
	.comment-thread p {
		margin: 8px 0 0;
		white-space: pre-wrap;
	}
	.comment-thread blockquote,
	.selection-composer blockquote {
		max-height: 88px;
		overflow: auto;
		margin: 8px 0;
		padding-left: 10px;
		border-left: 3px solid #93c5fd;
		color: #475569;
		font-size: 0.9rem;
	}
	.selection-composer {
		position: fixed;
		z-index: 30;
		display: grid;
		width: min(360px, calc(100vw - 24px));
		gap: 8px;
		padding: 12px;
		border: 1px solid #cbd5e1;
		border-radius: 14px;
		background: white;
		box-shadow: 0 18px 50px rgba(15, 23, 42, 0.24);
	}
	.selection-label {
		color: #64748b;
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
	}
	.selection-composer textarea {
		width: 100%;
		resize: vertical;
		border: 1px solid #cbd5e1;
		border-radius: 10px;
		padding: 10px;
		font: inherit;
	}
	.composer-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	button {
		font: inherit;
	}
	.composer-actions button {
		padding: 9px 12px;
		border: 0;
		border-radius: 10px;
		background: #2563eb;
		color: white;
		font-weight: 800;
		text-decoration: none;
		cursor: pointer;
	}
	.composer-actions .secondary {
		background: #e2e8f0;
		color: #0f172a;
	}
	.error {
		margin: 0;
		color: #b91c1c;
		font-weight: 700;
	}
	.comment-overview {
		position: sticky;
		top: 18px;
		padding: 18px;
	}
	.section-navigation {
		position: sticky;
		top: 18px;
		padding: 16px;
		max-height: calc(100vh - 36px);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}
	.section-navigation h2,
	.comment-overview h2 {
		margin-top: 0;
	}
	.section-navigation p,
	.comment-overview p {
		color: #64748b;
	}
	.section-navigation ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.section-navigation li {
		border-radius: 10px;
	}
	.section-navigation li.subsection {
		padding-left: 14px;
	}
	.section-navigation a {
		display: block;
		padding: 8px 10px;
		border-radius: 10px;
		color: #334155;
		font-weight: 750;
		line-height: 1.25;
		text-decoration: none;
	}
	.section-navigation a:hover,
	.section-navigation :global(a.current),
	.section-navigation :global(a[aria-current='location']) {
		background: #eff6ff;
		color: #2563eb;
	}
	.section-navigation :global(a.current),
	.section-navigation :global(a[aria-current='location']) {
		box-shadow: inset 3px 0 0 #2563eb;
		font-weight: 850;
	}
	.comment-overview ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 10px;
	}
	.comment-overview li {
		display: grid;
		gap: 4px;
		padding: 10px;
		border: 1px solid #dbe3ef;
		border-radius: 10px;
	}
	.comment-overview a {
		color: #2563eb;
		font-weight: 800;
		text-decoration: none;
	}
	.comment-overview span {
		color: #475569;
	}
	@media (max-width: 980px) {
		.review-layout {
			grid-template-columns: 1fr;
		}

		.comment-overview,
		.section-navigation {
			position: static;
		}
	}
	@media (max-width: 640px) {
		.page {
			padding: 10px;
		}
		.review-layout {
			gap: 10px;
			margin-top: 10px;
		}
		.markdown-card,
		.section-navigation,
		.comment-overview {
			border-radius: 14px;
			box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
		}
		.section-navigation {
			padding: 12px;
			max-height: 184px;
		}
		.section-navigation h2 {
			margin-bottom: 8px;
			font-size: 1rem;
		}
		.section-navigation ul {
			margin: 0;
		}
		.section-navigation a {
			min-height: 40px;
			padding: 10px;
		}
		.markdown-card {
			padding-bottom: 8px;
		}
		.md-block {
			grid-template-columns: 48px minmax(0, 1fr);
			gap: 8px;
			padding: 6px 8px;
		}
		.review-gutter {
			display: flex;
			width: 48px;
			flex-direction: column;
			align-items: center;
			gap: 2px;
		}

		.line-number {
			width: 100%;
			padding-top: 0;
			font-size: 0.72rem;
			line-height: 1.2;
			text-align: center;
			overflow-wrap: anywhere;
		}
		.md-content {
			font-size: 0.95rem;
			line-height: 1.55;
		}
		.md-content :global(h1) {
			font-size: 1.55rem;
		}
		.md-content :global(h2) {
			font-size: 1.32rem;
		}
		.md-content :global(h3) {
			font-size: 1.12rem;
		}
		.md-content :global(ul),
		.md-content :global(ol) {
			padding-left: 1.25rem;
		}
		.md-content :global(pre) {
			max-width: 100%;
			padding: 12px;
			font-size: 0.82rem;
		}
		.comment-thread {
			margin: 8px 8px 12px 64px;
			padding: 10px;
		}
		.selection-composer textarea {
			font-size: 16px;
		}
		.composer-actions button {
			min-height: 44px;
		}
		.comment-overview {
			padding: 14px;
		}
	}
</style>
