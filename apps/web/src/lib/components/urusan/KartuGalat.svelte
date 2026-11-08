<script lang="ts">
  import Icon from '../Icon.svelte';

  /** Feedback/Error: apa yang terjadi + yang bisa dilakukan + "Coba lagi". */
  let {
    pesan,
    bisaUlang,
    onulang,
  }: { pesan: string; bisaUlang: boolean; onulang?: (() => void) | undefined } = $props();
</script>

<div role="alert" class="rounded-2xl border border-galat-garis/40 bg-mawar/50 p-4 sm:p-5">
  <p class="flex gap-2.5 text-[0.9375rem] text-ink">
    <Icon name="peringatan" class="mt-0.5 size-5 shrink-0 text-galat" />
    <span>{pesan}</span>
  </p>
  {#if bisaUlang && onulang}
    <button
      type="button"
      onclick={onulang}
      class="mt-3 inline-flex min-h-12 items-center gap-2 rounded-full border border-line-2 bg-surface px-5 font-medium text-ink hover:bg-card"
    >
      <Icon name="ulang" class="size-4.5" /> Coba lagi
    </button>
  {/if}
</div>
