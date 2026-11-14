<script lang="ts">
  import type { EventOf } from '#lib/contracts.js';
  import { tanggal } from '#lib/urusan-status.js';
  import ChipSumber from './ChipSumber.svelte';
  import TeksBertaut from '../ui/TeksBertaut.svelte';
  import TeksKaya from '../ui/TeksKaya.svelte';
  import { unikPerRef } from './linimasa.js';

  /**
   * Jawaban bersumber (App 02): tiap klaim diberi nomor kutipan [n]; chip sumber di bawah membuka situs resmi
   * dengan sorotan kalimat (Text Fragment). Kalimat tetap batas wewenang selalu tampil.
   */
  let {
    jawaban,
    balasan,
    ketik = false,
    ontumbuh,
    nomorKutipan,
    onpilih,
  }: {
    jawaban: EventOf<'grounded_answer'>;
    /**
     * Balasan akhir giliran yang sama (satu jawaban per giliran): menjadi isi pesan, klaim tidak lagi didaftar
     * dan sumbernya tetap tampil sebagai chip di bawahnya.
     */
    balasan?: string | undefined;
    ketik?: boolean;
    ontumbuh?: (() => void) | undefined;
    /** refId → nomor global di panel Sumber. */
    nomorKutipan: Map<string, number>;
    onpilih?: ((refId: string) => void) | undefined;
  } = $props();

  const kutipanUnik = $derived(unikPerRef(jawaban.klaim.flatMap((k) => k.kutipan)));
</script>

<div class="flex flex-col gap-3">
  {#if balasan}
    <TeksKaya teks={balasan} {ketik} {ontumbuh} />
  {:else}
    {#each jawaban.klaim as k, i (i)}
      <p>
        <TeksBertaut teks={k.teks} />
        {#each unikPerRef(k.kutipan) as q (q.refId)}
          <button
            type="button"
            onclick={() => onpilih?.(q.refId)}
            class="relative ml-1.5 inline-grid size-5 place-items-center rounded-md bg-primer align-[0.1em] text-xs leading-3 font-semibold text-primer-ink before:absolute before:-inset-3 before:content-['']"
            aria-label="Lihat sumber {nomorKutipan.get(q.refId) ?? ''}: {q.judul}"
            >{nomorKutipan.get(q.refId) ?? '•'}</button
          >
        {/each}
      </p>
    {/each}
  {/if}
  {#if kutipanUnik.length}
    <div class="flex flex-wrap gap-2">
      {#each kutipanUnik as q (q.refId)}
        <ChipSumber
          nomor={nomorKutipan.get(q.refId) ?? 0}
          url={q.textFragmentUrl || q.url}
          diperiksa={tanggal(q.verifiedAt) || undefined}
          perluDicekUlang={q.perluDicekUlang}
        />
      {/each}
    </div>
  {/if}
  {#if jawaban.kalimatTetap}
    <p class="text-sm leading-[21px] text-muted"><TeksBertaut teks={jawaban.kalimatTetap} /></p>
  {/if}
</div>
