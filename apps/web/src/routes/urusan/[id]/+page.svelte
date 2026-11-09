<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { tick, untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import type { EventOf, KutipanTerverifikasi } from '#lib/contracts.js';
  import Icon from '#lib/components/Icon.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import KartuChecklist from '#lib/components/urusan/KartuChecklist.svelte';
  import KartuGalat from '#lib/components/urusan/KartuGalat.svelte';
  import KartuGiliran from '#lib/components/urusan/KartuGiliran.svelte';
  import KartuHandoff from '#lib/components/urusan/KartuHandoff.svelte';
  import KartuJawaban from '#lib/components/urusan/KartuJawaban.svelte';
  import KartuKonfirmasi from '#lib/components/urusan/KartuKonfirmasi.svelte';
  import KartuRencana from '#lib/components/urusan/KartuRencana.svelte';
  import KartuTerkirim from '#lib/components/urusan/KartuTerkirim.svelte';
  import Komposer from '#lib/components/urusan/Komposer.svelte';
  import Lencana from '#lib/components/urusan/Lencana.svelte';
  import PanelKonteks, { type TabPanel } from '#lib/components/urusan/PanelKonteks.svelte';
  import PesanAgen from '#lib/components/urusan/PesanAgen.svelte';
  import { bangunLinimasa, labelProgres } from '#lib/components/urusan/linimasa.js';
  import LayarPendamping from '#lib/components/pendamping/LayarPendamping.svelte';
  import LembarIzinkan from '#lib/components/pendamping/LembarIzinkan.svelte';
  import { muatPabrikViewer } from '#lib/pendamping/klien.js';
  import { SesiPendampingUi } from '#lib/pendamping/sesi.svelte.js';
  import { judulUrusan, peristiwaDariJenis } from '#lib/peristiwa.js';
  import { ambilLokal } from '#lib/stores/app.svelte.js';
  import type { PesanWarga } from '#lib/stores/lokal.svelte.js';
  import { UrusanStore } from '#lib/stores/urusan.svelte.js';
  import { waktuSingkat } from '#lib/urusan-status.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const lokal = ambilLokal();
  const store = new UrusanStore();
  // svelte-ignore state_referenced_locally
  const sesi = new SesiPendampingUi(data.urusan.id, muatPabrikViewer);

  let pesan = $state<PesanWarga[]>([]);
  let teks = $state('');
  let komposer: HTMLTextAreaElement | null = $state(null);
  let mengirim = $state(false);
  let pesanKomposer = $state<string | null>(null);
  let tab = $state<TabPanel>('rencana');
  let sorot = $state<string | null>(null);
  let panelHpBuka = $state(false);
  let ujungDaftar: HTMLDivElement | undefined = $state();
  let konfirmasi = $state<{ key: string; status: 'mengirim' | 'disetujui' } | null>(null);
  let konfirmasiGalat = $state<string | undefined>(undefined);
  let canvas: HTMLCanvasElement | null = $state(null);
  let inputTeks: HTMLTextAreaElement | null = $state(null);
  let izin = $state<{ sibuk: boolean; pesan?: string }>({ sibuk: false });

  const k = $derived(store.keadaan);
  const keadaanUrusan = $derived(k.state ?? data.urusan.state);
  const p = $derived(peristiwaDariJenis(data.urusan.jenis));
  const judul = $derived(
    judulUrusan(data.urusan.jenis) ?? lokal.cari(data.urusan.id)?.judul ?? 'Urusan baru',
  );
  const linimasa = $derived(bangunLinimasa(k.events, pesan));
  const kutipan = $derived.by(() => {
    const peta = new SvelteMap<string, KutipanTerverifikasi & { nomor: number }>();
    for (const e of k.events)
      if (e.type === 'grounded_answer')
        for (const kl of e.klaim)
          for (const q of kl.kutipan)
            if (!peta.has(q.refId)) peta.set(q.refId, { ...q, nomor: peta.size + 1 });
    return [...peta.values()];
  });
  const nomorKutipan = $derived(new Map(kutipan.map((q) => [q.refId, q.nomor])));
  const situs = $derived.by(() => {
    // Tool baca-saja non-dukcapil (Samsat, OSS) membawa origin situs yang dibuka.
    if (k.permintaanEksekusi?.origin) return k.permintaanEksekusi.origin;
    const l = k.rencana?.langkah;
    const adapter =
      l?.find((x) => x.jenis === 'online-adapter') ?? l?.find((x) => x.jenis === 'online-manual');
    return adapter?.sumber[0]?.url ?? l?.[0]?.sumber[0]?.url ?? null;
  });
  const instansi = $derived(k.rencana?.langkah.find((x) => x.sumber.length)?.sumber[0]?.instansi);
  const pendampingAktif = $derived(sesi.data.keadaan !== 'mati');
  const kosong = $derived(linimasa.length === 0 && !k.sedangBerjalan);

  // Hanya bergantung pada id urusan; store dan catatan perangkat dibaca/ditulis tanpa dilacak.
  $effect(() => {
    const id = data.urusan.id;
    untrack(() => buka(id));
    return () => {
      store.putus();
      sesi.tutup();
    };
  });

  function buka(id: string) {
    pesan = lokal.pesanWarga(id);
    const tertunda = lokal.ambilTertunda() ?? data.pesanAwal;
    if (tertunda && pesan.length === 0) {
      lokal.catatPesan(id, { teks: tertunda, setelahSeq: 0 });
      pesan = lokal.pesanWarga(id);
    }
    lokal.catatUrusan({
      id,
      judul: judulUrusan(data.urusan.jenis) ?? lokal.cari(id)?.judul ?? judulDariPesan(pesan[0]?.teks),
      peristiwa: data.urusan.jenis,
      dibuatPada: data.urusan.dibuatPada,
    });
    store.sambung(id);
  }

  // Gulir ke pesan terbaru saat ada item baru.
  $effect(() => {
    void linimasa.length;
    void k.progres;
    void tick().then(() => ujungDaftar?.scrollIntoView({ block: 'end' }));
  });

  function judulDariPesan(t: string | undefined): string {
    if (!t) return 'Urusan baru';
    const s = t.replace(/\s+/g, ' ').trim();
    return s.length > 40 ? `${s.slice(0, 38)}…` : s;
  }

  async function kirim(t: string) {
    mengirim = true;
    pesanKomposer = null;
    const setelahSeq = k.lastSeq;
    const hasil = await store.kirim(t);
    mengirim = false;
    if (hasil === 'ok') {
      lokal.catatPesan(data.urusan.id, { teks: t, setelahSeq });
      pesan = lokal.pesanWarga(data.urusan.id);
      teks = '';
    } else if (hasil === 'konflik') {
      pesanKomposer =
        'Urusin masih memproses langkah sebelumnya, tunggu sebentar. Pesan Anda tetap di sini; kirim lagi sebentar lagi.';
    } else {
      pesanKomposer = 'Pesan belum terkirim. Periksa koneksi, lalu coba lagi.';
    }
  }

  function ulangTerakhir() {
    const t = pesan.at(-1)?.teks;
    if (t) void kirim(t);
  }

  function ubahRencana() {
    teks = 'Saya ingin mengubah rencana: ';
    komposer?.focus();
  }

  function pilihSumber(refId: string) {
    sorot = refId;
    tab = 'sumber';
    panelHpBuka = true;
    void tick().then(() =>
      document.getElementById(`sumber-${nomorKutipan.get(refId)}`)?.scrollIntoView({ block: 'nearest' }),
    );
  }

  async function setujui(
    key: string,
    gate: EventOf<'gate'>,
    permintaan: EventOf<'execution_request'> | null,
  ) {
    const tool = gate.tool ?? permintaan?.tool;
    const paramsHash = gate.paramsHash ?? permintaan?.paramsHash;
    if (!tool || !paramsHash) return;
    konfirmasi = { key, status: 'mengirim' };
    try {
      const res = await fetch(`/api/urusan/${encodeURIComponent(data.urusan.id)}/konfirmasi`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool, paramsHash }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { pesanWarga?: string } | null;
        konfirmasi = null;
        konfirmasiGalat = j?.pesanWarga ?? 'Persetujuan belum tercatat. Coba lagi.';
        return;
      }
      konfirmasiGalat = undefined;
      konfirmasi = { key, status: 'disetujui' };
      if (permintaan)
        void sesi.mulai(
          permintaan.executionId,
          () => canvas,
          () => inputTeks,
        );
    } catch {
      konfirmasi = null;
      konfirmasiGalat = 'Koneksi terputus. Persetujuan belum tercatat.';
    }
  }

  /**
   * "Izinkan isi" (A-M1): peramban hanya mengirim daftar write + origin tujuan. Server menyimpan persetujuan;
   * Pendamping mengambil nilai Data Diri dan berkas di server. Nilai vault tidak pernah lewat peramban.
   */
  async function izinkanIsi() {
    izin = { sibuk: true };
    const pesan = await sesi.izinkanIsi();
    izin = { sibuk: false, ...(pesan ? { pesan } : {}) };
  }

  function isiSendiri() {
    sesi.ambilAlih();
    sesi.data = { ...sesi.data, butuhData: null };
  }

  const DEGRADED = {
    hemat: 'AI sedang hemat: jawaban lebih singkat, sumber resmi tetap disertakan.',
    tanpa_ai: 'AI sedang tidak tersedia. Ikuti langkah dari sumber resmi di panel Rencana.',
  } as const;
