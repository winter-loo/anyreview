<script lang="ts">
 import ReviewDialog from './ReviewDialog.svelte';
 let { context, body = $bindable(''), onsave, onclose, brush = true, quote = '' }: { context: string; body?: string; onsave: () => void; onclose: () => void; brush?: boolean; quote?: string } = $props();
</script>
<ReviewDialog title="添加批注" {onclose}>
 <p class="review-context-label">{context}</p>
 {#if quote}<blockquote class="review-quote">{quote}</blockquote>{/if}
 <textarea class="review-comment-input" aria-label="批注内容" bind:value={body} placeholder={brush ? '添加意见（选填）' : '写下你的评审意见…'} rows="4" onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (brush || body.trim())) { e.preventDefault(); onsave(); } }}></textarea>
 <p class="review-input-hint">{brush ? '可留空，仅保存画笔标记' : '批注将关联到所选内容'}</p>
 <div class="review-dialog-actions">
  <button class="review-button" type="button" onclick={onclose}>{brush ? '继续画' : '返回'}</button>
  <button class="review-button primary" type="button" disabled={!brush && !body.trim()} onclick={onsave}>保存批注</button>
 </div>
</ReviewDialog>
