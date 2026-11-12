/** Cache LRU kecil berbasis urutan sisip `Map` (entri yang dibaca dipindah ke paling baru). */
export class Lru<K, V> {
  private readonly peta = new Map<K, V>();

  constructor(private readonly maks: number) {
    if (!Number.isInteger(maks) || maks < 1) throw new RangeError('maks LRU harus bilangan bulat >= 1');
  }

  get ukuran(): number {
    return this.peta.size;
  }

  ambil(k: K): V | undefined {
    const v = this.peta.get(k);
    if (v === undefined) return undefined;
    this.peta.delete(k);
    this.peta.set(k, v);
    return v;
  }

  simpan(k: K, v: V): void {
    this.peta.delete(k);
    this.peta.set(k, v);
    if (this.peta.size > this.maks) this.peta.delete(this.peta.keys().next().value as K);
  }
}
