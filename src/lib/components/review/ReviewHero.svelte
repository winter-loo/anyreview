<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		eyebrow,
		title,
		meta = [],
		codeText,
		children
	}: {
		eyebrow: string;
		title: string;
		meta?: string[];
		codeText?: string | null;
		children?: Snippet;
	} = $props();
</script>

<header class="review-hero">
	<p class="eyebrow">{eyebrow}</p>
	<h1>{title}</h1>
	{#if meta.length > 0}
		<div class="meta">
			{#each meta as item}
				<span>{item}</span>
			{/each}
		</div>
	{/if}
	{#if codeText}
		<code>{codeText}</code>
	{/if}
	{@render children?.()}
</header>

<style>
	.review-hero {
		margin-top: 20px;
		padding: 26px;
		border: 1px solid #e2e8f0;
		border-radius: 24px;
		background: linear-gradient(135deg, #ffffff, #f8fafc);
		box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
	}
	.eyebrow {
		margin: 0 0 8px;
		color: #2563eb;
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		font-size: clamp(30px, 5vw, 52px);
		line-height: 1;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 16px;
		color: #475569;
		font-size: 14px;
	}
	.meta span {
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		padding: 6px 10px;
		background: #fff;
	}
	code {
		display: block;
		margin-top: 16px;
		overflow-wrap: anywhere;
		color: #475569;
	}
	@media (max-width: 640px) {
		.review-hero {
			margin-top: 12px;
			padding: 18px;
			border-radius: 18px;
			box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
		}
		h1 {
			font-size: clamp(28px, 9vw, 38px);
			line-height: 1.08;
			overflow-wrap: anywhere;
		}
		.meta {
			gap: 7px;
			margin-top: 12px;
			font-size: 13px;
		}
		.meta span {
			padding: 5px 8px;
		}
		code {
			margin-top: 12px;
			font-size: 13px;
		}
	}
</style>
