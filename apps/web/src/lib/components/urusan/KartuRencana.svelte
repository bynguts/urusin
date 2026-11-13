<script lang="ts">
  import type { EventOf } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';
  import type { NamaIkon } from '../ikon.js';
  import { domain } from '#lib/urusan-status.js';
  import Tautan from '../ui/Tautan.svelte';
  import TeksBertaut from '../ui/TeksBertaut.svelte';

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

  // Label pelaku App 03: Anda netral (tinta 6%), AI nila, Instansi biru.
  const PELAKU: Record<string, { label: string; kelas: string; ikon: NamaIkon }> = {
    'online-adapter': { label: 'AI', kelas: 'bg-nila text-nila-ink', ikon: 'ai' },
    'online-manual': { label: 'Anda', kelas: 'bg-ink/[0.06] text-ink', ikon: 'orang' },
    offline: { label: 'Instansi', kelas: 'bg-biru text-biru-ink', ikon: 'instansi' },
    // Cara (online/loket) belum terverifikasi: warga memastikannya di kanal Disdukcapil setempat.
    'cek-kanal': { label: 'Cek kanal setempat', kelas: 'bg-ink/[0.06] text-ink', ikon: 'orang' },
  };
</script>

<section
  aria-label="Rencana {rencana.langkah.length} langkah"
  class="overflow-hidden rounded-[18px] border border-line bg-surface shadow-[0_0_1px_#0000000f,0_2px_4px_#0000000a]"
