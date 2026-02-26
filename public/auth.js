// توابع مربوط به احراز هویت و لاگین

// helper for authentication and API URL management
// base URL for API calls: if the page is not served from the same port,
// assume backend runs on port 3000 (default in server.js).
const API_BASE = (() => {
    const loc = window.location;
    // if page is running on localhost but not on 3000, redirect to 3000
    if (loc.hostname === 'localhost' && loc.port && loc.port !== '3000') {
        return `${loc.protocol}//${loc.hostname}:3000`;
    }
    // otherwise use origin
    return loc.origin;
})();

function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    const token = currentUser?.token || localStorage.getItem('authToken');
    if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    const fullUrl = API_BASE + url;
    console.log('authFetch', fullUrl, options);
    return fetch(fullUrl, options);
}


// عناصر DOM و event listenerهای مرتبط با صفحه لاگین
// تعریف lazy برای جلوگیری از خطای null هنگام بارگذاری
let loginModal = null;
let appContainer = null;
let loginForm = null;
let signupForm = null;
let passwordSetupModal = null;
let setupPasswordInput = null;
let setupConfirmPasswordInput = null;
let setupPasswordBtn = null;

let usernameInput = null;
let passwordInput = null;
let connectBtn = null;

let signupUsernameInput = null;
let signupUseridInput = null;
let signupPasswordInput = null;
let signupConfirmPasswordInput = null;
let signupBtn = null;

// تابع برای اتصال DOM elements
function initDOMElements() {
    loginModal = document.getElementById('login-modal');
    appContainer = document.querySelector('.app-container');
    loginForm = document.getElementById('login-form-modal');
    signupForm = document.getElementById('signup-modal');
    passwordSetupModal = document.getElementById('password-setup-modal');
    setupPasswordInput = document.getElementById('setup-password');
    setupConfirmPasswordInput = document.getElementById('setup-confirm-password');
    setupPasswordBtn = document.getElementById('setup-password-btn');
    usernameInput = document.getElementById('username');
    passwordInput = document.getElementById('password');
    connectBtn = document.getElementById('connect-btn');
    signupUsernameInput = document.getElementById('signup-username');
    signupUseridInput = document.getElementById('signup-userid');
    signupPasswordInput = document.getElementById('signup-password');
    signupConfirmPasswordInput = document.getElementById('signup-confirm-password');
    signupBtn = document.getElementById('signup-btn');
}

// enable emoji-aware editables if available
function initAuthEmojiFields() {
    const fields = [usernameInput, signupUsernameInput, signupUseridInput];

    // enable the generic emoji-aware behaviour that lives in app.js
    if (typeof enableEmojiEditable === 'function') {
        fields.forEach(el => { if (el) enableEmojiEditable(el); });
    }

    // whenever one of the login/signup fields changes we also want to
    // make sure the Iran‑flag replacement is applied immediately.  the
    // generic `enableEmojiEditable` already runs parseEmojis on `input`
    // events, but parseEmojis will only turn the character into a
    // twemoji image.  replaceIranFlag then swaps the image src to the
    // custom SVG stored in `encryptedAssets.iranFlag`.  running both
    // here guarantees the behaviour even if the fields are filled before
    // twemoji has finished loading.
    fields.forEach(el => {
        if (!el) return;
        el.addEventListener('input', () => {
            if (typeof parseEmojis !== 'undefined') parseEmojis(el);
            if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(el);
        });
    });
}
// run immediately (may occur before emojis.js loaded)
window.addEventListener('DOMContentLoaded', () => {
    initDOMElements();
    initAuthEmojiFields();
});
// also re-run after full page load so that parseEmojis is guaranteed available
window.addEventListener('load', initAuthEmojiFields);

// pressing Enter in username fields should trigger the appropriate action
window.addEventListener('DOMContentLoaded', () => {
    if (usernameInput) {
        usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') login();
        });
    }
    if (signupUsernameInput) {
        signupUsernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') signup();
        });
    }

    const showSignupLink = document.getElementById('show-signup');
    const showLoginLink = document.getElementById('show-login');

    // اتصال event listenerها به توابع احراز هویت
    if (connectBtn) connectBtn.addEventListener('click', login);
    if (signupBtn) signupBtn.addEventListener('click', signup);
    if (setupPasswordBtn) setupPasswordBtn.addEventListener('click', setupPassword);

    if (showSignupLink) {
        showSignupLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (loginForm) loginForm.style.display = 'none';
            if (signupForm) signupForm.style.display = 'flex';
            if (passwordSetupModal) passwordSetupModal.style.display = 'none';
        });
    }
    if (showLoginLink) {
        showLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (signupForm) signupForm.style.display = 'none';
            if (loginForm) loginForm.style.display = 'flex';
            if (passwordSetupModal) passwordSetupModal.style.display = 'none';
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') login();
        });
    }

    if (signupConfirmPasswordInput) {
        signupConfirmPasswordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') signup();
        });
    }
});

