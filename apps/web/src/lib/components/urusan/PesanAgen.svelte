<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Baris pesan pendamping: avatar 32 px di kiri, isi di kanan (App 02–09). */
  let { avatar, children }: { avatar: string; children: Snippet } = $props();
</script>

<div class="flex gap-3" data-pelaku="ai">
  <img src={avatar} alt="" width="32" height="32" class="mt-0.5 size-8 shrink-0 rounded-full" />
  <div class="flex min-w-0 flex-1 flex-col gap-3 text-base text-ink">
    {@render children()}
  </div>
</div>
