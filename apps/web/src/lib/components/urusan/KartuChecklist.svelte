<script lang="ts">
  import { resolve } from '$app/paths';
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';
  import TeksBertaut from '../ui/TeksBertaut.svelte';

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
  class="flex flex-col gap-2.5 rounded-[18px] border p-4 shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a] sm:p-[18px] {kurang.length
    ? 'border-[#e6d2b0] bg-[#fffcf6] dark:border-kuning-ink/40 dark:bg-kuning/30'
    : 'border-line bg-surface'}"
>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-[17px] leading-[26px] font-semibold text-ink">Dokumen untuk urusan ini</h2>
    {#if kurang.length}
      <span
        class="inline-flex items-center gap-[5px] rounded-full bg-kuning px-2.5 py-1 text-[12.5px] leading-[15px] text-kuning-ink"
        ><Icon name="kamera" class="size-3.5" />{kurang.length} perlu dilengkapi</span
      >
    {:else}
      <span
        class="inline-flex items-center gap-[5px] rounded-full bg-hijau px-2.5 py-1 text-[12.5px] leading-[15px] text-hijau-ink"
        ><Icon name="centang-bulat" class="size-3.5" />Semua siap</span
      >
    {/if}
  </div>
  <ul class="flex flex-col gap-2.5">
    {#each checklist.item as it (it.id)}
      {@const s = STATUS[it.status]}
      <li class="flex gap-2 text-base leading-6">
        <Icon name={s.ikon} class="mt-1 size-4 shrink-0 {s.kelas}" label={s.label} />
        <span class="text-card-ink">
          <TeksBertaut teks={it.label} />{#if it.alasan}<span>: <TeksBertaut teks={it.alasan} /></span>{/if}
        </span>
      </li>
    {/each}
  </ul>
  {#if kurang.length}
    <div class="flex flex-wrap items-center gap-2.5 pt-1">
      <a
        href={resolve('/dokumen')}
        class="inline-flex h-12 items-center gap-2 rounded-full bg-primer px-5 text-base leading-6 font-semibold text-primer-ink"
      >
        <Icon name="kamera" class="size-[18px]" /> Lengkapi dokumen
      </a>
      <p class="text-sm leading-[21px] text-muted">Tips: foto di tempat terang, keempat sudut terlihat.</p>
    </div>
  {/if}
</section>
