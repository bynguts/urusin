<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import '#lib/components/landing/landing-dasar.css';
  import '#lib/components/landing/landing-pen.css';
  import '#lib/components/landing/landing-responsif.css';
  import '#lib/components/landing/landing-gerak.css';
  import './cara-kerja.css';
  import LandingFooter from '#lib/components/landing/LandingFooter.svelte';
  import LandingNav from '#lib/components/landing/LandingNav.svelte';
  import g6a41666 from '#lib/assets/img/pen-landing/amber-40.webp';
  import g1f3c995 from '#lib/assets/img/pen-landing/amber-jempol-202.webp';
  import g6fb359f from '#lib/assets/img/pen-landing/blue-40.webp';
  import g691b4cb from '#lib/assets/img/pen-landing/blue-berpikir-150.webp';
  import g6f46ff7 from '#lib/assets/img/pen-landing/blue-berpikir-300.webp';
  import g19932a8 from '#lib/assets/img/pen-landing/blue-memeriksa-202.webp';
  import g9aa4b71 from '#lib/assets/img/pen-landing/comparison-2824-1440.webp';
  import ge3aff08 from '#lib/assets/img/pen-landing/cta-panel-51bc-1040.webp';
  import g0dc5ab3 from '#lib/assets/img/pen-landing/green-40.webp';
  import g218ab04 from '#lib/assets/img/pen-landing/green-duduk-130.webp';
  import g8bae95b from '#lib/assets/img/pen-landing/green-duduk-260.webp';
  import gcb5b056 from '#lib/assets/img/pen-landing/green-membaca-183.webp';
  import gabb844a from '#lib/assets/img/pen-landing/green-membaca-366.webp';
  import g969c6d7 from '#lib/assets/img/pen-landing/purple-40.webp';
  import gd74aa1e from '#lib/assets/img/pen-landing/purple-laptop-183.webp';
  import g0e63181 from '#lib/assets/img/pen-landing/purple-laptop-366.webp';
  import gf294e85 from '#lib/assets/img/pen-landing/rose-40.webp';
  import gb7cf987 from '#lib/assets/img/pen-landing/rose-44.webp';
  import g822e46b from '#lib/assets/img/pen-landing/rose-melambai-202.webp';
  import g7e4f985 from '#lib/assets/img/pen-landing/urusin-mark-52.webp';
  import gb9287ba from '#lib/assets/img/pen-web/amber-20.webp';
  import g7439031 from '#lib/assets/img/pen-web/amber-jempol-404.webp';
  import g87da289 from '#lib/assets/img/pen-web/blue-20.webp';
  import g0c757cc from '#lib/assets/img/pen-web/blue-memeriksa-404.webp';
  import g8b5f70f from '#lib/assets/img/pen-web/green-20.webp';
  import g07107c8 from '#lib/assets/img/pen-web/purple-20.webp';
  import gac191dd from '#lib/assets/img/pen-web/purple-laptop-190.webp';
  import g6753c85 from '#lib/assets/img/pen-web/purple-laptop-380.webp';
  import g4f9f209 from '#lib/assets/img/pen-web/rose-20.webp';
  import gb20a35a from '#lib/assets/img/pen-web/rose-22.webp';
  import g3aa985d from '#lib/assets/img/pen-web/rose-melambai-170.webp';
  import gb232d0c from '#lib/assets/img/pen-web/rose-melambai-340.webp';
  import ga73a4d3 from '#lib/assets/img/pen-web/rose-melambai-404.webp';

  /*
   * Cara kerja = frame Web "Cara kerja" dari pen Rafi, dikonversi dari ekspor HTML/CSS apa adanya (kelas ckN di
   * cara-kerja.css). Header dan footer memakai komponen landing. Salinan yang menyebut ekstensi diganti karena
   * ekstensi sudah tidak ada; NIK contoh disamarkan seperti tampilan Urusin.
   */
  const targetMulai = $derived(page.data.akun ? resolve('/beranda') : resolve('/daftar'));
</script>

<svelte:head>
  <title>Cara kerja · Urusin</title>
  <meta
    name="description"
    content="Dari cerita sampai nomor permohonan: siapa mengerjakan apa, apa itu Browser Pendamping, dan batas yang selalu dijaga."
  />
