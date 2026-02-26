const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// silence logs in this module unless DEBUG_LOG=true
const DEBUG_LOG = process.env.DEBUG_LOG === 'true';
if (!DEBUG_LOG) {
    console.log = () => {};
}

const dbPath = path.join(__dirname, 'messages.db');
let messagesDb = new sqlite3.Database(dbPath);

function openMessagesDb() {
    if (!messagesDb) {
        messagesDb = new sqlite3.Database(dbPath, (err) => {
            if (err) console.error('Error reopening messages DB:', err);
            else {
        if (process.env.DEBUG_LOG === 'true') console.log('Messages database reopened');
    }
        });
    }
    return messagesDb;
}

function closeMessagesDb() {
    return new Promise((resolve, reject) => {
        if (!messagesDb) return resolve();
        messagesDb.close((err) => {
            if (err) return reject(err);
            messagesDb = null;
            resolve();
        });
    });
}

function initMessagesDb() {
    messagesDb.serialize(() => {
        // جدول پیام‌های عمومی
        messagesDb.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                message_type TEXT DEFAULT 'group',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        // اگر دیتابیس قدیمی ستون message_type را ندارد، آن را اضافه کن
        messagesDb.all("PRAGMA table_info(messages)", [], (err, cols) => {
            if (!err && !cols.some(c => c.name === 'message_type')) {
                messagesDb.run("ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'group'", (err) => {
                    if (err) console.error('خطا در افزودن ستون message_type:', err.message);
                });
            }
            // برای پیام‌های قبلی که توسط "system" فرستاده شده‌اند، نوع را تنظیم کن
            messagesDb.run("UPDATE messages SET message_type = 'system' WHERE username = 'system'", (err) => {
                if (err) console.error('خطا در به‌روزرسانی پیام‌های سیستم:', err.message);
            });
        });

        // جدول برای ذخیره آخرین پیام خوانده شده هر کاربر در گروه
        messagesDb.run(`
        CREATE TABLE IF NOT EXISTS user_last_read (
            user_id INTEGER PRIMARY KEY,
            last_read_message_id INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

        // جدول برای ردیابی خوانده شدن پیام‌های گروه توسط هر کاربر
        messagesDb.run(`
        CREATE TABLE IF NOT EXISTS group_message_reads (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

        // جدول پیام‌های خصوصی
        messagesDb.run(`
        CREATE TABLE IF NOT EXISTS private_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            sender_username TEXT NOT NULL,
            receiver_id INTEGER NOT NULL,
            receiver_username TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id),
            FOREIGN KEY (receiver_id) REFERENCES users(id)
        )
    `);

        // جدول پیام‌های گروه‌ها و کانال‌های سفارشی
        messagesDb.run(`
        CREATE TABLE IF NOT EXISTS group_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            message TEXT NOT NULL,
            message_type TEXT DEFAULT 'group',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
        // اگر دیتابیس قدیمی ستون message_type را ندارد، آن را اضافه کن
        messagesDb.all("PRAGMA table_info(group_messages)", [], (err, cols) => {
            if (!err && !cols.some(c => c.name === 'message_type')) {
                messagesDb.run("ALTER TABLE group_messages ADD COLUMN message_type TEXT DEFAULT 'group'", (err) => {
                    if (err) console.error('خطا در افزودن ستون message_type به group_messages:', err.message);
                });
                // نوشتن مقادیر اولیه برای پیام‌هایی که ممکن است به صورت سیستمی در جدول باشند
                messagesDb.run("UPDATE group_messages SET message_type = 'system' WHERE username = 'system'", (err) => {
                    if (err) console.error('خطا در به‌روزرسانی پیام‌های گروه با type سیستم:', err.message);
                });
            }
        });

        // جدول برای ذخیره آخرین پیام خوانده شده هر کاربر در هر گروه سفارشی
        messagesDb.run(`
        CREATE TABLE IF NOT EXISTS user_custom_group_last_read (
            user_id INTEGER NOT NULL,
            group_id TEXT NOT NULL,
            last_read_message_id INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, group_id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

        // اضافه کردن ستون is_read اگر وجود نداره
        messagesDb.all("PRAGMA table_info(private_messages)", [], (err, columns) => {
            if (!err) {
                const hasIsRead = columns.some(col => col.name === 'is_read');
                if (!hasIsRead) {
                    messagesDb.run("ALTER TABLE private_messages ADD COLUMN is_read INTEGER DEFAULT 0", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون is_read:', err.message);
                        } else {
                            console.log('ستون is_read با موفقیت اضافه شد');
                        }
                    });
                }
            }
        });

        // اضافه کردن ستون reply_to به جدول messages
        messagesDb.all("PRAGMA table_info(messages)", [], (err, columns) => {
            if (!err) {
                const hasReplyTo = columns.some(col => col.name === 'reply_to');
                if (!hasReplyTo) {
                    messagesDb.run("ALTER TABLE messages ADD COLUMN reply_to TEXT", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون reply_to به messages:', err.message);
                        }
                    });
                }
            }
        });

        // اضافه کردن ستون reply_to به جدول private_messages
        messagesDb.all("PRAGMA table_info(private_messages)", [], (err, columns) => {
            if (!err) {
                const hasReplyTo = columns.some(col => col.name === 'reply_to');
                if (!hasReplyTo) {
                    messagesDb.run("ALTER TABLE private_messages ADD COLUMN reply_to TEXT", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون reply_to به private_messages:', err.message);
                        }
                    });
                }
            }
        });

        // اضافه کردن ستون reply_to به جدول group_messages
        messagesDb.all("PRAGMA table_info(group_messages)", [], (err, columns) => {
            if (!err) {
                const hasReplyTo = columns.some(col => col.name === 'reply_to');
                if (!hasReplyTo) {
                    messagesDb.run("ALTER TABLE group_messages ADD COLUMN reply_to TEXT", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون reply_to به group_messages:', err.message);
                        }
                    });
                }
            }
        });

        // جدول ریکشن‌ها
        messagesDb.run(`
        CREATE TABLE IF NOT EXISTS reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            message_type TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            user_id_text TEXT,
            profile_picture TEXT,
            reaction_type TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(message_id, message_type, user_id, reaction_type),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `, (err) => {
            if (err) {
                console.error('خطا در ایجاد جدول reactions:', err.message);
            }
            // console.log('جدول reactions آماده شد');
        });

        // ایندکس‌های پیشنهادی برای افزایش سرعت
        messagesDb.run(`CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id)`);
        messagesDb.run(`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`);

        messagesDb.run(`CREATE INDEX IF NOT EXISTS idx_private_messages_sender ON private_messages(sender_id)`);
        messagesDb.run(`CREATE INDEX IF NOT EXISTS idx_private_messages_receiver ON private_messages(receiver_id)`);
        messagesDb.run(`CREATE INDEX IF NOT EXISTS idx_private_messages_created_at ON private_messages(created_at)`);

        messagesDb.run(`CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages(group_id)`);
        messagesDb.run(`CREATE INDEX IF NOT EXISTS idx_group_messages_created_at ON group_messages(created_at)`);

        messagesDb.run(`CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id)`);

        console.log('دیتابیس پیام‌ها آماده شد (همراه با ایندکس‌ها)');
    });
} // end initMessagesDb

