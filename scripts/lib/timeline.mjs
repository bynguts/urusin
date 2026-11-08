// Laporan ritme commit per anggota (hanya laporan, bukan gerbang). Memakai tanggal author dari git (%aI).
export const FS = '\x1f';
export const RS = '\x1e';
export const TIMELINE_FORMAT = `%H${FS}%ae${FS}%an${FS}%aI${FS}%P${FS}%s${RS}`;

/** Parse keluaran `git log --format=TIMELINE_FORMAT` menjadi daftar commit. */
export function parseTimelineLog(raw) {
  return raw
    .split(RS)
    .map((r) => r.replace(/^\r?\n/, ''))
    .filter((r) => r.trim() !== '')
    .map((record) => {
      const [hash = '', email = '', name = '', date = '', parents = '', subject = ''] = record.split(FS);
      return {
        hash,
        email: email.toLowerCase(),
        name,
        date,
        day: date.slice(0, 10),
        parents: parents.split(' ').filter(Boolean),
        subject,
      };
    });
}

/** Hitung commit per (kunci, anggota); kunci = fungsi dari commit. Mengembalikan { keys, members, cells }. */
export function tally(commits, keyOf) {
  const cells = new Map();
  const members = new Map();
  for (const c of commits) {
    const key = keyOf(c);
    members.set(c.email, c.name);
    const row = cells.get(key) ?? new Map();
    row.set(c.email, (row.get(c.email) ?? 0) + 1);
    cells.set(key, row);
  }
  return { keys: [...cells.keys()].sort(), members: [...members.entries()].sort(), cells };
}

/** Tabel teks rata: baris = kunci, kolom = anggota, plus total. */
export function formatTable(title, label, { keys, members, cells }) {
  const header = [label, ...members.map(([, name]) => name), 'total'];
  const rows = keys.map((k) => {
    const row = cells.get(k);
    const counts = members.map(([email]) => row.get(email) ?? 0);
    return [k, ...counts.map(String), String(counts.reduce((a, b) => a + b, 0))];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [title, fmt(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(fmt), ''].join('\n');
}

/** Commit milik jendela merge: yang masuk lewat parent kedua merge (bukan first-parent). */
export function windowLabel(mergeCommit) {
  return `${mergeCommit.day} ${mergeCommit.hash.slice(0, 7)} ${mergeCommit.subject}`;
}
