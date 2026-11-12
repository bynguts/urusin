# Bake-off embedding self-hosted (2026-11-12)

**Pemenang: `google/embeddinggemma-300m` (GGUF Q8_0 resmi ggml-org, 334 MB).** Model ini punya kualitas
tertinggi di kedua tugas Urusin sekaligus ukuran dan RAM terkecil di antara kandidat yang kualitasnya
layak. Kandidat 0,6B (Harrier, Qwen3) lebih besar dua kali lipat, lebih lambat 6x, dan tetap kalah akurasi.

## Cara ukur

- **Set eval** (sintetis, tanpa data pribadi):
  - `intent.json`: 205 pesan warga (177 dalam domain + 28 negatif/di luar domain). Gayanya formal,
    santai, slang, salah ketik, dan bahasa daerah (Jawa, Sunda). Ada negatif yang wajib tidak cocok,
    mis. "pajak mobil KIA", "buku KIA posyandu", dan "pindah sekolah". Label mengikuti `INTENT_JENIS`
    (`packages/harness/src/intent.ts`). Prototipe yang dikirim ke produksi
    (`packages/harness/src/intent-prototipe.ts`) sengaja berbeda kalimat dari set eval.
  - `menu.json`: 61 kasus "tujuan Navigator (string `tujuanPendamping`) -> label menu portal" di 7 set
    menu. Labelnya dari portal nyata (Klampid Surabaya, tenant SIDAK, Telunjuk Sakti), replika fixtures,
    dan pola umum portal Disdukcapil. Ada pengecoh: pembatalan akta, salinan akta, legalisir.
- **Runtime = runtime produksi**: llama.cpp `llama-server` b12004 (build CPU), GGUF Q8_0, `--embedding`,
  2 thread. Klien memasang awalan kueri/dokumen sesuai kartu model (`PROFIL` di `bakeoff.mjs`).
  Jalankan ulang: `node packages/embedding/eval/bakeoff.mjs --url <sidecar> --profil <profil>`.
- **Intent**: skor jenis = kosinus maksimum ke prototipe jenis itu. Top-1/top-3 dihitung pada 177 pesan
  dalam domain. **Jalur cepat**: terima bila skor >= T dan margin (skor 1 - skor 2) >= M. Ambang
  dipilih untuk target presisi, dengan validasi silang dua lipatan (pilih di separuh data, ukur di
  separuh lain). Pesan `lainnya` yang diterima dihitung sebagai salah. "Tanpa kunci" = 152 pesan yang
  tidak tertangkap `klasifikasiKataKunci`; inilah lalu lintas yang benar-benar sampai ke embedding.
- **Menu**: kueri = string tujuan Navigator, kandidat = semua label di set menu itu.
- **Mesin**: laptop **x86-64** (AMD Ryzen 5 8645HS, Windows 11). CPU dipakai bersama agen lain (~40%
  sibuk saat diukur), jadi latensi adalah batas atas yang berisik. Produksi berjalan di **ARM64**
  (agent-vm). Angka ARM belum diukur di sini; smoke CI arm64 hanya membuktikan image hidup dan benar
  secara semantik.
- **RAM** = memori privat proses `llama-server` (model dimuat penuh tanpa mmap, konteks 2048).
  Angka kontainer produksi (konteks 1024, 2 slot) ada di bagian Sidecar.

## Hasil

| Model (GGUF Q8_0)                                  | Lisensi            | Berkas | Intent top-1 | top-3     | Jalur cepat tanpa-kunci @ presisi 99%  | Menu top-1 | top-3     | RAM privat | Latensi p50 / p95 |
| -------------------------------------------------- | ------------------ | ------ | ------------ | --------- | -------------------------------------- | ---------- | --------- | ---------- | ----------------- |
| **google/embeddinggemma-300m** (ggml-org)          | Gemma Terms of Use | 334 MB | **88,1%**    | **96,0%** | **50,0%** (CV 36-60%, presisi 98-100%) | **86,9%**  | **96,7%** | **495 MB** | 58 / 79 ms        |
| Qwen/Qwen3-Embedding-0.6B (resmi)                  | Apache-2.0         | 639 MB | 78,5%        | 91,0%     | 47,4% (CV 35-51%, presisi 92-100%)     | 80,3%      | 91,8%     | 1.061 MB   | 357 / 461 ms      |
| microsoft/harrier-oss-v1-0.6b (konversi sendiri)   | MIT                | 639 MB | 83,1%        | 90,4%     | 25,0% (CV 29-31%, presisi 97-100%)     | 78,7%      | 88,5%     | 1.062 MB   | 369 / 460 ms      |
| ibm-granite/granite-embedding-311m-multilingual-r2 | Apache-2.0         | 347 MB | 81,4%        | 91,5%     | 33,6% (CV 36-51%, presisi 94-100%)     | 62,3%      | 82,0%     | 529 MB     | 42 / 61 ms        |
| intfloat/multilingual-e5-base (baseline)           | MIT                | 303 MB | 79,1%        | 91,0%     | 7,2% (CV 17-19%, presisi 90-94%)       | 80,3%      | 93,4%     | 566 MB     | 39 / 67 ms        |
| microsoft/harrier-oss-v1-270m, fp32 rujukan (GPU)  | MIT                | 540 MB | 77,4%        | 88,1%     | 36,2% (CV 36-48%, presisi 94-97%)      | 75,4%      | 91,8%     | -          | -                 |