// ذخیره پیام جدید
function saveMessage(userId, username, message, replyTo = null, messageType = 'group') {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO messages (user_id, username, message, reply_to, message_type) VALUES (?, ?, ?, ?, ?)`;
        messagesDb.run(query, [userId, username, message, replyTo ? JSON.stringify(replyTo) : null, messageType], function (err) {
            if (err) {
                reject({ error: 'خطا در ذخیره پیام' });
            } else {
                resolve({
                    id: this.lastID,
                    userId,
                    username,
                    message,
                    reply_to: replyTo,
                    message_type: messageType,
                    created_at: new Date().toISOString()
                });
            }
        });
    });
}

// دریافت تاریخچه پیام‌ها
function getRecentMessages(limit = 50) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT id, user_id, username, message, reply_to, message_type, created_at 
            FROM messages 
            ORDER BY created_at DESC 
            LIMIT ?
        `;
        messagesDb.all(query, [limit], (err, rows) => {
            if (err) {
                reject({ error: 'خطا در دریافت پیام‌ها' });
            } else {
                // Parse reply_to JSON
                const parsedRows = rows.map(row => ({
                    ...row,
                    reply_to: row.reply_to ? JSON.parse(row.reply_to) : null
                }));
                resolve(parsedRows.reverse());
            }
        });
    });
}

