<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '#lib/components/Icon.svelte';

  let {
    id,
    name,
    kota,
    value = $bindable(''),
    select = $bindable<HTMLSelectElement>(),
    describedby,
    bolehKosong = false,
    placeholder = 'Pilih kabupaten/kota',
    onchange,
  }: {
    id: string;
    name?: string;
    kota: readonly { kodeKabKota: string; nama: string }[];
    value?: string;
    select?: HTMLSelectElement;
    describedby?: string;
    bolehKosong?: boolean;
    placeholder?: string;
    onchange?: (select: HTMLSelectElement) => void;
  } = $props();

  let siap = $state(false);
  let terbuka = $state(false);
  let cari = $state('');
  let aktif = $state(-1);
  let kontrol = $state<HTMLDivElement>();
  let input = $state<HTMLInputElement>();
  let panel = $state<HTMLDivElement>();
  let posisi = $state('');

  const nama = $derived(kota.find((k) => k.kodeKabKota === value)?.nama ?? placeholder);
  const pilihan = $derived(bolehKosong ? [{ kodeKabKota: '', nama: placeholder }, ...kota] : kota);
  const kata = $derived(cari.trim().toLocaleLowerCase('id-ID').split(/\s+/).filter(Boolean));
  const hasil = $derived(
    pilihan.filter((k) => kata.every((s) => k.nama.toLocaleLowerCase('id-ID').includes(s))),
  );

  // Select tetap menjadi kontrol form asli. Pilihan sebelum hidrasi dibaca sebelum UI pencarian muncul.
  onMount(() => {
    const awal = select?.value ?? value;
    const berubah = awal !== value;
    value = awal;
    siap = true;
    if (berubah && select) onchange?.(select);
  });

  function tutup() {
    terbuka = false;
    cari = '';
    aktif = -1;
  }

  function aturPosisi() {
    if (!kontrol) return;
    const r = kontrol.getBoundingClientRect();
    const v = window.visualViewport;
    const atas = v?.offsetTop ?? 0;
    const bawah = atas + (v?.height ?? window.innerHeight);
    const ruangBawah = bawah - r.bottom - 12;
    const ruangAtas = r.top - atas - 12;
    const keAtas = ruangBawah < 220 && ruangAtas > ruangBawah;
    const tinggi = Math.min(352, Math.max(80, keAtas ? ruangAtas : ruangBawah));
    const lebar = Math.min(r.width, (v?.width ?? window.innerWidth) - 24);
    const kiri = Math.max(12, Math.min(r.left, (v?.width ?? window.innerWidth) - lebar - 12));
    posisi = `left:${kiri}px;width:${lebar}px;max-height:${tinggi}px;${
      keAtas ? `bottom:${window.innerHeight - r.top + 6}px` : `top:${r.bottom + 6}px`
    }`;
  }

  async function tampilkan() {
    if (terbuka) return;
    cari = '';
    aktif = Math.max(
      0,
      pilihan.findIndex((k) => k.kodeKabKota === value),
    );
    aturPosisi();
    terbuka = true;
    await lihatAktif();
  }

  async function lihatAktif() {
    await tick();
    panel?.querySelector<HTMLElement>(`[data-indeks="${aktif}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function pilih(kode: string) {
    value = kode;
    if (select) {
      select.value = kode;
      onchange?.(select);
    }
    input?.focus({ preventScroll: true });
    tutup();
  }

  async function tombol(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!terbuka) await tampilkan();
      else aktif = Math.max(0, Math.min(hasil.length - 1, aktif + (e.key === 'ArrowDown' ? 1 : -1)));
      await lihatAktif();
    } else if (e.key === 'Enter') {
      e.preventDefault(); // Teks pencarian tidak boleh mengirim form sebagai kode wilayah.
      if (!terbuka) await tampilkan();
      else if (hasil[aktif]) pilih(hasil[aktif].kodeKabKota);
    } else if (e.key === 'Escape' && terbuka) {
      e.preventDefault();
      e.stopPropagation();
      tutup();
    } else if (e.key === 'Tab') tutup();
  }

  // Keluar dari panel scroll halaman; daftar tidak terpotong di tepi kartu/panel Pengaturan.
  function lapisan(node: HTMLDivElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => {
    if (!terbuka) return;
    const diLuar = (e: Event) => {
      if (e.target instanceof Node && !kontrol?.contains(e.target) && !panel?.contains(e.target)) tutup();
    };
    const saatScroll = (e: Event) => {
      if (!(e.target instanceof Node) || !panel?.contains(e.target)) aturPosisi();
    };
    document.addEventListener('pointerdown', diLuar);
    document.addEventListener('focusin', diLuar);
    document.addEventListener('scroll', saatScroll, true);
    window.addEventListener('resize', aturPosisi);
    window.visualViewport?.addEventListener('resize', aturPosisi);
    window.visualViewport?.addEventListener('scroll', aturPosisi);
    return () => {
      document.removeEventListener('pointerdown', diLuar);
      document.removeEventListener('focusin', diLuar);
      document.removeEventListener('scroll', saatScroll, true);
      window.removeEventListener('resize', aturPosisi);
      window.visualViewport?.removeEventListener('resize', aturPosisi);
      window.visualViewport?.removeEventListener('scroll', aturPosisi);
    };
  });
</script>

<select
  id={siap ? `${id}-asli` : id}
  {name}
  bind:this={select}
  hidden={siap}
  aria-hidden={siap ? true : undefined}
  tabindex={siap ? -1 : undefined}
  aria-describedby={describedby}
  autocomplete="address-level2"
  onchange={(e) => {
    value = e.currentTarget.value;
    onchange?.(e.currentTarget);
  }}
  class="min-h-12 w-full min-w-0 rounded-xl border border-line-2 bg-surface px-4 text-base text-ink"
>
  <option value="" disabled={!bolehKosong} selected={!value}>{placeholder}</option>
  {#each kota as k (k.kodeKabKota)}
    <option value={k.kodeKabKota} selected={value === k.kodeKabKota}>{k.nama}</option>
  {/each}
</select>

{#if siap}
  <div bind:this={kontrol} class="relative w-full min-w-0">
    <input
      bind:this={input}
      {id}
      role="combobox"
      aria-expanded={terbuka}
      aria-controls="{id}-daftar"
      aria-autocomplete="list"
      aria-activedescendant={terbuka && hasil[aktif] ? `${id}-opsi-${aktif}` : undefined}
      aria-describedby={describedby}
      autocomplete="off"
      spellcheck="false"
      placeholder={terbuka ? 'Cari kabupaten/kota…' : placeholder}
      value={terbuka ? cari : value ? nama : ''}
      onfocus={tampilkan}
      onclick={tampilkan}
      oninput={(e) => {
        if (!terbuka) {
          aturPosisi();
          terbuka = true;
        }
        cari = e.currentTarget.value;
        aktif = hasil.length ? 0 : -1;
        void lihatAktif();
      }}
      onkeydown={tombol}
      class="min-h-12 w-full min-w-0 rounded-xl border border-line-2 bg-surface py-3 pr-12 pl-4 text-base text-ink placeholder:text-muted hover:border-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    />
    <button
      type="button"
      aria-label={terbuka ? 'Tutup pilihan kabupaten/kota' : 'Buka pilihan kabupaten/kota'}
      aria-expanded={terbuka}
      aria-controls="{id}-daftar"
      tabindex="-1"
      onpointerdown={(e) => e.preventDefault()}
      onclick={() => {
        if (terbuka) tutup();
        else {
          input?.focus({ preventScroll: true });
          void tampilkan();
        }
      }}
      class="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted hover:text-ink"
      ><Icon name={terbuka ? 'atas' : 'bawah'} class="size-4" /></button
    >
  </div>
{/if}

{#if terbuka}
  <div
    bind:this={panel}
    use:lapisan
    style={posisi}
    class="fixed z-50 flex flex-col overflow-hidden rounded-xl bg-surface text-ink shadow-lembut outline outline-1 -outline-offset-1 outline-line-2"
  >
    <p role="status" class="shrink-0 px-4 py-2.5 text-sm text-muted">
      {hasil.length ? `${hasil.length} pilihan wilayah` : 'Wilayah tidak ditemukan'}
    </p>
    <ul
      id="{id}-daftar"
      role="listbox"
      aria-label="Pilihan kabupaten/kota"
      class="min-h-0 overflow-y-auto overscroll-contain p-1.5 pt-0"
    >
      {#each hasil as k, i (k.kodeKabKota)}
        <li
          id="{id}-opsi-{i}"
          role="option"
          tabindex="-1"
          aria-selected={value === k.kodeKabKota}
          data-indeks={i}
          onpointerdown={(e) => {
            if (e.pointerType === 'mouse') e.preventDefault();
          }}
          onclick={() => pilih(k.kodeKabKota)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pilih(k.kodeKabKota);
            }
          }}
          class="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-3 text-base break-words hover:bg-bg-2 {i ===
          aktif
            ? 'bg-bg-2'
            : ''} {value === k.kodeKabKota ? 'font-semibold' : ''}"
        >
          <span class="min-w-0">{k.nama}</span>
          {#if value === k.kodeKabKota}<Icon name="centang" class="size-4.5 shrink-0" />{/if}
        </li>
      {/each}
    </ul>
    {#if !hasil.length}
      <p class="px-4 pb-4 text-base text-body">Coba nama lain, misalnya “Surabaya” atau “Wonogiri”.</p>
    {/if}
  </div>
{/if}
