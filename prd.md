# Product Requirements Document (PRD) — XenaDownloader (Vercel Edition)

## 1. Ringkasan Proyek
- **Nama Proyek:** XenaDownloader
- **Deskripsi:** Aplikasi web downloader all-in-one yang cepat, ringan, dan tanpa iklan untuk mengunduh video, audio, dan foto dari berbagai platform media sosial hanya dengan menempelkan tautan.
- **Referensi Desain:** Minimalis modern (terinspirasi dari referensi desain *Simpanaja* — kartu bersih dengan sudut membulat, tombol pil interaktif, dan kontras tinggi).
- **Target Hosting:** **Vercel** (Static Frontend di `public/` + Vercel Serverless Functions di `api/`).

---

## 2. Platform yang Didukung
1. **YouTube** (Video, Shorts, Audio MP3/M4A)
2. **TikTok** (Video tanpa watermark, Audio, Slide Foto)
3. **Instagram** (Reels, Post Video, Carousel Foto)
4. **X (Twitter)** (Video, GIF, Foto)
5. **Facebook** (Video publik, Reels)

---

## 3. Arsitektur Khusus Vercel (Serverless)
Karena berjalan di **Vercel Serverless Functions** (stateless, tanpa penyimpanan disk permanen & tanpa binary `ffmpeg` berat):
- **Frontend (`public/`):** File statis murni (`index.html`, `css/style.css`, `js/app.js`) yang langsung disajikan oleh CDN Vercel.
- **Backend (`api/`):** Serverless API routes Node.js (`api/health.js`, `api/info.js`, `api/download.js`) yang mengambil metadata dan **direct download URL / stream** dari extractor API atau library Node.js murni tanpa menyimpan file sementara di server.

---

## 4. Fitur Utama & Spesifikasi Fungsional

### A. Frontend (`public/`)
1. **Header & Navigasi:**
   - Logo ikon unduh + nama brand **XenaDownloader**.
   - Menu navigasi cepat (Beranda, Cara Pakai, Status API, GitHub).
2. **Hero Section & Form Input Utama:**
   - Judul utama: *"Unduh video, audio, dan foto dalam sekali tempel"*
   - Subjudul: *"Gratis, cepat, tanpa aplikasi tambahan."*
   - Input URL (`https://...`) dengan tombol **Tempel (Paste)** otomatis dari clipboard dan link **"Pakai contoh tautan"** untuk uji coba cepat.
3. **Pemilih Format (Tab Interaktif):**
   - `Video` (MP4)
   - `Audio` (MP3 / M4A)
   - `Foto` (JPG / PNG)
4. **Pemilih Kualitas (Pill Selector):**
   - `1080p` (Full HD — default aktif)
   - `720p` (HD)
   - `480p` (Hemat Kuota)
   - *(Otomatis menyesuaikan opsi bitrate jika format Audio dipilih, misal 320kbps / 128kbps)*.
5. **Tombol Aksi Utama & Preview Hasil:**
   - Tombol **"Ambil berkas"** dengan state loading spinner.
   - Kartu hasil (Result Card) menampilkan thumbnail, judul media, platform asal, dan tombol **Download Langsung** yang mengarah ke direct media URL.
6. **Bagian Informasi:**
   - Badge **Platform yang didukung** (YouTube, TikTok, Instagram, X, Facebook).
   - Panduan **Cara pakai** 3 langkah (1. Salin tautan postingan, 2. Tempel dan pilih format, 3. Klik Ambil berkas & unduh).

### B. Serverless API (`api/`)
1. `GET /api/health` — Mengecek status fungsi serverless Vercel.
2. `POST /api/info` — Mendeteksi platform dari URL, mengambil metadata (judul, thumbnail, durasi, daftar kualitas/format tersedia).
3. `POST /api/download` — Mengembalikan direct download URL atau melakukan proxy stream berkas media sesuai format (`video`, `audio`, `photo`) dan kualitas (`1080p`, `720p`, `480p`) tanpa menyimpan file di server.

---

## 5. Aturan Otomasi Git & GitHub untuk AI Agent (OpenCode)
Agent wajib menjalankan siklus Git secara mandiri menggunakan `git` dan GitHub CLI (`gh`):
1. **Inisialisasi & Pembuatan Repo:** Membuat repository GitHub baru bernama `XenaDownloader` secara otomatis via `gh repo create`.
2. **Branching Strategy:** Membuat branch fitur terpisah (`feat/serverless-api`, `feat/frontend-ui`) sebelum merge ke `main`.
3. **Conventional Commits & Pelacakan Hash:** Setiap selesai 1 sub-tugas di `tasks.md`, agent melakukan `git commit` (`feat:`, `fix:`, `docs:`, `chore:`), mencatat short hash (`git rev-parse --short HEAD`) ke `tasks.md`.
4. **Pull Request Otomatis:** Membuat Pull Request ke `main` menggunakan `gh pr create` lengkap dengan ringkasan perubahan dan daftar commit hash, sehingga siap langsung di-import ke **Vercel** dari GitHub.