>
  <header
    class="flex min-h-[56.5px] flex-wrap items-center justify-between gap-2.5 border-b border-line bg-card px-4 py-3.5 sm:px-[18px]"
  >
    <span class="flex items-center gap-2.5">
      <Icon name="rencana" class="size-[18px]" />
      <h2 class="text-[17px] leading-[26px] font-semibold text-ink">
        Rencana · {rencana.langkah.length} langkah
      </h2>
    </span>
    {#if kelayakan && kelayakan.mungkin.length && !kelayakan.perluKonfirmasi.length}
      <span
        class="inline-flex items-center gap-1.5 rounded-full bg-hijau px-2.5 py-1 text-sm leading-[21px] text-hijau-ink"
        ><Icon name="centang-bulat" class="size-4" />Kemungkinan memenuhi syarat</span
      >
    {:else if kelayakan && kelayakan.perluKonfirmasi.length}
      <span
        class="inline-flex items-center gap-1.5 rounded-full bg-kuning px-2.5 py-1 text-sm leading-[21px] text-kuning-ink"
        ><Icon name="info" class="size-4" />Perlu konfirmasi</span
      >
    {/if}
  </header>
  {#if rencana.wilayah}
    <div class="flex flex-col gap-1 border-b border-line px-4 py-3 text-sm leading-[21px] sm:px-[18px]">
      <p class="flex items-center gap-1.5 font-semibold text-ink">
        <Icon name="lokasi" class="size-4 shrink-0 text-brand" />
        {rencana.wilayah.ktp.nama}{rencana.wilayah.tujuan ? ` → ${rencana.wilayah.tujuan.nama}` : ''}
        <span class="font-normal text-muted"
          >· {rencana.tier === 'semi'
            ? 'AI bisa bantu mengisi di situs resmi'
            : 'Dipandu langkah demi langkah'}</span
        >
      </p>
      {#if rencana.catatan}<p class="text-body"><TeksBertaut teks={rencana.catatan} /></p>{/if}
    </div>
  {/if}
  {#if rencana.dipandu}
    {@const d = rencana.dipandu}
    <div
      data-testid="kartu-dipandu"
      class="flex flex-col gap-3 border-b border-line px-4 py-3.5 text-sm leading-[21px] sm:px-[18px]"
    >
      <p class="flex items-start gap-2 rounded-xl bg-biru px-3 py-2.5 text-[0.9375rem] text-biru-ink">
        <Icon name="peta" class="mt-0.5 size-[18px] shrink-0" />
        <span><TeksBertaut teks={d.pesan} /></span>
      </p>
      {#if d.kanal.length}
        <div>
          <p class="font-semibold text-ink">Kanal resmi daerah</p>
          <ul class="mt-1.5 flex flex-col gap-2">
            {#each d.kanal as k (k.nama + (k.url ?? ''))}
              <li>
                {#if k.url}
                  <a
                    href={k.url}
                    target="_blank"
                    rel="external noopener noreferrer"
                    class="flex min-h-12 items-center gap-3 rounded-xl border border-line-2 bg-surface px-3.5 py-2 hover:bg-bg"
                  >
                    <Icon name="instansi" class="size-5 shrink-0 text-muted" />
                    <span class="min-w-0 flex-1">
                      <span class="block font-medium text-ink">{k.nama}</span>
                      <span class="tautan block truncate">{domain(k.url)}</span>
                      {#if k.kontak}<span class="block text-body">{k.kontak}</span>{/if}
                    </span>
                    <Icon name="tautan-luar" class="size-4 shrink-0 text-tautan" />
                    <span class="sr-only">(buka di tab baru)</span>
                  </a>
                {:else}
                  <p class="rounded-xl border border-line-2 bg-surface px-3.5 py-2.5">
                    {k.nama}{k.kontak ? ` · ${k.kontak}` : ''}
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <dl class="grid gap-2 sm:grid-cols-2">
        <div>
          <dt class="font-semibold text-ink">Biaya</dt>
          <dd class="text-body">
            <TeksBertaut teks={d.biaya.teks} />
            {#if d.biaya.sumber}<Tautan href={d.biaya.sumber.url} rel="external noopener noreferrer"
                >Sumber</Tautan
              >{/if}
          </dd>
        </div>
        <div>
          <dt class="font-semibold text-ink">Perkiraan waktu</dt>
          <dd class="text-body">
            <TeksBertaut teks={d.waktu.teks} />{#if d.waktu.umum}<span class="text-muted">
                (panduan umum, cek ulang di kanal resmi)</span
              >{/if}
          </dd>
        </div>
      </dl>
      {#if d.tips.length}
        <div>
          <p class="font-semibold text-ink">
            Tips <span class="font-normal text-muted">(panduan umum, cek ulang di kanal resmi)</span>
          </p>
          <ul class="list-disc pl-5 text-body">
            {#each d.tips as t (t)}<li><TeksBertaut teks={t} /></li>{/each}
          </ul>
        </div>
      {/if}
      {#if d.lanjutan.length}
        <div>
          <p class="font-semibold text-ink">Yang bisa saya bantu berikutnya</p>
          <ul class="list-disc pl-5 text-body">
            {#each d.lanjutan as t (t)}<li><TeksBertaut teks={t} /></li>{/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}
  <ol class="flex flex-col gap-2.5 px-4 py-3.5 sm:px-[18px]">
    {#each rencana.langkah as l, i (l.id)}
      {@const p = PELAKU[l.jenis] ?? PELAKU['online-manual']!}
      <!-- Masuk berurutan hanya bila kartunya baru (.animasi-pesan-masuk, lihat layout.css). -->
      <li class="langkah-kartu-rencana flex items-start gap-3" style:--urutan={i}>
        <span
          class="grid size-[26px] shrink-0 place-items-center rounded-full border-[1.5px] border-line-2 text-[13px] leading-[13px] font-semibold text-card-ink"
          >{i + 1}</span
        >
        <div class="min-w-0 flex-1">
          <span class="block text-base leading-[22px] text-ink"><TeksBertaut teks={l.judul} /></span>
          {#if l.dokumen?.length}
            <p class="mt-1 text-sm leading-[21px] font-semibold text-ink">Dokumen yang disiapkan:</p>
            <ul class="list-disc pl-5 text-sm leading-[21px] text-body">
              {#each l.dokumen as d (d)}<li><TeksBertaut teks={d} /></li>{/each}
            </ul>
          {/if}
          {#if l.keterangan}<p class="mt-1 text-sm leading-[21px] text-muted">
              <TeksBertaut teks={l.keterangan} />
            </p>{/if}
        </div>
        <span
          class="inline-flex shrink-0 items-center gap-[5px] rounded-full px-2.5 py-[3px] text-[13px] leading-5 font-semibold {p.kelas}"
          ><Icon name={p.ikon} class="size-[13px]" />{p.label}</span
        >
      </li>
    {/each}
  </ol>
  {#if kelayakan?.perluKonfirmasi.length}
    <div class="border-t border-line px-4 py-3 text-sm text-body sm:px-[18px]">
      <p class="font-semibold text-ink">Perlu dipastikan dulu:</p>
      <ul class="mt-1 list-disc pl-5">
        {#each kelayakan.perluKonfirmasi as k (k)}<li>{k}</li>{/each}
      </ul>
    </div>
  {/if}
  {#if bisaSetujui}
    <footer class="flex flex-wrap items-center gap-2.5 border-t border-line px-4 pt-3 pb-4 sm:px-[18px]">
      <button
        type="button"
        onclick={onsetujui}
        disabled={sibuk}
        aria-busy={sibuk || undefined}
        class="inline-flex h-12 items-center gap-2 rounded-full bg-primer px-[22px] text-base leading-6 font-semibold text-primer-ink disabled:opacity-80"
      >
        <Icon name={sibuk ? 'memuat' : 'centang'} class="size-[18px] {sibuk ? 'animate-spin' : ''}" />
        Setujui rencana
      </button>
      <button
        type="button"
        onclick={onubah}
        class="inline-flex h-12 items-center rounded-full border border-line-2 bg-surface px-5 text-base leading-6 text-ink hover:bg-card"
        >Ubah</button
      >
      <p class="text-sm leading-[21px] text-muted">Belum ada data yang dikirim.</p>
    </footer>
  {/if}
</section>
