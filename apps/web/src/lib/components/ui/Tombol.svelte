<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
  import Icon from '../Icon.svelte';
  import type { NamaIkon } from '../ikon.js';

  /**
   * Button/Primary, Button/Secondary, Button/Text dari design system. Radius pill, hover opacity .9,
   * busy opacity .8. Tinggi minimum 48 px (target sentuh), walau ukuran sumber lebih kecil.
   */
  type Varian = 'primer' | 'sekunder' | 'teks' | 'bahaya';
  type Umum = {
    varian?: Varian;
    ukuran?: 'sm' | 'md' | 'lg';
    ikon?: NamaIkon | undefined;
    ikonKanan?: NamaIkon | undefined;
    sibuk?: boolean;
    lebar?: boolean;
    class?: string;
    children: Snippet;
  };
  type Props = Umum &
    (
      | (Omit<HTMLAnchorAttributes, 'class' | 'children'> & { href: string })
      | (Omit<HTMLButtonAttributes, 'class' | 'children'> & { href?: undefined })
    );

  let {
    varian = 'primer',
    ukuran = 'md',
    ikon,
    ikonKanan,
    sibuk = false,
    lebar = false,
    class: kelas = '',
    children,
    ...rest
  }: Props = $props();

  const VARIAN: Record<Varian, string> = {
    primer: 'bg-primer text-primer-ink hover:opacity-90',
    sekunder: 'bg-surface text-ink shadow-lembut hover:bg-card',
    teks: 'text-ink hover:bg-bg-2 px-2!',
    bahaya: 'bg-surface text-galat border border-galat-garis/60 hover:bg-mawar',
  };
  const UKURAN = {
    sm: 'min-h-12 px-5 text-sm',
    md: 'min-h-12 px-6 text-[0.9375rem]',
    lg: 'min-h-14 px-7 text-base',
  };

  const cls = $derived(
    [
      'inline-flex select-none items-center justify-center gap-1.5 rounded-full font-medium transition-opacity duration-150 ease-seimbang disabled:cursor-not-allowed disabled:opacity-50 aria-busy:opacity-80',
      VARIAN[varian],
      UKURAN[ukuran],
      lebar ? 'w-full' : '',
      kelas,
    ].join(' '),
  );
</script>

{#if rest.href !== undefined}
  <a class={cls} {...rest as HTMLAnchorAttributes}>
    {#if ikon}<Icon name={ikon} class="size-[1.1em] shrink-0" />{/if}
    {@render children()}
    {#if ikonKanan}<Icon name={ikonKanan} class="size-[1.1em] shrink-0" />{/if}
  </a>
{:else}
  <button class={cls} type="button" {...rest as HTMLButtonAttributes} aria-busy={sibuk || undefined}>
    {#if sibuk}
      <Icon name="memuat" class="size-[1.1em] shrink-0 animate-spin" />
    {:else if ikon}
      <Icon name={ikon} class="size-[1.1em] shrink-0" />
    {/if}
    {@render children()}
    {#if ikonKanan}<Icon name={ikonKanan} class="size-[1.1em] shrink-0" />{/if}
  </button>
{/if}
