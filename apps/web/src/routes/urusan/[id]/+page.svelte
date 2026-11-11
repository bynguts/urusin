<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { tick, untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import type { EventOf, IngatanResponse, KutipanTerverifikasi } from '#lib/contracts.js';
  import Icon from '#lib/components/Icon.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import KartuChecklist from '#lib/components/urusan/KartuChecklist.svelte';
  import KartuGalat from '#lib/components/urusan/KartuGalat.svelte';
  import KartuGiliran from '#lib/components/urusan/KartuGiliran.svelte';
  import KartuHandoff from '#lib/components/urusan/KartuHandoff.svelte';
  import KartuIngatan, {
    type HasilBatal,
    type IngatanLive,
  } from '#lib/components/urusan/KartuIngatan.svelte';
  import KartuJawaban from '#lib/components/urusan/KartuJawaban.svelte';
  import KartuKonfirmasi from '#lib/components/urusan/KartuKonfirmasi.svelte';
  import KartuRencana from '#lib/components/urusan/KartuRencana.svelte';
  import KartuWilayah from '#lib/components/urusan/KartuWilayah.svelte';
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
  let daftarPercakapan = $state<HTMLDivElement>();
  let pendampingDitutup = $state(false);
  let menutupPendamping = $state(false);
  let konfirmasi = $state<{ key: string; status: 'mengirim' | 'disetujui' } | null>(null);
  let konfirmasiGalat = $state<string | undefined>(undefined);
  let canvas: HTMLCanvasElement | null = $state(null);
  let inputTeks: HTMLTextAreaElement | null = $state(null);
  let izin = $state<{ sibuk: boolean; pesan?: string }>({ sibuk: false });

  const k = $derived(store.keadaan);
  const keadaanUrusan = $derived(k.state ?? data.urusan.state);
  // Panel Rencana selama Browser Pendamping berjalan mengikuti giliran nyata sesi (login, AI mengisi, Kirim),
  // bukan state urusan yang sudah melompat ke "tekan Kirim" sejak eksekusi disetujui.
  // Selama browser masih antre/disiapkan, langkah masuk akun belum dimulai (bukan "Selesai").
  const persiapanPendamping = $derived(sesi.data.keadaan === 'antre' || sesi.data.keadaan === 'menyiapkan');
  const keadaanPanel = $derived.by(() => {
    const d = sesi.data;
    if (persiapanPendamping) return 'BERKAS_SIAP' as const;
    if (d.keadaan === 'ai') return 'MENGISI' as const;
    if (d.keadaan === 'giliran' && d.giliran)
      return d.giliran.alasan === 'final'
        ? ('MENUNGGU_SUBMIT_WARGA' as const)
        : ('MENUNGGU_LOGIN_WARGA' as const);
    return keadaanUrusan;
  });
  const p = $derived(peristiwaDariJenis(data.urusan.jenis));
  const judulJenis = $derived(judulUrusan(data.urusan.jenis));
  const judul = $derived(judulJenis ?? lokal.cari(data.urusan.id)?.judul ?? 'Urusan baru');
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
  const pendampingAktif = $derived(!pendampingDitutup && sesi.data.keadaan !== 'mati');
  // Pesan agen di panel Pendamping hanya bila itu item terakhir percakapan; pertanyaan lama yang sudah
  // dijawab (mis. wilayah KTP) tidak ditampilkan lagi.
  const pesanPanel = $derived(linimasa.slice(-1).filter((x) => x.jenis === 'teks'));
  // Kartu "Setujui dan buka situs" yang bisa ditindaklanjuti (paling banyak satu).
  const konfirmasiAktif = $derived.by(() => {
    const it = linimasa.findLast((x) => x.jenis === 'konfirmasi');
    return it?.jenis === 'konfirmasi' &&
      it.terakhir &&
      !k.sedangBerjalan &&
      it.permintaan !== null &&
      (keadaanUrusan === 'MENUNGGU_KONFIRMASI' || it.permintaan.bacaSaja === true)
      ? it.key
      : null;
  });
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
    void tick().then(() => {
      // Gulir hanya percakapannya; scrollIntoView juga menggulir bingkai aplikasi dan browser di sebelahnya.
      if (daftarPercakapan) daftarPercakapan.scrollTop = daftarPercakapan.scrollHeight;
    });
  });

  // Kartu persetujuan yang baru aktif digulir ke tengah layar sekali: di HP komposer lengket menutupi bagian
  // bawah percakapan, jadi tombol "Setujui dan buka situs" tidak terlihat. Gerak halus kecuali warga memilih
  // kurangi gerakan (sistem atau Pengaturan).
  let konfirmasiDigulir: string | null = null;
  $effect(() => {
    const key = konfirmasiAktif;
    if (!key || key === konfirmasiDigulir) return;
    konfirmasiDigulir = key;
    void tick().then(() => {
      const kartu = document.querySelector<HTMLElement>(`[data-konfirmasi="${CSS.escape(key)}"]`);
      const el = kartu?.querySelector<HTMLElement>('footer') ?? kartu;
      if (!el) return;
      const tenang =
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.documentElement.dataset.gerak === 'kurang';
      const behavior = tenang ? ('auto' as const) : ('smooth' as const);
      const wadah = daftarPercakapan;
      // Laptop: percakapan punya gulir sendiri; gulir wadahnya saja agar bingkai aplikasi tidak ikut bergeser.
      if (wadah && wadah.scrollHeight > wadah.clientHeight) {
        const r = el.getBoundingClientRect();
        const w = wadah.getBoundingClientRect();
        wadah.scrollTo({ top: wadah.scrollTop + r.top - w.top - (w.height - r.height) / 2, behavior });
      } else el.scrollIntoView({ block: 'center', behavior });
    });
  });

  /**
   * Isi Ingatan warga saat ini (GET /api/ingatan): kartu menampilkan status dan isi yang SEBENARNYA dari sini, bukan
   * dari event (event hanya membawa label generik untuk catatan/aksesibilitas). null = belum/gagal dimuat.
   */
  let ingatanLive = $state<Map<string, Exclude<IngatanLive, null | undefined>> | null>(null);
  const jumlahKartuIngatan = $derived(linimasa.filter((it) => it.jenis === 'ingatan').length);

  async function muatIngatanLive(): Promise<void> {
    const r = await fetch('/api/ingatan').catch(() => null);
    if (!r?.ok) return;
    const d = (await r.json()) as IngatanResponse;
    const m = new SvelteMap<string, Exclude<IngatanLive, null | undefined>>();
    for (const b of d.butir) m.set(b.id, { status: 'butir', label: b.label });
    for (const b of d.usulan ?? []) m.set(b.id, { status: 'usulan', label: b.label });
    ingatanLive = m;
  }

  $effect(() => {
    if (jumlahKartuIngatan > 0) void untrack(() => muatIngatanLive());
  });

  const liveIngatan = (id: string): IngatanLive => (ingatanLive ? (ingatanLive.get(id) ?? null) : undefined);

  /**
   * "Batalkan"/"Tidak" di kartu ingatan: hapus butir/usulan itu, lalu muat ulang GET /api/ingatan. 404 tidak
   * dianggap "Dibatalkan": kartu menampilkan status sebenarnya dari daftar yang dimuat ulang (isi yang sama bisa
   * saja masih diingat di butir lain, mis. sesudah "Bawa ke akun").
   */
  async function batalkanIngatan(id: string): Promise<HasilBatal> {
    const r = await fetch(`/api/ingatan/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    await muatIngatanLive();
    if (r?.ok) return 'dihapus';
    return r?.status === 404 && ingatanLive !== null && !ingatanLive.has(id) ? 'tidak_ada' : 'gagal';
  }

  /** "Ya, ingat" di kartu persetujuan: usulan menjadi butir. */
  async function setujuiIngatan(id: string): Promise<boolean> {
    const r = await fetch(`/api/ingatan/${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => null);
    await muatIngatanLive();
    return ingatanLive?.get(id)?.status === 'butir' || r?.ok === true;
  }

  function judulDariPesan(t: string | undefined): string {
    if (!t) return 'Urusan baru';
    const s = t.replace(/\s+/g, ' ').trim();
    return s.length > 40 ? `${s.slice(0, 38)}…` : s;
  }

  /** Perintah tombol terakhir yang terkirim (untuk "Coba lagi"); null bila yang terakhir tulisan warga. */
  let aksiTerakhir: string | null = null;

  /** `aksi`: perintah tombol (mis. Lanjutkan), bukan tulisan warga: tidak tampil sebagai gelembung pesan. */
  async function kirim(t: string, aksi = false) {
    mengirim = true;
    pesanKomposer = null;
    const setelahSeq = k.lastSeq;
    const hasil = await store.kirim(t);
    mengirim = false;
    if (hasil === 'ok') {
      aksiTerakhir = aksi ? t : null;
      if (aksi) return;
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

  async function setujuiRencana() {
    mengirim = true;
    pesanKomposer = null;
    const hasil = await store.setujuiRencana();
    mengirim = false;
    if (hasil === 'konflik')
      pesanKomposer =
        'Urusin masih memproses langkah sebelumnya. Tunggu sebentar, lalu tekan Setujui rencana lagi.';
    else if (hasil === 'galat')
      pesanKomposer = 'Persetujuan belum tercatat. Periksa koneksi, lalu coba lagi.';
  }

  async function wilayahBenar(kodeKabKota: string) {
    mengirim = true;
    pesanKomposer = null;
    const hasil = await store.tetapkanWilayah(kodeKabKota);
    mengirim = false;
    if (hasil === 'konflik')
      pesanKomposer =
        'Wilayah belum bisa dicatat lewat kartu ini: mungkin sudah dipastikan di obrolan atau perangkat lain, atau Urusin masih bekerja. Muat ulang halaman untuk melihat yang terbaru.';
    else if (hasil === 'galat') pesanKomposer = 'Wilayah belum tercatat. Periksa koneksi, lalu coba lagi.';
  }

  function wilayahBukan() {
    teks = 'KTP saya terdaftar di ';
    komposer?.focus();
  }

  function ulangTerakhir() {
    if (aksiTerakhir) return void kirim(aksiTerakhir, true);
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
      if (permintaan) {
        pendampingDitutup = false;
        void sesi.mulai(
          permintaan.executionId,
          () => canvas,
          () => inputTeks,
        );
      }
    } catch {
      konfirmasi = null;
      konfirmasiGalat = 'Koneksi terputus. Persetujuan belum tercatat.';
    }
  }

  /**
   * "Izinkan isi" (A-M1): peramban hanya mengirim daftar write + origin tujuan. Server menyimpan persetujuan;
   * Pendamping mengambil nilai Data Diri dan berkas di server. Nilai vault tidak pernah lewat peramban.
   */
  async function izinkanIsi(pilihan?: { placeholder: string[]; berkas: string[] }) {
    izin = { sibuk: true };
    const pesan = await sesi.izinkanIsi(pilihan);
    izin = { sibuk: false, ...(pesan ? { pesan } : {}) };
  }

  function isiSendiri() {
    sesi.ambilAlih();
    sesi.data = { ...sesi.data, butuhData: null };
  }

  async function tutupPendamping() {
    if (menutupPendamping) return;
    menutupPendamping = true;
    try {
      if (await sesi.tutupSekarang()) {
        pendampingDitutup = true;
        await tick();
        komposer?.focus();
      }
    } finally {
      menutupPendamping = false;
    }
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

<div class="flex min-h-0 flex-1 flex-col lg:overflow-hidden">
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

  <div class="flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
    <!-- Panel konteks: di HP di atas percakapan dan bisa dilipat; di laptop kolom kanan 400 px. -->
    <aside
      aria-label="Rencana, dokumen, dan sumber"
      class="order-first min-h-0 border-b border-line bg-card lg:order-last lg:w-[399.5px] lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:border-b-0 lg:border-l"
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
      <div id="panel-konteks" class="{panelHpBuka ? '' : 'max-lg:hidden'} lg:min-h-full">
        <PanelKonteks
          state={keadaanPanel}
          jenis={data.urusan.jenis}
          sedangBerjalan={k.sedangBerjalan}
          rencana={k.rencana}
          checklist={k.checklist}
          {kutipan}
          bind:tab
          {sorot}
          persiapan={persiapanPendamping}
        >
          {#snippet bawah()}
            {#if pendampingAktif}
              <div class="flex flex-col gap-3 border-t border-line pt-4">
                {#each pesanPanel as it (it.key)}
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
            onbukatautan={() => sesi.bukaTautan()}
            onsudahkirim={() => sesi.sudahMengirim()}
            onhentikan={() => void sesi.hentikan()}
            ontutup={() => void tutupPendamping()}
            menutup={menutupPendamping}
            onmulailagi={() => {
              pendampingDitutup = false;
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
        <div bind:this={daftarPercakapan} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
              {:else if it.jenis === 'ingatan'}
                <KartuIngatan
                  ingatan={it.e}
                  dibatalkan={it.dibatalkan}
                  live={liveIngatan(it.e.butir.id)}
                  onbatalkan={() => batalkanIngatan(it.e.butir.id)}
                  onsetujui={() => setujuiIngatan(it.e.butir.id)}
                />
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
                  <!-- Judul cadangan berasal dari kalimat warga; hanya judul jenis yang layak disisipkan. -->
                  <p>
                    Ini rencana yang saya sarankan{judulJenis ? ` untuk ${judulJenis.toLowerCase()}` : ''}:
                  </p>
                  <KartuRencana
                    rencana={it.e}
                    kelayakan={k.kelayakan}
                    bisaSetujui={it.terakhir && keadaanUrusan === 'RENCANA_DIUSULKAN' && !k.sedangBerjalan}
                    sibuk={mengirim}
                    onsetujui={() => void setujuiRencana()}
                    onubah={ubahRencana}
                  />
                </PesanAgen>
              {:else if it.jenis === 'wilayah'}
                <PesanAgen avatar={p.avatar}>
                  <KartuWilayah
                    usulan={it.e}
                    aktif={it.terakhir &&
                      (keadaanUrusan === 'BARU' || keadaanUrusan === 'MEMAHAMI') &&
                      !k.sedangBerjalan}
                    sibuk={mengirim}
                    onbenar={() => void wilayahBenar(it.e.ktp.kodeKabKota)}
                    onbukan={wilayahBukan}
                  />
                </PesanAgen>
              {:else if it.jenis === 'checklist'}
                <PesanAgen avatar={p.avatar}><KartuChecklist checklist={it.e} /></PesanAgen>
              {:else if it.jenis === 'konfirmasi'}
                <PesanAgen avatar={p.avatar}>
                  <p>Sebelum saya membuka situs resmi, periksa dulu data yang akan diisi:</p>
                  <div data-konfirmasi={it.key}>
                    <KartuKonfirmasi
                      gate={it.gate}
                      permintaan={it.permintaan}
                      {situs}
                      aktif={it.key === konfirmasiAktif}
                      status={konfirmasi?.key === it.key ? konfirmasi.status : 'menunggu'}
                      pesanGalat={it.terakhir ? konfirmasiGalat : undefined}
                      onsetujui={() => void setujui(it.key, it.gate, it.permintaan)}
                      onbatal={() => void kirim('Batalkan, saya belum mau melanjutkan.')}
                    />
                  </div>
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
                  <KartuTerkirim
                    urusanId={data.urusan.id}
                    nomor={sesi.data.bukti?.nomor ?? data.urusan.nomorPermohonan ?? undefined}
                    {situs}
                  />
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
                onclick={() => void kirim('lanjut', true)}
                class="ml-[46px] inline-flex h-12 items-center gap-2 self-start rounded-full border border-line-2 bg-surface px-5 text-base text-ink shadow-[0_0_1px_#0000000f,0_1px_1px_#0000000f,0_2px_4px_#0000000a] hover:bg-card"
              >
                Lanjutkan <Icon name="panah" class="size-4.5" />
              </button>
            {/if}
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
  kolom={sesi.data.butuhData?.kolom}
  rencanaHash={sesi.data.butuhData?.rencanaHash}
  sibuk={izin.sibuk}
  pesan={izin.pesan}
  onizinkan={(pilihan) => void izinkanIsi(pilihan)}
  ontolak={isiSendiri}
/>
