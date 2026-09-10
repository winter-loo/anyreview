<script lang="ts">
 import { onMount, tick, type Snippet } from 'svelte';
 import { fly, fade } from 'svelte/transition';
 let { title, modal = false, onclose, children, protect, keepVisible }: { protect?: () => HTMLElement | undefined; keepVisible?: () => HTMLElement | undefined; title: string; modal?: boolean; onclose: () => void; children: Snippet } = $props();
 let panel: HTMLElement;
 let heightLimit = $state(800);
 let keyboardInset = $state(0), viewportHeight = $state(800), offset = $state(0), reducedMotion = $state(false);
 let pointer: { id: number; y: number } | null = null;
 onMount(() => {
  const previousFocus = document.activeElement;
  const viewport = window.visualViewport;
  const update = () => {
   viewportHeight = viewport?.height ?? innerHeight;
   keyboardInset = Math.max(0, innerHeight - viewportHeight - (viewport?.offsetTop ?? 0));
   heightLimit = viewportHeight - 16;
   if (!modal) {
    const bottom = innerHeight - keyboardInset;
    const videoBottom = protect?.()?.getBoundingClientRect().bottom ?? 0;
    const controlsBottom = keepVisible?.()?.getBoundingClientRect().bottom ?? videoBottom;
    const belowVideo = Math.max(0, bottom - Math.max(videoBottom, viewport?.offsetTop ?? 0) - 8);
    const belowControls = bottom - controlsBottom - 8;
    heightLimit = Math.min(heightLimit, belowControls >= 200 ? belowControls : belowVideo);
    // When the keyboard occupies most of the screen, preserve an operable editor.
    if (keyboardInset > 100) heightLimit = Math.max(Math.min(220, viewportHeight - 16), heightLimit);
   }
  };
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); window.addEventListener('resize', update); window.addEventListener('scroll', update, { passive: true });
  const observer = new ResizeObserver(update); observer.observe(document.body);
  for (const element of [protect?.(), keepVisible?.()]) if (element) observer.observe(element);
  const oldOverflow = document.body.style.overflow;
  if (modal) { document.body.style.overflow = 'hidden'; void tick().then(() => panel?.focus({ preventScroll: true })); }
  return () => {
   viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); window.removeEventListener('scroll', update); observer.disconnect();
   if (modal) document.body.style.overflow = oldOverflow;
   if ((modal || panel?.contains(document.activeElement)) && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  };
 });
 function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onclose(); }
  if (modal && event.key === 'Tab') {
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
{#if modal}<button class="scrim" aria-label="关闭标注列表" tabindex="-1" onclick={onclose} transition:fade={{ duration: reducedMotion ? 0 : 140 }}></button>{/if}
<div class="drawer" class:modal class:compact={!modal && heightLimit < 280} bind:this={panel} role="dialog" aria-modal={modal} aria-label={title} tabindex="-1" style:bottom={`${keyboardInset}px`} style:max-height={`${Math.max(0, heightLimit)}px`} style:translate={`0 ${offset}px`} transition:fly={{ y: 32, duration: reducedMotion ? 0 : 180 }}>
 <button class="handle" aria-label={`下滑收起${title}`} onpointerdown={start} onpointermove={move} onpointerup={end} onpointercancel={end} onclick={onclose}><span></span></button>
 <div class="drawer-content">{@render children()}</div>
</div>
<style>
 .scrim { position:fixed; z-index:29; inset:0; width:100%; height:100%; padding:0; border:0; border-radius:0; background:rgb(15 23 42 / .28); backdrop-filter:blur(2px); }
 .drawer { position:fixed; z-index:30; inset-inline:0; display:flex; flex-direction:column; height:min(46svh,400px); border:1px solid #deded8; border-bottom:0; border-radius:22px 22px 0 0; background:#fffffd; box-shadow:0 -12px 48px rgb(0 0 0 / .14); overflow:hidden; outline:none; padding-bottom:env(safe-area-inset-bottom); }
 .drawer.modal { height:min(72svh,680px); }
 .handle { flex:none; display:grid; place-items:center; min-height:24px; width:100%; border:0; padding:0; background:transparent; touch-action:none; cursor:grab; }
 .handle span { width:36px; height:4px; border-radius:999px; background:#cecec8; }
 .handle:focus-visible { outline:2px solid #2563eb; outline-offset:-3px; }
 .drawer-content { min-height:0; flex:1; display:flex; flex-direction:column; }
 @media (prefers-reduced-motion: reduce) { .scrim { backdrop-filter:none; } }
</style>
