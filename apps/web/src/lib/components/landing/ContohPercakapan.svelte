<script lang="ts">
  import Icon from '../Icon.svelte';
</script>

<div class="contoh" aria-label="Contoh percakapan dengan Urusin">
  <p class="keterangan">Contoh percakapan</p>
  <div class="pesan warga">KK saya hilang, harus mulai dari mana?</div>
  <div class="pesan rose">
    <strong>Urusin</strong>
    <p>Kita pastikan dulu daerah pengurusannya. KK Anda terdaftar di kabupaten atau kota mana?</p>
  </div>
  <div class="pesan warga">Kota Surabaya.</div>
  <div class="pesan rose">
    <strong>Urusin</strong>
    <p>
      Saya akan mencari persyaratan dari sumber resmi untuk Kota Surabaya, lalu membantu menyusun langkah dan
      daftar dokumennya.
    </p>
  </div>
  <div class="petunjuk">
    <Icon name="tautan-luar" class="size-4 shrink-0" />Periksa rujukan melalui tautan pada jawaban
  </div>
</div>

<style>
  .contoh {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    padding: 32px;
    background: var(--sb-bg-white);
    text-align: left;
    font-size: 16px;
    line-height: 1.6;
  }
  .keterangan {
    color: var(--sb-text-body);
    font-size: 14px;
  }
  .pesan {
    max-width: 80%;
    padding: 14px 18px;
    border-radius: 16px;
    color: var(--sb-text-primary);
  }
  .warga {
    align-self: flex-end;
    background: var(--sb-bg-secondary);
  }
  .rose {
    align-self: flex-start;
    padding-left: 0;
  }
  .rose strong {
    display: block;
    margin-bottom: 4px;
    font-weight: 600;
  }
  .petunjuk {
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--sb-stroke);
    padding-top: 16px;
    font-size: 14px;
    color: var(--sb-text-body);
  }
  @media (max-width: 639px) {
    .contoh {
      padding: 20px;
      font-size: 14px;
      gap: 12px;
    }
    .pesan {
      max-width: 94%;
      padding: 10px 14px;
    }
  }
</style>
