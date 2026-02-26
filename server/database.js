const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

// number of salt rounds for hashing passwords
const SALT_ROUNDS = 10;

const dbPath = path.join(__dirname, 'users.db');
// use let so we can replace connection later
let db = new sqlite3.Database(dbPath);

// helper to (re)open database, returns current connection
function openDatabase() {
    if (!db) {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) console.error('Error reopening users database:', err);
            else console.log('Users database reopened');
        });
    }
    return db;
}

// close connection and clear variable
function closeDatabase() {
    return new Promise((resolve, reject) => {
        if (!db) return resolve();
        db.close((err) => {
            if (err) return reject(err);
            db = null;
            resolve();
        });
    });
}

// Debug logger: enable by setting environment variable DEBUG_LOG=true
const DEBUG_LOG = process.env.DEBUG_LOG === 'true';
function debugLog(...args) { if (DEBUG_LOG) console.log(...args); }

// the initialization logic is wrapped so we can call it again when the file is reopened
function initDatabase() {
    // ایجاد جدول کاربران
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                email TEXT,
                google_id TEXT UNIQUE,
                user_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // ایجاد جدول تنظیمات گروه‌ها
        db.run(`
            CREATE TABLE IF NOT EXISTS group_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT UNIQUE NOT NULL,
                group_name TEXT NOT NULL,
                group_userid TEXT UNIQUE,
                profile_picture TEXT,
                admin_email TEXT,
                group_type TEXT DEFAULT 'group',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // ایجاد جدول عضویت کاربران در گروه‌ها
        db.run(`
            CREATE TABLE IF NOT EXISTS group_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, user_id)
            )
        `);
        
        // جدول جدید برای نگهداری لیست ادمین‌های هر گروه/کانال
        db.run(`
            CREATE TABLE IF NOT EXISTS group_admins (
                group_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                PRIMARY KEY (group_id, user_id)
            )
        `);

        // جدول محرومیت کاربران از گروه عمومی
        db.run(`
            CREATE TABLE IF NOT EXISTS global_bans (
                user_id INTEGER PRIMARY KEY
            )
        `);
        
        // جدول محرومیت کاربران از گروه‌های سفارشی
        db.run(`
            CREATE TABLE IF NOT EXISTS group_bans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, user_id)
            )
        `);
        
        // مهاجرت داده‌های ادمین‌تکی قبلی به جدول جدید (اگر کاربر با آن ایمیل وجود داشته باشد)
        db.run(`
            INSERT OR IGNORE INTO group_admins (group_id, user_id)
            SELECT gs.group_id, u.id
            FROM group_settings gs
            JOIN users u ON u.email = gs.admin_email
            WHERE gs.admin_email IS NOT NULL
        `);
        
        // اضافه کردن ستون‌های جدید اگر وجود ندارند
        db.all("PRAGMA table_info(group_settings)", [], (err, columns) => {
            if (!err) {
                const hasGroupUserid = columns.some(col => col.name === 'group_userid');
                const hasGroupType = columns.some(col => col.name === 'group_type');
                const hasDescription = columns.some(col => col.name === 'description');
                
                if (!hasGroupUserid) {
                    db.run("ALTER TABLE group_settings ADD COLUMN group_userid TEXT", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون group_userid:', err.message);
                        } else {
                            console.log('ستون group_userid با موفقیت اضافه شد');
                            // بعد از اضافه کردن ستون، آیدی گروه عمومی را آپدیت کن
                            db.run(
                                "UPDATE group_settings SET group_userid = 'publik_grup' WHERE group_id = 'global'",
                                (err) => {
                                    if (err) {
                                        console.log('خطا در آپدیت آیدی گروه عمومی:', err.message);
                                    } else {
                                        console.log('آیدی گروه عمومی با موفقیت تنظیم شد');
                                    }
                                }
                            );
                        }
                    });
                }
                
                if (!hasGroupType) {
                    db.run("ALTER TABLE group_settings ADD COLUMN group_type TEXT DEFAULT 'group'", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون group_type:', err.message);
                        } else {
                            console.log('ستون group_type با موفقیت اضافه شد');
                            // بعد از اضافه کردن ستون، نوع گروه عمومی را آپدیت کن
                            db.run(
                                "UPDATE group_settings SET group_type = 'group' WHERE group_id = 'global'",
                                (err) => {
                                    if (err) {
                                        console.log('خطا در آپدیت نوع گروه عمومی:', err.message);
                                    } else {
                                        console.log('نوع گروه عمومی با موفقیت تنظیم شد');
                                    }
                                }
                            );
                        }
                    });
                }
                
                if (!hasDescription) {
                    db.run("ALTER TABLE group_settings ADD COLUMN description TEXT", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون description:', err.message);
                        }
                    });
                }
            }
        });
        
        // اضافه کردن گروه عمومی اگر وجود نداره
        db.get("SELECT * FROM group_settings WHERE group_id = 'global'", [], (err, row) => {
            if (!err && !row) {
                // گروه وجود نداره، ایجاد کن
                db.run(
                    "INSERT INTO group_settings (group_id, group_name, admin_email) VALUES ('global', 'گروه عمومی', 'kiaarashabdolahi@gmail.com')",
                    (err) => {
                        if (err) {
                            console.log('خطا در ایجاد گروه عمومی:', err.message);
                        } else {
                            // بعد از ایجاد، آیدی و نوع را تنظیم کن (اگر ستون‌ها وجود داشته باشند)
                            setTimeout(() => {
                                db.run(
                                    "UPDATE group_settings SET group_userid = 'publik_grup', group_type = 'group' WHERE group_id = 'global'",
                                    (err) => {
                                        // آیدی و نوع گروه عمومی تنظیم شد
                                    }
                                );
                            }, 500);
                        }
                    }
                );
            }
        });
        
        // اضافه کردن ستون user_id اگر وجود نداره (برای دیتابیس‌های قدیمی)
        db.all("PRAGMA table_info(users)", [], (err, columns) => {
            if (!err) {
                const hasUserId = columns.some(col => col.name === 'user_id');
                if (!hasUserId) {
                    db.run("ALTER TABLE users ADD COLUMN user_id TEXT", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون user_id:', err.message);
                        } else {
                            console.log('ستون user_id با موفقیت اضافه شد');
                            // اضافه کردن index UNIQUE برای user_id
                            db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_id ON users(user_id)", (err) => {
                                if (err) {
                                    console.error('خطا در ایجاد index برای user_id:', err.message);
                                }
                                // console.log('Index UNIQUE برای user_id ایجاد شد');
                            });
                        }
                    });
                } else {
                    // اگر ستون وجود داره، فقط index رو چک کن
                    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_id ON users(user_id)", (err) => {
                        // if (!err) {
                        //     console.log('Index UNIQUE برای user_id تأیید شد');
                        // }
                    });
                }
                
                const hasProfilePicture = columns.some(col => col.name === 'profile_picture');
                if (!hasProfilePicture) {
                    db.run("ALTER TABLE users ADD COLUMN profile_picture TEXT", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون profile_picture:', err.message);
                        }
                    });
                }
                
                const hasBio = columns.some(col => col.name === 'bio');
                if (!hasBio) {
                    db.run("ALTER TABLE users ADD COLUMN bio TEXT", (err) => {
                        if (err) {
                            console.log('خطا در اضافه کردن ستون bio:', err.message);
                        }
                    });
                }
            }
        });
        
        // چک کردن تعداد کاربران
        db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
            // if (!err) {
            //     console.log(`تعداد کاربران در دیتابیس: ${row.count}`);
            // }
        });
        
        console.log('دیتابیس آماده شد');
    });
}

// run initialization once now
initDatabase();

// ثبت‌نام کاربر جدید
async function registerUser(username, password, email = null, googleId = null, userid = null) {
    return new Promise(async (resolve, reject) => {
        try {
            const hashed = await bcrypt.hash(password, SALT_ROUNDS);
            const query = `INSERT INTO users (username, password, email, google_id, user_id) VALUES (?, ?, ?, ?, ?)`;
            db.run(query, [username, hashed, email, googleId, userid], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        if (err.message.includes('username')) {
                            reject({ error: 'این نام کاربری قبلا ثبت شده است' });
                        } else if (err.message.includes('user_id')) {
                            reject({ error: 'این آیدی قبلا ثبت شده است' });
                        } else {
                            reject({ error: 'این اطلاعات قبلا ثبت شده است' });
                        }
                    } else {
                        reject({ error: 'خطا در ثبت‌نام' });
                    }
                } else {
                    resolve({ id: this.lastID, username, userid });
                }
            });
        } catch (e) {
            reject({ error: 'خطا در هش کردن رمز عبور' });
        }
    });
}

// ورود کاربر (با نام کاربری یا آیدی)
function loginUser(usernameOrUserid, password) {
    return new Promise((resolve, reject) => {
        // جستجو فقط با نام کاربری یا آیدی، سپس مقایسه هش
        const query = `SELECT * FROM users WHERE username = ? OR user_id = ?`;
        db.get(query, [usernameOrUserid, usernameOrUserid], async (err, row) => {
            if (err) {
                return reject({ error: 'خطا در ورود' });
            }
            if (!row) {
                return reject({ error: 'نام کاربری/آیدی یا رمز عبور اشتباه است' });
            }
            try {
                let match;
                // تشخیص اینکه رمز از قبل هش شده است یا خیر
                const isHashed = typeof row.password === 'string' && row.password.startsWith('$2');
                if (isHashed) {
                    match = await bcrypt.compare(password, row.password);
                } else {
                    // رمز قدیمی به صورت ساده ذخیره شده، ابتدا مقایسه مستقیم
                    match = password === row.password;
                    if (match) {
                        // اگر درست بود، رمز جدید را هش و ذخیره کن تا پایگاه داده امن شود
                        const newHash = await bcrypt.hash(password, SALT_ROUNDS);
                        db.run(`UPDATE users SET password = ? WHERE id = ?`, [newHash, row.id], err => {
                            if (err) console.error('Error migrating plaintext password for user', row.id, err);
                        });
                    }
                }

                if (!match) {
                    return reject({ error: 'نام کاربری/آیدی یا رمز عبور اشتباه است' });
                }
                resolve({ id: row.id, username: row.username, email: row.email, user_id: row.user_id, profile_picture: row.profile_picture, bio: row.bio });
            } catch (e) {
                reject({ error: 'خطا در بررسی رمز عبور' });
            }
        });
    });
}

// ورود با گوگل
function loginWithGoogle(googleId, username, email) {
    return new Promise((resolve, reject) => {
        // بررسی وجود کاربر با google_id
        db.get(`SELECT * FROM users WHERE google_id = ?`, [googleId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در ورود' });
            } else if (row) {
                // کاربر وجود دارد
                resolve({ 
                    id: row.id, 
                    username: row.username, 
                    email: row.email, 
                    user_id: row.user_id, 
                    profile_picture: row.profile_picture, 
                    bio: row.bio,
                    password: row.password // برای چک کردن اینکه آیا رمز تنظیم شده یا نه
                });
            } else {
                // ثبت کاربر جدید
                const query = `INSERT INTO users (username, password, email, google_id) VALUES (?, ?, ?, ?)`;
                db.run(query, [username, 'google_auth', email, googleId], function(err) {
                    if (err) {
                        reject({ error: 'خطا در ثبت‌نام' });
                    } else {
                        resolve({ 
                            id: this.lastID, 
                            username, 
                            email, 
                            user_id: null, 
                            profile_picture: null, 
                            bio: null,
                            password: 'google_auth'
                        });
                    }
                });
            }
        });
    });
}

// تنظیم رمز عبور برای کاربر
function setupUserPassword(userId, password) {
    return new Promise(async (resolve, reject) => {
        try {
            const hashed = await bcrypt.hash(password, SALT_ROUNDS);
            const query = `UPDATE users SET password = ? WHERE id = ?`;
            db.run(query, [hashed, userId], function(err) {
                if (err) {
                    reject({ error: 'خطا در تنظیم رمز عبور' });
                } else if (this.changes === 0) {
                    reject({ error: 'کاربر یافت نشد' });
                } else {
                    resolve({ success: true });
                }
            });
        } catch (e) {
            reject({ error: 'خطا در هش کردن رمز عبور' });
        }
    });
}

// تغییر رمز عبور کاربر با اعتبارسنجی پیشرفته
async function changeUserPassword(userId, currentPassword, newPassword) {
    console.log('changeUserPassword called with userId:', userId);
    
    // اعتبارسنجی ورودی‌ها
    if (!userId || !currentPassword || !newPassword) {
        console.log('Validation failed: missing fields');
        throw { error: 'اطلاعات ناقص است' };
    }

    if (newPassword.length < 4) {
        console.log('Validation failed: password too short');
        throw { error: 'رمز عبور جدید باید حداقل 4 کاراکتر باشد' };
    }

    if (newPassword.length > 50) {
        console.log('Validation failed: password too long');
        throw { error: 'رمز عبور جدید نباید بیشتر از 50 کاراکتر باشد' };
    }

    if (currentPassword === newPassword) {
        console.log('Validation failed: passwords are the same');
        throw { error: 'رمز عبور جدید نمی‌تواند با رمز فعلی یکسان باشد' };
    }

    console.log('Fetching user from database...');
    // بررسی رمز عبور فعلی
    const user = await new Promise((resolve, reject) => {
        db.get(`SELECT id, password FROM users WHERE id = ?`, [userId], (err, row) => {
            if (err) {
                console.error('Database error fetching user:', err);
                reject({ error: 'خطا در بررسی اطلاعات کاربر' });
            } else {
                console.log('User found:', !!row);
                resolve(row);
            }
        });
    });
    
    if (!user) {
        console.log('User not found');
        throw { error: 'کاربر یافت نشد' };
    }

    console.log('Verifying current password...');
    // بررسی رمز عبور فعلی
    let match;
    try {
        const isHashed = typeof user.password === 'string' && user.password.startsWith('$2');
        console.log('Password is hashed:', isHashed);
        
        if (isHashed) {
            match = await bcrypt.compare(currentPassword, user.password);
        } else {
            match = currentPassword === user.password;
            if (match) {
                console.log('Migrating plaintext password to hash...');
                // migrate old plaintext password immediately
                const newHash = await bcrypt.hash(currentPassword, SALT_ROUNDS);
                await new Promise((resolve, reject) => {
                    db.run(`UPDATE users SET password = ? WHERE id = ?`, [newHash, userId], (err) => {
                        if (err) {
                            console.error('Error migrating password:', err);
                            reject(err);
                        } else {
                            console.log('Password migrated successfully');
                            resolve();
                        }
                    });
                });
            }
        }
        
        console.log('Password match:', match);
        
        if (!match) {
            throw { error: 'رمز عبور فعلی اشتباه است' };
        }
    } catch (err) {
        console.error('Error verifying password:', err);
        if (err.error) throw err;
        throw { error: 'خطا در بررسی رمز عبور فعلی' };
    }

    console.log('Hashing new password...');
    // هش کردن رمز جدید و به‌روزرسانی
    let hashedNew;
    try {
        hashedNew = await bcrypt.hash(newPassword, SALT_ROUNDS);
        console.log('New password hashed successfully');
    } catch (err) {
        console.error('Error hashing new password:', err);
        throw { error: 'خطا در هش کردن رمز عبور جدید' };
    }
    
    console.log('Updating password in database...');
    const result = await new Promise((resolve, reject) => {
        db.run(
            `UPDATE users SET password = ? WHERE id = ?`,
            [hashedNew, userId],
            function(err) {
                if (err) {
                    console.error('Database error updating password:', err);
                    reject({ error: 'خطا در تغییر رمز عبور' });
                } else if (this.changes === 0) {
                    console.log('No rows updated');
                    reject({ error: 'تغییر رمز عبور انجام نشد' });
                } else {
                    console.log('Password updated successfully, rows changed:', this.changes);
                    resolve({ success: true, message: 'رمز عبور با موفقیت تغییر یافت' });
                }
            }
        );
    });
    
    return result;
}

// دریافت اطلاعات کاربر
function getUserById(id) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT id, username, email, profile_picture, bio FROM users WHERE id = ?`, [id], (err, row) => {
            if (err) reject({ error: 'خطا در دریافت اطلاعات' });
            else resolve(row);
        });
    });
}

