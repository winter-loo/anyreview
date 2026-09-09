<script lang="ts">
	import MermaidPreview from '$lib/components/review/MermaidPreview.svelte';
	import { onMount } from 'svelte';
	import { createLiveFeedback } from '$lib/feedback/client.svelte';
	import type { RenderedMarkdownBlock } from '$lib/server/markdown/render';

	let { data }: {data: {kind:'markdown';token:string;filename:string;lineCount:number;renderedBlocks:RenderedMarkdownBlock[]}} = $props();

	type Anchor = {
		blockId: string;
		startOffset: number;
		endOffset: number;
		selectedText: string;
		prefix: string;
		suffix: string;
	};
	type Annotation = Anchor & { id: string; body: string; createdAt: string };

	let annotationMode = $state(false);
	let headerHeight = $state(65);
	let annotations = $state<Annotation[]>([]);
	let selectionCandidate = $state<Anchor | null>(null);
	let draft = $state<Anchor | null>(null);
	let draftBody = $state('');
	let notice = $state('');
	let selectionTimer: ReturnType<typeof setTimeout> | undefined;
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let storageKey = '';

	const feedback = createLiveFeedback<Annotation>({token:()=>data.token,kind:'markdown',read:()=>annotations,replace:entries=>{annotations=entries;}});
	onMount(() => {
		storageKey = `reviewloop:live-markdown:${data.token}`;
		try {
			const stored = JSON.parse(localStorage.getItem(storageKey) ?? localStorage.getItem(`reviewloop:${location.pathname}`) ?? '[]');
			annotations = Array.isArray(stored) ? stored : [];
		} catch { annotations = []; }
		const stop = feedback.start(annotations);
		return () => { stop(); clearTimeout(selectionTimer); clearTimeout(noticeTimer); };
	});

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
		if (data.kind !== 'markdown' || !annotationMode) return;
		clearTimeout(selectionTimer);
		// iOS emits selectionchange while a handle is moving. Never open the modal here: its
		// backdrop would intercept the next drag and make the whole page look disabled.
		selectionTimer = setTimeout(() => {
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
				selectionCandidate = null;
				return;
			}
			const range = selection.getRangeAt(0);
			const startContent = contentElement(range.startContainer);
			const endContent = contentElement(range.endContainer);
			if (!startContent || startContent !== endContent) {
				selectionCandidate = null;
				return;
			}
			const renderedBlocks = data.kind === 'markdown' ? data.renderedBlocks : [];
			const block = renderedBlocks.find((candidate: RenderedMarkdownBlock) => candidate.id === startContent.dataset.blockId);
			if (!block) {
				selectionCandidate = null;
				return;
			}
			const startOffset = offsetWithin(startContent, range.startContainer, range.startOffset);
			const endOffset = offsetWithin(startContent, range.endContainer, range.endOffset);
			const text = startContent.textContent ?? '';
			const selectedText = text.slice(startOffset, endOffset);
			if (!selectedText.trim() || selectedText !== range.toString() || selectedText.length > 10_000) {
				selectionCandidate = null;
				return;
			}
			selectionCandidate = {
				blockId: block.id,
				startOffset,
				endOffset,
				selectedText,
				prefix: text.slice(Math.max(0, startOffset - 32), startOffset),
				suffix: text.slice(endOffset, endOffset + 32)
			};
		}, 120);
	}

	function openComposer() {
		if (!selectionCandidate) return;
		draft = selectionCandidate;
		draftBody = '';
	}

	function closeComposer() {
		draft = null;
		draftBody = '';
		selectionCandidate = null;
		window.getSelection()?.removeAllRanges();
	}

	function persist(next: Annotation[]) {
		feedback.persist(next);
		queueMicrotask(renderHighlights);
	}

	function showNotice(message: string) {
		notice = message;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = '';
		}, 2400);
	}

	function saveDraft() {
		if (!draft || !draftBody.trim()) return null;
		const next: Annotation = {
			id: crypto.randomUUID(),
			...draft,
			body: draftBody.trim(),
			createdAt: new Date().toISOString()
		};
		persist([...annotations, next]);
		closeComposer();
		showNotice('已保存批注');
		return next;
	}

	function removeAnnotation(id: string) {
		persist(annotations.filter((annotation) => annotation.id !== id));
		showNotice('标注已删除');
	}

	function shareText(items: Annotation[]) {
		const filename = data.kind === 'markdown' ? data.filename : 'review';
		return [
			`Review: ${filename}`,
			location.href,
			'',
			...items.flatMap((item, index) => [`${index + 1}. “${item.selectedText}”`, item.body, ''])
		].join('\n');
	}

	async function share(items = annotations) {
		if (!items.length) return;
		const text = shareText(items);
		const filename = data.kind === 'markdown' ? data.filename : 'review';
		try {
			if (navigator.share) {
				await navigator.share({ title: `${filename} 标注`, text });
				showNotice('已打开分享面板');
			} else {
				await navigator.clipboard.writeText(text);
				showNotice('标注已复制');
			}
		} catch (cause) {
			if (!(cause instanceof DOMException && cause.name === 'AbortError')) showNotice('分享失败，请重试');
		}
	}

	async function saveAndShare() {
		const annotation = saveDraft();
		if (annotation) await share([...annotations]);
	}

	function annotationsForBlock(blockId: string) {
		return annotations.filter((annotation) => annotation.blockId === blockId);
	}

	function renderHighlights() {
		if (data.kind !== 'markdown') return;
		if (!document.getElementById('live-review-highlight-style')) {
			const style = document.createElement('style');
			style.id = 'live-review-highlight-style';
			style.textContent = '::highlight(live-review-annotations) { background: #fde68a; color: inherit; }';
			document.head.append(style);
		}
		const registry = (CSS as unknown as { highlights?: { delete(name: string): void; set(name: string, value: unknown): void } }).highlights;
		const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
		if (!registry || !HighlightClass) return;
		registry.delete('live-review-annotations');
		const ranges = annotations.flatMap((annotation) => {
			const root = document.querySelector<HTMLElement>(`.md-content[data-block-id="${CSS.escape(annotation.blockId)}"]`);
			if (!root || (root.textContent ?? '').slice(annotation.startOffset, annotation.endOffset) !== annotation.selectedText) return [];
			const range = rangeWithin(root, annotation.startOffset, annotation.endOffset);
			return range ? [range] : [];
		});
		if (ranges.length) registry.set('live-review-annotations', new HighlightClass(...ranges));
	}

	$effect(() => {
		if (data.kind === 'markdown') {
			annotations;
			queueMicrotask(renderHighlights);
		}
	});