// دریافت پیام‌های یک کاربر خاص
function getUserMessages(userId, limit = 50) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT id, user_id, username, message, message_type, created_at 
            FROM messages 
            WHERE user_id = ?
            ORDER BY created_at DESC 
            LIMIT ?
        `;
        messagesDb.all(query, [userId, limit], (err, rows) => {
            if (err) {
                reject({ error: 'خطا در دریافت پیام‌ها' });
            } else {
                resolve(rows.reverse());
            }
        });
    });
}

// حذف پیام
function deleteMessage(messageId, userId) {
    return new Promise((resolve, reject) => {
        const query = `DELETE FROM messages WHERE id = ? AND user_id = ?`;
        messagesDb.run(query, [messageId, userId], function (err) {
            if (err) {
                reject({ error: 'خطا در حذف پیام' });
            } else if (this.changes === 0) {
                reject({ error: 'پیام یافت نشد یا شما مجاز به حذف آن نیستید' });
            } else {
                resolve({ success: true });
            }
        });
    });
}

// ذخیره پیام خصوصی
function savePrivateMessage(senderId, senderUsername, receiverId, receiverUsername, message, replyTo = null) {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO private_messages (sender_id, sender_username, receiver_id, receiver_username, message, reply_to) VALUES (?, ?, ?, ?, ?, ?)`;
        messagesDb.run(query, [senderId, senderUsername, receiverId, receiverUsername, message, replyTo ? JSON.stringify(replyTo) : null], function (err) {
            if (err) {
                reject({ error: 'خطا در ذخیره پیام خصوصی' });
            } else {
                resolve({
                    id: this.lastID,
                    senderId,
                    senderUsername,
                    receiverId,
                    receiverUsername,
                    message,
                    reply_to: replyTo,
                    created_at: new Date().toISOString()
                });
            }
        });
    });
}