// جستجوی کاربر با نام کاربری یا آیدی
function searchUserByUsernameOrId(query) {
    return new Promise((resolve, reject) => {
        const lowerQuery = query.toLowerCase();
        debugLog('Searching for:', lowerQuery);
        
        db.get(
            `SELECT id, username, email, user_id, profile_picture, bio FROM users 
             WHERE LOWER(username) = ? OR LOWER(user_id) = ?`,
            [lowerQuery, lowerQuery],
            (err, row) => {
                if (err) {
                    console.error('Database error:', err);
                    reject({ error: 'خطا در جستجو' });
                } else if (!row) {
                    // لیست تمام کاربران برای debug
                    db.all('SELECT username, user_id FROM users', [], (err2, rows) => {
                        if (!err2) {
                            debugLog('Available users:', rows);
                        }
                    });
                    reject({ error: 'کاربر یافت نشد' });
                } else {
                    debugLog('Found user:', row);
                    resolve({ 
                        type: 'user',
                        id: row.id, 
                        username: row.username, 
                        email: row.email, 
                        user_id: row.user_id, 
                        profile_picture: row.profile_picture,
                        bio: row.bio
                    });
                }
            }
        );
    });
}

// جستجوی جامع (کاربر، گروه، کانال)
function searchAll(query) {
    return new Promise((resolve, reject) => {
        const lowerQuery = query.toLowerCase();
        // console.log('Searching all for:', lowerQuery);
        
        // ابتدا در گروه‌ها و کانال‌ها جستجو کن
        db.get(
            `SELECT group_id, group_name, group_userid, profile_picture, group_type FROM group_settings 
             WHERE LOWER(group_userid) = ?`,
            [lowerQuery],
            (err, groupRow) => {
                if (err) {
                    console.error('Database error:', err);
                    reject({ error: 'خطا در جستجو' });
                } else if (groupRow) {
                    // console.log('Found group/channel:', groupRow);
                    resolve({
                        type: groupRow.group_type || 'group',
                        id: groupRow.group_id,
                        name: groupRow.group_name,
                        userid: groupRow.group_userid,
                        profile_picture: groupRow.profile_picture
                    });
                } else {
                    // اگر در گروه‌ها پیدا نشد، در کاربران جستجو کن
                    db.get(
                        `SELECT id, username, email, user_id, profile_picture, bio FROM users 
                         WHERE LOWER(username) = ? OR LOWER(user_id) = ?`,
                        [lowerQuery, lowerQuery],
                        (err2, userRow) => {
                            if (err2) {
                                console.error('Database error:', err2);
                                reject({ error: 'خطا در جستجو' });
                            } else if (userRow) {
                                debugLog('Found user:', userRow);
                                resolve({
                                    type: 'user',
                                    id: userRow.id,
                                    username: userRow.username,
                                    email: userRow.email,
                                    user_id: userRow.user_id,
                                    profile_picture: userRow.profile_picture,
                                    bio: userRow.bio
                                });
                            } else {
                                reject({ error: 'کاربر، گروه یا کانال یافت نشد' });
                            }
                        }
                    );
                }
            }
        );
    });
}

