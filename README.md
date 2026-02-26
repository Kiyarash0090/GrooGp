<div align="center">

# 🚀 GrooGp

### ✨ The Ultimate Real-time Messaging Experience

<img src="https://img.shields.io/badge/Made%20with-Precision-FF6B6B?style=flat-square" alt="Made with Precision">
<img src="https://img.shields.io/badge/Status-Active%20Development-00D084?style=flat-square" alt="Status">

---

## 📊 Status & Community

<img src="https://img.shields.io/github/license/Kiyarash0090/GrooGp?style=for-the-badge&color=blue" alt="License">
<img src="https://img.shields.io/github/stars/Kiyarash0090/GrooGp?style=for-the-badge&color=gold" alt="Stars">
<a href="https://t.me/Grove_Street_channel"><img src="https://img.shields.io/badge/Join%20Community-Telegram-26A6E1?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"></a>

## � Project Layout

The repository has been reorganized into clear directories for maintainability:

- `server/` – all backend code and SQLite databases (server.js, database.js, etc.).
- `public/` – client‑side assets served by Express (HTML, CSS, JS, images).
- `images/` – screenshots and media for the README (also copied under `public/`).
- `uploads/` – user uploads created at runtime by the server.

---

## �🛠️ Built With

<img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="NodeJS">
<img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="ExpressJS">
<img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite">
<img src="https://img.shields.io/badge/WebSocket-white?style=for-the-badge&logo=socketdotio&logoColor=black" alt="WS">
<img src="https://img.shields.io/badge/Vanilla%20CSS-FF6B9D?style=for-the-badge&logo=css3&logoColor=white" alt="CSS">

---

## 🎨 Live Preview

<table>
  <tr>
    <td align="center">
      <img src="images/Screenshot 2026-02-25 123508.png" alt="GrooGp Interface 1" width="350"/>
      <br/><sub><b>Interface Preview 1</b></sub>
    </td>
    <td align="center">
      <img src="images/Screenshot 2026-02-25 123714.png" alt="GrooGp Interface 2" width="350"/>
      <br/><sub><b>Interface Preview 2</b></sub>
    </td>
  </tr>
</table>

---

## 💡 Key Highlights

> 🌟 **High Performance** • 🔒 **Secure by Design** • 🎨 **Modern UI** • ⚡ **Ultra-Fast**

*A professional, Telegram-inspired messaging solution built with pure engineering excellence.*

---

<p>
  <a href="#-english">🇺🇸 English</a> &nbsp; • &nbsp; <a href="#-فارسی">🇮🇷 فارسی</a>
</p>

---

</div>

<div id="english">

## 🇺🇸 English