// دریافت پیام‌های خصوصی بین دو کاربر
function getPrivateMessages(userId1, userId2, limit = 50) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT id, sender_id, sender_username, receiver_id, receiver_username, message, is_read, reply_to, created_at 
            FROM private_messages 
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
            ORDER BY created_at DESC 
            LIMIT ?
        `;
        messagesDb.all(query, [userId1, userId2, userId2, userId1, limit], (err, rows) => {
            if (err) {
                reject({ error: 'خطا در دریافت پیام‌های خصوصی' });
            } else {
                // Parse reply_to JSON
                const parsedRows = rows.map(row => ({
                    ...row,
                    reply_to: row.reply_to ? JSON.parse(row.reply_to) : null
                }));
                resolve(parsedRows.reverse());
            }
        });
    });
}

// دریافت لیست چت‌های خصوصی یک کاربر به همراه اطلاعات کاربر و عکس پروفایل (بهینه شده)
function getUserPrivateChats(userId) {
    return new Promise((resolve, reject) => {
        // ابتدا اطلاعات کاربران را از دیتابیس کاربران می‌گیریم (این فایل به دیتابیس کاربران دسترسی مستقیم ندارد، 
        // بنابراین در server.js هندل می‌شود یا از طریق JOIN اگر هر دو در یک دیتابیس بودند.
        // اما چون فایل‌ها جدا هستند، کوئری را طوری می‌زنیم که اطلاعات پایه را برگرداند)

        const query = `
            WITH chat_partners AS (
                SELECT 
                    CASE 
                        WHEN sender_id = ? THEN receiver_id
                        ELSE sender_id
                    END as chat_with_id,
                    CASE 
                        WHEN sender_id = ? THEN receiver_username
                        ELSE sender_username
                    END as chat_with_name,
                    MAX(created_at) as last_message_time
                FROM private_messages
                WHERE sender_id = ? OR receiver_id = ?
                GROUP BY chat_with_id
            )
            SELECT 
                cp.chat_with_name as chat_with,
                cp.chat_with_id,
                cp.last_message_time,
                pm.message as last_message,
                (SELECT COUNT(*) FROM private_messages 
                 WHERE receiver_id = ? AND sender_id = cp.chat_with_id AND is_read = 0) as unread_count
            FROM chat_partners cp
            JOIN private_messages pm ON (
                (pm.sender_id = ? AND pm.receiver_id = cp.chat_with_id) OR
                (pm.receiver_id = ? AND pm.sender_id = cp.chat_with_id)
            ) AND pm.created_at = cp.last_message_time
            ORDER BY cp.last_message_time DESC
        `;
        messagesDb.all(query, [userId, userId, userId, userId, userId, userId, userId], (err, rows) => {
            if (err) {
                console.error('Database error in getUserPrivateChats:', err);
                reject({ error: 'خطا در دریافت لیست چت‌ها' });
            } else {
                resolve(rows);
            }
        });
    });
}

// علامت‌گذاری پیام‌ها به عنوان خوانده شده
function markMessagesAsRead(userId, otherUserId) {
    return new Promise((resolve, reject) => {
        const query = `UPDATE private_messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND is_read = 0`;
        messagesDb.run(query, [userId, otherUserId], function (err) {
            if (err) {
                reject({ error: 'خطا در به‌روزرسانی وضعیت پیام‌ها' });
            } else {
                resolve({ success: true, updated: this.changes });
            }
        });
    });
}

// به‌روزرسانی آخرین پیام خوانده شده کاربر در گروه
function updateLastReadMessage(userId, messageId) {
    return new Promise((resolve, reject) => {
        // ابتدا آخرین پیام خوانده شده را آپدیت کن
        const updateQuery = `INSERT OR REPLACE INTO user_last_read (user_id, last_read_message_id) VALUES (?, ?)`;
        messagesDb.run(updateQuery, [userId, messageId], function (err) {
            if (err) {
                reject({ error: 'خطا در به‌روزرسانی آخرین پیام خوانده شده' });
            } else {
                // سپس تمام پیام‌های گروه تا این ID را به عنوان خوانده شده علامت‌گذاری کن
                const insertQuery = `
                    INSERT OR IGNORE INTO group_message_reads (message_id, user_id)
                    SELECT id, ? FROM messages WHERE id <= ? AND user_id != ?
                `;
                messagesDb.run(insertQuery, [userId, messageId, userId], function (err) {
                    if (err) {
                        console.error('خطا در ثبت خواندن پیام‌های گروه:', err);
                    }
                    resolve({ success: true });
                });
            }
        });
    });
}

// دریافت آخرین پیام خوانده شده کاربر در گروه
function getLastReadMessageId(userId) {
    return new Promise((resolve, reject) => {
        const query = `SELECT last_read_message_id FROM user_last_read WHERE user_id = ?`;
        messagesDb.get(query, [userId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در دریافت آخرین پیام خوانده شده' });
            } else {
                resolve(row ? row.last_read_message_id : 0);
            }
        });
    });
}

// دریافت تعداد پیام‌های خوانده نشده گروه
function getUnreadGroupMessagesCount(userId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT COUNT(*) as unread_count
            FROM messages
            WHERE id > (SELECT COALESCE(last_read_message_id, 0) FROM user_last_read WHERE user_id = ?)
            AND user_id != ?
        `;
        messagesDb.get(query, [userId, userId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در دریافت تعداد پیام‌های خوانده نشده' });
            } else {
                resolve(row.unread_count || 0);
            }
        });
    });
}