// دریافت تمام کاربران
function getAllUsers() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT id, username, email, created_at FROM users`, [], (err, rows) => {
            if (err) reject({ error: 'خطا در دریافت لیست کاربران' });
            else resolve(rows);
        });
    });
}

// آپدیت آیدی کاربری
function updateUserId(userId, newUserId) {
    return new Promise((resolve, reject) => {
        // بررسی یونیک بودن آیدی
        db.get(`SELECT id FROM users WHERE user_id = ? AND id != ?`, [newUserId, userId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در بررسی آیدی' });
            } else if (row) {
                reject({ error: 'این آیدی قبلا استفاده شده است' });
            } else {
                // آپدیت آیدی
                db.run(`UPDATE users SET user_id = ? WHERE id = ?`, [newUserId, userId], function(err) {
                    if (err) {
                        reject({ error: 'خطا در ذخیره آیدی' });
                    } else {
                        resolve({ success: true, user_id: newUserId });
                    }
                });
            }
        });
    });
}

// آپدیت نام کاربری
function updateUsername(userId, newUsername) {
    return new Promise((resolve, reject) => {
        // ابتدا نام کاربری قدیم را دریافت کن
        db.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در دریافت نام کاربری قدیم' });
            } else if (!row) {
                reject({ error: 'کاربر یافت نشد' });
            } else {
                const oldUsername = row.username;
                
                // آپدیت نام کاربری
                db.run(`UPDATE users SET username = ? WHERE id = ?`, [newUsername, userId], function(err) {
                    if (err) {
                        reject({ error: 'خطا در ذخیره نام کاربری' });
                    } else {
                        resolve({ success: true, username: newUsername, oldUsername: oldUsername });
                    }
                });
            }
        });
    });
}

// آپدیت عکس پروفایل
function updateProfilePicture(userId, profilePicture) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE users SET profile_picture = ? WHERE id = ?`, [profilePicture, userId], function(err) {
            if (err) {
                reject({ error: 'خطا در ذخیره عکس پروفایل' });
            } else {
                resolve({ success: true, profile_picture: profilePicture });
            }
        });
    });
}

