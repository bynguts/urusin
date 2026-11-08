<script lang="ts">
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';
  import Chip, { type Nada } from '../ui/Chip.svelte';
  import type { NamaIkon } from '../ikon.js';

  /**
   * Kartu rencana (App 03): langkah bernomor dengan label pelaku (Anda/AI/Instansi), kelayakan, dan tombol
   * Setujui rencana / Ubah. Tombol hanya aktif pada kartu terakhir saat rencana menunggu persetujuan.
   */
  let {
    rencana,
    kelayakan,
    bisaSetujui,
    sibuk = false,
    onsetujui,
    onubah,
  }: {
    rencana: EventOf<'plan_card'>;
    kelayakan: EventOf<'eligibility'> | null;
    bisaSetujui: boolean;
    sibuk?: boolean;
    onsetujui: () => void;
    onubah: () => void;
  } = $props();

  const PELAKU: Record<string, { label: string; nada: Nada; ikon: NamaIkon }> = {
    'online-adapter': { label: 'AI', nada: 'ai', ikon: 'ai' },
    'online-manual': { label: 'Anda', nada: 'anda', ikon: 'orang' },
    offline: { label: 'Instansi', nada: 'instansi', ikon: 'instansi' },
  };
</script>

<section
  aria-label="Rencana {rencana.langkah.length} langkah"
  class="overflow-hidden rounded-2xl border border-line bg-surface shadow-lembut"
>
  <header class="flex flex-wrap items-center gap-3 border-b border-line-3 bg-card px-4 py-3.5 sm:px-5">
    <Icon name="rencana" class="size-5" />
    <h3 class="flex-1 text-base font-semibold text-ink">Rencana · {rencana.langkah.length} langkah</h3>
    {#if kelayakan && kelayakan.mungkin.length && !kelayakan.perluKonfirmasi.length}
      <Chip nada="hijau" ikon="centang-bulat">Kemungkinan memenuhi syarat</Chip>
    {:else if kelayakan && kelayakan.perluKonfirmasi.length}
      <Chip nada="kuning" ikon="info">Perlu konfirmasi</Chip>
    {/if}
  </header>
  <ol class="flex flex-col gap-1 px-4 py-3 sm:px-5">
    {#each rencana.langkah as l, i (l.id)}
      {@const p = PELAKU[l.jenis] ?? PELAKU['online-manual']!}
      <li class="flex min-h-11 items-center gap-3">
        <span
          class="grid size-6 shrink-0 place-items-center rounded-full border border-line-2 text-[0.75rem] font-semibold"
          >{i + 1}</span
        >
        <span class="min-w-0 flex-1 text-[0.9375rem] text-ink">{l.judul}</span>
        <Chip nada={p.nada} ikon={p.ikon}>{p.label}</Chip>
      </li>
    {/each}
  </ol>
  {#if kelayakan?.perluKonfirmasi.length}
    <div class="border-t border-line-3 px-4 py-3 text-sm text-body sm:px-5">
      <p class="font-semibold text-ink">Perlu dipastikan dulu:</p>
      <ul class="mt-1 list-disc pl-5">
        {#each kelayakan.perluKonfirmasi as k (k)}<li>{k}</li>{/each}
      </ul>
    </div>
  {/if}
  {#if bisaSetujui}
    <footer class="flex flex-wrap items-center gap-3 border-t border-line-3 px-4 py-3.5 sm:px-5">
      <button
        type="button"
        onclick={onsetujui}
        disabled={sibuk}
        aria-busy={sibuk || undefined}
        class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-5 text-base font-semibold text-primer-ink hover:opacity-90 disabled:opacity-80"
      >
        <Icon name={sibuk ? 'memuat' : 'centang'} class="size-4.5 {sibuk ? 'animate-spin' : ''}" />
        Setujui rencana
      </button>
      <button
        type="button"
        onclick={onubah}
        class="inline-flex min-h-12 items-center rounded-full border border-line-2 bg-surface px-5 text-base text-ink hover:bg-card"
        >Ubah</button
      >
      <p class="text-sm text-muted">Belum ada data yang dikirim.</p>
    </footer>
  {/if}
</section>
