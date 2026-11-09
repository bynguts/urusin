<script lang="ts">
  import type { Snippet } from 'svelte';

  /** Baris pesan pendamping: avatar 32 px di kiri, isi di kanan (App 02–09). */
  let { avatar, children }: { avatar: string; children: Snippet } = $props();
</script>

<div class="flex gap-3.5" data-pelaku="ai">
  <img
    src={avatar}
    alt=""
    width="32"
    height="32"
    class="size-8 shrink-0 rounded-full bg-mawar shadow-[0_0_1px_#0000000f,0_1px_1px_#0000000f,0_2px_4px_#0000000a] ring-[1.5px] ring-surface"
  />
  <div class="flex min-w-0 flex-1 flex-col gap-3 text-base text-ink sm:text-[17px] sm:leading-[26px]">
    {@render children()}
  </div>
</div>