// آپدیت بیوگرافی
function updateBio(userId, bio) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE users SET bio = ? WHERE id = ?`, [bio, userId], function(err) {
            if (err) {
                reject({ error: 'خطا در ذخیره بیوگرافی' });
            } else {
                resolve({ success: true, bio: bio });
            }
        });
    });
}

// دریافت تنظیمات گروه (شامل لیست ادمین‌ها)
function getGroupSettings(groupId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM group_settings WHERE group_id = ?`, [groupId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در دریافت تنظیمات گروه' });
            } else if (!row) {
                resolve(null);
            } else {
                // در ابتدا شناسه مالک را هم بگیریم
                db.get(
                    `SELECT u.id as owner_id
                     FROM users u
                     JOIN group_settings gs ON u.email = gs.admin_email
                     WHERE gs.group_id = ?`,
                    [groupId],
                    (err3, ownerRow) => {
                        if (!err3 && ownerRow) {
                            row.owner_id = ownerRow.owner_id;
                        }
                        // سپس لیست ادمین‌ها از جدول جدید
                        db.all(`SELECT user_id FROM group_admins WHERE group_id = ?`, [groupId], (err2, rows) => {
                            if (err2) {
                                // در صورت خطا، حداقل اطلاعات اصلی را بازگردان
                                resolve(row);
                            } else {
                                row.admins = rows.map(r => r.user_id);
                                resolve(row);
                            }
                        });
                    }
                );
            }
        });
    });
}