// بررسی اینکه آیا پیام گروه توسط حداقل یک نفر (غیر از فرستنده) خوانده شده
function isGroupMessageRead(messageId, senderId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT COUNT(*) as read_count
            FROM group_message_reads
            WHERE message_id = ? AND user_id != ?
        `;
        messagesDb.get(query, [messageId, senderId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در بررسی وضعیت پیام' });
            } else {
                resolve((row.read_count || 0) > 0);
            }
        });
    });
}

// ذخیره پیام گروه/کانال سفارشی
function saveGroupMessage(groupId, userId, username, message, replyTo = null, messageType = 'group') {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO group_messages (group_id, user_id, username, message, reply_to, message_type) VALUES (?, ?, ?, ?, ?, ?)`;
        messagesDb.run(query, [groupId, userId, username, message, replyTo ? JSON.stringify(replyTo) : null, messageType], function (err) {
            if (err) {
                reject({ error: 'خطا در ذخیره پیام گروه' });
            } else {
                resolve({
                    id: this.lastID,
                    groupId,
                    userId,
                    username,
                    message,
                    reply_to: replyTo,
                    message_type: messageType,
                    created_at: new Date().toISOString()
                });
            }
        });
    });
}

// دریافت پیام‌های یک گروه/کانال
function getGroupMessages(groupId, limit = 50) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT id, group_id, user_id, username, message, reply_to, message_type, created_at 
            FROM group_messages 
            WHERE group_id = ?
            ORDER BY created_at DESC 
            LIMIT ?
        `;
        messagesDb.all(query, [groupId, limit], (err, rows) => {
            if (err) {
                reject({ error: 'خطا در دریافت پیام‌های گروه' });
            } else {
                // Parse reply_to JSON
                const parsedRows = rows.map(row => ({
                    ...row,
                    reply_to: row.reply_to ? JSON.parse(row.reply_to) : null
                }));
                resolve(parsedRows.reverse());
            }
        });
    });
}

// دریافت پیام‌های گروه قدیمی‌تر (قبل از یک پیام خاص)
function getGroupMessagesBeforeId(groupId, beforeId, limit = 50) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT id, group_id, user_id, username, message, reply_to, message_type, created_at 
            FROM group_messages 
            WHERE group_id = ? AND id < ?
            ORDER BY created_at DESC 
            LIMIT ?
        `;
        messagesDb.all(query, [groupId, beforeId, limit], (err, rows) => {
            if (err) {
                reject({ error: 'خطا در دریافت پیام‌های گروه' });
            } else {
                // Parse reply_to JSON
                const parsedRows = rows.map(row => ({
                    ...row,
                    reply_to: row.reply_to ? JSON.parse(row.reply_to) : null
                }));
                resolve(parsedRows.reverse());
            }
        });
    });
}

// علامت‌گذاری پیام‌های گروه سفارشی به عنوان خوانده شده
function updateCustomGroupLastRead(userId, groupId, messageId) {
    return new Promise((resolve, reject) => {
        const query = `
            INSERT INTO user_custom_group_last_read (user_id, group_id, last_read_message_id, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, group_id) 
            DO UPDATE SET last_read_message_id = ?, updated_at = CURRENT_TIMESTAMP
        `;
        messagesDb.run(query, [userId, groupId, messageId, messageId], function (err) {
            if (err) {
                reject({ error: 'خطا در به‌روزرسانی وضعیت خواندن' });
            } else {
                resolve({ success: true });
            }
        });
    });
}

// دریافت آخرین پیام خوانده شده کاربر در گروه سفارشی
function getCustomGroupLastReadMessageId(userId, groupId) {
    return new Promise((resolve, reject) => {
        const query = `SELECT last_read_message_id FROM user_custom_group_last_read WHERE user_id = ? AND group_id = ?`;
        messagesDb.get(query, [userId, groupId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در دریافت آخرین پیام خوانده شده' });
            } else {
                resolve(row ? row.last_read_message_id : 0);
            }
        });
    });
}

// دریافت تعداد پیام‌های خوانده نشده یک گروه سفارشی
function getCustomGroupUnreadCount(userId, groupId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT COUNT(*) as unread_count
            FROM group_messages gm
            LEFT JOIN user_custom_group_last_read lr 
                ON lr.user_id = ? AND lr.group_id = ?
            WHERE gm.group_id = ?
                AND gm.user_id != ?
                AND (lr.last_read_message_id IS NULL OR gm.id > lr.last_read_message_id)
        `;
        messagesDb.get(query, [userId, groupId, groupId, userId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در دریافت تعداد پیام‌های خوانده نشده' });
            } else {
                resolve(row.unread_count || 0);
            }
        });
    });
}

// بررسی اینکه آیا پیام گروه سفارشی خوانده شده یا نه (توسط حداقل یک نفر غیر از فرستنده)
function isCustomGroupMessageRead(messageId, groupId, senderId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT COUNT(*) as read_count
            FROM user_custom_group_last_read
            WHERE group_id = ? AND user_id != ? AND last_read_message_id >= ?
        `;
        messagesDb.get(query, [groupId, senderId, messageId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در بررسی وضعیت خواندن' });
            } else {
                resolve((row.read_count || 0) > 0);
            }
        });
    });
}

