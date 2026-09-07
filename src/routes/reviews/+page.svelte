<script lang="ts">
	import { createTranslator } from '$lib/i18n/translate';
	import type { Locale } from '$lib/i18n/locales';

	let { data } = $props();
	const t = $derived(createTranslator((data as typeof data & { locale: Locale }).locale));
</script>

<svelte:head>
	<title>{t('reviews.pageTitle')}</title>
</svelte:head>

<main class="page">
	<header>
		<p class="eyebrow">{t('reviews.eyebrow')}</p>
		<h1>{t('reviews.title')}</h1>
		<p>{t('reviews.description')}</p>
	</header>

	{#if data.reviews.length === 0}
		<section class="empty">
			<h2>{t('reviews.emptyTitle')}</h2>
			<pre>reviewctl publish --repo &lt;git-root&gt; --range 'HEAD~4...HEAD' --title 'my review'</pre>
		</section>
	{:else}
		<ul class="reviews">
			{#each data.reviews as review}
				{@const href = `/reviews/${review.id}`}
				<li>
					<a href={href}>
						<strong>{review.title}</strong>
						<span>{review.id} · {review.status} · {review.sourceKind}{review.sourceRef ? ` ${review.sourceRef}` : ''}</span>
						<code>{review.repoRoot}</code>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.page {
		max-width: 980px;
		margin: 0 auto;
		padding: 48px 24px;
		font-family: system-ui, sans-serif;
	}
	.eyebrow {
		color: #2563eb;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.reviews {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	.reviews a,
	.empty {
		display: grid;
		gap: 8px;
		border: 1px solid #dbe3ef;
		border-radius: 12px;
		padding: 16px;
		color: inherit;
		text-decoration: none;
		background: #fff;
	}
	.reviews span,
	code {
		color: #64748b;
	}
	pre {
		overflow: auto;
		padding: 12px;
		border-radius: 8px;
		background: #0f172a;
		color: #e2e8f0;
	}
	@media (max-width: 640px) {
		.page {
			padding: 28px 12px;
		}
		h1 {
			font-size: 2rem;
			line-height: 1.1;
		}
		.reviews a,
		.empty {
			padding: 14px;
		}
		.reviews a {
			min-height: 44px;
		}
		.reviews strong,
		.reviews span,
		.reviews code {
			overflow-wrap: anywhere;
		}
		pre {
			font-size: 0.78rem;
		}
	}
</style>
