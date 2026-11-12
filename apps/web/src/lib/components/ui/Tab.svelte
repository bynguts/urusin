<script lang="ts" generics="T extends string">
  /**
   * Segmented tab (Rencana / Dokumen / Sumber; Berkas / Data diri): pola ARIA tabs, panah kiri/kanan berpindah.
   * Panel dirender pemanggil dengan id `${idDasar}-panel-${nilai}`.
   */
  let {
    pilihan,
    nilai = $bindable(),
    idDasar,
    label,
  }: {
    pilihan: readonly { nilai: T; label: string; jumlah?: number | undefined }[];
    nilai: T;
    idDasar: string;
    label: string;
  } = $props();

  let tombol: HTMLButtonElement[] = $state([]);

  function tekan(e: KeyboardEvent, i: number) {
    const arah = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!arah) return;
    e.preventDefault();
    const j = (i + arah + pilihan.length) % pilihan.length;
    nilai = pilihan[j]!.nilai;
    tombol[j]?.focus();
  }
</script>

<div role="tablist" aria-label={label} class="flex gap-1 rounded-[14px] bg-bg-2 p-1">
  {#each pilihan as p, i (p.nilai)}
    {@const pilih = p.nilai === nilai}
    <button
      bind:this={tombol[i]}
      type="button"
      role="tab"
      id="{idDasar}-tab-{p.nilai}"
      aria-selected={pilih}
      aria-controls="{idDasar}-panel-{p.nilai}"
      tabindex={pilih ? 0 : -1}
      onclick={() => (nilai = p.nilai)}
      onkeydown={(e) => tekan(e, i)}
      class="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[15px] leading-5 {pilih
        ? 'bg-surface font-semibold text-ink shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]'
        : 'text-card-ink hover:text-ink'}"
    >
      {p.label}
      {#if p.jumlah !== undefined}
        <span class="rounded-full bg-bg-2 px-1.5 py-px text-xs leading-4 font-semibold text-card-ink"
          >{p.jumlah}</span
        >
      {/if}
    </button>
  {/each}
</div>
