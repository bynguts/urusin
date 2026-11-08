// Pembanding JSON Schema untuk pembekuan kontrak: perubahan aditif lolos; yang merusak konsumen lama gagal.
// Pelanggaran: properti dihapus/diganti nama, tipe menyempit, nilai enum dihapus, optional menjadi required,
// batas validasi diperketat, cabang anyOf dihapus, ekspor skema dihapus.

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Himpunan tipe yang diterima skema (integer dilebur ke number), atau null bila tidak dibatasi. */
function typeSet(s) {
  if (!isObj(s)) return null;
  if (Array.isArray(s.anyOf)) {
    const parts = s.anyOf.map(typeSet);
    return parts.some((p) => p === null) ? null : new Set(parts.flatMap((p) => [...p]));
  }
  if (Array.isArray(s.enum)) return new Set(s.enum.map((v) => (v === null ? 'null' : typeof v)));
  if ('const' in s) return new Set([s.const === null ? 'null' : typeof s.const]);
  const norm = (t) => (t === 'integer' ? 'number' : t);
  if (typeof s.type === 'string') return new Set([norm(s.type)]);
  if (Array.isArray(s.type)) return new Set(s.type.map(norm));
  return null;
}

const LOWER_BOUNDS = ['minLength', 'minItems', 'minimum', 'exclusiveMinimum', 'minProperties'];
const UPPER_BOUNDS = ['maxLength', 'maxItems', 'maximum', 'exclusiveMaximum', 'maxProperties'];

/** Daftar pelanggaran { path, message } saat berpindah dari skema `a` (lama) ke `b` (baru). */
export function diffSchemas(a, b, path = '') {
  const out = [];
  const add = (message, p = path) => out.push({ path: p, message });
  if (!isObj(a) || !isObj(b)) return out;

  const ta = typeSet(a);
  const tb = typeSet(b);
  if (ta && tb) {
    for (const t of ta) if (!tb.has(t)) add(`tipe menyempit: "${t}" tidak lagi diterima`);
  } else if (ta === null && tb) {
    add('tipe menyempit: dari bebas menjadi terbatas');
  }

  if (Array.isArray(a.enum) && Array.isArray(b.enum)) {
    for (const v of a.enum) {
      if (!b.enum.some((w) => JSON.stringify(w) === JSON.stringify(v))) {
        add(`nilai enum dihapus: ${JSON.stringify(v)}`);
      }
    }
  } else if (Array.isArray(a.enum) && 'const' in b && a.enum.length > 1) {
    add('enum menyempit menjadi const');
  }

  for (const k of LOWER_BOUNDS) {
    if (typeof b[k] === 'number' && (typeof a[k] !== 'number' || b[k] > a[k])) add(`batas ${k} diperketat`);
  }
  for (const k of UPPER_BOUNDS) {
    if (typeof b[k] === 'number' && (typeof a[k] !== 'number' || b[k] < a[k])) add(`batas ${k} diperketat`);
  }
  if (typeof b.pattern === 'string' && b.pattern !== a.pattern)
    add('pola (pattern) berubah atau ditambahkan');

  if (isObj(a.properties)) {
    const reqA = new Set(Array.isArray(a.required) ? a.required : []);
    const reqB = new Set(Array.isArray(b.required) ? b.required : []);
    const propsB = isObj(b.properties) ? b.properties : {};
    for (const [k, v] of Object.entries(a.properties)) {
      const p = `${path}.${k}`;
      if (!(k in propsB)) {
        add('properti dihapus atau diganti nama', p);
        continue;
      }
      if (!reqA.has(k) && reqB.has(k)) add('properti optional menjadi required', p);
      out.push(...diffSchemas(v, propsB[k], p));
    }
    if (a.additionalProperties !== false && b.additionalProperties === false) {
      add('properti tambahan tidak lagi diizinkan');
    }
  }

  if (isObj(a.items) && isObj(b.items)) out.push(...diffSchemas(a.items, b.items, `${path}[]`));

  if (Array.isArray(a.anyOf)) {
    if (!Array.isArray(b.anyOf)) {
      // union lama menjadi skema tunggal: skema baru harus menerima semua cabang lama
      a.anyOf.forEach((branch, i) => out.push(...diffSchemas(branch, b, `${path}|${i}`)));
    } else {
      a.anyOf.forEach((branch, i) => {
        const ok = b.anyOf.some((cand) => diffSchemas(branch, cand, '').length === 0);
        if (!ok) add(`cabang anyOf #${i} dihapus atau menyempit`, `${path}|${i}`);
      });
    }
  }

  for (const key of ['$defs', 'definitions']) {
    if (!isObj(a[key])) continue;
    for (const [k, v] of Object.entries(a[key])) {
      const nb = isObj(b[key]) ? b[key][k] : undefined;
      if (nb === undefined) add('definisi dihapus', `${path}/${key}/${k}`);
      else out.push(...diffSchemas(v, nb, `${path}/${key}/${k}`));
    }
  }
  return out;
}

/** Bandingkan dua peta nama-ekspor -> JSON Schema. Ekspor yang hilang juga pelanggaran. */
export function diffContracts(oldMap, newMap) {
  const out = [];
  for (const [name, schema] of Object.entries(oldMap)) {
    if (!(name in newMap)) {
      out.push({ path: name, message: 'skema diekspor dihapus atau diganti nama' });
      continue;
    }
    for (const v of diffSchemas(schema, newMap[name], '')) {
      out.push({ path: `${name}${v.path}`, message: v.message });
    }
  }
  return out;
}
