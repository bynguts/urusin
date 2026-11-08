# @urusin/contracts

Kontrak zod-first antara server dan UI (tipe `ekstensi` dibekukan di contracts-take1; ekstensi sudah dihapus): event SSE, skema endpoint, bentuk store, dan fixture per layar x state.
Semua nama memakai bahasa Indonesia. Setelah tag `contracts-take1` dibuat, perubahan hanya boleh menambah (diperiksa CI).

## Isi

| Berkas               | Isi                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `src/events.ts`      | `UrusinEventSchema`: union bertanda `type`; setiap event membawa `seq`, `at`, `chainHead` |
| `src/api.ts`         | Skema request/response tiap endpoint + `ENDPOINT` (metode, path, status)                  |
| `src/stores.ts`      | Interface store (urusan, capabilities, connectivity, prefs, tts, vault, dompet, ekstensi) |
| `src/common.ts`      | State urusan, tier, sumber, bentuk galat seragam `{kode, pesanWarga}`                     |
| `fixtures/<layar>/*` | JSON per layar x state; `skema` menunjuk skema yang divalidasi tes                        |

## Aturan impor di komponen Svelte

Klien hanya boleh `import type`. Skema zod (nilai runtime) hanya diimpor dari kode server, karena zod menambah bobot bundel.
Di `apps/web`, `#lib/contracts.js` sudah me-re-export seluruh paket sebagai tipe.

```svelte
<script lang="ts">
  import type { UrusinEvent } from '#lib/contracts.js';
  import { UrusanStore } from '#lib/stores/urusan.svelte';

  const urusan = new UrusanStore();
  let { id }: { id: string } = $props();
  $effect(() => {
    urusan.sambung(id); // SSE + sambung ulang + Last-Event-ID
    return () => urusan.putus();
  });
  const k = $derived(urusan.keadaan);
</script>

{#if k.progres}<p>{k.progres}</p>{/if}
{#if k.jawaban}
  {#each k.jawaban.klaim as klaim}
    <p>{klaim.teks}</p>
    {#each klaim.kutipan as c}<a href={c.textFragmentUrl}>{c.judul}</a>{/each}
  {/each}
{:else if k.handoff}
  <p>{k.handoff.alasan}</p>
{/if}
{#if k.gate}<p>{k.gate.pesan}</p>{/if}
```

## Mendesain dari fixture (tanpa server agen)

- Jalankan `pnpm --filter @urusin/web dev`, lalu buka `GET /dev/fixtures/sse?skenario=urusan/jawaban-bersumber`
  (daftar skenario: tanpa parameter; `&jeda=300` mengatur jeda antar event; menghormati `Last-Event-ID`).
  Rute ini 404 di produksi.
- Fixture non-SSE (`skema` bukan `sse`) adalah response endpoint atau keadaan layar; baca langsung dari
  `packages/contracts/fixtures/<layar>/<state>.json` (ekspor `@urusin/contracts/fixtures/*`).
- `fixtures/rekaman/*` direkam dari alur nyata harness dengan provider palsu: `pnpm --filter @urusin/harness record:fixtures`.

## Jaminan di CI

- Setiap fixture lolos skemanya (`src/contracts.test.ts`).
- Setiap event yang dipancarkan harness di tes (12 tugas eval) lolos `UrusinEventSchema`
  dan identik dengan jalur replay tabel `events` (`packages/harness/src/contract.test.ts`).
