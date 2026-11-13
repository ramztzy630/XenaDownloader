# XenaDownloader

Aplikasi web downloader media sosial all-in-one untuk mengunduh **Video**, **Audio**, dan **Foto** dalam sekali tempel. Dibangun sebagai **static frontend + Vercel Serverless Functions** dan siap deploy ke **Vercel**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Framztzy630%2FXenaDownloader)

- **Frontend:** HTML, CSS, dan JavaScript vanilla di `public/` (disajikan CDN Vercel).
- **Backend:** Vercel Serverless Functions Node.js di `api/`.
- **Tanpa** `yt-dlp`, **tanpa** `ffmpeg`, dan **tanpa** penulisan file sementara ke disk.
- **Tanpa** database, login, atau iklan.

## Fitur

- Deteksi otomatis platform dari tautan yang ditempel.
- Pilihan format **Video (MP4)**, **Audio (MP3/M4A)**, dan **Foto (JPG/PNG)**.
- Pilihan kualitas `1080p`, `720p`, `480p` (otomatis menyesuaikan kualitas audio `320kbps` / `128kbps`).
- Tombol tempel clipboard dan contoh tautan untuk uji cepat.
- Kartu hasil berisi thumbnail, judul, platform, kualitas aktual, dan tombol unduh langsung.
- Status API live dari endpoint `/api/health`.
- Tampilan mobile-first dengan kartu membulat, pill interaktif, dan kontras tinggi.

## Platform yang Didukung

| Platform | Video | Audio | Foto | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| YouTube | Ya | Ya* | - | InnerTube `ANDROID_VR`/`IOS` → MP4 & M4A |
| TikTok | Ya | Ya | Ya | HTML/JSON halaman + embed, audio original, slide foto |
| Instagram | Ya | - | Ya | HTML/JSON halaman + embed publik |
| X (Twitter) | Ya | - | Ya | JSON syndication + HTML, video, GIF, dan foto |
| Facebook | Ya | - | - | Plugin video + HTML publik |

\* Ketersediaan audio YouTube bergantung pada respons upstream. Jika stream audio tidak tersedia, API mengembalikan daftar format audio kosong dan frontend menonaktifkan tab Audio.

## Struktur Proyek

```text
XenaDownloader/
├── api/
│   ├── _extractor.js     # Helper multi-platform (bukan route publik)
│   ├── _utils.js         # CORS, parser body, error handling, utilitas
│   ├── health.js         # GET  /api/health
│   ├── info.js           # POST /api/info
│   └── download.js       # POST /api/download
├── public/
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── assets/referensi.jpg
├── package.json
├── package-lock.json
├── vercel.json
├── prd.md
├── tasks.md
└── AGENTS.md
```

## API

### `GET /api/health`

Mengembalikan status fungsi serverless, runtime Node.js, region Vercel, dan timestamp.

```bash
curl https://<domain-vercel>/api/health
```

### `POST /api/info`

Menerima `{ "url": "https://..." }` dan mengembalikan metadata serta daftar format/kualitas yang tersedia (tanpa direct URL).

```bash
curl -X POST https://<domain-vercel>/api/info \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@tiktok/video/7106594312292453675"}'
```

Contoh respons ringkas:

```json
{
  "ok": true,
  "platform": "tiktok",
  "platformLabel": "TikTok",
  "title": "Judul media",
  "author": "Pembuat",
  "thumbnail": "https://...",
  "duration": 24,
  "formats": {
    "video": [{ "quality": "1080p", "label": "HD tanpa watermark", "ext": "mp4" }],
    "audio": [{ "quality": "128kbps", "label": "Audio original", "ext": "m4a" }],
    "photo": []
  },
  "available": { "video": true, "audio": true, "photo": false }
}
```

### `POST /api/download`

Menerima `url`, `format` (`video` | `audio` | `photo`), dan `quality` opsional. Mengembalikan direct download URL beserta nama berkas dan daftar alternatif.

```bash
curl -X POST https://<domain-vercel>/api/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@tiktok/video/7106594312292453675","format":"video","quality":"720p"}'
```

