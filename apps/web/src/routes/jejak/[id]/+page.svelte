<script lang="ts">
  import { resolve } from '$app/paths';
  import type { JejakItem, UrusanState } from '#lib/contracts.js';
  import Icon from '#lib/components/Icon.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
  import Chip, { type Nada } from '#lib/components/ui/Chip.svelte';
  import type { NamaIkon } from '#lib/components/ikon.js';
  import { labelProgres } from '#lib/components/urusan/linimasa.js';
  import { judulUrusan } from '#lib/peristiwa.js';
  import { LABEL_STATE, waktuSingkat } from '#lib/urusan-status.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  type ItemEvent = Extract<JejakItem, { jenis: 'event' }>;
  const j = $derived(data.jejak);
  const judul = $derived(judulUrusan(data.jenis) ?? 'Urusan');
  const events = $derived(
    j.timeline.filter(
      (t): t is ItemEvent => t.jenis === 'event' && t.type !== 'done' && t.type !== 'heartbeat',
    ),
  );
  const spans = $derived(j.timeline.filter((t) => t.jenis === 'span'));

  const PELAKU: Record<'anda' | 'ai' | 'urusin', { label: string; nada: Nada; ikon: NamaIkon }> = {
    anda: { label: 'Anda', nada: 'anda', ikon: 'orang' },
    ai: { label: 'AI', nada: 'ai', ikon: 'ai' },
    urusin: { label: 'Urusin', nada: 'urusin', ikon: 'sistem' },
  };

  function baris(e: ItemEvent): { pelaku: keyof typeof PELAKU; teks: string } {
    switch (e.type) {
      case 'state': {
        const [dari, ke] = e.ringkas.split(' → ') as [UrusanState, UrusanState | undefined];
        const tujuan = (ke ?? dari) as UrusanState;
        return { pelaku: 'urusin', teks: `Status menjadi: ${LABEL_STATE[tujuan] ?? e.ringkas}` };
      }
      case 'progress':
        return /Anda/.test(e.ringkas)
          ? { pelaku: 'anda', teks: e.ringkas }
          : { pelaku: 'ai', teks: labelProgres(e.ringkas).replace(/…$/, '') };
      case 'grounded_answer':
        return { pelaku: 'ai', teks: 'Menjawab dengan kutipan sumber resmi' };
      case 'handoff':
        return { pelaku: 'ai', teks: 'Mengarahkan ke kanal resmi karena sumber belum cukup' };
      case 'plan_card':
        return { pelaku: 'ai', teks: 'Menyusun rencana' };
      case 'checklist':
        return { pelaku: 'ai', teks: 'Memeriksa dokumen' };
      case 'eligibility':
        return { pelaku: 'ai', teks: 'Memeriksa kemungkinan memenuhi syarat' };
      case 'execution_request':
        return { pelaku: 'ai', teks: 'Meminta izin mengisi formulir' };
      case 'gate':
        return { pelaku: 'urusin', teks: 'Menunggu bagian Anda' };
      case 'policy_gate':
        return {
          pelaku: 'urusin',
          teks: /^(izinkan|allow)/i.test(e.ringkas)
            ? 'Pagar keamanan memeriksa langkah: aman'
            : 'Pagar keamanan menahan satu langkah',
        };
      case 'assistant_text':
        return { pelaku: 'ai', teks: 'Membalas pesan' };
      case 'degraded':
        return { pelaku: 'urusin', teks: 'Mode hemat aktif' };
      case 'timeout':
        return { pelaku: 'urusin', teks: 'Waktu menjawab habis' };
      case 'error':
        return { pelaku: 'urusin', teks: e.ringkas.split(': ').slice(1).join(': ') || 'Terjadi kendala' };
      default:
        return { pelaku: 'urusin', teks: e.ringkas };
    }
  }

  const jam = (iso: string) =>
    new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
</script>

<svelte:head><title>Jejak {judul} · Urusin</title></svelte:head>

