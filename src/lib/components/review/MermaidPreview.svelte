<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { renderMermaid } from '$lib/markdown/mermaid';
	let { source, children }: { source: string; children: Snippet } = $props();
	let imageUrl = $state('');
	let error = $state('');
	let sourceOpen = $state(true);
	let dialog: HTMLDialogElement;
	let viewport: HTMLDivElement;
	let expandedImage = $state<HTMLImageElement>();
	let diagramWidth = $state(800);
	let diagramHeight = $state(400);
	let zoom = $state(1.5);
	const MIN_ZOOM = 0.1, MAX_ZOOM = 5;
	const pointers = new Map<number, {x:number;y:number}>();
	let dragging = $state(false);

	async function openPreview() {
		zoom = 1.5;
		dialog.showModal();
		await tick();
		viewport.scrollTo(0, 0);
	}
	function closePreview() { pointers.clear(); dragging = false; dialog.close(); }
	async function zoomAt(next: number, x?: number, y?: number) {
		if (!viewport || !expandedImage) return;
		const area = viewport.getBoundingClientRect();
		x ??= area.left + area.width / 2;
		y ??= area.top + area.height / 2;
		const before = expandedImage.getBoundingClientRect();
		const px = (x - before.left) / before.width, py = (y - before.top) / before.height;
		zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
		await tick();
		if (!expandedImage || !dialog.open) return;
		const after = expandedImage.getBoundingClientRect();
		viewport.scrollLeft += after.left + px * after.width - x;
		viewport.scrollTop += after.top + py * after.height - y;
	}
	async function fitDiagram() {
		zoom = Math.max(MIN_ZOOM, Math.min(1.5, (viewport.clientWidth - 48) / diagramWidth, (viewport.clientHeight - 48) / diagramHeight));
		await tick();
		viewport.scrollTo(0, 0);
	}
	function pointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		viewport.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, {x:event.clientX,y:event.clientY});
		dragging = true;
	}
	function pointerMove(event: PointerEvent) {
		const previous = pointers.get(event.pointerId);
		if (!previous) return;
		const old = [...pointers.values()];
		pointers.set(event.pointerId, {x:event.clientX,y:event.clientY});
		if (pointers.size === 1) {
			viewport.scrollLeft -= event.clientX - previous.x;
			viewport.scrollTop -= event.clientY - previous.y;
		} else if (pointers.size === 2) {
			const [a,b] = [...pointers.values()], [pa,pb] = old;
			const distance = Math.hypot(pa.x-pb.x,pa.y-pb.y);
			const x = (a.x+b.x)/2, y = (a.y+b.y)/2;
			viewport.scrollLeft -= x - (pa.x+pb.x)/2;
			viewport.scrollTop -= y - (pa.y+pb.y)/2;
			if (distance > 0) void zoomAt(zoom * Math.hypot(a.x-b.x,a.y-b.y)/distance,x,y);
		}
	}
	function pointerEnd(event: PointerEvent) { pointers.delete(event.pointerId); dragging = pointers.size > 0; }

	$effect(() => {
		const code = source;
		let disposed = false;
		let url = '';
		imageUrl = '';
		error = '';
		sourceOpen = true;
		renderMermaid(code).then(svg => {
			if (disposed) return;
			const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
			const bounds = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
			if (bounds?.length === 4 && bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0) {
				diagramWidth = bounds[2]; diagramHeight = bounds[3];
			}
			// An image isolates SVG content and keeps diagram text out of annotation offsets.
			url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
			imageUrl = url;
			sourceOpen = false;
		}).catch(reason => {
			if (!disposed) error = reason instanceof Error ? reason.message : '无法解析图表';
		});
		return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
	});
</script>

