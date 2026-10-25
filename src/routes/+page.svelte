<script lang="ts">
	import { createTranslator } from '$lib/i18n/translate';
	import type { Locale } from '$lib/i18n/locales';

	let { data } = $props();
	const t = $derived(createTranslator((data as { locale: Locale }).locale));
</script>

<svelte:head>
	<title>{t('app.title')}</title>
</svelte:head>

<main class="hero">
	<p class="eyebrow">{t('home.eyebrow')}</p>
	<h1>{t('home.title')}</h1>
	<p>{t('home.description')}</p>
	<code>{t('home.command')}</code>
</main>

<style>
	.hero {
		max-width: 860px;
		margin: 0 auto;
		padding: 72px 24px;
		font-family: system-ui, sans-serif;
	}
	.eyebrow {
		color: #2563eb;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	h1 {
		font-size: clamp(2.4rem, 7vw, 5rem);
		line-height: 1;
	}
	p {
		font-size: 1.2rem;
		color: #475569;
	}
	code {
		display: inline-block;
		margin-top: 20px;
		padding: 12px 18px;
		border-radius: 8px;
		background: #e8eefc;
		color: #193782;
		font-size: 1rem;
	}
	@media (max-width: 640px) {
		.hero {
			padding: 44px 18px;
		}
		h1 {
			font-size: clamp(2.25rem, 13vw, 3.5rem);
			overflow-wrap: anywhere;
		}
		p {
			font-size: 1.05rem;
			line-height: 1.55;
		}
		code {
			min-height: 44px;
			align-items: center;
		}
	}
</style>
