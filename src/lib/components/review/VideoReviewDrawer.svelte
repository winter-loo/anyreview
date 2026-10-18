<script lang="ts">
 import { onMount, tick, type Snippet } from 'svelte';
 import { fly, fade } from 'svelte/transition';
 let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
 let panel: HTMLElement;
 let offset = $state(0), reducedMotion = $state(false);
 let pointer: { id: number; y: number } | null = null;
 onMount(() => {
  const previousFocus = document.activeElement;
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const oldOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden'; void tick().then(() => panel?.focus({ preventScroll: true }));
  return () => {
   document.body.style.overflow = oldOverflow;
   if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  };
 });
 function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onclose(); }
  if (event.key === 'Tab') {
   const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, select, [tabindex="0"]')];
   const first = focusable[0], last = focusable.at(-1);
   if (!first || !last) { event.preventDefault(); return; }
   if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
   else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
  }
 }
 function start(event: PointerEvent) { pointer = { id: event.pointerId, y: event.clientY }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
 function move(event: PointerEvent) { if (pointer?.id === event.pointerId) offset = Math.max(0, event.clientY - pointer.y); }
 function end(event: PointerEvent) { if (pointer?.id !== event.pointerId) return; if (offset > 70 && event.type !== 'pointercancel') onclose(); pointer = null; offset = 0; }
</script>
<svelte:window onkeydown={keydown} />
<button class="scrim" aria-label={`关闭${title}`} tabindex="-1" onclick={onclose} transition:fade={{ duration: reducedMotion ? 0 : 140 }}></button>
<div class="drawer" bind:this={panel} role="dialog" aria-modal="true" aria-label={title} tabindex="-1" style:translate={`0 ${offset}px`} transition:fly={{ y: 32, duration: reducedMotion ? 0 : 180 }}>
 <button class="handle" aria-label={`下滑收起${title}`} onpointerdown={start} onpointermove={move} onpointerup={end} onpointercancel={end} onclick={onclose}><span></span></button>
 <div class="drawer-content">{@render children()}</div>
</div>
<style>
 .scrim { position:fixed; z-index:29; inset:0; width:100%; height:100%; padding:0; border:0; border-radius:0; background:rgb(15 23 42 / .28); backdrop-filter:blur(2px); }
 .drawer { position:fixed; z-index:30; inset-inline:0; bottom:0; display:flex; flex-direction:column; height:min(72svh,680px); border:1px solid #deded8; border-bottom:0; border-radius:22px 22px 0 0; background:#fffffd; box-shadow:0 -12px 48px rgb(0 0 0 / .14); overflow:hidden; outline:none; padding-bottom:env(safe-area-inset-bottom); }
 .handle { flex:none; display:grid; place-items:center; min-height:24px; width:100%; border:0; padding:0; background:transparent; touch-action:none; cursor:grab; }
 .handle span { width:36px; height:4px; border-radius:999px; background:#cecec8; }
 .handle:focus-visible { outline:2px solid #2563eb; outline-offset:-3px; }
 .drawer-content { min-height:0; flex:1; display:flex; flex-direction:column; }
 @media (prefers-reduced-motion: reduce) { .scrim { backdrop-filter:none; } }
</style>