// دریافت ایمیل کاربر با userId
function getUserEmail(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT email FROM users WHERE id = ?', [userId], (err, row) => {
            if (err) {
                reject({ error: 'خطا در دریافت اطلاعات کاربر' });
            } else {
                resolve(row ? row.email : null);
            }
        });
    });
}

// آپدیت پروفایل گروه - اکنون با استفاده از userId و بررسی حقوق از طریق isGroupAdmin
function updateGroupProfile(groupId, userId, profilePicture) {
    return new Promise(async (resolve, reject) => {
        try {
            const adminCheck = await isGroupAdmin(groupId, userId);
            if (!adminCheck.isAdmin) {
                reject({ error: 'فقط ادمین گروه می‌تواند پروفایل را تغییر دهد' });
                return;
            }

            db.run(`UPDATE group_settings SET profile_picture = ? WHERE group_id = ?`, [profilePicture, groupId], function(err) {
                if (err) {
                    reject({ error: 'خطا در ذخیره پروفایل گروه' });
                } else {
                    resolve({ success: true, profile_picture: profilePicture });
                }
            });
        } catch (err) {
            reject({ error: err.error || 'خطا در بررسی دسترسی' });
        }
    });
}

// ساخت گروه جدید
function createGroup(userId, name, groupId, description, profilePicture) {
    return new Promise((resolve, reject) => {
        // دریافت ایمیل کاربر
        db.get(`SELECT email FROM users WHERE id = ?`, [userId], (err, user) => {
            if (err || !user) {
                reject({ error: 'کاربر یافت نشد' });
                return;
            }
            
            // بررسی یونیک بودن آیدی گروه
            if (groupId) {
                db.get(`SELECT group_id FROM group_settings WHERE group_userid = ?`, [groupId], (err, row) => {
                    if (err) {
                        reject({ error: 'خطا در بررسی آیدی گروه' });
                    } else if (row) {
                        reject({ error: 'این آیدی قبلا استفاده شده است' });
                    } else {
                        insertGroup();
                    }
                });
            } else {
                insertGroup();
            }
            
            function insertGroup() {
                const uniqueGroupId = `group_${Date.now()}_${userId}`;
                db.run(
                    `INSERT INTO group_settings (group_id, group_name, group_userid, profile_picture, admin_email, group_type) 
                     VALUES (?, ?, ?, ?, ?, 'group')`,
                    [uniqueGroupId, name, groupId, profilePicture, user.email],
                    function(err) {
                        if (err) {
                            console.error('Create group error:', err);
                            reject({ error: 'خطا در ساخت گروه' });
                        } else {
                            // اضافه کردن سازنده به عنوان عضو
                            db.run(
                                `INSERT INTO group_members (group_id, user_id) VALUES (?, ?)`,
                                [uniqueGroupId, userId],
                                (err) => {
                                    if (err) {
                                        console.error('Error adding creator as member:', err);
                                    }
                                }
                            );
                            // همچنین سازنده را به عنوان ادمین اولیه ثبت کن
                            db.run(
                                `INSERT OR IGNORE INTO group_admins (group_id, user_id) VALUES (?, ?)`,
                                [uniqueGroupId, userId],
                                (err) => {
                                    if (err) {
                                        console.error('Error adding creator as admin:', err);
                                    }
                                }
                            );
                            
                            resolve({
                                id: uniqueGroupId,
                                name,
                                groupId,
                                description,
                                profilePicture,
                                adminEmail: user.email,
                                createdAt: new Date().toISOString()
                            });
                        }
                    }
                );
            }
        });
    });
}

