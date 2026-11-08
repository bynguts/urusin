<script lang="ts" module>
  export type TabPanel = 'rencana' | 'dokumen' | 'sumber';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { EventOf, KutipanTerverifikasi, UrusanState } from '#lib/contracts.js';
  import Icon from '../Icon.svelte';
  import Chip from '../ui/Chip.svelte';
  import Tab from '../ui/Tab.svelte';
  import Titik from '../ui/Titik.svelte';
  import { LANGKAH_RENCANA, infoStatus, tanggal } from '#lib/urusan-status.js';

  /**
   * Panel konteks 400 px (App 02–09): status + judul langkah sekarang + progres 5 segmen, lalu tab Rencana,
   * Dokumen, Sumber. Di HP panel ini tampil di atas percakapan dan bisa dilipat.
   */
  let {
    state,
    sedangBerjalan,
    rencana,
    checklist,
    kutipan,
    tab = $bindable('rencana'),
    sorot = null,
    bawah,
  }: {
    state: UrusanState | null;
    sedangBerjalan: boolean;
    rencana: EventOf<'plan_card'> | null;
    checklist: EventOf<'checklist'> | null;
    kutipan: readonly (KutipanTerverifikasi & { nomor: number })[];
    tab?: TabPanel;
    sorot?: string | null;
    bawah?: Snippet | undefined;
  } = $props();

  const info = $derived(infoStatus(state));

  const JUDUL: Partial<Record<UrusanState, string>> = {
    BARU: 'Ceritakan urusan Anda',
    MEMAHAMI: 'Jawab pertanyaan supaya rencananya tepat',
    RENCANA_DIUSULKAN: 'Tinjau dan setujui rencana',
    RENCANA_DISETUJUI: 'Siapkan dokumen',
    MENYIAPKAN_BERKAS: 'Siapkan dokumen',
    BERKAS_SIAP: 'Masuk akun di situs resmi',
    MENUNGGU_LOGIN_WARGA: 'Masuk akun di situs resmi',
    MENUNGGU_PROFIL_WARGA: 'Lengkapi data diri',
    MENUNGGU_KONFIRMASI: 'Setujui sebelum AI mulai bekerja',
    MENGISI: 'AI mengisi formulir',
    MENGUNGGAH: 'AI mengunggah berkas',
    MENUNGGU_SUBMIT_WARGA: 'Periksa lalu tekan Kirim',
    TERKIRIM: 'Petugas memverifikasi pengajuan',
    DIPANTAU: 'Petugas memverifikasi pengajuan',
    SELESAI: 'Urusan selesai',
    DITOLAK: 'Lihat alasan penolakan',
    DIBATALKAN: 'Urusan dibatalkan',
    DIPANDU: 'Ikuti panduan langkah demi langkah',
    GAGAL_AMAN: 'Urusin berhenti dengan aman',
  };

  const judul = $derived((state && JUDUL[state]) || 'Urusin sedang memahami kebutuhan Anda');
  const sekarang = $derived(info.langkah);
  const dokSiap = $derived(checklist?.item.filter((i) => i.status === 'ok').length ?? 0);

  function keadaanLangkah(i: number): 'selesai' | 'kini' | 'nanti' {
    const n = i + 1;
    if (sekarang > n) return 'selesai';
    if (sekarang === n) return 'kini';
    return 'nanti';
  }
</script>

