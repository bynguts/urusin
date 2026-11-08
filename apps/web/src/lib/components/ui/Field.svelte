<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Label → kontrol → petunjuk/galat (Input/Default, Input/Focus, Input/Error). Kontrol dirender lewat
   * snippet yang menerima `describedby`; pasang ke `aria-describedby` agar petunjuk dan galat terbaca.
   */
  let {
    id,
    label,
    petunjuk,
    galat,
    aksiLabel,
    children,
  }: {
    id: string;
    label: string;
    petunjuk?: string | undefined;
    galat?: string | undefined;
    aksiLabel?: Snippet | undefined;
    children: Snippet<[{ describedby: string | undefined; invalid: boolean }]>;
  } = $props();

  const describedby = $derived(
    [petunjuk ? `${id}-petunjuk` : '', galat ? `${id}-galat` : ''].filter(Boolean).join(' ') || undefined,
  );
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-baseline justify-between gap-3">
    <label for={id} class="text-[0.9375rem] font-medium text-ink">{label}</label>
    {#if aksiLabel}{@render aksiLabel()}{/if}
  </div>
  {@render children({ describedby, invalid: Boolean(galat) })}
  {#if petunjuk}
    <p id="{id}-petunjuk" class="text-sm text-muted">{petunjuk}</p>
  {/if}
  {#if galat}
    <p id="{id}-galat" class="text-sm font-medium text-galat">{galat}</p>
  {/if}
</div>
