<script lang="ts">
  import { resolve } from '$app/paths';
  import { KELAS_WARNA, peristiwaDariJenis } from '#lib/peristiwa.js';
  import { LANGKAH_RENCANA, infoStatus, tanggal } from '#lib/urusan-status.js';
  import Icon from '../Icon.svelte';
  import type { NamaIkon } from '../ikon.js';
  import Lencana from './Lencana.svelte';
  import type { UrusanBerjalan } from './daftar.svelte.js';

  /**
   * Kartu urusan App 10: lencana + avatar 36, judul 19/600, keterangan 16, progres 5 ruas 6 px,
   * chip "siapa yang ditunggu" + satu tombol 46. Kartu utama putih bergaris gelap 1.5 px.
   */
  let { urusan, utama = false }: { urusan: UrusanBerjalan; utama?: boolean } = $props();

  const p = $derived(peristiwaDariJenis(urusan.peristiwa));
  const state = $derived(urusan.ringkasan?.state);
  const info = $derived(infoStatus(state));
  const selesai = $derived(info.langkah > 5);
  const kini = $derived(Math.max(info.langkah, 1));

  const KETERANGAN: Partial<Record<NonNullable<typeof state>, string>> = {
    BARU: 'AI sedang mencari aturan resmi',
    MEMAHAMI: 'AI sedang mencari aturan resmi',
    RENCANA_DIUSULKAN: 'Periksa rencana yang disarankan',
    TERKIRIM: 'Petugas instansi sedang memeriksa',
    DIPANTAU: 'Petugas instansi sedang memeriksa',
  };
  const keterangan = $derived(
    urusan.ringkasan
      ? urusan.ringkasan.nomorPermohonan
        ? `Nomor permohonan ${urusan.ringkasan.nomorPermohonan}`
        : (KETERANGAN[urusan.ringkasan.state] ?? info.label)
      : 'Status belum termuat',
  );
  const kiri = $derived(
    selesai
      ? 'Semua langkah selesai'
      : state === 'RENCANA_DIUSULKAN'
        ? 'Rencana menunggu persetujuan'
        : info.langkah === 0
          ? 'Rencana sedang disusun'
          : `Langkah ${info.langkah} dari 5`,
  );
  const kanan = $derived.by(() => {
    const r = urusan.ringkasan;
    if (!r) return '';
    if (selesai) return `Selesai ${tanggal(r.diubahPada)}`;
    if (state === 'BARU' || state === 'MEMAHAMI') return `Dimulai ${tanggal(r.dibuatPada)}`;
    if (state === 'TERKIRIM') return `Terkirim ${tanggal(r.diubahPada)}`;
    return `Diperbarui ${tanggal(r.diubahPada)}`;
  });
  const CHIP: Record<'anda' | 'ai' | 'instansi' | 'netral', { kelas: string; ikon: NamaIkon }> = {
    anda: { kelas: 'bg-kuning text-kuning-ink', ikon: 'tangan' },
    ai: { kelas: 'bg-nila text-nila-ink', ikon: 'ai' },
    instansi: { kelas: 'bg-bg-2 text-muted', ikon: 'instansi' },
    netral: { kelas: 'bg-bg-2 text-muted', ikon: 'info' },
  };
  const chip = $derived(info.nada === 'selesai' ? null : CHIP[info.nada]);
</script>

<article
  class="flex min-w-0 flex-col gap-3.5 rounded-[18px] p-5 shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 {utama
    ? 'border-[1.5px] border-ink bg-surface'
    : 'border border-line bg-card'}"
>
  <div class="flex items-center justify-between gap-3">
    <Lencana peristiwa={p} />
    <img
      src={p.avatar}
      alt=""
      width="36"
      height="36"
      class="size-9 shrink-0 rounded-full shadow-[0_0_1px_#0000000f,0_1px_1px_#0000000f,0_2px_4px_#0000000a] ring-2 ring-surface {KELAS_WARNA[
        p.warna
      ]}"
    />
  </div>
  <div class="flex flex-col gap-1">
    <h3 class="text-[19px] leading-7 font-semibold tracking-[-0.3px] text-ink">{urusan.judul}</h3>
    <p class="text-base leading-[23px] text-card-ink">{keterangan}</p>
  </div>
  <div class="flex flex-col gap-1.5">
    <div class="flex flex-wrap justify-between gap-x-3 text-sm leading-5 text-muted">
      <span>{kiri}</span>
      {#if kanan}<span>{kanan}</span>{/if}
    </div>
    <div class="flex gap-1" aria-hidden="true">
      {#each LANGKAH_RENCANA as _, i (i)}
        <span
          class="h-1.5 flex-1 rounded-full {selesai
            ? 'bg-hijau-ink'
            : i + 1 < kini
              ? 'bg-ink'
              : i + 1 === kini
                ? info.nada === 'instansi'
                  ? 'bg-card-ink'
                  : 'bg-brand'
                : 'bg-line'}"
        ></span>
      {/each}
    </div>
  </div>
  <div class="flex flex-wrap items-center justify-between gap-3">
    {#if chip}
      <span
        class="inline-flex items-center gap-[7px] rounded-full py-1.5 pr-3 pl-2.5 text-sm font-semibold whitespace-nowrap {chip.kelas}"
      >
        <Icon name={chip.ikon} class="size-[15px] shrink-0" />{info.label}
      </span>
    {:else}
      <span class="inline-flex items-center gap-1.5 text-[15px] leading-[22px] font-semibold text-hijau-ink">
        <Icon name="centang-bulat" class="size-4 shrink-0" />Selesai
      </span>
    {/if}
    <a
      href={resolve('/urusan/[id]', { id: urusan.id })}
      class="inline-flex h-[46px] items-center rounded-full px-[18px] text-[15px] leading-[22px] font-semibold transition-all duration-150 ease-out active:scale-[0.98] {utama
        ? 'bg-primer text-primer-ink hover:opacity-90'
        : 'border border-line-2 bg-surface text-ink hover:bg-bg'}"
    >
      {info.aksi}<span class="sr-only">: {urusan.judul}</span>
    </a>
  </div>
</article>