<div class="diagram-preview">
	{#if imageUrl}
		<div class="diagram-scroll"><img src={imageUrl} alt="Mermaid 图表" /></div>
		<button class="expand-button" type="button" aria-label="放大查看" title="放大查看" onclick={openPreview}>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />
			</svg>
		</button>
	{:else if error}
		<p role="status">图表渲染失败：{error}</p>
	{:else}
		<p role="status">正在渲染图表…</p>
	{/if}
	<details bind:open={sourceOpen}>
		<summary>Source · 源码</summary>
		{@render children()}
	</details>
</div>
<dialog bind:this={dialog} aria-label="放大查看 Mermaid 图表" onclose={() => { pointers.clear(); dragging = false; }}>
	<div class="viewer-header">
		<strong>流程图预览</strong>
		<button class="close-button" type="button" aria-label="关闭图表预览" title="关闭" onclick={closePreview}>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
		</button>
	</div>
	<div class="viewer-tools" role="toolbar" aria-label="图表缩放">
		<button type="button" aria-label="缩小图表" disabled={zoom <= MIN_ZOOM} onclick={() => zoomAt(zoom / 1.25)}>−</button>
		<output aria-label="当前缩放比例">{Math.round(zoom * 100)}%</output>
		<button type="button" aria-label="放大图表" disabled={zoom >= MAX_ZOOM} onclick={() => zoomAt(zoom * 1.25)}>+</button>
		<button type="button" onclick={fitDiagram}>查看全图</button>
		<button type="button" onclick={() => zoomAt(1.5)}>清晰阅读</button>
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_static_element_interactions -->
	<div class="expanded" class:dragging bind:this={viewport} tabindex="0" role="region" aria-label="图表画布，可拖动或双指缩放"
		onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerEnd} onpointercancel={pointerEnd} onlostpointercapture={pointerEnd}>
		{#if imageUrl}
			<div class="diagram-canvas" style:width={`max(100%, ${diagramWidth * zoom + 48}px)`} style:height={`max(100%, ${diagramHeight * zoom + 48}px)`}>
				<img bind:this={expandedImage} src={imageUrl} alt="Mermaid 图表放大预览" draggable="false" style:width={`${diagramWidth * zoom}px`} style:height={`${diagramHeight * zoom}px`} />
			</div>
		{/if}
	</div>
	<p class="viewer-hint">拖动查看 · 双指缩放 · 可用 + / − 调整大小</p>
</dialog>

<style>
	.diagram-preview { position: relative; margin: 1em 0; padding: 12px; border: 1px solid #deded8; border-radius: 9px; background: white; min-width: 0; }
	.diagram-scroll { overflow: auto; }
	.expand-button { position: absolute; z-index: 1; top: 8px; right: 8px; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; margin: 0; background: white; }
	.expand-button:hover, .close-button:hover { background: #f0f0ed; }
	.expand-button:focus-visible, .close-button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
	.diagram-scroll img { display: block; width: 100%; min-width: 600px; height: auto; }
	button { padding: 8px 12px; margin: 8px 0; border: 1px solid #d3d3cc; border-radius: 6px; background: #f7f7f5; color: #171717; cursor: pointer; }
	summary { padding: 10px 0; cursor: pointer; }
	p { overflow-wrap: anywhere; }
	dialog { box-sizing:border-box; width:calc(100vw - 40px); max-width:1600px; height:calc(100dvh - 40px); max-height:none; padding:0; border:1px solid #d3d3cc; border-radius:14px; background:white; overflow:hidden; }
	dialog[open] { display:flex; flex-direction:column; }
	dialog::backdrop { background:#0009; }
	.viewer-header { display:flex; align-items:center; justify-content:space-between; flex:none; padding:8px 12px; border-bottom:1px solid #e5e5e0; }
	.close-button { display:grid; place-items:center; width:44px; height:44px; margin:0; padding:0; background:transparent; border-color:transparent; }
	.viewer-tools { display:flex; align-items:center; justify-content:center; flex:none; gap:6px; padding:8px; border-bottom:1px solid #e5e5e0; }
	.viewer-tools button { min-width:44px; min-height:44px; padding:0 10px; margin:0; font-size:14px; white-space:nowrap; }
	.viewer-tools button:disabled { opacity:.4; cursor:default; }
	.viewer-tools output { min-width:48px; text-align:center; font:13px ui-sans-serif,system-ui,sans-serif; font-variant-numeric:tabular-nums; }
	.viewer-tools button:focus-visible, .expanded:focus-visible { outline:2px solid #2563eb; outline-offset:-2px; }
	.expanded { flex:1; min-height:0; overflow:auto; touch-action:none; overscroll-behavior:contain; cursor:grab; background:#f4f5f7; }
	.expanded.dragging { cursor:grabbing; }
	.diagram-canvas { display:grid; place-items:center; box-sizing:border-box; padding:24px; }
	.expanded img { display:block; max-width:none; user-select:none; -webkit-user-select:none; }
	.viewer-hint { flex:none; margin:0; padding:10px 8px; font-size:12px; text-align:center; color:#64646b; border-top:1px solid #e5e5e0; }
	@media (max-width:640px) {
		dialog { width:100%; max-width:100%; height:100dvh; max-height:100dvh; margin:0; border:0; border-radius:0; }
		.viewer-header { padding-top:calc(8px + env(safe-area-inset-top)); }
		.viewer-hint { padding-bottom:calc(10px + env(safe-area-inset-bottom)); }
		.viewer-tools { gap:4px; }
		.viewer-tools button { padding-inline:8px; }
	}
</style>