</script>

<svelte:document onselectionchange={captureSelection} />




	<header bind:clientHeight={headerHeight}>
		<div class="file-meta">
			<strong title={data.filename}>{data.filename}</strong>
			<span>{data.lineCount} 行 · 文档快照</span>
		</div>
		<div class="toolbar">
			<button
				class:active={annotationMode}
				type="button"
				aria-pressed={annotationMode}
				onclick={() => {
					annotationMode = !annotationMode;
					if (!annotationMode) {
						selectionCandidate = null;
						closeComposer();
					}
				}}
			>{annotationMode ? '完成' : '标注'}</button>
			{#if annotations.length}
				<button class="share-annotations" type="button" aria-label={`分享 ${annotations.length} 条标注`} title={`分享 ${annotations.length} 条标注`} onclick={() => void share()}>
					<svg class="share-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3m-4 4 4-4 4 4M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" /></svg>
					<span class="share-label">分享 {annotations.length} 条</span>
				</button>
			{/if}
			{#if annotations.length}
				<button class="primary submit-feedback" type="button"
					disabled={feedback.context.busy || !feedback.context.pendingCount || !!feedback.context.error}
					aria-busy={feedback.context.busy}
					aria-label={feedback.context.busy ? '正在提交给 AI' : feedback.context.pendingCount > 0 ? `提交给 AI，${feedback.context.pendingCount} 条待提交` : '提交给 AI'}
					title={feedback.context.error || (feedback.context.pendingCount ? `${feedback.context.pendingCount} 条待提交` : feedback.context.status)}
					onclick={() => feedback.context.submit()}>
					<span>{feedback.context.busy ? '正在提交…' : '提交给 AI'}</span>
					{#if feedback.context.pendingCount > 0}
						<span class="count-badge" aria-hidden="true">{feedback.context.pendingCount}</span>
					{/if}
				</button>
			{/if}
		</div>
	</header>
	{#if feedback.context.error}
		<div class="feedback-error" role="alert">
			<span>{feedback.context.error}</span>
			<button type="button" onclick={() => feedback.context.retry()}>重试同步</button>
		</div>
	{/if}

	{#if annotationMode}
		<div class="annotation-hint" style:top={`${headerHeight}px`} role="status">长按选择文字，调整好范围后点“添加批注”</div>
	{/if}
	{#if notice}<div class="notice" role="status">{notice}</div>{/if}

	<main class:annotating={annotationMode}>
		{#each data.renderedBlocks as block (block.id)}
			<div class="review-block">
				<!-- Safe: server-side markdown-it disables embedded HTML. -->
				{#if block.diagram}
					<MermaidPreview source={block.diagram.source}>
						<section class="md-content" data-block-id={block.id}>{@html block.html}</section>
					</MermaidPreview>
				{:else}
					<section class="md-content" data-block-id={block.id}>{@html block.html}</section>
				{/if}
				{#each annotationsForBlock(block.id) as annotation (annotation.id)}
					<article class="annotation-card">
						<blockquote>{annotation.selectedText}</blockquote>
						<p>{annotation.body}</p>
						<button type="button" aria-label="删除标注" onclick={() => removeAnnotation(annotation.id)}>删除</button>
					</article>
				{/each}
			</div>
		{/each}

	</main>

	{#if selectionCandidate && !draft}
		<button class="selection-action primary" type="button" onclick={openComposer}>
			添加批注 · {selectionCandidate.selectedText}
		</button>
	{/if}

{#if draft}
	<button class="backdrop" type="button" aria-label="关闭批注输入框" onclick={closeComposer}></button>
	<div class="composer" role="dialog" aria-modal="true" aria-label="添加批注">
		<div class="grabber"></div>
		<span>已选择</span>
		<blockquote>{draft.selectedText}</blockquote>
		<textarea bind:value={draftBody} rows="3" maxlength="4000" placeholder="写下你的意见…" aria-label="批注内容"></textarea>
		<div class="composer-actions">
			<button type="button" onclick={closeComposer}>取消</button>
			<button type="button" disabled={!draftBody.trim()} onclick={saveDraft}>保存</button>
			<button class="primary" type="button" disabled={!draftBody.trim()} onclick={() => void saveAndShare()}>保存并分享</button>
		</div>
	</div>
{/if}
<style>
 .feedback-error { display:flex; align-items:center; justify-content:flex-end; gap:12px; padding:10px 14px; background:#fff1f2; color:#9f1239; font-size:14px; }
 .feedback-error span { overflow-wrap:anywhere; }
 .feedback-error button { flex:none; }
 .share-icon { display:none; }
 .submit-feedback { display:inline-flex; align-items:center; gap:8px; white-space:nowrap; }
 .count-badge { display:inline-grid; place-items:center; min-width:24px; height:24px; padding-inline:6px; border-radius:999px; background:rgba(255,255,255,.22); font-size:12px; line-height:1; font-variant-numeric:tabular-nums; }
 .toolbar button:focus-visible { outline:3px solid #93c5fd; outline-offset:3px; }
 .toolbar button:active:not(:disabled) { transform:scale(.97); }
	:global(*) { box-sizing: border-box; }
	:global(body) { margin: 0; background: #f7f7f5; color: #242424; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
	header { position: sticky; top: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: calc(10px + env(safe-area-inset-top)) 14px 10px; border-bottom: 1px solid #deded8; background: rgba(255, 255, 253, .96); backdrop-filter: blur(12px); }
	.file-meta { display: grid; gap: 2px; min-width: 0; }
	.file-meta strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.file-meta span { color: #77776f; font-size: 12px; }
	.toolbar { display: flex; flex: none; gap: 8px; justify-content:flex-end; }
	button { min-height: 44px; border: 1px solid #d5d5ce; border-radius: 11px; background: white; padding: 0 14px; color: #242424; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation; }
	button.active, button.primary { border-color: #2563eb; background: #2563eb; color: white; }
	button:disabled { opacity: .45; cursor: default; }
	.annotation-hint { position: sticky; z-index: 9; top: calc(65px + env(safe-area-inset-top)); width: 100%; padding: 8px 13px; background: #1d4ed8; color: white; font-size: 13px; text-align: center; }
	.notice { position: fixed; z-index: 9; bottom: calc(18px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 24px); border-radius: 999px; padding: 8px 13px; background: #242424; color: white; box-shadow: 0 6px 24px rgba(0,0,0,.12); font-size: 13px; }
	.selection-action { position: fixed; z-index: 18; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); left: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(37, 99, 235, .28); text-overflow: ellipsis; white-space: nowrap; }
	main { width: min(860px, calc(100% - 32px)); margin: 28px auto 80px; padding: 44px 52px; border: 1px solid #e1e1dc; border-radius: 12px; background: white; box-shadow: 0 10px 35px rgba(0, 0, 0, .04); }
	main.annotating .md-content { cursor: text; user-select: text; -webkit-user-select: text; }
	.md-content { overflow-wrap: anywhere; }
	.md-content :global(img) { max-width: 100%; height: auto; }
	.md-content :global(h1), .md-content :global(h2), .md-content :global(h3) { margin: 1.4em 0 .55em; line-height: 1.2; }
	.md-content:first-child :global(h1) { margin-top: 0; }
	.md-content :global(p), .md-content :global(li) { line-height: 1.72; }
	.md-content :global(a) { color: #2563eb; }
	.md-content :global(pre) { overflow: auto; padding: 16px; border-radius: 9px; background: #171717; color: #f4f4f5; }
	.md-content :global(code) { border-radius: 4px; background: #f0f0ed; padding: .12em .32em; font-family: ui-monospace, monospace; }
	.md-content :global(pre code) { background: transparent; padding: 0; }
	.md-content :global(blockquote) { margin-left: 0; padding-left: 16px; border-left: 3px solid #d3d3cc; color: #65655f; }
	.md-content :global(table) { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; }
	.md-content :global(th), .md-content :global(td) { padding: 8px 10px; border: 1px solid #deded8; text-align: left; }
	.annotation-card { position: relative; margin: 10px 0 18px; padding: 12px 56px 12px 14px; border-left: 4px solid #eab308; border-radius: 10px; background: #fefce8; }
	.annotation-card blockquote { margin: 0 0 7px; color: #71620b; font-size: 13px; }
	.annotation-card p { margin: 0; white-space: pre-wrap; }
	.annotation-card button { position: absolute; top: 6px; right: 6px; min-height: 36px; border: 0; background: transparent; padding: 0 8px; color: #92400e; font-size: 12px; }
	.backdrop { position: fixed; z-index: 19; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 0; background: rgba(15, 23, 42, .3); }
	.composer { position: fixed; z-index: 20; left: 50%; bottom: 16px; display: grid; width: min(520px, calc(100% - 24px)); max-height: calc(100dvh - 24px); overflow-y: auto; transform: translateX(-50%); gap: 10px; padding: 14px; border: 1px solid #d5d5ce; border-radius: 18px; background: white; box-shadow: 0 24px 70px rgba(0,0,0,.26); }
	.grabber { display: none; width: 42px; height: 4px; margin: -3px auto 2px; border-radius: 999px; background: #d4d4d4; }
	.composer > span { color: #77776f; font-size: 12px; font-weight: 800; }
	.composer blockquote { max-height: 92px; overflow: auto; margin: 0; padding-left: 10px; border-left: 3px solid #facc15; color: #525252; }
	.composer textarea { width: 100%; min-height: 96px; resize: vertical; border: 1px solid #bdbdb5; border-radius: 12px; padding: 12px; font: inherit; font-size: 16px; }
	.composer textarea:focus { border-color: #2563eb; outline: 3px solid #dbeafe; }
	.composer-actions { display: flex; justify-content: flex-end; gap: 8px; }

	@media (max-width: 640px) {
		header { gap:6px; padding-inline:10px; }
		.file-meta { flex:1; }
		.file-meta strong { font-size:14px; }
		.file-meta span { display:none; }
		.toolbar { gap:4px; }
		.toolbar button { min-width:44px; padding-inline:8px; font-size:13px; white-space:nowrap; }
		.share-annotations { display:inline-grid; place-items:center; width:44px; }
		.share-icon { display:block; }
		.share-label { display:none; }
		.submit-feedback { gap:5px; }
		.count-badge { min-width:20px; height:20px; padding-inline:5px; }
		main { width: 100%; margin: 0; padding: 28px 18px calc(88px + env(safe-area-inset-bottom)); border: 0; border-radius: 0; box-shadow: none; }
		.md-content :global(h1) { font-size: 1.72rem; }
		.md-content :global(h2) { font-size: 1.38rem; }
		.annotation-card { margin-inline: -4px; }
		.backdrop { background: rgba(15, 23, 42, .38); }
		.composer { bottom: 0; width: 100%; padding: 12px 14px calc(12px + env(safe-area-inset-bottom)); border-width: 1px 0 0; border-radius: 20px 20px 0 0; }
		.grabber { display: block; }
		.composer-actions { display: grid; grid-template-columns: 1fr 1fr; }
		.composer-actions .primary { grid-column: 1 / -1; grid-row: 1; }
		.composer-actions button { width: 100%; }
	}
</style>
