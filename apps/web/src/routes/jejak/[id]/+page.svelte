<script lang="ts">
  import { resolve } from '$app/paths';
  import type { JejakItem, UrusanState } from '#lib/contracts.js';
  import Icon from '#lib/components/Icon.svelte';
  import HeaderHalaman from '#lib/components/shell/HeaderHalaman.svelte';
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

  // Chip pelaku App 09: Anda (amber), AI (nila), Urusin (netral, ikon tinta).
  const PELAKU: Record<
    'anda' | 'ai' | 'urusin',
    { label: string; kelas: string; ikon: NamaIkon; ikonKelas: string }
  > = {
    anda: { label: 'Anda', kelas: 'bg-kuning text-kuning-ink', ikon: 'orang', ikonKelas: '' },
    ai: { label: 'AI', kelas: 'bg-nila text-nila-ink', ikon: 'ai', ikonKelas: '' },
    urusin: { label: 'Urusin', kelas: 'bg-bg-2 text-muted', ikon: 'sistem', ikonKelas: 'text-ink' },
  };

  function baris(e: ItemEvent): { pelaku: keyof typeof PELAKU; teks: string } {
    switch (e.type) {
      case 'state': {
        const [dari, ke] = e.ringkas.split(' → ') as [UrusanState, UrusanState | undefined];
        const tujuan = (ke ?? dari) as UrusanState;
        return { pelaku: 'urusin', teks: `Status menjadi: ${LABEL_STATE[tujuan] ?? e.ringkas}` };
      }
      case 'progress':
        return { pelaku: 'ai', teks: labelProgres(e.ringkas).replace(/…$/, '') };
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
      class="grid size-12 place-items-center rounded-full hover:bg-bg-2 lg:hidden"
      aria-label="Kembali ke urusan"><Icon name="panah-kiri" class="size-5" /></a
    >
  {/snippet}
</HeaderHalaman>

<div class="flex w-full flex-col gap-5 px-4 py-6 sm:px-10 sm:py-7">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div class="flex max-w-[640px] flex-col gap-1.5">
      <h2 class="text-[26px] leading-[34px] font-semibold tracking-[-0.6px] text-ink sm:text-[28px]">
        Jejak urusan
      </h2>
      <p class="text-base leading-6 text-muted">
        Semua yang dilakukan Anda dan AI di urusan ini, berurutan. Setiap langkah dikunci rantai hash, jadi
        perubahan diam-diam langsung ketahuan.
      </p>
    </div>
    <a
      href="/api/urusan/{j.urusanId}/jejak"
      rel="external"
      download="jejak-{j.urusanId}.json"
      class="inline-flex h-[46px] items-center gap-2 rounded-full border border-line-2 bg-surface px-[18px] text-base font-semibold text-ink hover:bg-card"
    >
      <Icon name="unduh" class="size-4" /> Unduh jejak
    </a>
  </div>

  {#if j.rantai.valid}
    <p
      class="flex items-center gap-2.5 rounded-[14px] bg-hijau px-4 py-3 text-[15px] leading-[22px] font-semibold text-hijau-ink"
    >
      <Icon name="perisai-centang" class="size-[18px] shrink-0" />
      Rantai hash utuh · {j.rantai.jumlahEvent} langkah tercatat · diperiksa {waktuSingkat(
        data.diperiksaPada,
      )}
    </p>
  {:else}
    <p
      role="alert"
      class="flex items-center gap-2.5 rounded-[14px] bg-mawar px-4 py-3 text-[15px] leading-[22px] font-semibold text-galat"
    >
      <Icon name="peringatan" class="size-[18px] shrink-0" />
      Rantai hash rusak{j.rantai.rusakDiSeq ? ` di langkah ${j.rantai.rusakDiSeq}` : ''}: ada catatan yang
      berubah. Jangan lanjutkan sebelum menghubungi Urusin.
    </p>
  {/if}

  <div class="overflow-hidden rounded-2xl border border-line bg-surface">
    <table class="w-full border-collapse text-left">
      <caption class="sr-only">Daftar kegiatan urusan</caption>
      <thead class="border-b border-line bg-card text-[13px] text-card-ink">
        <tr>
          <th scope="col" class="w-[76px] py-2.5 pr-2 pl-4 font-semibold sm:w-[116px] sm:pr-4 sm:pl-5"
            >Waktu</th
          >
          <th scope="col" class="w-[104px] py-2.5 pr-2 font-semibold sm:w-[146px] sm:pr-4">Pelaku</th>
          <th scope="col" class="py-2.5 pr-4 font-semibold sm:pr-5">Kegiatan</th>
          <th scope="col" class="hidden w-[150px] py-2.5 pr-5 font-semibold sm:table-cell">Urutan</th>
        </tr>
      </thead>
      <tbody>
        {#each events as e (e.seq)}
          {@const b = baris(e)}
          {@const pl = PELAKU[b.pelaku]}
          <tr class="h-[51.5px] border-t border-line first:border-t-0">
            <td class="py-2 pr-2 pl-4 font-mono text-sm text-muted sm:pr-4 sm:pl-5">{jam(e.at)}</td>
            <td class="py-2 pr-2 sm:pr-4">
              <span
                class="inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 text-[13px] leading-4 font-semibold whitespace-nowrap {pl.kelas}"
              >
                <Icon name={pl.ikon} class="size-[13px] shrink-0 {pl.ikonKelas}" />{pl.label}
              </span>
            </td>
            <td class="py-2 pr-4 text-[15px] text-ink sm:pr-5 sm:text-base">{b.teks}</td>
            <td class="hidden py-2 pr-5 font-mono text-[13px] text-card-ink sm:table-cell">#{e.seq}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if spans.length}
    <details class="rounded-2xl border border-line bg-card">
      <summary class="flex min-h-14 cursor-pointer items-center gap-2 px-4 font-semibold text-ink">
        <Icon name="sistem" class="size-5" /> Detail teknis: model, durasi, dan biaya
      </summary>
      <div class="border-t border-line px-4 py-3 text-sm text-body">
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