```json
{
  "ok": true,
  "format": "video",
  "quality": "720p",
  "ext": "mp4",
  "filename": "judul-media.mp4",
  "downloadUrl": "https://...",
  "hasAudio": true,
  "downloads": [{ "quality": "720p", "url": "https://...", "ext": "mp4" }]
}
```

Semua endpoint mengirim header CORS, mendukung `OPTIONS`, dan mengembalikan error JSON yang konsisten (`{ "ok": false, "error": "...", "code": "..." }`).

## Deploy 1-Klik ke Vercel

1. Klik tombol **Deploy with Vercel** di atas, atau buka [vercel.com/new](https://vercel.com/new).
2. Import repository **`ramztzy630/XenaDownloader`**.
3. Biarkan pengaturan default:
   - Framework Preset: **Other**
   - Build Command: kosong (tidak perlu build)
   - Output Directory: biarkan default (isi `public/` disajikan otomatis)
4. Klik **Deploy**.

Tidak ada environment variable wajib dan tidak ada API key pihak ketiga.

## Pengembangan Lokal

```bash
git clone https://github.com/ramztzy630/XenaDownloader.git
cd XenaDownloader
npm install
npm run dev
```

`npm run dev` menjalankan `npx vercel dev` sehingga frontend dan serverless functions dapat diuji di `http://localhost:3000`. Login Vercel CLI diperlukan pada pemakaian pertama (`npx vercel login`).

Perintah validasi:

```bash
npm run check
```

Perintah tersebut menjalankan `node --check` untuk seluruh file API dan `public/js/app.js`.

## Catatan Teknis

- Vercel berjalan pada lingkungan serverless read-only. Tidak ada file yang ditulis ke disk dan tidak ada binary sistem yang dijalankan.
- Ekstraksi dilakukan langsung di Node.js: InnerTube YouTube, HTML/JSON TikTok, halaman/embed Instagram, syndication X, dan plugin video Facebook. Tidak ada API ekstraktor pihak ketiga.
- Direct URL media biasanya memiliki masa berlaku terbatas. Frontend menampilkan tombol unduh langsung dan opsi salin tautan.
- URL YouTube dari InnerTube dapat terikat IP pemanggil. Pada deployment serverless, unduhan dari perangkat pengguna dapat ditolak YouTube jika IP berbeda; gunakan proxy stream sendiri bila membutuhkan unduhan lintas IP.
- TikTok dapat menerapkan WAF/Akamai pada halaman atau CDN video. Metadata diambil dari HTML/JSON; audio original biasanya tersedia, sedangkan URL video tertentu dapat memerlukan sesi browser TikTok.
- Instagram dapat menampilkan login wall untuk IP datacenter. Ekstraksi memakai halaman/embed/JSON publik dan dapat gagal pada postingan atau jaringan tertentu.
- Gunakan aplikasi ini hanya untuk mengunduh konten yang kamu miliki haknya dan hormati ketentuan layanan setiap platform.

## Rilis v1.0.0

Ringkasan commit utama:

| Tahap | Commit | Deskripsi |
| :--- | :--- | :--- |
| Initial | `f7bd95d` | Struktur awal proyek Vercel, PRD, dan tasks |
| Backend | `38d6fa4` | Dependensi serverless dan script proyek |
| Backend | `23e9920` | Health endpoint dan utilitas serverless |
| Backend | `014b5a1` | Extractor multi-platform |
| Backend | `bcad943` | Endpoint info media |
| Backend | `dab6311` | Endpoint download langsung |
| Backend | `faac3c7` | Merge Pull Request #1 |
| Frontend | `1541969` | Markup antarmuka downloader |
| Frontend | `fd251a2` | Styling responsif lavender/krem |
| Frontend | `1bfb6f6` | Logika format, kualitas, paste, dan unduhan |
| Frontend | `08c97ac` | Merge Pull Request #2 |
| Release | `0cccc7b` | Perbaikan routing Vercel dan limit fungsi |

Tag rilis: **`v1.0.0`**

## Lisensi

MIT
