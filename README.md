# XenaDownloader

Aplikasi web downloader media sosial (YouTube, TikTok, Instagram, X, Facebook) untuk mengunduh **Video**, **Audio**, dan **Foto** dalam sekali tempel — siap deploy di **Vercel**.

## Struktur Folder (Vercel Ready)
```text
XenaDownloader/
├── vercel.json         # Routing Vercel (Frontend + Serverless API)
├── package.json        # Konfigurasi Node.js & dependensi
├── prd.md              # Product Requirements Document
├── tasks.md            # Alur pengerjaan & log commit hash agent
├── AGENTS.md           # Instruksi otomasi Git & Vercel untuk OpenCode
├── api/
│   ├── health.js       # GET /api/health
│   ├── info.js         # POST /api/info
│   ├── download.js     # POST /api/download
│   └── _extractor.js   # Helper extractor multi-platform
└── public/
    ├── index.html
    ├── css/style.css
    ├── js/app.js
    └── assets/
```

## Deploy ke Vercel
1. Pastikan kode sudah di-push ke repository GitHub `XenaDownloader`.
2. Buka [vercel.com/new](https://vercel.com/new), import repository **XenaDownloader**.
3. Biarkan pengaturan build default (Framework Preset: **Other**), lalu klik **Deploy**.
