<script lang="ts">
	import { untrack } from 'svelte';
	import { createTranslator } from '$lib/i18n/translate';
	import type { Locale } from '$lib/i18n/locales';

	type Region = { page: number; x: number; y: number; width: number; height: number };
	type RegionComment = {
		id: string;
		body: string;
		author: string;
		status: 'open' | 'resolved';
		pageRegion: Region | null;
	};

	let {
		reviewId,
		documentPath,
		version,
		comments: initialComments,
		locale
	}: { reviewId: string; documentPath: string; version: number; comments: RegionComment[]; locale: Locale } = $props();

	const t = $derived(createTranslator(locale));
	let comments = $state(untrack(() => [...initialComments]));
	let annotationMode = $state(false);
	let drawing = $state(false);
	let start = $state<{ x: number; y: number } | null>(null);
	let draft = $state<Region | null>(null);
	let note = $state('');
	let saving = $state(false);
	let sending = $state(false);
	let notice = $state('');
	let textarea = $state<HTMLTextAreaElement | null>(null);
	const openRegions = $derived(comments.filter((comment) => comment.status === 'open' && comment.pageRegion));

	function point(event: PointerEvent) {
		const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
		if (!rect) return null;
		return {
			x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
			y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
		};
	}

	function updateDraft(current: { x: number; y: number }) {
		if (!start) return;
		draft = {
			page: 1,
			x: Math.min(start.x, current.x),
			y: Math.min(start.y, current.y),
			width: Math.abs(current.x - start.x),
			height: Math.abs(current.y - start.y)
		};
	}

	function beginSelection(event: PointerEvent) {
		if (!annotationMode || event.button !== 0) return;
		const current = point(event);
		if (!current) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		start = current;
		draft = { page: 1, x: current.x, y: current.y, width: 0, height: 0 };
		drawing = true;
		notice = '';
	}

	function moveSelection(event: PointerEvent) {
		if (!drawing) return;
		const current = point(event);
		if (current) updateDraft(current);
	}

	function endSelection(event: PointerEvent) {
		if (!drawing) return;
		const current = point(event);
		if (current) updateDraft(current);
		drawing = false;
		start = null;
		if (!draft || draft.width < 0.01 || draft.height < 0.01) {
			draft = null;
			return;
		}
		queueMicrotask(() => textarea?.focus());
	}

	function cancelDraft() {
		draft = null;
		note = '';
	}

	async function saveRegion() {
		if (!draft || !note.trim()) return;
		saving = true;
		notice = '';
		try {
			const response = await fetch(`/api/reviews/${reviewId}/comments`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ filePath: documentPath, body: note, author: 'reviewer', pageRegion: draft })
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.message ?? payload.error ?? t('comment.saveError'));
			comments = [...comments, payload.comment];
			cancelDraft();
			notice = t('comment.saved');
		} catch (cause) {
			notice = cause instanceof Error ? cause.message : t('comment.saveError');
		} finally {
			saving = false;
		}
	}

	async function sendRegions() {
		sending = true;
		notice = '';
		try {
			const response = await fetch(`/api/reviews/${reviewId}/agent/trigger-comments`, { method: 'POST' });
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.message ?? payload.error ?? t('comment.sendError'));
			notice = payload.message;
		} catch (cause) {
			notice = cause instanceof Error ? cause.message : t('comment.sendError');
		} finally {
			sending = false;
		}
	}

	function percent(value: number) {
		return `${Math.round(value * 100)}%`;
	}
</script>

