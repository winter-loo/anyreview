<script lang="ts">
	import { strokePath, type Point, type Stroke } from '$lib/review/strokes';

	type Mark = { id: string; strokes: Stroke[]; badgePosition: Point; body: string };
	let { marks, selected = null, onselect }: { marks: Mark[]; selected?: string | null; onselect: (id: string) => void } = $props();
</script>

<!-- Fills a positioned parent that has exactly the figure's box; coordinates are normalized to it. -->
<div class="figure-marks">
	<svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
		{#each marks as mark (mark.id)}
			<g class:selected={selected === mark.id}>
				{#each mark.strokes as stroke}
					<path d={strokePath(stroke.points)} stroke={stroke.color} stroke-width={stroke.size} vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" fill="none" />
				{/each}
			</g>
		{/each}
	</svg>
	{#each marks as mark, index (mark.id)}
		{@const color = mark.strokes[0]?.color ?? '#e54b4b'}
		<button
			class="figure-badge"
			class:selected={selected === mark.id}
			type="button"
			style:left={`${mark.badgePosition.x * 100}%`}
			style:top={`${mark.badgePosition.y * 100}%`}
			style:background={color}
			style:color={color.toLowerCase() === '#ffffff' ? '#17243b' : 'white'}
			aria-label={`标注 ${index + 1}${mark.body ? `：${mark.body}` : ''}`}
			onclick={() => onselect(mark.id)}
		>{index + 1}</button>
	{/each}
</div>

<style>
	.figure-marks { position: absolute; inset: 0; pointer-events: none; }
	svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
	g.selected path { filter: drop-shadow(0 0 4px #2563eb); }
	.figure-badge {
		position: absolute; display: grid; place-items: center; width: 28px; height: 28px; min-height: 0; margin: -14px 0 0 -14px; padding: 0;
		border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 8px #17243b40;
		font: 700 12px/1 system-ui, sans-serif; cursor: pointer; pointer-events: auto; touch-action: manipulation;
	}
	/* Enlarge the touch target without enlarging the visual marker. */
	.figure-badge::after { content: ''; position: absolute; inset: -8px; }
	.figure-badge.selected { outline: 3px solid #2563eb; outline-offset: 1px; }
	.figure-badge:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
</style>
