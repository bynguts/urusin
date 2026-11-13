<script lang="ts">
  import { onMount } from 'svelte';
  import Tautan from './Tautan.svelte';
  import { gerakDikurangi } from '#lib/gerak.js';
  import { panjangTeksKaya, potongTeksKaya, uraiTeksKaya, type Daftar, type Inline } from '#lib/teks-kaya.js';

  /**
   * Jawaban AI berformat ringan (paragraf, daftar, tebal, judul kecil) tanpa {@html}: lihat `teks-kaya.ts`.
   * `ketik`: pesan baru di sesi ini diungkap bertahap per kata (≤ ±1,1 dtk, berapa pun panjangnya); struktur
   * Markdown utuh sejak kata pertama. Selama mengetik `aria-busy` agar pembaca layar membaca pesan utuh sekali.
   * `ontumbuh` dipanggil tiap kali isi bertambah (halaman menggulir ke bawah).
   */
  let {
    teks,
    ketik = false,
    ontumbuh,
    class: kelas = '',
  }: { teks: string; ketik?: boolean; ontumbuh?: () => void; class?: string } = $props();

  const blok = $derived(uraiTeksKaya(teks));
  let tampil = $state<number | null>(null);
  const terlihat = $derived(tampil === null ? blok : potongTeksKaya(blok, tampil));

  onMount(() => {
    if (!ketik || gerakDikurangi()) return;
    tampil = 0;
    let awal: number | null = null;
    let id = 0;
    const langkah = (t: number) => {
      awal ??= t;
      const total = panjangTeksKaya(blok);
      const durasi = Math.min(1100, Math.max(320, total * 12));
      const p = Math.min(1, (t - awal) / durasi);
      tampil = p >= 1 ? null : Math.ceil(total * (1 - (1 - p) ** 2));
      ontumbuh?.();
      if (tampil !== null) id = requestAnimationFrame(langkah);
    };
    id = requestAnimationFrame(langkah);
    return () => cancelAnimationFrame(id);
  });
</script>

{#snippet inline(isi: Inline[])}{#each isi as t, i (i)}{#if t.jenis === 'tebal'}<strong
        class="font-semibold text-ink">{@render inline(t.isi)}</strong
      >{:else if t.jenis === 'miring'}<em>{@render inline(t.isi)}</em>{:else if t.jenis === 'kode'}<code
        class="rounded-md bg-bg-2 px-1.5 py-0.5 font-mono text-[0.875em] break-words">{t.teks}</code
      >{:else if t.jenis === 'tautan'}<Tautan href={t.href}>{t.teks}</Tautan
      >{:else}{t.teks}{/if}{/each}{/snippet}

{#snippet baris(isi: Inline[][])}{#each isi as l, i (i)}{#if i > 0}<br />{/if}{@render inline(
      l,
    )}{/each}{/snippet}

{#snippet daftar(d: Daftar)}
  {#if d.urut}
    <!-- Nomor digambar sendiri: ::marker memakai angka tabular font merek yang tampak seperti monospace. -->
    <ol start={d.mulai} role="list" class="list-none space-y-1.5">
      {#each d.butir as b, i (i)}
        <li class="flex gap-2">
          <span aria-hidden="true" class="min-w-[1.5em] shrink-0 text-right text-muted">{d.mulai + i}.</span>
          <div class="min-w-0 flex-1">
            {@render inline(b.isi)}
            {#if b.anak}<div class="mt-1.5">{@render daftar(b.anak)}</div>{/if}
          </div>
        </li>
      {/each}
    </ol>
  {:else}
    <ul class="list-disc space-y-1.5 pl-6 marker:text-muted">
      {#each d.butir as b, i (i)}
        <li class="pl-1">
          {@render inline(b.isi)}
          {#if b.anak}<div class="mt-1.5">{@render daftar(b.anak)}</div>{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<div
  data-teks-kaya
  aria-busy={tampil !== null || undefined}
  class="flex min-w-0 flex-col gap-3 leading-relaxed break-words {kelas}"
>
  {#each terlihat as b, i (i)}
    {#if b.jenis === 'paragraf'}
      <p>{@render baris(b.baris)}</p>
    {:else if b.jenis === 'judul'}
      <h3 class="mt-1 text-[1em] leading-snug font-semibold text-ink">{@render inline(b.isi)}</h3>
    {:else if b.jenis === 'daftar'}
      {@render daftar(b)}
    {:else if b.jenis === 'kutipan'}
      <blockquote class="border-l-[3px] border-line-2 pl-3 text-body">{@render baris(b.baris)}</blockquote>
    {:else if b.jenis === 'kodeblok'}
      <pre
        class="overflow-x-auto rounded-xl bg-bg-2 p-3 font-mono text-sm leading-normal whitespace-pre"><code
          >{b.teks}</code
        ></pre>
    {:else}
      <hr class="border-line" />
    {/if}
  {/each}
</div>