// بررسی session ذخیره شده هنگام بارگذاری صفحه
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            username = currentUser.username;

            // پاک کردن کش پیام‌ها و وضعیت چت
            window.globalChatHistory = null;
            localStorage.removeItem('currentChatState');
            localStorage.removeItem('groupProfilePicture');

            connectToServer();
        } catch (error) {
            console.error('خطا در بارگذاری session:', error);
            localStorage.removeItem('currentUser');
        }
    }
    
    // راه‌اندازی عناصر UI مربوط به احراز هویت
    initAuthUI();
});

// Google Login rendering (اگر API وجود داشت)
window.addEventListener('load', () => {
    if (typeof google !== 'undefined') {
        google.accounts.id.initialize({
            client_id: (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_CLIENT_ID) || '',
            callback: handleGoogleLogin
        });

        const googleLoginBtn = document.getElementById("googleLoginBtn");
        if (googleLoginBtn) {
            // ساخت دکمه سفارشی گوگل
            googleLoginBtn.innerHTML = `
                <button class="custom-google-btn" id="custom-google-login">
                    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                        <g fill="none" fill-rule="evenodd">
                            <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                        </g>
                    </svg>
                    <span>ورود با حساب گوگل</span>
                </button>
            `;
            
            // رندر دکمه اصلی گوگل به صورت مخفی
            const hiddenDiv = document.createElement('div');
            hiddenDiv.style.display = 'none';
            hiddenDiv.id = 'hidden-google-btn';
            googleLoginBtn.appendChild(hiddenDiv);
            
            google.accounts.id.renderButton(hiddenDiv, {
                theme: "outline",
                size: "large"
            });
            
            // کلیک روی دکمه سفارشی، دکمه اصلی رو کلیک می‌کنه
            document.getElementById('custom-google-login').addEventListener('click', () => {
                const realBtn = hiddenDiv.querySelector('div[role="button"]');
                if (realBtn) {
                    realBtn.click();
                }
            });
        }

        const googleSignupBtn = document.getElementById("googleSignupBtn");
        if (googleSignupBtn) {
            // ساخت دکمه سفارشی گوگل برای ثبت‌نام
            googleSignupBtn.innerHTML = `
                <button class="custom-google-btn" id="custom-google-signup">
                    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                        <g fill="none" fill-rule="evenodd">
                            <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                        </g>
                    </svg>
                    <span>ثبت‌نام با حساب گوگل</span>
                </button>
            `;
            
            // رندر دکمه اصلی گوگل به صورت مخفی
            const hiddenDiv = document.createElement('div');
            hiddenDiv.style.display = 'none';
            hiddenDiv.id = 'hidden-google-signup-btn';
            googleSignupBtn.appendChild(hiddenDiv);
            
            google.accounts.id.renderButton(hiddenDiv, {
                theme: "outline",
                size: "large"
            });
            
            // کلیک روی دکمه سفارشی، دکمه اصلی رو کلیک می‌کنه
            document.getElementById('custom-google-signup').addEventListener('click', () => {
                const realBtn = hiddenDiv.querySelector('div[role="button"]');
                if (realBtn) {
                    realBtn.click();
                }
            });
        }
    } else {
        const googleLoginBtn = document.getElementById("googleLoginBtn");
        const googleSignupBtn = document.getElementById("googleSignupBtn");
        const dividers = document.querySelectorAll('.divider');

        if (googleLoginBtn) googleLoginBtn.style.display = 'none';
        if (googleSignupBtn) googleSignupBtn.style.display = 'none';
        dividers.forEach(divider => divider.style.display = 'none');
    }
});

