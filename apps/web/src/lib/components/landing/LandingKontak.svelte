<script lang="ts">
  /**
   * Ajakan kerja sama di landing (di bawah panel ajakan terakhir): pemda, instansi, dan mitra menghubungi tim
   * lewat email. Memakai bahasa visual landing yang sudah ada: kartu krem bergaris tipis seperti panel ajakan
   * (lp275), badge pil putih seperti lp277, dan pasangan tombol landing (lp58 hitam, lp20 putih) sehingga
   * ukuran, huruf, dan hover-nya sama persis. CSS saja (landing tanpa JavaScript).
   */
  const email = 'hello@urusinai.web.id'; // pii-scan:allow -- kontak publik
  const mailto = `mailto:${email}?subject=${encodeURIComponent('Kerja sama Urusin')}`;
</script>

<div class="kontak" id="kontak">
  <div class="isi">
    <div class="badge">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor">
        <path
          d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>Untuk pemda, instansi, dan mitra</span>
    </div>
    <h2 class="judul">Mau bawa Urusin ke daerah Anda?</h2>
    <p class="sub">
      Kami terbuka untuk kerja sama layanan, integrasi portal, dan uji coba di kelurahan atau komunitas Anda.
    </p>
  </div>
  <div class="aksi">
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- mailto, bukan rute -->
    <a class="lp58" href={mailto}>
      <span class="lp59">Hubungi tim Urusin</span>
      <svg data-ikon="panah" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none">
        <path
          d="M5 12h14m-5-5 5 5-5 5"
          stroke="#fffcfa"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </a>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- mailto, bukan rute -->
    <a class="lp20" href={mailto}>
      <span class="lp21">{email}</span>
    </a>
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
    padding: 40px 56px;
    border-radius: 28px;
    background-color: var(--sb-bg-card, #fcf8f5);
    outline: 1px solid var(--sb-stroke, #efe6dc);
    outline-offset: -0.5px;
  }
  .isi {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    max-width: 620px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px 5px 10px;
    border-radius: 100px;
    background-color: #ffffffb3;
    outline: 1px solid var(--sb-stroke, #efe6dc);
    outline-offset: -0.5px;
    color: var(--sb-text-card, #252522d1);
    font-size: 13px;
    font-weight: 500;
    line-height: 1.4;
  }
  .badge svg {
    color: #c2410c;
    flex-shrink: 0;
  }
  .judul {
    color: var(--sb-text-primary, #252522);
    font-size: clamp(24px, 2.4vw, 34px);
    font-weight: 500;
    letter-spacing: -0.034em;
    line-height: 1.1;
  }
  .sub {
    color: var(--sb-text-body, #252522b3);
    font-size: 17px;
    line-height: 1.53;
  }
  .aksi {
    display: grid;
    grid-auto-rows: 1fr;
    gap: 10px;
    flex-shrink: 0;
  }
  .aksi > a {
    width: 100%;
    min-height: 48px;
  }
  .aksi svg {
    flex-shrink: 0;
  }
  @media (max-width: 767px) {
    .kontak {
      flex-direction: column;
      align-items: stretch;
      padding: 28px 20px;
      gap: 24px;
      border-radius: 22px;
    }
    .aksi .lp21 {
      white-space: normal;
      overflow-wrap: anywhere;
    }
  }
</style>
