<script lang="ts">
  import { page } from '$app/state';
  import LayarPendamping from '#lib/components/pendamping/LayarPendamping.svelte';
  import { dataAwal, type DataPendamping, type KeadaanLayar } from '#lib/pendamping/sesi.svelte.js';

  /**
   * Pratinjau dev untuk membandingkan dengan pen: ?keadaan=<KeadaanLayar> menampilkan satu panel seukuran
   * App 06/07 (716 px); tanpa parameter menampilkan semua keadaan papan u5rYk.
   */
  const SEMUA: KeadaanLayar[] = [
    'antre',
    'menyiapkan',
    'giliran',
    'ai',
    'dijeda',
    'selesai',
    'siaga',
    'kedaluwarsa',
    'terputus',
    'dipandu',
    'galat',
  ];
  const langkah = { indeks: 4, total: 8, label: 'Mengisi formulir' };

  function contoh(k: KeadaanLayar): DataPendamping {
    const d: DataPendamping = {
      ...dataAwal(),
      keadaan: k,
      mode: k === 'dijeda' || k === 'siaga' ? 'takeover' : k === 'selesai' ? 'done' : 'ai',
    };
    if (k === 'antre') d.antrean = { posisi: 2, panjang: 3 };
    if (k === 'ai' || k === 'dijeda' || k === 'terputus') d.langkah = langkah;
    if (k === 'giliran') {
      d.mode = 'takeover';
      d.langkah = { indeks: 7, total: 8, label: 'Formulir terisi' };
      d.giliran = {
        jenis: 'giliran_anda',
        alasan: 'final',
        pesan: 'AI berhenti di sini dan tidak bisa menekan Kirim.',
      };
    }
    if (k === 'selesai' || k === 'siaga') d.bukti = { nomor: 'CONTOH-0001' };
    return d;
  }

  const satu = $derived(page.url.searchParams.get('keadaan') as KeadaanLayar | null);
  const daftar = $derived(satu ? [satu] : SEMUA);
  const noop = () => {};
</script>

<div class="flex flex-wrap gap-8 bg-bg p-8">
  {#each daftar as k (k)}
    <div class="flex w-[716px] max-w-full flex-col gap-2" data-keadaan={k}>
      {#if !satu}<p class="text-sm font-semibold text-ink">{k}</p>{/if}
      <div class={satu ? 'h-[min(820px,80dvh)]' : 'h-[520px]'}>
        <LayarPendamping
          data={contoh(k)}
          situs="https://contoh-layanan.go.id"
          instansi="Contoh instansi"
          onambilalih={noop}
          onkembalikan={noop}
          onhentikan={noop}
          ontutup={noop}
          onmulailagi={noop}
          onpanduan={noop}
        />
      </div>
    </div>
  {/each}
</div>
