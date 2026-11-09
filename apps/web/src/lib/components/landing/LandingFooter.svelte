<script lang="ts">
  import { resolve } from '$app/paths';
  import mark from '#lib/assets/img/pen-landing/urusin-mark-52.webp';

  /**
   * Footer situs publik dari frame pen Rafi (n2rpg / F6RSq). Gaya di landing-pen.css (kelas lpN). Tautan Produk
   * dan Bantuan menuju halaman Web; `diLanding` = "Sumber rujukan" berupa jangkar halaman ini.
   */
  let { diLanding = false }: { diLanding?: boolean } = $props();
  const ke = (jangkar: string) => (diLanding ? `#${jangkar}` : `${resolve('/')}#${jangkar}`);
</script>

<footer class="n-footer lp295">
  <div class="n-top lp296">
    <div class="lp297">
      <div class="lp4">
        <img class="lp5" src={mark} alt="" width="26" height="26" loading="lazy" decoding="async" />
        <div class="lp298">Urusin</div>
      </div>
      <div class="lp299">
        © 2026 Urusin.
        <br />
        Bukan situs pemerintah.
      </div>
    </div>
    <div class="n-columns lp300">
      <div class="lp301">
        <div class="lp299">Produk</div>
        <!-- eslint-disable svelte/no-navigation-without-resolve -- `ke()` sudah memakai resolve('/') -->
        <a class="lp302" href={resolve('/cara-kerja')}> Cara kerja </a>
        <a class="lp302" href={resolve('/urusan')}> Urusan </a>
        <a class="lp302" href={resolve('/cara-kerja')}> Browser Pendamping </a>
      </div>
      <div class="lp301">
        <div class="lp299">Bantuan</div>
        <a class="lp302" href={resolve('/tanya-jawab')}> Tanya jawab </a>
        <a class="lp302" href={resolve('/bantuan')}> Hubungi kami </a>
        <a class="lp302" href={resolve('/urusan')}> Untuk keluarga </a>
      </div>
      <div class="lp301">
        <div class="lp299">Tentang</div>
        <div class="lp302">Tentang kami</div>
        <a class="lp302" href={resolve('/privasi')}> Privasi </a>
        <a class="lp302" href={ke('privasi')}> Sumber rujukan </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      </div>
    </div>
  </div>
  <div class="n-bottom lp303">
    <a class="lp304" href={resolve('/privasi')}> Kebijakan privasi </a>
    <div class="lp304">Syarat layanan</div>
    <a class="lp304" href={resolve('/pengaturan')}> Hapus data saya </a>
  </div>
</footer>
