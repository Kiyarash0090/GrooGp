const WebSocket = require('ws');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
// load environment variables from .env
require('dotenv').config();
const jwt = require('jsonwebtoken');
// security libraries
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const { registerUser, loginUser, loginWithGoogle, setupUserPassword, changeUserPassword, getUserById, updateUserId, updateUsername, searchUserByUsernameOrId, searchAll, updateProfilePicture, updateBio, getUserEmail, getGroupSettings, updateGroupProfile, createGroup, createChannel, getUserGroups, checkMembership, joinGroup, leaveGroup, deleteGroup, isGroupAdmin, addGroupAdmin, removeGroupAdmin, getGroupAdmins, updateGroupInfo, getGroupMembers, getGroupOwnerId, getAllUsers, banGlobal, unbanGlobal, isGlobalBanned, getGlobalBans, banUserFromGroup, unbanUserFromGroup, isUserBannedFromGroup, getGroupBans, closeDatabase, openDatabase } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'please_change_this_secret';

// authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'] || req.query.token;
    if (!authHeader) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    let token = authHeader;
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    }
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = payload;
        // also ensure userId provenance for downstream handlers
        if (req.body) req.body.userId = payload.id;
        if (req.query) req.query.userId = payload.id;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}
// message-database functions are loaded dynamically so we can reload them after replacing the file
let saveMessage, getRecentMessages, savePrivateMessage, getPrivateMessages, getUserPrivateChats, markMessagesAsRead, updateLastReadMessage, getLastReadMessageId, getUnreadGroupMessagesCount, isGroupMessageRead, saveGroupMessage, getGroupMessages, getGroupMessagesBeforeId, updateCustomGroupLastRead, getCustomGroupLastReadMessageId, getCustomGroupUnreadCount, isCustomGroupMessageRead, updateUsernameInMessages, addReaction, removeReaction, getMessageReactions, getMessagesReactions, closeMessagesDb, openMessagesDb;

function reloadMessagesModule() {
    const mod = require('./messages-database');
    saveMessage = mod.saveMessage;
    getRecentMessages = mod.getRecentMessages;
    savePrivateMessage = mod.savePrivateMessage;
    getPrivateMessages = mod.getPrivateMessages;
    getUserPrivateChats = mod.getUserPrivateChats;
    markMessagesAsRead = mod.markMessagesAsRead;
    updateLastReadMessage = mod.updateLastReadMessage;
    getLastReadMessageId = mod.getLastReadMessageId;
    getUnreadGroupMessagesCount = mod.getUnreadGroupMessagesCount;
    isGroupMessageRead = mod.isGroupMessageRead;
    saveGroupMessage = mod.saveGroupMessage;
    getGroupMessages = mod.getGroupMessages;
    getGroupMessagesBeforeId = mod.getGroupMessagesBeforeId;
    updateCustomGroupLastRead = mod.updateCustomGroupLastRead;
    getCustomGroupLastReadMessageId = mod.getCustomGroupLastReadMessageId;
    getCustomGroupUnreadCount = mod.getCustomGroupUnreadCount;
    isCustomGroupMessageRead = mod.isCustomGroupMessageRead;
    updateUsernameInMessages = mod.updateUsernameInMessages;
    addReaction = mod.addReaction;
    removeReaction = mod.removeReaction;
    getMessageReactions = mod.getMessageReactions;
    getMessagesReactions = mod.getMessagesReactions;
    closeMessagesDb = mod.closeMessagesDb;
    openMessagesDb = mod.openMessagesDb;
}

// load initially
reloadMessagesModule();

// ایجاد پوشه uploads در صورت عدم وجود
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// body parser with generous limit for file upload via POST
app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ limit: '25mb', extended: true }));

// security headers (helmet) with custom CSP
// compute SHA256 of client-init.js contents if inline not desired; we moved inline code to external file
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                'https://accounts.google.com',
                'https://cdn.jsdelivr.net'
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://accounts.google.com',
                'https://fonts.googleapis.com',
                'https://cdn.jsdelivr.net'
            ], // allow google stylesheets and JSDelivr
            imgSrc: [
                "'self'", 
                'data:',
                'https://cdn.jsdelivr.net'
            ],
            connectSrc: ["'self'"],
            fontSrc: [
                "'self'", 
                'https://fonts.gstatic.com',
                'https://cdn.jsdelivr.net'
            ],
            frameSrc: [
                "'self'",
                'https://accounts.google.com'
            ],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"]
        }
    }
}));

// rate limiter for auth endpoints to mitigate brute force
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: 'قرار گرفتن بیش از حد درخواست‌ها، لطفاً بعداً تلاش کنید.' }
});
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);
app.use('/api/google-login', authLimiter);

// simple CORS middleware – origin can be restricted via ALLOWED_ORIGIN env var
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// تنظیم MIME types برای فایل‌های مختلف
// middleware to add security headers globally
app.use((req, res, next) => {
    // relax COOP to avoid blocking postMessage from external popups
    // using 'same-origin-allow-popups' allows Google login popup to work
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
});

// فقط فایل‌های فرانت‌اند را سرو کن (نه فایل‌های سرور و دیتابیس)
const allowedFiles = [
    'index.html',
    'style.css',
    'app.js',
    'auth.js',
    'emojis.js',
    'encrypted-assets.js',
    'client-init.js',
    'media-handler.js',
    'lazy-media-observer.js',
    'moderation.js',
    'panels.js',
    // dynamic configuration endpoint needs to bypass security check
    'config.js'
];

const blockedPatterns = [
    'server.js',
    'database.js',
    'messages-database.js',
    'users.db',
    'messages.db',
    'package.json',
    'package-lock.json',
    '.env',
    '.git',
    'node_modules',
    '.vscode'
];

app.use((req, res, next) => {
    // دیکود کردن مسیر در ابتدا برای جلوگیری از مشکلات انکودینگ
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(req.path.substring(1));
    } catch (e) {
        decodedPath = req.path.substring(1);
    }

    // اگر مسیر خالی باشد (صفحه اصلی) اجازه عبور بده
    if (decodedPath === '' || decodedPath === '/') {
        return next();
    }

    // اگر مسیر مربوط به API باشد اجازه عبور بده
    if (decodedPath.startsWith('api/')) {
        return next();
    }

    // استخراج نام فایل و حذف پارامترهای پرس‌وجو
    const fileName = decodedPath.split('/').pop().split('?')[0];

    // بررسی الگوهای مسدود شده (فایل‌های حساس سیستمی)
    for (const pattern of blockedPatterns) {
        if (decodedPath === pattern || decodedPath.startsWith(pattern + '/') || fileName === pattern) {
            console.log(`[Security] Blocked access to pattern "${pattern}":`, decodedPath);
            return res.status(403).send('Access Denied');
        }
    }

    // بررسی فایل‌های مجاز یا پسوندهای امن
    if (!allowedFiles.includes(fileName)) {
        const lastDotIndex = fileName.lastIndexOf('.');
        if (lastDotIndex === -1) {
            console.log('[Security] Blocked access (no extension):', decodedPath);
            return res.status(403).send('Access Denied');
        }

        const ext = fileName.substring(lastDotIndex).toLowerCase();
        const safeExtensions = ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.json'];

        if (!safeExtensions.includes(ext)) {
            console.log('[Security] Blocked access (unauthorized type):', decodedPath);
            return res.status(403).send('Access Denied');
        }
    }

    next();
});


// serve frontend assets from the public directory (moved out of root)
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, {
    setHeaders: (res, path) => {
        // add security headers for cross-origin interactions (Google login popup)
        // relaxed COOP to avoid postMessage warning
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
        res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');

        if (path.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        } else if (path.endsWith('.json')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
    }
}));

// expose runtime config to client (reads values from process.env)
app.get('/config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    const cfg = {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
        ADMIN_EMAIL: process.env.ADMIN_EMAIL || ''
    };
    // log on server side when client asks for config (useful on platforms like Railway)
    if (!cfg.GOOGLE_CLIENT_ID) {
        console.warn('[Config] GOOGLE_CLIENT_ID not set; front-end will receive empty string');
    }
    res.send(`window.APP_CONFIG = ${JSON.stringify(cfg)};`);
});

// جلوگیری از خطای 404 برای favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

// سرو کردن صفحه اصلی
app.get('/', (req, res) => {
    // index.html now lives in the public folder
    res.sendFile(path.join(publicDir, 'index.html'));
});

// log a warning early if the Google client ID isn't configured (helps catch deploy problems)
if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('[Startup] GOOGLE_CLIENT_ID environment variable is missing. Google login will not work.');
}

// Debug logger: enable by setting environment variable DEBUG_LOG=true
const DEBUG_LOG = process.env.DEBUG_LOG === 'true';
// silently drop all console.log output when debugging is disabled
if (!DEBUG_LOG) {
    console.log = () => {};
}
function debugLog(...args) { if (DEBUG_LOG) console.log(...args); }

const clients = new Map(); // WebSocket connections
const allUsers = new Map(); // همه کاربران (آنلاین و آفلاین)
// مجموعه کاربران محروم‌شده از گروه عمومی (برای چک سریع)
const globalBans = new Set();

// simple per‑socket message rate limiter (messages per second)
const wsRateMap = new Map();
function checkWsRate(ws) {
    const now = Date.now();
    let entry = wsRateMap.get(ws);
    if (!entry || now - entry.lastReset > 1000) {
        entry = { count: 0, lastReset: now };
        wsRateMap.set(ws, entry);
    }
    entry.count++;
    if (entry.count > 20) {
        ws.send(JSON.stringify({ type: 'error', message: 'ارسال پیام بیش از حد سریع است' }));
        return false;
    }
    return true;
} 

// هنگام راه‌اندازی سرور، همه کاربران ثبت‌شده را به‌صورت آفلاین در این نگاشت قرار بدهیم
// تا گروه عمومی همیشه تعداد اعضای واقعی را نمایش دهد حتی وقتی کاربری آفلاین است
getAllUsers().then(async users => {
    users.forEach(u => {
        allUsers.set(u.id, {
            username: u.username,
            userId: u.user_id,
            online: false,
            profilePicture: u.profile_picture || null
        });
    });
    // console.log(`Loaded ${allUsers.size} users into allUsers map`);

    // load global bans from database
    try {
        const bans = await getGlobalBans();
        bans.forEach(uid => globalBans.add(uid));
        // console.log(`Loaded ${globalBans.size} global bans`);
        // also remove banned users from allUsers listing so they don't appear
        bans.forEach(uid => {
            for (const [id, u] of allUsers.entries()) {
                if (u.userId === uid) {
                    allUsers.delete(id);
                }
            }
        });
    } catch (e) {
        console.error('Error loading global bans:', e);
    }

    // اگر حتی هنوز کسی متصل نشده، بعد از درون‌ریزی لیست را پخش کن
    broadcastUsers();
}).catch(err => {
    console.error('Error loading users for allUsers map:', err);
});

// API برای ثبت‌نام
app.post('/api/register', async (req, res) => {
    try {
        const { username, userid, password } = req.body;

        if (!username || !userid || !password) {
            return res.status(400).json({ error: 'نام کاربری، آیدی و رمز عبور الزامی است' });
        }

        // اعتبارسنجی آیدی
        const useridRegex = /^[a-zA-Z0-9_]+$/;
        if (!useridRegex.test(userid)) {
            return res.status(400).json({ error: 'آیدی فقط می‌تواند شامل حروف انگلیسی، اعداد و _ باشد' });
        }

        if (password.length < 4) {
            return res.status(400).json({ error: 'رمز عبور باید حداقل 4 کاراکتر باشد' });
        }

        const result = await registerUser(username, password, null, null, userid);
        // کاربر جدید را نیز به نگاشت allUsers اضافه کن تا در گروه عمومی باشد
        allUsers.set(result.id, {
            username: result.username,
            userId: result.user_id,
            online: false,
            profilePicture: result.profile_picture || null
        });
        broadcastUsers();

        res.json({ success: true, user: result });
    } catch (error) {
        res.status(400).json({ success: false, error: error.error || 'خطا در ثبت‌نام' });
    }
});

// API برای ورود
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است' });
        }

        const result = await loginUser(username, password);
        const token = jwt.sign({ id: result.id, username: result.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, user: result, token });
    } catch (error) {
        res.status(401).json({ success: false, error: error.error || 'خطا در ورود' });
    }
});

// API برای ورود با گوگل
app.post('/api/google-login', async (req, res) => {
    try {
        const { googleId, username, email } = req.body;

        if (!googleId || !username) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        const result = await loginWithGoogle(googleId, username, email);

        // بررسی اینکه آیا کاربر رمز عبور داره یا نه
        const needsPassword = result.password === 'google_auth';
        const token = jwt.sign({ id: result.id, username: result.username }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            user: { ...result, needsPassword },
            token
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.error || 'خطا در ورود' });
    }
});