</svelte:head>

<main class="lp0 lp" id="konten">
  <LandingNav aktif="cara-kerja" />
  <!-- Page hero -->
  <section class="ck1">
    <div class="ck2">
      <div class="ck3">
        <p class="ck4">Cara kerja</p>
      </div>
      <h1 class="ck5">Dari cerita sampai pengajuan, langkah demi langkah</h1>
      <p class="ck6">
        Urusin memahami kebutuhanmu, menyusun rencana dari aturan resmi, lalu membantu mengisi formulir.
        Keputusan dan tombol Kirim tetap di tanganmu.
      </p>
    </div>
    <div class="ck7">
      <img
        class="ck8"
        src={gac191dd}
        srcset="{gac191dd} 190w, {g6753c85} 380w"
        sizes="190px"
        alt=""
        width="190"
        height="250"
        decoding="async"
      />
      <img
        class="ck9"
        src={g3aa985d}
        srcset="{g3aa985d} 170w, {gb232d0c} 340w"
        sizes="170px"
        alt=""
        width="170"
        height="220"
        decoding="async"
      />
    </div>
  </section>
  <!-- Content -->
  <section class="ck10">
    <div class="ck11" id="langkah">
      <div class="ck12">
        <h2 class="ck13">Dari cerita sampai nomor permohonan</h2>
        <p class="ck14">
          Setiap langkah menunjukkan siapa yang mengerjakan. Kamu cukup membuka web Urusin, tanpa memasang apa
          pun.
        </p>
      </div>
      <div class="ck15">
        <div class="ck16">
          <p class="ck17">01</p>
          <h3 class="ck18">Ceritakan masalahnya</h3>
          <p class="ck19">
            Ketik atau ucapkan, misalnya “KK saya hilang”. Urusin bertanya balik kalau ada yang belum jelas.
          </p>
          <div class="ck20">
            <img
              class="ck21"
              src="/pen/i-b869ceee98.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ck22">Kamu</p>
          </div>
        </div>
        <div class="ck23">
          <p class="ck24">02</p>
          <h3 class="ck25">AI menyusun rencana bersumber</h3>
          <p class="ck26">
            Syarat diambil dari situs resmi wilayahmu, lengkap dengan kutipan dan tanggal verifikasi. Kalau
            sumbernya tidak ada, AI tidak mengarang.
          </p>
          <div class="ck27">
            <img
              class="ck28"
              src="/pen/i-1fad443051.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ck29">Urusin</p>
          </div>
        </div>
        <div class="ck30">
          <p class="ck31">03</p>
          <h3 class="ck32">Isi data diri dan foto berkas</h3>
          <p class="ck33">
            Data disimpan terenkripsi dan AI tidak pernah melihat NIK aslimu. Foto berkas diberi tanda hijau,
            kuning, atau merah.
          </p>
          <div class="ck34">
            <img
              class="ck35"
              src="/pen/i-b869ceee98.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ck36">Kamu</p>
          </div>
        </div>
        <div class="ck37">
          <p class="ck38">04</p>
          <h3 class="ck39">Setujui sebelum AI bekerja</h3>
          <p class="ck40">Ringkasan isian ditampilkan tersamar, beserta situs tujuan dan jumlah berkas.</p>
          <div class="ck41">
            <img
              class="ck42"
              src="/pen/i-b869ceee98.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ck43">Kamu</p>
          </div>
        </div>
        <div class="ck44">
          <p class="ck45">05</p>
          <h3 class="ck46">Giliranmu: masuk akun</h3>
          <p class="ck47">
            Browser Pendamping membuka situs resmi. Login dan CAPTCHA kamu ketik sendiri, tidak dibaca AI.
          </p>
          <div class="ck48">
            <img
              class="ck49"
              src="/pen/i-b869ceee98.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ck50">Kamu</p>
          </div>
        </div>
        <div class="ck51">
          <p class="ck52">06</p>
          <h3 class="ck53">AI mengisi dan mengunggah berkas</h3>
          <p class="ck54">Kamu menonton prosesnya dan bisa menekan Ambil alih atau Hentikan kapan saja.</p>
          <div class="ck55">
            <img
              class="ck56"
              src="/pen/i-1fad443051.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ck57">Urusin</p>
          </div>
        </div>
        <div class="ck58">
          <p class="ck59">07</p>
          <h3 class="ck60">Giliranmu: tekan Kirim</h3>
          <p class="ck61">
            AI dikunci agar tidak bisa menekan tombol kirim terakhir. Kamu memeriksa isian lalu menekannya
            sendiri.
          </p>
          <div class="ck62">
            <img
              class="ck63"
              src="/pen/i-b869ceee98.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ck64">Kamu</p>
          </div>
        </div>
        <div class="ck65">
          <p class="ck66">08</p>
          <h3 class="ck67">Nomor permohonan dicatat</h3>
          <p class="ck68">Browser dihancurkan bersama login dan cookie. Semua langkah tercatat di Jejak.</p>
          <div class="ck69">
            <img
              class="ck70"
              src="/pen/i-1fad443051.svg"
              alt=""
              width="15"
              height="15"
              loading="lazy"
              decoding="async"
            />
            <p class="ck71">Urusin</p>
          </div>
        </div>
      </div>
    </div>
    <div class="ck72">
      <div class="ck73">
        <h2 class="ck74">Apa itu Browser Pendamping?</h2>
        <p class="ck75">
          Browser sungguhan yang berjalan di server Urusin dan tampil langsung di layarmu. Kamu melihat situs
          pemerintah yang asli, tapi yang mengisi formulir adalah AI.
        </p>
        <div class="ck76">
          <div class="ck77">
            <img
              class="ck78"
              src="/pen/i-1a8e09ee1c.svg"
              alt=""
              width="17"
              height="17"
              loading="lazy"
              decoding="async"
            />
          </div>
          <p class="ck79">Tidak perlu memasang aplikasi apa pun</p>
        </div>
        <div class="ck80">
          <div class="ck81">
            <img
              class="ck82"
              src="/pen/i-5892c84ef1.svg"
              alt=""
              width="17"
              height="17"
              loading="lazy"
              decoding="async"
            />
          </div>
          <p class="ck83">AI berhenti saat login, CAPTCHA, dan tombol Kirim</p>
        </div>
        <div class="ck84">
          <div class="ck85">
            <img
              class="ck86"
              src="/pen/i-cc06d9a3b5.svg"
              alt=""
              width="17"
              height="17"
              loading="lazy"
              decoding="async"
            />
          </div>
          <p class="ck87">Dihancurkan setelah selesai, tanpa menyimpan cookie atau password</p>
        </div>
      </div>
      <div class="ck88" aria-hidden="true">
        <div class="ck89">
          <div class="ck90">
            <img
              class="ck91"
              src="/pen/i-4fbc7b9a2c.svg"
              alt=""
              width="12"
              height="12"
              loading="lazy"
              decoding="async"
            />
            <p class="ck92">telunjuksakti.wonogirikab.go.id</p>
            <p class="ck93">Disdukcapil Kab. Wonogiri</p>
            <div class="ck94">
              <img
                class="ck95"
                src="/pen/i-1353146410.svg"
                alt=""
                width="11"
                height="11"
                loading="lazy"
                decoding="async"
              />
              <p class="ck96">AI sedang mengisi</p>
            </div>
          </div>
          <div class="ck97">
            <div class="ck98">
              <div class="ck99">
                <div class="ck100">
                  <div class="ck101">
                    <img
                      class="ck102"
                      src="/pen/i-a5b740d1f7.svg"
                      alt=""
                      width="15"
                      height="15"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div class="ck103">
                    <p class="ck104">Telunjuk Sakti</p>
                    <p class="ck105">Kab. Wonogiri</p>
                  </div>
                </div>
                <div class="ck106">
                  <p class="ck107">Beranda</p>
                  <p class="ck108">Layanan</p>
                  <p class="ck109">Informasi</p>
                  <p class="ck110">Pengaduan</p>
                </div>
              </div>
              <div class="ck111">
                <div class="ck112">
                  <p class="ck113">Beranda / Layanan / Akta Kelahiran</p>
                  <p class="ck114">Formulir Pengajuan Akta Kelahiran</p>
                </div>
                <div class="ck115">
                  <div class="ck116">
                    <div class="ck117">
                      <img
                        class="ck118"
                        src="/pen/i-ca07b206c1.svg"
                        alt=""
                        width="11"
                        height="11"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    <p class="ck119">Data anak</p>
                  </div>
                  <div class="ck120"></div>
                  <div class="ck121">
                    <div class="ck122">
                      <p class="ck123">2</p>
                    </div>
                    <p class="ck124">Data orang tua</p>
                  </div>
                  <div class="ck125"></div>
                  <div class="ck126">
                    <div class="ck127">
                      <p class="ck128">3</p>
                    </div>
                    <p class="ck129">Dokumen</p>
                  </div>
                  <div class="ck130"></div>
                  <div class="ck131">
                    <div class="ck132">
                      <p class="ck133">4</p>
                    </div>
                    <p class="ck134">Verifikasi</p>
                  </div>
                </div>
                <div class="ck135">
                  <p class="ck136">DATA ANAK</p>
                  <div class="ck137">
                    <div class="ck138">
                      <p class="ck139">Nama anak</p>
                      <div class="ck140">
                        <div class="ck141">
                          <p class="ck142">Aruna Putri Pratama</p>
                        </div>
                        <img
                          class="ck143"
                          src="/pen/i-645497d86b.svg"
                          alt=""
                          width="13"
                          height="13"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    </div>
                    <div class="ck144">
                      <p class="ck145">Jenis kelamin</p>
                      <div class="ck146">
                        <div class="ck147">
                          <p class="ck148">Perempuan</p>
                        </div>
                        <img
                          class="ck149"
                          src="/pen/i-645497d86b.svg"
                          alt=""
                          width="13"
                          height="13"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    </div>
                  </div>
                  <div class="ck150">
                    <div class="ck151">
                      <p class="ck152">Tempat lahir</p>
                      <div class="ck153">
                        <div class="ck154">
                          <p class="ck155">RSIA Wonogiri</p>
                        </div>
                        <img
                          class="ck156"
                          src="/pen/i-645497d86b.svg"
                          alt=""
                          width="13"
                          height="13"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    </div>
                    <div class="ck157">
                      <p class="ck158">Tanggal lahir</p>
                      <div class="ck159">
                        <div class="ck160">
                          <p class="ck161">02/11/2026</p>
                        </div>
                        <img
                          class="ck162"
                          src="/pen/i-645497d86b.svg"
                          alt=""
                          width="13"
                          height="13"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    </div>
                  </div>
                  <p class="ck163">DATA ORANG TUA</p>
                  <div class="ck164">
                    <div class="ck165">
                      <p class="ck166">NIK ayah</p>
                      <div class="ck167">
                        <div class="ck168">
                          <p class="ck169">3312 •••• •••• 0007</p>
                        </div>
                        <img
                          class="ck170"
                          src="/pen/i-645497d86b.svg"
                          alt=""
                          width="13"
                          height="13"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    </div>
                    <div class="ck171">
                      <p class="ck172">Nama ayah</p>
                      <div class="ck173">
                        <div class="ck174">
                          <p class="ck175">Dimas Pra</p>
                          <div class="ck176"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="ck177">
                    <div class="ck178">
                      <p class="ck179">Nama ibu</p>
                      <div class="ck180">
                        <div class="ck181">
                          <div class="ck182"></div>
                        </div>
                      </div>
                    </div>
                    <div class="ck183">
                      <p class="ck184">NIK ibu</p>
                      <div class="ck185">
                        <div class="ck186">
                          <div class="ck187"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <img
                class="ck188"
                src="/pen/i-4d5f94439a.svg"
                alt=""
                width="20"
                height="20"
                loading="lazy"
                decoding="async"
              />
              <div class="ck189">
                <img
                  class="ck190"
                  src={gb20a35a}
                  srcset="{gb20a35a} 22w, {gb7cf987} 44w"
                  sizes="22px"
                  alt=""
                  width="22"
                  height="22"
                  loading="lazy"
                  decoding="async"
                />
                <p class="ck191">Rose mengisi Nama ayah</p>
              </div>
            </div>
          </div>
          <div class="ck192">
            <div class="ck193">
              <p class="ck194">Mengisi formulir · 5 dari 8 kolom</p>
              <div class="ck195">
                <div class="ck196"></div>
              </div>
            </div>
            <div class="ck197">
              <img
                class="ck198"
                src="/pen/i-3fc15a5401.svg"
                alt=""
                width="13"
                height="13"
                loading="lazy"
                decoding="async"
              />
              <p class="ck199">Ambil alih</p>
            </div>
            <div class="ck200">
              <img
                class="ck201"
                src="/pen/i-13ad238c22.svg"
                alt=""
                width="13"
                height="13"
                loading="lazy"
                decoding="async"
              />
              <p class="ck202">Hentikan</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="ck203">
      <div class="ck204">
        <h2 class="ck205">Batas yang selalu dijaga</h2>
      </div>
      <div class="ck206">
        <div class="ck207">
          <h3 class="ck208">Urusin melakukan</h3>
          <div class="ck209">
            <div class="ck210">
              <img
                class="ck211"
                src="/pen/i-959add1d16.svg"
                alt=""
                width="14"
                height="14"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p class="ck212">Mencari syarat dari situs resmi wilayahmu</p>
          </div>
          <div class="ck213">
            <div class="ck214">
              <img
                class="ck215"
                src="/pen/i-959add1d16.svg"
                alt=""
                width="14"
                height="14"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p class="ck216">Membuka situs resmi di Browser Pendamping</p>
          </div>
          <div class="ck217">
            <div class="ck218">
              <img
                class="ck219"
                src="/pen/i-959add1d16.svg"
                alt=""
                width="14"
                height="14"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p class="ck220">Mengisi kolom dan mengunggah berkas yang kamu setujui</p>
          </div>
          <div class="ck221">
            <div class="ck222">
              <img
                class="ck223"
                src="/pen/i-959add1d16.svg"
                alt=""
                width="14"
                height="14"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p class="ck224">Mencatat nomor permohonan untukmu</p>
          </div>
        </div>
        <div class="ck225">
          <h3 class="ck226">Urusin tidak pernah</h3>
          <div class="ck227">
            <div class="ck228">
              <img
                class="ck229"
                src="/pen/i-e034c903d2.svg"
                alt=""
                width="14"
                height="14"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p class="ck230">Membaca atau menyimpan password dan OTP</p>
          </div>
          <div class="ck231">
            <div class="ck232">
              <img
                class="ck233"
                src="/pen/i-e034c903d2.svg"
                alt=""
                width="14"
                height="14"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p class="ck234">Melihat NIK aslimu</p>
          </div>
          <div class="ck235">
            <div class="ck236">
              <img
                class="ck237"
                src="/pen/i-e034c903d2.svg"
                alt=""
                width="14"
                height="14"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p class="ck238">Menekan tombol Kirim atas namamu</p>
          </div>
          <div class="ck239">
            <div class="ck240">
              <img
                class="ck241"
                src="/pen/i-e034c903d2.svg"
                alt=""
                width="14"
                height="14"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p class="ck242">Menyimpan cookie atau rekaman layar</p>
          </div>
        </div>
      </div>
    </div>
  </section>
  <!-- Comparison -->
  <section class="n-comparison ck243" style:background-image="url({g9aa4b71})">
    <div class="ck244"></div>
    <h2 class="n-title ck245">Mengurus sendiri vs. bersama Urusin</h2>
    <div class="n-columns ck246">
      <div class="ck247">
        <div class="ck248">
          <div class="ck249" aria-hidden="true">
            <div class="ck250">
              <img
                class="ck251"
                src="/pen/i-86c4291272.svg"
                alt=""
                width="18"
                height="18"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div class="ck252">
              <img
                class="ck253"
                src="/pen/i-9965d954e6.svg"
                alt=""
                width="18"
                height="18"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div class="ck254">
              <img
                class="ck255"
                src="/pen/i-40bdad0975.svg"
                alt=""
                width="18"
                height="18"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
          <p class="ck256">Mengurus sendiri</p>
        </div>
        <div class="n-visual ck257" aria-hidden="true">
          <div class="ck258">
            <div class="ck259">
              <div class="ck260"></div>
              <div class="ck261"></div>
              <div class="ck262"></div>
              <p class="ck263">Syarat akta kelahiran</p>
            </div>
            <div class="ck264">
              <div class="ck265"></div>
              <div class="ck266"></div>
              <div class="ck267"></div>
            </div>
          </div>
          <div class="ck268">
            <div class="ck269">
              <div class="ck270"></div>
              <div class="ck271"></div>
              <div class="ck272"></div>
              <p class="ck273">Grup WA keluarga</p>
            </div>
            <div class="ck274">
              <div class="ck275"></div>
              <div class="ck276"></div>
              <div class="ck277"></div>
            </div>
          </div>
          <div class="ck278">
            <div class="ck279">
              <div class="ck280"></div>
              <div class="ck281"></div>
              <div class="ck282"></div>
              <p class="ck283">Form error 404</p>
            </div>
            <div class="ck284">
              <div class="ck285"></div>
              <div class="ck286"></div>
              <div class="ck287"></div>
            </div>
          </div>
          <img
            class="ck288"
            src={g691b4cb}
            srcset="{g691b4cb} 150w, {g6f46ff7} 300w"
            sizes="150px"
            alt=""
            width="150"
            height="164"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="n-list ck289">
          <div class="ck290">
            <img
              class="ck291"
              src="/pen/i-67a231781a.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <p class="ck292">Cari syarat di banyak situs</p>
          </div>
          <div class="ck293">
            <img
              class="ck294"
              src="/pen/i-67a231781a.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <p class="ck295">Istilah yang membingungkan</p>
          </div>
          <div class="ck296">
            <img
              class="ck297"
              src="/pen/i-67a231781a.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <p class="ck298">Bolak-balik karena berkas ditolak</p>
          </div>
        </div>
      </div>
      <div class="ck299">
        <div class="ck300">
          <div class="ck301">
            <div class="ck302" style:background-image="url({g7e4f985})"></div>
          </div>
          <p class="ck303">Bersama Urusin</p>
        </div>
        <div class="n-visual ck304" aria-hidden="true">
          <div class="ck305">
            <p class="ck306">Langkahmu · Kelahiran anak</p>
            <div class="ck307">
              <div class="ck308">
                <img
                  class="ck309"
                  src="/pen/i-35cb8afd9d.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
                <p class="ck310">Akta kelahiran</p>
              </div>
              <p class="ck311">Siap diajukan</p>
            </div>
            <div class="ck312">
              <div class="ck313">
                <img
                  class="ck314"
                  src="/pen/i-bc5e562f28.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
                <p class="ck315">Perbarui KK</p>
              </div>
              <p class="ck316">Menyusul</p>
            </div>
            <div class="ck317">
              <div class="ck318">
                <img
                  class="ck319"
                  src="/pen/i-bc5e562f28.svg"
                  alt=""
                  width="14"
                  height="14"
                  loading="lazy"
                  decoding="async"
                />
                <p class="ck320">BPJS anak</p>
              </div>
              <p class="ck321">Menyusul</p>
            </div>
          </div>
          <img
            class="ck322"
            src={g218ab04}
            srcset="{g218ab04} 130w, {g8bae95b} 260w"
            sizes="130px"
            alt=""
            width="130"
            height="142"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div class="n-list ck323">
          <div class="ck324">
            <img
              class="ck325"
              src="/pen/i-fb1f354d71.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <p class="ck326">Satu daftar langkah dari sumber resmi</p>
          </div>
          <div class="ck327">
            <img
              class="ck328"
              src="/pen/i-fb1f354d71.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <p class="ck329">Dijelaskan dengan bahasa sehari-hari</p>
          </div>
          <div class="ck330">
            <img
              class="ck331"
              src="/pen/i-fb1f354d71.svg"
              alt=""
              width="18"
              height="18"
              loading="lazy"
              decoding="async"
            />
            <p class="ck332">Dokumen diperiksa sebelum dikirim</p>
          </div>
        </div>
      </div>
    </div>
  </section>
  <!-- Final CTA -->
  <section class="ck333">
    <div class="n-cta-panel ck334" style:background-image="url({ge3aff08})">
      <div class="n-copy ck335">
        <div class="ck336">
          <div class="ck337">
            <img
              class="ck338"
              src={g4f9f209}
              srcset="{g4f9f209} 20w, {gf294e85} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
            <img
              class="ck339"
              src={g07107c8}
              srcset="{g07107c8} 20w, {g969c6d7} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
            <img
              class="ck340"
              src={g87da289}
              srcset="{g87da289} 20w, {g6fb359f} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
            <img
              class="ck341"
              src={g8b5f70f}
              srcset="{g8b5f70f} 20w, {g0dc5ab3} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
            <img
              class="ck342"
              src={gb9287ba}
              srcset="{gb9287ba} 20w, {g6a41666} 40w"
              sizes="20px"
              alt=""
              width="20"
              height="20"
              loading="lazy"
              decoding="async"
            />
          </div>
          <p class="ck343">5 pendamping siap menemani</p>
        </div>
        <h2 class="ck344">
          Urusan berikutnya,
          <br />
          kita kerjakan bareng
        </h2>
        <p class="n-sub ck345">
          Gratis dan langsung dari browser. Ceritakan apa yang terjadi, Urusin yang menyusun langkahnya.
        </p>
        <div class="ck346">
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a class="ck347" href={targetMulai}>
            <img
              class="ck348"
              src="/pen/i-f8e6f89678.svg"
              alt=""
              width="16"
              height="16"
              loading="lazy"
              decoding="async"
            />
            <span class="ck349">Mulai urusan</span>
          </a>
          <a class="ck350" href="#langkah">
            <span class="ck351">Lihat cara kerja</span>
          </a>
        </div>
        <div class="ck352">
          <div class="ck353">
            <img
              class="ck354"
              src="/pen/i-0066e04d08.svg"
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
            />
            <p class="ck355">Gratis</p>
          </div>
          <div class="ck356">
            <img
              class="ck357"
              src="/pen/i-c9f5ddfae9.svg"
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
            />
            <p class="ck358">Data tetap milikmu</p>
          </div>
          <div class="ck359">
            <img
              class="ck360"
              src="/pen/i-f6cec391af.svg"
              alt=""
              width="14"
              height="14"
              loading="lazy"
              decoding="async"
            />
            <p class="ck361">Kamu yang kirim</p>
          </div>
        </div>
      </div>
      <div class="n-companions ck362">
        <img
          class="ck363"
          src={gd74aa1e}
          srcset="{gd74aa1e} 183w, {g0e63181} 366w"
          sizes="183px"
          alt=""
          width="183"
          height="200"
          loading="lazy"
          decoding="async"
        />
        <img
          class="ck364"
          src={gcb5b056}
          srcset="{gcb5b056} 183w, {gabb844a} 366w"
          sizes="183px"
          alt=""
          width="183"
          height="200"
          loading="lazy"
          decoding="async"
        />
        <img
          class="ck365"
          src={g822e46b}
          srcset="{g822e46b} 202w, {ga73a4d3} 404w"
          sizes="202px"
          alt=""
          width="202"
          height="220"
          loading="lazy"
          decoding="async"
        />
        <img
          class="ck366"
          src={g1f3c995}
          srcset="{g1f3c995} 202w, {g7439031} 404w"
          sizes="202px"
          alt=""
          width="202"
          height="220"
          loading="lazy"
          decoding="async"
        />
        <img
          class="ck367"
          src={g19932a8}
          srcset="{g19932a8} 202w, {g0c757cc} 404w"
          sizes="202px"
          alt=""
          width="202"
          height="220"
          loading="lazy"
          decoding="async"
        />
        <div class="ck368">
          <p class="ck369">Mau urus apa hari ini?</p>
        </div>
      </div>
    </div>
  </section>
  <LandingFooter />
</main>
