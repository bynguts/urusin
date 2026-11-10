// Klien HTTP yang meniru peramban warga (apps/web/src/lib/stores/urusan.svelte.ts + beranda):
//   - pesan pertama lewat form action Beranda `?/mulai` (use:enhance, header x-sveltekit-action) dengan
//     `kodeKabKota` tersembunyi = wilayah perangkat (WILAYAH_AWAL di lib/stores/lokal.svelte.ts bila belum diubah);
//   - pesan berikutnya lewat POST /api/urusan/[id]/turn {teks, expectedVersion} (pulih dari 409 seperti UI);
//   - "Setujui rencana" lewat POST /api/urusan/[id]/rencana/setujui;
//   - satu koneksi SSE /api/urusan/[id]/stream selama percakapan (Last-Event-ID saat sambung ulang).

export class SesiWarga {
  /** @param {{origin: string, ip: string}} o */
  constructor({ origin, ip }) {
    this.origin = origin;
    this.ip = ip;
    this.cookie = new Map();
    this.id = null;
    this.version = 0;
    this.events = [];
    this.lastSeq = 0;
    this.penunggu = [];
    this.aliran = null;
  }

  header(extra = {}) {
    const cookie = [...this.cookie].map(([k, v]) => `${k}=${v}`).join('; ');
    return {
      origin: this.origin,
      'x-forwarded-proto': 'http',
      'x-forwarded-for': this.ip,
      ...(cookie ? { cookie } : {}),
      ...extra,
    };
  }