// توابع auth ادامه می‌یابند
async function handleGoogleLogin(response) {
    try {
        const credential = response.credential;
        const payload = JSON.parse(atob(credential.split('.')[1]));
        
        const res = await fetch(API_BASE + '/api/google-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                googleId: payload.sub,
                username: payload.name || payload.email.split('@')[0],
                email: payload.email
            })
        });
        
        const data = await res.json();
        
        if (data.success) {
            currentUser = data.user;
            username = data.user.username;
            // save token as well
            if (data.token) {
                currentUser.token = data.token;
                localStorage.setItem('authToken', data.token);
            }
            
            // ذخیره session در localStorage
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            // بررسی اینکه آیا کاربر رمز عبور داره یا نه
            if (data.user.needsPassword) {
                // نمایش مودال تنظیم رمز عبور
                showPasswordSetupModal();
            } else {
                connectToServer();
            }
        } else {
            alert(data.error || 'خطا در ورود با گوگل');
        }
    } catch (error) {
        alert('خطا در ورود با گوگل');
    }
}

async function signup() {
    const user = getTextWithEmoji(signupUsernameInput).trim();
    const userid = getTextWithEmoji(signupUseridInput).trim();
    const pass = signupPasswordInput.value;
    const confirmPass = signupConfirmPasswordInput.value;
    
    if (!user || !userid || !pass) {
        alert('لطفا تمام فیلدها را پر کنید');
        return;
    }
    
    // اعتبارسنجی آیدی - فقط حروف انگلیسی، اعداد و _
    const useridRegex = /^[a-zA-Z0-9_]+$/;
    if (!useridRegex.test(userid)) {
        alert('آیدی فقط می‌تواند شامل حروف انگلیسی، اعداد و _ باشد');
        return;
    }
    
    if (pass.length < 4) {
        alert('رمز عبور باید حداقل 4 کاراکتر باشد');
        return;
    }
    
    if (pass !== confirmPass) {
        alert('رمز عبور و تکرار آن یکسان نیستند');
        return;
    }
    
    try {
        const res = await fetch(API_BASE + '/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, userid: userid, password: pass })
        });
        
        const data = await res.json();
        
        if (data.success) {
            alert('ثبت‌نام با موفقیت انجام شد!');
            signupForm.style.display = 'none';
            loginForm.style.display = 'flex';
            
            if (usernameInput) {
                usernameInput.innerText = userid;
                if (typeof parseEmojis !== 'undefined') parseEmojis(usernameInput);
            }
            if (signupUsernameInput) signupUsernameInput.innerHTML = '';
            if (signupUseridInput) signupUseridInput.innerHTML = '';
            signupPasswordInput.value = '';
            signupConfirmPasswordInput.value = '';
        } else {
            alert(data.error || 'خطا در ثبت‌نام');
        }
    } catch (error) {
        alert('خطا در ارتباط با سرور');
    }
}

