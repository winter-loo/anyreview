<script lang="ts">
 import closeIcon from '$lib/assets/review-icons/close.svg?url';
 import commentsIcon from '$lib/assets/review-icons/comments.svg?url';
 import type { Snippet } from 'svelte';
 let { entries, onclose, ondelete, onlocate, children }: { entries: { id:string; anchor:string; body:string; createdAt:string; quote?:string }[]; onclose:()=>void; ondelete:(id:string)=>void; onlocate:(id:string)=>void; children?:Snippet }=$props();
</script>
<aside class="review-comments" aria-label="批注列表">
 <div class="review-comments-heading"><h2>批注 <span>{entries.length}</span></h2><button class="review-icon-button" type="button" aria-label="关闭批注列表" onclick={onclose}><img src={closeIcon} alt="" width="20" height="20" /></button></div>
 {#if children}<div class="review-comments-filter">{@render children()}</div>{/if}
 <div class="review-comments-list">
  {#if !entries.length}<div class="review-empty"><img src={commentsIcon} alt="" width="28" height="28" /><h3>还没有批注</h3><p>用画笔圈出重点，或选择文档内容添加意见。</p></div>{/if}
  {#each [...entries].reverse() as entry (entry.id)}
   <article class="review-comment-card"><div class="review-comment-anchor">{entry.anchor}</div>{#if entry.quote}<blockquote>{entry.quote}</blockquote>{/if}<p>{entry.body || '画笔标注 · 未添加文字意见'}</p><time datetime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time><div class="review-comment-actions"><button type="button" onclick={() => onlocate(entry.id)}>定位到标注 →</button><button class="review-comment-delete" type="button" aria-label={`删除 ${entry.anchor} 批注`} onclick={() => ondelete(entry.id)}>删除</button></div></article>
  {/each}
 </div>
</aside>