// ساخت کانال جدید
function createChannel(userId, name, channelId, description, profilePicture) {
    return new Promise((resolve, reject) => {
        // دریافت ایمیل کاربر
        db.get(`SELECT email FROM users WHERE id = ?`, [userId], (err, user) => {
            if (err || !user) {
                reject({ error: 'کاربر یافت نشد' });
                return;
            }
            
            // بررسی یونیک بودن آیدی کانال
            if (channelId) {
                db.get(`SELECT group_id FROM group_settings WHERE group_userid = ?`, [channelId], (err, row) => {
                    if (err) {
                        reject({ error: 'خطا در بررسی آیدی کانال' });
                    } else if (row) {
                        reject({ error: 'این آیدی قبلا استفاده شده است' });
                    } else {
                        insertChannel();
                    }
                });
            } else {
                insertChannel();
            }
            
            function insertChannel() {
                const uniqueChannelId = `channel_${Date.now()}_${userId}`;
                db.run(
                    `INSERT INTO group_settings (group_id, group_name, group_userid, profile_picture, admin_email, group_type) 
                     VALUES (?, ?, ?, ?, ?, 'channel')`,
                    [uniqueChannelId, name, channelId, profilePicture, user.email],
                    function(err) {
                        if (err) {
                            console.error('Create channel error:', err);
                            reject({ error: 'خطا در ساخت کانال' });
                        } else {
                            // اضافه کردن سازنده به عنوان عضو
                            db.run(
                                `INSERT INTO group_members (group_id, user_id) VALUES (?, ?)`,
                                [uniqueChannelId, userId],
                                (err) => {
                                    if (err) {
                                        console.error('Error adding creator as member:', err);
                                    }
                                }
                            );
                            // ثبت مالک به عنوان ادمین هم برای کانال
                            db.run(
                                `INSERT OR IGNORE INTO group_admins (group_id, user_id) VALUES (?, ?)`,
                                [uniqueChannelId, userId],
                                (err) => {
                                    if (err) {
                                        console.error('Error adding creator as admin to channel:', err);
                                    }
                                }
                            );
                            
                            resolve({
                                id: uniqueChannelId,
                                name,
                                channelId,
                                description,
                                profilePicture,
                                adminEmail: user.email,
                                createdAt: new Date().toISOString()
                            });
                        }
                    }
                );
            }
        });
    });
}

// دریافت گروه‌ها و کانال‌های کاربر
function getUserGroups(userId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT gs.group_id, gs.group_name, gs.group_userid, gs.profile_picture, gs.group_type, gs.created_at
            FROM group_settings gs
            INNER JOIN group_members gm ON gs.group_id = gm.group_id
            WHERE gm.user_id = ?
            ORDER BY gm.joined_at DESC
        `;
        
        db.all(query, [userId], (err, rows) => {
            if (err) {
                console.error('Get user groups error:', err);
                reject({ error: 'خطا در دریافت گروه‌ها' });
            } else {
                resolve(rows || []);
            }
        });
    });
}

// بررسی عضویت کاربر در گروه/کانال
function checkMembership(groupId, userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`,
            [groupId, userId],
            (err, row) => {
                if (err) {
                    reject({ error: 'خطا در بررسی عضویت' });
                } else {
                    resolve({ isMember: !!row });
                }
            }
        );
    });
}

// پیوستن به گروه/کانال
function joinGroup(groupId, userId) {
    return new Promise(async (resolve, reject) => {
        // بررسی محرومیت از گروه (برای همه گروه‌ها)
        try {
            if (groupId === 'global') {
                // اگر گروه عمومی است و کاربر محروم شده، اجازه نده
                const banned = await isGlobalBanned(userId);
                if (banned) {
                    reject({ error: 'شما از گروه عمومی حذف شده‌اید' });
                    return;
                }
            } else {
                // برای گروه‌های سفارشی، بررسی محرومیت از گروه
                const banCheck = await isUserBannedFromGroup(groupId, userId);
                if (banCheck.isBanned) {
                    reject({ error: 'شما از این گروه/کانال محروم هستید' });
                    return;
                }
            }
        } catch (err) {
            console.error('Error checking ban in joinGroup:', err);
            // on database error, just proceed to avoid blocking
        }

        // ابتدا بررسی کن که گروه وجود داره
        db.get(
            `SELECT group_id, group_name, group_type FROM group_settings WHERE group_id = ?`,
            [groupId],
            (err, group) => {
                if (err) {
                    reject({ error: 'خطا در پیوستن' });
                } else if (!group) {
                    reject({ error: 'گروه یافت نشد' });
                } else {
                    // اضافه کردن کاربر به عضویت
                    db.run(
                        `INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`,
                        [groupId, userId],
                        function(err) {
                            if (err) {
                                console.error('Join group error:', err);
                                reject({ error: 'خطا در پیوستن' });
                            } else {
                                resolve({
                                    success: true,
                                    groupId: group.group_id,
                                    groupName: group.group_name,
                                    groupType: group.group_type
                                });
                            }
                        }
                    );
                }
            }
        );
    });
}

// خروج از گروه/کانال (حذف عضویت)
function leaveGroup(groupId, userId) {
    return new Promise((resolve, reject) => {
        // حذف کاربر از عضویت
        db.run(
            `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`,
            [groupId, userId],
            function(err) {
                if (err) {
                    console.error('Leave group error:', err);
                    reject({ error: 'خطا در خروج از گروه' });
                } else {
                    resolve({
                        success: true,
                        message: 'با موفقیت از گروه خارج شدید'
                    });
                }
            }
        );
    });
}

