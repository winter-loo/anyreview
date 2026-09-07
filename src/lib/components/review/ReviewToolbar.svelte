<script lang="ts">
 import ReviewHint from './ReviewHint.svelte';
 import browseIcon from '$lib/assets/review-icons/browse.svg?url';
 import checkIcon from '$lib/assets/review-icons/check.svg?url';
 import commentsIcon from '$lib/assets/review-icons/comments.svg?url';
 import paintIcon from '$lib/assets/review-icons/paint.svg?url';
 import undoIcon from '$lib/assets/review-icons/undo.svg?url';
 let { paint, color = $bindable(), size = $bindable(), colors, sizes, count, draftCount, comments, onbrowse, onpaint, oncomments, onfinish, onundo, disabled = false }: {
  paint: boolean; color: string; size: number; colors: { name: string; value: string }[]; sizes: { name: string; value: number }[];
  count: number; draftCount: number; comments: boolean; disabled?: boolean; onbrowse: () => void; onpaint: () => void; oncomments: () => void; onfinish: () => void; onundo: () => void;
 } = $props();
</script>
<div class="review-tools">
 <ReviewHint ready={!disabled} text="单指画线 · 双指移动 / 缩放画布" />
 {#if paint && !comments}
  <div class="review-paint-panel" role="toolbar" aria-label="画笔工具栏">
   <div class="review-paint-heading"><strong>画笔 <span>{draftCount ? `${draftCount} 笔` : ''}</span></strong><button class="review-button primary" type="button" disabled={!draftCount} onclick={onfinish}>完成</button></div>
   <div class="review-colors">{#each colors as item}<button type="button" class:selected={color===item.value} style:background={item.value} aria-label={item.name} aria-pressed={color===item.value} onclick={() => color=item.value}>{#if color===item.value}<img src={checkIcon} alt="" width="24" height="24" />{/if}</button>{/each}</div>
   <div class="review-strokes"><div class="review-sizes">{#each sizes as item}<button type="button" class:selected={size===item.value} aria-label={`${item.name}画笔`} aria-pressed={size===item.value} onclick={() => size=item.value}>{item.name}</button>{/each}</div><button class="review-undo" type="button" disabled={!draftCount} onclick={onundo}><img src={undoIcon} alt="" width="20" height="20" />撤销</button></div>
  </div>
 {/if}
 <nav class="review-dock" aria-label="审阅工具">
  <button type="button" class:selected={!paint && !comments} aria-pressed={!paint && !comments} onclick={onbrowse}><img src={browseIcon} alt="" width="20" height="20" />浏览</button>
  <button type="button" class:selected={paint && !comments} aria-pressed={paint && !comments} {disabled} onclick={onpaint}><img src={paintIcon} alt="" width="20" height="20" />画笔{#if draftCount && !paint}<span class="review-draft-dot" aria-label="有未保存草稿"></span>{/if}</button>
  <button type="button" class:selected={comments} aria-pressed={comments} onclick={oncomments}><img src={commentsIcon} alt="" width="20" height="20" />批注 <span>{count}</span></button>
 </nav>
</div>
