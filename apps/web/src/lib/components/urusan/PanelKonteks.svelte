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
  import { LANGKAH_RENCANA, infoStatus, langkahKini, langkahPanel, tanggal } from '#lib/urusan-status.js';

  /**
   * Panel konteks 400 px (App 02–09): status + judul langkah sekarang + progres per langkah, lalu tab Rencana,
   * Dokumen, Sumber. Langkahnya mengikuti rencana (`langkahPanel`): lima langkah Pendamping hanya bila rencana
   * dibantu Pendamping. Di HP panel ini tampil di atas percakapan dan bisa dilipat.
   */
  let {
    state,
    jenis = null,
    sedangBerjalan,
    rencana,
    checklist,
    kutipan,
    tab = $bindable('rencana'),
    sorot = null,
    persiapan = false,
    bawah,
  }: {
    state: UrusanState | null;
    /** Jenis urusan (klasifikasi harness), untuk langkah sebelum rencana ada. */
    jenis?: string | null;
    sedangBerjalan: boolean;
    rencana: EventOf<'plan_card'> | null;
    checklist: EventOf<'checklist'> | null;
    kutipan: readonly (KutipanTerverifikasi & { nomor: number })[];
    tab?: TabPanel;
    sorot?: string | null;
    /** Browser Pendamping masih antre/disiapkan: langkah sekarang belum dimulai, yang bekerja Urusin. */
    persiapan?: boolean;
    bawah?: Snippet | undefined;
  } = $props();

  const info = $derived(
    persiapan
      ? { ...infoStatus(state), label: 'Menyiapkan browser', nada: 'ai' as const }
      : infoStatus(state),
  );

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

  const langkah = $derived(langkahPanel(rencana, jenis));
  const sekarang = $derived(langkahKini(state, langkah));
  // Di luar lima langkah Pendamping, judulnya langkah rencana yang sedang dikerjakan warga.
  const judul = $derived(
    (langkah !== LANGKAH_RENCANA && sekarang >= 1 && langkah[sekarang - 1]?.judul) ||
      (state && JUDUL[state]) ||
      'Urusin sedang memahami kebutuhan Anda',
  );
  const dokSiap = $derived(checklist?.item.filter((i) => i.status === 'ok').length ?? 0);

  function keadaanLangkah(i: number): 'selesai' | 'kini' | 'nanti' {
    const n = i + 1;
    if (sekarang > n) return 'selesai';
    if (sekarang === n) return 'kini';
    return 'nanti';
  }
</script>