// تابع کمکی برای به‌روزرسانی نام کاربری در JSON reply_to
function updateReplyToUsername(replyToJson, userId, newUsername) {
    if (!replyToJson) return null;

    try {
        const replyTo = typeof replyToJson === 'string' ? JSON.parse(replyToJson) : replyToJson;

        // اگر نام کاربری در reply_to متعلق به این کاربر است، آن را به‌روزرسانی کن
        if (replyTo.username) {
            // ما نمی‌دانیم userId در reply_to ذخیره شده یا نه، بنابراین فقط بر اساس نام کاربری قدیم بررسی می‌کنیم
            // اما این روش ایمن نیست. بهتر است userId را هم ذخیره کنیم
            // برای اکنون، فرض می‌کنیم که اگر نام کاربری تغییر کرد، باید در reply_to هم تغییر کند
        }

        return JSON.stringify(replyTo);
    } catch (e) {
        return replyToJson;
    }
}

// به‌روزرسانی نام کاربری در تمام پیام‌ها
function updateUsernameInMessages(userId, oldUsername, newUsername) {
    return new Promise((resolve, reject) => {
        // ابتدا تمام پیام‌های عمومی را دریافت کن
        messagesDb.all(
            `SELECT id, reply_to FROM messages WHERE reply_to IS NOT NULL`,
            function (err, rows) {
                if (err) {
                    reject({ error: 'خطا در دریافت پیام‌های عمومی' });
                    return;
                }

                // به‌روزرسانی نام کاربری در پیام‌های عمومی (پیام‌های فرستاده شده توسط این کاربر)
                messagesDb.run(
                    `UPDATE messages SET username = ? WHERE user_id = ?`,
                    [newUsername, userId],
                    function (err) {
                        if (err) {
                            reject({ error: 'خطا در به‌روزرسانی پیام‌های عمومی' });
                        } else {
                            // به‌روزرسانی reply_to در تمام پیام‌های عمومی (فقط نام کاربری قدیم)
                            if (rows && rows.length > 0) {
                                let completed = 0;
                                rows.forEach(row => {
                                    if (row.reply_to) {
                                        try {
                                            const replyTo = JSON.parse(row.reply_to);
                                            // فقط اگر نام کاربری در reply_to برابر با نام قدیم است، آن را تغییر دهید
                                            if (replyTo.username === oldUsername) {
                                                replyTo.username = newUsername;
                                                messagesDb.run(
                                                    `UPDATE messages SET reply_to = ? WHERE id = ?`,
                                                    [JSON.stringify(replyTo), row.id],
                                                    function (err) {
                                                        completed++;
                                                        if (completed === rows.length) {
                                                            updatePrivateMessages();
                                                        }
                                                    }
                                                );
                                            } else {
                                                completed++;
                                                if (completed === rows.length) {
                                                    updatePrivateMessages();
                                                }
                                            }
                                        } catch (e) {
                                            completed++;
                                            if (completed === rows.length) {
                                                updatePrivateMessages();
                                            }
                                        }
                                    } else {
                                        completed++;
                                        if (completed === rows.length) {
                                            updatePrivateMessages();
                                        }
                                    }
                                });
                            } else {
                                updatePrivateMessages();
                            }
                        }
                    }
                );

                function updatePrivateMessages() {
                    // به‌روزرسانی پیام‌های خصوصی (فرستنده)
                    messagesDb.run(
                        `UPDATE private_messages SET sender_username = ? WHERE sender_id = ?`,
                        [newUsername, userId],
                        function (err) {
                            if (err) {
                                reject({ error: 'خطا در به‌روزرسانی پیام‌های خصوصی فرستنده' });
                            } else {
                                // به‌روزرسانی پیام‌های خصوصی (گیرنده)
                                messagesDb.run(
                                    `UPDATE private_messages SET receiver_username = ? WHERE receiver_id = ?`,
                                    [newUsername, userId],
                                    function (err) {
                                        if (err) {
                                            reject({ error: 'خطا در به‌روزرسانی پیام‌های خصوصی گیرنده' });
                                        } else {
                                            // به‌روزرسانی reply_to در پیام‌های خصوصی
                                            messagesDb.all(
                                                `SELECT id, reply_to FROM private_messages WHERE reply_to IS NOT NULL`,
                                                function (err, privateRows) {
                                                    if (err || !privateRows) {
                                                        updateGroupMessages();
                                                        return;
                                                    }

                                                    let completed = 0;
                                                    privateRows.forEach(row => {
                                                        if (row.reply_to) {
                                                            try {
                                                                const replyTo = JSON.parse(row.reply_to);
                                                                if (replyTo.username === oldUsername) {
                                                                    replyTo.username = newUsername;
                                                                    messagesDb.run(
                                                                        `UPDATE private_messages SET reply_to = ? WHERE id = ?`,
                                                                        [JSON.stringify(replyTo), row.id],
                                                                        function (err) {
                                                                            completed++;
                                                                            if (completed === privateRows.length) {
                                                                                updateGroupMessages();
                                                                            }
                                                                        }
                                                                    );
                                                                } else {
                                                                    completed++;
                                                                    if (completed === privateRows.length) {
                                                                        updateGroupMessages();
                                                                    }
                                                                }
                                                            } catch (e) {
                                                                completed++;
                                                                if (completed === privateRows.length) {
                                                                    updateGroupMessages();
                                                                }
                                                            }
                                                        } else {
                                                            completed++;
                                                            if (completed === privateRows.length) {
                                                                updateGroupMessages();
                                                            }
                                                        }
                                                    });

                                                    if (!privateRows || privateRows.length === 0) {
                                                        updateGroupMessages();
                                                    }
                                                }
                                            );
                                        }
                                    }
                                );
                            }
                        }
                    );
                }

                function updateGroupMessages() {
                    // به‌روزرسانی پیام‌های گروه/کانال
                    messagesDb.run(
                        `UPDATE group_messages SET username = ? WHERE user_id = ?`,
                        [newUsername, userId],
                        function (err) {
                            if (err) {
                                reject({ error: 'خطا در به‌روزرسانی پیام‌های گروه' });
                            } else {
                                // به‌روزرسانی reply_to در پیام‌های گروه
                                messagesDb.all(
                                    `SELECT id, reply_to FROM group_messages WHERE reply_to IS NOT NULL`,
                                    function (err, groupRows) {
                                        if (err || !groupRows) {
                                            resolve({ success: true });
                                            return;
                                        }

                                        let completed = 0;
                                        groupRows.forEach(row => {
                                            if (row.reply_to) {
                                                try {
                                                    const replyTo = JSON.parse(row.reply_to);
                                                    if (replyTo.username === oldUsername) {
                                                        replyTo.username = newUsername;
                                                        messagesDb.run(
                                                            `UPDATE group_messages SET reply_to = ? WHERE id = ?`,
                                                            [JSON.stringify(replyTo), row.id],
                                                            function (err) {
                                                                completed++;
                                                                if (completed === groupRows.length) {
                                                                    resolve({ success: true });
                                                                }
                                                            }
                                                        );
                                                    } else {
                                                        completed++;
                                                        if (completed === groupRows.length) {
                                                            resolve({ success: true });
                                                        }
                                                    }
                                                } catch (e) {
                                                    completed++;
                                                    if (completed === groupRows.length) {
                                                        resolve({ success: true });
                                                    }
                                                }
                                            } else {
                                                completed++;
                                                if (completed === groupRows.length) {
                                                    resolve({ success: true });
                                                }
                                            }
                                        });

                                        if (!groupRows || groupRows.length === 0) {
                                            resolve({ success: true });
                                        }
                                    }
                                );
                            }
                        }
                    );
                }
            }
        );
    });
}

