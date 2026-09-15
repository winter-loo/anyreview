<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import closeIcon from '$lib/assets/review-icons/close.svg?url';
	import { twoFingerPan } from '$lib/review/twoFingerPan';
	import { BRUSH_COLORS, BRUSH_SIZES, drawStrokes, type Point, type Stroke } from '$lib/review/strokes';
	import FigureMarks from './FigureMarks.svelte';
	import ReviewToolbar from './ReviewToolbar.svelte';
	import ReviewComposer from './ReviewComposer.svelte';
	import ReviewDetail from './ReviewDetail.svelte';
	import ReviewComments from './ReviewComments.svelte';
	import ReviewDialog from './ReviewDialog.svelte';
	import './mobile-review.css';

	type Mark = { id: string; strokes: Stroke[]; badgePosition: Point; body: string; createdAt: string };
	let { src, label, marks, selected = null, onsave, ondelete, onclose }: {
		src: string; label: string; marks: Mark[]; selected?: string | null;
		onsave: (mark: { strokes: Stroke[]; badgePosition: Point; body: string }) => void;
		ondelete: (id: string) => void; onclose: () => void;
	} = $props();

	const MIN_ZOOM = 1, MAX_ZOOM = 5;
	// iOS Safari silently stops painting canvases above 16,777,216 pixels.
	const MAX_CANVAS_PIXELS = 16_000_000;

	let dialog: HTMLDialogElement;
	let stage = $state<HTMLElement>();
	let image = $state<HTMLImageElement>();
	let canvas = $state<HTMLCanvasElement>();
	let fitWidth = $state(0);
	let fitHeight = $state(0);
	let zoom = $state(1);
	let paint = $state(false);
	let listOpen = $state(false);
	let composing = $state(false);
	let confirmingClose = $state(false);
	let selectedId = $state<string | null>(untrack(() => selected));
	let brushColor = $state(BRUSH_COLORS[0].value);
	let brushSize = $state(BRUSH_SIZES[1].value);
	let draft = $state<Stroke[]>([]);
	let draftBody = $state('');
	let current: Stroke | null = null;
	const width = $derived(fitWidth * zoom);
	const height = $derived(fitHeight * zoom);
	const selectedIndex = $derived(marks.findIndex((mark) => mark.id === selectedId));

	onMount(() => {
		dialog.showModal();
		const observer = new ResizeObserver(fit);
		observer.observe(stage!);
		const wheel = (event: WheelEvent) => {
			if (!event.ctrlKey) return;
			event.preventDefault();
			void zoomTo(zoom * Math.exp(-event.deltaY * 0.01));
		};
		stage!.addEventListener('wheel', wheel, { passive: false });
		return () => {
			observer.disconnect();
			stage?.removeEventListener('wheel', wheel);
			dialog.close();
		};
	});

	/** Zoom 1 shows the whole figure inside the stage's content box. */
	function fit() {
		if (!stage || !image?.naturalWidth) return;
		const style = getComputedStyle(stage);
		const availableWidth = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
		const availableHeight = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
		const ratio = image.naturalHeight / image.naturalWidth;
		fitWidth = Math.max(1, Math.min(availableWidth, availableHeight / ratio));
		fitHeight = fitWidth * ratio;
	}

	async function zoomTo(next: number) {
		if (!stage) return;
		const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
		const centerX = (stage.scrollLeft + stage.clientWidth / 2) / zoom;
		const centerY = (stage.scrollTop + stage.clientHeight / 2) / zoom;
		zoom = target;
		await tick();
		stage.scrollLeft = centerX * zoom - stage.clientWidth / 2;
		stage.scrollTop = centerY * zoom - stage.clientHeight / 2;
	}

	$effect(() => {
		if (!canvas || !width || !height) return;
		const scale = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		untrack(redraw);
	});

	function redraw() {
		const ctx = canvas?.getContext('2d');
		if (!canvas || !ctx || !width || !height) return;
		ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
		ctx.clearRect(0, 0, width, height);
		drawStrokes(ctx, current ? [...draft, current] : draft, width, height);
	}

	function point(event: PointerEvent): Point | null {
		const rect = canvas?.getBoundingClientRect();
		if (!rect?.width || !rect.height) return null;
		return {
			x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
			y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
		};
	}

	function startStroke(event: PointerEvent) {
		if (!paint || !event.isPrimary || event.button !== 0) return;
		const start = point(event);
		if (!start) return;
		event.preventDefault();
		canvas!.setPointerCapture(event.pointerId);
		current = { color: brushColor, size: brushSize, points: [start] };
		redraw();
	}

	function extendStroke(event: PointerEvent) {
		const next = current && point(event);
		if (!current || !next) return;
		current.points.push(next);
		redraw();
	}

	function endStroke() {
		if (!current) return;
		draft = [...draft, current];
		current = null;
		redraw();
	}

	function cancelStroke() {
		current = null;
		redraw();
	}

	function discardDraft() {
		draft = [];
		draftBody = '';
		composing = false;
		cancelStroke();
	}

	function save() {
		if (!draft.length) return;
		const first = draft[0].points[0];
		onsave({
			strokes: $state.snapshot(draft),
			badgePosition: { x: Math.min(0.95, Math.max(0.05, first.x)), y: Math.min(0.95, Math.max(0.05, first.y)) },
			body: draftBody.trim()
		});
		discardDraft();
		paint = false;
	}

	function requestClose() {
		if (draft.length) confirmingClose = true;
		else onclose();
	}

	function locate(id: string) {
		const mark = marks.find((candidate) => candidate.id === id);
		listOpen = false;
		selectedId = id;
		if (mark && stage) stage.scrollTo({ left: mark.badgePosition.x * width - stage.clientWidth / 2, top: mark.badgePosition.y * height - stage.clientHeight / 2 });
	}
