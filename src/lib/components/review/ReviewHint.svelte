<script lang="ts">
 let { ready = true, text, placement = 'toolbar' }: { ready?: boolean; text: string; placement?: 'toolbar' | 'document' } = $props();
 let visible = $state(true);
 $effect(() => {
  if (!ready) return;
  const timer = setTimeout(() => visible = false, 3000);
  return () => clearTimeout(timer);
 });
</script>
{#if ready && visible}
 <div class="review-gesture-hint" class:review-document-hint={placement === 'document'}>{text}</div>
{/if}
