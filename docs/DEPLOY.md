# 🎵 NADA STUDIO — Panduan Deploy Lengkap

## Gambaran Arsitektur

```
Browser (Vercel)  ←→  Backend API (Railway)  ←→  yt-dlp + FFmpeg
     ↕                        ↕
  Frontend              Roblox API
  Next.js            (upload audio)
```

---

## BAGIAN 1 — Deploy Backend ke Railway

Railway adalah platform hosting gratis yang support Docker + Python.

### Langkah 1: Buat Akun Railway
1. Buka https://railway.app
2. Login dengan GitHub

### Langkah 2: Upload Backend
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Masuk ke folder backend
cd nada-studio/backend

# Init project baru
railway init
# Pilih: "Empty project"
# Beri nama: nada-studio-api

# Deploy
railway up
```

### Langkah 3: Set Environment Variables di Railway
Di dashboard Railway → project kamu → Variables, tambahkan:

| Key | Value |
|-----|-------|
| `SECRET_KEY` | random string panjang (min 32 karakter) |
| `ALLOWED_ORIGINS` | URL frontend kamu (isi setelah frontend deploy) |
| `MAX_JOBS` | `10` |
| `JOB_TTL` | `3600` |
| `PORT` | `5000` (Railway set otomatis) |

### Langkah 4: Catat URL Backend
Setelah deploy, Railway beri URL seperti:
`https://nada-studio-api.up.railway.app`

Catat URL ini, dipakai di frontend.

### Test Backend
```bash
curl https://nada-studio-api.up.railway.app/health
# Response: {"ok": true, "jobs": 0}
```

---

## BAGIAN 2 — Deploy Frontend ke Vercel

### Langkah 1: Buat Akun Vercel
1. Buka https://vercel.com
2. Login dengan GitHub

### Langkah 2: Push ke GitHub dulu
```bash
# Di folder root nada-studio
git init
git add .
git commit -m "init nada studio"
git remote add origin https://github.com/username/nada-studio.git
git push -u origin main
```

### Langkah 3: Import ke Vercel
1. Buka https://vercel.com/new
2. Import repo GitHub kamu
3. Set **Root Directory** ke `frontend`
4. Set **Framework Preset** ke `Next.js`

### Langkah 4: Set Environment Variable
Di Vercel project settings → Environment Variables:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://nada-studio-api.up.railway.app` |

### Langkah 5: Deploy
Klik Deploy. Tunggu ~2 menit.

URL frontend akan jadi: `https://nada-studio-xxx.vercel.app`

---

## BAGIAN 3 — Update CORS di Backend

Setelah dapat URL frontend dari Vercel, update Railway env var:
```
ALLOWED_ORIGINS=https://nada-studio-xxx.vercel.app
```

Trigger redeploy di Railway.

---

## BAGIAN 4 — Test End-to-End

1. Buka URL frontend (Vercel)
2. Tab **Input & Proses**
3. Paste link YouTube: `https://youtu.be/dQw4w9WgXcQ`
4. Klik **+ Tambah** — tunggu info muncul
5. Set target durasi (misal 7:00)
6. Klik **⚡ PROSES SEMUA**
7. Tunggu progress 100%
8. Klik **⬇ MP3** untuk download

---

## BAGIAN 5 — Cara Pakai Roblox Upload

1. Tab **Upload ke Roblox**
2. Isi **Creator ID**: buka roblox.com, login, lihat URL profil
   - `https://www.roblox.com/users/123456789/profile` → ID = `123456789`
3. Ambil cookie:
   - Chrome → F12 → Application → Cookies → roblox.com
   - Cari `.ROBLOSECURITY` → copy Value
4. Proses audio dulu di tab sebelumnya
5. Klik **↑ Upload** di tab Roblox
6. Catat Asset ID yang muncul

---

## BAGIAN 6 — Troubleshooting

### ❌ "yt-dlp error: Sign in to confirm you're not a bot"
YouTube kadang block download tanpa login. Solusinya pakai cookies:
```bash
# Di Chrome, install extension "cookies.txt LOCALLY"
# Export cookies roblox/youtube
# Upload file cookies.txt ke Railway

# Set env var di Railway:
COOKIES_FILE=/app/cookies.txt
```
Untuk upload file ke Railway, gunakan Volume atau paste isi cookie langsung.

### ❌ CORS Error di browser
- Pastikan `ALLOWED_ORIGINS` di Railway sudah include URL frontend
- Format: `https://nada-studio.vercel.app` (tanpa trailing slash)

### ❌ "Server busy"
- Railway free tier: 512MB RAM, bisa handle ~5 jobs paralel
- Naikkan `MAX_JOBS` hanya kalau upgrade plan Railway

### ❌ Download gagal tapi tidak ada error
- CEK: apakah Railway free tier sudah kena limit (500 jam/bulan)
- Buka Railway dashboard → Usage

---

## Struktur Folder Project

```
nada-studio/
├── backend/
│   ├── main.py          ← Flask API utama
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── railway.toml
│   └── .env.example
├── frontend/
│   ├── pages/
│   │   ├── _app.tsx
│   │   └── index.tsx    ← Halaman utama
│   ├── src/
│   │   ├── lib/api.ts   ← API client
│   │   └── styles/globals.css
│   ├── package.json
│   ├── next.config.js
│   ├── tsconfig.json
│   ├── vercel.json
│   └── .env.example
└── docs/
    └── DEPLOY.md        ← File ini
```

---

## Estimasi Biaya

| Service | Plan | Biaya |
|---------|------|-------|
| Railway | Hobby (free) | $0/bulan, 500 jam |
| Vercel | Free | $0/bulan |
| Domain | Optional | ~$10/tahun |
| **Total** | | **$0 — Gratis!** |

> Kalau traffic tinggi (>100 users/hari), pertimbangkan Railway Starter $5/bulan.

---

## Catatan Keamanan

1. **JANGAN** commit `.env` ke GitHub
2. **Cookie Roblox** disimpan di browser user, tidak di server
3. **HTTPS** otomatis di Railway + Vercel
4. Tambahkan rate limiting kalau app publik:
   ```python
   # Di main.py, tambah flask-limiter
   from flask_limiter import Limiter
   limiter = Limiter(app, default_limits=["10 per minute"])
   ```
