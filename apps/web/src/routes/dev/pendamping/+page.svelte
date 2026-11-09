<script lang="ts">
  import { page } from '$app/state';
  import LayarPendamping from '#lib/components/pendamping/LayarPendamping.svelte';
  import LembarIzinkan from '#lib/components/pendamping/LembarIzinkan.svelte';
  import { dataAwal, type DataPendamping } from '#lib/pendamping/sesi.svelte.js';

  /** Pratinjau dev: ?keadaan=izin|giliran|dipandu untuk membandingkan dengan frame rFa2b/UGOeh. */
  const keadaan = $derived(page.url.searchParams.get('keadaan') ?? 'giliran');
  const data = $derived<DataPendamping>(
    keadaan === 'dipandu'
      ? { ...dataAwal(), keadaan: 'dipandu' }
      : {
          ...dataAwal(),
          keadaan: 'giliran',
          mode: 'takeover',
          langkah: { indeks: 2, total: 5, label: 'Verifikasi nomor HP' },
          giliran: {
            jenis: 'giliran_anda',
            alasan: 'login',
            pesan: 'Situs meminta kode OTP. Masukkan sendiri pada tab resmi yang sedang terbuka.',
          },
        },
  );
  const noop = () => {};
</script>

<div class="mx-auto flex min-h-dvh max-w-[27rem] flex-col p-4">
  <LayarPendamping
    {data}
    situs="https://contoh-layanan.go.id"
    instansi="Contoh instansi"
    urusanId={`u_${'0'.repeat(32)}`}
    onambilalih={noop}
    onkembalikan={noop}
    onhentikan={noop}
    onmulailagi={noop}
    onpanduan={noop}
  />
</div>

<LembarIzinkan
  buka={keadaan === 'izin'}
  placeholder={['{{WARGA.NAMA_LENGKAP}}', '{{WARGA.NIK}}']}
  berkas={[]}
  onizinkan={noop}
  ontolak={noop}
/>
