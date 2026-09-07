<script lang="ts">
 import closeIcon from '$lib/assets/review-icons/close.svg?url';
 import { onMount, type Snippet } from 'svelte';
 import { reviewViewport } from '$lib/review/visualViewport';
 let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
 let dialog: HTMLDialogElement;
 let heading: HTMLHeadingElement;
 onMount(() => {
  const previous = document.activeElement as HTMLElement | null;
  dialog.showModal();
  heading.focus({ preventScroll: true });
  return () => { dialog.close(); previous?.focus({ preventScroll: true }); };
 });
</script>
<dialog aria-label={title} class="review-dialog" bind:this={dialog} use:reviewViewport oncancel={(e) => { e.preventDefault(); onclose(); }} onclick={(e) => { if (e.target === dialog) { const r=dialog.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) onclose(); } }} onkeydown={(e) => e.stopPropagation()}>
 <div class="review-dialog-heading">
  <h2 tabindex="-1" bind:this={heading}>{title}</h2>
  <button class="review-icon-button" type="button" aria-label="关闭" onclick={onclose}><img src={closeIcon} alt="" width="20" height="20" /></button>
 </div>
 {@render children()}
</dialog>