</script>

<svelte:head>
  <title>{judul} · Urusin</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col lg:h-dvh">
  <HeaderHalaman {judul}>
    {#snippet awal()}<Lencana peristiwa={p} />{/snippet}
  </HeaderHalaman>

  {#if k.status === 'terputus'}
    <p role="status" class="flex items-center gap-2 bg-kuning px-4 py-2 text-sm text-kuning-ink sm:px-7">
      <Icon name="terputus" class="size-4" /> Koneksi terputus. Menyambung ulang…
    </p>
  {/if}
  {#if k.degraded?.mode}
    <p role="status" class="flex items-center gap-2 bg-nila px-4 py-2 text-sm text-nila-ink sm:px-7">
      <Icon name="info" class="size-4" />{DEGRADED[k.degraded.mode]}
    </p>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
    <!-- Panel konteks: di HP di atas percakapan dan bisa dilipat; di laptop kolom kanan 400 px. -->
    <aside
      aria-label="Rencana, dokumen, dan sumber"
      class="order-first border-b border-line bg-card lg:order-last lg:w-[399.5px] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-l"
    >
      <button
        type="button"
        class="flex min-h-14 w-full items-center gap-2 px-4 text-left text-[0.9375rem] font-semibold text-ink lg:hidden"
        aria-expanded={panelHpBuka}
        aria-controls="panel-konteks"
        onclick={() => (panelHpBuka = !panelHpBuka)}
      >
        <Icon name="rencana" class="size-5" />
        <span class="flex-1">Rencana, dokumen, dan sumber</span>
        <Icon name={panelHpBuka ? 'atas' : 'bawah'} class="size-5" />
      </button>
      <div id="panel-konteks" class="{panelHpBuka ? '' : 'max-lg:hidden'} lg:h-full">
        <PanelKonteks
          state={keadaanUrusan}
          sedangBerjalan={k.sedangBerjalan}
          rencana={k.rencana}
          checklist={k.checklist}
          {kutipan}
          bind:tab
          {sorot}
        >
          {#snippet bawah()}
            {#if pendampingAktif}
              <div class="flex flex-col gap-3 border-t border-line pt-4">
                {#each linimasa.filter((x) => x.jenis === 'teks').slice(-1) as it (it.key)}
                  {#if it.jenis === 'teks'}
                    <PesanAgen avatar={p.avatar}><p class="text-[0.9375rem]">{it.teks}</p></PesanAgen>
                  {/if}
                {/each}
                <Komposer
                  bind:teks
                  bind:elemen={komposer}
                  sibuk={mengirim}
                  pesan={pesanKomposer}
                  onkirim={kirim}
                />
              </div>
            {/if}
          {/snippet}
        </PanelKonteks>
      </div>
    </aside>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      {#if pendampingAktif}
        <div class="flex min-h-0 flex-1 flex-col p-3 sm:p-5">
          <LayarPendamping
            data={sesi.data}
            situs={situs ?? 'https://situs-resmi.go.id'}
            {instansi}
            bind:canvas
            bind:inputTeks
            onambilalih={() => sesi.ambilAlih()}
            onkembalikan={() => void sesi.kembalikan()}
            onhentikan={() => void sesi.hentikan()}
            onmulailagi={() => {
              const e = k.permintaanEksekusi;
              if (e)
                void sesi.mulai(
                  e.executionId,
                  () => canvas,
                  () => inputTeks,
                );
            }}
            onpanduan={() => {
              void sesi.hentikan();
              tab = 'rencana';
              panelHpBuka = true;
            }}
          />
        </div>
      {:else}
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div
            role="log"
            aria-label="Percakapan urusan"
            class="flex w-full flex-col gap-5 px-4 py-6 sm:px-10 sm:pt-7 sm:pb-6"
          >
            {#if kosong}
              <div class="rounded-2xl bg-card p-5 text-center">
                <p class="text-lg font-semibold text-ink">Ceritakan urusan Anda</p>
                <p class="mt-1 text-[0.9375rem] text-body">
                  Tulis dengan bahasa sehari-hari. Urusin mencari aturan resmi lalu menyusun langkahnya.
                </p>
              </div>
            {/if}

            {#each linimasa as it (it.key)}
              {#if it.jenis === 'warga'}
                <p
                  class="max-w-[min(85%,460px)] self-end rounded-[18px_18px_4px_18px] bg-bg-2 px-4 py-3 text-base whitespace-pre-line text-ink sm:text-[17px] sm:leading-[26px]"
                >
                  {it.teks}
                </p>
              {:else if it.jenis === 'sistem'}
                <p
                  class="flex items-center justify-center gap-1.5 text-center text-sm leading-[21px] text-muted"
                >
                  <Icon name="centang-bulat" class="size-4 shrink-0" />{it.teks} · {waktuSingkat(it.at)}
                </p>
              {:else if it.jenis === 'teks'}
                <PesanAgen avatar={p.avatar}
                  ><p class="leading-relaxed whitespace-pre-line">{it.teks}</p></PesanAgen
                >
              {:else if it.jenis === 'jawaban'}
                <PesanAgen avatar={p.avatar}>
                  <KartuJawaban jawaban={it.e} {nomorKutipan} onpilih={pilihSumber} />
                </PesanAgen>
              {:else if it.jenis === 'handoff'}
                <PesanAgen avatar={p.avatar}><KartuHandoff handoff={it.e} /></PesanAgen>
              {:else if it.jenis === 'rencana'}
                <PesanAgen avatar={p.avatar}>
                  <p>Ini rencana yang saya sarankan untuk {judul.toLowerCase()}:</p>
                  <KartuRencana
                    rencana={it.e}
                    kelayakan={k.kelayakan}
                    bisaSetujui={it.terakhir && keadaanUrusan === 'RENCANA_DIUSULKAN' && !k.sedangBerjalan}
                    sibuk={mengirim}
                    onsetujui={() => void kirim('Saya setuju dengan rencana ini.')}
                    onubah={ubahRencana}
                  />
                </PesanAgen>
              {:else if it.jenis === 'checklist'}
                <PesanAgen avatar={p.avatar}><KartuChecklist checklist={it.e} /></PesanAgen>
              {:else if it.jenis === 'konfirmasi'}
                <PesanAgen avatar={p.avatar}>
                  <p>Sebelum saya membuka situs resmi, periksa dulu data yang akan diisi:</p>
                  <KartuKonfirmasi
                    gate={it.gate}
                    permintaan={it.permintaan}
                    {situs}
                    aktif={it.terakhir && keadaanUrusan === 'MENUNGGU_KONFIRMASI'}
                    status={konfirmasi?.key === it.key ? konfirmasi.status : 'menunggu'}
                    pesanGalat={it.terakhir ? konfirmasiGalat : undefined}
                    onsetujui={() => void setujui(it.key, it.gate, it.permintaan)}
                    onbatal={() => void kirim('Batalkan, saya belum mau melanjutkan.')}
                  />
                </PesanAgen>
              {:else if it.jenis === 'giliran'}
                <PesanAgen avatar={p.avatar}>
                  <KartuGiliran
                    gate={it.gate}
                    aktif={it.terakhir && !k.sedangBerjalan}
                    onlanjut={() => void kirim('Sudah, lanjutkan.')}
                  />
                </PesanAgen>
              {:else if it.jenis === 'galat'}
                <PesanAgen avatar={p.avatar}>
                  <KartuGalat
                    pesan={it.e.pesanWarga}
                    bisaUlang={it.e.bisaUlang && it.terakhir}
                    onulang={ulangTerakhir}
                  />
                </PesanAgen>
              {:else if it.jenis === 'waktu-habis'}
                <PesanAgen avatar={p.avatar}>
                  <KartuGalat
                    pesan="Jawaban terlalu lama. Tulisan Anda aman; coba kirim lagi."
                    bisaUlang={it.terakhir}
                    onulang={ulangTerakhir}
                  />
                </PesanAgen>
              {:else if it.jenis === 'terkirim'}
                <PesanAgen avatar={p.avatar}>
                  <p>Pengajuan Anda sudah masuk. Nomor permohonannya saya catat supaya mudah dilacak.</p>
                  <KartuTerkirim urusanId={data.urusan.id} nomor={sesi.data.bukti?.nomor} {situs} />
                </PesanAgen>
              {/if}
            {/each}

            {#if k.sedangBerjalan}
              <p
                role="status"
                class="flex items-center gap-2 pl-[46px] text-[15px] leading-[23px] text-muted"
              >
                <Icon name="memuat" class="size-4 animate-spin" />
                {labelProgres(k.progres, k.events.findLast((e) => e.type === 'progress')?.toolName)}
              </p>
            {/if}
            {#if k.perluLanjut && !k.sedangBerjalan}
              <button
                type="button"
                onclick={() => void kirim('lanjut')}
                class="ml-[46px] inline-flex h-12 items-center gap-2 self-start rounded-full border border-line-2 bg-surface px-5 text-base text-ink shadow-[0_0_1px_#0000000f,0_1px_1px_#0000000f,0_2px_4px_#0000000a] hover:bg-card"
              >
                Lanjutkan <Icon name="panah" class="size-4.5" />
              </button>
            {/if}
            <div bind:this={ujungDaftar}></div>
          </div>
        </div>

        <div
          class="sticky bottom-[4.5rem] z-10 bg-gradient-to-t from-bg via-bg/95 to-transparent px-4 pt-3 pb-3 sm:px-10 lg:bottom-0 lg:from-surface lg:via-surface lg:pb-6"
        >
          <div class="w-full">
            <Komposer
              bind:teks
              bind:elemen={komposer}
              sibuk={mengirim}
              pesan={pesanKomposer}
              onkirim={kirim}
            />
            {#if keadaanUrusan === 'TERKIRIM' || keadaanUrusan === 'DIPANTAU' || keadaanUrusan === 'SELESAI'}
              <a
                href={resolve('/jejak/[id]', { id: data.urusan.id })}
                class="mt-2 inline-flex min-h-12 items-center gap-2 px-2 text-sm font-medium text-ink hover:underline"
              >
                <Icon name="jejak" class="size-4" /> Lihat jejak urusan
              </a>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<LembarIzinkan
  buka={sesi.data.butuhData !== null}
  placeholder={sesi.data.butuhData?.placeholder ?? []}
  berkas={sesi.data.butuhData?.berkas ?? []}
  sibuk={izin.sibuk}
  pesan={izin.pesan}
  onizinkan={() => void izinkanIsi()}
  ontolak={isiSendiri}
/>
