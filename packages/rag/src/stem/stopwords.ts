/**
 * Daftar stopword bahasa Indonesia (kata fungsi + gaya tutur awam/Jawa-Indonesia).
 * SUMBER: disusun sendiri oleh tim Urusin, dilisensikan MIT bersama repo ini; tidak menyalin
 * daftar pihak ketiga. Kata bermakna layanan (mis. "hilang", "baru", "pindah") sengaja TIDAK masuk.
 */
export const STOPWORDS: ReadonlySet<string> = new Set(
  `
  yang dan di ke dari pada untuk dengan atau juga serta akan sudah telah belum masih sedang
  ini itu tersebut tadi nanti saat ketika sebelum sesudah setelah sambil agar supaya sehingga
  karena sebab jika kalau bila apabila maka namun tetapi tapi hanya saja sih dong deh
  kok lho loh nih tuh yah ya iya kan kah lah pun nya adalah ialah yaitu yakni merupakan
  oleh dalam antara terhadap tentang atas bawah sampai hingga sejak seperti bagi demi
  saya aku kami kita kamu anda dia mereka beliau gue gua lu lo
  apa siapa mana kapan bagaimana gimana gmn gmana kenapa mengapa berapa brp dimana kemana
  ada adanya tidak tak nggak ngga gak ga enggak bukan jangan belom blm udah udh
  mau ingin pengen pingin bisa dapat boleh harus mesti perlu wajib tolong mohon bantu bantuin
  sangat sekali lebih paling cukup agak banyak sedikit semua setiap tiap beberapa para
  lagi lalu terus trus kemudian dulu dahulu aja doang banget bgt dgn yg utk dr dlm sy
  mas mbak pak bu bapak ibu kak min admin halo hai permisi makasih terima kasih
  `
    .split(/\s+/)
    .filter(Boolean),
);