Catatan per kandidat:

- **Harrier 0.6B**: GGUF hasil konversi sendiri (`convert_hf_to_gguf.py` b12004, pooling token terakhir)
  praktis identik dengan rujukan fp32 sentence-transformers. Rujukan fp32 mencapai top-1 83,1%,
  top-3 91,0%, dan menu 78,7%/88,5%, jadi konversinya benar. Model ini dinilai apa adanya, dan tetap kalah dari
  EmbeddingGemma di semua metrik dengan ukuran dua kali lipat. Dengan 1 thread, p50-nya 654 ms;
  terlalu lambat untuk batas 300 ms jalur warga.
- **Qwen3 0.6B**: varian dengan `<|endoftext|>` eksplisit tidak lebih baik (top-1 80,2%), jadi GGUF resmi
  sudah memakai EOS dengan benar.
- **Harrier 270M**: satu-satunya GGUF komunitas yang tersedia rusak (top-1 38,4%; konversi Gemma3 untuk
  model pooling token terakhir). Karena itu baris di atas memakai rujukan fp32 resmi. Model ini tetap
  di bawah EmbeddingGemma.
- **EmbeddingGemma**: awalan kartu model `task: search result | query: ...` / `title: none | text: ...`
  lebih baik daripada awalan `task: classification` (top-1 85,3%, menu top-1 73,8%).
  GGUF-nya rilis resmi ggml-org (bukan konversi sendiri). Rujukan fp32 sentence-transformers tidak
  dijalankan: implementasi Gemma3 di transformers 4.57 butuh torch >= 2.6, sedangkan mesin ukur
  memakai 2.5.1.
- Lisensi: semua kandidat boleh dipakai untuk layanan publik Urusin. Gemma Terms of Use mengizinkan
  penggunaan dan distribusi komersial dengan syarat ketentuan + Prohibited Use Policy diteruskan.
  Image memuat `/models/NOTICE` (lihat `apps/embedding/NOTICE`).

## Ambang produksi (jalur cepat intent)

`AMBANG_INTENT = { skor: 0.45, margin: 0.05 }` (`packages/harness/src/intent-embedding.ts`), sedikit lebih
ketat daripada titik optimum seluruh data (T=0,431). Pada set eval:

| Ambang (T, M)   | Cakupan semua | Salah diterima | Cakupan tanpa-kunci | Presisi tanpa-kunci |
| --------------- | ------------- | -------------- | ------------------- | ------------------- |
| 0,40 / 0,04     | 62,0%         | 4              | 55,9%               | 96,5%               |
| 0,42 / 0,05     | 57,6%         | 2              | 51,3%               | 98,7%               |
| **0,45 / 0,05** | **51,2%**     | **1**          | **45,4%**           | **100%**            |
| 0,50 / 0,05     | 39,0%         | 1              | 36,2%               | 100%                |

Satu-satunya salah terima ("buku KIA posyandu hilang" -> kia) sudah lebih dulu ditangkap kata kunci `kia`,
jadi tidak pernah sampai ke embedding. Hasilnya, hampir separuh pesan yang lolos dari kata kunci tidak lagi
butuh round-trip klasifikasi LLM (7-10 detik di proxy produksi). Sisanya tetap ke LLM seperti sebelumnya.

## Sidecar

Lihat `apps/embedding/Dockerfile` dan layanan `embedding` di `deploy/compose.prod.yml`.

- Image: `llama-server` b12004 (dipin per digest, amd64 + arm64) + GGUF diunduh saat build dari revisi
  HF yang dipin dan dicek sha256 (`b5ce9d77...0d63`). Bobot tidak masuk git.
- Konfigurasi: konteks 1024 (2 slot x 512 token; klien memotong teks di 1.000 karakter), 2 thread,
  UI web mati, user `65534`, filesystem read-only, tanpa capability, port hanya `127.0.0.1:4340`.
- Diukur pada image lokal dengan pengerasan compose yang sama (`--memory 768m`, x86-64):
  - siap (`/health` 200) sekitar 2 detik setelah start;
  - `embed-smoke` di dalam kontainer lolos (dim 768, kelahiran 0,371 vs pajak 0,096);
  - eval penuh lewat kontainer: intent top-1 87,6% / top-3 96,0%, menu 86,9% / 96,7%. Ambang
    produksi 0,45/0,05 memberi angka identik dengan tabel di atas (51,2% / 1 salah, tanpa-kunci
    45,4% @ 100%);
  - latensi p50 50 ms, p95 67 ms;
  - memori: `memory.peak` cgroup 69 MB anon. Bobot 334 MB di-mmap read-only (page cache), jadi
    kasus terburuk sekitar 400-500 MB. Tidak ada OOM pada batas 768 MB.
- `mem_limit` default 768m (`EMBEDDING_MEM_LIMIT`), jauh di bawah anggaran 1,5 GB.