  simpanCookie(res) {
    const daftar = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of daftar) {
      const [pasangan] = c.split(';');
      const i = pasangan.indexOf('=');
      if (i > 0) this.cookie.set(pasangan.slice(0, i).trim(), pasangan.slice(i + 1).trim());
    }
  }

  async http(path, init = {}) {
    const res = await fetch(`${this.origin}${path}`, { ...init, headers: this.header(init.headers) });
    this.simpanCookie(res);
    return res;
  }

  /** Pesan pertama dari kotak cerita Beranda. Mengembalikan { status, kode?, pesanWarga? }. */
  async mulai(pesan, kodeKabKota) {
    const form = new URLSearchParams({ pesan, kodeKabKota: kodeKabKota ?? '' });
    const res = await this.http('/beranda?/mulai', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-sveltekit-action': 'true',
        accept: 'application/json',
      },
      body: form.toString(),
    });
    const teks = await res.text();
    let j = {};
    try {
      j = JSON.parse(teks);
    } catch {
      // bukan JSON (mis. halaman galat)
    }
    if (j.type === 'redirect' && /\/urusan\/(u_[0-9a-f]{32})/.test(j.location ?? '')) {
      this.id = j.location.match(/u_[0-9a-f]{32}/)[0];
      this.sambung();
      return { status: 303 };
    }
    const pesanWarga = String(j.data ?? teks).match(/pesanWarga[^A-Za-z]+([^"\\]+)/)?.[1];
    return { status: j.status ?? res.status, kode: j.type ?? 'GAGAL_MULAI', pesanWarga };
  }

  /** Buka SSE (sekali); event ditimbun di `this.events`. Sambung ulang otomatis dengan Last-Event-ID. */
  sambung() {
    if (this.aliran) return;
    const ctrl = new AbortController();
    this.aliran = ctrl;
    const loop = async () => {
      while (!ctrl.signal.aborted) {
        try {
          const res = await fetch(`${this.origin}/api/urusan/${this.id}/stream?lastEventId=${this.lastSeq}`, {
            headers: this.header({ accept: 'text/event-stream' }),
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          const dek = new TextDecoder();
          let buf = '';
          for await (const potong of res.body) {
            buf += dek.decode(potong, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              this.terimaFrame(buf.slice(0, i));
              buf = buf.slice(i + 2);
            }
          }
        } catch {
          if (ctrl.signal.aborted) return;
        }
        await new Promise((ok) => setTimeout(ok, 500));
      }
    };
    void loop();
  }

  terimaFrame(frame) {
    const data = frame
      .split('\n')
      .filter((b) => b.startsWith('data:'))
      .map((b) => b.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    let ev;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.type === 'heartbeat') {
      this.beri({ heartbeat: true });
      return;
    }
    if (ev.seq <= this.lastSeq) return;
    this.lastSeq = ev.seq;
    this.events.push(ev);
    if (ev.type === 'done' && typeof ev.version === 'number') this.version = ev.version;
    if (ev.type === 'state' && typeof ev.version === 'number')
      this.version = Math.max(this.version, ev.version);
    this.beri(ev);
  }

  beri(sinyal) {
    for (const p of [...this.penunggu]) if (p.cocok(sinyal)) p.ok(sinyal);
  }

  /** Tunggu sinyal yang memenuhi `cocok` (event atau heartbeat) atau habis waktu. */
  tunggu(cocok, ms) {
    return new Promise((ok) => {
      const p = {
        cocok,
        ok: (v) => {
          clearTimeout(t);
          this.penunggu = this.penunggu.filter((x) => x !== p);
          ok(v);
        },
      };
      const t = setTimeout(() => p.ok(null), ms);
      this.penunggu.push(p);
    });
  }

  /** Event sejak seq tertentu. */
  sejak(seq) {
    return this.events.filter((e) => e.seq > seq);
  }

  /** Tunggu turn (yang sudah diklaim) selesai: event `done`. Turn pertama dari form: done pertama. */
  async tungguDone(seqAwal, turnId, ms = 180_000) {
    const sudah = this.sejak(seqAwal).find((e) => e.type === 'done' && (!turnId || e.turnId === turnId));
    if (sudah) return sudah;
    return this.tunggu((e) => e.type === 'done' && e.seq > seqAwal && (!turnId || e.turnId === turnId), ms);
  }

  async status() {
    const res = await this.http(`/api/urusan/${this.id}`);
    return res.ok ? res.json() : null;
  }

  /** Kirim pesan warga seperti `kirim()` di UI. Mengembalikan { http, seqAwal, done }. */
  async kirim(teks) {
    const seqAwal = this.lastSeq;
    const kirimTurn = () =>
      this.http(`/api/urusan/${this.id}/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teks, expectedVersion: this.version }),
      });
    let res = await kirimTurn();
    if (res.status === 409) {
      const st = await this.status();
      if (st && !st.berjalan) {
        this.version = st.version;
        res = await kirimTurn();
      }
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      return { http: { status: res.status, kode: j.kode, pesanWarga: j.pesanWarga }, seqAwal, done: null };
    const done = await this.tungguDone(seqAwal, j.turnId);
    return { http: { status: res.status }, seqAwal, done };
  }

  /** Klik "Setujui rencana". Event hasilnya diterbitkan sinkron; tunggu heartbeat agar semua sudah diterima. */
  setujuiRencana() {
    return this.aksi('rencana/setujui', {});
  }

  /**
   * Klik "Ya, betul" di kartu wilayah (feat/wilayah-dulu): POST /api/urusan/[id]/wilayah {kodeKabKota}. Opsi versi /
   * kirim ulang mengikuti UrusanStore cabang yang diuji (lihat `opsiAksiWilayah`).
   */
  tetapkanWilayah(kodeKabKota, opsi = { versi: true, ulang: true }) {
    return this.aksi('wilayah', { kodeKabKota }, opsi);
  }

  /** "Masuk sebagai juri" (akun demo berisi Data Diri sintetis), seperti juri di final. Turnstile mode fixture. */
  async masukJuri() {
    const res = await this.http('/api/akun/juri', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }),
    });
    return { status: res.status, kode: (await res.json().catch(() => ({}))).kode };
  }

  /** Aksi terstruktur seperti UrusanStore.aksi: versi terbaru, 409 → ambil status lalu coba sekali lagi. */
  async aksi(jalur, isi, { versi = true, ulang = true } = {}) {
    const seqAwal = this.lastSeq;
    const kirim = () =>
      this.http(`/api/urusan/${this.id}/${jalur}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(versi ? { ...isi, expectedVersion: this.version } : isi),
      });
    let res = await kirim();
    if (res.status === 409 && ulang) {
      const st = await this.status();
      if (st && !st.berjalan) {
        this.version = st.version;
        res = await kirim();
      }
    }
    const j = await res.json().catch(() => ({}));
    if (res.ok && typeof j.version === 'number') this.version = Math.max(this.version, j.version);
    await this.tunggu((s) => s.heartbeat === true, 5_000);
    await this.tunggu((s) => s.heartbeat === true, 5_000);
    return { http: { status: res.status, kode: j.kode, pesanWarga: j.pesanWarga }, seqAwal, body: j };
  }

  /** Kode kab/kota yang tercatat pada urusan (GET /api/urusan?ids=). */
  async kodeUrusan() {
    const res = await this.http(`/api/urusan?ids=${this.id}`);
    const j = await res.json().catch(() => ({}));
    return j.urusan?.[0]?.kodeKabKota ?? null;
  }

  tutup() {
    this.aliran?.abort();
  }
}

/**
 * Cara UI cabang yang diuji mengirim "Ya, betul": c869666 memakai aksi biasa (versi + kirim ulang setelah 409);
 * kepala feat/wilayah-dulu sesudahnya `aksi('wilayah', ..., { versi: false, ulang: false })` agar kartu basi tidak
 * menimpa wilayah. Dibaca dari apps/web/src/lib/stores/urusan.svelte.ts worktree yang diuji.
 */
export function opsiAksiWilayah(sumberStore) {
  const baris = sumberStore.split('\n').find((b) => b.includes("aksi('wilayah'")) ?? '';
  return { versi: !/versi:\s*false/.test(baris), ulang: !/ulang:\s*false/.test(baris) };
}
