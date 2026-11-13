<script lang="ts">
  /**
   * Ajakan kerja sama di landing (di bawah panel ajakan terakhir): pemda, instansi, dan mitra menghubungi tim
   * lewat email. Tombol utama membuka email dengan subjek terisi; alamatnya tetap terlihat dan bisa disalin.
   * CSS saja (landing tanpa JavaScript).
   */
  const email = 'hello@urusinai.web.id'; // pii-scan:allow -- kontak publik
  const mailto = `mailto:${email}?subject=${encodeURIComponent('Kerja sama Urusin')}`;
</script>

<div class="kontak" id="kontak">
  <div class="isi">
    <p class="label">Untuk pemda, instansi, dan mitra</p>
    <h2 class="judul">Mau bawa Urusin ke daerah Anda?</h2>
    <p class="sub">
      Kami terbuka untuk kerja sama layanan, integrasi portal, dan uji coba di kelurahan atau komunitas Anda.
      Ceritakan kebutuhannya, tim kami membalas langsung.
    </p>
  </div>
  <div class="aksi">
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- mailto, bukan rute -->
    <a class="tombol" href={mailto}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor">
        <rect x="3" y="5" width="18" height="14" rx="3" stroke-width="1.8" />
        <path d="m4 7 8 6 8-6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>Hubungi tim Urusin</span>
      <svg class="panah" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none">
        <path
          d="M5 12h14m-5-5 5 5-5 5"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </a>
    <p class="alamat">atau tulis ke <span>{email}</span></p>
  </div>
</div>

<style>
  .kontak {
    margin-top: 20px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 32px;
    padding: 36px 48px;
    border-radius: 28px;
    background:
      radial-gradient(120% 140% at 100% 0%, #f6dccf 0%, transparent 55%),
      radial-gradient(90% 120% at 0% 100%, #f3e9d9 0%, transparent 60%), #fbf6f0;
    outline: 1px solid var(--sb-stroke, #efe6dc);
    outline-offset: -0.5px;
  }
  .isi {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 620px;
  }
  .label {
    color: #c2410c;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .judul {
    color: var(--sb-text-primary, #252522);
    font-size: clamp(22px, 2.2vw, 30px);
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }
  .sub {
    color: var(--sb-text-body, #252522b3);
    font-size: 16px;
    line-height: 1.55;
  }
  .aksi {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .tombol {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 14px 26px;
    border-radius: 100px;
    background: var(--sb-text-primary, #252522);
    color: #fffcfa;
    font-size: 16px;
    font-weight: 500;
    white-space: nowrap;
    box-shadow:
      0 1px 2px #00000014,
      0 8px 24px -8px #25252266;
    transition: background-color 0.15s ease;
  }
  .tombol:hover {
    background-color: #3c362d;
  }
  .tombol:active {
    background-color: #4a4237;
  }
  .tombol:focus-visible {
    outline: 2px solid #c2410c;
    outline-offset: 3px;
  }
  .alamat {
    color: var(--sb-text-body, #252522b3);
    font-size: 14px;
  }
  .alamat span {
    color: var(--sb-text-primary, #252522);
    font-weight: 500;
    user-select: all;
  }
  @media (max-width: 767px) {
    .kontak {
      flex-direction: column;
      align-items: stretch;
      padding: 28px 22px;
      gap: 22px;
      border-radius: 22px;
    }
    .tombol {
      justify-content: center;
      width: 100%;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tombol {
      transition: none;
    }
  }
</style>