### 📑 Quick Navigation
| | | | |
|:---:|:---:|:---:|:---:|
| [✨ Features](#-core-features) | [🛠️ Architecture](#-architecture) | [🚀 Setup](#-quick-start) | [📞 Support](#-contact) |

---

### ✨ Core Features

| Icon | Feature | Details |
| :---: | :--- | :--- |
| ⚡ | **Real-time Engine** | Ultra-low latency communication powered by optimized WebSockets. |
| 🔐 | **Advanced Auth** | JWT-based state management with high-security Bcrypt hashing. |
| 🖼️ | **Media Suite** | Full-screen immersive viewer with smart lazy loading and secure downloads. |
| 💬 | **Social Layers** | Message reactions, threaded replies, and interactive profiles. |
| 🎨 | **Glassmorphism UI** | A stunning, responsive design built with 100% Vanilla CSS. |
| 🛡️ | **Moderation** | Enterprise-grade global and local banning systems for admins. |

---

### 🛠️ Architecture

<details open>
<summary><b>System Design Overview</b></summary>

**GrooGp** follows a modular monolithic architecture for maximum maintainability:

| Component | Purpose |
| :--- | :--- |
| **`server/server.js`** | High-performance Express API & WS Router |
| **`server/database.js`** | Optimized SQLite schemas for ultra-fast I/O |
| **`public/app.js`** | Core client engine for real-time state sync |
| **`server/encrypted-assets.js`** | Intelligent internal asset management |

</details>

---

### 🚀 Quick Start

<div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">

```bash
# 1️⃣ Clone Repository
git clone https://github.com/Kiyarash0090/GrooGp.git
cd GrooGp

# 2️⃣ Install Dependencies
npm install

# 3️⃣ Start Development Server
npm start
```

</div>

> Server runs at `http://localhost:3000` by default

### 🔐 Environment Variables

To enable Google sign‑in (used by the login modal) you **must** provide a valid OAuth **web client ID** in an environment variable named `GOOGLE_CLIENT_ID`. In development you can put this value in a `.env` file (see example below). On hosting platforms such as Railway set the variable in the project dashboard – otherwise the client will receive an empty ID and the Google button will fail with the `Parameter client_id is not set correctly` error.

The server and client both disable all `console.log` output by default. To turn debugging back on set `DEBUG_LOG=true` in the environment (server) or `window.DEBUG = true` in the browser console while developing.

```dotenv
# .env example
GOOGLE_CLIENT_ID=your-google-web-client-id.apps.googleusercontent.com
ADMIN_EMAIL=admin@example.com
JWT_SECRET=...
# optional debug flag (default false)
DEBUG_LOG=true
```

```html
<!-- client-side: in index.html before other scripts -->
<script>
  window.DEBUG = false; /* change to true for development */
</script>
```

```dotenv
```

When the server starts it will log a warning if the variable is missing.

---

### 📞 Contact & Community

<div align="center">

**Join our vibrant community!**

[<img src="https://img.shields.io/badge/Telegram-Join%20Now-26A6E1?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"/>](https://t.me/Grove_Street_channel)

</div>

</div>

---

<div id="فارسی" dir="rtl">

## 🇮🇷 فارسی

### 📑 دسترسی سریع
| | | | |
|:---:|:---:|:---:|:---:|
| [✨ قابلیت‌ها](#-قابلیت‌ها-1) | [🛠️ معماری](#-معماری-پروژه) | [🚀 نصب](#-نصب-و-اجرا) | [📞 پشتیبانی](#-ارتباط-با-ما) |

---

### ✨ قابلیت‌های کلیدی

| نماد | قابلیت | توضیحات |
| :---: | :--- | :--- |
| ⚡ | **موتور در لحظه** | ارتباط فوق سریع با تأخیر نزدیک به صفر توسط وب‌ساکت‌های بهینه شده. |
| 🔐 | **امنیت پیشرفته** | مدیریت نشست‌ها با JWT و هش‌گذاری قدرتمند گذرواژه‌ها با Bcrypt. |
| 🖼️ | **مدیریت رسانه** | نمایشگر غوطه‌ور با بارگذاری هوشمند (Lazy Loading) و دانلود امن. |
| 💬 | **لایه‌های اجتماعی** | واکنش به پیام‌ها (Reactions)، ریپلای و پروفایل‌های تعاملی. |
| 🎨 | **طراحی مدرن** | رابط کاربری خیره‌کننده با تکنیک شیشه‌ای (Glassmorphism) و Vanilla CSS. |
| 🛡️ | **مدیریت ادمین** | سیستم‌های پیشرفته اخراج و مسدودسازی سراسری برای مدیران. |

---

### 🛠️ معماری پروژه

<details open>
<summary><b>نمای کلی طراحی سیستم</b></summary>

**GrooGp** بر پایه معماری ماژولار برای پایداری حداکثری بنا شده است:

| بخش | توضیح |
| :--- | :--- |
| **`server/server.js`** | هسته اصلی API و روتر وب‌ساکت |
| **`server/database.js`** | پایگاه داده SQLite با کوئری‌های بهینه | 
| **`public/app.js`** | موتور سمت کلاینت برای همگام‌سازی در لحظه |
| **`server/encrypted-assets.js`** | مدیریت هوشمند منابع درونی |

</details>

---

### 🚀 نصب و اجرا

<div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">

```bash
# ۱️⃣ دریافت کد منبع
git clone https://github.com/Kiyarash0090/GrooGp.git
cd GrooGp

# ۲️⃣ نصب وابستگی‌ها
npm install

# ۳️⃣ اجرای محیط توسعه
npm start
```

</div>

> سرور در آدرس `http://localhost:3000` اجرا می‌شود

### 🔐 متغیرهای محیطی

برای فعال کردن ورود گوگل (استفاده‌شده در مودال ورود) باید یک **Client ID** وب OAuth معتبر در متغیر محیطی `GOOGLE_CLIENT_ID` تنظیم شود. در لوکال می‌توانید این مقدار را در `.env` بگذارید (مثال پایین). در پلتفرم‌هایی مثل Railway این متغیر را از داشبورد پروژه اضافه کنید؛ در غیر این صورت مشتری رشته خالی دریافت می‌کند و دکمه‌ی گوگل با خطا کار می‌کند.

```dotenv
# نمونه .env
GOOGLE_CLIENT_ID=your-google-web-client-id.apps.googleusercontent.com
ADMIN_EMAIL=admin@example.com
JWT_SECRET=...
```

سرور هنگام شروع نیز اگر این متغیر نباشد هشداری در لاگ می‌دهد.

---

### 📞 ارتباط با ما

<div align="center">

**به جامعه ما بپیوندید!**

[<img src="https://img.shields.io/badge/تلگرام-بپیوندید%20اکنون-26A6E1?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"/>](https://t.me/Grove_Street_channel)

</div>

</div>

---

<div align="center">

## 🎉 Built with Excellence

<img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License">
<img src="https://img.shields.io/badge/Maintained%3F-Yes-success?style=for-the-badge" alt="Maintained">

**Crafted with precision for a premium real-time messaging experience.**

---

### 🌟 Show Your Support

If you find GrooGp valuable, please consider:
- ⭐ Giving us a star on GitHub
- 📣 Sharing with your network  
- 🐛 Reporting issues and suggesting features
- 🤝 Contributing to the project

---

<b>© 2026 GrooGp Project • Made with ❤️</b>

</div>