<HeaderHalaman judul="{judul} / Jejak">
  {#snippet awal()}
    <a
      href={resolve('/urusan/[id]', { id: j.urusanId })}
      class="grid size-12 place-items-center rounded-full hover:bg-bg-2"
      aria-label="Kembali ke urusan"><Icon name="panah-kiri" class="size-5" /></a
    >
  {/snippet}
</HeaderHalaman>

<div class="mx-auto w-full max-w-[67rem] px-4 py-6 sm:px-8 lg:py-8">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="max-w-2xl">
      <h2 class="text-[1.75rem] tracking-[-0.03em] text-ink sm:text-[2rem]">Jejak urusan</h2>
      <p class="mt-1 text-base text-body">
        Semua yang dilakukan Anda dan AI di urusan ini, berurutan. Setiap langkah dikunci rantai hash, jadi
        perubahan diam-diam langsung ketahuan.
      </p>
    </div>
    <a
      href="/api/urusan/{j.urusanId}/jejak"
      rel="external"
      download="jejak-{j.urusanId}.json"
      class="inline-flex min-h-12 items-center gap-2 rounded-full border border-line-2 bg-surface px-5 font-semibold text-ink hover:bg-card"
    >
      <Icon name="unduh" class="size-4.5" /> Unduh jejak
    </a>
  </div>

  {#if j.rantai.valid}
    <p
      class="mt-5 flex items-center gap-2.5 rounded-xl bg-hijau px-4 py-3 text-[0.9375rem] font-semibold text-hijau-ink"
    >
      <Icon name="perisai-centang" class="size-5 shrink-0" />
      Rantai hash utuh · {j.rantai.jumlahEvent} langkah tercatat · diperiksa {waktuSingkat(
        data.diperiksaPada,
      )}
    </p>
  {:else}
    <p
      role="alert"
      class="mt-5 flex items-center gap-2.5 rounded-xl bg-mawar px-4 py-3 text-[0.9375rem] font-semibold text-galat"
    >
      <Icon name="peringatan" class="size-5 shrink-0" />
      Rantai hash rusak{j.rantai.rusakDiSeq ? ` di langkah ${j.rantai.rusakDiSeq}` : ''}: ada catatan yang
      berubah. Jangan lanjutkan sebelum menghubungi Urusin.
    </p>
  {/if}

  <div class="mt-5 overflow-hidden rounded-2xl border border-line">
    <table class="w-full border-collapse text-left">
      <caption class="sr-only">Daftar kegiatan urusan</caption>
      <thead class="bg-card text-sm text-ink">
        <tr>
          <th scope="col" class="px-4 py-3 font-semibold">Waktu</th>
          <th scope="col" class="px-2 py-3 font-semibold">Pelaku</th>
          <th scope="col" class="px-2 py-3 font-semibold">Kegiatan</th>
          <th scope="col" class="hidden px-4 py-3 font-semibold sm:table-cell">Urutan</th>
        </tr>
      </thead>
      <tbody>
        {#each events as e (e.seq)}
          {@const b = baris(e)}
          {@const pl = PELAKU[b.pelaku]}
          <tr class="border-t border-line-3 align-top">
            <td class="px-4 py-3.5 font-mono text-sm text-muted">{jam(e.at)}</td>
            <td class="px-2 py-3"><Chip nada={pl.nada} ikon={pl.ikon}>{pl.label}</Chip></td>
            <td class="px-2 py-3.5 text-[0.9375rem] text-ink">{b.teks}</td>
            <td class="hidden px-4 py-3.5 font-mono text-sm text-muted sm:table-cell">#{e.seq}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if spans.length}
    <details class="mt-5 rounded-2xl border border-line bg-card">
      <summary class="flex min-h-14 cursor-pointer items-center gap-2 px-4 font-semibold text-ink">
        <Icon name="sistem" class="size-5" /> Detail teknis: model, durasi, dan biaya
      </summary>
      <div class="border-t border-line-3 px-4 py-3 text-sm text-body">
        <p>
          Token masuk {j.tokenMasuk.toLocaleString('id-ID')} · keluar {j.tokenKeluar.toLocaleString('id-ID')} ·
          biaya Rp{j.biayaIdr.toLocaleString('id-ID')}
        </p>
        <ul class="mt-2 flex flex-col gap-1 font-mono text-[0.8125rem]">
          {#each spans as s (s.id)}
            {#if s.jenis === 'span'}
              <li>
                {jam(s.at)} · {s.operasi} · {s.durasiMs} ms{s.model ? ` · ${s.model}` : ''} · {s.status}
              </li>
            {/if}
          {/each}
        </ul>
      </div>
    </details>
  {/if}
</div>