// API برای تنظیم رمز عبور (برای کاربران گوگل)
app.post('/api/setup-password', async (req, res) => {
    try {
        const { userId, password } = req.body; // userId may come from token via middleware

        if (!userId || !password) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        if (password.length < 4) {
            return res.status(400).json({ error: 'رمز عبور باید حداقل 4 کاراکتر باشد' });
        }

        const result = await setupUserPassword(userId, password);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ success: false, error: error.error || 'خطا در تنظیم رمز عبور' });
    }
});

// پس از مسیرهای عمومی، middleware احراز هویت روی سایر APIها اجرا شود
app.use('/api', (req, res, next) => {
    // مسیرهای آزاد
    const publicPaths = ['/register', '/login', '/google-login', '/setup-password'];
    if (publicPaths.includes(req.path)) {
        return next();
    }
    authenticateToken(req, res, next);
});

// API برای تغییر رمز عبور با اعتبارسنجی کامل
app.post('/api/change-password', async (req, res) => {
    console.log('Change password request received:', {
        userId: req.body.userId,
        hasCurrentPassword: !!req.body.currentPassword,
        hasNewPassword: !!req.body.newPassword
    });

    try {
        const { userId, currentPassword, newPassword } = req.body;

        // اعتبارسنجی ورودی‌ها
        if (!userId || !currentPassword || !newPassword) {
            console.log('Missing fields:', { userId: !!userId, currentPassword: !!currentPassword, newPassword: !!newPassword });
            return res.status(400).json({
                success: false,
                error: 'اطلاعات ناقص است'
            });
        }

        if (typeof userId !== 'number' && typeof userId !== 'string') {
            console.log('Invalid userId type:', typeof userId);
            return res.status(400).json({
                success: false,
                error: 'شناسه کاربر نامعتبر است'
            });
        }

        if (newPassword.length < 4) {
            return res.status(400).json({
                success: false,
                error: 'رمز عبور جدید باید حداقل 4 کاراکتر باشد'
            });
        }

        if (newPassword.length > 50) {
            return res.status(400).json({
                success: false,
                error: 'رمز عبور جدید نباید بیشتر از 50 کاراکتر باشد'
            });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({
                success: false,
                error: 'رمز عبور جدید نمی‌تواند با رمز فعلی یکسان باشد'
            });
        }

        // تغییر رمز عبور
        const result = await changeUserPassword(userId, currentPassword, newPassword);

        console.log('Password changed successfully for user:', userId);
        res.json({
            success: true,
            message: result.message || 'رمز عبور با موفقیت تغییر یافت'
        });

    } catch (error) {
        console.error('Error in change-password API:', error);
        res.status(400).json({
            success: false,
            error: error.error || 'خطا در تغییر رمز عبور'
        });
    }
});

