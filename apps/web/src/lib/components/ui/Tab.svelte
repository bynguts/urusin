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

<div role="tablist" aria-label={label} class="flex gap-1 rounded-2xl bg-bg-2 p-1">
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
      class="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-[0.9375rem] transition-colors {pilih
        ? 'bg-surface font-semibold text-ink shadow-lembut'
        : 'text-body hover:text-ink'}"
    >
      {p.label}
      {#if p.jumlah !== undefined}
        <span class="rounded-md bg-bg-2 px-1.5 text-[0.75rem] font-semibold text-ink">{p.jumlah}</span>
      {/if}
    </button>
  {/each}
</div>
