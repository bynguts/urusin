import type { DaftarUrusanResponse } from '#lib/contracts.js';

/**
 * Klien judul urusan: judul dari server (AI setelah turn pertama, atau nama pilihan warga) dan ganti nama.
 * Judul server menang atas judul jenis yang dicatat perangkat.
 */
export async function ambilJudul(
  ids: readonly string[],
  ambil: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const peta = new Map<string, string>();
  if (!ids.length) return peta;
  try {
    const r = await ambil(`/api/urusan?ids=${encodeURIComponent(ids.join(','))}`, {
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return peta;
    for (const u of ((await r.json()) as DaftarUrusanResponse).urusan) if (u.judul) peta.set(u.id, u.judul);
  } catch {
    // jaringan putus: judul perangkat tetap dipakai
  }
  return peta;
}

export async function gantiJudul(
  id: string,
  judul: string,
): Promise<{ ok: true; judul: string } | { ok: false; pesan: string }> {
  try {
    const r = await fetch(`/api/urusan/${encodeURIComponent(id)}/judul`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ judul }),
    });
    const j = (await r.json().catch(() => null)) as { judul?: string; pesanWarga?: string } | null;
    if (r.ok && j?.judul) return { ok: true, judul: j.judul };
    return { ok: false, pesan: j?.pesanWarga ?? 'Nama belum tersimpan. Coba lagi sebentar lagi.' };
  } catch {
    return { ok: false, pesan: 'Koneksi terputus. Periksa internet, lalu coba lagi.' };
  }
}
