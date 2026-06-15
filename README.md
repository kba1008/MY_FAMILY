# LOVE MY FAMILY - Chat PWA

WhatsApp-style chat room dengan storan **Google Sheets + Google Drive**.

## Fail
- `Code.gs` – Backend (Google Apps Script)
- `index.html` – UI gaya WhatsApp
- `app.js` – Logik frontend (polling, upload, login persist)
- `sw.js` – Service Worker (PWA offline cache)
- `manifest.json` – Manifest PWA

## Konfigurasi Sedia Ada
- **Sheet ID:** `1ZVuobkfCX2AYM6aN6oPRFO8-gd95dQevYs7ngLkZsZY`
- **Drive Folder ID:** `1XHJqxu6G-5QzBguVutpKR8QU--w8uBSn`
- **Admin Password (padam semua chat):** `101010`

## Langkah Deploy

### 1. Deploy Backend (Google Apps Script)
1. Buka <https://script.google.com> → **New Project**
2. Padam fail default, tampal kandungan `Code.gs`, **Save**
3. Klik **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Salin URL Web App (`https://script.google.com/macros/s/XXXX/exec`)
5. Pastikan akaun anda ada akses pada Sheet & Folder yang dinyatakan
6. Jalankan `ensureSheets` sekali untuk auto-buat sheet `Messages` & `Users`

### 2. Konfigur Frontend
Buka `app.js`, edit baris ini:
```js
const API_URL = 'https://script.google.com/macros/s/.../exec';
```

### 3. Hosting Statik
Upload `index.html`, `app.js`, `sw.js`, `manifest.json` ke mana-mana hosting statik:
- GitHub Pages
- Netlify / Vercel
- Cloudflare Pages
- Firebase Hosting

> Penting: PWA & Service Worker hanya berfungsi pada **HTTPS** (atau `localhost`).

## Ciri-ciri
- ✅ Sembang real-time (poll 2.5 saat)
- ✅ Semua mesej & pengguna disimpan dalam Google Sheet
- ✅ Apa-apa fail (gambar, video, audio, PDF, dokumen, zip) dimuat naik ke Google Drive folder
- ✅ URL automatik jadi link yang boleh diklik
- ✅ Auto-login (tak keluar walaupun refresh) — keluar hanya bila tekan 🚪
- ✅ Master Admin (password `101010`) boleh padam semua chat
- ✅ PWA – boleh "Install" sebagai apl di telefon
- ✅ Penapis perkataan kesat
- ✅ Avatar emoji + emoji picker