<div class="flex min-h-full flex-col gap-5 px-4 py-5 sm:p-6">
  <div class="flex flex-col gap-3.5 pb-1">
    <div class="flex items-center justify-between gap-3">
      <Titik nada={info.nada} tebal
        >{sedangBerjalan && info.nada !== 'ai' ? 'Urusin sedang bekerja' : info.label}</Titik
      >
      <span class="text-sm text-card-ink">
        {#if sekarang >= 1 && sekarang <= langkah.length}Langkah {sekarang} dari {langkah.length}{:else if rencana}Rencana
          · {rencana.langkah.length} langkah{:else}Menyusun rencana{/if}
      </span>
    </div>
    <h2 class="text-xl leading-[26px] font-semibold tracking-[-0.3px] text-ink">{judul}</h2>
    {#if sekarang >= 1}
      <div
        class="grid gap-1"
        style:grid-template-columns="repeat({langkah.length}, minmax(0, 1fr))"
        aria-hidden="true"
      >
        {#each langkah as _, i (i)}
          {@const k = keadaanLangkah(i)}
          <span
            class="h-1.5 rounded-[3px] {k === 'selesai'
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

  <div class="flex-1">
    {#if tab === 'rencana'}
      <div id="panel-panel-rencana" role="tabpanel" aria-labelledby="panel-tab-rencana">
        <ol class="flex flex-col">
          {#each langkah as l, i (i)}
            {@const k = keadaanLangkah(i)}
            <li class="relative flex min-h-[70px] gap-3 last:min-h-12">
              {#if i < langkah.length - 1}
                <span
                  class="absolute top-[26px] bottom-0 left-3 w-0.5 {k === 'selesai'
                    ? 'bg-[#cfe0bf]'
                    : 'bg-line-2'}"
                  aria-hidden="true"
                ></span>
              {/if}
              {#if k === 'selesai'}
                <span
                  class="relative grid size-[26px] shrink-0 place-items-center rounded-full bg-hijau text-hijau-ink"
                >
                  <Icon name="centang" class="size-3.5" label="Selesai" />
                </span>
              {:else if k === 'kini'}
                <span
                  class="relative grid size-[26px] shrink-0 place-items-center rounded-full bg-primer text-[13px] leading-[13px] font-semibold text-primer-ink"
                  aria-current="step">{i + 1}</span
                >
              {:else}
                <span
                  class="relative grid size-[26px] shrink-0 place-items-center rounded-full border-[1.5px] border-line-2 bg-surface text-[13px] leading-[13px] font-semibold text-card-ink"
                  >{i + 1}</span
                >
              {/if}
              <div class="flex min-w-0 flex-col gap-px">
                <p class="text-base leading-[22px] font-semibold text-ink">{l.judul}</p>
                <p
                  class="text-sm leading-5 {k === 'selesai'
                    ? 'text-hijau-ink'
                    : k === 'kini'
                      ? info.nada === 'ai'
                        ? 'font-medium text-nila-ink'
                        : 'font-medium text-[#b5481f]'
                      : 'text-muted'}"
                >
                  {#if k === 'selesai'}Selesai{:else if k === 'kini'}{info.nada === 'ai' && !persiapan
                      ? 'Sedang berjalan'
                      : info.label}{:else if i === 0}Bisa mulai setelah rencana disetujui{:else}Setelah
                    langkah {i} · {l.pelaku}{/if}
                </p>
              </div>
            </li>
          {:else}
            <li class="rounded-xl bg-card p-4 text-[0.9375rem] text-body">
              Langkah muncul di sini setelah Urusin menyusun rencana.
            </li>
          {/each}
        </ol>
      </div>
    {:else if tab === 'dokumen'}
      <div id="panel-panel-dokumen" role="tabpanel" aria-labelledby="panel-tab-dokumen">
        {#if checklist?.item.length}
          <div class="mb-2.5 flex items-center justify-between text-sm leading-[21px] font-semibold">
            <span class="text-muted">Dokumen untuk urusan ini</span>
            <span class="text-ink">{dokSiap} / {checklist.item.length} siap</span>
          </div>
          <ul class="flex flex-col gap-2.5">
            {#each checklist.item as it (it.id)}
              <li
                class="flex min-h-[52px] items-center justify-between gap-3 rounded-xl border bg-surface py-1.5 pr-2.5 pl-3.5 {it.status ===
                'ok'
                  ? 'border-line'
                  : 'border-[#e6d2b0]'}"
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
            class="flex flex-col gap-2.5 rounded-[14px] bg-surface p-4 {sorot === q.refId
              ? 'border-[1.5px] border-ink'
              : 'border border-line'}"
          >
            <h3 class="flex items-start gap-2 text-base leading-6 font-semibold text-ink">
              <span
                class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs leading-3 font-semibold {sorot ===
                q.refId
                  ? 'bg-primer text-primer-ink'
                  : 'bg-bg-2 text-ink'}">{q.nomor}</span
              >
              {q.judul}
            </h3>
            <blockquote
              class="rounded-lg border-l-[3px] border-[#ead98a] bg-[#fbf1c9] px-3 py-2 text-[15px] leading-[23px] text-ink dark:border-kuning-ink dark:bg-kuning"
            >
              “{q.kutipanPersis}”
            </blockquote>
            <p class="text-sm leading-[21px] text-muted">
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
              class="inline-flex h-11 items-center gap-2 self-start rounded-full bg-bg-2 px-3.5 text-[15px] leading-[23px] text-ink hover:bg-line-3"
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
