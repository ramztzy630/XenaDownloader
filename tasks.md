# Daftar Tugas & Alur Pengerjaan — XenaDownloader (Vercel)

> **Instruksi untuk Agent (OpenCode):** Kerjakan tugas secara berurutan dari Fase 1 hingga Fase 4. Setiap kali menyelesaikan satu item, centang `[x]`, lakukan `git commit`, lalu catat **Commit Hash** di samping tugas tersebut.

---

## Fase 1: Setup Proyek & Inisialisasi Repository GitHub
- [x] **1.1** Verifikasi `git` dan `gh` (GitHub CLI) sudah terpasang dan terautentikasi (`gh auth status`). *(Commit: `-`)* — terverifikasi: `git 2.53.0`, `gh 2.46.0`, akun `ramztzy630`.
- [x] **1.2** Inisialisasi repository lokal (`git init -b main`) dan buat commit awal struktur proyek Vercel (`chore: initial vercel project structure, prd, and tasks`). *(Commit: `f7bd95d`)*
- [x] **1.3** Buat repository baru di GitHub dengan nama `XenaDownloader` menggunakan `gh repo create XenaDownloader --public --source=. --remote=origin --push`. *(Commit: `-`)* — https://github.com/ramztzy630/XenaDownloader

---

## Fase 2: Pengerjaan Backend Serverless (`api/`)
- [x] **2.1** Buat branch fitur `git checkout -b feat/serverless-api`. *(Commit: `-`)*
- [x] **2.2** Perbarui `package.json` di root proyek dengan dependensi Node.js murni yang kompatibel dengan Vercel Serverless Functions (tanpa binary sistem berat). *(Commit: `38d6fa4`)*
- [x] **2.3** Buat endpoint `api/health.js` untuk pengecekan status API Vercel (`200 OK`, timestamp, runtime info). *(Commit: `23e9920`)*
- [x] **2.4** Buat helper extractor di `api/_extractor.js` (diawali underscore `_` agar tidak dianggap route publik oleh Vercel) untuk mendeteksi platform (YouTube, TikTok, Instagram, X, Facebook) dan mengambil metadata serta direct download links. *(Commit: `014b5a1`)*
- [x] **2.5** Buat endpoint `api/info.js` (`POST /api/info`) untuk mengembalikan thumbnail, judul, dan opsi kualitas yang tersedia dari URL yang dikirim frontend. *(Commit: `bcad943`)*
- [x] **2.6** Buat endpoint `api/download.js` (`POST /api/download`) untuk mengembalikan direct download URL / stream sesuai format (`video`, `audio`, `photo`) dan kualitas (`1080p`, `720p`, `480p`), lengkap dengan header CORS dan error handling. *(Commit: `dab6311`)*
- [x] **2.7** Push branch `feat/serverless-api` dan buat Pull Request ke `main` via `gh pr create`, lalu merge ke `main`. *(Commit: `faac3c7`)* — PR #1: https://github.com/ramztzy630/XenaDownloader/pull/1

---

## Fase 3: Pengerjaan Frontend (`public/`)
- [x] **3.1** Buat branch fitur `git checkout -b feat/frontend-ui` dari `main` terbaru. *(Commit: `-`)*
- [x] **3.2** Bangun struktur semantik `public/index.html` sesuai spesifikasi di `prd.md` dan referensi visual `public/assets/referensi.jpg` (Navbar XenaDownloader, Hero Title, Form Input URL, Tombol Format Video/Audio/Foto, Tombol Kualitas 1080p/720p/480p, Tombol Ambil Berkas, Badge Platform, Panduan Cara Pakai). *(Commit: `1541969`)*
- [x] **3.3** Styling lengkap di `public/css/style.css` (tampilan bersih mobile-first, kartu membulat, active state tombol format & kualitas, animasi loading, kontras tinggi). *(Commit: `fd251a2`)*
- [x] **3.4** Implementasi logika interaktif di `public/js/app.js`:
  - Switch tab Format (`Video`, `Audio`, `Foto`) & penyesuaian opsi kualitas.
  - Tombol **"Pakai contoh tautan"** & tombol Paste clipboard.
  - Fetch relatif ke `/api/info` dan `/api/download` (otomatis jalan baik di localhost maupun domain `.vercel.app`).
  - Render Result Card dengan thumbnail, judul, dan tombol unduh langsung. *(Commit: `-`)*
- [ ] **3.5** Push branch `feat/frontend-ui` dan buat Pull Request ke `main` via `gh pr create`, lalu merge ke `main`. *(Commit: `-`)*

---

## Fase 4: Validasi Vercel & Dokumentasi Rilis
- [ ] **4.1** Validasi konfigurasi `vercel.json`, struktur `api/` dan `public/`, serta uji syntax seluruh file JS (`node --check`). *(Commit: `-`)*
- [ ] **4.2** Perbarui `README.md` dengan panduan deploy 1-klik ke Vercel dari GitHub dan ringkasan commit hash rilis v1.0.0. *(Commit: `-`)*

---

## Log Riwayat Commit & Pull Request Agent
| Fase / Tugas | Branch | Commit Hash | Pesan Commit | Status PR |
| :--- | :--- | :--- | :--- | :--- |
| 1.1 Verifikasi tooling | `main` | `-` | verifikasi `git` & `gh auth status` | - |
| 1.2 Inisialisasi repo | `main` | `f7bd95d` | `chore: initial vercel project structure, prd, and tasks` | - |
| 1.3 Repo GitHub dibuat | `main` | `-` | `gh repo create XenaDownloader --public --push` | - |
| 2.1 Branch backend | `feat/serverless-api` | `-` | `git checkout -b feat/serverless-api` | - |
| 2.2 Dependensi serverless | `feat/serverless-api` | `38d6fa4` | `chore: configure serverless dependencies and project scripts` | - |
| 2.3 Health endpoint | `feat/serverless-api` | `23e9920` | `feat: add health endpoint and shared serverless utilities` | - |
| 2.4 Extractor multi-platform | `feat/serverless-api` | `014b5a1` | `feat: implement multi-platform media extractor helper` | - |
| 2.5 Info endpoint | `feat/serverless-api` | `bcad943` | `feat: add media info serverless endpoint` | - |
| 2.6 Download endpoint | `feat/serverless-api` | `dab6311` | `feat: add direct download resolver endpoint` | - |
| 2.7 Pull Request backend | `feat/serverless-api` | `faac3c7` | `feat: serverless media API for Vercel` | Merged (#1) |
| 3.1 Branch frontend | `feat/frontend-ui` | `-` | `git checkout -b feat/frontend-ui` | - |
| 3.2 Markup antarmuka | `feat/frontend-ui` | `1541969` | `feat: build accessible downloader UI markup` | - |
| 3.3 Styling antarmuka | `feat/frontend-ui` | `fd251a2` | `feat: style responsive lavender and cream interface` | - |
| 3.4 Logika interaktif | `feat/frontend-ui` | `1bfb6f6` | `feat: wire interactive format, quality, paste, and download flow` | - |
| 3.5 Pull Request frontend | `feat/frontend-ui` | `-` | `feat: responsive downloader frontend` | *dibuat setelah push* |