<div class="flex h-full flex-col gap-5 px-4 py-5 sm:px-6 lg:py-7">
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-3">
      <Titik nada={info.nada} tebal
        >{sedangBerjalan && info.nada !== 'ai' ? 'Urusin sedang bekerja' : info.label}</Titik
      >
      <span class="text-sm text-muted">
        {#if sekarang >= 1 && sekarang <= 5}Langkah {sekarang} dari 5{:else if rencana}Rencana · {rencana
            .langkah.length} langkah{:else}Menyusun rencana{/if}
      </span>
    </div>
    <h2 class="text-xl font-semibold tracking-tight text-ink">{judul}</h2>
    {#if sekarang >= 1}
      <div class="grid grid-cols-5 gap-1.5" aria-hidden="true">
        {#each LANGKAH_RENCANA as _, i (i)}
          {@const k = keadaanLangkah(i)}
          <span
            class="h-1.5 rounded-full {k === 'selesai'
              ? 'bg-ink'
              : k === 'kini'
                ? info.nada === 'ai'
                  ? 'bg-nila-ink'
                  : 'bg-brand'
                : 'bg-line'}"
          ></span>
        {/each}
      </div>
    {/if}
  </div>

  <Tab
    label="Isi panel urusan"
    idDasar="panel"
    bind:nilai={tab}
    pilihan={[
      { nilai: 'rencana', label: 'Rencana' },
      { nilai: 'dokumen', label: 'Dokumen' },
      { nilai: 'sumber', label: 'Sumber', jumlah: kutipan.length },
    ]}
  />

  <div class="min-h-0 flex-1">
    {#if tab === 'rencana'}
      <div id="panel-panel-rencana" role="tabpanel" aria-labelledby="panel-tab-rencana">
        <ol class="flex flex-col">
          {#each LANGKAH_RENCANA as l, i (l.judul)}
            {@const k = keadaanLangkah(i)}
            <li class="relative flex gap-3.5 pb-6 last:pb-0">
              {#if i < LANGKAH_RENCANA.length - 1}
                <span
                  class="absolute top-7 bottom-0 left-[0.8125rem] w-px {k === 'selesai'
                    ? 'bg-hijau-ink/40'
                    : 'bg-line-2'}"
                  aria-hidden="true"
                ></span>
              {/if}
              {#if k === 'selesai'}
                <span
                  class="relative grid size-7 shrink-0 place-items-center rounded-full bg-hijau text-hijau-ink"
                >
                  <Icon name="centang" class="size-3.5" label="Selesai" />
                </span>
              {:else if k === 'kini'}
                <span
                  class="relative grid size-7 shrink-0 place-items-center rounded-full bg-primer text-[0.8125rem] font-semibold text-primer-ink"
                  aria-current="step">{i + 1}</span
                >
              {:else}
                <span
                  class="relative grid size-7 shrink-0 place-items-center rounded-full border border-line-2 bg-surface text-[0.8125rem] font-semibold text-ink"
                  >{i + 1}</span
                >
              {/if}
              <div class="min-w-0 pt-0.5">
                <p class="text-[1.0625rem] font-semibold tracking-tight text-ink">{l.judul}</p>
                <p
                  class="text-sm {k === 'selesai'
                    ? 'text-hijau-ink'
                    : k === 'kini'
                      ? info.nada === 'ai'
                        ? 'font-medium text-nila-ink'
                        : 'font-medium text-[#b5481f]'
                      : 'text-muted'}"
                >
                  {#if k === 'selesai'}Selesai{:else if k === 'kini'}{info.nada === 'ai'
                      ? 'Sedang berjalan'
                      : info.label}{:else if i === 0}Bisa mulai setelah rencana disetujui{:else}Setelah
                    langkah {i} · {l.pelaku}{/if}
                </p>
              </div>
            </li>
          {/each}
        </ol>
      </div>
    {:else if tab === 'dokumen'}
      <div id="panel-panel-dokumen" role="tabpanel" aria-labelledby="panel-tab-dokumen">
        {#if checklist?.item.length}
          <div class="mb-3 flex items-center justify-between text-sm">
            <span class="font-medium text-muted">Dokumen untuk urusan ini</span>
            <span class="font-semibold text-ink">{dokSiap} / {checklist.item.length} siap</span>
          </div>
          <ul class="flex flex-col gap-2.5">
            {#each checklist.item as it (it.id)}
              <li
                class="flex min-h-14 items-center gap-3 rounded-xl border bg-surface px-4 py-2 {it.status ===
                'ok'
                  ? 'border-line'
                  : 'border-kuning'}"
              >
                <span class="min-w-0 flex-1 text-base text-ink">{it.label}</span>
                {#if it.status === 'ok'}
                  <Chip nada="hijau" ikon="centang-bulat">Siap</Chip>
                {:else if it.status === 'kurang'}
                  <Chip nada="kuning" ikon="kamera">Perlu diulang</Chip>
                {:else}
                  <Chip nada="netral" ikon="jam">Belum ada</Chip>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="rounded-xl bg-card p-4 text-[0.9375rem] text-body">
            Daftar dokumen muncul setelah rencana disetujui.
          </p>
        {/if}
      </div>
    {:else}
      <div
        id="panel-panel-sumber"
        role="tabpanel"
        aria-labelledby="panel-tab-sumber"
        class="flex flex-col gap-3"
      >
        {#each kutipan as q (q.refId)}
          <article
            id="sumber-{q.nomor}"
            class="rounded-2xl border bg-surface p-4 {sorot === q.refId
              ? 'border-ink border-[1.5px]'
              : 'border-line'}"
          >
            <h3 class="flex items-start gap-2 text-base font-semibold text-ink">
              <span
                class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primer text-[0.6875rem] text-primer-ink"
                >{q.nomor}</span
              >
              {q.judul}
            </h3>
            <blockquote class="mt-3 rounded-lg bg-kuning/70 px-3 py-2.5 text-[0.9375rem] text-ink">
              “{q.kutipanPersis}”
            </blockquote>
            <p class="mt-2 text-sm text-muted">
              {q.instansi}
              {#if q.perluDicekUlang}
                · <span class="text-kuning-ink">perlu dicek ulang</span>
              {:else if q.verifiedAt}
                · diperiksa {tanggal(q.verifiedAt)}
              {/if}
            </p>
            <a
              href={q.textFragmentUrl || q.url}
              target="_blank"
              rel="external noopener noreferrer"
              class="mt-3 inline-flex min-h-12 items-center gap-2 rounded-full bg-bg-2 px-4 text-[0.9375rem] font-medium text-ink hover:bg-line-3"
            >
              Buka & sorot di situs resmi <Icon name="keluar" class="size-4" />
              <span class="sr-only">(tab baru)</span>
            </a>
          </article>
        {:else}
          <p class="rounded-xl bg-card p-4 text-[0.9375rem] text-body">
            Sumber resmi muncul di sini setelah Urusin menjawab dengan kutipan.
          </p>
        {/each}
      </div>
    {/if}
  </div>

  {#if bawah}{@render bawah()}{/if}
</div>
