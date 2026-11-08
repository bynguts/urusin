/**
 * Kamus kata dasar (akar) untuk stemmer. SUMBER: disusun sendiri oleh tim Urusin (kosakata umum
 * bahasa Indonesia + istilah adminduk/layanan publik), dilisensikan MIT bersama repo ini.
 * TIDAK menyalin kamus pihak ketiga (kamus Sastrawi/Kateglo punya syarat lisensi sendiri).
 * Tambah akar baru di sini bila ada istilah korpus yang belum ter-stem.
 */
const ROOTS_TEXT = `
abad acara ada adil adminduk adopsi agama agung ahli ajar aju akal akhir akses akta aktif
aktivasi aktual alamat alasan alat alih alur aman ambil ampun anak angka angkat angsur antar
antara antri apa aplikasi arah arsip arti asal asing asli asuh asuransi atas atur aturan awal
awas ayah baca badan bagi bagian bahan bahasa baik bakar baku balik balita bangsa bangun
bangunan bank bansos bantu bantuan bapak barang baru basis batal batalkan batas bawa bayar bayi
bea beda beli benar berat beri berita berkas bersih besar betul biaya bicara bidang bikin bila
bilang bina biometrik bisnis bpkb buat buka bukan bukti buku bulan bumi bunga bupati buruh butuh
cabang cabut cacat cadang cakap cakup calon camat cara cari catat cecer cegah cek celaka cerai
ceraikan cetak cicil cipta cium coblos contoh cukup cuti daerah daftar dagang dahulu dalam damai
dampak dapat darah dasar data datang daya dekat denda dengar desa dewan dewasa didik difabel
dinas diri disabilitas dobel dokter dokumen domisili duduk dukung dunia ekonomi ekspor
elektronik encer fasilitas faskes fisik fiskal foto gabung gaji ganda ganti garis gedung gelar
gigi golongan gratis gubernur gugat guna habis hadap hadir hak hakim hal halaman hapus harap
harapan harga hari harian harus hasil hilang hubung hukum hutang ibu identitas ijazah ikat
ikhlas ikut ilmu imigrasi impor inap indah induk industri ingat ingin inti investasi iris isi
istri iuran izin jabat jadi jadwal jaga jalan jalur jaminan janji jarak jari jaring jasa jawab
jelang jelas jemput jenis jenjang jiwa jompo jual juga jumlah kabar kait kali kamar kampanye
kampung kantor kapan karena kartu kasih kasus kata kawin kecil kelamin kelas kelola
keluar keluarga kembali kemerdekaan kena kenal kendara kepala kepercayaan kerja kerjasama kertas
ketat kirim klinik kode kolektif kolom komputer kondisi kota kriminal kuasa kuat kuitansi kuliah
kumpul kurang kurun kusus lahir laki laksana laku lalu lama lambat lampir lancar langgar
langsung lanjut lansia lapis lapor larang latih layak layan lembaga lembar lengkap lewat lihat
lindung lisan listrik lokal lokasi lulus lunas lupa lurah mahal mahasiswa maju mampu mandiri
masa masalah masuk masyarakat mata mati mau medis mekanisme mengemudi mengerti meninggal merek
mesin mikro milik militer miskin modal mohon motor mudah mukim mulai muncul murid mutasi nafkah
nama nasional negara negeri niaga nik nikah nilai nomor nopol nyata obat oleh online operator
orang otomatis padu pagi paham pajak pakai paksa paling pangan pangkat panjang papan parkir
partai pasang pasangan paspor pasti paten pegawai pelan pelat pemerintah pemilu pendapatan
pendek pensiun penting penuh penyakit perdata perempuan perintah perlu persen pesan peserta
pidana pilih pilkada pimpin pindah pkb plat poin polisi politik pos praktik premi pria pribadi
prosedur proses pusat puskesmas putus rabu ragu rakyat rangka rapat rasa rawat rekam rekening
rekomendasi remaja rentan resmi rinci riwayat ruang rujuk rujukan rumah rusak saat sabtu sah
saja sakit saksi salah salin sama sampai samsat sanggup sanksi santun sarana sasaran satu
saudara sebab sebar sebut sedang sedia sehat sejahtera sekolah selenggara selesai sempat
sempurna semua senin serah serius serta sertifikat setor setuju siap sidang sidik sila silinder
simpan singkat sisa situs skala soal sosial status stempel stnk suami suara sudah suka sukarela
suket suku sulit sumbang sumber surat surut syarat tagih tahap tahun tamat tambah tamu tanah
tanda tangan tanggal tanggung tanya tarif tata tatap tawar tegas teknis telat telepon teliti
tembus tempat tempuh tenaga tengah tenggat tentu teori terang terbit terima tertib tetap tiap
tiba tilang tinggal tinggi tingkat tinjau tokoh tolak tolong tps transaksi transfer tua tugas
tuju tujuan tulis tunai tunda tunggak tunggal tunggu tunjang tunjuk tuntut turun turut tutup
uang ubah ujian ukur ulang umum umur undang unduh unggah untuk upaya urus usaha usia usul utama
utang vaksin verifikasi virtual wafat wajah wajib wakil waktu wali wanita warga warganegara
waris warna wasiat wewenang wilayah wisata yakin zaman
`;

export const ROOTS: ReadonlySet<string> = new Set(
  ROOTS_TEXT.split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2),
);
