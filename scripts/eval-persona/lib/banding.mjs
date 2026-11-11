// Bandingkan dua skor.json (mis. baseline main vs cabang lain): per persona per kriteria sebelum → sesudah.

const ARAH = (a, b) => (a === false && b === true ? 'naik' : a === true && b === false ? 'turun' : 'sama');

/**
 * @param {{hasil: {persona: string, nilai: Record<string, {lulus: boolean|null}>}[]}} sebelum
 * @param {typeof sebelum} sesudah
 * @param {string[]} kriteria
 */
export function bandingkan(sebelum, sesudah, kriteria) {
  const peta = (s) => new Map(s.hasil.map((h) => [h.persona, h]));
  const kiri = peta(sebelum);
  const kanan = peta(sesudah);
  const persona = [...new Set([...kiri.keys(), ...kanan.keys()])].sort();
  const total = Object.fromEntries(kriteria.map((k) => [k, { sebelum: 0, sesudah: 0, dinilai: 0 }]));
  const baris = persona.map((p) => {
    const sel = {};
    for (const k of kriteria) {
      const a = kiri.get(p)?.nilai?.[k]?.lulus;
      const b = kanan.get(p)?.nilai?.[k]?.lulus;
      sel[k] = { sebelum: a, sesudah: b, arah: ARAH(a, b) };
      if (typeof a === 'boolean' && typeof b === 'boolean') {
        total[k].dinilai++;
        if (a) total[k].sebelum++;
        if (b) total[k].sesudah++;
      }
    }
    return { persona: p, sel };
  });
  return { baris, total };
}

const huruf = (v) => (v === true ? 'L' : v === false ? 'G' : v === null ? '-' : '·');

/** Tabel markdown: "G → **L**" = membaik, "L → **G**" = memburuk, "·" = persona tidak dijalankan di sisi itu. */
export function tabelBanding({ baris, total }, kriteria) {
  const sel = ({ sebelum, sesudah, arah }) =>
    `${huruf(sebelum)} → ${arah === 'sama' ? huruf(sesudah) : `**${huruf(sesudah)}**`}`;
  const out = [
    `| persona | ${kriteria.join(' | ')} |`,
    `|---|${kriteria.map(() => '---').join('|')}|`,
    ...baris.map((b) => `| ${b.persona} | ${kriteria.map((k) => sel(b.sel[k])).join(' | ')} |`),
    `| **lulus (persona di kedua sisi)** | ${kriteria
      .map((k) => `${total[k].sebelum}/${total[k].dinilai} → ${total[k].sesudah}/${total[k].dinilai}`)
      .join(' | ')} |`,
  ];
  return out.join('\n');
}
