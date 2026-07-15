# 🔧 MoneyQ Social Engine — Account Setup Guide

## Credentials

| Field | Value |
|-------|-------|
| **Email** | moneyq.id@gmail.com |
| **Password** | `m6IvuGc2V2cvMPxSE%wL` |
| **Backup** | Simpan password ini di password manager! |

---

## 1. Meta (Instagram + Threads)

### Akun yang dibutuhkan:
- Facebook Page untuk moneyQ
- Instagram Business Account
- Threads otomatis tersedia dari Instagram

### Langkah:

#### A. Buat Facebook Page
1. Buka: https://www.facebook.com/pages/create
2. Login dengan `moneyq.id@gmail.com` (buat akun FB jika belum)
3. Pilih **Business or Brand**
4. Nama: **moneyQ**
5. Kategori: **Finance** / **Financial Service**
6. Selesai

#### B. Buat Instagram Business Account
1. Buka Instagram app atau https://www.instagram.com
2. Sign up dengan `moneyq.id@gmail.com`
3. Username: **@moneyq.id**
4. Convert ke Business Account:
   - Settings → Account → Switch to Professional Account
   - Pilih **Business**
   - Hubungkan ke Facebook Page moneyQ

#### C. Setup Threads
1. Download Threads app (by Instagram)
2. Login dengan akun Instagram @moneyq.id
3. Threads otomatis tersedia

#### D. Dapatkan API Credentials
1. Buka: https://developers.facebook.com
2. Create App → pilih **Business** type
3. Tambahkan produk:
   - **Instagram Graph API**
   - **Threads API** (threads_basic, threads_content_publish, threads_manage_insights)
4. Generate **Access Token** dengan permission:
   - `instagram_basic`
   - `instagram_content_publish`
   - `threads_basic`
   - `threads_content_publish`
   - `threads_manage_insights`
5. Dapatkan **Instagram Account ID**:
   - `GET /me/accounts` → ambil page token
   - `GET /{page-id}?fields=instagram_business_account` → ambil IG account ID

#### E. Update .env
```env
INSTAGRAM_ACCESS_TOKEN=your_token_here
INSTAGRAM_ACCOUNT_ID=your_ig_account_id_here
```

---

## 2. TikTok Developer

### Langkah:
1. Buka: https://developers.tiktok.com
2. Sign up dengan `moneyq.id@gmail.com`
3. Verify email
4. Create App:
   - App Name: **MoneyQ Social Engine**
   - App Type: **Automation**
5. Request API access:
   - **Content Posting API** (video.publish)
   - Scopes: `video.upload`, `video.publish`
6. OAuth: Setup redirect URI (bisa pakai localhost untuk testing)
7. Generate **Access Token** via OAuth flow

### Update .env
```env
TIKTOK_ACCESS_TOKEN=your_token_here
```

---

## 3. Google (YouTube)

### Langkah:
1. Buka: https://console.cloud.google.com
2. Login dengan `moneyq.id@gmail.com`
3. Create Project: **MoneyQ Social Engine**
4. Enable API:
   - **YouTube Data API v3**
5. Create OAuth 2.0 credentials:
   - Application type: **Web application**
   - Name: MoneyQ YouTube Publisher
   - Authorized redirect URIs: `http://localhost:3000/oauth/callback`
6. Download **client_id** dan **client_secret**
7. Get **refresh_token** via OAuth flow:
   - Buka: `https://accounts.google.com/o/oauth2/v2/auth?client_id={CLIENT_ID}&redirect_uri=http://localhost:3000/oauth/callback&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload&access_type=offline`
   - Authorize → ambil code dari redirect URL
   - Exchange code untuk tokens

### Update .env
```env
YOUTUBE_CLIENT_ID=your_client_id
YOUTUBE_CLIENT_SECRET=your_client_secret
YOUTUBE_REFRESH_TOKEN=your_refresh_token
```

---

## 4. Supabase (Database)

### Langkah:
1. Buka: https://supabase.com
2. Sign up dengan `moneyq.id@gmail.com`
3. Create Project:
   - Name: **moneyq-social-engine**
   - Database Password: `m6IvuGc2V2cvMPxSE%wL`
   - Region: **Singapore** (closest to Indonesia)
4. Setup database:
   - Buka SQL Editor
   - Copy-paste isi `moneyq-content-db/schema.sql`
   - Jalankan
   - Copy-paste semua file di `moneyq-content-db/seeds/` satu per satu
5. Get credentials:
   - Settings → API
   - **Project URL** dan **anon/public key**

### Update .env
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
```

---

## 5. AI Providers (Copy Writer)

### Gemini (Primary - GRATIS)
1. Buka: https://aistudio.google.com/app/apikey
2. Login dengan `moneyq.id@gmail.com`
3. Create API Key

### Mistral (Backup)
1. Buka: https://console.mistral.ai
2. Sign up dengan `moneyq.id@gmail.com`
3. Create API Key

### DeepSeek (Backup)
1. Buka: https://platform.deepseek.com
2. Sign up dengan `moneyq.id@gmail.com`
3. Create API Key

### Update .env
```env
GEMINI_API_KEY=your_key
MISTRAL_API_KEY=your_key
DEEPSEEK_API_KEY=your_key
```

---

## 6. Pexels (Stock Video - GRATIS)

1. Buka: https://www.pexels.com/api
2. Sign up dengan `moneyq.id@gmail.com`
3. Get API Key

### Update .env
```env
PEXELS_API_KEY=your_key
```

---

## 7. Stability AI (Image Gen - Opsional)

1. Buka: https://platform.stability.ai
2. Sign up dengan `moneyq.id@gmail.com`
3. Get API Key

### Update .env
```env
STABILITY_API_KEY=your_key
```

---

## Checklist

| # | Platform | Status | Notes |
|---|----------|--------|-------|
| 1 | Facebook Page | ⬜ | |
| 2 | Instagram Business | ⬜ | Hubungkan ke FB Page |
| 3 | Threads | ⬜ | Otomatis dari IG |
| 4 | Meta Developer App | ⬜ | IG Graph API + Threads API |
| 5 | TikTok Developer | ⬜ | Content Posting API |
| 6 | Google Cloud Project | ⬜ | YouTube Data API v3 |
| 7 | YouTube Channel | ⬜ | Buat channel jika belum ada |
| 8 | Supabase | ⬜ | Database + seed data |
| 9 | Gemini API | ⬜ | Copy writer primary |
| 10 | Mistral API | ⬜ | Copy writer backup |
| 11 | DeepSeek API | ⬜ | Copy writer backup |
| 12 | Pexels API | ⬜ | Stock video footage |
| 13 | Stability AI | ⬜ | Image gen (opsional) |

---

## Setelah Semua Terdaftar

Update file `.env` di `/Users/mac-095096/moneyq-social-engine/.env` dengan semua credentials, lalu jalankan:

```bash
cd /Users/mac-095096/moneyq-social-engine
npm run health    # Check semua credentials
npm run generate  # Generate konten pertama!
```