// حذف گروه/کانال برای همه (فقط ادمین)
function deleteGroup(groupId, userId) {
    return new Promise(async (resolve, reject) => {
        try {
            // بررسی دسترسی ادمین
            const adminCheck = await isGroupAdmin(groupId, userId);
            if (!adminCheck.isAdmin) {
                reject({ error: 'فقط ادمین می‌تواند گروه را حذف کند' });
                return;
            }
            
            // حذف همه اعضا
            db.run(
                `DELETE FROM group_members WHERE group_id = ?`,
                [groupId],
                function(err) {
                    if (err) {
                        console.error('Delete group members error:', err);
                        reject({ error: 'خطا در حذف اعضا' });
                        return;
                    }
                    
                    // حذف تنظیمات گروه
                    db.run(
                        `DELETE FROM group_settings WHERE group_id = ?`,
                        [groupId],
                        function(err) {
                            if (err) {
                                console.error('Delete group settings error:', err);
                                reject({ error: 'خطا در حذف گروه' });
                            } else {
                                // حذف پیام‌های گروه از messages-database
                                const { messagesDb } = require('./messages-database');
                                messagesDb.run(
                                    `DELETE FROM group_messages WHERE group_id = ?`,
                                    [groupId],
                                    function(err) {
                                        if (err) {
                                            console.error('Delete group messages error:', err);
                                        }
                                        resolve({
                                            success: true,
                                            message: 'گروه با موفقیت حذف شد'
                                        });
                                    }
                                );
                            }
                        }
                    );
                }
            );
        } catch (error) {
            reject({ error: 'خطا در حذف گروه' });
        }
    });
}

// بررسی اینکه کاربر ادمین گروه/کانال هست یا نه
function isGroupAdmin(groupId, userId) {
    return new Promise((resolve, reject) => {
        // ابتدا بررسی می‌کنیم که userId در جدول ادمین‌ها وجود دارد
        db.get(
            `SELECT 1 FROM group_admins WHERE group_id = ? AND user_id = ?`,
            [groupId, userId],
            (err, row) => {
                if (err) {
                    console.error('isGroupAdmin error (admin table):', err, {groupId, userId});
                    reject({ error: 'خطا در بررسی دسترسی' });
                } else if (row) {
                    resolve({ isAdmin: true });
                } else {
                    // اگر در لیست نبود، به‌عنوان سازنده یا ایمیل قدیمی چک می‌کنیم (سازگاری‌پذیری)
                    db.get(
                        `SELECT u.email, gs.admin_email 
                         FROM users u, group_settings gs 
                         WHERE u.id = ? AND gs.group_id = ?`,
                        [userId, groupId],
                        (err2, row2) => {
                            if (err2) {
                                console.error('isGroupAdmin error (legacy check):', err2, {groupId, userId});
                                reject({ error: 'خطا در بررسی دسترسی' });
                            } else if (!row2) {
                                resolve({ isAdmin: false });
                            } else {
                                resolve({ isAdmin: row2.email === row2.admin_email });
                            }
                        }
                    );
                }
            }
        );
    });
}

// آپدیت اطلاعات گروه/کانال (اسم، بیوگرافی، عکس)
function updateGroupInfo(groupId, userId, updates) {
    return new Promise(async (resolve, reject) => {
        try {
            // بررسی دسترسی ادمین
            const adminCheck = await isGroupAdmin(groupId, userId);
            if (!adminCheck.isAdmin) {
                reject({ error: 'فقط ادمین می‌تواند اطلاعات را تغییر دهد' });
                return;
            }
            
            // ساخت query بر اساس فیلدهای ارسال شده
            const fields = [];
            const values = [];
            
            if (updates.name !== undefined) {
                fields.push('group_name = ?');
                values.push(updates.name);
            }
            if (updates.userid !== undefined) {
                // بررسی یونیک بودن آیدی اگر ارسال شده
                if (updates.userid) {
                    const existingGroup = await new Promise((res, rej) => {
                        db.get(
                            `SELECT group_id FROM group_settings WHERE group_userid = ? AND group_id != ?`,
                            [updates.userid, groupId],
                            (err, row) => {
                                if (err) rej(err);
                                else res(row);
                            }
                        );
                    });
                    
                    if (existingGroup) {
                        reject({ error: 'این آیدی قبلا استفاده شده است' });
                        return;
                    }
                }
                
                fields.push('group_userid = ?');
                values.push(updates.userid);
            }
            if (updates.description !== undefined) {
                // اضافه کردن ستون description اگر وجود نداره
                db.run(`ALTER TABLE group_settings ADD COLUMN description TEXT`, () => {});
                fields.push('description = ?');
                values.push(updates.description);
            }
            if (updates.profilePicture !== undefined) {
                fields.push('profile_picture = ?');
                values.push(updates.profilePicture);
            }
            
            if (fields.length === 0) {
                reject({ error: 'هیچ تغییری ارسال نشده' });
                return;
            }
            
            values.push(groupId);
            const query = `UPDATE group_settings SET ${fields.join(', ')} WHERE group_id = ?`;
            
            db.run(query, values, function(err) {
                if (err) {
                    console.error('Update group info error:', err);
                    reject({ error: 'خطا در آپدیت اطلاعات' });
                } else {
                    resolve({ success: true, updates });
                }
            });
        } catch (error) {
            reject({ error: error.error || 'خطا در آپدیت اطلاعات' });
        }
    });
}

// تابع کمکی: افزودن ادمین جدید
function addGroupAdmin(groupId, userId) {
    return new Promise((resolve, reject) => {
        db.run(`INSERT OR IGNORE INTO group_admins (group_id, user_id) VALUES (?, ?)`, [groupId, userId], function(err) {
            if (err) {
                reject({ error: 'خطا در افزودن ادمین' });
            } else {
                resolve({ success: true });
            }
        });
    });
}

// تابع کمکی: حذف ادمین
function removeGroupAdmin(groupId, userId) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM group_admins WHERE group_id = ? AND user_id = ?`, [groupId, userId], function(err) {
            if (err) {
                reject({ error: 'خطا در حذف ادمین' });
            } else {
                resolve({ success: true });
            }
        });
    });
}

// تابع کمکی: گرفتن شناسه مالک (سازنده) یک گروه/کانال
function getGroupOwnerId(groupId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT u.id as owner_id
             FROM users u
             JOIN group_settings gs ON u.email = gs.admin_email
             WHERE gs.group_id = ?`,
            [groupId],
            (err, row) => {
                if (err) {
                    reject({ error: 'خطا در دریافت مالک گروه' });
                } else {
                    resolve(row ? row.owner_id : null);
                }
            }
        );
    });
}