</script>

<dialog
	bind:this={dialog}
	class="live-review figure-annotator"
	class:review-comments-open={listOpen}
	class:review-painting={paint}
	aria-label={`标注：${label}`}
	oncancel={(event) => { event.preventDefault(); requestClose(); }}
>
	<header class="review-header">
		<div class="review-file-identity"><strong title={label}>{label}</strong></div>
		<button class="review-icon-button" type="button" aria-label="关闭图片标注" onclick={requestClose}><img src={closeIcon} alt="" width="20" height="20" /></button>
	</header>
	<div class="review-context">
		<span class="review-context-label">{marks.length ? `${marks.length} 处标注` : '用画笔圈出需要修改的位置'}</span>
		<div class="zoom-controls" role="toolbar" aria-label="缩放">
			<button type="button" aria-label="缩小" disabled={zoom <= MIN_ZOOM} onclick={() => zoomTo(zoom / 1.25)}>−</button>
			<output aria-label="当前缩放比例">{Math.round(zoom * 100)}%</output>
			<button type="button" aria-label="放大" disabled={zoom >= MAX_ZOOM} onclick={() => zoomTo(zoom * 1.25)}>+</button>
			<button class="review-fit" type="button" onclick={() => zoomTo(1)}>适合屏幕</button>
		</div>
	</div>
	<main
		bind:this={stage}
		class="figure-stage"
		use:twoFingerPan={{ enabled: true, zoom, min: MIN_ZOOM, max: MAX_ZOOM, onzoom: (value) => zoom = value, oncancel: cancelStroke }}
	>
		<div class="figure-canvas" style:width={`${width}px`} style:height={`${height}px`}>
			<img bind:this={image} {src} alt={label} draggable="false" onload={fit} />
			<FigureMarks {marks} selected={selectedId} onselect={(id) => selectedId = id} />
			{#if paint || draft.length}
				<canvas
					bind:this={canvas}
					class:painting={paint}
					onpointerdown={startStroke}
					onpointermove={extendStroke}
					onpointerup={endStroke}
					onpointercancel={cancelStroke}
				></canvas>
			{/if}
		</div>
	</main>
	<ReviewToolbar
		{paint} bind:color={brushColor} bind:size={brushSize} colors={BRUSH_COLORS} sizes={BRUSH_SIZES}
		count={marks.length} draftCount={draft.length} comments={listOpen} disabled={!width}
		onbrowse={() => { paint = false; listOpen = false; }}
		onpaint={() => { paint = true; listOpen = false; selectedId = null; }}
		oncomments={() => listOpen = !listOpen}
		onfinish={() => composing = true}
		onundo={() => { draft = draft.slice(0, -1); redraw(); }}
	/>
	{#if composing}
		<ReviewComposer context={`${label} · ${draft.length} 条笔画`} bind:body={draftBody} onsave={save} onclose={() => composing = false} />
	{/if}
	{#if selectedIndex >= 0 && !paint && !listOpen}
		{@const mark = marks[selectedIndex]}
		<ReviewDetail anchor={`${label} · 标注 ${selectedIndex + 1}`} body={mark.body} createdAt={mark.createdAt}
			onclose={() => selectedId = null} ondelete={() => { ondelete(mark.id); selectedId = null; }} onall={() => { selectedId = null; listOpen = true; }} />
	{/if}
	{#if listOpen}
		<ReviewComments entries={marks.map((mark, index) => ({ id: mark.id, anchor: `标注 ${index + 1}`, body: mark.body, createdAt: mark.createdAt }))} onclose={() => listOpen = false} {ondelete} onlocate={locate} />
	{/if}
	{#if confirmingClose}
		<ReviewDialog title="放弃画笔草稿？" onclose={() => confirmingClose = false}>
			<p>当前未保存的笔画将被清除。已保存的批注不会受影响。</p>
			<div class="review-dialog-actions">
				<button class="review-button" type="button" onclick={() => confirmingClose = false}>继续编辑</button>
				<button class="review-button destructive" type="button" onclick={onclose}>放弃草稿</button>
			</div>
		</ReviewDialog>
	{/if}
</dialog>

<style>
	dialog.figure-annotator { max-width: none; max-height: none; margin: 0; padding: 0; border: 0; }
	dialog.figure-annotator::backdrop { background: #f1f4f8; }
	.zoom-controls { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
	.zoom-controls button:not(.review-fit) { width: 44px; min-height: 44px; border: 0; border-radius: 8px; background: transparent; color: var(--review-ink); font: inherit; font-size: 20px; }
	.zoom-controls output { min-width: 44px; text-align: center; font-size: 12px; color: var(--review-muted); font-variant-numeric: tabular-nums; }
	.figure-stage { display: flex; flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 16px; touch-action: pan-x pan-y; }
	/* Auto margins centre a small figure yet keep a zoomed figure scrollable from its top-left edge. */
	.figure-canvas { position: relative; flex: none; margin: auto; background: white; box-shadow: 0 2px 12px #17243b14; }
	.figure-canvas img { display: block; width: 100%; height: 100%; user-select: none; -webkit-user-select: none; pointer-events: none; }
	canvas { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; pointer-events: none; }
	canvas.painting { pointer-events: auto; touch-action: none; cursor: crosshair; }
	@media (min-width: 769px) {
		.figure-stage { padding-bottom: 100px; }
	}
</style>
