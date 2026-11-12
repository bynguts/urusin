<script lang="ts">
  import { resolve } from '$app/paths';
  import mark from '#lib/assets/img/pen-landing/urusin-mark-52.webp';

  /**
   * Footer situs publik dari frame pen Rafi (n2rpg / F6RSq). Gaya di landing-pen.css (kelas lpN). Tautan Produk
   * dan Bantuan menuju halaman Web; `diLanding` = "Sumber rujukan" berupa jangkar halaman ini.
   */
</script>

<footer class="n-footer lp295">
  <div class="n-top lp296">
    <div class="lp297">
      <div class="lp4">
        <img class="lp5" src={mark} alt="" width="26" height="26" loading="lazy" decoding="async" />
        <div class="lp298">Urusin</div>
      </div>
      <div class="lp299">© 2026 Urusin.</div>
    </div>
    <div class="n-columns lp300">
      <div class="lp301">
        <div class="lp299">Produk</div>
        <!-- eslint-disable svelte/no-navigation-without-resolve -- `ke()` sudah memakai resolve('/') -->
        <a class="lp302" href={resolve('/cara-kerja')}> Cara kerja </a>
        <a class="lp302" href={resolve('/urusan')}> Urusan </a>
      </div>
      <div class="lp301">
        <div class="lp299">Bantuan</div>
        <a class="lp302" href={resolve('/tanya-jawab')}> Tanya jawab </a>
        <a class="lp302" href={resolve('/bantuan')}> Panduan penggunaan </a>
      </div>
      <div class="lp301">
        <div class="lp299">Tentang</div>
        <span class="lp302">Tim Urusin · LOGICODIX 2026</span>
        <a class="lp302" href="{resolve('/privasi')}#sumber-informasi">Sumber rujukan</a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      </div>
    </div>
  </div>
  <div class="n-bottom lp303">
    <a class="lp304" href={resolve('/privasi')}> Kebijakan privasi </a>
    <a class="lp304" href={resolve('/syarat')}> Syarat layanan </a>
  </div>
</footer>
