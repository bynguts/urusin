/*
 * Inisialisasi dan pengalih tema Urusin (data-theme: light | dark).
 * Dijalankan sesegera mungkin di <head> untuk mencegah FOUC (flash of unstyled content).
 * Bekerja selaras dengan PrefsStore (kunci localStorage 'urusin.prefs.v1').
 */
(function () {
  const KUNCI = 'urusin.prefs.v1';

  function ambilTemaTersimpan() {
    try {
      const raw = localStorage.getItem(KUNCI);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && (p.tema === 'gelap' || p.tema === 'terang')) {
          return p.tema === 'gelap' ? 'dark' : 'light';
        }
      }
    } catch {
      // Abaikan bila localStorage tidak tersedia atau JSON rusak
    }
    return 'light';
  }

  function terapkanTema(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#191a18' : '#f7f2ed');
    }
  }

  // Terapkan langsung saat script dimuat (sebelum DOM render)
  terapkanTema(ambilTemaTersimpan());

  // Tangani klik tombol pengalih tema di landing atau elemen ber-atribut data-toggle-tema
  document.addEventListener('click', function (e) {
    const target = e.target;
    if (!target) return;
    const btn = target.closest('#btn-tema-landing, [data-toggle-tema]');
    if (!btn) return;

    e.preventDefault();
    const sekarang = document.documentElement.getAttribute('data-theme') || 'light';
    const baru = sekarang === 'dark' ? 'light' : 'dark';
    terapkanTema(baru);

    // Perbarui label aksesibilitas tombol
    const label = baru === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);

    // Simpan ke localStorage sesuai skema Prefs Urusin
    try {
      const raw = localStorage.getItem(KUNCI);
      const p = raw ? JSON.parse(raw) : {};
      p.tema = baru === 'dark' ? 'gelap' : 'terang';
      localStorage.setItem(KUNCI, JSON.stringify(p));
      // Picu storage event untuk komponen yang berlangganan
      window.dispatchEvent(new Event('storage'));
    } catch {
      // Abaikan bila localStorage tidak tersedia atau JSON rusak
    }
  });
})();
