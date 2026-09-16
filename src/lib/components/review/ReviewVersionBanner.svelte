<script lang="ts">
	import { onMount } from 'svelte';

	// The link is stable, so the document behind it can change while someone is reading it.
	let { token, version }: { token: string; version: string } = $props();
	let outdated = $state(false);

	onMount(() => {
		const check = async () => {
			if (outdated) return;
			try {
				const response = await fetch(`/live/${encodeURIComponent(token)}/feedback`, { cache: 'no-store' });
				if (!response.ok) return;
				const state = await response.json();
				if (typeof state?.review?.version === 'string' && state.review.version !== version) outdated = true;
			} catch { /* Offline or asleep; the next check decides. */ }
		};
		const timer = setInterval(check, 15000);
		document.addEventListener('visibilitychange', check);
		void check();
		return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
	});
</script>

{#if outdated}
	<div class="review-update" role="status">
		<span>文档已更新</span>
		<button type="button" onclick={() => location.reload()}>刷新查看</button>
	</div>
{/if}

<style>
	.review-update {
		position: fixed; z-index: 60; top: calc(8px + env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
		display: flex; align-items: center; gap: 12px; max-width: calc(100% - 24px); padding: 8px 8px 8px 16px;
		border-radius: 999px; background: #17243b; color: white; box-shadow: 0 10px 30px rgba(15, 23, 42, .3);
		font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', sans-serif;
	}
	button {
		flex: none; min-height: 36px; border: 0; border-radius: 999px; padding: 0 14px;
		background: #2563eb; color: white; font: inherit; font-weight: 700; cursor: pointer; touch-action: manipulation;
	}
	button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
</style>
