<script lang="ts">
 import LiveMarkdownReview from '$lib/components/review/LiveMarkdownReview.svelte';
 import LiveImageReview from '$lib/components/review/LiveImageReview.svelte';
 import LivePdfReview from '$lib/components/review/LivePdfReview.svelte';
 import LiveWordReview from '$lib/components/review/LiveWordReview.svelte';
 import LivePptReview from '$lib/components/review/LivePptReview.svelte';
 import LiveExcelReview from '$lib/components/review/LiveExcelReview.svelte';
 let {data} = $props();
</script>
<svelte:head><title>{data.kind === 'image' ? (data.images[0]?.filename ?? '图片评审') : data.filename} · Live Review</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
{#key data.token}
 {#if data.kind === 'markdown'}<LiveMarkdownReview {data} />
 {:else if data.kind === 'image'}<LiveImageReview {data} />
 {:else if data.kind === 'pdf'}<LivePdfReview {data} />
 {:else if data.kind === 'word' || data.kind === 'html'}<LiveWordReview {data} />
 {:else if data.kind === 'ppt'}<LivePptReview {data} />
 {:else if data.kind === 'excel'}<LiveExcelReview {data} />{/if}
{/key}
