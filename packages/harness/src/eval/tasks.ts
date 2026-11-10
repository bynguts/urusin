import type { IntentJenis } from '../intent.js';

/**
 * Set tugas eval intent (rencana §5.1 + audit #6). Data murni: 4 Peristiwa Hidup + urusan umum.
 * `ekspektasi`:
 *  - jawaban: ada potongan di korpus → harus keluar `grounded_answer` dengan ≥ 1 klaim, tanpa klaim dibuang
 *  - handoff: tidak ada sumber di korpus → harus `handoff` ke kanal resmi (tidak boleh mengarang)
 *  - chat   : bukan pertanyaan persyaratan → balasan teks biasa (`assistant_text`)
 */
export type EvalTask = {
  id: string;
  teks: string;
  jenis: IntentJenis;
  kodeKabKota?: string;
  ekspektasi: 'jawaban' | 'handoff' | 'chat';
};

export const INTENT_TASKS: readonly EvalTask[] = [
  {
    id: 'T01',
    jenis: 'kelahiran',
    ekspektasi: 'jawaban',
    kodeKabKota: '3312',
    teks: 'Anak saya baru lahir kemarin, apa syarat membuat akta kelahirannya?',
  },
  {
    id: 'T02',
    jenis: 'kematian',
    ekspektasi: 'jawaban',
    kodeKabKota: '3312',
    teks: 'Ayah saya meninggal dunia, bagaimana cara mengurus akta kematian?',
  },
  {
    id: 'T03',
    jenis: 'perkawinan',
    ekspektasi: 'jawaban',
    kodeKabKota: '3312',
    teks: 'Kami baru menikah, apa saja dokumen untuk pencatatan perkawinan?',
  },
  {
    id: 'T04',
    jenis: 'pindah',
    ekspektasi: 'jawaban',
    kodeKabKota: '3312',
    teks: 'Saya mau pindah domisili ke Kota Surabaya, apa yang harus disiapkan?',
  },
  {
    id: 'T05',
    jenis: 'ktp',
    ekspektasi: 'jawaban',
    kodeKabKota: '3312',
    teks: 'KTP saya hilang, bagaimana cara menggantinya?',
  },
  {
    id: 'T06',
    jenis: 'kk',
    ekspektasi: 'jawaban',
    kodeKabKota: '3312',
    teks: 'Saya perlu mengubah data di kartu keluarga, apa syaratnya?',
  },
  {
    id: 'T07',
    jenis: 'akta',
    ekspektasi: 'jawaban',
    kodeKabKota: '3312',
    teks: 'Saya ingin mengurus akta untuk dokumen lama, apa saja persyaratannya?',
  },
  {
    id: 'T08',
    jenis: 'skck',
    ekspektasi: 'handoff',
    teks: 'Bagaimana cara membuat SKCK untuk melamar kerja?',
  },
  {
    id: 'T09',
    jenis: 'pajak_kendaraan',
    ekspektasi: 'handoff',
    teks: 'Berapa biaya pajak STNK motor saya tahun ini?',
  },
  {
    id: 'T10',
    jenis: 'cek_dpt',
    ekspektasi: 'handoff',
    teks: 'Bagaimana cara mengecek apakah saya terdaftar di DPT pemilu?',
  },
  {
    id: 'T11',
    jenis: 'bansos',
    ekspektasi: 'handoff',
    teks: 'Saya ingin tahu apakah keluarga saya menerima bansos, bagaimana cek-nya?',
  },
  {
    id: 'T12',
    jenis: 'pengaduan',
    ekspektasi: 'chat',
    teks: 'Saya mau melaporkan jalan rusak di desa saya.',
  },
];