// اضافه کردن ریکشن
function addReaction(messageId, messageType, userId, username, userIdText, profilePicture, reactionType) {
    return new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString();
        const query = `INSERT OR IGNORE INTO reactions (message_id, message_type, user_id, username, user_id_text, profile_picture, reaction_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        messagesDb.run(query, [messageId, messageType, userId, username, userIdText, profilePicture, reactionType, timestamp], function (err) {
            if (err) {
                reject({ error: 'خطا در ذخیره ریکشن' });
            } else {
                resolve({
                    success: true,
                    messageId,
                    messageType,
                    userId,
                    username,
                    userIdText,
                    profilePicture,
                    reactionType,
                    created_at: timestamp
                });
            }
        });
    });
}

// حذف ریکشن
function removeReaction(messageId, messageType, userId, reactionType) {
    return new Promise((resolve, reject) => {
        const query = `DELETE FROM reactions WHERE message_id = ? AND message_type = ? AND user_id = ? AND reaction_type = ?`;
        messagesDb.run(query, [messageId, messageType, userId, reactionType], function (err) {
            if (err) {
                reject({ error: 'خطا در حذف ریکشن' });
            } else {
                resolve({ success: true, deleted: this.changes });
            }
        });
    });
}

// دریافت ریکشن‌های یک پیام
function getMessageReactions(messageId, messageType) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT user_id, username, user_id_text as userid, profile_picture, reaction_type, created_at as timestamp
            FROM reactions 
            WHERE message_id = ? AND message_type = ?
            ORDER BY created_at ASC
        `;
        messagesDb.all(query, [messageId, messageType], (err, rows) => {
            if (err) {
                reject({ error: 'خطا در دریافت ریکشن‌ها' });
            } else {
                resolve(rows || []);
            }
        });
    });
}