async function login() {
    let user = getTextWithEmoji(usernameInput).trim();
    const pass = passwordInput.value;
    
    // حذف @ اگر کاربر وارد کرده
    if (user.startsWith('@')) {
        user = user.substring(1);
    }
    
    if (!user || !pass) {
        alert('لطفا نام کاربری و رمز عبور را وارد کنید');
        return;
    }
    
    try {
        const res = await fetch(API_BASE + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        
        const data = await res.json();
        
        if (data.success) {
            currentUser = data.user;
            username = data.user.username;
            if (data.token) {
                currentUser.token = data.token;
                localStorage.setItem('authToken', data.token);
            }
            
            // ذخیره session در localStorage
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            
            connectToServer();
        } else {
            alert(data.error || 'خطا در ورود');
        }
    } catch (error) {
        alert('خطا در ارتباط با سرور');
    }
}

function showPasswordSetupModal() {
    loginForm.style.display = 'none';
    signupForm.style.display = 'none';
    passwordSetupModal.style.display = 'flex';
}

async function setupPassword() {
    const password = setupPasswordInput.value;
    const confirmPassword = setupConfirmPasswordInput.value;
    
    if (!password || !confirmPassword) {
        alert('لطفا تمام فیلدها را پر کنید');
        return;
    }
    
    if (password.length < 4) {
        alert('رمز عبور باید حداقل 4 کاراکتر باشد');
        return;
    }
    
    if (password !== confirmPassword) {
        alert('رمز عبور و تکرار آن یکسان نیستند');
        return;
    }
    
    try {
        const payload = {
            userId: currentUser?.id,
            password: password
        };
        console.log('setupPassword payload', payload);
        const res = await authFetch('/api/setup-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            const text = await res.text();
            console.error('setup-password HTTP error', res.status, text);
            alert('خطا در تنظیم رمز عبور: ' + res.status);
            return;
        }

        const data = await res.json();
        
        if (data.success) {
            setupPasswordInput.value = '';
            setupConfirmPasswordInput.value = '';
            connectToServer();
        } else {
            console.error('setup-password returned', data);
            alert(data.error || 'خطا در تنظیم رمز عبور');
        }
    } catch (error) {
        console.error('setupPassword catch', error);
        alert('خطا در ارتباط با سرور');
    }
}

function logout() {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    if (ws) {
        ws.close();
    }
    location.reload();
}

// راه‌اندازی دکمه logout و مدیریت رمز عبور
function initAuthUI() {
    // دکمه logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    
    // مدیریت مودال تغییر رمز عبور
    const changePasswordBtn = document.getElementById('change-password-btn');
    const changePasswordModal = document.getElementById('change-password-modal');
    const backToProfileBtn = document.getElementById('back-to-profile-btn');
    const editProfileModal = document.getElementById('edit-profile-modal');
    
    // تابع پاک‌سازی فیلدهای رمز عبور
    function clearPasswordFields() {
        const fields = ['current-password-input', 'new-password-input', 'confirm-new-password-input'];
        fields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = '';
                field.classList.remove('error');
            }
        });
        
        // پاک کردن پیام‌های خطا
        const errorMessages = changePasswordModal?.querySelectorAll('.error-message');
        errorMessages?.forEach(msg => msg.remove());
    }
    
    // نمایش پیام خطا زیر فیلد
    function showFieldError(fieldId, message) {
        const field = document.getElementById(fieldId);
        if (!field) return;
        
        field.classList.add('error');
        
        // حذف پیام خطای قبلی
        const existingError = field.parentElement.querySelector('.error-message');
        if (existingError) existingError.remove();
        
        // افزودن پیام خطای جدید
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        field.parentElement.appendChild(errorDiv);
    }
    
    // باز کردن مودال
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', () => {
            if (editProfileModal) editProfileModal.style.display = 'none';
            if (changePasswordModal) {
                changePasswordModal.style.display = 'flex';
                clearPasswordFields();
                // فوکوس روی اولین فیلد
                setTimeout(() => {
                    document.getElementById('current-password-input')?.focus();
                }, 100);
            }
        });
    }
    
    // بستن مودال و بازگشت به پروفایل با دکمه برگشت
    if (backToProfileBtn) {
        backToProfileBtn.addEventListener('click', () => {
            if (changePasswordModal) {
                changePasswordModal.style.display = 'none';
                clearPasswordFields();
            }
            if (editProfileModal) {
                editProfileModal.style.display = 'flex';
            }
        });
    }
    
    // بستن مودال با کلیک روی پس‌زمینه
    if (changePasswordModal) {
        changePasswordModal.addEventListener('click', (e) => {
            if (e.target === changePasswordModal) {
                changePasswordModal.style.display = 'none';
                clearPasswordFields();
            }
        });
    }
    
    // ذخیره رمز عبور جدید
    const saveNewPasswordBtn = document.getElementById('save-new-password-btn');
    if (saveNewPasswordBtn) {
        saveNewPasswordBtn.addEventListener('click', async () => {
            const currentPasswordField = document.getElementById('current-password-input');
            const newPasswordField = document.getElementById('new-password-input');
            const confirmNewPasswordField = document.getElementById('confirm-new-password-input');
            
            const currentPassword = currentPasswordField?.value.trim() || '';
            const newPassword = newPasswordField?.value.trim() || '';
            const confirmNewPassword = confirmNewPasswordField?.value.trim() || '';
            
            // پاک کردن خطاهای قبلی
            [currentPasswordField, newPasswordField, confirmNewPasswordField].forEach(field => {
                field?.classList.remove('error');
                field?.parentElement.querySelector('.error-message')?.remove();
            });
            
            // اعتبارسنجی فیلدها
            let hasError = false;
            
            if (!currentPassword) {
                showFieldError('current-password-input', 'رمز عبور فعلی را وارد کنید');
                hasError = true;
            }
            
            if (!newPassword) {
                showFieldError('new-password-input', 'رمز عبور جدید را وارد کنید');
                hasError = true;
            } else if (newPassword.length < 4) {
                showFieldError('new-password-input', 'رمز عبور باید حداقل 4 کاراکتر باشد');
                hasError = true;
            } else if (newPassword.length > 50) {
                showFieldError('new-password-input', 'رمز عبور نباید بیشتر از 50 کاراکتر باشد');
                hasError = true;
            } else if (currentPassword === newPassword) {
                showFieldError('new-password-input', 'رمز جدید نمی‌تواند با رمز فعلی یکسان باشد');
                hasError = true;
            }
            
            if (!confirmNewPassword) {
                showFieldError('confirm-new-password-input', 'تکرار رمز عبور را وارد کنید');
                hasError = true;
            } else if (newPassword !== confirmNewPassword) {
                showFieldError('confirm-new-password-input', 'رمز عبور و تکرار آن یکسان نیستند');
                hasError = true;
            }
            
            if (hasError) return;
            
            // غیرفعال کردن دکمه در حین ارسال
            saveNewPasswordBtn.disabled = true;
            saveNewPasswordBtn.textContent = 'در حال تغییر...';
            
            try {
                const payload = {
                    userId: currentUser.id,
                    currentPassword: currentPassword,
                    newPassword: newPassword
                };
                console.log('Sending change password request:', { 
                    userId: payload.userId, 
                    hasCurrentPassword: !!payload.currentPassword,
                    hasNewPassword: !!payload.newPassword 
                });
                
                const response = await authFetch('/api/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await response.json();
                console.log('Change password response:', data);
                
                if (data.success) {
                    alert('✓ رمز عبور با موفقیت تغییر یافت');
                    if (changePasswordModal) changePasswordModal.style.display = 'none';
                    clearPasswordFields();
                } else {
                    // نمایش خطا در فیلد مربوطه
                    if (data.error.includes('فعلی')) {
                        showFieldError('current-password-input', data.error);
                    } else {
                        alert(data.error || 'خطا در تغییر رمز عبور');
                    }
                }
            } catch (error) {
                console.error('Error changing password:', error);
                alert('خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید');
            } finally {
                // فعال کردن دوباره دکمه
                saveNewPasswordBtn.disabled = false;
                saveNewPasswordBtn.textContent = 'تغییر رمز عبور';
            }
        });
    }
}


