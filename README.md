# 7LM Discord Activity

Watch party Activity منفصل عن موقع `7lmmovie.vercel.app` — ما يعدّل ريبو الأفلام.

## ماذا يفعل

1. شاشة تعريف + لودينق (Discord Embedded App SDK auth)
2. هوم: ترند/بحث من API الأفلام الحالي عبر BFF
3. مسرح: تشغيل متزامن (Host → الجميع) عبر WebSocket `instanceId`

## هيكل

```
client/   Vite + React + @discord/embedded-app-sdk
server/   Express: /api/discord/token + /api/* proxy + /ws/watch
```

## تشغيل محلي

```bash
cd 7lm-discord-activity
npm install
npm install --prefix client
npm install --prefix server
```

`server/.env`:

```
PORT=8787
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
MOVIES_API_BASE=https://emnex-movies-backend.onrender.com
```

`client/.env`:

```
VITE_DISCORD_CLIENT_ID=...
```

```bash
npm run dev
```

- Client: http://localhost:5173  
- Server: http://localhost:8787  

للاختبار داخل Discord تحتاج tunnel (مثل cloudflared) يشير لسيرفرك، ثم URL Mappings في Developer Portal.

## Legal links (Discord app verification)

ضع هالروابط في Discord Developer Portal → App → **Terms of Service** / **Privacy Policy**:

- Terms of Service: `https://7lmmovie.vercel.app/terms.html`
- Privacy Policy: `https://7lmmovie.vercel.app/privacy.html`

نفس الملفات موجودة أيضاً في `client/public/` داخل هذا الريبو بعد النشر.

## Discord Developer Portal

1. Application → Enable **Activity**
2. **Activity URL** = جذر استضافة هذا المشروع (بعد النشر)
3. URL Mappings مثال (كل شيء على سيرفر الاكتيفتي):

| Prefix | Target |
|--------|--------|
| `/` | `your-activity-host.example.com` |
| `/api` | `your-activity-host.example.com/api` |
| `/ws` | `your-activity-host.example.com` |

السيرفر يمرّر `/api/*` (ما عدا discord/health) إلى `MOVIES_API_BASE`.

4. OAuth2 scopes المستخدمة: `identify`, `applications.commands`, `rpc.activities.write`
5. **Art Assets** (Activities → Art Assets) — ارفع من مجلد `art-upload/`:

| Portal field | File |
|--------------|------|
| App Icon (General Information) | `icon-1024.jpg` |
| Cover Art | `cover-1024x576.jpg` |
| Background (Grid overlay) | `background-1024x576.jpg` |
| Rich Presence asset `pip` (اختياري) | `pip-1024.jpg` |

الصورة المصغّرة عند تصغير الأكتيفتي (PiP): التطبيق يستمع لـ `ACTIVITY_LAYOUT_MODE_UPDATE` ويعرض كرت بوستر مضغوط، والـ Cover/Background يظهروون في رفّ الأنشطة والـ Grid.

## نشر مقترح

- ابنِ العميل: `npm run build --prefix client`
- شغّل السيرفر على Render/Fly وهو يخدم `client/dist` + API + WS
- **لا** تربط Activity بـ `7lmmovie.vercel.app`

## ملاحظة

فتح `/` في متصفح عادي يعرض التعريف ورسالة «افتح من داخل Discord» — الـ SDK يحتاج iframe ديسكورد.
