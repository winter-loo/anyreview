<script lang="ts">
 import ReviewDialog from './ReviewDialog.svelte';
 let { anchor, body, createdAt, quote = '', onclose, ondelete, onall }: {
  anchor: string; body: string; createdAt: string; quote?: string;
  onclose: () => void; ondelete: () => void; onall: () => void;
 } = $props();
 let confirming = $state(false);
</script>
<ReviewDialog title={confirming ? '删除这条批注？' : '批注详情'} {onclose}>
 {#if confirming}
  <p class="review-context-label">删除后无法恢复，文档原内容不受影响。</p>
  <div class="review-dialog-actions"><button class="review-button" onclick={() => confirming=false}>保留批注</button><button class="review-button destructive" onclick={ondelete}>确认删除</button></div>
 {:else}
  <div class="review-detail-meta"><span>{anchor}</span><time datetime={createdAt}>{new Date(createdAt).toLocaleString()}</time></div>
  {#if quote}<blockquote class="review-quote">{quote}</blockquote>{/if}
  <div class="review-detail-content"><p>{body || '这条批注仅包含画笔标记，没有文字意见。'}</p></div>
  <div class="review-detail-links"><button onclick={onall}>查看全部批注</button><button class="review-delete-link" onclick={() => confirming=true}>删除批注</button></div>
  <button class="review-button primary" onclick={onclose}>返回文档</button>
 {/if}
</ReviewDialog>