// Password visibility toggle functionality
document.addEventListener('DOMContentLoaded', function() {
    const passwordToggles = document.querySelectorAll('.password-toggle-icon');
    
    passwordToggles.forEach(toggle => {
        const targetId = toggle.getAttribute('data-target');
        const passwordInput = document.getElementById(targetId);
        
        if (!passwordInput) return;
        
        // Show password on mousedown/touchstart
        const showPassword = () => {
            passwordInput.type = 'text';
            toggle.style.color = 'var(--accent-color)';
        };
        
        // Hide password on mouseup/touchend
        const hidePassword = () => {
            passwordInput.type = 'password';
            toggle.style.color = 'var(--text-secondary)';
        };
        
        // Mouse events
        toggle.addEventListener('mousedown', showPassword);
        toggle.addEventListener('mouseup', hidePassword);
        toggle.addEventListener('mouseleave', hidePassword);
        
        // Touch events for mobile
        toggle.addEventListener('touchstart', (e) => {
            e.preventDefault();
            showPassword();
        });
        toggle.addEventListener('touchend', (e) => {
            e.preventDefault();
            hidePassword();
        });
        toggle.addEventListener('touchcancel', hidePassword);
    });
});


// Ripple effect for buttons
document.addEventListener('DOMContentLoaded', function() {
    const buttons = document.querySelectorAll('.modal-content button, .custom-google-btn');
    
    buttons.forEach(button => {
        button.addEventListener('click', function(e) {
            const ripple = document.createElement('span');
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;
            
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = x + 'px';
            ripple.style.top = y + 'px';
            ripple.classList.add('ripple-effect');
            
            this.appendChild(ripple);
            
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });
});


// Disable body scroll when login modal is visible
document.addEventListener('DOMContentLoaded', function() {
    const loginModal = document.getElementById('login-modal');
    
    if (loginModal && loginModal.style.display !== 'none') {
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
    }
    
    // Re-enable scroll when modal is hidden (after successful login)
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.attributeName === 'style') {
                if (loginModal.style.display === 'none') {
                    document.body.classList.remove('modal-open');
                    document.body.style.overflow = '';
                } else {
                    document.body.classList.add('modal-open');
                    document.body.style.overflow = 'hidden';
                }
            }
        });
    });
    
    if (loginModal) {
        observer.observe(loginModal, { attributes: true });
    }
});
