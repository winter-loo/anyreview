<script lang="ts">
	import type { Snippet } from 'svelte';
	import { renderMermaid } from '$lib/markdown/mermaid';
	let { source, children }: { source: string; children: Snippet } = $props();
	let imageUrl = $state('');
	let error = $state('');
	let sourceOpen = $state(true);
	let dialog: HTMLDialogElement;
	$effect(() => {
		const code = source;
		let disposed = false;
		let url = '';
		imageUrl = '';
		error = '';
		sourceOpen = true;
		renderMermaid(code).then(svg => {
			if (disposed) return;
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
		<button class="expand-button" type="button" aria-label="放大查看" title="放大查看" onclick={() => dialog.showModal()}>
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
<dialog bind:this={dialog} aria-label="放大查看 Mermaid 图表">
	<button class="close-button" type="button" aria-label="关闭" title="关闭" onclick={() => dialog.close()}>
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
			<path d="m6 6 12 12M18 6 6 18" />
		</svg>
	</button>
	{#if imageUrl}<div class="expanded"><img src={imageUrl} alt="Mermaid 图表放大预览" /></div>{/if}
</dialog>

<style>
	.diagram-preview { position: relative; margin: 1em 0; padding: 12px; border: 1px solid #deded8; border-radius: 9px; background: white; min-width: 0; }
	.diagram-scroll { overflow: auto; }
	.expand-button, .close-button { position: absolute; z-index: 1; top: 8px; right: 8px; display: grid; place-items: center; width: 40px; height: 40px; padding: 0; margin: 0; background: white; }
	.expand-button:hover, .close-button:hover { background: #f0f0ed; }
	.expand-button:focus-visible, .close-button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
	.diagram-scroll img { display: block; width: 100%; min-width: 600px; height: auto; }
	button { padding: 8px 12px; margin: 8px 0; border: 1px solid #d3d3cc; border-radius: 6px; background: #f7f7f5; color: #171717; cursor: pointer; }
	summary { padding: 10px 0; cursor: pointer; }
	p { overflow-wrap: anywhere; }
	dialog { box-sizing: border-box; width: 96vw; max-width: 1600px; max-height: 90dvh; border: 1px solid #d3d3cc; border-radius: 10px; background: white; }
	dialog::backdrop { background: #0009; }
	.expanded { overflow: auto; max-height: 72dvh; }
	.expanded img { display: block; max-width: none; min-width: 100%; height: auto; }
</style>
