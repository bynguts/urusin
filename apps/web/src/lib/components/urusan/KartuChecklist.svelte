<script lang="ts">
  import { resolve } from '$app/paths';
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';
  import Chip from '../ui/Chip.svelte';

  /**
   * Hasil cek berkas (App 04): hijau/kuning/merah selalu dengan ikon + alasan dalam bahasa awam, lalu satu aksi
   * untuk melengkapi dari Dokumen.
   */
  let { checklist }: { checklist: EventOf<'checklist'> } = $props();

  const kurang = $derived(checklist.item.filter((i) => i.status !== 'ok'));
  const STATUS = {
    ok: { ikon: 'centang-bulat', kelas: 'text-hijau-ink', label: 'Siap' },
    perlu: { ikon: 'jam', kelas: 'text-kuning-ink', label: 'Perlu disiapkan' },
    kurang: { ikon: 'peringatan', kelas: 'text-galat', label: 'Perlu diulang' },
  } as const;
</script>

<section
  aria-label="Dokumen untuk urusan ini"
  class="rounded-2xl border p-4 sm:p-5 {kurang.length
    ? 'border-kuning bg-kuning/40'
    : 'border-line bg-surface'}"
>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 class="text-base font-semibold text-ink">Dokumen untuk urusan ini</h3>
    {#if kurang.length}
      <Chip nada="kuning" ikon="kamera">{kurang.length} perlu dilengkapi</Chip>
    {:else}
      <Chip nada="hijau" ikon="centang-bulat">Semua siap</Chip>
    {/if}
  </div>
  <ul class="mt-3 flex flex-col gap-2.5">
    {#each checklist.item as it (it.id)}
      {@const s = STATUS[it.status]}
      <li class="flex gap-2.5 text-[0.9375rem]">
        <Icon name={s.ikon} class="mt-0.5 size-5 shrink-0 {s.kelas}" label={s.label} />
        <span class="text-ink">
          {it.label}{#if it.alasan}<span class="text-body">: {it.alasan}</span>{/if}
        </span>
      </li>
    {/each}
  </ul>
  {#if kurang.length}
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <a
        href={resolve('/dokumen')}
        class="inline-flex min-h-12 items-center gap-2 rounded-full bg-primer px-5 font-semibold text-primer-ink hover:opacity-90"
      >
        <Icon name="kamera" class="size-4.5" /> Lengkapi dokumen
      </a>
      <p class="text-sm text-muted">Tips: foto di tempat terang, keempat sudut terlihat.</p>
    </div>
  {/if}
</section>
