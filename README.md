# 7LM Discord Activity

Watch party Activity منفصل عن موقع `7lmmovie.vercel.app` — ما يعدّل ريبو الأفلام.

## ماذا يفعل

1. شاشة تعريف + لودينق (Discord Embedded App SDK auth)
2. هوم: ترند/بحث/فلاتر + صفحة تفاصيل (موسم/حلقة، Sub/Dub، جودة)
3. مسرح: تشغيل متزامن (Host → الجميع) عبر WebSocket `instanceId`
4. طابور اقتراحات، نقل هوست/تصويت، إعادة اتصال + مزامنة، غرف مستمرة (Redis أو ملف)

## هيكل

```
client/   Vite + React + @discord/embedded-app-sdk
server/   Express: /api/* BFF + /ws/watch + telemetry + bot interactions
data/     room persistence fallback (rooms.json) when Redis unavailable
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

# Optional — persistent rooms
REDIS_URL=redis://...

# Optional — Discord bot notifications + slash commands
DISCORD_BOT_TOKEN=...
DISCORD_PUBLIC_KEY=...
DISCORD_NOTIFY_CHANNEL_ID=...

# Optional — bridge to 7lmmovie account favorites/history
ACCOUNT_API_BASE=

# Optional file path for room persistence when Redis is off
# ROOM_PERSIST_PATH=./data/rooms.json
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

## Discord bot (slash commands)

الأوامر المسجّلة:

| Command | Purpose |
|---------|---------|
| `/7lm-help` | شرح فتح الـ Activity |
| `/7lm-watch` | خطوات بدء جلسة مشاهدة |
| `/7lm-status` | حالة السيرفر / room store / notify |

1. فعّل Bot في Developer Portal وأضف Bot Token كـ `DISCORD_BOT_TOKEN`
2. انسخ **Public Key** إلى `DISCORD_PUBLIC_KEY`
3. Interactions Endpoint URL: `https://<your-host>/api/discord/interactions`
4. سجّل الأوامر:

```bash
npm run bot:register --prefix server
```

5. (اختياري) `DISCORD_NOTIFY_CHANNEL_ID` لقناة نصية — يُنشر فيها تنبيه عند تغيّر العنوان/الحلقة من غرفة الـ Activity.

بدون التوكن: الـ Activity يعمل كاملًا؛ الإشعارات والأوامر تبقى جاهزة (hook + endpoint).

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
| `/emnex` | `api.emnexmovies.cc` |
| `/emnex-anime` | `api.emnexanime.site` |
| `/stream-cdn` | `bcdnw.hakunaymatata.com` |
| `/nexabloom` | `fetch.nexabloom.top` |
| `/hakuna/{subdomain}` | `{subdomain}.hakunaymatata.com` |
| `/nexa/{subdomain}` | `{subdomain}.nexabloom.top` |

السيرفر يمرّر `/api/*` (ما عدا discord/health/telemetry/translate/bridge) إلى `MOVIES_API_BASE`.

4. OAuth2 scopes المستخدمة: `identify`, `applications.commands`, `rpc.activities.write`
5. **Art Assets** (Activities → Art Assets) — ارفع من مجلد `art-upload/`

## نشر مقترح

- ابنِ العميل: `npm run build --prefix client`
- شغّل السيرفر على Render/Fly وهو يخدم `client/dist` + API + WS
- **لا** تربط Activity بـ `7lmmovie.vercel.app`
- على Render يُفضّل `REDIS_URL` لغرف persistent عبر إعادة التشغيل

## ملاحظة

فتح `/` في متصفح عادي يعرض التعريف ورسالة «افتح من داخل Discord» — الـ SDK يحتاج iframe ديسكورد.