// API برای دریافت تاریخچه پیام‌ها
app.get('/api/messages', async (req, res) => {
    try {
        const { before } = req.query;
        const userId = req.user && req.user.id; // provided by authentication middleware
        const limit = 50;

        let query;
        let params;

        if (before) {
            query = `
                SELECT id, user_id, username, message, reply_to, message_type, created_at 
                FROM messages 
                WHERE id < ?
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            params = [parseInt(before), limit];
        } else {
            query = `
                SELECT id, user_id, username, message, reply_to, message_type, created_at 
                FROM messages 
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            params = [limit];
        }

        const { messagesDb } = require('./messages-database');
        messagesDb.all(query, params, async (err, rows) => {
            if (err) {
                res.status(500).json({ success: false, error: 'خطا در دریافت پیام‌ها' });
            } else {
                // Parse reply_to JSON
                const parsedRows = rows.map(row => ({
                    ...row,
                    reply_to: row.reply_to ? JSON.parse(row.reply_to) : null
                }));

                // دریافت ریکشن‌ها برای تمام پیام‌ها
                const messageIds = parsedRows.map(msg => msg.id);
                const reactions = await getMessagesReactions(messageIds, 'group');

                // اگر userId داده شده، وضعیت خوانده شدن را بررسی کن
                if (userId) {
                    const parsedUserId = parseInt(userId);
                    // بهینه سازی: به جای چک تک تک، فقط برای پیام‌های خود کاربر وضعیت خوانایی را چک می‌کنیم
                    // برای پیام‌های عمومی، منطق کمی متفاوت است چون "خواندن" جمعی است
                    const messagesWithReadStatus = await Promise.all(
                        parsedRows.map(async (msg) => {
                            let isRead = 1;
                            if (msg.user_id === parsedUserId) {
                                isRead = (await isGroupMessageRead(msg.id, msg.user_id)) ? 1 : 0;
                            }
                            return {
                                ...msg,
                                is_read: isRead,
                                reactions: reactions[msg.id] || null
                            };
                        })
                    );
                    res.json({ success: true, messages: messagesWithReadStatus.reverse() });
                } else {
                    const messagesWithReactions = parsedRows.map(msg => ({
                        ...msg,
                        reactions: reactions[msg.id] || null
                    }));
                    res.json({ success: true, messages: messagesWithReactions.reverse() });
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.error || 'خطا در دریافت پیام‌ها' });
    }
});

// API برای دریافت پیام‌های جدید گروه (بعد از آخرین پیام خوانده شده)
app.get('/api/new-group-messages/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const query = `
            SELECT m.id, m.user_id, m.username, m.message, m.message_type, m.created_at,
                   COALESCE(ulr.last_read_message_id, 0) as last_read_id
            FROM messages m
            LEFT JOIN user_last_read ulr ON ulr.user_id = ?
            WHERE m.id > COALESCE(ulr.last_read_message_id, 0)
            ORDER BY m.created_at ASC
        `;

        const { messagesDb } = require('./messages-database');
        messagesDb.all(query, [userId], (err, rows) => {
            if (err) {
                res.status(500).json({ success: false, error: 'خطا در دریافت پیام‌های جدید' });
            } else {
                const lastReadId = rows.length > 0 ? rows[0].last_read_id : 0;
                res.json({ success: true, messages: rows, last_read_id: lastReadId });
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.error || 'خطا در دریافت پیام‌ها' });
    }
});

// API برای دریافت تعداد پیام‌های خوانده نشده گروه
app.get('/api/unread-group-messages/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const unreadCount = await getUnreadGroupMessagesCount(parseInt(userId));
        res.json({ success: true, unread_count: unreadCount });
    } catch (error) {
        res.status(500).json({ success: false, error: error.error || 'خطا در دریافت تعداد پیام‌ها' });
    }
});

// API برای دریافت آخرین پیام خوانده شده کاربر
app.get('/api/last-read-message/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const lastReadMessageId = await getLastReadMessageId(parseInt(userId));
        res.json({ success: true, lastReadMessageId: lastReadMessageId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.error || 'خطا در دریافت آخرین پیام خوانده شده' });
    }
});

// API برای علامت‌گذاری پیام‌های گروه به عنوان خوانده شده
app.post('/api/mark-group-messages-read', async (req, res) => {
    try {
        const { userId, messageId } = req.body;

        if (!userId || !messageId) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        await updateLastReadMessage(parseInt(userId), parseInt(messageId));

        // اطلاع‌رسانی به فرستندگان پیام‌ها که پیام‌هایشان خوانده شده
        // پیدا کردن تمام پیام‌هایی که این کاربر خوانده و باید به فرستنده‌هاشان اطلاع داده شود
        const { messagesDb } = require('./messages-database');
        messagesDb.all(
            `SELECT DISTINCT user_id FROM messages WHERE id <= ? AND user_id != ?`,
            [parseInt(messageId), parseInt(userId)],
            (err, senders) => {
                if (!err && senders) {
                    senders.forEach(sender => {
                        // پیدا کردن WebSocket فرستنده
                        for (const [ws, clientData] of clients.entries()) {
                            if (clientData.userId === sender.user_id) {
                                ws.send(JSON.stringify({
                                    type: 'messages_read',
                                    readBy: userId,
                                    chatType: 'group'
                                }));
                            }
                        }
                    });
                }
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Mark group messages read error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در به‌روزرسانی وضعیت پیام‌ها' });
    }
});

// API برای دریافت پیام‌های خصوصی
app.get('/api/private-messages/:userId1/:userId2', async (req, res) => {
    try {
        const { userId1, userId2 } = req.params;
        const { before } = req.query;
        const limit = 50;

        let query;
        let params;

        if (before) {
            query = `
                SELECT id, sender_id, sender_username, receiver_id, receiver_username, message, is_read, reply_to, created_at 
                FROM private_messages 
                WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
                AND id < ?
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            params = [parseInt(userId1), parseInt(userId2), parseInt(userId2), parseInt(userId1), parseInt(before), limit];
        } else {
            query = `
                SELECT id, sender_id, sender_username, receiver_id, receiver_username, message, is_read, reply_to, created_at 
                FROM private_messages 
                WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            params = [parseInt(userId1), parseInt(userId2), parseInt(userId2), parseInt(userId1), limit];
        }

        const { messagesDb } = require('./messages-database');
        messagesDb.all(query, params, async (err, rows) => {
            if (err) {
                res.status(500).json({ success: false, error: 'خطا در دریافت پیام‌ها' });
            } else {
                // Parse reply_to JSON
                const parsedRows = rows.map(row => ({
                    ...row,
                    reply_to: row.reply_to ? JSON.parse(row.reply_to) : null
                }));

                // دریافت ریکشن‌ها برای تمام پیام‌ها
                const messageIds = parsedRows.map(msg => msg.id);
                const reactions = await getMessagesReactions(messageIds, 'private');

                const messagesWithReactions = parsedRows.map(msg => ({
                    ...msg,
                    reactions: reactions[msg.id] || null
                }));

                res.json({ success: true, messages: messagesWithReactions.reverse() });
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.error || 'خطا در دریافت پیام‌ها' });
    }
});

// API برای دریافت لیست چت‌های خصوصی
app.get('/api/private-chats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const chats = await getUserPrivateChats(parseInt(userId));

        // اضافه کردن عکس پروفایل به هر چت
        const chatsWithProfilePictures = await Promise.all(
            chats.map(async (chat) => {
                try {
                    const user = await getUserById(chat.chat_with_id);
                    return {
                        ...chat,
                        profile_picture: user ? user.profile_picture : null
                    };
                } catch (error) {
                    return chat;
                }
            })
        );

        res.json({ success: true, chats: chatsWithProfilePictures });
    } catch (error) {
        res.status(500).json({ success: false, error: error.error || 'خطا در دریافت چت‌ها' });
    }
});

// API برای آپدیت آیدی کاربری
app.post('/api/update-userid', async (req, res) => {
    try {
        const { userId, newUserId } = req.body;

        console.log('Update userid request:', { userId, newUserId });

        if (!userId || !newUserId) {
            console.log('Missing data:', { userId, newUserId });
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        // بررسی فرمت آیدی
        const useridRegex = /^[a-z0-9_]+$/;
        if (!useridRegex.test(newUserId)) {
            console.log('Invalid format:', newUserId);
            return res.status(400).json({ error: 'فرمت آیدی نامعتبر است' });
        }

        if (newUserId.length < 3 || newUserId.length > 20) {
            console.log('Invalid length:', newUserId.length);
            return res.status(400).json({ error: 'آیدی باید بین 3 تا 20 کاراکتر باشد' });
        }

        const result = await updateUserId(userId, newUserId);
        console.log('Update successful:', result);
        res.json({ success: true, user_id: result.user_id });
    } catch (error) {
        console.error('Update userid error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در ذخیره آیدی' });
    }
});

// API برای آپدیت نام کاربری
app.post('/api/update-username', async (req, res) => {
    try {
        const { userId, newUsername } = req.body;

        if (!userId || !newUsername) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        if (newUsername.trim().length === 0) {
            return res.status(400).json({ error: 'نام کاربری نمی‌تواند خالی باشد' });
        }

        const result = await updateUsername(userId, newUsername);

        // به‌روزرسانی نام کاربری در تمام پیام‌ها (با نام قدیم)
        await updateUsernameInMessages(userId, result.oldUsername, newUsername);

        res.json({ success: true, username: result.username });
    } catch (error) {
        console.error('Update username error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در ذخیره نام کاربری' });
    }
});

// API برای آپدیت عکس پروفایل
app.post('/api/update-profile-picture', async (req, res) => {
    try {
        const { userId, profilePicture } = req.body;

        if (!userId || !profilePicture) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        const result = await updateProfilePicture(userId, profilePicture);
        res.json({ success: true, profile_picture: result.profile_picture });
    } catch (error) {
        console.error('Update profile picture error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در ذخیره عکس پروفایل' });
    }
});

// API برای آپدیت بیوگرافی
app.post('/api/update-bio', async (req, res) => {
    try {
        const { userId, bio } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        const result = await updateBio(userId, bio || '');
        res.json({ success: true, bio: result.bio });
    } catch (error) {
        console.error('Update bio error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در ذخیره بیوگرافی' });
    }
});

// API برای آپدیت پروفایل گروه عمومی
app.post('/api/update-group-profile', async (req, res) => {
    try {
        const { userId, profilePicture } = req.body;

        if (!userId || !profilePicture) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        // آپدیت پروفایل گروه در دیتابیس (به‌روز شده برای استفاده از userId)
        const result = await updateGroupProfile('global', userId, profilePicture);

        res.json({ success: true, profile_picture: result.profile_picture });
    } catch (error) {
        console.error('Update group profile error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در تغییر پروفایل گروه' });
    }
});

// API برای آپدیت پروفایل گروه‌های سفارشی
app.post('/api/update-custom-group-profile', async (req, res) => {
    try {
        const { userId, groupId, profilePicture } = req.body;

        if (!userId || !groupId || !profilePicture) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        // آپدیت پروفایل گروه در دیتابیس با بررسی دسترسی از طریق userId
        const result = await updateGroupProfile(groupId, userId, profilePicture);
        res.json({ success: true, profile_picture: result.profile_picture });
    } catch (error) {
        console.error('Update custom group profile error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در تغییر پروفایل گروه' });
    }
});

// API برای دریافت تنظیمات گروه
app.get('/api/group-settings/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId } = req.query; // دریافت userId از query parameter

        const settings = await getGroupSettings(groupId);

        if (!settings) {
            return res.status(404).json({ success: false, error: 'گروه یافت نشد' });
        }

        // اگر userId داده شده و معتبر است، بررسی کن که آیا کاربر ادمین است
        if (userId !== undefined && userId !== null && userId !== '') {
            const uid = parseInt(userId);
            if (!isNaN(uid)) {
                try {
                    const adminCheck = await isGroupAdmin(groupId, uid);
                    settings.is_admin = adminCheck.isAdmin;
                } catch (error) {
                    console.error('Error checking admin status:', error);
                    settings.is_admin = false;
                }
            } else {
                // invalid userId, skip
                settings.is_admin = false;
            }
        }

        res.json({ success: true, settings });
    } catch (error) {
        console.error('Get group settings error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در دریافت تنظیمات گروه' });
    }
});

// API برای دریافت اعضای یک گروه/کانال
app.get('/api/group-members/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;
        const members = await getGroupMembers(groupId);
        // ownerId fetched above may throw if function undefined
        let ownerId = null;
        try {
            ownerId = await getGroupOwnerId(groupId);
        } catch (err) {
            console.error('Owner lookup failed:', err);
        }

        // اضافه کردن وضعیت آنلاین بودن اعضا
        const membersWithOnlineStatus = members.map(member => {
            const isOnline = Array.from(clients.values()).some(
                client => client.userId === member.id
            );
            return {
                ...member,
                online: isOnline
            };
        });

        res.json({ success: true, members: membersWithOnlineStatus, ownerId });
    } catch (error) {
        console.error('Get group members error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در دریافت اعضای گروه' });
    }
});

// API برای اضافه کردن ادمین جدید به گروه/کانال
app.post('/api/add-group-admin', async (req, res) => {
    try {
        const { groupId, userId, targetUserId } = req.body;
        console.log('add-group-admin request', { groupId, userId, targetUserId });
        if (!groupId || !userId || !targetUserId) {
            return res.status(400).json({ success: false, error: 'اطلاعات ناقص است' });
        }
        const adminCheck = await isGroupAdmin(groupId, userId);
        console.log('adminCheck result', adminCheck);
        if (!adminCheck.isAdmin) {
            return res.status(403).json({ success: false, error: 'فقط ادمین می‌تواند مدیر اضافه کند' });
        }
        // کاربر هدف باید عضو گروه باشد (به‌جز گروه عمومی که هر کاربری مجاز است)
        if (groupId !== 'global') {
            const membership = await checkMembership(groupId, targetUserId);
            if (!membership.isMember) {
                return res.status(400).json({ success: false, error: 'کاربر مورد نظر عضو گروه نیست' });
            }
        }
        // در صورت گروه عمومی ممکن است رکورد عضویت وجود نداشته باشد؛
        // پس بعد از افزودن به ادمین، او را هم به جدول اعضا اضافه می‌کنیم تا
        // فراخوانی‌هایی مثل getGroupMembers او را نشان دهند.  قبل از انجام
        // این کار مطمئن شویم کاربر محروم نشده باشد.
        if (groupId === 'global' && globalBans.has(parseInt(targetUserId))) {
            return res.status(400).json({ success: false, error: 'کاربر از گروه عمومی محروم است' });
        }
        await addGroupAdmin(groupId, targetUserId);
        if (groupId === 'global') {
            try {
                await joinGroup(groupId, targetUserId);
            } catch (e) {
                // ignore errors (ممکن است قبلاً عضو باشد یا محروم شده باشد)
            }
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Add group admin error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در افزودن ادمین' });
    }
});

// API برای حذف ادمین از گروه/کانال
app.post('/api/remove-group-admin', async (req, res) => {
    try {
        const { groupId, userId, targetUserId } = req.body;
        console.log('remove-group-admin request', { groupId, userId, targetUserId });
        if (!groupId || !userId || !targetUserId) {
            return res.status(400).json({ success: false, error: 'اطلاعات ناقص است' });
        }
        const adminCheck = await isGroupAdmin(groupId, userId);
        console.log('adminCheck result', adminCheck);
        if (!adminCheck.isAdmin) {
            return res.status(403).json({ success: false, error: 'فقط ادمین می‌تواند این کار را انجام دهد' });
        }
        // جلوگیری از حذف مالک
        const ownerId = await getGroupOwnerId(groupId);
        if (ownerId && parseInt(ownerId) === parseInt(targetUserId)) {
            return res.status(403).json({ success: false, error: 'مالک گروه/کانال قابل حذف نیست' });
        }
        await removeGroupAdmin(groupId, targetUserId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove group admin error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در حذف ادمین' });
    }
});

// API برای علامت‌گذاری پیام‌ها به عنوان خوانده شده
app.post('/api/mark-messages-read', async (req, res) => {
    try {
        const { userId, otherUserId } = req.body;

        if (!userId || !otherUserId) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        const result = await markMessagesAsRead(parseInt(userId), parseInt(otherUserId));

        // اطلاع‌رسانی به فرستنده از طریق WebSocket
        for (const [ws, clientData] of clients.entries()) {
            if (clientData.userId === parseInt(otherUserId)) {
                ws.send(JSON.stringify({
                    type: 'messages_read',
                    readBy: userId,
                    chatType: 'private' // مشخص کردن نوع چت
                }));
            }
        }

        res.json({ success: true, updated: result.updated });
    } catch (error) {
        console.error('Mark messages read error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در به‌روزرسانی وضعیت پیام‌ها' });
    }
});

// API برای جستجوی کاربر
app.get('/api/search-user', async (req, res) => {
    try {
        const { query } = req.query;

        debugLog('Search user request:', query);

        if (!query) {
            return res.status(400).json({ error: 'لطفا نام کاربری یا آیدی را وارد کنید' });
        }

        const user = await searchUserByUsernameOrId(query);
        debugLog('User found:', user);
        res.json({ success: true, user });
    } catch (error) {
        console.error('Search user error:', error);
        res.status(404).json({ success: false, error: error.error || 'کاربر یافت نشد' });
    }
});

// API برای جستجوی جامع (کاربر، گروه، کانال)
app.get('/api/search', async (req, res) => {
    try {
        const { query } = req.query;

        // console.log('Search all request:', query);

        if (!query) {
            return res.status(400).json({ error: 'لطفا نام کاربری، گروه یا کانال را وارد کنید' });
        }

        const result = await searchAll(query);
        debugLog('Search result:', result);
        res.json({ success: true, result });
    } catch (error) {
        console.error('Search error:', error);
        res.status(404).json({ success: false, error: error.error || 'نتیجه‌ای یافت نشد' });
    }
});

// API برای حذف چت خصوصی
app.post('/api/delete-private-chat', async (req, res) => {
    try {
        const { userId, otherUserId, deleteForBoth } = req.body;

        if (!userId || !otherUserId) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        const { messagesDb } = require('./messages-database');

        if (deleteForBoth) {
            // حذف دوطرفه - تمام پیام‌ها حذف می‌شوند
            messagesDb.run(
                `DELETE FROM private_messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`,
                [parseInt(userId), parseInt(otherUserId), parseInt(otherUserId), parseInt(userId)],
                function (err) {
                    if (err) {
                        console.error('Error deleting chat:', err);
                        res.status(500).json({ success: false, error: 'خطا در حذف گفتگو' });
                    } else {
                        // اطلاع‌رسانی به طرف مقابل از طریق WebSocket
                        for (const [ws, clientData] of clients.entries()) {
                            if (clientData.userId === parseInt(otherUserId)) {
                                ws.send(JSON.stringify({
                                    type: 'chat_deleted',
                                    deletedBy: userId,
                                    deletedByUsername: Array.from(clients.values()).find(c => c.userId === parseInt(userId))?.username
                                }));
                            }
                        }

                        res.json({ success: true, deleted: this.changes, deleteForBoth: true });
                    }
                }
            );
        } else {
            // حذف یک‌طرفه - فقط پیام‌هایی که این کاربر فرستاده حذف می‌شوند
            messagesDb.run(
                `DELETE FROM private_messages WHERE sender_id = ? AND receiver_id = ?`,
                [parseInt(userId), parseInt(otherUserId)],
                function (err) {
                    if (err) {
                        console.error('Error deleting chat:', err);
                        res.status(500).json({ success: false, error: 'خطا در حذف گفتگو' });
                    } else {
                        res.json({ success: true, deleted: this.changes, deleteForBoth: false });
                    }
                }
            );
        }
    } catch (error) {
        console.error('Delete chat error:', error);
        res.status(500).json({ success: false, error: error.error || 'خطا در حذف گفتگو' });
    }
});

// API برای ساخت گروه جدید
app.post('/api/create-group', async (req, res) => {
    try {
        const { userId, name, groupId, description, profilePicture } = req.body;

        debugLog('Create group request:', { userId, name, groupId, description, hasProfilePicture: !!profilePicture });

        if (!userId || !name) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        if (typeof name !== 'string' || name.length > 100) {
            return res.status(400).json({ error: 'نام گروه نامعتبر است' });
        }
        if (groupId && !/^[a-zA-Z0-9_]{3,30}$/.test(groupId)) {
            return res.status(400).json({ error: 'شناسه گروه نامعتبر است (3-30 حرف، عدد یا _) ' });
        }
        if (description && description.length > 500) {
            return res.status(400).json({ error: 'توضیحات خیلی طولانی است' });
        }

        // بررسی وجود کاربر در دیتابیس
        try {
            const user = await getUserById(userId);
            if (!user) {
                return res.status(404).json({ error: 'کاربر یافت نشد. لطفا دوباره وارد شوید' });
            }
        } catch (error) {
            return res.status(404).json({ error: 'کاربر یافت نشد. لطفا دوباره وارد شوید' });
        }

        if (name.length < 3) {
            return res.status(400).json({ error: 'نام گروه باید حداقل 3 کاراکتر باشد' });
        }

        // بررسی فرمت آیدی اگر وارد شده
        if (groupId) {
            const idRegex = /^[a-z0-9_]+$/;
            if (!idRegex.test(groupId)) {
                return res.status(400).json({ error: 'فرمت آیدی نامعتبر است' });
            }
            if (groupId.length < 3) {
                return res.status(400).json({ error: 'آیدی باید حداقل 3 کاراکتر باشد' });
            }
        }

        const group = await createGroup(userId, name, groupId, description, profilePicture);
        console.log('Group created successfully:', group);
        res.json({ success: true, group });
    } catch (error) {
        console.error('Create group error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در ساخت گروه' });
    }
});

// API برای ساخت کانال جدید
app.post('/api/create-channel', async (req, res) => {
    try {
        const { userId, name, channelId, description, profilePicture } = req.body;

        debugLog('Create channel request:', { userId, name, channelId, description, hasProfilePicture: !!profilePicture });

        if (!userId || !name) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        if (typeof name !== 'string' || name.length > 100) {
            return res.status(400).json({ error: 'نام کانال نامعتبر است' });
        }
        if (channelId && !/^[a-zA-Z0-9_]{3,30}$/.test(channelId)) {
            return res.status(400).json({ error: 'شناسه کانال نامعتبر است' });
        }
        if (description && description.length > 500) {
            return res.status(400).json({ error: 'توضیحات خیلی طولانی است' });
        }

        if (name.length < 3) {
            return res.status(400).json({ error: 'نام کانال باید حداقل 3 کاراکتر باشد' });
        }

        // بررسی فرمت آیدی اگر وارد شده
        if (channelId) {
            const idRegex = /^[a-z0-9_]+$/;
            if (!idRegex.test(channelId)) {
                return res.status(400).json({ error: 'فرمت آیدی نامعتبر است' });
            }
            if (channelId.length < 3) {
                return res.status(400).json({ error: 'آیدی باید حداقل 3 کاراکتر باشد' });
            }
        }

        const channel = await createChannel(userId, name, channelId, description, profilePicture);
        console.log('Channel created successfully:', channel);
        res.json({ success: true, channel });
    } catch (error) {
        console.error('Create channel error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در ساخت کانال' });
    }
});

// API برای دریافت گروه‌ها و کانال‌های کاربر
app.get('/api/user-groups/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const groups = await getUserGroups(parseInt(userId));
        res.json({ success: true, groups });
    } catch (error) {
        console.error('Get user groups error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در دریافت گروه‌ها' });
    }
});

// API برای بررسی عضویت در گروه/کانال
app.post('/api/check-membership', async (req, res) => {
    try {
        const { groupId, userId } = req.body;
        const result = await checkMembership(groupId, userId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Check membership error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در بررسی عضویت' });
    }
});

// API برای پیوستن به گروه/کانال
app.post('/api/join-group', async (req, res) => {
    try {
        const { groupId, userId } = req.body;

        if (!groupId || !userId) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        // بررسی اینکه کاربر محروم نشده باشد
        const banCheck = await isUserBannedFromGroup(groupId, parseInt(userId));
        if (banCheck.isBanned) {
            return res.status(403).json({ success: false, error: 'شما از این گروه/کانال محروم هستید' });
        }

        const result = await joinGroup(groupId, userId);
        res.json({ success: true, ...result });

        // پس از پیوستن، به همه اطلاع بدهیم (برای سوئیچ پیام شیشه‌ای)
        try {
            const user = await getUserById(userId);
            broadcast({
                type: 'member_joined',
                groupId,
                userId: parseInt(userId),
                username: user ? user.username : null
            });

            // save a system message if this is not a channel
            try {
                const settings = await getGroupSettings(groupId);
                if (!settings || settings.group_type !== 'channel') {
                    const text = user ? `${user.username} به گروه پیوست` : 'یک کاربر به گروه پیوست';
                    // if group has settings it's a custom group, otherwise treat as global
                    if (settings) {
                        await saveGroupMessage(groupId, 0, 'system', text, null, 'system');
                    } else {
                        await saveMessage(0, 'system', text, null, 'system');
                    }
                }
            } catch (e) {
                console.error('Error saving join system message:', e);
            }
        } catch (err) {
            console.error('Error broadcasting member_joined:', err);
        }
    } catch (error) {
        console.error('Join group error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در پیوستن' });
    }
});

// API برای خروج از گروه/کانال (حذف برای خودش)
app.post('/api/leave-group', async (req, res) => {
    try {
        const { groupId, userId } = req.body;

        if (!groupId || !userId) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        const result = await leaveGroup(groupId, userId);
        res.json({ success: true, ...result });

        // broadcast member_left event
        try {
            const user = await getUserById(userId);
            broadcast({
                type: 'member_left',
                groupId,
                userId: parseInt(userId),
                username: user ? user.username : null
            });

            // save system message if not a channel
            try {
                const settings = await getGroupSettings(groupId);
                if (!settings || settings.group_type !== 'channel') {
                    const text = user ? `${user.username} از گروه خارج شد` : 'یک کاربر از گروه خارج شد';
                    if (settings) {
                        await saveGroupMessage(groupId, 0, 'system', text, null, 'system');
                    } else {
                        await saveMessage(0, 'system', text, null, 'system');
                    }
                }
            } catch (e) {
                console.error('Error saving leave system message:', e);
            }
        } catch (err) {
            console.error('Error broadcasting member_left:', err);
        }
    } catch (error) {
        console.error('Leave group error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در خروج از گروه' });
    }
});


// API برای حذف گروه/کانال برای همه (فقط ادمین)
app.post('/api/delete-group', async (req, res) => {
    try {
        const { groupId, userId } = req.body;

        if (!groupId || !userId) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        const result = await deleteGroup(groupId, userId);

        // اطلاع‌رسانی به همه اعضا که گروه حذف شده
        for (const [ws, clientData] of clients.entries()) {
            ws.send(JSON.stringify({
                type: 'group_deleted',
                groupId: groupId
            }));
        }

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Delete group error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در حذف گروه' });
    }
});

// API برای بررسی دسترسی ادمین
app.post('/api/check-admin', async (req, res) => {
    try {
        const { groupId, userId } = req.body;
        const uid = parseInt(userId);
        if (!groupId || isNaN(uid)) {
            return res.status(400).json({ success: false, error: 'اطلاعات ناقص یا نامعتبر است' });
        }
        const result = await isGroupAdmin(groupId, uid);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Check admin error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در بررسی دسترسی' });
    }
});

// API برای آپدیت اطلاعات گروه/کانال
app.post('/api/update-group-info', async (req, res) => {
    try {
        const { groupId, userId, updates } = req.body;

        if (!groupId || !userId || !updates) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        const result = await updateGroupInfo(groupId, userId, updates);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Update group info error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در آپدیت اطلاعات' });
    }
});

// API برای دریافت پیام‌های یک گروه/کانال
app.get('/api/group-messages/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;
        const { limit, userId, before } = req.query;
        const queryLimit = limit ? parseInt(limit) : 50;

        // اگر userId ارسال شده، بررسی محرومیت انجام شود
        if (userId) {
            const banCheck = await isUserBannedFromGroup(groupId, parseInt(userId));
            if (banCheck.isBanned) {
                return res.status(403).json({ success: false, error: 'شما از این گروه/کانال محروم هستید' });
            }
        }

        // تعیین کوئری بر اساس اینکه before داده شده است یا نه
        let messages;
        if (before) {
            // بارگذاری پیام‌های قدیمی‌تر
            messages = await getGroupMessagesBeforeId(groupId, parseInt(before), queryLimit);
        } else {
            messages = await getGroupMessages(groupId, queryLimit);
        }

        // دریافت ریکشن‌ها برای تمام پیام‌ها
        const messageIds = messages.map(msg => msg.id);
        const reactions = await getMessagesReactions(messageIds, 'custom_group');

        // اگر userId داده شده، وضعیت خوانده شدن را برای پیام‌های خودش بررسی کن
        if (userId) {
            const parsedUserId = parseInt(userId);
            const messagesWithReadStatus = await Promise.all(
                messages.map(async (msg) => {
                    let isRead = 1;
                    if (msg.user_id === parsedUserId) {
                        isRead = (await isCustomGroupMessageRead(msg.id, groupId, msg.user_id)) ? 1 : 0;
                    }
                    return {
                        ...msg,
                        is_read: isRead,
                        reactions: reactions[msg.id] || null
                    };
                })
            );
            res.json({ success: true, messages: messagesWithReadStatus });
        } else {
            const messagesWithReactions = messages.map(msg => ({
                ...msg,
                reactions: reactions[msg.id] || null
            }));
            res.json({ success: true, messages: messagesWithReactions });
        }
    } catch (error) {
        console.error('Get group messages error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در دریافت پیام‌های گروه' });
    }
});

// API برای علامت‌گذاری پیام‌های گروه سفارشی به عنوان خوانده شده
app.post('/api/mark-custom-group-messages-read', async (req, res) => {
    try {
        const { userId, groupId, messageId } = req.body;

        if (!userId || !groupId || !messageId) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        // بررسی محرومیت
        const banCheck = await isUserBannedFromGroup(groupId, parseInt(userId));
        if (banCheck.isBanned) {
            return res.status(403).json({ success: false, error: 'شما از این گروه/کانال محروم هستید' });
        }

        await updateCustomGroupLastRead(parseInt(userId), groupId, parseInt(messageId));

        // اطلاع‌رسانی به فرستندگان پیام‌ها که پیام‌هایشان خوانده شده
        const { messagesDb } = require('./messages-database');
        messagesDb.all(
            `SELECT DISTINCT user_id FROM group_messages WHERE group_id = ? AND id <= ? AND user_id != ?`,
            [groupId, parseInt(messageId), parseInt(userId)],
            (err, senders) => {
                if (!err && senders) {
                    senders.forEach(sender => {
                        // پیدا کردن WebSocket فرستنده
                        for (const [ws, clientData] of clients.entries()) {
                            if (clientData.userId === sender.user_id) {
                                ws.send(JSON.stringify({
                                    type: 'messages_read',
                                    readBy: userId,
                                    groupId: groupId,
                                    chatType: 'custom_group'
                                }));
                            }
                        }
                    });
                }
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Mark custom group messages read error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در به‌روزرسانی وضعیت پیام‌ها' });
    }
});

// API برای دریافت تعداد پیام‌های خوانده نشده گروه سفارشی
app.get('/api/unread-custom-group-messages/:userId/:groupId', async (req, res) => {
    try {
        const { userId, groupId } = req.params;
        const unreadCount = await getCustomGroupUnreadCount(parseInt(userId), groupId);
        res.json({ success: true, unread_count: unreadCount });
    } catch (error) {
        console.error('Get unread custom group messages error:', error);
        res.status(500).json({ success: false, error: error.error || 'خطا در دریافت تعداد پیام‌ها' });
    }
});

// API برای حذف پیام
app.post('/api/delete-message', async (req, res) => {
    try {
        const { messageId, userId, chatType, groupId } = req.body;

        if (!messageId || !userId) {
            return res.status(400).json({ error: 'اطلاعات ناقص است' });
        }

        const { messagesDb } = require('./messages-database');

        // بررسی نوع چت و حذف پیام
        if (chatType === 'global') {
            // حذف از گروه عمومی
            // ابتدا بررسی کنیم که پیام متعلق به این کاربر است
            messagesDb.get(
                'SELECT user_id FROM messages WHERE id = ?',
                [parseInt(messageId)],
                async (err, row) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: 'خطا در بررسی پیام' });
                    }

                    if (!row) {
                        return res.status(404).json({ success: false, error: 'پیام یافت نشد' });
                    }

                    // بررسی دسترسی: یا پیام خود کاربر است یا کاربر ادمین است
                    const isOwner = row.user_id === parseInt(userId);
                    const adminCheck = await isGroupAdmin('global', parseInt(userId));

                    if (!isOwner && !adminCheck.isAdmin) {
                        return res.status(403).json({ success: false, error: 'شما دسترسی حذف این پیام را ندارید' });
                    }

                    // حذف پیام
                    messagesDb.run(
                        'DELETE FROM messages WHERE id = ?',
                        [parseInt(messageId)],
                        function (deleteErr) {
                            if (deleteErr) {
                                return res.status(500).json({ success: false, error: 'خطا در حذف پیام' });
                            }

                            // اطلاع‌رسانی به همه کاربران از طریق WebSocket
                            broadcast({
                                type: 'message_deleted',
                                messageId: parseInt(messageId),
                                chatType: 'global'
                            });

                            res.json({ success: true, deleted: this.changes });
                        }
                    );
                }
            );
        } else if (chatType === 'custom_group') {
            // حذف از گروه/کانال سفارشی
            if (!groupId) {
                return res.status(400).json({ error: 'شناسه گروه الزامی است' });
            }

            messagesDb.get(
                'SELECT user_id FROM group_messages WHERE id = ? AND group_id = ?',
                [parseInt(messageId), groupId],
                async (err, row) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: 'خطا در بررسی پیام' });
                    }

                    if (!row) {
                        return res.status(404).json({ success: false, error: 'پیام یافت نشد' });
                    }

                    // بررسی دسترسی
                    const isOwner = row.user_id === parseInt(userId);
                    const adminCheck = await isGroupAdmin(groupId, parseInt(userId));

                    if (!isOwner && !adminCheck.isAdmin) {
                        return res.status(403).json({ success: false, error: 'شما دسترسی حذف این پیام را ندارید' });
                    }

                    // حذف پیام
                    messagesDb.run(
                        'DELETE FROM group_messages WHERE id = ? AND group_id = ?',
                        [parseInt(messageId), groupId],
                        async function (deleteErr) {
                            if (deleteErr) {
                                return res.status(500).json({ success: false, error: 'خطا در حذف پیام' });
                            }

                            // اطلاع‌رسانی به اعضای گروه
                            try {
                                const members = await getGroupMembers(groupId);
                                const memberIds = members.map(m => m.id);

                                // ارسال فقط به اعضای گروه
                                for (const [clientWs, clientData] of clients.entries()) {
                                    if (memberIds.includes(clientData.userId) && clientWs.readyState === WebSocket.OPEN) {
                                        clientWs.send(JSON.stringify({
                                            type: 'message_deleted',
                                            messageId: parseInt(messageId),
                                            chatType: 'custom_group',
                                            groupId: groupId
                                        }));
                                    }
                                }
                            } catch (error) {
                                console.error('خطا در ارسال اطلاع حذف پیام:', error);
                            }

                            res.json({ success: true, deleted: this.changes });
                        }
                    );
                }
            );
        } else if (chatType === 'private') {
            // حذف از چت خصوصی
            messagesDb.get(
                'SELECT sender_id FROM private_messages WHERE id = ?',
                [parseInt(messageId)],
                (err, row) => {
                    if (err) {
                        return res.status(500).json({ success: false, error: 'خطا در بررسی پیام' });
                    }

                    if (!row) {
                        return res.status(404).json({ success: false, error: 'پیام یافت نشد' });
                    }

                    // فقط فرستنده می‌تواند پیام را حذف کند
                    if (row.sender_id !== parseInt(userId)) {
                        return res.status(403).json({ success: false, error: 'شما دسترسی حذف این پیام را ندارید' });
                    }

                    // حذف پیام
                    messagesDb.run(
                        'DELETE FROM private_messages WHERE id = ?',
                        [parseInt(messageId)],
                        function (deleteErr) {
                            if (deleteErr) {
                                return res.status(500).json({ success: false, error: 'خطا در حذف پیام' });
                            }

                            // TODO: اطلاع‌رسانی به طرف مقابل از طریق WebSocket

                            res.json({ success: true, deleted: this.changes });
                        }
                    );
                }
            );
        } else {
            return res.status(400).json({ error: 'نوع چت نامعتبر است' });
        }
    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({ success: false, error: error.error || 'خطا در حذف پیام' });
    }
});

// مسیر برای دریافت فایل‌های آپلود شده
app.get('/api/files/:fileId', (req, res) => {
    // avoid directory traversal by forcing a basename and ensuring
    // the resolved path lives under uploads directory
    const rawId = req.params.fileId || '';
    const fileId = path.basename(rawId); // strips any slashes
    const uploadsRoot = path.join(__dirname, 'uploads');
    const filePath = path.join(uploadsRoot, fileId);

    // sanity check: normalized path must start with uploadsRoot
    if (!filePath.startsWith(uploadsRoot + path.sep) && filePath !== uploadsRoot) {
        console.warn('[Security] attempted access outside uploads:', rawId);
        return res.status(400).json({ error: 'شناسه فایل نامعتبر است' });
    }

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'فایل یافت نشد' });
    }
});

wss.on('connection', (ws, req) => {
    // attempt to get token from query parameter first
    const parts = req.url.split('?');
    const params = new URLSearchParams(parts[1] || '');
    let token = params.get('token');

    // helper to verify and close if invalid
    const verifyToken = (tok) => {
        try {
            const payload = jwt.verify(tok, JWT_SECRET);
            ws.user = payload;
            return true;
        } catch (e) {
            ws.send(JSON.stringify({ type: 'auth_error', message: 'توکن نامعتبر یا منقضی شده' }));
            ws.close();
            return false;
        }
    };

    if (!token) {
        // we will wait for a join message that includes the token
        ws.pendingAuth = true;
    } else {
        if (!verifyToken(token)) return;
    }

    // connection established
    ws.on('close', () => {
        wsRateMap.delete(ws);
    });

    ws.on('message', async (message) => {
        if (!checkWsRate(ws)) return; // throttle abusive clients
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            return; // ignore invalid JSON
        }

        if (data.type === 'join') {
            // if token not yet verified (pendingAuth), expect it in payload
            if (ws.pendingAuth) {
                if (data.token) {
                    if (!verifyToken(data.token)) return;
                    ws.pendingAuth = false;
                } else {
                    ws.send(JSON.stringify({ type: 'auth_error', message: 'توکن ارسال نشده' }));
                    ws.close();
                    return;
                }
            }

            // ignore client-supplied IDs, use token payload
            const userId = ws.user.id;
            const username = ws.user.username;

            // بررسی وجود کاربر در دیتابیس
            try {
                const user = await getUserById(userId);
                if (!user) {
                    ws.send(JSON.stringify({
                        type: 'auth_error',
                        message: 'کاربر یافت نشد. لطفاً دوباره وارد شوید'
                    }));
                    ws.close();
                    return;
                }
            } catch (error) {
                console.error('خطا در بررسی کاربر:', error);
                ws.send(JSON.stringify({
                    type: 'auth_error',
                    message: 'خطا در احراز هویت. لطفاً دوباره وارد شوید'
                }));
                ws.close();
                return;
            }

            clients.set(ws, { username, userId, profilePicture: data.profilePicture });

            // اضافه کردن به لیست همه کاربران
            allUsers.set(userId, {
                username: username,
                userId: userId,
                online: true,
                profilePicture: data.profilePicture
            });

            // اگر کاربر از قبل از گروه عمومی محروم شده بود، به او اطلاع بده
            if (globalBans.has(data.userId)) {
                try {
                    ws.send(JSON.stringify({ type: 'member_removed', groupId: 'global', userId: data.userId }));
                } catch (ign) { }
            }

            broadcastUsers();

            // ارسال تاریخچه پیام‌ها به کاربر جدید
            try {
                const messages = await getRecentMessages(50);
                const lastReadMessageId = await getLastReadMessageId(data.userId);

                // اضافه کردن وضعیت خوانده شدن برای پیام‌های این کاربر
                const messagesWithReadStatus = await Promise.all(
                    messages.map(async (msg) => {
                        if (msg.user_id === data.userId) {
                            const isRead = await isGroupMessageRead(msg.id, msg.user_id);
                            return { ...msg, is_read: isRead ? 1 : 0 };
                        }
                        // برای پیام‌های دیگران، is_read همیشه 1 است
                        return { ...msg, is_read: 1 };
                    })
                );
                ws.send(JSON.stringify({
                    type: 'history',
                    messages: messagesWithReadStatus,
                    lastReadMessageId: lastReadMessageId
                }));
            } catch (error) {
                console.error('خطا در ارسال تاریخچه:', error);
            }
        } else if (data.type === 'message') {
            const clientData = clients.get(ws);
            if (clientData) {
                // block banned users from sending to global chat
                if (globalBans.has(clientData.userId)) {
                    try {
                        ws.send(JSON.stringify({ type: 'error', message: 'شما از گروه عمومی حذف شده‌اید' }));
                    } catch (ign) { }
                    return;
                }

                // ذخیره پیام در دیتابیس
                try {
                    const result = await saveMessage(clientData.userId, clientData.username, data.text, data.replyTo || null);

                    broadcast({
                        type: 'message',
                        username: clientData.username,
                        userId: clientData.userId,
                        text: data.text,
                        timestamp: new Date().toISOString(),
                        messageId: result.id,
                        replyTo: data.replyTo || null
                    });
                } catch (error) {
                    console.error('خطا در ذخیره پیام:', error);
                }
            }
        } else if (data.type === 'private_message') {
            // پیام خصوصی
            const senderData = clients.get(ws);
            if (senderData) {
                const targetUsername = data.to;
                const targetWs = findClientByUsername(targetUsername);

                // پیدا کردن ID گیرنده
                let receiverId = null;
                for (const [clientWs, clientData] of clients.entries()) {
                    if (clientData.username === targetUsername) {
                        receiverId = clientData.userId;
                        break;
                    }
                }

                if (receiverId) {
                    // ذخیره پیام خصوصی در دیتابیس
                    try {
                        await savePrivateMessage(
                            senderData.userId,
                            senderData.username,
                            receiverId,
                            targetUsername,
                            data.text,
                            data.replyTo || null
                        );
                    } catch (error) {
                        console.error('خطا در ذخیره پیام خصوصی:', error);
                    }
                }

                const messageData = {
                    type: 'private_message',
                    from: senderData.username,
                    fromUserId: senderData.userId,
                    profilePicture: senderData.profilePicture || null,
                    to: targetUsername,
                    toUserId: receiverId,
                    text: data.text,
                    timestamp: new Date().toISOString(),
                    replyTo: data.replyTo || null
                };

                // ارسال به گیرنده
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify(messageData));
                }

                // تایید برای فرستنده
                ws.send(JSON.stringify(messageData));
            }
        } else if (data.type === 'load_private_history') {
            // بارگذاری تاریخچه پیام‌های خصوصی
            const senderData = clients.get(ws);
            if (senderData && data.targetUserId) {
                try {
                    const messages = await getPrivateMessages(senderData.userId, data.targetUserId, 50);

                    // دریافت ریکشن‌ها برای تمام پیام‌ها
                    const messageIds = messages.map(msg => msg.id);
                    const reactions = await getMessagesReactions(messageIds, 'private');

                    const messagesWithReactions = messages.map(msg => ({
                        ...msg,
                        reactions: reactions[msg.id] || null
                    }));

                    ws.send(JSON.stringify({
                        type: 'private_history',
                        targetUsername: data.targetUsername,
                        messages: messagesWithReactions
                    }));
                } catch (error) {
                    console.error('خطا در بارگذاری تاریخچه:', error);
                }
            }
        } else if (data.type === 'group_profile_updated') {
            // اطلاع‌رسانی به همه کاربران از تغییر پروفایل گروه
            broadcast({
                type: 'group_profile_updated',
                profilePicture: data.profilePicture
            });
        } else if (data.type === 'group_message') {
            // پیام گروه/کانال سفارشی
            const senderData = clients.get(ws);
            if (senderData) {
                const groupId = data.groupId;

                try {
                    // قبل از هر کاری مطمئن شویم کاربر محروم نشده
                    const banCheck = await isUserBannedFromGroup(groupId, senderData.userId);
                    if (banCheck.isBanned) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'شما از این گروه/کانال محروم هستید'
                        }));
                        return;
                    }

                    // دریافت تنظیمات گروه برای بررسی نوع آن
                    const groupSettings = await getGroupSettings(groupId);

                    // اگر کانال است، بررسی کن که فرستنده ادمین است یا نه
                    if (groupSettings && groupSettings.group_type === 'channel') {
                        const adminCheck = await isGroupAdmin(groupId, senderData.userId);

                        if (!adminCheck.isAdmin) {
                            // کاربر ادمین نیست - ارسال خطا
                            ws.send(JSON.stringify({
                                type: 'error',
                                message: 'فقط ادمین‌های کانال می‌توانند پیام ارسال کنند'
                            }));
                            return;
                        }
                    }

                    // ذخیره پیام در دیتابیس
                    const savedMessage = await saveGroupMessage(
                        groupId,
                        senderData.userId,
                        senderData.username,
                        data.text,
                        data.replyTo || null,
                        'group'
                    );

                    // دریافت لیست اعضای گروه
                    const members = await getGroupMembers(groupId);
                    const memberIds = members.map(m => m.id);

                    // ارسال پیام فقط به اعضای گروه
                    for (const [clientWs, clientData] of clients.entries()) {
                        if (memberIds.includes(clientData.userId) && clientWs.readyState === WebSocket.OPEN) {
                            clientWs.send(JSON.stringify({
                                type: 'group_message',
                                groupId: groupId,
                                username: senderData.username,
                                userId: senderData.userId,
                                text: data.text,
                                timestamp: savedMessage.created_at,
                                messageId: savedMessage.id,
                                replyTo: data.replyTo || null
                            }));
                        }
                    }
                } catch (error) {
                    console.error('خطا در ذخیره پیام گروه:', error);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'خطا در ارسال پیام'
                    }));
                }
            }
        } else if (data.type === 'load_group_history') {
            // بارگذاری تاریخچه پیام‌های گروه/کانال
            const senderData = clients.get(ws);
            if (senderData && data.groupId) {
                try {
                    const messages = await getGroupMessages(data.groupId, 50);
                    const lastReadMessageId = await getCustomGroupLastReadMessageId(senderData.userId, data.groupId);

                    // دریافت ریکشن‌ها برای تمام پیام‌ها
                    const messageIds = messages.map(msg => msg.id);
                    const reactions = await getMessagesReactions(messageIds, 'custom_group');

                    // اضافه کردن وضعیت خوانده شدن برای پیام‌های این کاربر
                    const messagesWithReadStatus = await Promise.all(
                        messages.map(async (msg) => {
                            if (msg.user_id === senderData.userId) {
                                const isRead = await isCustomGroupMessageRead(msg.id, data.groupId, msg.user_id);
                                return { ...msg, is_read: isRead ? 1 : 0, reactions: reactions[msg.id] || null };
                            }
                            // برای پیام‌های دیگران، is_read همیشه 1 است
                            return { ...msg, is_read: 1, reactions: reactions[msg.id] || null };
                        })
                    );

                    ws.send(JSON.stringify({
                        type: 'group_history',
                        groupId: data.groupId,
                        messages: messagesWithReadStatus,
                        lastReadMessageId: lastReadMessageId
                    }));
                } catch (error) {
                    console.error('خطا در بارگذاری تاریخچه گروه:', error);
                }
            }
        } else if (data.type === 'file_message') {
            // پیام فایل
            const senderData = clients.get(ws);
            if (senderData) {
                try {
                    // simple size cap: limit to ~5MB of base64 data (~3.75MB raw)
                    if (typeof data.fileData === 'string' && data.fileData.length > 5 * 1024 * 1024) {
                        ws.send(JSON.stringify({ type: 'error', message: 'فایل خیلی بزرگ است' }));
                        return;
                    }

                    // استخراج داده‌های فایل از Base64
                    const base64Data = data.fileData.split(';base64,').pop();
                    const fileExtension = data.fileName.includes('.') ? data.fileName.split('.').pop() : '';
                    const fileId = Date.now() + '-' + Math.round(Math.random() * 1E9) + (fileExtension ? '.' + fileExtension : '');
                    const filePath = path.join(__dirname, 'uploads', fileId);

                    // ذخیره فایل به صورت باینری
                    fs.writeFileSync(filePath, base64Data, { encoding: 'base64' });

                    const fileMetadata = {
                        fileName: data.fileName,
                        fileSize: data.fileSize,
                        fileType: data.fileType,
                        fileId: fileId // استفاده از ID به جای کل دیتا
                    };

                    const messageText = `[FILE:${JSON.stringify(fileMetadata)}]`;

                    if (data.messageType === 'group') {
                        // پیام فایل در گروه عمومی
                        const result = await saveMessage(senderData.userId, senderData.username, messageText);

                        broadcast({
                            type: 'message',
                            username: senderData.username,
                            userId: senderData.userId,
                            text: messageText,
                            timestamp: new Date().toISOString(),
                            messageId: result.id,
                            isFile: true,
                            fileData: fileMetadata,
                            replyTo: data.replyTo || null
                        });
                    } else if (data.messageType === 'custom_group') {
                        // پیام فایل در گروه/کانال سفارشی

                        // دریافت تنظیمات گروه برای بررسی نوع آن
                        const groupSettings = await getGroupSettings(data.groupId);

                        // اگر کانال است، بررسی کن که فرستنده ادمین است یا نه
                        if (groupSettings && groupSettings.group_type === 'channel') {
                            const adminCheck = await isGroupAdmin(data.groupId, senderData.userId);

                            if (!adminCheck.isAdmin) {
                                // کاربر ادمین نیست - ارسال خطا
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: 'فقط ادمین‌های کانال می‌توانند فایل ارسال کنند'
                                }));
                                return;
                            }
                        }

                        const savedMessage = await saveGroupMessage(
                            data.groupId,
                            senderData.userId,
                            senderData.username,
                            messageText,
                            null,
                            'group'
                        );

                        // دریافت لیست اعضای گروه
                        const members = await getGroupMembers(data.groupId);
                        const memberIds = members.map(m => m.id);

                        // ارسال پیام فقط به اعضای گروه
                        for (const [clientWs, clientData] of clients.entries()) {
                            if (memberIds.includes(clientData.userId) && clientWs.readyState === WebSocket.OPEN) {
                                clientWs.send(JSON.stringify({
                                    type: 'group_message',
                                    groupId: data.groupId,
                                    username: senderData.username,
                                    userId: senderData.userId,
                                    text: messageText,
                                    timestamp: savedMessage.created_at,
                                    messageId: savedMessage.id,
                                    isFile: true,
                                    fileData: fileMetadata,
                                    replyTo: data.replyTo || null
                                }));
                            }
                        }
                    } else if (data.messageType === 'private') {
                        // پیام فایل خصوصی
                        const targetUsername = data.to;
                        const targetWs = findClientByUsername(targetUsername);

                        let receiverId = null;
                        for (const [clientWs, clientData] of clients.entries()) {
                            if (clientData.username === targetUsername) {
                                receiverId = clientData.userId;
                                break;
                            }
                        }

                        if (receiverId) {
                            await savePrivateMessage(
                                senderData.userId,
                                senderData.username,
                                receiverId,
                                targetUsername,
                                messageText
                            );
                        }

                        const messageData = {
                            type: 'private_message',
                            from: senderData.username,
                            fromUserId: senderData.userId,
                            to: targetUsername,
                            toUserId: receiverId,
                            text: messageText,
                            timestamp: new Date().toISOString(),
                            isFile: true,
                            fileData: fileMetadata,
                            replyTo: data.replyTo || null
                        };

                        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                            targetWs.send(JSON.stringify(messageData));
                        }

                        ws.send(JSON.stringify(messageData));
                    }
                } catch (error) {
                    console.error('خطا در ذخیره پیام فایل:', error);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'خطا در ارسال فایل'
                    }));
                }
            }
        } else if (data.type === 'edit_message') {
            // ویرایش پیام
            const senderData = clients.get(ws);
            if (senderData) {
                const { messageId, newText, chatType, groupId } = data;

                if (!messageId || !newText) {
                    ws.send(JSON.stringify({
                        type: 'edit_message',
                        success: false,
                        error: 'اطلاعات ناقص است'
                    }));
                    return;
                }

                const { messagesDb } = require('./messages-database');

                try {
                    if (chatType === 'global') {
                        // ویرایش پیام در گروه عمومی
                        messagesDb.get(
                            'SELECT user_id FROM messages WHERE id = ?',
                            [parseInt(messageId)],
                            (err, row) => {
                                if (err || !row) {
                                    ws.send(JSON.stringify({
                                        type: 'edit_message',
                                        success: false,
                                        error: 'پیام یافت نشد'
                                    }));
                                    return;
                                }

                                // بررسی اینکه پیام متعلق به این کاربر است
                                if (row.user_id !== senderData.userId) {
                                    ws.send(JSON.stringify({
                                        type: 'edit_message',
                                        success: false,
                                        error: 'شما فقط می‌توانید پیام‌های خود را ویرایش کنید'
                                    }));
                                    return;
                                }

                                // آپدیت پیام
                                messagesDb.run(
                                    'UPDATE messages SET message = ? WHERE id = ?',
                                    [newText, parseInt(messageId)],
                                    function (updateErr) {
                                        if (updateErr) {
                                            ws.send(JSON.stringify({
                                                type: 'edit_message',
                                                success: false,
                                                error: 'خطا در ویرایش پیام'
                                            }));
                                            return;
                                        }

                                        // ارسال به همه کاربران
                                        broadcast({
                                            type: 'edit_message',
                                            success: true,
                                            messageId: parseInt(messageId),
                                            newText: newText,
                                            chatType: 'global',
                                            editedBy: senderData.userId
                                        });
                                    }
                                );
                            }
                        );
                    } else if (chatType === 'custom_group') {
                        // ویرایش پیام در گروه/کانال سفارشی
                        if (!groupId) {
                            ws.send(JSON.stringify({
                                type: 'edit_message',
                                success: false,
                                error: 'شناسه گروه الزامی است'
                            }));
                            return;
                        }

                        messagesDb.get(
                            'SELECT user_id FROM group_messages WHERE id = ? AND group_id = ?',
                            [parseInt(messageId), groupId],
                            (err, row) => {
                                if (err || !row) {
                                    ws.send(JSON.stringify({
                                        type: 'edit_message',
                                        success: false,
                                        error: 'پیام یافت نشد'
                                    }));
                                    return;
                                }

                                // بررسی اینکه پیام متعلق به این کاربر است
                                if (row.user_id !== senderData.userId) {
                                    ws.send(JSON.stringify({
                                        type: 'edit_message',
                                        success: false,
                                        error: 'شما فقط می‌توانید پیام‌های خود را ویرایش کنید'
                                    }));
                                    return;
                                }

                                // آپدیت پیام
                                messagesDb.run(
                                    'UPDATE group_messages SET message = ? WHERE id = ? AND group_id = ?',
                                    [newText, parseInt(messageId), groupId],
                                    async function (updateErr) {
                                        if (updateErr) {
                                            ws.send(JSON.stringify({
                                                type: 'edit_message',
                                                success: false,
                                                error: 'خطا در ویرایش پیام'
                                            }));
                                            return;
                                        }

                                        // دریافت لیست اعضای گروه
                                        try {
                                            const members = await getGroupMembers(groupId);
                                            const memberIds = members.map(m => m.id);

                                            // ارسال فقط به اعضای گروه
                                            for (const [clientWs, clientData] of clients.entries()) {
                                                if (memberIds.includes(clientData.userId) && clientWs.readyState === WebSocket.OPEN) {
                                                    clientWs.send(JSON.stringify({
                                                        type: 'edit_message',
                                                        success: true,
                                                        messageId: parseInt(messageId),
                                                        newText: newText,
                                                        chatType: 'custom_group',
                                                        groupId: groupId,
                                                        editedBy: senderData.userId
                                                    }));
                                                }
                                            }
                                        } catch (error) {
                                            console.error('خطا در ارسال پیام ویرایش شده:', error);
                                        }
                                    }
                                );
                            }
                        );
                    } else if (chatType === 'private') {
                        // ویرایش پیام خصوصی
                        messagesDb.get(
                            'SELECT sender_id, receiver_id FROM private_messages WHERE id = ?',
                            [parseInt(messageId)],
                            (err, row) => {
                                if (err || !row) {
                                    ws.send(JSON.stringify({
                                        type: 'edit_message',
                                        success: false,
                                        error: 'پیام یافت نشد'
                                    }));
                                    return;
                                }

                                // بررسی اینکه پیام متعلق به این کاربر است
                                if (row.sender_id !== senderData.userId) {
                                    ws.send(JSON.stringify({
                                        type: 'edit_message',
                                        success: false,
                                        error: 'شما فقط می‌توانید پیام‌های خود را ویرایش کنید'
                                    }));
                                    return;
                                }

                                // آپدیت پیام
                                messagesDb.run(
                                    'UPDATE private_messages SET message = ? WHERE id = ?',
                                    [newText, parseInt(messageId)],
                                    function (updateErr) {
                                        if (updateErr) {
                                            ws.send(JSON.stringify({
                                                type: 'edit_message',
                                                success: false,
                                                error: 'خطا در ویرایش پیام'
                                            }));
                                            return;
                                        }

                                        // ارسال به فرستنده و گیرنده
                                        const editData = {
                                            type: 'edit_message',
                                            success: true,
                                            messageId: parseInt(messageId),
                                            newText: newText,
                                            chatType: 'private',
                                            editedBy: senderData.userId
                                        };

                                        // ارسال به فرستنده
                                        ws.send(JSON.stringify(editData));

                                        // ارسال به گیرنده
                                        for (const [clientWs, clientData] of clients.entries()) {
                                            if (clientData.userId === row.receiver_id && clientWs.readyState === WebSocket.OPEN) {
                                                clientWs.send(JSON.stringify(editData));
                                            }
                                        }
                                    }
                                );
                            }
                        );
                    }
                } catch (error) {
                    console.error('خطا در ویرایش پیام:', error);
                    ws.send(JSON.stringify({
                        type: 'edit_message',
                        success: false,
                        error: 'خطا در ویرایش پیام'
                    }));
                }
            }
        } else if (data.type === 'add_reaction') {
            // اضافه کردن ریکشن
            const senderData = clients.get(ws);
            if (senderData) {
                const { messageId, reaction, chatType, groupId } = data;

                if (!messageId || !reaction) {
                    return;
                }

                // تعیین نوع پیام برای دیتابیس
                let messageType = 'group'; // پیش‌فرض
                if (chatType === 'custom_group') {
                    messageType = 'custom_group';
                } else if (chatType === 'private') {
                    messageType = 'private';
                }

                try {
                    // دریافت user_id متنی از دیتابیس
                    const user = await getUserById(senderData.userId);
                    const userIdText = user ? user.user_id : null;

                    await addReaction(
                        parseInt(messageId),
                        messageType,
                        senderData.userId,
                        senderData.username,
                        userIdText,
                        senderData.profilePicture,
                        reaction
                    );

                    // دریافت تمام ریکشن‌های این پیام
                    const reactions = await getMessageReactions(parseInt(messageId), messageType);

                    // ارسال به کاربران مربوطه
                    if (chatType === 'global') {
                        // ارسال به همه
                        broadcast({
                            type: 'reaction_updated',
                            messageId: parseInt(messageId),
                            chatType: 'global',
                            reactions: reactions
                        });
                    } else if (chatType === 'custom_group' && groupId) {
                        // ارسال فقط به اعضای گروه
                        const members = await getGroupMembers(groupId);
                        const memberIds = members.map(m => m.id);

                        for (const [clientWs, clientData] of clients.entries()) {
                            if (memberIds.includes(clientData.userId) && clientWs.readyState === WebSocket.OPEN) {
                                clientWs.send(JSON.stringify({
                                    type: 'reaction_updated',
                                    messageId: parseInt(messageId),
                                    chatType: 'custom_group',
                                    groupId: groupId,
                                    reactions: reactions
                                }));
                            }
                        }
                    }
                } catch (error) {
                    console.error('خطا در اضافه کردن ریکشن:', error);
                }
            }
        } else if (data.type === 'remove_reaction') {
            // حذف ریکشن
            const senderData = clients.get(ws);
            if (senderData) {
                const { messageId, reaction, chatType, groupId } = data;

                if (!messageId || !reaction) {
                    return;
                }

                // تعیین نوع پیام برای دیتابیس
                let messageType = 'group'; // پیش‌فرض
                if (chatType === 'custom_group') {
                    messageType = 'custom_group';
                } else if (chatType === 'private') {
                    messageType = 'private';
                }

                try {
                    await removeReaction(
                        parseInt(messageId),
                        messageType,
                        senderData.userId,
                        reaction
                    );

                    // دریافت تمام ریکشن‌های این پیام
                    const reactions = await getMessageReactions(parseInt(messageId), messageType);

                    // ارسال به کاربران مربوطه
                    if (chatType === 'global') {
                        // ارسال به همه
                        broadcast({
                            type: 'reaction_updated',
                            messageId: parseInt(messageId),
                            chatType: 'global',
                            reactions: reactions.length > 0 ? reactions : null
                        });
                    } else if (chatType === 'custom_group' && groupId) {
                        // ارسال فقط به اعضای گروه
                        const members = await getGroupMembers(groupId);
                        const memberIds = members.map(m => m.id);

                        for (const [clientWs, clientData] of clients.entries()) {
                            if (memberIds.includes(clientData.userId) && clientWs.readyState === WebSocket.OPEN) {
                                clientWs.send(JSON.stringify({
                                    type: 'reaction_updated',
                                    messageId: parseInt(messageId),
                                    chatType: 'custom_group',
                                    groupId: groupId,
                                    reactions: reactions.length > 0 ? reactions : null
                                }));
                            }
                        }
                    }
                } catch (error) {
                    console.error('خطا در حذف ریکشن:', error);
                }
            }
        }
    });

    ws.on('close', () => {
        const clientData = clients.get(ws);
        if (clientData) {
            clients.delete(ws);

            // بررسی اینکه آیا کاربر با اتصال دیگری هنوز متصل است
            const stillConnected = Array.from(clients.values()).some(
                client => client.userId === clientData.userId
            );

            // اگر کاربر کاملاً خارج شده، وضعیتش را آفلاین کن (اما حذف نکن)
            if (!stillConnected && allUsers.has(clientData.userId)) {
                allUsers.get(clientData.userId).online = false;
            }

            broadcastUsers();
        }
    });
});

function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            // اگر این پیام از نوع global chat باشد، گیرندگان محروم را نادیده
            // بگیر تا کاربران حذف‌شده دیگر آن را نبینند.
            if (data.type === 'message') {
                const cd = clients.get(client);
                if (cd && globalBans.has(cd.userId)) return;
            }

            client.send(JSON.stringify(data));
        }
    });
}

function broadcastUsers() {
    const users = Array.from(allUsers.values())
        .filter(u => !globalBans.has(u.userId))
        .map(user => ({
            username: user.username,
            userId: user.userId,
            online: user.online,
            profilePicture: user.profilePicture
        }));
    broadcast({ type: 'users_with_ids', users });
}

function findClientByUsername(username) {
    for (const [ws, clientData] of clients.entries()) {
        if (clientData.username === username) {
            return ws;
        }
    }
    return null;
}

// API برای دریافت لیست کاربران حذف‌شده از گروه عمومی
app.post('/api/get-banned-users', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'اطلاعات ناقص است' });
        }

        // بررسی اینکه کاربر ادمین گروه عمومی است
        const adminCheck = await isGroupAdmin('global', parseInt(userId));
        if (!adminCheck.isAdmin) {
            return res.status(403).json({ success: false, error: 'شما ادمین نیستید' });
        }

        // دریافت لیست کاربران حذف‌شده
        const bannedUserIds = await getGlobalBans();

        // دریافت اطلاعات هر کاربر حذف‌شده
        const bannedUsersInfo = [];
        for (const bannedUserId of bannedUserIds) {
            try {
                const user = await getUserById(bannedUserId);
                if (user) {
                    bannedUsersInfo.push({
                        id: user.id,
                        username: user.username,
                        profilePicture: user.profile_picture || null
                    });
                }
            } catch (err) {
                console.error(`Error getting user ${bannedUserId}:`, err);
            }
        }

        console.log('Banned users info:', bannedUsersInfo);

        res.json({ success: true, bannedUsers: bannedUsersInfo });
    } catch (error) {
        console.error('Get banned users error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در دریافت لیست کاربران حذف‌شده' });
    }
});

// API برای بازگردانی کاربر حذف‌شده
app.post('/api/unban-user', async (req, res) => {
    try {
        const { userId, targetUserId } = req.body;

        console.log('Unban request:', { userId, targetUserId });

        if (!userId || !targetUserId) {
            return res.status(400).json({ success: false, error: 'اطلاعات ناقص است' });
        }

        // بررسی اینکه کاربر ادمین گروه عمومی است
        const adminCheck = await isGroupAdmin('global', parseInt(userId));
        if (!adminCheck.isAdmin) {
            return res.status(403).json({ success: false, error: 'شما ادمین نیستید' });
        }

        // بازگردانی کاربر
        await unbanGlobal(parseInt(targetUserId));
        globalBans.delete(parseInt(targetUserId));

        // اضافه کردن کاربر به لیست allUsers دوباره
        try {
            const user = await getUserById(parseInt(targetUserId));
            if (user) {
                allUsers.set(user.id, {
                    username: user.username,
                    userId: user.user_id,
                    online: false,
                    profilePicture: user.profile_picture || null
                });
            }
        } catch (err) {
            console.error('Error adding user back to allUsers:', err);
        }

        broadcastUsers();

        res.json({ success: true });
    } catch (error) {
        console.error('Unban user error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در بازگردانی کاربر' });
    }
});

// API برای دریافت لیست کاربران محروم از گروه/کانال سفارشی
app.post('/api/get-group-banned-users', async (req, res) => {
    try {
        const { groupId, userId } = req.body;

        if (!groupId || !userId) {
            return res.status(400).json({ success: false, error: 'اطلاعات ناقص است' });
        }

        // بررسی اینکه کاربر ادمین گروه است
        const adminCheck = await isGroupAdmin(groupId, parseInt(userId));
        if (!adminCheck.isAdmin) {
            return res.status(403).json({ success: false, error: 'شما ادمین نیستید' });
        }

        // دریافت لیست کاربران محروم
        const bannedUserIds = await getGroupBans(groupId);

        // دریافت اطلاعات هر کاربر محروم
        const bannedUsersInfo = [];
        for (const bannedUserId of bannedUserIds) {
            try {
                const user = await getUserById(bannedUserId);
                if (user) {
                    bannedUsersInfo.push({
                        id: user.id,
                        username: user.username,
                        profilePicture: user.profile_picture || null
                    });
                }
            } catch (err) {
                console.error(`Error getting user ${bannedUserId}:`, err);
            }
        }

        res.json({ success: true, bannedUsers: bannedUsersInfo });
    } catch (error) {
        console.error('Get group banned users error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در دریافت لیست کاربران محروم' });
    }
});

// API برای محروم کردن کاربر از گروه/کانال سفارشی
app.post('/api/ban-user-from-group', async (req, res) => {
    try {
        const { groupId, userId, targetUserId } = req.body;

        if (!groupId || !userId || !targetUserId) {
            return res.status(400).json({ success: false, error: 'اطلاعات ناقص است' });
        }

        // برای گروه عمومی باید از جدول global_bans استفاده کنیم
        if (groupId === 'global') {
            // بررسی اینکه کاربر ادمین گروه عمومی است
            const adminCheck = await isGroupAdmin('global', parseInt(userId));
            if (!adminCheck.isAdmin) {
                return res.status(403).json({ success: false, error: 'شما ادمین نیستید' });
            }

            await banGlobal(parseInt(targetUserId));
            globalBans.add(parseInt(targetUserId));
            // حذف از لیست اعضا در صورت حضور
            try {
                await leaveGroup('global', parseInt(targetUserId));
            } catch (_) { }

            broadcast({ type: 'member_removed', groupId, userId: parseInt(targetUserId) });

            // save system ban message for global (since it's effectively a group)
            try {
                // try retrieve names
                let performerName = null;
                let targetName = null;
                try {
                    const u = await getUserById(userId);
                    if (u) performerName = u.username;
                } catch (e) { }
                try {
                    const t = await getUserById(targetUserId);
                    if (t) targetName = t.username;
                } catch (e) { }
                const text = performerName
                    ? `${performerName} کاربر ${targetName || targetUserId} را محروم کرد`
                    : `کاربر ${targetName || targetUserId} محروم شد`;
                await saveMessage(0, 'system', text, null, 'system');
            } catch (e) {
                console.error('Error saving global ban system message:', e);
            }

            // اطلاع‌رسانی مستقیم
            for (const [ws, clientData] of clients.entries()) {
                if (clientData.userId === parseInt(targetUserId) && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'user_banned_from_group',
                        groupId: groupId,
                        message: 'شما از این گروه/کانال محروم شدید'
                    }));
                }
            }

            res.json({ success: true });
            return;
        }

        // بررسی اینکه کاربر ادمین گروه است
        const adminCheck = await isGroupAdmin(groupId, parseInt(userId));
        if (!adminCheck.isAdmin) {
            return res.status(403).json({ success: false, error: 'شما ادمین نیستید' });
        }

        // محروم کردن کاربر از گروه سفارشی
        await banUserFromGroup(groupId, parseInt(targetUserId));

        // حذف کاربر از گروه (اگر هنوز باقی مانده باشد)
        try {
            await leaveGroup(groupId, parseInt(targetUserId));
        } catch (_) { }

        // اطلاع‌رسانی به همه مشتریان (از جمله خودِ کاربر محروم شده)
        // broadcast removal with performer info so clients can show a message
        let performerName = null;
        let targetName = null;
        try {
            const u = await getUserById(userId);
            if (u) performerName = u.username;
        } catch (e) {
            console.error('Error fetching performer name for ban broadcast', e);
        }
        try {
            const t = await getUserById(targetUserId);
            if (t) targetName = t.username;
        } catch (e) {
            console.error('Error fetching target name for ban broadcast', e);
        }
        broadcast({ type: 'member_removed', groupId, userId: parseInt(targetUserId), performedBy: parseInt(userId), performedByName: performerName, targetUsername: targetName });

        // also save a system message for this ban if not a channel
        try {
            const settings = await getGroupSettings(groupId);
            if (!settings || settings.group_type !== 'channel') {
                const text = performerName
                    ? `${performerName} کاربر ${targetName || targetUserId} را محروم کرد`
                    : `کاربر ${targetName || targetUserId} محروم شد`;
                if (settings) {
                    await saveGroupMessage(groupId, 0, 'system', text, null, 'system');
                } else {
                    await saveMessage(0, 'system', text, null, 'system');
                }
            }
        } catch (e) {
            console.error('Error saving ban system message:', e);
        }

        // اطلاع‌رسانی مستقیم به کاربر محروم شده (اگر آنلاین است)
        for (const [ws, clientData] of clients.entries()) {
            if (clientData.userId === parseInt(targetUserId) && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'user_banned_from_group',
                    groupId: groupId,
                    message: 'شما از این گروه/کانال محروم شدید'
                }));
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Ban user from group error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در محروم کردن کاربر' });
    }
});

// API برای بازگردانی کاربر محروم از گروه/کانال سفارشی
app.post('/api/unban-user-from-group', async (req, res) => {
    try {
        const { groupId, userId, targetUserId } = req.body;

        if (!groupId || !userId || !targetUserId) {
            return res.status(400).json({ success: false, error: 'اطلاعات ناقص است' });
        }

        // بررسی اینکه کاربر ادمین گروه است
        const adminCheck = await isGroupAdmin(groupId, parseInt(userId));
        if (!adminCheck.isAdmin) {
            return res.status(403).json({ success: false, error: 'شما ادمین نیستید' });
        }

        // بازگردانی کاربر
        await unbanUserFromGroup(groupId, parseInt(targetUserId));

        res.json({ success: true });
    } catch (error) {
        console.error('Unban user from group error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در بازگردانی کاربر' });
    }
});

// API برای بررسی اینکه کاربر از گروه/کانال محروم است یا نه
app.post('/api/check-group-ban', async (req, res) => {
    try {
        const { groupId, userId } = req.body;

        if (!groupId || !userId) {
            return res.status(400).json({ success: false, error: 'اطلاعات ناقص است' });
        }

        const banCheck = await isUserBannedFromGroup(groupId, parseInt(userId));
        res.json({ success: true, isBanned: banCheck.isBanned });
    } catch (error) {
        console.error('Check group ban error:', error);
        res.status(400).json({ success: false, error: error.error || 'خطا در بررسی محرومیت' });
    }
});

// ========== Admin API Endpoints ==========

// بررسی دسترسی ادمین
async function checkAdminAccess(userId) {
    try {
        const user = await getUserById(userId);
        return user && user.email === 'kiaarashabdolahi@gmail.com';
    } catch (error) {
        return false;
    }
}

// API برای دانلود دیتابیس (فقط برای ادمین)
app.get('/api/admin/download-database/:dbName', async (req, res) => {
    try {
        const { dbName } = req.params;
        const userId = req.user && req.user.id;

        if (!userId) {
            return res.status(401).json({ error: 'دسترسی غیرمجاز' });
        }

        // بررسی دسترسی ادمین
        const isAdmin = await checkAdminAccess(parseInt(userId));
        if (!isAdmin) {
            return res.status(403).json({ error: 'شما دسترسی ادمین ندارید' });
        }

        // بررسی نام دیتابیس
        if (dbName !== 'users' && dbName !== 'messages') {
            return res.status(400).json({ error: 'نام دیتابیس نامعتبر است' });
        }

        const fs = require('fs');
        const dbPath = path.join(__dirname, `${dbName}.db`);

        if (!fs.existsSync(dbPath)) {
            return res.status(404).json({ error: 'دیتابیس یافت نشد' });
        }

        res.download(dbPath, `${dbName}.db`, (err) => {
            if (err) {
                console.error('Download error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'خطا در دانلود دیتابیس' });
                }
            }
        });
    } catch (error) {
        console.error('Download database error:', error);
        res.status(500).json({ error: 'خطا در دانلود دیتابیس' });
    }
});

// API برای آپلود دیتابیس (فقط برای ادمین)
app.post('/api/admin/upload-database/:dbName', async (req, res) => {
    try {
        const multer = require('multer');
        const fs = require('fs');

        // تنظیم multer برای آپلود فایل
        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, __dirname);
            },
            filename: (req, file, cb) => {
                const { dbName } = req.params;
                cb(null, `${dbName}.db.new`);
            }
        });

        const upload = multer({
            storage: storage,
            limits: { fileSize: 100 * 1024 * 1024 }, // حداکثر 100MB
            fileFilter: (req, file, cb) => {
                if (file.originalname.endsWith('.db')) {
                    cb(null, true);
                } else {
                    cb(new Error('فقط فایل‌های .db مجاز هستند'));
                }
            }
        }).single('database');

        upload(req, res, async (err) => {
            if (err) {
                console.error('Upload error:', err);
                return res.status(400).json({ success: false, error: err.message || 'خطا در آپلود فایل' });
            }

            const { dbName } = req.params;
            const userId = req.user && req.user.id;

            if (!userId) {
                const newPath = path.join(__dirname, `${dbName}.db.new`);
                if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
                return res.status(401).json({ success: false, error: 'دسترسی غیرمجاز' });
            }

            // بررسی دسترسی ادمین
            const isAdmin = await checkAdminAccess(parseInt(userId));
            if (!isAdmin) {
                const newPath = path.join(__dirname, `${dbName}.db.new`);
                if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
                return res.status(403).json({ success: false, error: 'شما دسترسی ادمین ندارید' });
            }

            // بررسی نام دیتابیس
            if (dbName !== 'users' && dbName !== 'messages') {
                const newPath = path.join(__dirname, `${dbName}.db.new`);
                if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
                return res.status(400).json({ success: false, error: 'نام دیتابیس نامعتبر است' });
            }

            const dbPath = path.join(__dirname, `${dbName}.db`);
            const newPath = path.join(__dirname, `${dbName}.db.new`);
            const backupPath = path.join(__dirname, `${dbName}.db.backup`);

            try {
                // بررسی اعتبار فایل آپلود شده
                const sqlite3 = require('sqlite3').verbose();
                const testDb = new sqlite3.Database(newPath, sqlite3.OPEN_READONLY, async (openErr) => {
                    if (openErr) {
                        console.error('Invalid database file:', openErr);
                        if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
                        return res.status(400).json({ success: false, error: 'فایل دیتابیس نامعتبر است' });
                    }

                    testDb.close(async (closeErr) => {
                        if (closeErr) {
                            console.error('Error closing test database:', closeErr);
                        }

                        try {
                            // close the current database connection so the file can be replaced
                            if (dbName === 'users') {
                                await closeDatabase();
                                // database.js will clear its own reference; clear module cache as well
                                delete require.cache[require.resolve('./database')];
                                if (global.gc) {
                                    global.gc();
                                    console.log('Forced GC after closeDatabase()');
                                }
                                await new Promise(resolve => setTimeout(resolve, 3000));
                            } else if (dbName === 'messages') {
                                // messages database is handled similarly
                                if (typeof closeMessagesDb === 'function') await closeMessagesDb();
                                // clear module cache so next reload will create new connection
                                delete require.cache[require.resolve('./messages-database')];
                                if (global.gc) {
                                    global.gc();
                                    console.log('Forced GC after closing messages DB');
                                }
                                // wait a bit longer to ensure the file is unlocked on Windows
                                await new Promise(resolve => setTimeout(resolve, 3000));
                            }

                            // کمی صبر کنیم تا اتصالات کاملاً بسته شوند (افزایش تا 2 ثانیه به‌خصوص در ویندوز)
                            await new Promise(resolve => setTimeout(resolve, 2000));

                            // پشتیبان‌گیری از دیتابیس فعلی
                            if (fs.existsSync(dbPath)) {
                                fs.copyFileSync(dbPath, backupPath);
                                console.log(`Backup created: ${backupPath}`);
                            }

                            // helper to unlink with retries on busy error (async)
                            const removeWithRetry = async (file, retries = 50, delay = 200) => {
                                for (let i = 0; i < retries; i++) {
                                    try {
                                        if (fs.existsSync(file)) {
                                            fs.unlinkSync(file);
                                            console.log(`Old database deleted: ${file}`);
                                        }
                                        return;
                                    } catch (err) {
                                        if (err.code === 'EBUSY' || err.code === 'EPERM') {
                                            // file locked, wait and retry (نمایش شمارش نوبت برای دیباگ)
                                            console.log(`unlink busy, retry ${i + 1}/${retries}`);
                                            await new Promise(r => setTimeout(r, delay));
                                            continue;
                                        }
                                        throw err;
                                    }
                                }
                                throw new Error(`Could not delete ${file} (locked)`);
                            };

                            // حذف فایل قدیمی (با تکرار اگر قفل بود)
                            if (fs.existsSync(dbPath)) {
                                await removeWithRetry(dbPath);
                            }

                            // تغییر نام فایل جدید
                            fs.renameSync(newPath, dbPath);
                            console.log(`New database renamed: ${dbPath}`);

                            // پاک کردن cache ماژول‌ها
                            const modulePath = dbName === 'users' ? './database' : './messages-database';
                            const fullPath = path.join(__dirname, modulePath + '.js');
                            delete require.cache[require.resolve(fullPath)];
                            console.log(`Module cache cleared: ${modulePath}`);

                            // بازگشایی اتصال جدید (بارگذاری مجدد ماژول باعث می‌شود فایل جدید باز شود)
                            if (dbName === 'users') {
                                openDatabase();
                            } else {
                                // reload entire module to update function references and open DB
                                reloadMessagesModule();
                                if (typeof openMessagesDb === 'function') openMessagesDb();
                            }
                            console.log(`Database reopened for ${dbName}`);

                            // ارسال پاسخ موفقیت
                            res.json({
                                success: true,
                                message: `دیتابیس ${dbName === 'users' ? 'کاربران' : 'پیام‌ها'} با موفقیت جایگزین شد.\n\nلطفاً صفحه را refresh کنید تا تغییرات اعمال شود.`,
                                reloadPage: true
                            });

                        } catch (replaceError) {
                            console.error('Error replacing database:', replaceError);

                            // بازگردانی از پشتیبان در صورت خطا
                            if (fs.existsSync(backupPath)) {
                                try {
                                    // if the failed replacement left a locked file, try retrying the unlink here too
                                    if (fs.existsSync(dbPath)) {
                                        const removeWithRetry = async (file, retries = 50, delay = 200) => {
                                            for (let i = 0; i < retries; i++) {
                                                try {
                                                    if (fs.existsSync(file)) {
                                                        fs.unlinkSync(file);
                                                    }
                                                    return;
                                                } catch (err) {
                                                    if (err.code === 'EBUSY' || err.code === 'EPERM') {
                                                        console.log(`restore unlink busy, retry ${i + 1}/${retries}`);
                                                        continue;
                                                    }
                                                    throw err;
                                                }
                                            }
                                            throw new Error(`Could not delete ${file} (locked)`);
                                        };
                                        await removeWithRetry(dbPath);
                                    }

                                    fs.copyFileSync(backupPath, dbPath);
                                    console.log('Database restored from backup');

                                    // make sure connection is reopened so server keeps working
                                    if (dbName === 'users') {
                                        delete require.cache[require.resolve('./database')];
                                        openDatabase();
                                    } else if (dbName === 'messages') {
                                        // reload module and open
                                        reloadMessagesModule();
                                        if (typeof openMessagesDb === 'function') openMessagesDb();
                                    }
                                } catch (restoreError) {
                                    console.error('Error restoring backup:', restoreError);
                                }
                            }

                            // حذف فایل جدید
                            if (fs.existsSync(newPath)) {
                                try {
                                    fs.unlinkSync(newPath);
                                } catch (unlinkErr) {
                                    console.error('Error deleting new file:', unlinkErr);
                                }
                            }

                            res.status(500).json({
                                success: false,
                                error: 'خطا در جایگزینی دیتابیس. دیتابیس قبلی بازگردانی شد.'
                            });
                        }
                    });
                });
            } catch (error) {
                console.error('Error validating database:', error);

                if (fs.existsSync(newPath)) {
                    try {
                        fs.unlinkSync(newPath);
                    } catch (unlinkErr) {
                        console.error('Error deleting temp file:', unlinkErr);
                    }
                }

                res.status(500).json({ success: false, error: 'خطا در اعتبارسنجی دیتابیس' });
            }
        });
    } catch (error) {
        console.error('Upload database error:', error);
        res.status(500).json({ success: false, error: error.message || 'خطا در آپلود دیتابیس' });
    }
});

// API برای حذف دیتابیس (فقط برای ادمین)
// توجه: به جای حذف فایل، تمام داده‌های دیتابیس را پاک می‌کند
app.delete('/api/admin/delete-database/:dbName', async (req, res) => {
    try {
        const { dbName } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, error: 'دسترسی غیرمجاز' });
        }

        // بررسی دسترسی ادمین
        const isAdmin = await checkAdminAccess(parseInt(userId));
        if (!isAdmin) {
            return res.status(403).json({ success: false, error: 'شما دسترسی ادمین ندارید' });
        }

        // بررسی نام دیتابیس
        if (dbName !== 'users' && dbName !== 'messages') {
            return res.status(400).json({ success: false, error: 'نام دیتابیس نامعتبر است' });
        }

        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, `${dbName}.db`);

        const fs = require('fs');
        if (!fs.existsSync(dbPath)) {
            return res.status(404).json({ success: false, error: 'دیتابیس یافت نشد' });
        }

        // باز کردن یک اتصال جدید برای پاک کردن داده‌ها
        const tempDb = new sqlite3.Database(dbPath);

        // دریافت لیست تمام جداول
        tempDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], (err, tables) => {
            if (err) {
                console.error('Error getting tables:', err);
                tempDb.close();
                return res.status(500).json({ success: false, error: 'خطا در دریافت لیست جداول' });
            }

            if (tables.length === 0) {
                tempDb.close();
                return res.json({ success: true, message: 'دیتابیس خالی است' });
            }

            // پاک کردن تمام جداول
            let completed = 0;
            let hasError = false;

            tables.forEach(table => {
                tempDb.run(`DELETE FROM ${table.name}`, (deleteErr) => {
                    if (deleteErr && !hasError) {
                        hasError = true;
                        console.error(`Error deleting from ${table.name}:`, deleteErr);
                        tempDb.close();
                        return res.status(500).json({ success: false, error: `خطا در پاک کردن جدول ${table.name}` });
                    }

                    completed++;

                    if (completed === tables.length && !hasError) {
                        // اجرای VACUUM برای کوچک کردن فایل دیتابیس
                        tempDb.run('VACUUM', (vacuumErr) => {
                            tempDb.close();

                            if (vacuumErr) {
                                console.error('Error running VACUUM:', vacuumErr);
                            }

                            res.json({
                                success: true,
                                message: `تمام داده‌های دیتابیس ${dbName === 'users' ? 'کاربران' : 'پیام‌ها'} با موفقیت پاک شد`
                            });
                        });
                    }
                });
            });
        });
    } catch (error) {
        console.error('Delete database error:', error);
        res.status(500).json({ success: false, error: error.message || 'خطا در حذف دیتابیس' });
    }
});

const PORT = process.env.PORT || 3000;

const HOST = '0.0.0.0'; // پذیرش اتصال از همه IP ها
server.listen(PORT, HOST, () => {
    console.log(`سرور روی پورت ${PORT} در حال اجرا است`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
    console.log(`HTTP API: http://localhost:${PORT}`);
    console.log(`\nبرای دسترسی از موبایل:`);
    console.log(`http://192.168.1.100:${PORT}`);
    console.log(`ws://192.168.1.100:${PORT}`);
});