<section class="image-review" aria-label="Image document review">
	<header class="toolbar">
		<div>
			<strong>{t('image.page')}</strong>
			<span>{annotationMode ? t('image.annotationHint') : t('image.annotationMode')}</span>
		</div>
		<div class="toolbar-actions">
			{#if openRegions.length > 0}
				<button class="secondary" type="button" disabled={sending} onclick={() => void sendRegions()}>
					{sending ? t('comment.sending') : t('comment.sendSaved', { count: openRegions.length })}
				</button>
			{/if}
			<button class:active={annotationMode} type="button" aria-pressed={annotationMode} onclick={() => { annotationMode = !annotationMode; if (!annotationMode) cancelDraft(); }}>
				{annotationMode ? t('common.cancel') : t('image.annotationMode')}
			</button>
		</div>
	</header>

	<div class="page-shell">
		<div
			class="page-image"
			class:annotating={annotationMode}
			role="group"
			aria-label={t('image.annotationMode')}
			onpointerdown={beginSelection}
			onpointermove={moveSelection}
			onpointerup={endSelection}
			onpointercancel={endSelection}
		>
			<img src={`/api/reviews/${reviewId}/document`} alt={documentPath} draggable="false" />
			{#each openRegions as comment, index (comment.id)}
				{@const region = comment.pageRegion!}
				<div class="saved-region" style:left={percent(region.x)} style:top={percent(region.y)} style:width={percent(region.width)} style:height={percent(region.height)}>
					<span>{index + 1}</span>
				</div>
			{/each}
			{#if draft}
				<div class="draft-region" style:left={percent(draft.x)} style:top={percent(draft.y)} style:width={percent(draft.width)} style:height={percent(draft.height)}></div>
			{/if}
		</div>
	</div>

	{#if draft && !drawing}
		<form class="composer" onsubmit={(event) => { event.preventDefault(); void saveRegion(); }}>
			<strong>{t('image.annotationReady')}</strong>
			<small>{t('image.region')}: x {percent(draft.x)}, y {percent(draft.y)}, w {percent(draft.width)}, h {percent(draft.height)}</small>
			<textarea bind:this={textarea} bind:value={note} rows="3" required placeholder={t('comment.placeholder')}></textarea>
			<div>
				<button class="secondary" type="button" onclick={cancelDraft}>{t('common.cancel')}</button>
				<button type="submit" disabled={saving || !note.trim()}>{saving ? t('comment.sending') : t('comment.addToReview')}</button>
			</div>
		</form>
	{/if}

	{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	{#if openRegions.length > 0}
		<ol class="comments">
			{#each openRegions as comment (comment.id)}
				<li><strong>{comment.author}</strong><p>{comment.body}</p></li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.image-review { display: grid; gap: 12px; margin-top: 12px; }
	.toolbar, .composer, .comments { border: 1px solid #dbe3ef; border-radius: 16px; background: #fff; box-shadow: 0 12px 32px rgba(15, 23, 42, .06); }
	.toolbar { position: sticky; top: 8px; z-index: 4; display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px 14px; }
	.toolbar > div:first-child { display: grid; gap: 2px; }
	.toolbar span, small, .notice { color: #64748b; }
	.toolbar-actions { display: flex; gap: 8px; }
	button { min-height: 44px; border: 0; border-radius: 11px; padding: 0 16px; background: #0f172a; color: #fff; font: inherit; font-weight: 750; cursor: pointer; }
	button.secondary { border: 1px solid #cbd5e1; background: #fff; color: #334155; }
	button.active { background: #dc2626; }
	button:disabled { cursor: wait; opacity: .55; }
	.page-shell { overflow: auto; border-radius: 16px; background: #e2e8f0; padding: 12px; }
	.page-image { position: relative; width: min(100%, 1200px); margin: 0 auto; line-height: 0; user-select: none; }
	.page-image img { display: block; width: 100%; height: auto; border-radius: 4px; background: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, .16); }
	.page-image.annotating { cursor: crosshair; touch-action: none; }
	.saved-region, .draft-region { position: absolute; pointer-events: none; border: 3px solid #dc2626; background: rgba(254, 226, 226, .18); }
	.draft-region { border-style: dashed; }
	.saved-region span { position: absolute; top: -14px; left: -14px; display: grid; width: 28px; height: 28px; place-items: center; border-radius: 50%; background: #dc2626; color: #fff; font: 800 13px/1 system-ui; }
	.composer { position: sticky; bottom: 12px; z-index: 5; display: grid; gap: 10px; width: min(560px, 100%); margin: 0 auto; padding: 14px; }
	.composer textarea { width: 100%; resize: vertical; border: 1px solid #94a3b8; border-radius: 10px; padding: 12px; font: inherit; }
	.composer > div { display: flex; justify-content: flex-end; gap: 8px; }
	.notice { margin: 0; text-align: center; }
	.comments { margin: 0; padding: 14px 14px 14px 46px; }
	.comments li { padding: 6px 0; }
	.comments p { margin: 4px 0 0; }
	@media (max-width: 640px) {
		.toolbar { align-items: stretch; flex-direction: column; }
		.toolbar-actions { display: grid; grid-template-columns: 1fr 1fr; }
		.page-shell { padding: 4px; border-radius: 10px; }
		.composer { bottom: 6px; }
		.composer > div { display: grid; grid-template-columns: 1fr 1fr; }
	}
</style>