// دریافت ریکشن‌های چند پیام
function getMessagesReactions(messageIds, messageType) {
    return new Promise((resolve, reject) => {
        if (!messageIds || messageIds.length === 0) {
            resolve({});
            return;
        }

        const placeholders = messageIds.map(() => '?').join(',');
        const query = `
            SELECT message_id, user_id, username, user_id_text as userid, profile_picture, reaction_type, created_at as timestamp
            FROM reactions 
            WHERE message_id IN (${placeholders}) AND message_type = ?
            ORDER BY created_at ASC
        `;

        messagesDb.all(query, [...messageIds, messageType], (err, rows) => {
            if (err) {
                reject({ error: 'خطا در دریافت ریکشن‌ها' });
            } else {
                // گروه‌بندی ریکشن‌ها بر اساس message_id
                const reactionsByMessage = {};
                rows.forEach(row => {
                    if (!reactionsByMessage[row.message_id]) {
                        reactionsByMessage[row.message_id] = [];
                    }
                    reactionsByMessage[row.message_id].push({
                        username: row.username,
                        userid: row.userid,
                        profile_picture: row.profile_picture,
                        reaction_type: row.reaction_type,
                        timestamp: row.timestamp
                    });
                });
                resolve(reactionsByMessage);
            }
        });
    });
}

// initialize database once
initMessagesDb();

module.exports = {
    messagesDb,
    saveMessage,
    // helpers for dynamic reopening
    closeMessagesDb,
    openMessagesDb,
    getRecentMessages,
    getUserMessages,
    deleteMessage,
    savePrivateMessage,
    getPrivateMessages,
    getUserPrivateChats,
    markMessagesAsRead,
    updateLastReadMessage,
    getLastReadMessageId,
    getUnreadGroupMessagesCount,
    isGroupMessageRead,
    saveGroupMessage,
    getGroupMessages,
    getGroupMessagesBeforeId,
    updateCustomGroupLastRead,
    getCustomGroupLastReadMessageId,
    getCustomGroupUnreadCount,
    isCustomGroupMessageRead,
    updateUsernameInMessages,
    addReaction,
    removeReaction,
    getMessageReactions,
    getMessagesReactions
};