// دریافت لیست شناسه ادمین‌ها برای گروه/کانال
function getGroupAdmins(groupId) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT user_id FROM group_admins WHERE group_id = ?`, [groupId], (err, rows) => {
            if (err) {
                reject({ error: 'خطا در خواندن لیست ادمین‌ها' });
            } else {
                resolve(rows.map(r => r.user_id));
            }
        });
    });
}

// عملیات مربوط به اعضای گروه عمومی
function banGlobal(userId) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR IGNORE INTO global_bans (user_id) VALUES (?)`,
            [userId],
            function(err) {
                if (err) {
                    console.error('banGlobal error:', err);
                    reject({ error: 'خطا در محروم کردن کاربر' });
                } else {
                    resolve({ success: true });
                }
            }
        );
    });
}

function unbanGlobal(userId) {
    return new Promise((resolve, reject) => {
        db.run(
            `DELETE FROM global_bans WHERE user_id = ?`,
            [userId],
            function(err) {
                if (err) {
                    console.error('unbanGlobal error:', err);
                    reject({ error: 'خطا در بازگردانی کاربر' });
                } else {
                    resolve({ success: true });
                }
            }
        );
    });
}

function isGlobalBanned(userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT 1 FROM global_bans WHERE user_id = ?`,
            [userId],
            (err, row) => {
                if (err) {
                    console.error('isGlobalBanned error:', err);
                    reject({ error: 'خطا در بررسی محرومیت' });
                } else {
                    resolve(!row ? false : true);
                }
            }
        );
    });
}

function getGlobalBans() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT user_id FROM global_bans`, [], (err, rows) => {
            if (err) {
                console.error('getGlobalBans error:', err);
                reject({ error: 'خطا در دریافت لیست محرومیت‌ها' });
            } else {
                resolve(rows.map(r => r.user_id));
            }
        });
    });
}

// دریافت لیست اعضای یک گروه/کانال
function getGroupMembers(groupId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT u.id, u.username, u.user_id, u.profile_picture, u.email, u.bio
             FROM users u
             INNER JOIN group_members gm ON u.id = gm.user_id
             WHERE gm.group_id = ?
             ORDER BY gm.joined_at ASC`,
            [groupId],
            (err, rows) => {
                if (err) {
                    console.error('Get group members error:', err);
                    reject({ error: 'خطا در دریافت اعضا' });
                } else {
                    resolve(rows || []);
                }
            }
        );
    });
}

// توابع برای ban کردن کاربران در گروه‌های سفارشی
function banUserFromGroup(groupId, userId) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR IGNORE INTO group_bans (group_id, user_id) VALUES (?, ?)`,
            [groupId, userId],
            function(err) {
                if (err) {
                    console.error('banUserFromGroup error:', err);
                    reject({ error: 'خطا در محروم کردن کاربر' });
                } else {
                    resolve({ success: true });
                }
            }
        );
    });
}

function unbanUserFromGroup(groupId, userId) {
    return new Promise((resolve, reject) => {
        db.run(
            `DELETE FROM group_bans WHERE group_id = ? AND user_id = ?`,
            [groupId, userId],
            function(err) {
                if (err) {
                    console.error('unbanUserFromGroup error:', err);
                    reject({ error: 'خطا در بازگردانی کاربر' });
                } else {
                    resolve({ success: true });
                }
            }
        );
    });
}

function isUserBannedFromGroup(groupId, userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT 1 FROM group_bans WHERE group_id = ? AND user_id = ?`,
            [groupId, userId],
            (err, row) => {
                if (err) {
                    console.error('isUserBannedFromGroup error:', err);
                    reject({ error: 'خطا در بررسی محرومیت' });
                } else {
                    resolve({ isBanned: !!row });
                }
            }
        );
    });
}

function getGroupBans(groupId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT user_id FROM group_bans WHERE group_id = ?`,
            [groupId],
            (err, rows) => {
                if (err) {
                    console.error('getGroupBans error:', err);
                    reject({ error: 'خطا در دریافت لیست محرومیت‌ها' });
                } else {
                    resolve(rows.map(r => r.user_id));
                }
            }
        );
    });
}

module.exports = {
    db,
    registerUser,
    loginUser,
    loginWithGoogle,
    setupUserPassword,
    changeUserPassword,
    getUserById,
    getAllUsers,
    updateUserId,
    updateUsername,
    searchUserByUsernameOrId,
    searchAll,
    updateProfilePicture,
    updateBio,
    getUserEmail,
    getGroupSettings,
    updateGroupProfile,
    createGroup,
    createChannel,
    getUserGroups,
    checkMembership,
    joinGroup,
    leaveGroup,
    deleteGroup,
    isGroupAdmin,
    addGroupAdmin,
    removeGroupAdmin,
    getGroupAdmins,
    updateGroupInfo,
    getGroupMembers,
    getGroupOwnerId,
    banGlobal,
    unbanGlobal,
    isGlobalBanned,
    getGlobalBans,
    banUserFromGroup,
    unbanUserFromGroup,
    isUserBannedFromGroup,
    getGroupBans,
    closeDatabase,
    openDatabase
};
