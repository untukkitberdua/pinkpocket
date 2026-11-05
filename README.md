# PinkPocket — GitHub Pages + Supabase

Aplikasi catatan keuangan mobile-first untuk satu akun bersama yang digunakan di dua perangkat. Frontend di-host di GitHub Pages; data transaksi disimpan di Supabase Postgres, bukan LocalStorage dan bukan file JSON lokal.

## Fitur

- Login satu akun bersama di HP pengguna pertama dan HP pengguna kedua.
- Satu database yang sama; perubahan disinkronkan melalui Supabase Realtime, dengan sinkronisasi ulang saat aplikasi kembali dibuka.
- Dompet Cash, Rekening, dan Tabungan.
- Pemasukan, pengeluaran, transfer antar-dompet, tambah, edit, dan hapus transaksi.
- Transfer tidak dihitung sebagai pemasukan atau pengeluaran.
- Pemilih periode bulanan berlaku pada seluruh menu.
- Saldo dompet dihitung akumulatif sampai akhir bulan terpilih.
- Rekap harian dengan rincian transaksi yang bisa dibuka.
- Grafik arus kas berupa **dua garis** (pemasukan dan pengeluaran) dengan area selisih di antaranya — bukan barchart.
- Ekspor rekap bulanan ke CSV.
- Data awal kosong, semua saldo Rp0, tanggal pencatatan mulai 1 November 2026.

## A. Buat database Supabase

1. Buat project di [supabase.com](https://supabase.com/).
2. Buka **SQL Editor** pada project tersebut.
3. Buka file `supabase/schema.sql` dari folder ini, salin seluruh isinya, lalu jalankan sekali di SQL Editor.
4. Buka **Project Settings → API**. Salin **Project URL** dan **Publishable key** (atau `anon` public key lama).
5. Di bagian **Authentication → URL Configuration**, tambahkan alamat GitHub Pages aplikasi sebagai Site URL dan Redirect URL setelah alamat itu tersedia. Contoh bentuk URL: `https://USERNAME.github.io/NAMA-REPO/`.

SQL menyiapkan tabel, indeks, Row Level Security, kebijakan akses per akun, dan publikasi Realtime. Jangan menonaktifkan RLS.

## B. Isi konfigurasi aplikasi

1. Salin `config.example.js` menjadi file bernama `config.js`.
2. Isi nilai `supabaseUrl` dan `supabaseAnonKey` dengan nilai dari Supabase.
3. `config.js` memang akan diunggah ke GitHub. Itu aman **hanya karena** isinya memakai publishable/anon key dan tabel dilindungi RLS. **Jangan pernah** memasukkan `service_role` key atau secret key ke file browser.

## C. Upload ke GitHub dan aktifkan Pages

1. Buat repository baru bernama misalnya `pinkpocket`.
2. Upload seluruh isi folder project ini ke root repository, termasuk folder `.github`, `assets`, dan `supabase`, beserta `config.js` yang sudah diisi.
3. Buka **Settings → Pages**.
4. Pada **Build and deployment**, pilih **GitHub Actions** sebagai Source.
5. Workflow `.github/workflows/pages.yml` akan menerbitkan aplikasi setiap ada push ke branch `main`.
6. Setelah deployment berhasil, buka URL Pages yang tampil pada tab **Actions** atau **Settings → Pages**.
7. Salin URL itu ke Supabase **Authentication → URL Configuration** pada Site URL dan Redirect URLs.

## D. Pakai di dua perangkat

1. Buka URL GitHub Pages dari perangkat pertama.
2. Pilih **Buat akun bersama** dan daftar dengan satu email + kata sandi.
3. Jika Supabase meminta konfirmasi email, buka email tersebut dan konfirmasi terlebih dahulu.
4. Buka URL yang sama dari perangkat kedua, lalu masuk menggunakan **email dan kata sandi yang sama**.
5. Setelah itu, catatan dari kedua perangkat akan masuk ke tabel transaksi yang sama.

> Untuk versi ini, kedua orang memakai satu akun login bersama. Jangan bagikan kredensial ke orang lain. Versi ini belum menyediakan dua akun terpisah dalam satu ruang keluarga.

## Catatan teknis dan keamanan

- Frontend adalah situs statis sehingga cocok untuk GitHub Pages; PHP/XAMPP tidak diperlukan.
- Supabase Auth menyimpan sesi login lokal pada masing-masing browser; data transaksi tidak disimpan di LocalStorage.
- RLS membatasi baca/tulis transaksi pada user ID yang sedang login. Walaupun publishable key terlihat di JavaScript browser, key itu tidak memberikan akses untuk melewati RLS.
- Notifikasi Realtime memperbarui tampilan perangkat lain. Jika jaringan/Realtime terputus, aplikasi juga menyinkronkan ulang saat tab kembali aktif atau mendapat fokus.
- Project Supabase gratis dapat memiliki batas dan kebijakan jeda saat tidak aktif. Cek dashboard Supabase untuk status dan kuota project.
- Jangan menaruh data kartu, PIN bank, kata sandi bank, atau informasi autentikasi finansial pada kolom catatan.

## Jalankan lokal untuk uji tampilan

Karena ini frontend statis, bisa dibuka melalui server lokal sederhana. Konfigurasi Supabase tetap perlu diisi untuk login dan penyimpanan bersama. Tidak perlu XAMPP atau MySQL.
