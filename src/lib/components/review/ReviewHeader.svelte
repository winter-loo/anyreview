<script lang="ts">
 import moreIcon from '$lib/assets/review-icons/more.svg?url';
 import type { Snippet } from 'svelte';
 import ReviewDialog from './ReviewDialog.svelte';
 let { filename, actions, children, hasDraft = false, ondiscard }: { filename: string; actions: { label: string; run: () => void; disabled?: boolean }[]; children?: Snippet; hasDraft?: boolean; ondiscard?: () => void } = $props();
 let menu = $state(false);
 let discard = $state(false);
</script>
<header class="review-header">
 <div class="review-file-identity"><strong title={filename}>{filename}</strong></div>
 <button class="review-icon-button" type="button" aria-label="更多" aria-haspopup="dialog" onclick={() => menu = true}><img src={moreIcon} alt="" width="20" height="20" /></button>
</header>
{#if children}<div class="review-context">{@render children()}</div>{/if}
{#if menu}
 <ReviewDialog title="更多" onclose={() => menu = false}>
  <p class="review-context-label full-filename">{filename}</p>
  <div class="review-menu-actions">
   {#each actions as action}<button type="button" disabled={action.disabled} onclick={() => { menu = false; action.run(); }}>{action.label}<span aria-hidden="true">→</span></button>{/each}
   {#if hasDraft && ondiscard}<button type="button" class="danger" onclick={() => { menu = false; discard = true; }}>放弃画笔草稿</button>{/if}
  </div>
  <button class="review-button" type="button" onclick={() => menu = false}>关闭</button>
 </ReviewDialog>
{/if}
{#if discard}
 <ReviewDialog title="放弃画笔草稿？" onclose={() => discard = false}>
  <p>当前未保存的笔画将被清除。已保存的批注不会受影响。</p>
  <div class="review-dialog-actions"><button class="review-button" type="button" onclick={() => discard = false}>继续编辑</button><button class="review-button destructive" type="button" onclick={() => { ondiscard?.(); discard = false; }}>放弃草稿</button></div>
 </ReviewDialog>
{/if}
