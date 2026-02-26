// app.js - main entrypoint (kept intentionally small after refactor)
const DEBUG = false; // set true to enable verbose logs
// When DEBUG is false, disable verbose console.log output project-wide
if (!DEBUG) {
    console.log = function () { };
} else {
    console.log('app.js loaded');
}
let ws = null;
let wsRetryCount = 0;
const wsMaxRetries = 10;
const wsBaseRetryDelay = 2000; // ms
let username = '';
let currentUser = null;
let currentChat = null; // 'global' یا username کاربر برای PV یا groupId برای گروه‌های سفارشی
let currentGroupSettings = null; // تنظیمات گروه/کانال فعلی
let privateChats = new Map(); // ذخیره پیام‌های خصوصی
let usersIdMap = new Map(); // نقشه username به userId
let usersProfilePictureMap = new Map(); // نقشه username به profile picture
let privateChatsLoaded = false; // برای جلوگیری از بارگذاری مکرر
let lastGroupMessageId = 0; // آخرین پیام گروه که خوانده شده
let lastCustomGroupMessageId = {}; // آخرین پیام هر گروه سفارشی که خوانده شده
let oldestGroupMessageId = null; // قدیمی‌ترین پیام گروه که لود شده
let oldestPrivateMessageId = {}; // قدیمی‌ترین پیام خصوصی برای هر چت
let oldestCustomGroupMessageId = {}; // قدیمی‌ترین پیام هر گروه سفارشی که لود شده
let isLoadingOlderMessages = false; // برای جلوگیری از بارگذاری همزمان
let isSelectionMode = false; // حالت انتخاب چند پیام
let selectedMessages = new Set(); // مجموعه پیام‌های انتخاب شده
let replyToMessage = null; // پیام مورد نظر برای پاسخ دادن

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Login DOM elements moved to auth.js

const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messagesDiv = document.getElementById('messages');
const onlineCount = document.getElementById('online-count');

// custom copy behaviour: ensure twemoji images (and any inline SVGs) produce
// the corresponding unicode characters when users copy text from chat.
if (messagesDiv) {
    messagesDiv.addEventListener('copy', (e) => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        let text = '';
        for (let i = 0; i < sel.rangeCount; i++) {
            const frag = sel.getRangeAt(i).cloneContents();
            const div = document.createElement('div');
            div.appendChild(frag);
            text += getTextWithEmoji(div);
        }
        if (text) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();
        }
    });
}
let onlineUsers = []; // ذخیره لیست کاربران آنلاین
let bannedFromGlobal = false; // حالات محرومیت از گروه عمومی

// هنگام تایپ در باکس پیام، ایموجی‌های اندروید را با پک برنامه رندر کن
if (messageInput) {
    // تابع برای پردازش و تبدیل ایموجی‌ها
    // helpers for preserving caret when we mutate the contenteditable
    function saveSelection(containerEl) {
        const sel = window.getSelection();
        if (sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        const preSelectionRange = range.cloneRange();
        preSelectionRange.selectNodeContents(containerEl);
        preSelectionRange.setEnd(range.startContainer, range.startOffset);
        const start = preSelectionRange.toString().length;
        return {
            start: start,
            end: start + range.toString().length
        };
    }

    function restoreSelection(containerEl, savedSel) {
        if (!savedSel) return;
        let charIndex = 0;
        const range = document.createRange();
        range.setStart(containerEl, 0);
        range.collapse(true);
        const nodeStack = [containerEl];
        let node, foundStart = false, stop = false;
        while (!stop && (node = nodeStack.pop())) {
            if (node.nodeType === 3) {
                const nextCharIndex = charIndex + node.length;
                if (!foundStart && savedSel.start >= charIndex && savedSel.start <= nextCharIndex) {
                    range.setStart(node, savedSel.start - charIndex);
                    foundStart = true;
                }
                if (foundStart && savedSel.end >= charIndex && savedSel.end <= nextCharIndex) {
                    range.setEnd(node, savedSel.end - charIndex);
                    stop = true;
                }
                charIndex = nextCharIndex;
            } else {
                let i = node.childNodes.length;
                while (i--) nodeStack.push(node.childNodes[i]);
            }
        }
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    const processEmojis = () => {
        try {
            // preserve caret if the input has focus, we will restore after
            // performing conversions to avoid jumpiness that could make
            // subsequent typing appear before/after the emoji unexpectedly.
            let savedSel = null;
            if (document.activeElement === messageInput) {
                savedSel = saveSelection(messageInput);
            }

            // only need to parse emojis; custom Iran‑flag logic is disabled
            if (typeof parseEmojis !== 'undefined') {
                parseEmojis(messageInput);
            }

            if (savedSel) {
                restoreSelection(messageInput, savedSel);
            }
        } catch (err) {
            console.error('parseEmojis on message input failed', err);
        }
    };

    // پردازش در هنگام تایپ
    messageInput.addEventListener('input', () => {
        // استفاده از setTimeout برای اطمینان از اینکه DOM آپدیت شده
        setTimeout(processEmojis, 0);
    });

    // پردازش در هنگام paste
    messageInput.addEventListener('paste', () => {
        setTimeout(processEmojis, 10);
    });

    // on blur just re-run emoji parsing to catch any remaining symbols
    messageInput.addEventListener('blur', processEmojis);

    // پردازش مداوم با MutationObserver برای تشخیص تغییرات
    if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            mutations.forEach(mutation => {
                // اگر node جدیدی اضافه شده یا محتوا تغییر کرده
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    shouldProcess = true;
                }
            });
            if (shouldProcess) {
                processEmojis();
            }
        });

        observer.observe(messageInput, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }
}

// Session load moved to `auth.js`

// بستن اتصال WebSocket هنگام بستن صفحه
window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
});

// Login-related listeners moved to auth.js

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        // تشخیص موبایل
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

        if (isMobile) {
            // در موبایل: Enter فقط خط جدید ایجاد می‌کند
            return;
        } else {
            // در دسکتاپ: Enter ارسال می‌کند، Shift+Enter خط جدید
            if (!e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        }
    }
});

// دکمه خروج و منو
document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');

    // تشخیص موبایل یا دسکتاپ
    const isMobile = () => window.innerWidth <= 768;

    // دکمه تنظیمات شناور در صفحه خوش‌آمدگویی
    const welcomeSettingsBtn = document.getElementById('welcome-settings-btn');
    if (welcomeSettingsBtn) {
        welcomeSettingsBtn.addEventListener('click', showSettingsModal);
    }

    // کادر جستجو در صفحه خوش‌آمدگویی
    const welcomeSearchBox = document.getElementById('welcome-search-box');
    if (welcomeSearchBox) {
        enableEmojiEditable(welcomeSearchBox);

        welcomeSearchBox.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = getTextWithEmoji(welcomeSearchBox).trim();
                if (query) {
                    await searchUser(query);
                }
            }
        });
    }

    // دکمه گروه/کانال جدید در صفحه خوش‌آمدگویی
    const welcomeNewChatBtn = document.getElementById('welcome-new-chat-btn');
    if (welcomeNewChatBtn) {
        welcomeNewChatBtn.addEventListener('click', () => {
            const newChatModal = document.getElementById('new-chat-modal');
            if (newChatModal) {
                newChatModal.style.display = 'flex';
            }
        });
    }

    // دکمه برگشت به صفحه اصلی
    const backToHomeBtn = document.getElementById('back-to-home-btn');
    if (backToHomeBtn) {
        backToHomeBtn.addEventListener('click', () => {
            // برگشت به صفحه خوش‌آمدگویی
            showWelcomeScreen();
            // پاک کردن currentChat
            currentChat = null;
            if (typeof saveChatState !== 'undefined') saveChatState();
        });
    }

    // دکمه تغییر تم
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
    }

    // دکمه تغییر تم در صفحه لاگین
    const loginThemeToggle = document.getElementById('login-theme-toggle');
    if (loginThemeToggle) {
        loginThemeToggle.addEventListener('click', toggleTheme);
    }

    // بارگذاری تم ذخیره شده
    loadSavedTheme();



    // مدیریت کیبورد در موبایل
    if (isMobile()) {
        const messageInput = document.getElementById('message-input');
        const messagesArea = document.getElementById('messages');

        if (messageInput && messagesArea) {
            // وقتی input focus می‌شه (کیبورد باز می‌شه)
            messageInput.addEventListener('focus', () => {
                setTimeout(() => {
                    // اسکرول به آخرین پیام
                    messagesArea.scrollTop = messagesArea.scrollHeight;
                }, 300); // تاخیر برای باز شدن کیبورد
            });

            // جلوگیری از resize مداوم
            let resizeTimer;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    if (document.activeElement === messageInput) {
                        messagesArea.scrollTop = messagesArea.scrollHeight;
                    }
                }, 100);
            });
        }
    }

    // ========================================================================
    // helper for emoji-enabled contenteditable fields
    // ========================================================================
    // reuse caret preservation logic used for the message input above
    function saveSelection(containerEl) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        const preSelectionRange = range.cloneRange();
        preSelectionRange.selectNodeContents(containerEl);
        preSelectionRange.setEnd(range.startContainer, range.startOffset);
        const start = preSelectionRange.toString().length;
        return {
            start: start,
            end: start + range.toString().length
        };
    }

    function restoreSelection(containerEl, savedSel) {
        if (!savedSel) return;
        let charIndex = 0;
        const range = document.createRange();
        range.setStart(containerEl, 0);
        range.collapse(true);
        const nodeStack = [containerEl];
        let node, foundStart = false, stop = false;
        while (!stop && (node = nodeStack.pop())) {
            if (node.nodeType === 3) {
                const nextCharIndex = charIndex + node.length;
                if (!foundStart && savedSel.start >= charIndex && savedSel.start <= nextCharIndex) {
                    range.setStart(node, savedSel.start - charIndex);
                    foundStart = true;
                }
                if (foundStart && savedSel.end >= charIndex && savedSel.end <= nextCharIndex) {
                    range.setEnd(node, savedSel.end - charIndex);
                    stop = true;
                }
                charIndex = nextCharIndex;
            } else {
                let i = node.childNodes.length;
                while (i--) nodeStack.push(node.childNodes[i]);
            }
        }
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    // generic initializer for a contenteditable that should render emojis
    function enableEmojiEditable(el) {
        if (!el) return;
        // avoid attaching listeners more than once
        if (el.dataset.emojiEnabled === '1') return;
        el.dataset.emojiEnabled = '1';

        const maxLen = parseInt(el.getAttribute('data-maxlength') || '0', 10) || null;
        // immediately parse any existing content (this handles reopening modals)
        if (typeof parseEmojis !== 'undefined') parseEmojis(el);
        let previousText = getTextWithEmoji(el);

        const process = () => {
            let saved = null;
            if (document.activeElement === el) saved = saveSelection(el);
            if (typeof parseEmojis !== 'undefined') parseEmojis(el);
            if (document.activeElement === el) restoreSelection(el, saved);

            if (maxLen && maxLen > 0) {
                const text = getTextWithEmoji(el);
                if (text.length > maxLen) {
                    const truncated = text.substring(0, maxLen);
                    el.textContent = truncated;
                    if (typeof parseEmojis !== 'undefined') parseEmojis(el);
                }
            }
            previousText = getTextWithEmoji(el);
        };

        el.addEventListener('input', process);
        el.addEventListener('keyup', process);
        el.addEventListener('paste', () => {
            // delay processing until after paste event finishes
            setTimeout(process, 0);
        });
        el.addEventListener('compositionend', process);
    }

    // جستجوی کاربر
    const searchBox = document.getElementById('search-box');
    if (searchBox) {
        enableEmojiEditable(searchBox);

        searchBox.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const query = getTextWithEmoji(searchBox).trim();
                if (query) {
                    await searchUser(query);
                }
            }
        });
    }

    // کلیک روی هدر برای نمایش اعضا
    const chatHeaderDetails = document.getElementById('chat-header-details');
    if (chatHeaderDetails) {
        chatHeaderDetails.addEventListener('click', () => {
            if (currentChat === 'global') {
                showMembersModal();
            } else if (currentChat.startsWith('group_') || currentChat.startsWith('channel_')) {
                showCustomGroupInfo(currentChat);
            }
        });
    }

    // بستن مودال اعضا
    const closeMembersModal = document.getElementById('close-members-modal');
    const membersModal = document.getElementById('members-modal');

    if (closeMembersModal) {
        closeMembersModal.addEventListener('click', () => {
            membersModal.style.display = 'none';
        });
    }

    if (membersModal) {
        membersModal.addEventListener('click', (e) => {
            if (e.target === membersModal) {
                membersModal.style.display = 'none';
            }
        });
    }

    // بستن مودال کاربران حذف‌شده
    const closeBannedUsersModal = document.getElementById('close-banned-users-modal');
    const bannedUsersModal = document.getElementById('banned-users-modal');

    if (closeBannedUsersModal) {
        closeBannedUsersModal.addEventListener('click', () => {
            bannedUsersModal.style.display = 'none';
        });
    }

    if (bannedUsersModal) {
        bannedUsersModal.addEventListener('click', (e) => {
            if (e.target === bannedUsersModal) {
                bannedUsersModal.style.display = 'none';
            }
        });
    }

    // دکمه نمایش کاربران حذف‌شده
    const viewBannedUsersBtn = document.getElementById('view-banned-users-btn');
    if (viewBannedUsersBtn) {
        viewBannedUsersBtn.addEventListener('click', () => {
            // دریافت groupId از data attribute اگر موجود باشد
            const bannedUsersSection = document.getElementById('banned-users-section');
            const groupId = bannedUsersSection ? bannedUsersSection.dataset.groupId : null;
            showBannedUsersModal(groupId);
        });
    }

    // مودال تنظیمات
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsModal = document.getElementById('close-settings-modal');

    // دکمه تنظیمات فقط در صفحه خوش‌آمدگویی است

    if (closeSettingsModal) {
        closeSettingsModal.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });
    }

    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.style.display = 'none';
            }
        });
    }

    // مودال اطلاعات کاربر
    const closeUserInfoModal = document.getElementById('close-user-info-modal');
    const userInfoModal = document.getElementById('user-info-modal');

    if (closeUserInfoModal) {
        closeUserInfoModal.addEventListener('click', () => {
            userInfoModal.style.display = 'none';
        });
    }

    if (userInfoModal) {
        userInfoModal.addEventListener('click', (e) => {
            if (e.target === userInfoModal) {
                userInfoModal.style.display = 'none';
            }
        });
    }

    // دکمه ارسال پیام در مودال اطلاعات کاربر
    const sendMessageToUserBtn = document.getElementById('send-message-to-user-btn');
    if (sendMessageToUserBtn) {
        sendMessageToUserBtn.addEventListener('click', () => {
            const targetUsername = document.getElementById('user-info-name').textContent;
            userInfoModal.style.display = 'none';
            openPrivateChat(targetUsername);
        });
    }

    // دکمه logout و Change password راه‌اندازی شده در auth.js

    // دکمه گروه/کانال جدید
    const newChatBtn = document.getElementById('new-chat-btn');
    const newChatModal = document.getElementById('new-chat-modal');
    const closeNewChatModal = document.getElementById('close-new-chat-modal');

    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            newChatModal.style.display = 'flex';
        });
    }

    if (closeNewChatModal) {
        closeNewChatModal.addEventListener('click', () => {
            newChatModal.style.display = 'none';
        });
    }

    if (newChatModal) {
        newChatModal.addEventListener('click', (e) => {
            if (e.target === newChatModal) {
                newChatModal.style.display = 'none';
            }
        });
    }

    // دکمه ساخت گروه
    const createGroupBtn = document.getElementById('create-group-btn');
    const createGroupModal = document.getElementById('create-group-modal');
    const closeCreateGroupModal = document.getElementById('close-create-group-modal');
    const confirmCreateGroupBtn = document.getElementById('confirm-create-group-btn');

    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', () => {
            newChatModal.style.display = 'none';
            createGroupModal.style.display = 'flex';
        });
    }

    if (closeCreateGroupModal) {
        closeCreateGroupModal.addEventListener('click', () => {
            createGroupModal.style.display = 'none';
            resetGroupForm();
        });
    }

    if (createGroupModal) {
        createGroupModal.addEventListener('click', (e) => {
            if (e.target === createGroupModal) {
                createGroupModal.style.display = 'none';
                resetGroupForm();
            }
        });
    }

    if (confirmCreateGroupBtn) {
        confirmCreateGroupBtn.addEventListener('click', createGroup);
    }

    // آپلود عکس گروه جدید
    const newGroupPictureInput = document.getElementById('new-group-picture-input');
    if (newGroupPictureInput) {
        newGroupPictureInput.addEventListener('change', handleNewGroupPictureUpload);
    }

    // همچنین به محض تایپ نام گروه یا کانال، آواتار پیش‌نمایش را به‌روزرسانی کن
    const groupNameInput = document.getElementById('group-name-input');
    const groupIdInput = document.getElementById('group-id-input');
    const groupDescInput = document.getElementById('group-description-input');
    const newGroupAvatar = document.getElementById('new-group-avatar');
    if (groupNameInput) {
        enableEmojiEditable(groupNameInput);
        if (newGroupAvatar) {
            groupNameInput.addEventListener('input', () => {
                updateAvatarFromName(getTextWithEmoji(groupNameInput), newGroupAvatar);
            });
        }
    }
    if (groupIdInput) enableEmojiEditable(groupIdInput);
    if (groupDescInput) enableEmojiEditable(groupDescInput);

    const channelNameInput = document.getElementById('channel-name-input');
    const channelIdInput = document.getElementById('channel-id-input');
    const channelDescInput = document.getElementById('channel-description-input');
    const newChannelAvatar = document.getElementById('new-channel-avatar');
    if (channelNameInput) {
        enableEmojiEditable(channelNameInput);
        if (newChannelAvatar) {
            channelNameInput.addEventListener('input', () => {
                updateAvatarFromName(getTextWithEmoji(channelNameInput), newChannelAvatar);
            });
        }
    }
    if (channelIdInput) enableEmojiEditable(channelIdInput);
    if (channelDescInput) enableEmojiEditable(channelDescInput);

    // به‌روز رسانی آواتار پیش‌نمایش بر اساس نام وارد شده (برای پرچم ایران نیز کار می‌کند)
    function updateAvatarFromName(name, avatarEl) {
        if (!avatarEl) return;
        const iranFlag = '🇮🇷';
        const trimmed = name.trim();
        if (trimmed.startsWith(iranFlag)) {
            const src = (typeof encryptedAssets !== 'undefined' && encryptedAssets.iranFlag)
                ? 'data:image/svg+xml;base64,' + encryptedAssets.iranFlag
                : null;
            if (src) {
                avatarEl.style.backgroundImage = `url(${src})`;
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.style.backgroundPosition = 'center';
                avatarEl.textContent = '';
                return;
            }
        }
        // otherwise fall back to first character
        avatarEl.style.backgroundImage = 'none';
        avatarEl.textContent = trimmed.charAt(0).toUpperCase() || '';
    }

    // دکمه ساخت کانال
    const createChannelBtn = document.getElementById('create-channel-btn');
    const createChannelModal = document.getElementById('create-channel-modal');
    const closeCreateChannelModal = document.getElementById('close-create-channel-modal');
    const confirmCreateChannelBtn = document.getElementById('confirm-create-channel-btn');

    if (createChannelBtn) {
        createChannelBtn.addEventListener('click', () => {
            newChatModal.style.display = 'none';
            createChannelModal.style.display = 'flex';
        });
    }

    if (closeCreateChannelModal) {
        closeCreateChannelModal.addEventListener('click', () => {
            createChannelModal.style.display = 'none';
            resetChannelForm();
        });
    }

    if (createChannelModal) {
        createChannelModal.addEventListener('click', (e) => {
            if (e.target === createChannelModal) {
                createChannelModal.style.display = 'none';
                resetChannelForm();
            }
        });
    }

    if (confirmCreateChannelBtn) {
        confirmCreateChannelBtn.addEventListener('click', createChannel);
    }

    // آپلود عکس کانال جدید
    const newChannelPictureInput = document.getElementById('new-channel-picture-input');
    if (newChannelPictureInput) {
        newChannelPictureInput.addEventListener('change', handleNewChannelPictureUpload);
    }

    // آپلود عکس پروفایل
    const profilePictureInput = document.getElementById('profile-picture-input');
    if (profilePictureInput) {
        profilePictureInput.addEventListener('change', handleProfilePictureUpload);
    }

    // پیوست فایل
    const fileAttachmentInput = document.getElementById('file-attachment-input');
    if (fileAttachmentInput) {
        fileAttachmentInput.addEventListener('change', showFilesPreview);
    }

    // مودال پیش‌نمایش فایل‌ها
    const filesPreviewModal = document.getElementById('files-preview-modal');
    const closeFilesPreviewModal = document.getElementById('close-files-preview-modal');
    const sendFilesBtn = document.getElementById('send-files-btn');
    const cancelFilesBtn = document.getElementById('cancel-files-btn');

    if (closeFilesPreviewModal) {
        closeFilesPreviewModal.addEventListener('click', () => {
            filesPreviewModal.style.display = 'none';
            fileAttachmentInput.value = '';
        });
    }

    if (filesPreviewModal) {
        filesPreviewModal.addEventListener('click', (e) => {
            if (e.target === filesPreviewModal) {
                filesPreviewModal.style.display = 'none';
                fileAttachmentInput.value = '';
            }
        });
    }

    if (cancelFilesBtn) {
        cancelFilesBtn.addEventListener('click', () => {
            filesPreviewModal.style.display = 'none';
            fileAttachmentInput.value = '';
        });
    }

    if (sendFilesBtn) {
        sendFilesBtn.addEventListener('click', () => {
            filesPreviewModal.style.display = 'none';
            handleFileAttachment({ target: fileAttachmentInput });
        });
    }

    // دکمه ویرایش اطلاعات پروفایل
    const editProfileInfoBtn = document.getElementById('edit-profile-info-btn');
    if (editProfileInfoBtn) {
        editProfileInfoBtn.addEventListener('click', () => {
            // بستن مودال تنظیمات
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal) {
                settingsModal.style.display = 'none';
            }

            // باز کردن مودال ویرایش
            const editProfileModal = document.getElementById('edit-profile-modal');
            if (editProfileModal) {
                editProfileModal.style.display = 'flex';

                // پر کردن فیلدها با اطلاعات فعلی
                const editUsernameInput = document.getElementById('edit-username-input');
                const editUseridInput = document.getElementById('edit-userid-input');
                const editBioInput = document.getElementById('edit-bio-input');

                if (editUsernameInput && currentUser.username) {
                    editUsernameInput.innerText = currentUser.username;
                    enableEmojiEditable(editUsernameInput);
                }
                if (editUseridInput && currentUser.user_id) {
                    editUseridInput.innerText = currentUser.user_id;
                    enableEmojiEditable(editUseridInput);
                }
                if (editBioInput) {
                    editBioInput.innerText = currentUser.bio || '';
                    enableEmojiEditable(editBioInput);
                }

                // فوکوس روی اولین فیلد
                setTimeout(() => {
                    if (editUsernameInput) {
                        editUsernameInput.focus();
                    }
                }, 100);
            }
        });
    }

    // دکمه برگشت از مودال ویرایش پروفایل
    const closeEditProfileModal = document.getElementById('close-edit-profile-modal');
    const editProfileModal = document.getElementById('edit-profile-modal');

    if (closeEditProfileModal) {
        closeEditProfileModal.addEventListener('click', () => {
            // بستن مودال ویرایش و بازگشت به تنظیمات
            editProfileModal.style.display = 'none';
            showSettingsModal();
        });
    }

    if (editProfileModal) {
        editProfileModal.addEventListener('click', (e) => {
            if (e.target === editProfileModal) {
                // بستن مودال ویرایش و بازگشت به تنظیمات
                editProfileModal.style.display = 'none';
                showSettingsModal();
            }
        });
    }

    // دکمه تغییر رمز عبور - منتقل شده به auth.js

    // دکمه ذخیره اطلاعات پروفایل
    const saveProfileInfoBtn = document.getElementById('save-profile-info-btn');
    if (saveProfileInfoBtn) {
        saveProfileInfoBtn.addEventListener('click', async () => {
            const newUsername = getTextWithEmoji(document.getElementById('edit-username-input')).trim();
            const newUserid = getTextWithEmoji(document.getElementById('edit-userid-input')).trim();
            const newBio = getTextWithEmoji(document.getElementById('edit-bio-input')).trim();

            if (!newUsername) {
                alert('لطفاً نام کاربری را وارد کنید');
                return;
            }

            // بررسی فرمت آیدی
            if (newUserid) {
                const useridRegex = /^[a-z0-9_]+$/;
                if (!useridRegex.test(newUserid)) {
                    alert('فرمت آیدی نامعتبر است. فقط حروف انگلیسی کوچک، اعداد و _ مجاز است');
                    return;
                }
                if (newUserid.length < 3) {
                    alert('آیدی باید حداقل 3 کاراکتر باشد');
                    return;
                }
            }

            try {
                // آپدیت نام کاربری (اگر تغییر کرده)
                if (newUsername !== currentUser.username) {
                    const oldUsername = currentUser.username;

                    const response = await fetch('/api/update-username', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: currentUser.id,
                            newUsername: newUsername
                        })
                    });

                    const data = await response.json();

                    if (data.success) {
                        currentUser.username = newUsername;
                        username = newUsername;
                        localStorage.setItem('currentUser', JSON.stringify(currentUser));

                        // آپدیت نمایش
                        const profileName = document.getElementById('profile-name');
                        if (profileName) {
                            profileName.textContent = newUsername;
                            try {
                                if (typeof parseEmojis !== 'undefined') {
                                    parseEmojis(profileName);
                                } else if (typeof replaceIranFlag !== 'undefined') {
                                    replaceIranFlag(profileName);
                                }
                            } catch (err) {
                                console.error('parseEmojis on profileName failed', err);
                            }
                            // همچنین اگر در بخش نمایش اطلاعات کاربر نام وجود داره، رندر کن
                            const userInfoName = document.getElementById('user-info-name');
                            if (userInfoName) {
                                userInfoName.textContent = newUsername;
                                try {
                                    if (typeof parseEmojis !== 'undefined') {
                                        parseEmojis(userInfoName);
                                    } else if (typeof replaceIranFlag !== 'undefined') {
                                        replaceIranFlag(userInfoName);
                                    }
                                } catch (err) {
                                    console.error('parseEmojis on userInfoName failed', err);
                                }
                            }
                        }

                        // به‌روزرسانی نام کاربری در تمام پیام‌های نمایش داده شده
                        updateUsernameInDOM(oldUsername, newUsername);
                    } else {
                        alert(data.error || 'خطا در ذخیره نام کاربری');
                        return;
                    }
                }

                // آپدیت آیدی (اگر تغییر کرده)
                if (newUserid && newUserid !== currentUser.user_id) {
                    const response = await fetch('/api/update-userid', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: currentUser.id,
                            newUserId: newUserid
                        })
                    });

                    const data = await response.json();

                    if (data.success) {
                        currentUser.user_id = newUserid;
                        localStorage.setItem('currentUser', JSON.stringify(currentUser));

                        // آپدیت نمایش
                        const profileUserid = document.getElementById('profile-userid');
                        if (profileUserid) {
                            profileUserid.textContent = `@${newUserid}`;
                        }
                    } else {
                        alert(data.error || 'خطا در ذخیره آیدی');
                        return;
                    }
                }

                // آپدیت بیوگرافی
                if (newBio !== (currentUser.bio || '')) {
                    const bioResponse = await fetch('/api/update-bio', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: currentUser.id,
                            bio: newBio
                        })
                    });

                    const bioData = await bioResponse.json();

                    if (bioData.success) {
                        currentUser.bio = newBio;
                        localStorage.setItem('currentUser', JSON.stringify(currentUser));
                        // also update the profile bio element if visible
                        const profileBioEl = document.getElementById('profile-bio');
                        if (profileBioEl) {
                            if (newBio && newBio.trim()) {
                                profileBioEl.textContent = newBio;
                                profileBioEl.classList.remove('empty-bio');
                                try {
                                    if (typeof parseEmojis !== 'undefined') {
                                        parseEmojis(profileBioEl);
                                    } else if (typeof replaceIranFlag !== 'undefined') {
                                        replaceIranFlag(profileBioEl);
                                    }
                                } catch (err) {
                                    console.error('emoji rendering on profileBio failed', err);
                                }
                            } else {
                                profileBioEl.textContent = 'درباره خودتان بنویسید';
                                profileBioEl.classList.add('empty-bio');
                            }
                            profileBioEl.style.display = 'block';
                        }
                    } else {
                        alert(bioData.error || 'خطا در ذخیره بیوگرافی');
                        return;
                    }
                }

                alert('اطلاعات با موفقیت ذخیره شد');

                // بستن مودال ویرایش
                const editProfileModal = document.getElementById('edit-profile-modal');
                if (editProfileModal) {
                    editProfileModal.style.display = 'none';
                }

                // باز کردن مجدد مودال تنظیمات با اطلاعات جدید
                showSettingsModal();

            } catch (error) {
                console.error('Save profile info error:', error);
                alert('خطا در ذخیره اطلاعات');
            }
        });
    }

    // دکمه اسکرول به پایین
    const scrollToBottomBtn = document.getElementById('scroll-to-bottom');
    const messagesArea = document.getElementById('messages');

    if (scrollToBottomBtn && messagesArea) {
        // نمایش/مخفی کردن دکمه بر اساس موقعیت اسکرول
        messagesArea.addEventListener('scroll', () => {
            const isAtBottom = messagesArea.scrollHeight - messagesArea.scrollTop <= messagesArea.clientHeight + 100;
            const isAtTop = messagesArea.scrollTop < 100;

            if (isAtBottom) {
                scrollToBottomBtn.style.display = 'none';
            } else {
                scrollToBottomBtn.style.display = 'flex';
            }

            // بارگذاری پیام‌های قدیمی‌تر وقتی به بالا رسیدیم
            if (isAtTop && !isLoadingOlderMessages) {
                loadOlderMessages();
            }
        });

        // کلیک روی دکمه برای اسکرول به پایین
        scrollToBottomBtn.addEventListener('click', () => {
            messagesArea.scrollTo({
                top: messagesArea.scrollHeight,
                behavior: 'smooth'
            });
        });
    }

    // دکمه پیوستن به گروه/کانال
    const joinGroupBtn = document.getElementById('join-group-btn');
    if (joinGroupBtn) {
        joinGroupBtn.addEventListener('click', async () => {
            const joinGroupArea = document.getElementById('join-group-area');
            const groupId = joinGroupArea.dataset.groupId;
            const groupName = joinGroupArea.dataset.groupName;
            const groupType = joinGroupArea.dataset.groupType;
            const profilePicture = joinGroupArea.dataset.profilePicture;

            if (!groupId) {
                alert('خطا در پیوستن به گروه');
                return;
            }

            try {
                // ارسال درخواست پیوستن
                const response = await fetch('/api/join-group', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupId, userId: currentUser.id })
                });

                const data = await response.json();

                if (data.success) {
                    // پیوستن موفق - مخفی کردن دکمه
                    joinGroupArea.style.display = 'none';
                    // نمایش پیام شیشه‌ای برای گروه/گروه عمومی (نه کانال)
                    if (groupType !== 'کانال') {
                        addSystemMessage('شما به گروه پیوستید', new Date().toISOString());
                    }

                    // اگر کانال است، بررسی کن که ادمین هست یا نه
                    if (groupType === 'channel') {
                        const adminResponse = await fetch('/api/check-admin', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ groupId, userId: currentUser.id })
                        });

                        const adminData = await adminResponse.json();

                        if (adminData.success && adminData.isAdmin) {
                            // ادمین است - نمایش کیبورد
                            document.querySelector('.message-input-area').style.display = 'flex';
                        }
                    }
                } else {
                    // نمایش پیغام خطا (مثلاً محروم بودن)
                    alert(data.error || 'پیوستن به گروه ناموفق بود');
                }
            } catch (err) {
                console.error('Error joining group:', err);
                alert('خطا در برقراری ارتباط با سرور');
            }
        });
    }


    // دکمه ویرایش اطلاعات گروه
    const editGroupInfoBtn = document.getElementById('edit-group-info-btn');
    if (editGroupInfoBtn) {
        editGroupInfoBtn.addEventListener('click', () => {
            // باز کردن مودال ویرایش
            const editGroupModal = document.getElementById('edit-group-modal');
            if (editGroupModal) {
                editGroupModal.style.display = 'flex';

                // پر کردن فیلدها با اطلاعات فعلی
                const groupInfoName = document.querySelector('.group-info-name');
                const groupInfoUserid = document.getElementById('group-info-userid-copy');
                const groupInfoDescription = document.getElementById('group-info-description');
                const groupInfoAvatar = document.getElementById('group-info-avatar-display');

                const editModalName = document.getElementById('edit-modal-group-name');
                const editModalUserid = document.getElementById('edit-modal-group-userid');
                const editModalDescription = document.getElementById('edit-modal-group-description');
                const editModalAvatar = document.getElementById('edit-group-avatar-display');

                if (editModalName && groupInfoName) {
                    const nameText = getTextWithEmoji(groupInfoName).replace(/^[🌐👥📢]\s*/, '');
                    editModalName.innerText = nameText;
                    enableEmojiEditable(editModalName);
                }

                if (editModalUserid && groupInfoUserid) {
                    const useridText = groupInfoUserid.textContent.replace('@', '').replace('📋', '').trim();
                    editModalUserid.innerText = useridText;
                    enableEmojiEditable(editModalUserid);
                }

                if (editModalDescription && groupInfoDescription) {
                    editModalDescription.innerText = groupInfoDescription.textContent || '';
                    enableEmojiEditable(editModalDescription);
                }

                if (editModalAvatar && groupInfoAvatar) {
                    editModalAvatar.innerHTML = groupInfoAvatar.innerHTML;
                }

                // هنگام تایپ نام جدید در فرم ویرایش آواتار را نیز به‌روزرسانی کن
                if (editModalName && editModalAvatar) {
                    editModalName.addEventListener('input', () => {
                        updateAvatarFromName(getTextWithEmoji(editModalName), editModalAvatar);
                    });
                }

                // فوکوس روی اولین input
                setTimeout(() => {
                    if (editModalName) {
                        editModalName.focus();
                    }
                }, 100);
            }
        });
    }

    // بستن مودال ویرایش گروه
    const closeEditGroupModal = document.getElementById('close-edit-group-modal');
    const editGroupModal = document.getElementById('edit-group-modal');

    if (closeEditGroupModal) {
        closeEditGroupModal.addEventListener('click', () => {
            editGroupModal.style.display = 'none';
        });
    }

    if (editGroupModal) {
        editGroupModal.addEventListener('click', (e) => {
            if (e.target === editGroupModal) {
                editGroupModal.style.display = 'none';
            }
        });
    }

    // آپلود عکس پروفایل گروه در مودال ویرایش
    const editGroupProfileInput = document.getElementById('edit-group-profile-input');
    if (editGroupProfileInput) {
        editGroupProfileInput.addEventListener('change', handleGroupProfileUpload);
    }

    // دکمه ذخیره اطلاعات گروه/کانال در مودال ویرایش
    const saveEditGroupInfoBtn = document.getElementById('save-edit-group-info-btn');
    if (saveEditGroupInfoBtn) {
        saveEditGroupInfoBtn.addEventListener('click', async () => {
            const groupId = currentChat;
            const newName = getTextWithEmoji(document.getElementById('edit-modal-group-name')).trim();
            const newUserid = getTextWithEmoji(document.getElementById('edit-modal-group-userid')).trim();
            const newDescription = getTextWithEmoji(document.getElementById('edit-modal-group-description')).trim();

            if (!groupId || (!groupId.startsWith('group_') && !groupId.startsWith('channel_') && groupId !== 'global')) {
                alert('لطفاً ابتدا یک گروه یا کانال را باز کنید');
                return;
            }

            if (!newName) {
                alert('لطفاً نام جدید را وارد کنید');
                return;
            }

            // بررسی فرمت آیدی
            if (newUserid) {
                const useridRegex = /^[a-z0-9_]+$/;
                if (!useridRegex.test(newUserid)) {
                    alert('فرمت آیدی نامعتبر است. فقط حروف انگلیسی کوچک، اعداد و _ مجاز است');
                    return;
                }
                if (newUserid.length < 3) {
                    alert('آیدی باید حداقل 3 کاراکتر باشد');
                    return;
                }
            }

            try {
                const response = await fetch('/api/update-group-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        groupId,
                        userId: currentUser.id,
                        updates: {
                            name: newName,
                            userid: newUserid,
                            description: newDescription
                        }
                    })
                });

                const data = await response.json();

                if (data.success) {
                    alert('اطلاعات با موفقیت ذخیره شد');

                    // آپدیت نام در هدر
                    const chatHeaderName = document.querySelector('.chat-header-name');
                    if (chatHeaderName) {
                        const icon = groupId.startsWith('channel_') ? '📢' : (groupId === 'global' ? '🌐' : '👥');
                        chatHeaderName.innerHTML = escapeHtml(`${icon} ${newName}`);
                        try {
                            if (typeof parseEmojis !== 'undefined') parseEmojis(chatHeaderName);
                            else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(chatHeaderName);
                        } catch (err) {
                            console.error('parseEmojis on chatHeaderName failed', err);
                        }
                    }

                    // آپدیت نام در مودال اطلاعات
                    const groupInfoName = document.querySelector('.group-info-name');
                    if (groupInfoName) {
                        const icon = groupId.startsWith('channel_') ? '📢' : (groupId === 'global' ? '🌐' : '👥');
                        groupInfoName.textContent = `${icon} ${newName}`;
                        try {
                            if (typeof parseEmojis !== 'undefined') parseEmojis(groupInfoName);
                            else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(groupInfoName);
                        } catch (err) {
                            console.error('parseEmojis on groupInfoName failed', err);
                        }
                    }

                    // آپدیت آیدی در مودال اطلاعات
                    const groupInfoUserid = document.getElementById('group-info-userid-copy');
                    if (groupInfoUserid && newUserid) {
                        groupInfoUserid.innerHTML = `@${newUserid} <span class="copy-icon">📋</span>`;
                    }

                    // آپدیت بیوگرافی در مودال اطلاعات
                    const groupInfoDescription = document.getElementById('group-info-description');
                    if (groupInfoDescription) {
                        if (newDescription && newDescription.trim()) {
                            groupInfoDescription.textContent = newDescription;
                            try {
                                if (typeof parseEmojis !== 'undefined') {
                                    parseEmojis(groupInfoDescription);
                                } else if (typeof replaceIranFlag !== 'undefined') {
                                    replaceIranFlag(groupInfoDescription);
                                }
                            } catch (err) {
                                console.error('emoji rendering on groupInfoDescription failed', err);
                            }
                            groupInfoDescription.style.display = 'block';
                        } else {
                            groupInfoDescription.style.display = 'none';
                        }
                    }

                    // آپدیت نام در سایدبار
                    const chatItem = document.querySelector(`[data-chat="${groupId}"]`);
                    if (chatItem) {
                        const chatName = chatItem.querySelector('.chat-name');
                        if (chatName) {
                            const icon = groupId.startsWith('channel_') ? '📢' : (groupId === 'global' ? '🌐' : '👥');
                            chatName.textContent = `${icon} ${newName}`;
                            try {
                                if (typeof parseEmojis !== 'undefined') parseEmojis(chatName);
                            } catch (err) {
                                console.error('parseEmojis on chatItem.chatName failed', err);
                            }
                        }
                        const chatLastMessage = chatItem.querySelector('.chat-last-message');
                        if (chatLastMessage && newUserid) {
                            chatLastMessage.textContent = `@${newUserid}`;
                        }
                    }

                    // بستن مودال ویرایش
                    editGroupModal.style.display = 'none';
                    // اگر گروه عمومی است، دوباره تنظیمات را از سرور بخوان تا کش یا آواتار به‌روز شود
                    if (groupId === 'global') loadGroupProfile();
                } else {
                    alert(data.error || 'خطا در ذخیره اطلاعات');
                }
            } catch (error) {
                console.error('Save group info error:', error);
                alert('خطا در ذخیره اطلاعات');
            }
        });
    }

    // دکمه ادمین - باز کردن مودال مدیریت دیتابیس
    const adminBtn = document.getElementById('admin-btn');
    const adminDatabaseModal = document.getElementById('admin-database-modal');

    if (adminBtn) {
        adminBtn.addEventListener('click', () => {
            // بستن مودال تنظیمات
            const settingsModalEl = document.getElementById('settings-modal');
            if (settingsModalEl) {
                settingsModalEl.style.display = 'none';
            }
            // باز کردن مودال مدیریت دیتابیس
            if (adminDatabaseModal) {
                adminDatabaseModal.style.display = 'flex';
            }
        });
    }

    // بستن مودال مدیریت دیتابیس و بازگشت به تنظیمات
    const closeAdminDatabaseModal = document.getElementById('close-admin-database-modal');
    if (closeAdminDatabaseModal) {
        closeAdminDatabaseModal.addEventListener('click', () => {
            if (adminDatabaseModal) {
                adminDatabaseModal.style.display = 'none';
            }
            // بازگشت به تنظیمات
            showSettingsModal();
        });
    }

    // کلیک روی پس‌زمینه برای بستن مودال و بازگشت به تنظیمات
    if (adminDatabaseModal) {
        adminDatabaseModal.addEventListener('click', (e) => {
            if (e.target === adminDatabaseModal) {
                adminDatabaseModal.style.display = 'none';
                showSettingsModal();
            }
        });
    }

    // دکمه مدیریت دیتابیس
    const databaseManagementBtn = document.getElementById('database-management-btn');
    const databaseListModal = document.getElementById('database-list-modal');

    if (databaseManagementBtn) {
        databaseManagementBtn.addEventListener('click', () => {
            // بستن مودال مدیریت
            if (adminDatabaseModal) {
                adminDatabaseModal.style.display = 'none';
            }
            // باز کردن مودال لیست دیتابیس‌ها
            if (databaseListModal) {
                databaseListModal.style.display = 'flex';
            }
        });
    }

    // دکمه بازگشت از لیست دیتابیس‌ها
    const backToAdminBtn = document.getElementById('back-to-admin-btn');
    if (backToAdminBtn) {
        backToAdminBtn.addEventListener('click', () => {
            if (databaseListModal) {
                databaseListModal.style.display = 'none';
            }
            if (adminDatabaseModal) {
                adminDatabaseModal.style.display = 'flex';
            }
        });
    }

    // کلیک روی پس‌زمینه مودال لیست دیتابیس‌ها
    if (databaseListModal) {
        databaseListModal.addEventListener('click', (e) => {
            if (e.target === databaseListModal) {
                databaseListModal.style.display = 'none';
                if (adminDatabaseModal) {
                    adminDatabaseModal.style.display = 'flex';
                }
            }
        });
    }

    // دکمه‌های دانلود دیتابیس
    const downloadBtns = document.querySelectorAll('.database-action-btn.download-btn');
    downloadBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const dbName = btn.getAttribute('data-db');
            try {
                const response = await fetch(`/api/admin/download-database/${dbName}`, {
                    method: 'GET'
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${dbName}.db`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    alert('دیتابیس با موفقیت دانلود شد');
                } else {
                    const data = await response.json();
                    alert(data.error || 'خطا در دانلود دیتابیس');
                }
            } catch (error) {
                console.error('Download database error:', error);
                alert('خطا در دانلود دیتابیس');
            }
        });
    });

    // دکمه‌های آپلود دیتابیس
    const uploadInputs = document.querySelectorAll('input[type="file"][id^="upload-"]');
    uploadInputs.forEach(input => {
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const dbName = input.getAttribute('data-db');
            const dbLabel = dbName === 'users' ? 'کاربران' : 'پیام‌ها';

            // بررسی پسوند فایل
            if (!file.name.endsWith('.db')) {
                alert('لطفاً فقط فایل‌های .db را آپلود کنید');
                input.value = '';
                return;
            }

            const confirmed = confirm(`آیا مطمئن هستید که می‌خواهید دیتابیس ${dbLabel} را با این فایل جایگزین کنید؟\n\n⚠️ دیتابیس فعلی جایگزین خواهد شد و سرور restart می‌شود!\n\n✓ یک نسخه پشتیبان از دیتابیس فعلی ذخیره خواهد شد.`);

            if (!confirmed) {
                input.value = '';
                return;
            }

            // نمایش پیام در حال آپلود
            const loadingMsg = document.createElement('div');
            loadingMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 20px 40px; border-radius: 10px; z-index: 10000; font-size: 16px;';
            loadingMsg.textContent = 'در حال آپلود دیتابیس...';
            document.body.appendChild(loadingMsg);

            try {
                const formData = new FormData();
                formData.append('database', file);

                const response = await fetch(`/api/admin/upload-database/${dbName}`, {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();

                document.body.removeChild(loadingMsg);

                if (data.success) {
                    const successMsg = `✓ دیتابیس با موفقیت جایگزین شد!\n\n` +
                        `📁 فایل پشتیبان: ${dbName}.db.backup\n\n` +
                        `⚠️ برای اعمال کامل تغییرات:\n` +
                        `1. صفحه refresh می‌شود\n` +
                        `2. سرور را restart کنید\n\n` +
                        `نحوه restart:\n` +
                        `• nodemon: در ترمینال "rs" تایپ کنید\n` +
                        `• PM2: pm2 restart groogp\n` +
                        `• معمولی: Ctrl+C و node server.js`;

                    alert(successMsg);

                    // اگر نیاز به reload صفحه است
                    if (data.reloadPage) {
                        const reloadMsg = document.createElement('div');
                        reloadMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.9); color: white; padding: 30px 50px; border-radius: 15px; z-index: 10000; font-size: 18px; text-align: center;';
                        reloadMsg.innerHTML = 'دیتابیس جایگزین شد!<br><br>صفحه در حال بارگذاری مجدد است...';
                        document.body.appendChild(reloadMsg);

                        // reload صفحه بعد از 2 ثانیه
                        setTimeout(() => {
                            window.location.reload();
                        }, 2000);
                    }
                } else {
                    alert(data.error || 'خطا در آپلود دیتابیس');
                }
            } catch (error) {
                if (loadingMsg.parentNode) {
                    document.body.removeChild(loadingMsg);
                }
                console.error('Upload database error:', error);
                alert('خطا در آپلود دیتابیس');
            } finally {
                input.value = '';
            }
        });
    });

    // دکمه‌های حذف دیتابیس
    const deleteBtns = document.querySelectorAll('.database-action-btn.delete-btn');
    deleteBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const dbName = btn.getAttribute('data-db');
            const dbLabel = dbName === 'users' ? 'کاربران' : 'پیام‌ها';

            const confirmed = confirm(`آیا مطمئن هستید که می‌خواهید تمام داده‌های دیتابیس ${dbLabel} را پاک کنید؟\n\n⚠️ این عملیات غیرقابل بازگشت است و تمام اطلاعات حذف خواهند شد!`);

            if (confirmed) {
                try {
                    const response = await fetch(`/api/admin/delete-database/${dbName}`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ userId: currentUser.id })
                    });

                    const data = await response.json();

                    if (data.success) {
                        alert(data.message || 'دیتابیس با موفقیت پاک شد');
                    } else {
                        alert(data.error || 'خطا در پاک کردن دیتابیس');
                    }
                } catch (error) {
                    console.error('Delete database error:', error);
                    alert('خطا در پاک کردن دیتابیس');
                }
            }
        });
    });

    // راه‌اندازی منوهای زمینه‌ای و انتخابگر ایموجی
    initMessageContextMenu();
    initEmojiPicker();
});

// Keypress handlers for auth moved to auth.js

// monkey-patch fetch to inject Authorization header when a token is available
(function () {
    const originalFetch = window.fetch;
    window.fetch = function (url, options = {}) {
        options.headers = options.headers || {};
        const token = currentUser?.token || localStorage.getItem('authToken');
        if (token) {
            options.headers['Authorization'] = 'Bearer ' + token;
        }
        return originalFetch(url, options);
    };
})();

// Google Login rendering moved to auth.js

function connectToServer() {
    // بررسی وجود currentUser
    if (!currentUser || !currentUser.id) {
        console.error('کاربر لاگین نکرده است');
        localStorage.removeItem('currentUser');
        loginModal.style.display = 'flex';
        appContainer.style.display = 'none';
        return;
    }

    // بستن اتصال قبلی اگر وجود داشته باشد
    if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close();
    }

    // ریست کردن flag
    privateChatsLoaded = false;

    // ensure we have a token before attempting connect
    const token = currentUser?.token || localStorage.getItem('authToken');
    if (!token) {
        console.warn('no auth token available, redirecting to login');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('authToken');
        loginModal.style.display = 'flex';
        appContainer.style.display = 'none';
        return;
    }
    console.log('connectToServer: using token', token);

    // تشخیص خودکار آدرس سرور
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;

    // برای Railway و production، پورت رو نباید اضافه کنیم
    let wsUrl;
    if (window.location.port) {
        // محیط local
        wsUrl = `${protocol}//${host}:${window.location.port}`;
    } else {
        // محیط production (Railway)
        wsUrl = `${protocol}//${host}`;
    }

    // attach token as query parameter (may be stripped by COOP/etc)
    wsUrl += `?token=${encodeURIComponent(token)}`;

    console.log('WebSocket URL', wsUrl);

    // debug log removed
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'join',
            profilePicture: currentUser.profile_picture,
            token // include as fallback in payload
            // username and userId are derived server-side from token
        }));
        loginModal.style.display = 'none';
        appContainer.style.display = 'flex';
        messageInput.setAttribute('contenteditable', 'false');
        sendBtn.disabled = true;
        // reset retry counter on successful connection
        wsRetryCount = 0;

        // Initialize hardware back button state on first run
        if (!window.historyInitDone) {
            history.pushState({ appInit: true }, '');
            history.pushState({ canGoBack: true }, '');
            window.historyInitDone = true;
        }

        // همیشه صفحه خوش‌آمدگویی را نمایش بده
        showWelcomeScreen();

        // بارگذاری پروفایل گروه از سرور
        loadGroupProfile();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'message') {
            // بررسی اینکه آیا پیام فایل است
            let messageText = data.text;
            let fileData = null;
            let replyTo = data.replyTo || null;

            if (data.isFile && data.fileData) {
                fileData = data.fileData;
            } else if (messageText && messageText.startsWith('[FILE:')) {
                // پارس کردن فایل از متن
                try {
                    // استخراج JSON از داخل [FILE:...]
                    const startIndex = messageText.indexOf('{');
                    const endIndex = messageText.lastIndexOf('}');
                    if (startIndex !== -1 && endIndex !== -1) {
                        const fileJson = messageText.substring(startIndex, endIndex + 1);
                        fileData = JSON.parse(fileJson);
                        messageText = ''; // متن خالی برای پیام فایل
                    }
                } catch (e) {
                    console.error('Error parsing file data:', e);
                }
            }

            // حذف کش - دیگر پیام‌ها را کش نمیکنیم

            if (currentChat === 'global') {
                // بررسی اینکه آیا پیام سیستمی است
                if (data.username === 'system') {
                    addSystemMessage(messageText, data.timestamp);
                } else if (fileData) {
                    addFileMessage(data.username, fileData, data.username === username, data.timestamp, data.messageId, false, replyTo);
                } else {
                    addMessage(data.username, messageText, data.username === username, data.timestamp, data.messageId, false, replyTo);
                }

                // ذخیره آخرین ID پیام
                if (data.messageId && data.messageId > lastGroupMessageId) {
                    lastGroupMessageId = data.messageId;
                }

                // اگر پیام از طرف دیگری بود و ما توی گروه هستیم، بلافاصله به عنوان خوانده شده علامت بزن
                if (data.username !== username) {
                    setTimeout(() => {
                        if (lastGroupMessageId > 0) {
                            markGroupMessagesAsRead();
                        }
                    }, 500);
                }
            } else {
                // اگر در گروه نیستیم، badge را آپدیت کن
                updateGroupUnreadBadge();
            }
            // آپدیت آخرین پیام گروه در sidebar
            const displayText = fileData ? `📎 ${fileData.fileName}` : messageText;
            updateGroupLastMessage(displayText, data.timestamp);
        } else if (data.type === 'private_message') {
            // پیام خصوصی
            const otherUser = data.from === username ? data.to : data.from;
            let replyTo = data.replyTo || null;

            // update map with profile picture if provided (fixes missing avatars)
            if (data.profilePicture) {
                usersProfilePictureMap.set(data.from, data.profilePicture);
                // update sidebar/chat list avatar if already present
                const chatItem = document.querySelector(`[data-chat="${data.from}"]`);
                if (chatItem) {
                    const avatarDiv = chatItem.querySelector('.chat-avatar');
                    if (avatarDiv) {
                        avatarDiv.style.backgroundImage = `url("${data.profilePicture}")`;
                        avatarDiv.textContent = '';
                                avatarDiv.style.backgroundSize = 'cover';
                        avatarDiv.style.backgroundPosition = 'center';
                    }
                }
                // if we're currently viewing a chat with this user, refresh any existing message avatars
                if (currentChat === data.from) {
                    const messageItems = document.querySelectorAll('#messages .message-other');
                    messageItems.forEach(msg => {
                        const senderEl = msg.querySelector('.message-sender');
                        if (senderEl && senderEl.dataset.username === data.from) {
                            const av = msg.querySelector('.message-avatar');
                            if (av) {
                                av.style.backgroundImage = `url("${data.profilePicture}")`;
                                av.textContent = '';
                                av.style.backgroundSize = 'cover';
                                av.style.backgroundPosition = 'center';
                            }
                        }
                    });
                    // update header avatar too
                    const headerAvatar = document.querySelector('.chat-header-info .chat-avatar');
                    if (headerAvatar) {
                        headerAvatar.style.backgroundImage = `url("${data.profilePicture}")`;
                        headerAvatar.style.backgroundSize = 'cover';
                        headerAvatar.style.backgroundPosition = 'center';
                        headerAvatar.textContent = '';
                    }
                }
            }

            // بررسی اینکه آیا پیام فایل است
            let messageText = data.text;
            let fileData = null;

            if (data.isFile && data.fileData) {
                fileData = data.fileData;
            } else if (messageText && messageText.startsWith('[FILE:')) {
                try {
                    // استخراج JSON از داخل [FILE:...]
                    const startIndex = messageText.indexOf('{');
                    const endIndex = messageText.lastIndexOf('}');
                    if (startIndex !== -1 && endIndex !== -1) {
                        const fileJson = messageText.substring(startIndex, endIndex + 1);
                        fileData = JSON.parse(fileJson);
                        messageText = '';
                    }
                } catch (e) {
                    console.error('Error parsing file data:', e);
                }
            }

            // ذخیره پیام در حافظه
            if (!privateChats.has(otherUser)) {
                privateChats.set(otherUser, []);
                addPrivateChatToList(otherUser);
            }
            privateChats.get(otherUser).push({
                from: data.from,
                text: data.text,
                timestamp: data.timestamp
            });

            // نمایش پیام فقط اگر چت فعلی با همین کاربر است
            if (currentChat === otherUser) {
                if (fileData) {
                    addFileMessage(data.from, fileData, data.from === username, data.timestamp, null, false, replyTo);
                } else {
                    addMessage(data.from, messageText, data.from === username, data.timestamp, null, false, replyTo);
                }

                // اگر پیام از طرف مقابل بود، بلافاصله به عنوان خوانده شده علامت بزن
                if (data.from !== username) {
                    const otherUserId = usersIdMap.get(otherUser);
                    if (otherUserId) {
                        markMessagesAsRead(otherUserId);
                    }
                }
            }

            // آپدیت لیست چت‌ها
            const displayText = fileData ? `📎 ${fileData.fileName}` : messageText;
            updateChatLastMessage(otherUser, displayText, data.timestamp);
        } else if (data.type === 'edit_message') {
            // پیام ویرایش شده
            if (data.success) {
                const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
                if (messageElement) {
                    const messageTextElement = messageElement.querySelector('.message-text');
                    if (messageTextElement) {
                        // لینک‌گذاری آیدی‌ها و قرار دادن متن جدید
                        const linkedText = typeof linkifyUserIds === 'function' ? linkifyUserIds(data.newText) : data.newText;
                        messageTextElement.innerHTML = linkedText;

                        // اگر قبلاً نشان ویرایش موجود نیست، اضافه کن
                        let editedBadge = messageElement.querySelector('.edited-badge');
                        if (!editedBadge) {
                            editedBadge = document.createElement('span');
                            editedBadge.className = 'edited-badge';
                            editedBadge.textContent = '(ویرایش شده)';
                            const messageTime = messageElement.querySelector('.message-time');
                            if (messageTime) {
                                messageTime.insertBefore(editedBadge, messageTime.firstChild);
                            }
                        }
                    }
                }

                // فقط برای کسی که ویرایش کرده اعلان نشون بده
                if (data.editedBy && data.editedBy === currentUser.id) {
                    showToast('پیام ویرایش شد');
                }
            } else {
                showToast(data.error || 'خطا در ویرایش پیام');
            }
        } else if (data.type === 'users') {
            updateUsersList(data.users);
        } else if (data.type === 'users_with_ids') {
            // دریافت لیست کاربران با ID و وضعیت
            data.users.forEach(user => {
                usersIdMap.set(user.username, user.userId);
                if (user.profilePicture) {
                    usersProfilePictureMap.set(user.username, user.profilePicture);
                }
            });
            updateUsersList(data.users); // حالا آرایه‌ای از اشیاء با username و online است

            // بعد از دریافت لیست کاربران، چت‌های خصوصی را بارگذاری کن (فقط یک بار)
            if (!privateChatsLoaded && currentUser && currentUser.id) {
                privateChatsLoaded = true;
                loadPrivateChats();
                loadUserGroups(); // بارگذاری گروه‌ها و کانال‌ها
                // بارگذاری تعداد پیام‌های جدید گروه
                updateGroupUnreadBadge();
            }
        } else if (data.type === 'system') {
            if (currentChat === 'global') {
                addSystemMessage(data.text, data.timestamp || new Date().toISOString());
            }
        } else if (data.type === 'history') {
            // نمایش تاریخچه پیام‌های عمومی
            // فقط اگر در گروه عمومی هستیم، پیام‌ها رو نمایش بده
            if (currentChat === 'global') {
                messagesDiv.innerHTML = ''; // پاک کردن پیام‌های قبلی

                // پیدا کردن آخرین پیام خوانده شده توسط کاربر
                let lastReadMessageId = data.lastReadMessageId !== undefined ? data.lastReadMessageId : null;
                let hasUnreadMessages = false;

                // بررسی اینکه آیا پیام خوانده نشده وجود داره
                if (lastReadMessageId !== null && data.messages.length > 0) {
                    for (let i = 0; i < data.messages.length; i++) {
                        const msg = data.messages[i];
                        if (msg.id > lastReadMessageId) {
                            hasUnreadMessages = true;
                            break;
                        }
                    }
                }

                data.messages.forEach((msg, index) => {
                    // if history contains a system message we render differently
                    if (msg.message_type === 'system' || msg.username === 'system') {
                        addSystemMessage(msg.message, msg.created_at || new Date().toISOString());
                        // update read/ids as usual
                        if (msg.id > lastGroupMessageId) lastGroupMessageId = msg.id;
                        if (!oldestGroupMessageId || msg.id < oldestGroupMessageId) oldestGroupMessageId = msg.id;
                        return;
                    }

                    const isOwn = msg.username === username;
                    const isRead = msg.is_read === 1;

                    // بررسی اینکه آیا پیام فایل است
                    let fileData = null;
                    if (msg.message && msg.message.startsWith('[FILE:')) {
                        try {
                            // استخراج JSON از داخل [FILE:...]
                            const startIndex = msg.message.indexOf('{');
                            const endIndex = msg.message.lastIndexOf('}');
                            if (startIndex !== -1 && endIndex !== -1) {
                                const fileJson = msg.message.substring(startIndex, endIndex + 1);
                                fileData = JSON.parse(fileJson);
                            }
                        } catch (e) {
                            console.error('Error parsing file data:', e);
                        }
                    }

                    if (fileData) {
                        addFileMessage(msg.username, fileData, isOwn, msg.created_at, msg.id, isRead, msg.reply_to);
                    } else {
                        addMessage(msg.username, msg.message, isOwn, msg.created_at, msg.id, isRead, msg.reply_to);
                    }

                    // اگر این آخرین پیام خوانده شده است و پیام خوانده نشده وجود دارد، separator اضافه کن
                    if (hasUnreadMessages && lastReadMessageId !== null && msg.id === lastReadMessageId) {
                        // بررسی که separator قبلاً وجود نداره
                        const existingSeparator = messagesDiv.querySelector('.unread-separator');
                        if (!existingSeparator) {
                            const separator = document.createElement('div');
                            separator.className = 'unread-separator';
                            separator.innerHTML = '<span>پیام‌های جدید</span>';
                            messagesDiv.appendChild(separator);
                        }
                    }

                    // ذخیره آخرین ID پیام
                    if (msg.id > lastGroupMessageId) {
                        lastGroupMessageId = msg.id;
                    }
                    // ذخیره قدیمی‌ترین ID
                    if (!oldestGroupMessageId || msg.id < oldestGroupMessageId) {
                        oldestGroupMessageId = msg.id;
                    }
                });

                // اسکرول به separator اگه وجود داره
                const separator = messagesDiv.querySelector('.unread-separator');
                if (separator) {
                    // تاخیر کوچک برای اطمینان از رندر شدن کامل
                    setTimeout(() => {
                        separator.scrollIntoView({ behavior: 'auto', block: 'center' });
                    }, 100);
                } else {
                    // اگر separator نیست، به آخر اسکرول کن
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }

                // علامت‌گذاری پیام‌ها به عنوان خوانده شده
                if (lastGroupMessageId > 0) {
                    setTimeout(() => {
                        markGroupMessagesAsRead();
                    }, 1000);
                }

                // آپدیت آخرین پیام در sidebar
                if (data.messages.length > 0) {
                    const lastMsg = data.messages[data.messages.length - 1];
                    const displayText = lastMsg.message.startsWith('[FILE:') ? '📎 فایل' : lastMsg.message;
                    updateGroupLastMessage(displayText, lastMsg.created_at);
                }
            }
            // حذف کش - دیگر تاریخچه را کش نمیکنیم
        } else if (data.type === 'private_history') {
            // نمایش تاریخچه پیام‌های خصوصی
            if (currentChat === data.targetUsername) {
                messagesDiv.innerHTML = '';
                data.messages.forEach(msg => {
                    const isOwn = msg.sender_username === username;
                    const isRead = msg.is_read === 1;
                    const reactions = msg.reactions || null;

                    // بررسی اینکه آیا پیام فایل است
                    let fileData = null;
                    if (msg.message && msg.message.startsWith('[FILE:')) {
                        try {
                            // استخراج JSON از داخل [FILE:...]
                            const startIndex = msg.message.indexOf('{');
                            const endIndex = msg.message.lastIndexOf('}');
                            if (startIndex !== -1 && endIndex !== -1) {
                                const fileJson = msg.message.substring(startIndex, endIndex + 1);
                                fileData = JSON.parse(fileJson);
                                console.log('Private history - Parsed file data:', fileData);
                            }
                        } catch (e) {
                            console.error('Private history - Error parsing file data:', e, 'Message:', msg.message.substring(0, 200));
                        }
                    }

                    if (fileData) {
                        addFileMessage(msg.sender_username, fileData, isOwn, msg.created_at, msg.id, isRead, msg.reply_to, reactions);
                    } else {
                        addMessage(msg.sender_username, msg.message, isOwn, msg.created_at, msg.id, isRead, msg.reply_to, reactions);
                    }
                });
            }

            // ذخیره در حافظه
            if (!privateChats.has(data.targetUsername)) {
                privateChats.set(data.targetUsername, []);
            }
            data.messages.forEach(msg => {
                privateChats.get(data.targetUsername).push({
                    from: msg.sender_username,
                    text: msg.message,
                    timestamp: msg.created_at
                });
            });
        } else if (data.type === 'group_profile_updated') {
            // آپدیت پروفایل گروه برای همه کاربران
            const base64Image = data.profilePicture;

            // آپدیت در هدر اگر در گروه عمومی هستیم
            if (currentChat === 'global') {
                const chatAvatar = document.querySelector('.chat-header-info .chat-avatar');
                if (chatAvatar) {
                    chatAvatar.style.backgroundImage = `url(${base64Image})`;
                    chatAvatar.style.backgroundSize = 'cover';
                    chatAvatar.style.backgroundPosition = 'center';
                    chatAvatar.textContent = '';
                }
            }

            // آپدیت در sidebar
            const globalChatAvatar = document.querySelector('[data-chat="global"] .chat-avatar');
            if (globalChatAvatar) {
                globalChatAvatar.style.backgroundImage = `url(${base64Image})`;
                globalChatAvatar.style.backgroundSize = 'cover';
                globalChatAvatar.style.backgroundPosition = 'center';
                globalChatAvatar.textContent = '';
            }

            // ذخیره در localStorage
            localStorage.setItem('groupProfilePicture', base64Image);
        } else if (data.type === 'messages_read') {
            // پیام‌های ما توسط کاربر دیگر خوانده شده - تیک‌ها را به دو تیک تبدیل کن
            if (data.chatType === 'private') {
                // پیدا کردن username از userId
                const readerUsername = Array.from(usersIdMap.entries()).find(([k, v]) => v === data.readBy)?.[0];

                // فقط اگر در چت با همان کاربر هستیم، تیک‌ها را آپدیت کن
                if (currentChat === readerUsername) {
                    const messages = document.querySelectorAll('.message.own');
                    messages.forEach(msg => {
                        const checkmarks = msg.querySelector('.message-checkmarks');
                        if (checkmarks && !checkmarks.classList.contains('read')) {
                            checkmarks.classList.remove('sent');
                            checkmarks.classList.add('read');
                            checkmarks.textContent = '✓✓';
                        }
                    });
                }
            } else if (data.chatType === 'group') {
                // پیام‌های گروه خوانده شده - تیک‌ها را به دو تیک تبدیل کن
                if (currentChat === 'global') {
                    const messages = document.querySelectorAll('.message.own');
                    messages.forEach(msg => {
                        const checkmarks = msg.querySelector('.message-checkmarks');
                        if (checkmarks && !checkmarks.classList.contains('read')) {
                            checkmarks.classList.remove('sent');
                            checkmarks.classList.add('read');
                            checkmarks.textContent = '✓✓';
                        }
                    });
                }
            } else if (data.chatType === 'custom_group') {
                // پیام‌های گروه سفارشی خوانده شده - تیک‌ها را به دو تیک تبدیل کن
                if (currentChat === data.groupId) {
                    const messages = document.querySelectorAll('.message.own');
                    messages.forEach(msg => {
                        const checkmarks = msg.querySelector('.message-checkmarks');
                        if (checkmarks && !checkmarks.classList.contains('read')) {
                            checkmarks.classList.remove('sent');
                            checkmarks.classList.add('read');
                            checkmarks.textContent = '✓✓';
                        }
                    });
                }
            }
        } else if (data.type === 'chat_deleted') {
            // چت توسط طرف مقابل حذف شده
            const deletedByUsername = data.deletedByUsername;

            // حذف چت از UI
            const chatItem = document.querySelector(`[data-chat="${deletedByUsername}"]`);
            if (chatItem) {
                chatItem.remove();
            }

            // حذف از حافظه
            privateChats.delete(deletedByUsername);

            // اگر چت فعلی همین بود، به گروه برگرد
            if (currentChat === deletedByUsername) {
                switchToGlobalChat();
                addSystemMessage(`${deletedByUsername} گفتگو را حذف کرد`);
            }
        } else if (data.type === 'member_joined') {
            // someone joined a group
            if (data.groupId === 'global') {
                // add to cached online list if not present
                const exists = onlineUsers.find(u => String(u.userId) === String(data.userId));
                if (!exists) {
                    onlineUsers.push({ userId: data.userId, username: data.username, online: true, id: data.userId });
                }
            }
            if (currentChat === data.groupId) {
                const isChannel = currentGroupSettings && currentGroupSettings.group_type === 'channel';
                if (!isChannel && data.userId !== currentUser.id) {
                    const name = data.username || data.userId;
                    addSystemMessage(`${name} به گروه پیوست`);
                }
            }
        } else if (data.type === 'member_left') {
            // someone left a group (self or other)
            if (data.groupId === 'global') {
                onlineUsers = onlineUsers.filter(u => String(u.userId) !== String(data.userId) && String(u.id) !== String(data.userId));
            }
            if (currentChat === data.groupId) {
                const isChannel = currentGroupSettings && currentGroupSettings.group_type === 'channel';
                if (!isChannel) {
                    if (data.userId === currentUser.id) {
                        addSystemMessage('شما از این گروه خارج شدید');
                    } else {
                        const name = data.username || data.userId;
                        addSystemMessage(`${name} از گروه خارج شد`);
                    }
                }
            }
        } else if (data.type === 'group_deleted') {
            // گروه/کانال توسط ادمین حذف شده
            const groupId = data.groupId;

            // حذف از UI
            const chatItem = document.querySelector(`[data-chat="${groupId}"]`);
            if (chatItem) {
                chatItem.remove();
            }

            // اگر در همین گروه بودیم، به گروه عمومی برگردیم
            if (currentChat === groupId) {
                switchToGlobalChat();
                showToast('این گروه/کانال توسط ادمین حذف شد');
            }
        } else if (data.type === 'member_removed') {
            const { groupId, userId, performedBy, performedByName, targetUsername } = data;
            const uidStr = String(userId);
            const myIdStr = String(currentUser.id);
            if (groupId === 'global') {
                // update the cached online users list for public group
                onlineUsers = onlineUsers.filter(u => String(u.userId) !== uidStr && String(u.id) !== uidStr);
                if (uidStr === myIdStr) {
                    bannedFromGlobal = true;
                    const globalChatItem = document.querySelector('[data-chat="global"]');
                    if (globalChatItem) globalChatItem.style.display = 'none';
                    alert('شما از گروه عمومی حذف شدید');
                    if (currentChat === 'global') {
                        hideWelcomeScreen();
                    }
                }
                // اگر modal اعضا باز باشد، آن را به‌روز کن
                const membersModal = document.getElementById('members-modal');
                if (membersModal && membersModal.style.display === 'flex') {
                    const memberElem = document.querySelector(`.member-item[data-userid="${uidStr}"]`);
                    if (memberElem && memberElem.parentNode) {
                        memberElem.parentNode.removeChild(memberElem);
                    }
                    // به‌روز کردن تعداد اعضا
                    const groupInfoMembersCount = document.getElementById('group-info-members-count');
                    if (groupInfoMembersCount) {
                        const onlineCount = onlineUsers.filter(u => u.online).length;
                        const totalCount = onlineUsers.length;
                        groupInfoMembersCount.innerHTML = `
                            <span style="color: #4caf50;">${onlineCount} آنلاین</span>
                            <span style="color: #8b98a5;"> از ${totalCount} عضو</span>
                        `;
                    }
                }
            }
            // if the user who was removed/banned is us, make sure the chat item disappears
            if (uidStr === myIdStr) {
                const chatItem = document.querySelector(`[data-chat="${groupId}"]`);
                if (chatItem) chatItem.remove();
            }

            // show a glass/system message if we are still viewing this group
            if (currentChat === groupId) {
                const isChannel = currentGroupSettings && currentGroupSettings.group_type === 'channel';
                if (!isChannel) {
                    if (performedBy && performedBy !== userId) {
                        const name = performedByName || performedBy;
                        const targetName = targetUsername || (uidStr === myIdStr ? 'شما' : 'یک کاربر');
                        addSystemMessage(`${name} کاربر ${targetName} را محروم کرد`);
                    } else if (uidStr === myIdStr) {
                        addSystemMessage('شما از این گروه/کانال محروم شدید');
                    }
                }
            }

            // if the current user was removed from a custom group they're viewing,
            // kick them back to global and show a notification
            if (currentChat === groupId && uidStr === myIdStr) {
                switchToGlobalChat();
                alert('شما از این گروه/کانال حذف یا محروم شدید');
            } else if (currentChat === groupId) {
                const memberElem = document.querySelector(`.member-item[data-userid="${userId}"]`);
                if (memberElem && memberElem.parentNode) {
                    memberElem.parentNode.removeChild(memberElem);
                }
                // update counts if visible
                const groupInfoMembersCount = document.getElementById('group-info-members-count');
                if (groupInfoMembersCount) {
                    // simply decrement numbers if formatted like "x آنلاین از y عضو"
                    const text = groupInfoMembersCount.textContent || '';
                    const match = text.match(/(\d+) آنلاین.*از (\d+) عضو/);
                    if (match) {
                        let online = parseInt(match[1], 10);
                        let total = parseInt(match[2], 10);
                        total = Math.max(0, total - 1);
                        if (online > total) online = total;
                        groupInfoMembersCount.innerHTML = `<span style="color: #4caf50;">${online} آنلاین</span> <span style="color: #8b98a5;"> از ${total} عضو</span>`;
                    }
                }
                showToast('عضو از گروه حذف شد');
            }
        } else if (data.type === 'user_banned_from_group') {
            // کاربر از گروه/کانال محروم شده
            const { groupId, message } = data;

            // حذف گروه از لیست چت‌ها
            const chatItem = document.querySelector(`[data-chat="${groupId}"]`);
            if (chatItem) {
                chatItem.remove();
            }

            // اگر در همین گروه هستیم، به گروه عمومی برگردیم
            if (currentChat === groupId) {
                switchToGlobalChat();
                alert(message || 'شما از این گروه/کانال محروم شدید');
            } else {
                showToast(message || 'شما از گروه/کانال محروم شدید');
            }
        } else if (data.type === 'group_history') {
            // نمایش تاریخچه پیام‌های گروه/کانال سفارشی
            if (currentChat === data.groupId) {
                messagesDiv.innerHTML = '';

                // پیدا کردن آخرین پیام خوانده شده توسط کاربر
                let lastReadMessageId = data.lastReadMessageId !== undefined ? data.lastReadMessageId : null;
                let hasUnreadMessages = false;

                // بررسی اینکه آیا پیام خوانده نشده وجود داره
                if (lastReadMessageId !== null && data.messages.length > 0) {
                    for (let i = 0; i < data.messages.length; i++) {
                        const msg = data.messages[i];
                        if (msg.id > lastReadMessageId) {
                            hasUnreadMessages = true;
                            break;
                        }
                    }
                }

                data.messages.forEach((msg, index) => {
                    // check for system message
                    if (msg.message_type === 'system' || msg.username === 'system') {
                        addSystemMessage(msg.message);
                        // update ID trackers
                        if (msg.id > (lastCustomGroupMessageId[data.groupId] || 0)) {
                            lastCustomGroupMessageId[data.groupId] = msg.id;
                        }
                        if (!oldestCustomGroupMessageId[data.groupId] || msg.id < oldestCustomGroupMessageId[data.groupId]) {
                            oldestCustomGroupMessageId[data.groupId] = msg.id;
                        }
                        return;
                    }

                    const isOwn = msg.username === username;
                    const isRead = msg.is_read === 1;
                    const reactions = msg.reactions || null;

                    // بررسی اینکه آیا پیام فایل است
                    let fileData = null;
                    if (msg.message && msg.message.startsWith('[FILE:')) {
                        try {
                            // استخراج JSON از داخل [FILE:...]
                            const startIndex = msg.message.indexOf('{');
                            const endIndex = msg.message.lastIndexOf('}');
                            if (startIndex !== -1 && endIndex !== -1) {
                                const fileJson = msg.message.substring(startIndex, endIndex + 1);
                                fileData = JSON.parse(fileJson);
                            }
                        } catch (e) {
                            console.error('Error parsing file data:', e);
                        }
                    }

                    if (fileData) {
                        addFileMessage(msg.username, fileData, isOwn, msg.created_at, msg.id, isRead, msg.reply_to, reactions);
                    } else {
                        addMessage(msg.username, msg.message, isOwn, msg.created_at, msg.id, isRead, msg.reply_to, reactions);
                    }

                    // اگر این آخرین پیام خوانده شده است و پیام خوانده نشده وجود دارد، separator اضافه کن
                    if (hasUnreadMessages && lastReadMessageId !== null && msg.id === lastReadMessageId) {
                        // بررسی که separator قبلاً وجود نداره
                        const existingSeparator = messagesDiv.querySelector('.unread-separator');
                        if (!existingSeparator) {
                            const separator = document.createElement('div');
                            separator.className = 'unread-separator';
                            separator.innerHTML = '<span>پیام‌های جدید</span>';
                            messagesDiv.appendChild(separator);
                        }
                    }

                    // ذخیره آخرین ID پیام
                    if (msg.id > (lastCustomGroupMessageId[data.groupId] || 0)) {
                        lastCustomGroupMessageId[data.groupId] = msg.id;
                    }

                    // ذخیره قدیمی‌ترین ID
                    if (!oldestCustomGroupMessageId[data.groupId] || msg.id < oldestCustomGroupMessageId[data.groupId]) {
                        oldestCustomGroupMessageId[data.groupId] = msg.id;
                    }
                });

                // اسکرول به separator اگر وجود داره
                const separator = messagesDiv.querySelector('.unread-separator');
                if (separator) {
                    // تاخیر کوچک برای اطمینان از رندر شدن کامل
                    setTimeout(() => {
                        separator.scrollIntoView({ behavior: 'auto', block: 'center' });
                    }, 100);
                } else {
                    // اگر separator نیست، به آخر اسکرول کن
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }

                // علامت‌گذاری به عنوان خوانده شده
                if (lastCustomGroupMessageId[data.groupId] > 0) {
                    setTimeout(() => {
                        markCustomGroupMessagesAsRead(data.groupId, lastCustomGroupMessageId[data.groupId]);
                    }, 1000);
                }
            }
            // آپدیت آخرین پیام در sidebar
            if (data.messages.length > 0) {
                const lastMsg = data.messages[data.messages.length - 1];
                const displayText = lastMsg.message.startsWith('[FILE:') ? '📎 فایل' : lastMsg.message;
                updateChatLastMessage(data.groupId, displayText, lastMsg.created_at);
            }
        } else if (data.type === 'group_message') {
            // پیام جدید در گروه/کانال سفارشی

            // بررسی اینکه آیا پیام فایل است
            let messageText = data.text;
            let fileData = null;
            let replyTo = data.replyTo || null;

            if (data.isFile && data.fileData) {
                fileData = data.fileData;
            } else if (messageText && messageText.startsWith('[FILE:')) {
                try {
                    // استخراج JSON از داخل [FILE:...]
                    const startIndex = messageText.indexOf('{');
                    const endIndex = messageText.lastIndexOf('}');
                    if (startIndex !== -1 && endIndex !== -1) {
                        const fileJson = messageText.substring(startIndex, endIndex + 1);
                        fileData = JSON.parse(fileJson);
                        messageText = '';
                    }
                } catch (e) {
                    console.error('Error parsing file data:', e);
                }
            }

            if (currentChat === data.groupId) {
                if (fileData) {
                    addFileMessage(data.username, fileData, data.username === username, data.timestamp, data.messageId, false, replyTo);
                } else {
                    addMessage(data.username, messageText, data.username === username, data.timestamp, data.messageId, false, replyTo);
                }

                // ذخیره آخرین ID پیام
                if (data.messageId && data.messageId > (lastCustomGroupMessageId[data.groupId] || 0)) {
                    lastCustomGroupMessageId[data.groupId] = data.messageId;
                }

                // اگر پیام از طرف دیگری بود، به عنوان خوانده شده علامت بزن
                if (data.username !== username) {
                    setTimeout(() => {
                        if (lastCustomGroupMessageId[data.groupId] > 0) {
                            markCustomGroupMessagesAsRead(data.groupId, lastCustomGroupMessageId[data.groupId]);
                        }
                    }, 500);
                }
            } else {
                // اگر در این گروه نیستیم، badge را آپدیت کن
                updateCustomGroupUnreadBadge(data.groupId);
            }
            // آپدیت آخرین پیام در sidebar
            const displayText = fileData ? `📎 ${fileData.fileName}` : messageText;
            updateChatLastMessage(data.groupId, displayText, data.timestamp);
        } else if (data.type === 'message_deleted') {
            // پیام حذف شده - حذف از UI
            const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageElement) {
                if (messageElement.longPressTimer) {
                    clearTimeout(messageElement.longPressTimer);
                    messageElement.longPressTimer = null;
                }
                messageElement.remove();
            }
        } else if (data.type === 'reaction_updated') {
            // ریکشن آپدیت شده
            const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageElement) {
                const messageBubble = messageElement.querySelector('.message-bubble');
                if (messageBubble) {
                    // رندر ریکشن‌ها با ساختار جدید
                    if (data.reactions && data.reactions.length > 0) {
                        renderReactions(messageBubble, data.reactions, data.messageId);
                    } else {
                        const old = messageBubble.querySelector('.message-reactions-container');
                        if (old) old.remove();
                    }
                }
            }
        } else if (data.type === 'auth_error') {
            // خطای احراز هویت - کاربر در دیتابیس وجود ندارد
            alert(data.message || 'خطا در احراز هویت. لطفاً دوباره وارد شوید');
            // پاک کردن session و بازگشت به صفحه لاگین
            localStorage.removeItem('currentUser');
            if (ws) {
                ws.close();
            }
            location.reload();
        }
    };

    ws.onclose = () => {
        addSystemMessage('ارتباط قطع شد');
        messageInput.setAttribute('contenteditable', 'false');
        sendBtn.disabled = true;
        scheduleReconnect();
    };

    ws.onerror = (err) => {
        console.warn('WebSocket error', err);
        addSystemMessage('خطا در اتصال به سرور. تلاش برای اتصال مجدد...');
        scheduleReconnect();
    };
}

function scheduleReconnect() {
    if (wsRetryCount >= wsMaxRetries) {
        addSystemMessage('عدم امکان اتصال به سرور پس از چند تلاش. لطفاً اتصال شبکه و سرور را بررسی کنید.');
        return;
    }

    wsRetryCount++;
    const delay = wsBaseRetryDelay * Math.pow(2, wsRetryCount - 1);
    setTimeout(() => {
        try {
            connectToServer();
        } catch (e) {
            console.error('Reconnect attempt failed', e);
        }
    }, delay);
}

// بارگذاری تنظیمات و پروفایل گروه عمومی از سرور
async function loadGroupProfile() {
    try {
        const res = await fetch('/api/group-settings/global');
        const data = await res.json();

        if (data.success && data.settings) {
            const settings = data.settings;
            const profilePicture = settings.profile_picture;
            const groupName = settings.group_name || 'گروه عمومی';
            const displayName = `🌐 ${groupName}`;
            const groupUserid = settings.group_userid ? `@${settings.group_userid}` : '@publik_grup';

            // آپدیت آواتار در هدر
            const chatAvatar = document.querySelector('.chat-header-info .chat-avatar');
            if (chatAvatar) {
                if (profilePicture) {
                    chatAvatar.style.backgroundImage = `url(${profilePicture})`;
                    chatAvatar.style.backgroundSize = 'cover';
                    chatAvatar.style.backgroundPosition = 'center';
                    chatAvatar.textContent = '';
                } else {
                    chatAvatar.style.backgroundImage = 'none';
                    chatAvatar.textContent = '🌐';
                }
            }

            // آپدیت آواتار در سایدبار
            const globalChatAvatar = document.querySelector('[data-chat="global"] .chat-avatar');
            if (globalChatAvatar) {
                if (profilePicture) {
                    globalChatAvatar.style.backgroundImage = `url(${profilePicture})`;
                    globalChatAvatar.style.backgroundSize = 'cover';
                    globalChatAvatar.style.backgroundPosition = 'center';
                    globalChatAvatar.textContent = '';
                } else {
                    globalChatAvatar.style.backgroundImage = 'none';
                    globalChatAvatar.textContent = '🌐';
                }
            }

            // ذخیره در localStorage برای کش
            if (profilePicture) {
                localStorage.setItem('groupProfilePicture', profilePicture);
            }

            // آپدیت نام و آیدی در هدر و سایدبار اگر در گروه عمومی هستیم
            if (currentChat === 'global') {
                const chatHeaderName = document.querySelector('.chat-header-name');
                if (chatHeaderName) {
                    chatHeaderName.textContent = displayName;
                    try {
                        if (typeof parseEmojis !== 'undefined') parseEmojis(chatHeaderName);
                        else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(chatHeaderName);
                    } catch (err) {
                        console.error('parseEmojis on chatHeaderName failed', err);
                    }
                }

                const chatHeaderStatus = document.querySelector('.chat-header-status');
                if (chatHeaderStatus && onlineUsers) {
                    const onlineCount = onlineUsers.filter(u => u.online).length;
                    const totalCount = onlineUsers.length;
                    chatHeaderStatus.innerHTML = `
                        <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
                            <div style="color: #5288c1; font-size: 12px; font-weight: 500;">${groupUserid}</div>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <span style="width: 8px; height: 8px; background: #4caf50; border-radius: 50%; display: inline-block;"></span>
                                <span style="color: #4caf50; font-weight: 600;">${onlineCount}</span>
                                <span style="color: #5a6a7a; margin: 0 3px;">/</span>
                                <span style="color: #8b98a5;">${totalCount}</span>
                                <span style="color: #8b98a5; margin-right: 4px;">عضو</span>
                            </div>
                        </div>
                    `;
                }
            }

            // آپدیت نام و آیدی در سایدبار همیشه
            const sidebarItem = document.querySelector('[data-chat="global"]');
            if (sidebarItem) {
                const chatName = sidebarItem.querySelector('.chat-name');
                if (chatName) {
                    chatName.textContent = displayName;
                    try {
                        if (typeof parseEmojis !== 'undefined') parseEmojis(chatName);
                        else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(chatName);
                    } catch (err) {
                        console.error('parseEmojis on sidebar chatName failed', err);
                    }
                }
                const chatLastMessage = sidebarItem.querySelector('.chat-last-message');
                if (chatLastMessage) {
                    chatLastMessage.textContent = groupUserid;
                }
            }
        }
    } catch (error) {
        console.error('خطا در بارگذاری پروفایل گروه:', error);
    }
}

// آپدیت وضعیت تیک پیام‌ها
function updateMessageCheckmarks(messageId, status) {
    const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageDiv) {
        const checkmarks = messageDiv.querySelector('.message-checkmarks');
        if (checkmarks) {
            checkmarks.classList.remove('sent', 'read');

            if (status === 'read') {
                // دو تیک خاکستری - سین خورده
                checkmarks.classList.add('read');
                checkmarks.textContent = '✓✓';
            } else {
                // یک تیک خاکستری - ارسال شده
                checkmarks.classList.add('sent');
                checkmarks.textContent = '✓';
            }
        }
    }
}

// دکمه خروج
// تابع logout به فایل auth.js منتقل شد

// تغییر تم
function toggleTheme() {
    const body = document.body;
    const themeIcon = document.getElementById('theme-icon');
    const themeText = document.getElementById('theme-text');

    // آیکون‌های صفحه لاگین
    const loginThemeToggle = document.getElementById('login-theme-toggle');
    const themeMoonIcon = loginThemeToggle?.querySelector('.theme-icon-moon');
    const themeSunIcon = loginThemeToggle?.querySelector('.theme-icon-sun');

    if (body.classList.contains('light-mode')) {
        // تغییر به حالت تاریک
        body.classList.remove('light-mode');
        localStorage.setItem('theme', 'dark');

        if (themeIcon) {
            themeIcon.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
            `;
        }
        if (themeText) {
            themeText.textContent = 'حالت روشن';
        }

        // آپدیت آیکون صفحه لاگین
        if (themeMoonIcon && themeSunIcon) {
            themeMoonIcon.style.display = 'block';
            themeSunIcon.style.display = 'none';
        }
    } else {
        // تغییر به حالت روشن
        body.classList.add('light-mode');
        localStorage.setItem('theme', 'light');

        if (themeIcon) {
            themeIcon.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2"></line>
                    <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2"></line>
                    <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2"></line>
                    <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2"></line>
                </svg>
            `;
        }
        if (themeText) {
            themeText.textContent = 'حالت تاریک';
        }

        // آپدیت آیکون صفحه لاگین
        if (themeMoonIcon && themeSunIcon) {
            themeMoonIcon.style.display = 'none';
            themeSunIcon.style.display = 'block';
        }
    }
}

// بارگذاری تم ذخیره شده
function loadSavedTheme() {
    const savedTheme = localStorage.getItem('theme');
    const body = document.body;
    const themeIcon = document.getElementById('theme-icon');
    const themeText = document.getElementById('theme-text');

    // آپدیت آیکون در صفحه لاگین
    const loginThemeToggle = document.getElementById('login-theme-toggle');
    const themeMoonIcon = loginThemeToggle?.querySelector('.theme-icon-moon');
    const themeSunIcon = loginThemeToggle?.querySelector('.theme-icon-sun');

    if (savedTheme === 'light') {
        body.classList.add('light-mode');

        // آپدیت آیکون در تنظیمات
        if (themeIcon) {
            themeIcon.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" stroke-width="2"></line>
                    <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" stroke-width="2"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" stroke-width="2"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" stroke-width="2"></line>
                    <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" stroke-width="2"></line>
                    <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="2"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" stroke-width="2"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" stroke-width="2"></line>
                </svg>
            `;
        }
        if (themeText) {
            themeText.textContent = 'حالت تاریک';
        }

        // آپدیت آیکون در صفحه لاگین
        if (themeMoonIcon && themeSunIcon) {
            themeMoonIcon.style.display = 'none';
            themeSunIcon.style.display = 'block';
        }
    } else {
        // حالت تاریک (پیش‌فرض)
        if (themeMoonIcon && themeSunIcon) {
            themeMoonIcon.style.display = 'block';
            themeSunIcon.style.display = 'none';
        }
    }
}

// ذخیره وضعیت چت فعلی - غیرفعال شده
function saveChatState() {
    // دیگر وضعیت چت را ذخیره نمیکنیم
    // همیشه با صفحه خوش‌آمدگویی شروع میکنیم
}

// بازیابی وضعیت چت بعد از رفرش
function restoreChatState(chatId) {
    // تلاش برای پیدا کردن چت با تعداد دفعات محدود
    let attempts = 0;
    const maxAttempts = 10;

    const tryRestore = () => {
        attempts++;
        const chatItem = document.querySelector(`[data-chat="${chatId}"]`);

        if (chatItem) {
            // چت پیدا شد - کلیک روی آن
            chatItem.click();
        } else if (attempts < maxAttempts) {
            // چت هنوز بارگذاری نشده - دوباره تلاش کن
            setTimeout(tryRestore, 200);
        } else {
            // بعد از چند تلاش، صفحه خوش‌آمدگویی را نمایش بده
            console.log('Could not restore chat:', chatId);
            showWelcomeScreen();
        }
    };

    tryRestore();
}

// نمایش صفحه خوش‌آمدگویی
function showWelcomeScreen() {
    const welcomeScreen = document.getElementById('welcome-screen');
    const messagesArea = document.getElementById('messages');
    const chatHeader = document.querySelector('.chat-header');
    const messageInputArea = document.querySelector('.message-input-area');

    if (welcomeScreen) {
        welcomeScreen.classList.add('active');
    }

    if (messagesArea) {
        messagesArea.style.display = 'none';
    }

    // مخفی کردن هدر
    if (chatHeader) {
        chatHeader.style.display = 'none';
    }

    // مخفی کردن فوتر (input area)
    if (messageInputArea) {
        messageInputArea.style.display = 'none';
    }

    // غیرفعال کردن input
    messageInput.setAttribute('contenteditable', 'false');
    sendBtn.disabled = true;

    // حذف active از همه چت‌ها
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });

    currentChat = null;
    saveChatState();

    // نمایش چت‌ها در صفحه خوش‌آمدگویی
    updateWelcomeChats();
}

// به‌روزرسانی لیست چت‌ها در صفحه خوش‌آمدگویی
function updateWelcomeChats() {
    const welcomeChatsList = document.getElementById('welcome-chats-list');
    if (!welcomeChatsList) return;

    // پاک کردن لیست فعلی
    welcomeChatsList.innerHTML = '';

    // گرفتن تمام چت‌ها از sidebar
    const chatItems = document.querySelectorAll('.chat-item');

    if (chatItems.length === 0) {
        welcomeChatsList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">هنوز گفتگویی وجود ندارد</div>';
        return;
    }

    chatItems.forEach(chatItem => {
        const chatId = chatItem.getAttribute('data-chat');
        const chatType = chatItem.getAttribute('data-chat-type');
        const avatar = chatItem.querySelector('.chat-avatar');
        const name = chatItem.querySelector('.chat-name');
        const lastMessage = chatItem.querySelector('.chat-last-message');

        if (!chatId || !avatar || !name) return;

        // ساخت آیتم چت برای صفحه خوش‌آمدگویی
        const welcomeChatItem = document.createElement('div');
        welcomeChatItem.className = 'welcome-chat-item';
        welcomeChatItem.setAttribute('data-chat', chatId);
        if (chatType) {
            welcomeChatItem.setAttribute('data-chat-type', chatType);
        }

        // کپی کردن آواتار
        const avatarClone = avatar.cloneNode(true);
        welcomeChatItem.appendChild(avatarClone);

        // اطلاعات چت
        const chatInfo = document.createElement('div');
        chatInfo.className = 'chat-info';

        const chatName = document.createElement('div');
        chatName.className = 'chat-name';
        chatName.innerHTML = name.innerHTML;

        const chatLastMessage = document.createElement('div');
        chatLastMessage.className = 'chat-last-message';
        chatLastMessage.innerHTML = lastMessage ? lastMessage.innerHTML : '';

        chatInfo.appendChild(chatName);
        chatInfo.appendChild(chatLastMessage);
        welcomeChatItem.appendChild(chatInfo);

        // کلیک برای باز کردن چت
        welcomeChatItem.addEventListener('click', () => {
            // کلیک روی آیتم اصلی در sidebar
            chatItem.click();
        });

        welcomeChatsList.appendChild(welcomeChatItem);
    });
}

// مخفی کردن صفحه خوش‌آمدگویی
function hideWelcomeScreen() {
    const welcomeScreen = document.getElementById('welcome-screen');
    const messagesArea = document.getElementById('messages');
    const chatHeader = document.querySelector('.chat-header');
    const messageInputArea = document.querySelector('.message-input-area');

    if (welcomeScreen) {
        welcomeScreen.classList.remove('active');
    }

    if (messagesArea) {
        messagesArea.style.display = 'flex';
    }

    // نمایش هدر
    if (chatHeader) {
        chatHeader.style.display = 'flex';
    }

    // نمایش فوتر (input area)
    if (messageInputArea) {
        messageInputArea.style.display = 'flex';
    }

    // فعال کردن input
    messageInput.setAttribute('contenteditable', 'true');
    sendBtn.disabled = false;
}

function showSettingsModal() {
    // افزودن وضعیت به تاریخچه برای دکمه برگشت گوشی
    if (!window.historyInitDone) {
        history.pushState({ appInit: true }, '');
        window.historyInitDone = true;
    }
    history.pushState({ canGoBack: true }, '');

    const settingsModal = document.getElementById('settings-modal');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileName = document.getElementById('profile-name');
    const profileEmail = document.getElementById('profile-email');
    const profileUserid = document.getElementById('profile-userid');
    const profileBio = document.getElementById('profile-bio');
    const useridInput = document.getElementById('userid-input');
    const adminSection = document.getElementById('admin-section');

    if (!settingsModal) return;

    // بررسی اینکه آیا کاربر ادمین است (با ایمیل خاص)
    if (adminSection && currentUser && currentUser.email === 'kiaarashabdolahi@gmail.com') {
        adminSection.style.display = 'block';
    } else if (adminSection) {
        adminSection.style.display = 'none';
    }

    // آپدیت اطلاعات کاربر
    if (profileAvatar) {
        if (currentUser.profile_picture) {
            profileAvatar.style.backgroundImage = `url(${currentUser.profile_picture})`;
            profileAvatar.style.backgroundSize = 'cover';
            profileAvatar.style.backgroundPosition = 'center';
            profileAvatar.textContent = '';
        } else {
            profileAvatar.style.backgroundImage = 'none';
            profileAvatar.textContent = username.charAt(0).toUpperCase();
        }
    }

    if (profileName) {
        profileName.textContent = username;
        // render emojis/iran flag if necessary
        try {
            if (typeof parseEmojis !== 'undefined') {
                parseEmojis(profileName);
            } else if (typeof replaceIranFlag !== 'undefined') {
                replaceIranFlag(profileName);
            }
        } catch (err) {
            console.error('parseEmojis on profileName failed', err);
        }
    }

    // live preview while editing username
    const editUsernameInput = document.getElementById('edit-username-input');
    if (editUsernameInput && profileName) {
        editUsernameInput.addEventListener('input', () => {
            profileName.textContent = editUsernameInput.value;
            // رندر ایموجی‌ها در live preview
            try {
                if (typeof parseEmojis !== 'undefined') {
                    parseEmojis(profileName);
                } else if (typeof replaceIranFlag !== 'undefined') {
                    replaceIranFlag(profileName);
                }
            } catch (err) {
                console.error('parseEmojis on live preview failed', err);
            }
            try {
                if (typeof parseEmojis !== 'undefined') {
                    parseEmojis(profileName);
                } else if (typeof replaceIranFlag !== 'undefined') {
                    replaceIranFlag(profileName);
                }
            } catch (err) {
                console.error('emoji rendering on profileName preview failed', err);
            }
        });
    }

    if (profileEmail) {
        profileEmail.textContent = currentUser.email || 'ایمیل ثبت نشده';
    }

    if (profileUserid) {
        profileUserid.textContent = currentUser.user_id ? `@${currentUser.user_id}` : 'آیدی ثبت نشده';
    }

    // نمایش بیوگرافی
    if (profileBio) {
        if (currentUser.bio && currentUser.bio.trim()) {
            profileBio.textContent = currentUser.bio;
            profileBio.classList.remove('empty-bio');
            try {
                if (typeof parseEmojis !== 'undefined') {
                    parseEmojis(profileBio);
                } else if (typeof replaceIranFlag !== 'undefined') {
                    replaceIranFlag(profileBio);
                }
            } catch (err) {
                console.error('emoji rendering on profileBio failed', err);
            }
        } else {
            profileBio.textContent = 'درباره خودتان بنویسید';
            profileBio.classList.add('empty-bio');
        }
        profileBio.style.display = 'block';
    }

    if (useridInput) {
        useridInput.value = currentUser.user_id || '';
    }

    settingsModal.style.display = 'flex';
}



// جستجوی کاربر با آیدی یا نام کاربری
async function searchUser(query) {
    // حذف @ اگر وجود داشته باشه
    const searchQuery = query.startsWith('@') ? query.substring(1) : query;

    if (!searchQuery) {
        alert('لطفا نام کاربری، گروه یا کانال را وارد کنید');
        return;
    }

    try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();

        if (data.success && data.result) {
            const result = data.result;

            if (result.type === 'group' || result.type === 'channel') {
                // اگر گروه یا کانال بود
                if (result.id === 'global') {
                    switchToGlobalChat();
                } else {
                    // اضافه کردن به sidebar اگر وجود نداره
                    if (!document.querySelector(`[data-chat="${result.id}"]`)) {
                        addGroupOrChannelToSidebar({
                            id: result.id,
                            name: result.name,
                            groupId: result.userid,
                            profilePicture: result.profile_picture
                        }, result.type);
                    }
                    // باز کردن گروه/کانال
                    openGroupOrChannel(result.id, result.name, result.type, result.profile_picture);
                }
            } else if (result.type === 'user') {
                // اگر کاربر بود
                const targetUsername = result.username;

                // اضافه کردن به نقشه userId و profilePicture
                usersIdMap.set(targetUsername, result.id);
                if (result.profile_picture) {
                    usersProfilePictureMap.set(targetUsername, result.profile_picture);
                }

                // باز کردن چت
                openPrivateChat(targetUsername);
            }

            // پاک کردن جستجو
            const searchBox = document.getElementById('search-box');
            if (searchBox) {
                // since the search box is now a contenteditable div we reset
                // its innerHTML instead of value.  clearing the element through
                // this ensures the placeholder reappears correctly.
                searchBox.innerHTML = '';
            }

            // پاک کردن جستجوی صفحه خوش‌آمدگویی
            const welcomeSearchBox = document.getElementById('welcome-search-box');
            if (welcomeSearchBox) {
                welcomeSearchBox.innerHTML = '';
            }
        } else {
            alert(data.error || 'نتیجه‌ای یافت نشد');
        }
    } catch (error) {
        console.error('Search error:', error);
        alert('خطا در جستجو');
    }
}

// نمایش اطلاعات کاربر
async function showUserInfo(targetUsername) {
    // افزودن وضعیت به تاریخچه برای دکمه برگشت گوشی
    if (!window.historyInitDone) {
        history.pushState({ appInit: true }, '');
        window.historyInitDone = true;
    }
    history.pushState({ canGoBack: true }, '');

    try {
        const res = await fetch(`/api/search-user?query=${encodeURIComponent(targetUsername)}`);
        const data = await res.json();

        if (data.success && data.user) {
            const userInfoModal = document.getElementById('user-info-modal');
            const userInfoAvatar = document.getElementById('user-info-avatar');
            const userInfoName = document.getElementById('user-info-name');
            const userInfoEmail = document.getElementById('user-info-email');
            const userInfoUserid = document.getElementById('user-info-userid');
            const userInfoBio = document.getElementById('user-info-bio');

            if (userInfoAvatar) {
                if (data.user.profile_picture) {
                    userInfoAvatar.style.backgroundImage = `url(${data.user.profile_picture})`;
                    userInfoAvatar.style.backgroundSize = 'cover';
                    userInfoAvatar.style.backgroundPosition = 'center';
                    userInfoAvatar.textContent = '';
                } else {
                    userInfoAvatar.style.backgroundImage = 'none';
                    userInfoAvatar.textContent = data.user.username.charAt(0).toUpperCase();
                }
            }

            if (userInfoName) {
                userInfoName.textContent = data.user.username;
                try {
                    if (typeof parseEmojis !== 'undefined') {
                        parseEmojis(userInfoName);
                    }
                } catch (err) {
                    console.error('parseEmojis on userInfoName failed', err);
                }
            }

            if (userInfoEmail) {
                userInfoEmail.textContent = data.user.email || 'ایمیل ثبت نشده';
            }

            if (userInfoUserid) {
                const userid = data.user.user_id ? `@${data.user.user_id}` : 'آیدی ثبت نشده';

                // حذف event listener قبلی
                const newUserid = userInfoUserid.cloneNode(true);
                userInfoUserid.parentNode.replaceChild(newUserid, userInfoUserid);

                if (data.user.user_id) {
                    newUserid.innerHTML = `${userid} <span class="copy-icon">📋</span>`;
                    newUserid.classList.add('copyable');
                    newUserid.style.cursor = 'pointer';

                    newUserid.addEventListener('click', async () => {
                        try {
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                                await navigator.clipboard.writeText(userid);
                            } else {
                                const textArea = document.createElement('textarea');
                                textArea.value = userid;
                                textArea.style.position = 'fixed';
                                textArea.style.left = '-999999px';
                                textArea.style.top = '-999999px';
                                document.body.appendChild(textArea);
                                textArea.focus();
                                textArea.select();
                                document.execCommand('copy');
                                textArea.remove();
                            }

                            newUserid.classList.add('copied');
                            newUserid.innerHTML = 'کپی شد! ✓';

                            setTimeout(() => {
                                newUserid.classList.remove('copied');
                                newUserid.innerHTML = `${userid} <span class="copy-icon">📋</span>`;
                            }, 2000);
                        } catch (err) {
                            console.error('خطا در کپی کردن:', err);
                            alert('خطا در کپی کردن آیدی');
                        }
                    });
                } else {
                    newUserid.textContent = userid;
                    newUserid.classList.remove('copyable');
                    newUserid.style.cursor = 'default';
                }
            }

            // نمایش بیوگرافی
            if (userInfoBio) {
                if (data.user.bio && data.user.bio.trim()) {
                    userInfoBio.textContent = data.user.bio;
                    try {
                        if (typeof parseEmojis !== 'undefined') {
                            parseEmojis(userInfoBio);
                        }
                    } catch (err) {
                        console.error('parseEmojis on userInfoBio failed', err);
                    }
                    userInfoBio.style.display = 'block';
                } else {
                    userInfoBio.style.display = 'none';
                }
            }

            if (userInfoModal) {
                userInfoModal.style.display = 'flex';
            }
        }
    } catch (error) {
        console.error('Error loading user info:', error);
    }
}

// تبدیل data URI به object URL برای جلوگیری از دانلود توسط مرورگر
// توابع رسانه‌ای به media-handler.js منتقل شده‌اند

function sendMessage() {
    if (currentChat === 'global' && bannedFromGlobal) {
        alert('شما اجازه ارسال پیام در گروه عمومی را ندارید');
        return;
    }
    // استخراج متن از contenteditable (شامل ایموجی‌ها)
    let text = '';

    const extractText = (node) => {
        // recursively collect text and emoji alt values; drop any SVG markup
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }

        if (node.nodeName === 'IMG' && node.classList.contains('emoji')) {
            return node.alt || '';
        }

        if (node.nodeName === 'BR') {
            return '\n';
        }

        let result = '';
        node.childNodes.forEach(child => {
            result += extractText(child);
        });
        return result;
    };

    messageInput.childNodes.forEach(node => {
        text += extractText(node);
    });

    // تمیز کردن فاصله‌های non-breaking space و فاصه‌های اضافی
    text = text.replace(/\u00A0/g, ' ').trim();
    if (!text || !ws || !currentChat) return;

    // بررسی حالت ویرایش
    if (editingMessageId) {
        // ارسال درخواست ویرایش پیام
        let chatType = 'global';
        let groupId = null;

        if (currentChat === 'global') {
            chatType = 'global';
        } else if (currentChat.startsWith('group_') || currentChat.startsWith('channel_')) {
            chatType = 'custom_group';
            groupId = currentChat;
        } else {
            chatType = 'private';
        }

        ws.send(JSON.stringify({
            type: 'edit_message',
            messageId: editingMessageId,
            newText: text,
            chatType: chatType,
            groupId: groupId
        }));

        // لغو حالت ویرایش
        cancelEditingMessage();
        return;
    }

    if (currentChat === 'global') {
        // پیام گروه عمومی
        const messageData = { type: 'message', text };
        if (replyToMessage) {
            messageData.replyTo = replyToMessage;
            // debug log removed
        }
        ws.send(JSON.stringify(messageData));
    } else if (currentChat.startsWith('group_') || currentChat.startsWith('channel_')) {
        // پیام گروه/کانال سفارشی
        const messageData = {
            type: 'group_message',
            groupId: currentChat,
            text
        };
        if (replyToMessage) {
            messageData.replyTo = replyToMessage;
            console.log('Sending group message with reply:', messageData);
        }
        ws.send(JSON.stringify(messageData));
    } else {
        // پیام خصوصی
        // اضافه کردن به لیست چت‌ها اگر وجود نداره
        if (!document.querySelector(`[data-chat="${currentChat}"]`)) {
            addPrivateChatToList(currentChat);
        }

        const messageData = {
            type: 'private_message',
            to: currentChat,
            text
        };
        if (replyToMessage) {
            messageData.replyTo = replyToMessage;
            console.log('Sending private message with reply:', messageData);
        }
        ws.send(JSON.stringify(messageData));

        // ذخیره پیام در حافظه (بدون نمایش، چون از سرور دریافت میشه)
        if (!privateChats.has(currentChat)) {
            privateChats.set(currentChat, []);
        }

        updateChatLastMessage(currentChat, text);
    }

    // پاک کردن reply preview
    clearReplyPreview();

    messageInput.innerHTML = '';
}

// به‌روزرسانی نام کاربری در تمام پیام‌های نمایش داده شده
function updateUsernameInDOM(oldUsername, newUsername) {
    const messagesArea = document.getElementById('messages');
    if (!messagesArea) return;

    // تمام پیام‌ها را پیدا کن
    const messageElements = messagesArea.querySelectorAll('.message');

    messageElements.forEach(messageEl => {
        // به‌روزرسانی نام کاربری در سر پیام
        const usernameEl = messageEl.querySelector('.message-username');
        if (usernameEl && usernameEl.textContent === oldUsername) {
            usernameEl.textContent = newUsername;
            try {
                if (typeof parseEmojis !== 'undefined') parseEmojis(usernameEl);
                else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(usernameEl);
            } catch (err) {
                console.error('parseEmojis on usernameEl failed', err);
            }
        }

        // به‌روزرسانی نام کاربری در پیام ریپلای شده
        const repliedMessageEl = messageEl.querySelector('.replied-message-sender');
        if (repliedMessageEl && repliedMessageEl.textContent === oldUsername) {
            repliedMessageEl.textContent = newUsername;
            try {
                if (typeof parseEmojis !== 'undefined') parseEmojis(repliedMessageEl);
                else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(repliedMessageEl);
            } catch (err) {
                console.error('parseEmojis on repliedMessageEl failed', err);
            }
        }
    });
}

function addMessage(user, text, isOwn, timestamp, messageId, isRead = false, replyTo = null, reactions = null) {
    // بررسی اینکه آیا پیام با این ID قبلاً وجود داره
    if (messageId) {
        const existingMessage = messagesDiv.querySelector(`[data-message-id="${messageId}"]`);
        if (existingMessage) {
            // پیام قبلاً اضافه شده، نیازی به اضافه کردن دوباره نیست
            return;
        }
    }

    // بررسی اینکه آیا متن یک فایل است
    if (text && text.startsWith('[FILE:')) {
        try {
            // استخراج JSON از داخل [FILE:...]
            const startIndex = text.indexOf('{');
            const endIndex = text.lastIndexOf('}');
            if (startIndex !== -1 && endIndex !== -1) {
                const fileJson = text.substring(startIndex, endIndex + 1);
                const fileData = JSON.parse(fileJson);
                addFileMessage(user, fileData, isOwn, timestamp, messageId, isRead, replyTo, reactions);
                return;
            }
        } catch (e) {
            console.error('Error parsing file data:', e);
            // اگر parse نشد، به عنوان متن معمولی نمایش بده
        }
    }

    const messageDiv = createMessageElement(user, text, isOwn, timestamp, messageId, isRead, null, replyTo, reactions);

    // ذخیره قدیمی‌ترین ID
    if (messageId) {
        if (currentChat === 'global') {
            if (!oldestGroupMessageId || messageId < oldestGroupMessageId) {
                oldestGroupMessageId = messageId;
            }
        } else {
            if (!oldestPrivateMessageId[currentChat] || messageId < oldestPrivateMessageId[currentChat]) {
                oldestPrivateMessageId[currentChat] = messageId;
            }
        }
    }

    // بررسی اینکه آیا کاربر در پایین صفحه است
    const isAtBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop <= messagesDiv.clientHeight + 100;

    // تلاش برای درج پیام در ترتیب زمانی صحیح
    const newTime = messageDiv.dataset.timestamp ? new Date(messageDiv.dataset.timestamp).getTime() : null;
    let inserted = false;
    if (newTime !== null) {
        const children = Array.from(messagesDiv.querySelectorAll('.message, .system-message'));
        for (const child of children) {
            const childTs = child.dataset.timestamp ? new Date(child.dataset.timestamp).getTime() : null;
            if (childTs !== null && childTs > newTime) {
                messagesDiv.insertBefore(messageDiv, child);
                inserted = true;
                break;
            }
        }
    }

    if (!inserted) {
        messagesDiv.appendChild(messageDiv);
    }

    // تبدیل داده‌های URI به object URL تا دانلود خودکار جلوگیری شود
    const mediaEls = messageDiv.querySelectorAll('.file-preview img, .file-preview video, .file-preview audio');
    mediaEls.forEach(el => {
        convertDataUriElement(el).catch(console.error);
    });

    // فقط اگر کاربر در پایین بود یا این پیام خودمان است، اسکرول کن
    if ((isAtBottom && !inserted) || isOwn) {
        // only scroll if we actually appended (not inserted earlier) or if it's our own message
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

function addSystemMessage(text, timestamp = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'system-message';
    messageDiv.textContent = text;

    // attach a timestamp so we can insert in chronological order
    if (timestamp) {
        messageDiv.dataset.timestamp = timestamp;
    } else {
        // use current time if none provided
        messageDiv.dataset.timestamp = new Date().toISOString();
    }

    // رندر کردن ایموجی‌های سفارشی
    try {
        if (typeof parseEmojis !== 'undefined') {
            parseEmojis(messageDiv);
        }
    } catch (err) {
        console.error('parseEmojis on system message failed', err);
    }

    // insert the system message at the correct position based on timestamp
    const newTime = new Date(messageDiv.dataset.timestamp).getTime();
    const children = Array.from(messagesDiv.querySelectorAll('.message, .system-message'));
    let inserted = false;
    for (const child of children) {
        const childTs = child.dataset.timestamp ? new Date(child.dataset.timestamp).getTime() : null;
        if (childTs !== null && childTs > newTime) {
            messagesDiv.insertBefore(messageDiv, child);
            inserted = true;
            break;
        }
    }
    if (!inserted) {
        messagesDiv.appendChild(messageDiv);
    }

    // only scroll to bottom if user is already at bottom
    const isAtBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop <= messagesDiv.clientHeight + 100;
    if (isAtBottom) {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

function updateUsersList(users) {
    // normalize entries so every user has an `id` property
    // (some older messages only include `username`/`online`).
    let normalized = users.map(u => {
        let id = null;
        if (u.id != null) id = u.id;
        else if (u.userId != null) id = u.userId;
        return { ...u, id };
    });

    // legacy compatibility: there used to be a separate "users" message that
    // contained only the online users (no ids).  In that rare case we want to
    // keep the offline entries we had locally so the total count doesn't drop
    // suddenly.  Newer messages ("users_with_ids" coming from broadcastUsers)
    // always include all known users (online and offline) and also supply the
    // `userId` field, therefore we should **not** re-add anything when we
    // receive them – especially important when someone has just been removed or
    // banned from the public group.  The previous logic erroneously re‑added
    // a recently banned offline user when the fresh list happened to contain
    // only online members (e.g. the banned user was the last offline member),
    // which is why removals from the public group appeared to have no effect.
    const hasOnlyOnline = normalized.every(u => u.online === true);
    const hasIdField = normalized.some(u => u.userId != null);
    if (hasOnlyOnline && onlineUsers.length > 0 && !hasIdField) {
        onlineUsers.forEach(old => {
            if (!normalized.find(n => n.userId === old.userId || n.id === old.id)) {
                // preserve old offline user
                normalized.push({ ...old, online: false });
            }
        });
    }

    onlineUsers = normalized;
    const onlineCount = onlineUsers.filter(u => u.online).length;
    const totalCount = onlineUsers.length;

    // فرمت تمیز با آیدی گروه و تعداد اعضا
    const onlineCountElement = document.getElementById('online-count');
    if (onlineCountElement && currentChat === 'global') {
        onlineCountElement.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
                <div style="color: #5288c1; font-size: 12px; font-weight: 500;">@publik_grup</div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <span style="width: 8px; height: 8px; background: #4caf50; border-radius: 50%; display: inline-block;"></span>
                    <span style="color: #4caf50; font-weight: 600;">${onlineCount}</span>
                    <span style="color: #5a6a7a; margin: 0 3px;">/</span>
                    <span style="color: #8b98a5;">${totalCount}</span>
                    <span style="color: #8b98a5; margin-right: 4px;">عضو</span>
                </div>
            </div>
        `;
    }

    // آپدیت هدر گروه‌های سفارشی اگر در یکی از آنها هستیم
    if (currentChat && currentChat !== 'global' && !currentChat.startsWith('private_')) {
        updateCustomGroupHeader();
    }
}

// تابع برای آپدیت هدر گروه‌های سفارشی
async function updateCustomGroupHeader() {
    if (!currentChat || currentChat === 'global' || currentChat.startsWith('private_')) {
        return;
    }

    console.log('Updating custom group header for:', currentChat);

    try {
        const membersResponse = await fetch(`/api/group-members/${currentChat}`);
        const membersData = await membersResponse.json();

        console.log('Members data:', membersData);

        if (membersData.success && membersData.members) {
            const totalCount = membersData.members.length;

            const chatHeaderStatus = document.querySelector('.chat-header-status');
            if (chatHeaderStatus) {
                // اگر currentGroupSettings موجود نیست، از نوع پیش‌فرض استفاده کن
                const groupType = currentGroupSettings ? currentGroupSettings.group_type : 'group';

                if (groupType === 'channel') {
                    // برای کانال فقط تعداد کل اعضا
                    chatHeaderStatus.innerHTML = `
                        <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
                            <div style="color: #5288c1; font-size: 12px; font-weight: 500;">کانال</div>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <span style="color: #8b98a5;">${totalCount}</span>
                                <span style="color: #8b98a5; margin-right: 4px;">عضو</span>
                            </div>
                        </div>
                    `;
                } else {
                    // برای گروه نمایش آنلاین/کل
                    const onlineCount = membersData.members.filter(m => m.online).length;
                    chatHeaderStatus.innerHTML = `
                        <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
                            <div style="color: #5288c1; font-size: 12px; font-weight: 500;">گروه</div>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <span style="width: 8px; height: 8px; background: #4caf50; border-radius: 50%; display: inline-block;"></span>
                                <span style="color: #4caf50; font-weight: 600;">${onlineCount}</span>
                                <span style="color: #5a6a7a; margin: 0 3px;">/</span>
                                <span style="color: #8b98a5;">${totalCount}</span>
                                <span style="color: #8b98a5; margin-right: 4px;">عضو</span>
                            </div>
                        </div>
                    `;
                }
                console.log('Header updated successfully');
            } else {
                console.log('chatHeaderStatus element not found');
            }
        }
    } catch (error) {
        console.error('Error updating custom group header:', error);
    }
}

// helper برای افزودن ادمین جدید
async function makeGroupAdmin(groupId, targetUserId) {
    if (!groupId) {
        console.warn('makeGroupAdmin called without groupId, defaulting to global');
        groupId = 'global';
    }
    try {
        const res = await fetch('/api/add-group-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId, userId: currentUser.id, targetUserId })
        });
        return await res.json();
    } catch (err) {
        console.error('makeGroupAdmin request failed', err);
        return { success: false, error: 'خطا در درخواست' };
    }
}

// helper برای حذف ادمین
async function removeGroupAdmin(groupId, targetUserId) {
    if (!groupId) {
        console.warn('removeGroupAdmin called without groupId, defaulting to global');
        groupId = 'global';
    }
    try {
        const res = await fetch('/api/remove-group-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId, userId: currentUser.id, targetUserId })
        });
        return await res.json();
    } catch (err) {
        console.error('removeGroupAdmin request failed', err);
        return { success: false, error: 'خطا در درخواست' };
    }
}

// state object to keep track of the pending upgrade operation - moved to moderation.js

function showUpgradeAdminModal(username) {
    const modal = document.getElementById('upgrade-admin-modal');
    const text = document.getElementById('upgrade-admin-text');
    if (text) {
        text.textContent = `آیا مطمئن هستید که می‌خواهید ${username} را به مدیر ارتقا دهید؟`;
    }
    if (modal) modal.style.display = 'flex';
}

function closeUpgradeAdminModal() {
    const modal = document.getElementById('upgrade-admin-modal');
    if (modal) modal.style.display = 'none';
    pendingUpgrade = {
        groupId: null,
        targetUserId: null,
        targetUsername: null,
        buttonElem: null,
        statusElem: null,
        groupType: null,
        isAdmin: false,
        targetIsOwner: false,
        currentUserIsOwner: false,
        menuTarget: null
    };
}

// wire up confirm/cancel buttons for the upgrade modal
const confirmUpgradeBtn = document.getElementById('confirm-upgrade-admin');
if (confirmUpgradeBtn) {
    confirmUpgradeBtn.addEventListener('click', async () => {
        const { groupId, targetUserId, buttonElem, statusElem, groupType } = pendingUpgrade;
        if (!groupId || !targetUserId) {
            closeUpgradeAdminModal();
            return;
        }
        const result = await makeGroupAdmin(groupId, targetUserId);
        if (result.success) {
            if (buttonElem) buttonElem.remove();
            if (statusElem) {
                statusElem.textContent = `ادمین${groupType ? ' ' + groupType : ''}`;
            }
        } else {
            alert(result.error || 'خطا در افزودن ادمین');
        }
        closeUpgradeAdminModal();
    });
}
const cancelUpgradeBtn = document.getElementById('cancel-upgrade-admin');
if (cancelUpgradeBtn) {
    cancelUpgradeBtn.addEventListener('click', () => {
        closeUpgradeAdminModal();
    });
}
const closeUpgradeIcon = document.getElementById('close-upgrade-admin-modal');
if (closeUpgradeIcon) {
    closeUpgradeIcon.addEventListener('click', () => {
        closeUpgradeAdminModal();
    });
}

async function showMembersModal() {
    // افزودن وضعیت به تاریخچه برای دکمه برگشت گوشی
    if (!window.historyInitDone) {
        history.pushState({ appInit: true }, '');
        window.historyInitDone = true;
    }
    history.pushState({ canGoBack: true }, '');

    const membersModal = document.getElementById('members-modal');
    const membersList = document.getElementById('members-list');
    const groupInfoAvatar = document.getElementById('group-info-avatar-display');
    const groupInfoName = document.querySelector('.group-info-name');
    const groupInfoUserid = document.getElementById('group-info-userid-copy');
    const groupInfoDescription = document.getElementById('group-info-description');
    const groupInfoMembersCount = document.getElementById('group-info-members-count');
    const editGroupInfoBtn = document.getElementById('edit-group-info-btn');
    const leaveGroupBtn = document.getElementById('leave-group-btn');

    if (leaveGroupBtn) {
        // وقتی این مودال برای گروه عمومی باز می‌شود نباید دکمه خروج نشان داده شود
        leaveGroupBtn.style.display = 'none';
    }

    // compute current group once and use it throughout; we also need the
    // value early to ensure global-admin status is refreshed before we
    // render the UI.  defining it here avoids redeclaration errors later.
    let groupId = currentChat || 'global';

    if (groupId === 'global' && bannedFromGlobal) {
        alert('شما از گروه عمومی حذف شده‌اید');
        return;
    }

    // if the list we're about to show is the public chat, make sure the
    // global-admin flag has been fetched so that context-menu listeners
    // will be attached correctly.
    if (groupId === 'global') {
        await checkGlobalAdminStatus();
    }

    if (!membersModal || !membersList) return;

    // گروهی که در حال حاضر باز است (برای گروه عمومی از 'global' استفاده کن)
    // (variable already defined above)

    // سعی کن تنظیمات گروه را از سرور بگیریم تا بتوانیم نام/آیدی/بیو را نمایش دهیم
    let settings = null;
    try {
        const res = await fetch(`/api/group-settings/${groupId}`);
        const d = await res.json();
        if (d.success && d.settings) settings = d.settings;
    } catch (err) {
        console.error('Error fetching group settings for', groupId, err);
    }

    // تعیین لیست آیدی‌های ادمین (از تنظیمات یا به صورت دستی)
    const adminIds = settings && Array.isArray(settings.admins) ? settings.admins.slice() : [];
    let ownerId = settings && settings.owner_id ? settings.owner_id : null;
    const currentUserIsOwner = ownerId && currentUser.id === ownerId;
    // برای گروه عمومی ممکن است owner_id در تنظیمات خالی باشد
    if (!ownerId && settings && settings.group_id === 'global' && settings.admin_email === currentUser.email) {
        ownerId = currentUser.id;
    }
    // همیشه مالک را نیز به لیست ادمین اضافه کن تا بررسی‌ها ساده شود
    if (ownerId && !adminIds.includes(ownerId)) {
        adminIds.push(ownerId);
    }
    // مهاجرت احتمالی: اگر جدول admins را پر نکرده باشیم، قدیمی را نگه می‌داریم
    if (settings && settings.group_id === 'global') {
        if (settings.admin_email && settings.admin_email === currentUser.email) {
            if (!adminIds.includes(currentUser.id)) adminIds.push(currentUser.id);
        }
    }
    // در صورت گروه عمومی، همچنین از چک وضعیت سراسری استفاده کن
    let currentUserIsAdmin = adminIds.includes(currentUser.id) || (ownerId && currentUser.id === ownerId);
    if (groupId === 'global' && currentUser.isGlobalAdmin) {
        currentUserIsAdmin = true;
    }
    console.log('showMembersModal:', { groupId, currentUserIsAdmin, adminIds, ownerId, isGlobalFlag: groupId === 'global' });

    // نمایش یا مخفی کردن دکمه ویرایش بر اساس دسترسی
    if (editGroupInfoBtn) {
        editGroupInfoBtn.style.display = currentUserIsAdmin ? 'flex' : 'none';
    }

    // نمایش یا مخفی کردن بخش کاربران حذف‌شده (فقط برای گروه عمومی و ادمین‌ها)
    const bannedUsersSection = document.getElementById('banned-users-section');
    if (bannedUsersSection) {
        if (groupId === 'global' && currentUserIsAdmin) {
            bannedUsersSection.style.display = 'block';
            bannedUsersSection.dataset.groupId = groupId;
            bannedUsersSection.dataset.groupType = 'گروه';
        } else {
            bannedUsersSection.style.display = 'none';
            delete bannedUsersSection.dataset.groupId;
            delete bannedUsersSection.dataset.groupType;
        }
    }

    // بارگذاری پروفایل گروه از localStorage (کش) یا تنظیمات
    const savedGroupProfile = localStorage.getItem('groupProfilePicture');
    if (groupInfoAvatar) {
        if (settings && settings.profile_picture) {
            groupInfoAvatar.style.backgroundImage = `url(${settings.profile_picture})`;
            groupInfoAvatar.style.backgroundSize = 'cover';
            groupInfoAvatar.style.backgroundPosition = 'center';
            groupInfoAvatar.textContent = '';
        } else if (savedGroupProfile) {
            groupInfoAvatar.style.backgroundImage = `url(${savedGroupProfile})`;
            groupInfoAvatar.style.backgroundSize = 'cover';
            groupInfoAvatar.style.backgroundPosition = 'center';
            groupInfoAvatar.textContent = '';
        } else {
            groupInfoAvatar.style.backgroundImage = 'none';
            groupInfoAvatar.textContent = '🌐';
        }
    }

    // نام گروه
    if (groupInfoName) {
        const nameText = settings && settings.group_name ? settings.group_name : 'گروه عمومی';
        groupInfoName.innerHTML = escapeHtml(`🌐 ${nameText}`);
        try {
            if (typeof parseEmojis !== 'undefined') parseEmojis(groupInfoName);
            else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(groupInfoName);
        } catch (err) {
            console.error('parseEmojis on groupInfoName failed', err);
        }
    }

    // آیدی گروه
    if (groupInfoUserid) {
        // حذف event listener قبلی — ایمن‌سازی در برابر parentNode=null
        let newUserid = groupInfoUserid;
        if (groupInfoUserid.parentNode) {
            try {
                newUserid = groupInfoUserid.cloneNode(true);
                groupInfoUserid.parentNode.replaceChild(newUserid, groupInfoUserid);
            } catch (err) {
                console.warn('Could not replace groupInfoUserid node:', err);
                newUserid = groupInfoUserid;
            }
        }

        const displayUserid = settings && settings.group_userid ? `@${settings.group_userid}` : '@publik_grup';
        newUserid.innerHTML = `${displayUserid} <span class="copy-icon">📋</span>`;

        newUserid.addEventListener('click', async () => {
            const userid = displayUserid;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(userid);
                } else {
                    const textArea = document.createElement('textarea');
                    textArea.value = userid;
                    textArea.style.position = 'fixed';
                    textArea.style.left = '-999999px';
                    textArea.style.top = '-999999px';
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    document.execCommand('copy');
                    textArea.remove();
                }
                newUserid.classList.add('copied');
                newUserid.innerHTML = 'کپی شد! ✓';
                setTimeout(() => {
                    newUserid.classList.remove('copied');
                    newUserid.innerHTML = `${displayUserid} <span class="copy-icon">📋</span>`;
                }, 2000);
            } catch (err) {
                console.error('خطا در کپی کردن:', err);
                alert('خطا در کپی کردن آیدی');
            }
        });
    }

    // بیوگرافی گروه
    if (groupInfoDescription) {
        if (settings && settings.description && settings.description.trim()) {
            groupInfoDescription.textContent = settings.description;
            try {
                if (typeof parseEmojis !== 'undefined') {
                    parseEmojis(groupInfoDescription);
                } else if (typeof replaceIranFlag !== 'undefined') {
                    replaceIranFlag(groupInfoDescription);
                }
            } catch (err) {
                console.error('emoji rendering on groupInfoDescription failed', err);
            }
            groupInfoDescription.style.display = 'block';
        } else {
            groupInfoDescription.style.display = 'none';
        }
    }

    // نمایش تعداد اعضا
    if (groupInfoMembersCount && onlineUsers) {
        const onlineCount = onlineUsers.filter(u => u.online).length;
        const totalCount = onlineUsers.length;
        groupInfoMembersCount.innerHTML = `
            <span style="color: #4caf50;">${onlineCount} آنلاین</span>
            <span style="color: #8b98a5;"> از ${totalCount} عضو</span>
        `;
    }

    membersList.innerHTML = '';

    onlineUsers.forEach(user => {
        const userDiv = document.createElement('div');
        userDiv.className = 'member-item';
        const isCurrentUser = user.username === username;
        const statusText = user.online ? 'آنلاین' : 'آفلاین';
        const statusClass = user.online ? 'online' : 'offline';
        // بعضی داده‌ها ممکن است فقط user.userId داشته باشند
        const uid = user.id != null ? user.id : user.userId;
        const isAdmin = uid != null && adminIds.includes(uid);
        const isOwner = ownerId && uid === ownerId;

        // ایجاد آواتار
        let avatarHTML;
        if (user.profilePicture) {
            avatarHTML = `<div class="user-avatar" style="background-image: url("${user.profilePicture}"); background-size: cover; background-position: center;"></div>`;
        } else {
            const avatar = user.username.charAt(0).toUpperCase();
            avatarHTML = `<div class="user-avatar">${avatar}</div>`;
        }

        userDiv.innerHTML = `
            ${avatarHTML}
            <div class="user-info" data-username="${user.username}" style="cursor: pointer;">
                <div class="user-name">${user.username}${isCurrentUser ? ' (شما)' : ''}</div>
                <div class="user-status ${statusClass}">${isOwner ? 'مالک' : (isAdmin ? 'ادمین' : statusText)}</div>
            </div>
        `;

        // parse emojis / replace custom Iran flag in member name so any 🇮🇷 or other emojis use svg
        try {
            const nameElem = userDiv.querySelector('.user-name');
            if (nameElem) {
                if (typeof parseEmojis !== 'undefined') {
                    parseEmojis(nameElem);
                }
            }
        } catch (err) {
            console.error('emoji parsing in members list failed for', user.username, err);
        }

        // کلیک روی نام کاربر برای نمایش اطلاعات
        const userInfoDiv = userDiv.querySelector('.user-info');
        if (userInfoDiv && !isCurrentUser) {
            userInfoDiv.addEventListener('click', () => {
                membersModal.style.display = 'none';
                showUserInfo(user.username);
            });
        }


        // attach origin data attributes
        // `uid` already computed earlier in this iteration
        userDiv.dataset.userid = uid;
        userDiv.dataset.username = user.username;
        userDiv.dataset.isAdmin = isAdmin;
        userDiv.dataset.isOwner = isOwner;
        userDiv.dataset.isCurrentUser = isCurrentUser;

        // only add context-menu listeners if allowed (owner and self are excluded)
        if (!isCurrentUser && currentUserIsAdmin && !isOwner) {
            const handlePromo = (x, y) => {
                const statusDiv = userDiv.querySelector('.user-status');
                const alreadyAdmin = userDiv.dataset.isAdmin === 'true';
                const targetUid = uid; // reuse normalized id from outer scope
                pendingUpgrade = {
                    groupId: 'global',
                    targetUserId: targetUid,
                    targetUsername: user.username,
                    buttonElem: null,
                    statusElem: statusDiv,
                    groupType: '',
                    isAdmin: alreadyAdmin,
                    targetIsOwner: isOwner,
                    currentUserIsOwner: currentUser.id === ownerId,
                    menuTarget: userDiv
                };
                showMemberContextMenu(x, y);
            };

            userDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                handlePromo(e.pageX, e.pageY);
            });
            userDiv.addEventListener('mousedown', (e) => {
                if (e.button === 2) {
                    e.preventDefault();
                    handlePromo(e.pageX, e.pageY);
                }
            });

            let longPress = null;
            userDiv.addEventListener('touchstart', (e) => {
                longPress = setTimeout(() => {
                    const touch = e.touches[0];
                    handlePromo(touch.pageX, touch.pageY);
                }, 500);
            });
            userDiv.addEventListener('touchend', () => {
                clearTimeout(longPress);
            });
            userDiv.addEventListener('touchmove', () => {
                clearTimeout(longPress);
            });
        }

        membersList.appendChild(userDiv);
    });

    membersModal.style.display = 'flex';
}

// نمایش لیست کاربران حذف‌شده
// نمایش لیست کاربران محروم شده - moved to moderation.js

// نمایش اطلاعات گروه/کانال سفارشی
async function showCustomGroupInfo(groupId) {
    const membersModal = document.getElementById('members-modal');
    const membersList = document.getElementById('members-list');
    const groupInfoAvatar = document.getElementById('group-info-avatar-display');
    const groupInfoName = document.querySelector('.group-info-name');
    let groupInfoUserid = document.getElementById('group-info-userid-copy');
    const groupInfoDescription = document.getElementById('group-info-description');
    const groupInfoMembersCount = document.getElementById('group-info-members-count');

    if (!membersModal || !membersList) return;

    try {
        // دریافت اطلاعات گروه از سرور
        const res = await fetch(`/api/group-settings/${groupId}`);
        const data = await res.json();

        if (!data.success) {
            alert('خطا در دریافت اطلاعات گروه');
            return;
        }

        const groupSettings = data.settings;
        const adminIds = groupSettings && Array.isArray(groupSettings.admins) ? groupSettings.admins.slice() : [];
        let ownerId = groupSettings && groupSettings.owner_id ? groupSettings.owner_id : null;
        if (!ownerId && groupSettings.group_id === 'global' && groupSettings.admin_email === currentUser.email) {
            ownerId = currentUser.id;
        }
        // ensure owner appears in admin list
        if (ownerId && !adminIds.includes(ownerId)) adminIds.push(ownerId);
        const isGroupAdmin = adminIds.includes(currentUser.id) || (ownerId && currentUser.id === ownerId);
        const currentUserIsAdmin = isGroupAdmin; // used later in members loop
        const groupType = groupSettings.group_type === 'channel' ? 'کانال' : 'گروه';
        const groupIcon = groupSettings.group_type === 'channel' ? '📢' : '👥';

        // حذف ایموجی از اول نام اگر وجود داشته باشه
        const cleanName = groupSettings.group_name.replace(/^[🌐👥📢]\s*/, '');

        // نمایش یا مخفی کردن دکمه ویرایش بر اساس دسترسی
        const editGroupInfoBtn = document.getElementById('edit-group-info-btn');
        if (editGroupInfoBtn) {
            editGroupInfoBtn.style.display = isGroupAdmin ? 'flex' : 'none';
        }

        // نمایش یا مخفی کردن بخش کاربران محروم (فقط برای گروه‌های سفارشی و ادمین‌ها)
        const bannedUsersSection = document.getElementById('banned-users-section');
        if (bannedUsersSection) {
            if (groupId !== 'global' && isGroupAdmin) {
                bannedUsersSection.style.display = 'block';
                // تغییر data attribute برای شناسایی گروه
                bannedUsersSection.dataset.groupId = groupId;
                bannedUsersSection.dataset.groupType = groupType;
            } else {
                bannedUsersSection.style.display = 'none';
            }
        }

        // نمایش دکمه خروج از گروه (برای همه غیر از گروه عمومی)
        const leaveGroupBtn = document.getElementById('leave-group-btn');
        if (leaveGroupBtn) {
            if (groupId !== 'global') {
                leaveGroupBtn.style.display = 'flex';

                // حذف event listener قبلی
                const newLeaveBtn = leaveGroupBtn.cloneNode(true);
                leaveGroupBtn.parentNode.replaceChild(newLeaveBtn, leaveGroupBtn);

                // اضافه کردن event listener جدید
                newLeaveBtn.addEventListener('click', () => {
                    showLeaveGroupModal(groupId, groupType, isGroupAdmin);
                });
            } else {
                leaveGroupBtn.style.display = 'none';
            }
        }

        // نمایش نام گروه
        if (groupInfoName) {
            groupInfoName.innerHTML = escapeHtml(`${groupIcon} ${cleanName}`);
            try {
                if (typeof parseEmojis !== 'undefined') parseEmojis(groupInfoName);
                else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(groupInfoName);
            } catch (err) {
                console.error('parseEmojis on groupInfoName failed', err);
            }
        }

        // نمایش بیوگرافی (برای همه)
        if (groupInfoDescription) {
            if (groupSettings.description && groupSettings.description.trim()) {
                groupInfoDescription.textContent = groupSettings.description;
                try {
                    if (typeof parseEmojis !== 'undefined') {
                        parseEmojis(groupInfoDescription);
                    } else if (typeof replaceIranFlag !== 'undefined') {
                        replaceIranFlag(groupInfoDescription);
                    }
                } catch (err) {
                    console.error('emoji rendering on groupInfoDescription failed', err);
                }
                groupInfoDescription.style.display = 'block';
            } else {
                groupInfoDescription.style.display = 'none';
            }
        }

        // نمایش پروفایل گروه
        if (groupInfoAvatar) {
            if (groupSettings.profile_picture) {
                groupInfoAvatar.style.backgroundImage = `url(${groupSettings.profile_picture})`;
                groupInfoAvatar.style.backgroundSize = 'cover';
                groupInfoAvatar.style.backgroundPosition = 'center';
                groupInfoAvatar.textContent = '';
            } else {
                groupInfoAvatar.style.backgroundImage = 'none';
                groupInfoAvatar.textContent = groupSettings.group_name.charAt(0).toUpperCase();
            }
        }

        // نمایش آیدی گروه
        if (groupInfoUserid) {
            const displayUserid = groupSettings.group_userid ? `@${groupSettings.group_userid}` : 'آیدی ثبت نشده';

            // حذف event listener قبلی با احتیاط
            let newUserid = groupInfoUserid;
            const parent = groupInfoUserid.parentNode;
            if (parent) {
                newUserid = groupInfoUserid.cloneNode(true);
                parent.replaceChild(newUserid, groupInfoUserid);
            }

            newUserid.innerHTML = `${displayUserid} <span class="copy-icon">📋</span>`;

            if (groupSettings.group_userid) {
                newUserid.addEventListener('click', async () => {
                    const userid = `@${groupSettings.group_userid}`;

                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            await navigator.clipboard.writeText(userid);
                        } else {
                            const textArea = document.createElement('textarea');
                            textArea.value = userid;
                            textArea.style.position = 'fixed';
                            textArea.style.left = '-999999px';
                            textArea.style.top = '-999999px';
                            document.body.appendChild(textArea);
                            textArea.focus();
                            textArea.select();
                            document.execCommand('copy');
                            textArea.remove();
                        }

                        newUserid.classList.add('copied');
                        newUserid.innerHTML = 'کپی شد! ✓';

                        setTimeout(() => {
                            newUserid.classList.remove('copied');
                            newUserid.innerHTML = `${userid} <span class="copy-icon">📋</span>`;
                        }, 2000);
                    } catch (err) {
                        console.error('خطا در کپی کردن:', err);
                        alert('خطا در کپی کردن آیدی');
                    }
                });
            }
        }

        // نمایش تعداد اعضا و لیست اعضا
        try {
            const membersRes = await fetch(`/api/group-members/${groupId}`);
            const membersData = await membersRes.json();

            if (membersData.success && membersData.members) {
                const members = membersData.members;
                const onlineCount = members.filter(m => m.online).length;
                const totalCount = members.length;

                // نمایش تعداد اعضا
                if (groupInfoMembersCount) {
                    groupInfoMembersCount.innerHTML = `
                        <span style="color: #4caf50;">${onlineCount} آنلاین</span>
                        <span style="color: #8b98a5;"> از ${totalCount} عضو</span>
                    `;
                }

                // نمایش لیست اعضا
                membersList.innerHTML = '';
                members.forEach(member => {
                    const isCurrentUser = member.id === currentUser.id;
                    const statusText = member.online ? 'آنلاین' : 'آفلاین';
                    const statusClass = member.online ? 'online' : 'offline';
                    const isAdmin = adminIds.includes(member.id);
                    const isOwner = ownerId && member.id === ownerId;

                    // ایجاد آواتار
                    let avatarHTML;
                    if (member.profile_picture) {
                        avatarHTML = `<div class="user-avatar" style="background-image: url("${member.profile_picture}"); background-size: cover; background-position: center;"></div>`;
                    } else {
                        const avatar = member.username.charAt(0).toUpperCase();
                        avatarHTML = `<div class="user-avatar">${avatar}</div>`;
                    }

                    const memberDiv = document.createElement('div');
                    memberDiv.className = 'member-item';
                    memberDiv.innerHTML = `
                        ${avatarHTML}
                        <div class="user-info" data-username="${member.username}" style="cursor: pointer;">
                            <div class="user-name">${member.username}${isCurrentUser ? ' (شما)' : ''}</div>
                            <div class="user-status ${statusClass}">${isOwner ? `مالک ${groupType}` : (isAdmin ? `ادمین ${groupType}` : statusText)}</div>
                        </div>
                    `;

                    // کلیک روی نام کاربر برای نمایش اطلاعات
                    const userInfoDiv = memberDiv.querySelector('.user-info');
                    if (userInfoDiv && !isCurrentUser) {
                        userInfoDiv.addEventListener('click', () => {
                            membersModal.style.display = 'none';
                            showUserInfo(member.username);
                        });
                    }


                    // دکمه‌های مدیریت ادمین
                    if (!isCurrentUser && currentUserIsAdmin && !isOwner) {
                        // attach data attributes
                        memberDiv.dataset.userid = member.id;
                        memberDiv.dataset.username = member.username;
                        memberDiv.dataset.isAdmin = isAdmin;
                        memberDiv.dataset.isOwner = isOwner;
                        memberDiv.dataset.isCurrentUser = isCurrentUser;

                        const handlePromo2 = (x, y) => {
                            const statusDiv = memberDiv.querySelector('.user-status');
                            const alreadyAdmin = memberDiv.dataset.isAdmin === 'true';
                            pendingUpgrade = {
                                groupId: groupId,
                                targetUserId: member.id,
                                targetUsername: member.username,
                                buttonElem: null,
                                statusElem: statusDiv,
                                groupType: groupType,
                                isAdmin: alreadyAdmin,
                                targetIsOwner: isOwner,
                                currentUserIsOwner: currentUser.id === ownerId,
                                menuTarget: memberDiv
                            };
                            showMemberContextMenu(x, y);
                        };

                        memberDiv.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            handlePromo2(e.pageX, e.pageY);
                        });
                        memberDiv.addEventListener('mousedown', (e) => {
                            if (e.button === 2) {
                                e.preventDefault();
                                handlePromo2(e.pageX, e.pageY);
                            }
                        });

                        let lp = null;
                        memberDiv.addEventListener('touchstart', (e) => {
                            lp = setTimeout(() => {
                                const touch = e.touches[0];
                                handlePromo2(touch.pageX, touch.pageY);
                            }, 500);
                        });
                        memberDiv.addEventListener('touchend', () => { clearTimeout(lp); });
                        memberDiv.addEventListener('touchmove', () => { clearTimeout(lp); });
                    }

                    membersList.appendChild(memberDiv);
                });
            } else {
                // در صورت خطا، فقط سازنده را نمایش بده
                if (groupInfoMembersCount) {
                    groupInfoMembersCount.innerHTML = `<span style="color: #8b98a5;">1 عضو</span>`;
                }

                membersList.innerHTML = `
                    <div class="member-item">
                        <div class="user-avatar">${currentUser.username.charAt(0).toUpperCase()}</div>
                        <div class="user-info">
                            <div class="user-name">${currentUser.username} (شما)</div>
                            <div class="user-status online">ادمین ${groupType}</div>
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading members:', error);
            // در صورت خطا، فقط سازنده را نمایش بده
            if (groupInfoMembersCount) {
                groupInfoMembersCount.innerHTML = `<span style="color: #8b98a5;">1 عضو</span>`;
            }

            membersList.innerHTML = `
                <div class="member-item">
                    <div class="user-avatar">${currentUser.username.charAt(0).toUpperCase()}</div>
                    <div class="user-info">
                        <div class="user-name">${currentUser.username} (شما)</div>
                        <div class="user-status online">ادمین ${groupType}</div>
                    </div>
                </div>
            `;
        }

        membersModal.style.display = 'flex';

    } catch (error) {
        console.error('Error loading group info:', error);
        alert('خطا در بارگذاری اطلاعات گروه');
    }
}

// نمایش اطلاعات گروه
async function showGroupInfo() {
    const modal = document.getElementById('group-info-modal');
    const groupInfoAvatar = document.getElementById('group-info-avatar');
    const groupInfoName = document.getElementById('group-info-name');
    const groupInfoUserid = document.getElementById('group-info-userid');
    const groupInfoMembers = document.getElementById('group-info-members');

    if (!modal) return;

    // تلاش برای گرفتن تنظیمات گروه از سرور
    let settings = {};
    try {
        const res = await fetch('/api/group-settings/global');
        const d = await res.json();
        if (d.success && d.settings) settings = d.settings;
    } catch (err) {
        console.error('Error fetching global settings in showGroupInfo:', err);
    }

    // بارگذاری پروفایل گروه
    const savedGroupProfile = localStorage.getItem('groupProfilePicture');
    if (groupInfoAvatar) {
        if (settings.profile_picture) {
            groupInfoAvatar.style.backgroundImage = `url(${settings.profile_picture})`;
            groupInfoAvatar.style.backgroundSize = 'cover';
            groupInfoAvatar.style.backgroundPosition = 'center';
            groupInfoAvatar.textContent = '';
        } else if (savedGroupProfile) {
            groupInfoAvatar.style.backgroundImage = `url(${savedGroupProfile})`;
            groupInfoAvatar.style.backgroundSize = 'cover';
            groupInfoAvatar.style.backgroundPosition = 'center';
            groupInfoAvatar.textContent = '';
        } else {
            groupInfoAvatar.style.backgroundImage = 'none';
            groupInfoAvatar.textContent = '🌐';
        }
    }

    // نمایش نام گروه
    if (groupInfoName) {
        const nameText = settings.group_name || 'گروه عمومی';
        groupInfoName.innerHTML = escapeHtml(`🌐 ${nameText}`);
        try {
            if (typeof parseEmojis !== 'undefined') parseEmojis(groupInfoName);
            else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(groupInfoName);
        } catch (err) {
            console.error('parseEmojis on groupInfoName failed', err);
        }
    }

    // نمایش آیدی گروه
    if (groupInfoUserid) {
        const displayUserid = settings.group_userid ? `@${settings.group_userid}` : '@publik_grup';
        groupInfoUserid.innerHTML = `${displayUserid} <span class="copy-icon">📋</span>`;
    }

    // نمایش تعداد اعضا
    if (groupInfoMembers && onlineUsers) {
        const onlineCount = onlineUsers.filter(u => u.online).length;
        const totalCount = onlineUsers.length;
        groupInfoMembers.innerHTML = `
            <span style="color: #4caf50;">${onlineCount} آنلاین</span>
            <span style="color: #8b98a5;"> از ${totalCount} عضو</span>
        `;
    }

    modal.style.display = 'flex';
}

// راه‌اندازی مودال اطلاعات گروه
function setupGroupInfoModal() {
    const modal = document.getElementById('group-info-modal');
    const closeBtn = document.getElementById('close-group-info-modal');
    const groupInfoUserid = document.getElementById('group-info-userid');
    const viewMembersBtn = document.getElementById('view-group-members-btn');

    if (!modal) return;

    // بستن مودال
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    // کلیک خارج از مودال
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // کپی کردن آیدی
    if (groupInfoUserid) {
        groupInfoUserid.addEventListener('click', async () => {
            let userid = groupInfoUserid.textContent.replace('📋', '').trim();
            if (!userid.startsWith('@')) userid = '@' + userid;

            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(userid);
                } else {
                    const textArea = document.createElement('textarea');
                    textArea.value = userid;
                    textArea.style.position = 'fixed';
                    textArea.style.left = '-999999px';
                    textArea.style.top = '-999999px';
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    document.execCommand('copy');
                    textArea.remove();
                }

                groupInfoUserid.classList.add('copied');
                groupInfoUserid.innerHTML = 'کپی شد! ✓';

                setTimeout(() => {
                    groupInfoUserid.classList.remove('copied');
                    groupInfoUserid.innerHTML = userid + ' <span class="copy-icon">📋</span>';
                }, 2000);
            } catch (err) {
                console.error('خطا در کپی کردن:', err);
                alert('خطا در کپی کردن آیدی');
            }
        });
    }

    // دکمه مشاهده اعضا
    if (viewMembersBtn) {
        viewMembersBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            showMembersModal();
        });
    }
}

function openPrivateChat(targetUser) {
    // افزودن وضعیت به تاریخچه برای دکمه برگشت گوشی
    if (!window.historyInitDone) {
        history.pushState({ appInit: true }, '');
        window.historyInitDone = true;
    }
    history.pushState({ canGoBack: true }, '');

    // غیرفعال کردن حالت انتخاب هنگام تغییر چت
    if (isSelectionMode) {
        disableSelectionMode();
    }

    // اگر قبلاً در همین چت بودیم، فقط هدر را آپدیت کن و پیام‌ها را پاک نکن
    const wasInSameChat = currentChat === targetUser;

    currentChat = targetUser;
    currentGroupSettings = null; // ریست کردن تنظیمات گروه
    saveChatState(); // ذخیره وضعیت چت

    // مخفی کردن صفحه خوش‌آمدگویی
    hideWelcomeScreen();

    // اضافه کردن به لیست چت‌ها اگر وجود نداره
    if (!document.querySelector(`[data-chat="${targetUser}"]`)) {
        addPrivateChatToList(targetUser);
    }

    // آپدیت هدر
    const chatHeaderName = document.querySelector('.chat-header-name');
    const chatHeaderStatus = document.querySelector('.chat-header-status');
    const chatAvatar = document.querySelector('.chat-header-info .chat-avatar');
    const chatHeaderDetails = document.getElementById('chat-header-details');

    chatHeaderName.textContent = targetUser;
    try {
        if (typeof parseEmojis !== 'undefined') {
            parseEmojis(chatHeaderName);
        } else if (typeof replaceIranFlag !== 'undefined') {
            replaceIranFlag(chatHeaderName);
        }
    } catch (err) {
        console.error('emoji rendering on chatHeaderName failed', err);
    }
    chatHeaderStatus.textContent = 'آنلاین';

    // نمایش عکس پروفایل یا حرف اول در هدر
    const profilePicture = usersProfilePictureMap.get(targetUser);
    if (profilePicture) {
        chatAvatar.style.backgroundImage = `url("${profilePicture}")`;
        chatAvatar.style.backgroundSize = 'cover';
        chatAvatar.style.backgroundPosition = 'center';
        chatAvatar.textContent = '';
    } else {
        chatAvatar.style.backgroundImage = 'none';
        chatAvatar.textContent = targetUser.charAt(0).toUpperCase();
    }

    // اضافه کردن event listener برای نمایش اطلاعات کاربر
    if (chatHeaderDetails) {
        chatHeaderDetails.style.cursor = 'pointer';
        chatHeaderDetails.onclick = () => showUserInfo(targetUser);
    }

    // فقط اگر از چت دیگری آمدیم، پیام‌ها را بارگذاری کن
    if (!wasInSameChat) {
        // پاک کردن پیام‌ها
        messagesDiv.innerHTML = '';

        // بارگذاری تاریخچه از سرور
        const targetUserId = usersIdMap.get(targetUser);
        if (targetUserId && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'load_private_history',
                targetUsername: targetUser,
                targetUserId: targetUserId
            }));
        }

        // نمایش پیام‌های موجود در حافظه
        if (privateChats.has(targetUser)) {
            privateChats.get(targetUser).forEach(msg => {
                addMessage(msg.from, msg.text, msg.from === username, msg.timestamp);
            });
        }
    }

    // آپدیت لیست چت‌ها
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.chat === targetUser) {
            item.classList.add('active');
        }
    });

    // علامت‌گذاری پیام‌ها به عنوان خوانده شده
    const targetUserId = usersIdMap.get(targetUser);
    if (targetUserId) {
        markMessagesAsRead(targetUserId);
    }

    messageInput.focus();
}

// علامت‌گذاری پیام‌ها به عنوان خوانده شده
async function markMessagesAsRead(otherUserId) {
    try {
        await fetch('/api/mark-messages-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                otherUserId: otherUserId
            })
        });

        // حذف badge از UI
        const chatItem = document.querySelector(`[data-chat="${Array.from(usersIdMap.entries()).find(([k, v]) => v === otherUserId)?.[0]}"]`);
        if (chatItem) {
            const badge = chatItem.querySelector('.unread-badge');
            if (badge) {
                badge.remove();
            }
        }
    } catch (error) {
        console.error('Error marking messages as read:', error);
    }
}

// بررسی ادمین بودن برای گروه عمومی
async function checkGlobalAdminStatus() {
    try {
        const response = await fetch('/api/check-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupId: 'global',
                userId: currentUser.id
            })
        });

        const data = await response.json();

        if (data.success) {
            // ذخیره وضعیت ادمین در currentUser
            currentUser.isGlobalAdmin = data.isAdmin || data.is_admin;
        }
    } catch (error) {
        console.error('Error checking admin status:', error);
        currentUser.isGlobalAdmin = false;
    }
}

function switchToGlobalChat() {
    // افزودن وضعیت به تاریخچه برای دکمه برگشت گوشی
    if (!window.historyInitDone) {
        history.pushState({ appInit: true }, '');
        window.historyInitDone = true;
    }
    history.pushState({ canGoBack: true }, '');

    if (bannedFromGlobal) {
        showToast('شما از گروه عمومی حذف شده‌اید');
        return;
    }
    // غیرفعال کردن حالت انتخاب هنگام تغییر چت
    if (isSelectionMode) {
        disableSelectionMode();
    }

    // اگر قبلاً در گروه عمومی بودیم، فقط هدر را آپدیت کن و پیام‌ها را پاک نکن
    const wasInGlobalChat = currentChat === 'global';

    currentChat = 'global';
    currentGroupSettings = null; // ریست کردن تنظیمات گروه

    // بررسی ادمین بودن برای گروه عمومی
    checkGlobalAdminStatus();

    saveChatState(); // ذخیره وضعیت چت

    // مخفی کردن صفحه خوش‌آمدگویی
    hideWelcomeScreen();

    // آپدیت هدر
    const chatHeaderName = document.querySelector('.chat-header-name');
    const chatHeaderStatus = document.querySelector('.chat-header-status');
    const chatAvatar = document.querySelector('.chat-header-info .chat-avatar');
    const chatHeaderDetails = document.getElementById('chat-header-details');

    chatHeaderName.textContent = 'گروه عمومی';

    // نمایش آیدی گروه و تعداد اعضا
    if (onlineUsers && onlineUsers.length > 0) {
        const onlineCount = onlineUsers.filter(u => u.online).length;
        const totalCount = onlineUsers.length;
        chatHeaderStatus.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
                <div style="color: #5288c1; font-size: 12px; font-weight: 500;">@publik_grup</div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <span style="width: 8px; height: 8px; background: #4caf50; border-radius: 50%; display: inline-block;"></span>
                    <span style="color: #4caf50; font-weight: 600;">${onlineCount}</span>
                    <span style="color: #5a6a7a; margin: 0 3px;">/</span>
                    <span style="color: #8b98a5;">${totalCount}</span>
                    <span style="color: #8b98a5; margin-right: 4px;">عضو</span>
                </div>
            </div>
        `;
    } else {
        chatHeaderStatus.innerHTML = '<div style="color: #5288c1; font-size: 12px; font-weight: 500;">@publik_grup</div>';
    }

    // دوباره لود کن تا در صورت وجود نام/آیدی سفارشی، نمایش داده شود
    loadGroupProfile();

    // بارگذاری پروفایل گروه از localStorage (کش)
    const savedGroupProfile = localStorage.getItem('groupProfilePicture');
    if (savedGroupProfile) {
        chatAvatar.style.backgroundImage = `url(${savedGroupProfile})`;
        chatAvatar.style.backgroundSize = 'cover';
        chatAvatar.style.backgroundPosition = 'center';
        chatAvatar.textContent = '';
    } else {
        chatAvatar.style.backgroundImage = 'none';
        chatAvatar.textContent = '🌐';
    }

    // تغییر event listener برای نمایش اعضا
    if (chatHeaderDetails) {
        chatHeaderDetails.style.cursor = 'pointer';
        chatHeaderDetails.onclick = () => {
            if (currentChat === 'global') {
                showMembersModal();
            }
        };
    }

    // فقط اگر از چت دیگری آمدیم، پیام‌ها را بارگذاری کن
    if (!wasInGlobalChat) {
        // پاک کردن پیام‌ها
        messagesDiv.innerHTML = '';

        // همیشه از سرور بارگذاری کن (نه از کش)
        loadGlobalMessagesWithUnread();
    }

    // آپدیت لیست چت‌ها
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.chat === 'global') {
            item.classList.add('active');
        }
    });

    // حذف badge از گروه عمومی
    const globalChatItem = document.querySelector('[data-chat="global"]');
    if (globalChatItem) {
        const badge = globalChatItem.querySelector('.unread-badge');
        if (badge) {
            badge.remove();
        }
    }

    messageInput.focus();
}

// علامت‌گذاری پیام‌های گروه به عنوان خوانده شده
async function markGroupMessagesAsRead() {
    try {
        await fetch('/api/mark-group-messages-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                messageId: lastGroupMessageId
            })
        });
    } catch (error) {
        console.error('Error marking group messages as read:', error);
    }
}

// علامت‌گذاری پیام‌های گروه سفارشی به عنوان خوانده شده
async function markCustomGroupMessagesAsRead(groupId, messageId) {
    try {
        await fetch('/api/mark-custom-group-messages-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                groupId: groupId,
                messageId: messageId
            })
        });

        // حذف badge از UI
        const chatItem = document.querySelector(`[data-chat="${groupId}"]`);
        if (chatItem) {
            const badge = chatItem.querySelector('.unread-badge');
            if (badge) {
                badge.remove();
            }
        }
    } catch (error) {
        console.error('Error marking custom group messages as read:', error);
    }
}

// آپدیت badge پیام‌های جدید گروه سفارشی
async function updateCustomGroupUnreadBadge(groupId) {
    try {
        const res = await fetch(`/api/unread-custom-group-messages/${currentUser.id}/${groupId}`);
        const data = await res.json();

        if (data.success) {
            const chatItem = document.querySelector(`[data-chat="${groupId}"]`);
            if (chatItem) {
                let badge = chatItem.querySelector('.unread-badge');

                if (data.unread_count > 0) {
                    if (badge) {
                        badge.textContent = data.unread_count;
                    } else {
                        const chatMeta = chatItem.querySelector('.chat-meta');
                        if (chatMeta) {
                            badge = document.createElement('div');
                            badge.className = 'unread-badge';
                            badge.textContent = data.unread_count;
                            chatMeta.appendChild(badge);
                        }
                    }
                } else {
                    if (badge) {
                        badge.remove();
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error updating custom group unread badge:', error);
    }
}

// آپدیت badge پیام‌های جدید گروه
async function updateGroupUnreadBadge() {
    try {
        const res = await fetch(`/api/unread-group-messages/${currentUser.id}`);
        const data = await res.json();

        if (data.success) {
            const globalChatItem = document.querySelector('[data-chat="global"]');
            if (globalChatItem) {
                let badge = globalChatItem.querySelector('.unread-badge');

                if (data.unread_count > 0) {
                    if (badge) {
                        badge.textContent = data.unread_count;
                    } else {
                        const chatMeta = globalChatItem.querySelector('.chat-meta');
                        if (chatMeta) {
                            badge = document.createElement('div');
                            badge.className = 'unread-badge';
                            badge.textContent = data.unread_count;
                            chatMeta.appendChild(badge);
                        }
                    }
                } else if (badge) {
                    badge.remove();
                }
            }
        }
    } catch (error) {
        console.error('Error updating group unread badge:', error);
    }
}

// آپدیت آخرین پیام گروه در sidebar
function updateGroupLastMessage(message, timestamp) {
    const globalChatItem = document.querySelector('[data-chat="global"]');
    if (globalChatItem) {
        const lastMessageDiv = globalChatItem.querySelector('.chat-last-message');
        if (lastMessageDiv) {
            const truncatedMessage = message.substring(0, 30) + (message.length > 30 ? '...' : '');
            lastMessageDiv.textContent = truncatedMessage;

            // تبدیل ایموجی‌ها به تصویر Noto (Android)
            if (typeof twemoji !== 'undefined') {
                parseEmojis(lastMessageDiv);
            }
        }

        const timeDiv = globalChatItem.querySelector('.chat-time');
        if (timeDiv && timestamp) {
            const date = new Date(timestamp);
            timeDiv.textContent = date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
        }
    }
}

// بارگذاری پیام‌های قدیمی‌تر
async function loadOlderMessages() {
    if (isLoadingOlderMessages) return;

    isLoadingOlderMessages = true;

    try {
        if (currentChat === 'global') {
            // بارگذاری پیام‌های قدیمی‌تر گروه
            if (!oldestGroupMessageId) {
                isLoadingOlderMessages = false;
                return;
            }

            const res = await fetch(`/api/messages?before=${oldestGroupMessageId}&userId=${currentUser.id}`);
            const data = await res.json();

            if (data.success && data.messages && data.messages.length > 0) {
                // ذخیره موقعیت اسکرول فعلی
                const scrollHeight = messagesDiv.scrollHeight;
                const scrollTop = messagesDiv.scrollTop;

                // اضافه کردن پیام‌های قدیمی به ابتدای لیست
                const fragment = document.createDocumentFragment();
                const tempDiv = document.createElement('div');

                data.messages.forEach(msg => {
                    // اگر پیام سیستمی است، به صورت مختلف نمایش بده
                    if (msg.message_type === 'system' || msg.username === 'system') {
                        const sysDiv = document.createElement('div');
                        sysDiv.className = 'system-message';
                        sysDiv.textContent = msg.message;

                        // رندر کردن ایموجی‌های سفارشی
                        try {
                            if (typeof parseEmojis !== 'undefined') {
                                parseEmojis(sysDiv);
                            }
                        } catch (err) {
                            console.error('parseEmojis on system message failed', err);
                        }

                        tempDiv.appendChild(sysDiv);
                        // به‌روزرسانی IDها مانند پیام عادی
                        if (!oldestGroupMessageId || msg.id < oldestGroupMessageId) {
                            oldestGroupMessageId = msg.id;
                        }
                        if (msg.id > lastGroupMessageId) lastGroupMessageId = msg.id;
                        return;
                    }

                    const isOwn = msg.username === username;
                    const isRead = msg.is_read === 1;
                    const messageDiv = createMessageElement(msg.username, msg.message, isOwn, msg.created_at, msg.id, isRead);
                    tempDiv.appendChild(messageDiv);

                    // آپدیت قدیمی‌ترین ID
                    if (!oldestGroupMessageId || msg.id < oldestGroupMessageId) {
                        oldestGroupMessageId = msg.id;
                    }
                });

                // اضافه کردن به ابتدای messagesDiv
                messagesDiv.insertBefore(tempDiv, messagesDiv.firstChild);

                // بازگرداندن موقعیت اسکرول
                messagesDiv.scrollTop = messagesDiv.scrollHeight - scrollHeight + scrollTop;
            }
        } else if (usersIdMap.has(currentChat)) {
            // بارگذاری پیام‌های قدیمی‌تر چت خصوصی
            const targetUserId = usersIdMap.get(currentChat);
            if (!targetUserId || !oldestPrivateMessageId[currentChat]) {
                isLoadingOlderMessages = false;
                return;
            }

            const res = await fetch(`/api/private-messages/${currentUser.id}/${targetUserId}?before=${oldestPrivateMessageId[currentChat]}`);
            const data = await res.json();

            if (data.success && data.messages && data.messages.length > 0) {
                // ذخیره موقعیت اسکرول فعلی
                const scrollHeight = messagesDiv.scrollHeight;
                const scrollTop = messagesDiv.scrollTop;

                // اضافه کردن پیام‌های قدیمی به ابتدای لیست
                const tempDiv = document.createElement('div');

                data.messages.forEach(msg => {
                    const isOwn = msg.sender_username === username;
                    const isRead = msg.is_read === 1;
                    const messageDiv = createMessageElement(msg.sender_username, msg.message, isOwn, msg.created_at, msg.id, isRead);
                    tempDiv.appendChild(messageDiv);

                    // آپدیت قدیمی‌ترین ID
                    if (!oldestPrivateMessageId[currentChat] || msg.id < oldestPrivateMessageId[currentChat]) {
                        oldestPrivateMessageId[currentChat] = msg.id;
                    }
                });

                // اضافه کردن به ابتدای messagesDiv
                messagesDiv.insertBefore(tempDiv, messagesDiv.firstChild);

                // بازگرداندن موقعیت اسکرول
                messagesDiv.scrollTop = messagesDiv.scrollHeight - scrollHeight + scrollTop;
            }
        } else {
            // بارگذاری پیام‌های قدیمی‌تر گروه/کانال سفارشی
            const groupId = currentChat;
            if (!oldestCustomGroupMessageId[groupId]) {
                isLoadingOlderMessages = false;
                return;
            }

            const res = await fetch(`/api/group-messages/${groupId}?before=${oldestCustomGroupMessageId[groupId]}&userId=${currentUser.id}`);
            const data = await res.json();

            if (data.success && data.messages && data.messages.length > 0) {
                const scrollHeight = messagesDiv.scrollHeight;
                const scrollTop = messagesDiv.scrollTop;
                const tempDiv = document.createElement('div');

                data.messages.forEach(msg => {
                    // if history contains a system message we render differently
                    if (msg.message_type === 'system' || msg.username === 'system') {
                        const sysDiv = document.createElement('div');
                        sysDiv.className = 'system-message';
                        sysDiv.textContent = msg.message;
                        if (msg.created_at) {
                            sysDiv.dataset.timestamp = msg.created_at;
                        }

                        // رندر کردن ایموجی‌های سفارشی
                        try {
                            if (typeof parseEmojis !== 'undefined') {
                                parseEmojis(sysDiv);
                            }
                        } catch (err) {
                            console.error('parseEmojis on system message failed', err);
                        }

                        tempDiv.appendChild(sysDiv);
                        if (msg.id > (lastCustomGroupMessageId[groupId] || 0)) {
                            lastCustomGroupMessageId[groupId] = msg.id;
                        }
                        if (!oldestCustomGroupMessageId[groupId] || msg.id < oldestCustomGroupMessageId[groupId]) {
                            oldestCustomGroupMessageId[groupId] = msg.id;
                        }
                        return;
                    }

                    const isOwn = msg.username === username;
                    const isRead = msg.is_read === 1;

                    // check if it's a file message
                    let fileData = null;
                    if (msg.message && msg.message.startsWith('[FILE:')) {
                        try {
                            const startIndex = msg.message.indexOf('{');
                            const endIndex = msg.message.lastIndexOf('}');
                            if (startIndex !== -1 && endIndex !== -1) {
                                const fileJson = msg.message.substring(startIndex, endIndex + 1);
                                fileData = JSON.parse(fileJson);
                            }
                        } catch (e) {
                            console.error('Error parsing file data:', e);
                        }
                    }

                    if (fileData) {
                        addFileMessage(msg.username, fileData, isOwn, msg.created_at, msg.id, isRead, msg.reply_to, msg.reactions);
                    } else {
                        addMessage(msg.username, msg.message, isOwn, msg.created_at, msg.id, isRead, msg.reply_to, msg.reactions);
                    }

                    if (msg.id > (lastCustomGroupMessageId[groupId] || 0)) {
                        lastCustomGroupMessageId[groupId] = msg.id;
                    }
                    if (!oldestCustomGroupMessageId[groupId] || msg.id < oldestCustomGroupMessageId[groupId]) {
                        oldestCustomGroupMessageId[groupId] = msg.id;
                    }
                });

                messagesDiv.insertBefore(tempDiv, messagesDiv.firstChild);
                messagesDiv.scrollTop = messagesDiv.scrollHeight - scrollHeight + scrollTop;
            }
        }
    } catch (error) {
        console.error('خطا در بارگذاری پیام‌های قدیمی:', error);
    } finally {
        isLoadingOlderMessages = false;
    }
}

// تبدیل متن به HTML با لینک کردن آیدی‌ها
function linkifyUserIds(text) {
    // escape the text first to prevent HTML injection, then linkify
    if (typeof text !== 'string') return '';
    const escaped = escapeHtml(text);

    // regex for detecting @username after escaping (safe characters only)
    const useridPattern = /@([a-zA-Z0-9_]+)/g;

    return escaped.replace(useridPattern, (match, userid) => {
        return `<span class="userid-link" data-userid="${userid}">${match}</span>`;
    });
}

// مدیریت کلیک روی آیدی‌ها
async function handleUserIdClick(userid) {
    try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(userid)}`);
        const data = await res.json();

        if (data.success && data.result) {
            const result = data.result;

            if (result.type === 'group' || result.type === 'channel') {
                // اگر گروه یا کانال بود
                if (result.id === 'global') {
                    // گروه عمومی
                    if (currentChat !== 'global') {
                        switchToGlobalChat();
                    } else {
                        addSystemMessage('شما در حال حاضر در گروه عمومی هستید');
                    }
                } else {
                    // اضافه کردن به sidebar اگر وجود نداره
                    if (!document.querySelector(`[data-chat="${result.id}"]`)) {
                        addGroupOrChannelToSidebar({
                            id: result.id,
                            name: result.name,
                            groupId: result.userid,
                            profilePicture: result.profile_picture
                        }, result.type);
                    }
                    // باز کردن گروه/کانال
                    openGroupOrChannel(result.id, result.name, result.type, result.profile_picture);
                }
            } else if (result.type === 'user') {
                // اگر کاربر بود
                const targetUsername = result.username;

                // اضافه کردن به نقشه userId و profilePicture
                usersIdMap.set(targetUsername, result.id);
                if (result.profile_picture) {
                    usersProfilePictureMap.set(targetUsername, result.profile_picture);
                }

                // باز کردن چت خصوصی
                openPrivateChat(targetUsername);
            }
        } else {
            addSystemMessage(`@${userid} یافت نشد`);
        }
    } catch (error) {
        console.error('Search error:', error);
        addSystemMessage('خطا در جستجو');
    }
}

// جستجو و باز کردن چت
async function searchAndOpenChat(query) {
    try {
        const res = await fetch(`/api/search-user?query=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (data.success && data.user) {
            const targetUsername = data.user.username;

            // اضافه کردن به نقشه userId و profilePicture
            usersIdMap.set(targetUsername, data.user.id);
            if (data.user.profile_picture) {
                usersProfilePictureMap.set(targetUsername, data.user.profile_picture);
            }

            // باز کردن چت
            openPrivateChat(targetUsername);
        } else {
            addSystemMessage(`کاربری با آیدی @${query} یافت نشد`);
        }
    } catch (error) {
        console.error('Search error:', error);
        addSystemMessage('خطا در جستجوی کاربر');
    }
}

// تابع کمکی برای ساخت المنت پیام
function createMessageElement(user, text, isOwn, timestamp, messageId, isRead = false, fileData = null, replyTo = null, reactions = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;

    // store timestamp on element so we can sort later if needed
    if (timestamp) {
        messageDiv.dataset.timestamp = timestamp;
    } else {
        // fallback to current time
        const now = new Date().toISOString();
        messageDiv.dataset.timestamp = now;
    }

    if (messageId) {
        messageDiv.dataset.messageId = messageId;
    }

    let time;
    if (timestamp) {
        const date = new Date(timestamp);
        time = date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    } else {
        time = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    }

    // بررسی اینکه آیا در کانال هستیم
    const isChannel = currentGroupSettings && currentGroupSettings.group_type === 'channel';

    // ایجاد آواتار با عکس پروفایل یا حرف اول
    let avatarHTML;
    let displayName = user;
    let profilePicture;

    if (isChannel && !isOwn) {
        // در کانال، نام و عکس کانال را نمایش بده
        displayName = currentGroupSettings.group_name;
        profilePicture = currentGroupSettings.profile_picture;

        if (profilePicture) {
            avatarHTML = `<div class="message-avatar"><img class="message-avatar-img" src="${profilePicture}" loading="lazy" decoding="async" alt=""></div>`;
        } else {
            const avatar = displayName.charAt(0).toUpperCase();
            avatarHTML = `<div class="message-avatar">${avatar}</div>`;
        }
    } else {
        // در گروه یا PV، نام و عکس کاربر را نمایش بده
        profilePicture = isOwn ? currentUser.profile_picture : usersProfilePictureMap.get(user);

        if (profilePicture) {
            avatarHTML = `<div class="message-avatar"><img class="message-avatar-img" src="${profilePicture}" loading="lazy" decoding="async" alt=""></div>`;
        } else {
            const avatar = user.charAt(0).toUpperCase();
            avatarHTML = `<div class="message-avatar">${avatar}</div>`;
        }
    }

    // تعیین نوع تیک بر اساس وضعیت
    let checkmarksHTML = '';
    if (isOwn) {
        if (isRead) {
            // دو تیک خاکستری - خوانده شده (سین خورده)
            checkmarksHTML = '<span class="message-checkmarks read">✓✓</span>';
        } else {
            // یک تیک خاکستری - ارسال شده و به سرور رسیده
            checkmarksHTML = '<span class="message-checkmarks sent">✓</span>';
        }
    }

    // ساخت HTML برای پیام ریپلای شده
    let replyHTML = '';
    if (replyTo) {
        if (DEBUG) console.log('Creating reply HTML for:', replyTo);

        // استخراج متن یا نام فایل از replyTo
        let replyText = 'پیام';
        let isFile = false;

        if (replyTo.text) {
            // اگر متن داره، از اون استفاده کن
            replyText = replyTo.text;

            // اگر متن شامل [FILE:...] باشه، نام فایل رو استخراج کن
            if (replyText.startsWith('[FILE:')) {
                isFile = true;
                try {
                    const startIndex = replyText.indexOf('{');
                    const endIndex = replyText.lastIndexOf('}');
                    if (startIndex !== -1 && endIndex !== -1) {
                        const fileJson = replyText.substring(startIndex, endIndex + 1);
                        const fileInfo = JSON.parse(fileJson);
                        replyText = fileInfo.fileName || 'فایل';
                    } else {
                        replyText = 'فایل';
                    }
                } catch (e) {
                    console.error('Error parsing file info from replyTo:', e);
                    replyText = 'فایل';
                }
            } else {
                // محدود کردن طول متن
                if (replyText.length > 50) {
                    replyText = replyText.substring(0, 50) + '...';
                }
            }
        } else if (replyTo.fileName) {
            // اگر نام فایل داره
            isFile = true;
            replyText = replyTo.fileName;
        }

        const replySender = replyTo.username || 'کاربر';

        // Escape کردن HTML برای جلوگیری از مشکلات امنیتی
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };

        if (DEBUG) console.log('Reply text:', replyText, 'Reply sender:', replySender, 'Is file:', isFile);

        const fileIcon = isFile ? '📎 ' : '';

        replyHTML = `
            <div class="replied-message" data-reply-to-id="${replyTo.messageId || ''}">
                <div class="replied-message-sender">${escapeHtml(replySender)}</div>
                <div class="replied-message-text">${fileIcon}${escapeHtml(replyText)}</div>
            </div>
        `;
    }

    // ساخت محتوای پیام
    let messageContent;
    if (fileData) {
        // پیام فایل - استفاده از تابع کمکی در media-handler.js
        messageContent = createFileMessageHTML(fileData);
    } else {
        // پیام متنی
        const linkedText = linkifyUserIds(text);
        // تبدیل line breaks به <br> برای نمایش صحیح
        const formattedText = linkedText.replace(/\n/g, '<br>');
        messageContent = `<div class="message-text">${formattedText}</div>`;
    }

    messageDiv.innerHTML = `
        <div class="message-click-area"></div>
        ${!isOwn ? avatarHTML : ''}
        <div class="message-content">
            ${!isOwn ? `<div class="message-sender" data-username="${user}">${displayName}</div>` : ''}
            <div class="message-bubble">
                ${replyHTML}
                ${messageContent}
            </div>
            <div class="message-time">
                ${time}
                ${checkmarksHTML}
            </div>
        </div>
        ${isOwn ? avatarHTML : ''}
        <div class="reply-indicator">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
            </svg>
        </div>
    `;
    // رندر ایموجی‌ها در نام فرستنده (برای کانال‌ها که از \`currentGroupSettings.group_name\` استفاده می‌کنند)
    const messageSenderEl = messageDiv.querySelector('.message-sender');
    if (messageSenderEl) {
        try {
            if (typeof parseEmojis !== 'undefined') parseEmojis(messageSenderEl);
        } catch (err) {
            console.error('parseEmojis on message-sender failed', err);
        }
    }

    // تبدیل ایموجی‌ها به تصویر Noto (Android)
    if (typeof twemoji !== 'undefined') {
        const messageText = messageDiv.querySelector('.message-text');
        if (messageText) {
            parseEmojis(messageText);
        }
    }

    // هم برای متن پیام ریپلای شده، از پک ایموجی برنامه استفاده کن
    const repliedText = messageDiv.querySelector('.replied-message-text');
    if (repliedText) {
        parseEmojis(repliedText);
    }

    // همچنین نام فرستنده پیام ریپلای شده را با پک ایموجی رندر کن
    const repliedSender = messageDiv.querySelector('.replied-message-sender');
    if (repliedSender) {
        try {
            if (typeof parseEmojis !== 'undefined') parseEmojis(repliedSender);
        } catch (err) {
            console.error('parseEmojis on replied-message-sender failed', err);
        }
    }

    // اضافه کردن event listener برای دانلود فایل
    if (fileData) {
        const fileMessage = messageDiv.querySelector('.file-message');
        if (fileMessage) {
            // only trigger download when the download icon itself is clicked
            const downloadIcon = fileMessage.querySelector('.file-download-icon');
            if (downloadIcon) {
                downloadIcon.style.cursor = 'pointer';
                downloadIcon.addEventListener('click', (e) => {
                    e.stopPropagation(); // don't let the container click handler fire
                    downloadFile(fileData.fileData, fileData.fileName);
                });
            }
        }
    }

    // اضافه کردن event listener برای کلیک روی نام کاربری (فقط در گروه‌ها، نه در کانال)
    if (!isOwn && !isChannel && (currentChat === 'global' || currentChat.startsWith('group_'))) {
        const senderElement = messageDiv.querySelector('.message-sender');
        if (senderElement) {
            try {
                if (typeof parseEmojis !== 'undefined') parseEmojis(senderElement);
            } catch (err) {
                console.error('parseEmojis on senderElement failed', err);
            }
            senderElement.style.cursor = 'pointer';
            // prevent clicks/touches from bubbling to the message container
            senderElement.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const username = senderElement.dataset.username;
                if (username) {
                    showUserInfo(username);
                }
            });
            senderElement.addEventListener('touchstart', (e) => { e.stopPropagation(); });
            senderElement.addEventListener('touchend', (e) => { e.stopPropagation(); e.preventDefault(); const username = senderElement.dataset.username; if (username) showUserInfo(username); });
        }
    }

    // اضافه کردن event listener برای کلیک روی آیدی‌ها
    const useridLinks = messageDiv.querySelectorAll('.userid-link');
    useridLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            const userid = link.dataset.userid;
            if (userid) {
                handleUserIdClick(userid);
            }
        });
    });

    // اضافه کردن event listener برای کلیک روی پیام ریپلای شده
    const repliedMessage = messageDiv.querySelector('.replied-message');
    if (repliedMessage) {
        repliedMessage.addEventListener('click', () => {
            const replyToId = repliedMessage.dataset.replyToId;
            if (replyToId) {
                scrollToMessage(replyToId);
            }
        });
    }

    // add event listeners on the avatar itself to stop propagation
    const avatarEl = messageDiv.querySelector('.message-avatar');
    if (avatarEl) {
        avatarEl.addEventListener('click', (e) => {
            e.stopPropagation();
            showAvatarPreview(avatarEl);
        });
        avatarEl.addEventListener('touchstart', (e) => e.stopPropagation());
        avatarEl.addEventListener('touchend', (e) => { e.stopPropagation(); e.preventDefault(); showAvatarPreview(avatarEl); });
    }

    // lazy-fetch profile picture if missing to avoid blank avatars
    (async () => {
        if (!profilePicture && !isOwn && typeof fetch === 'function') {
            try {
                const res = await fetch(`/api/search-user?query=${encodeURIComponent(user)}`);
                if (!res.ok) return;
                const data = await res.json();
                if (data && data.user && data.user.profile_picture) {
                    usersProfilePictureMap.set(user, data.user.profile_picture);
                    const av = messageDiv.querySelector('.message-avatar');
                    if (av) {
                        // replace content with async-decoded <img>
                        av.innerHTML = `<img class="message-avatar-img" src="${data.user.profile_picture}" loading="lazy" decoding="async" alt="">`;
                        av.style.backgroundImage = 'none';
                        av.textContent = '';
                    }
                }
            } catch (err) {
                // ignore fetch errors silently
            }
        }
    })();

    // اضافه کردن swipe handlers برای ریپلای
    setupSwipeToReply(messageDiv, user, text, messageId, fileData);

    // اضافه کردن context menu برای پیام‌ها
    setupMessageContextMenu(messageDiv, user, text, isOwn);

    // اضافه کردن ریکشن‌ها اگر وجود داشته باشند
    if (reactions && reactions.length > 0) {
        const messageBubble = messageDiv.querySelector('.message-bubble');
        if (messageBubble) {
            renderReactions(messageBubble, reactions, messageId);
        }
    }

    return messageDiv;
}

// راه‌اندازی Context Menu برای پیام‌ها

// helper used by both mobile double-tap and desktop double-click
let lastReactionTime = 0;
function addReactionAnimation(messageDiv, messageId, emoji) {
    // if user is in selection mode we should not add reactions at all
    if (isSelectionMode) return;

    // جلوگیری از اجرای دوباره در کمتر از 500ms (debounce)
    const now = Date.now();
    if (now - lastReactionTime < 500) {
        return;
    }
    lastReactionTime = now;

    if (typeof toggleReaction === 'function') {
        toggleReaction(messageDiv, messageId, emoji);
    }

    // animation identical to previous code
    const reactionHeart = document.createElement('div');
    reactionHeart.innerHTML = emoji;
    reactionHeart.style.position = 'absolute';
    reactionHeart.style.top = '50%';
    reactionHeart.style.left = '50%';
    reactionHeart.style.transform = 'translate(-50%, -50%)';
    reactionHeart.style.fontSize = '80px';
    reactionHeart.style.opacity = '0.8';
    reactionHeart.style.zIndex = '100';
    reactionHeart.style.pointerEvents = 'none';
    reactionHeart.style.textShadow = '0 4px 20px rgba(0,0,0,0.5)';
    reactionHeart.classList.add('reaction-animate');
    messageDiv.appendChild(reactionHeart);

    setTimeout(() => {
        reactionHeart.remove();
    }, 500);
}

function setupMessageContextMenu(messageDiv, user, text, isOwn) {
    const contextMenu = document.getElementById('message-context-menu');
    let longPressTimer = null;

    // اگر context menu وجود نداره، return کن
    if (!contextMenu) {
        console.warn('Context menu not found, skipping setup');
        return;
    }

    // تعیین اینکه آیا باید دکمه حذف نمایش داده شود
    const shouldShowDelete = () => {
        // اگر پیام خودمون باشه، همیشه می‌تونیم حذف کنیم
        if (isOwn) {
            return true;
        }

        // بررسی ادمین بودن
        if (currentChat === 'global') {
            // برای گروه عمومی، از currentUser.isGlobalAdmin استفاده می‌کنیم
            return currentUser && currentUser.isGlobalAdmin === true;
        } else if (currentChat.startsWith('group_') || currentChat.startsWith('channel_')) {
            // برای گروه‌های سفارشی، از currentGroupSettings استفاده می‌کنیم
            const isAdmin = currentGroupSettings && currentGroupSettings.is_admin;
            return isAdmin;
        }

        // در PV، فقط پیام‌های خودمون رو می‌تونیم حذف کنیم
        return false;
    };

    // تابع برای نمایش context menu
    const showContextMenu = async (x, y) => {
        // بررسی اینکه contextMenu وجود داره
        if (!contextMenu) {
            console.error('Context menu element not found');
            return;
        }

        // Set کردن flag برای جلوگیری از بسته شدن فوری
        if (window.setContextMenuOpening) {
            window.setContextMenuOpening();
        }

        // نمایش/مخفی کردن دکمه حذف
        const deleteBtn = document.getElementById('context-menu-delete-message');
        if (shouldShowDelete()) {
            if (deleteBtn) deleteBtn.style.display = 'flex';
        } else {
            if (deleteBtn) deleteBtn.style.display = 'none';
        }

        // نمایش/مخفی کردن دکمه ویرایش (فقط برای پیام‌های خودمان)
        const editBtn = document.getElementById('context-menu-edit');
        if (editBtn) {
            // فقط برای پیام‌های متنی خودمان
            const hasText = text && text.trim() !== '';
            const isTextMessage = !messageDiv.querySelector('.file-message');
            if (isOwn && hasText && isTextMessage) {
                editBtn.style.display = 'flex';
            } else {
                editBtn.style.display = 'none';
            }
        }

        // نمایش دکمه دانلود برای تمامی پیام‌های دارای فایل
        const downloadBtn = document.getElementById('context-menu-download');
        if (downloadBtn) {
            const fileMessage = messageDiv.querySelector('.file-message');
            if (fileMessage) {
                // ذخیره fileId و fileName برای استفاده در هندلر
                const fileId = fileMessage.dataset.fileId;
                const fileName = fileMessage.querySelector('.file-name')?.textContent || 'file';

                // همیشه دکمه را نمایش بده (اگر در کش بود از کش می‌خواند، در غیر اینصورت دانلود می‌کند)
                downloadBtn.style.display = 'flex';

                if (fileId) {
                    contextMenu.dataset.fileId = fileId;
                    contextMenu.dataset.fileName = fileName;
                }
            } else {
                downloadBtn.style.display = 'none';
                contextMenu.removeAttribute('data-file-id');
                contextMenu.removeAttribute('data-file-name');
            }
        }

        // تنظیم متغیر برای جلوگیری از بسته شدن فوری منو
        if (typeof window.setContextMenuOpening === 'function') {
            window.setContextMenuOpening();
        }

        // نمایش منو در موقعیت مناسب
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.style.display = 'block';

        // بررسی اینکه منو از صفحه خارج نشه
        requestAnimationFrame(() => {
            const rect = contextMenu.getBoundingClientRect();

            // در موبایل (صفحه نمایش کوچک)، بهتر است منو در مرکز افقی قرار گیرد
            if (window.innerWidth <= 768) {
                // اگر از سمت راست بیرون میزند
                if (rect.right > window.innerWidth) {
                    contextMenu.style.left = Math.max(10, window.innerWidth - rect.width - 10) + 'px';
                }
                // اگر از سمت چپ بیرون میزند
                if (rect.left < 0) {
                    contextMenu.style.left = '10px';
                }
            } else {
                // دسکتاپ
                if (rect.right > window.innerWidth) {
                    contextMenu.style.left = (x - rect.width) + 'px';
                }
            }

            if (rect.bottom > window.innerHeight) {
                contextMenu.style.top = (y - rect.height) + 'px';
            }
        });

        // ذخیره اطلاعات پیام برای استفاده در event handler
        // همیشه متن رو از DOM بخون تا متن ویرایش شده رو هم بگیره
        const fileMessage = messageDiv.querySelector('.file-message');
        let messageText = '';

        if (fileMessage && fileMessage.dataset.fileName) {
            // برای پیام‌های فایل، نام فایل رو استخراج کن
            messageText = fileMessage.dataset.fileName;
        } else {
            // برای پیام‌های متنی، متن رو از DOM بخون (نه از parameter)
            const messageTextElement = messageDiv.querySelector('.message-text');
            if (messageTextElement) {
                // حذف لینک‌های userid و گرفتن متن خالص
                messageText = messageTextElement.textContent.trim();
            }
        }

        contextMenu.dataset.messageText = messageText;
        contextMenu.dataset.messageId = messageDiv.dataset.messageId;
        contextMenu.dataset.messageUser = user;
        contextMenu.dataset.isOwn = isOwn;

        // Render any emoji images (e.g., custom Iran flag) inside quick reactions
        try {
            const quickContainer = contextMenu.querySelector('.quick-reactions');
            if (quickContainer) {
                if (typeof parseEmojis !== 'undefined') {
                    parseEmojis(quickContainer);
                }
            }
        } catch (err) {
            console.error('parseEmojis on quick-reactions failed', err);
        }
    };

    // کلیک راست (دسکتاپ) / contextmenu event
    messageDiv.addEventListener('contextmenu', (e) => {
        // اگر در حالت انتخاب یا پس از لمس طولانی در حال انتظار هستیم، منو باز نشود
        if (isLongPress || isSelectionMode || longPressPending) {
            e.preventDefault();
            return;
        }

        e.preventDefault();
        showContextMenu(e.pageX, e.pageY);
    });

    // متغیرها برای مدیریت کلیک/لمس
    let clickTimer = null;
    let clickCount = 0;

    // متغیرها برای تشخیص اسکرول هنگام لمس
    let touchStartX = 0;
    let touchStartY = 0;
    let isScrolling = false;

    // شروع لمس (موبایل)
    let isLongPress = false;
    let longPressPending = false; // true بین شروع تا تایم‌اوت لمس طولانی

    messageDiv.addEventListener('touchstart', (e) => {
        // اگر روی آواتار کلیک شده، فقط آواتار باز بشه و منو نیاد
        if (e.target.closest('.message-avatar')) {
            clearTimeout(longPressTimer);
            longPressPending = false;
            return;
        }
        
        // اگر روی دکمه‌های کنترلی رسانه، دانلود، یا سایر المان‌های تعاملی کلیک شده، کاری با لانگ پرس و منو نداریم
        // **توجه:** دیگر نادیده‌گیری container ریکشن انجام نمی‌شود تا بتوان با لمس روی نوار ریکشن، پیام را انتخاب یا منو را باز کرد.
        if (e.target.closest('.audio-play-btn, .download-center-btn, .file-download-icon, .video-overlay, .message-reaction, .reaction-item, a, button')) {
            // اگر روی ریکشن است، تایمر long press پیام رو لغو کن
            clearTimeout(longPressTimer);
            longPressPending = false;
            return;
        }

        if (e.touches.length > 0) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isScrolling = false;
            isLongPress = false;
            longPressPending = true;

            // هندلر برای لمس طولانی (Long Press)
            longPressTimer = setTimeout(() => {
                longPressPending = false;
                // اگر کاربر در حال اسکرول نباشد، حالت انتخاب را فعال کن
                if (!isScrolling) {
                    isLongPress = true;
                    if (navigator.vibrate) {
                        navigator.vibrate(50); // لرزش کوتاه برای بازخورد
                    }
                    // فعال کردن حالت انتخاب و انتخاب همین پیام
                    enableSelectionMode();
                    const messageId = messageDiv.dataset.messageId;
                    if (messageId) {
                        toggleMessageSelection(messageId);
                    }
                }
            }, 600); // 600 میلی‌ثانیه برای تشخیص لمس طولانی
        }
    }, { passive: true });

    // حرکت در زمان لمس (تشخیص اسکرول)
    messageDiv.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            const touchEndX = e.touches[0].clientX;
            const touchEndY = e.touches[0].clientY;

            // اگر کاربر بیش از 10 پیکسل جابجا شد، یعنی در حال اسکرول است
            if (Math.abs(touchEndX - touchStartX) > 10 || Math.abs(touchEndY - touchStartY) > 10) {
                isScrolling = true;
                longPressPending = false;
                clearTimeout(longPressTimer); // لغو تایمر لمس طولانی
            }
        }
    }, { passive: true });

    // لمس (موبایل)
    messageDiv.addEventListener('touchend', (e) => {
        // لغو تایمر لمس طولانی
        clearTimeout(longPressTimer);
        longPressPending = false;

        // اول از همه: جلوگیری از تداخل با کلیک روی المان‌های تعاملی
        // این چک باید قبل از هر چیز دیگری انجام شود
        if (e.target.closest('.message-avatar') ||
            e.target.closest('.message-checkmarks') ||
            e.target.closest('.message-sender') ||
            e.target.closest('.replied-message') ||
            e.target.closest('.userid-link') ||
            e.target.closest('.file-download-icon') ||
            e.target.closest('.audio-play-btn') ||
            e.target.closest('.download-center-btn') ||
            e.target.closest('.video-overlay') ||
            // container ریکشن دیگر مانع باز شدن منو نخواهد شد – کلیک روی آن عادی محسوب می‌شود
            e.target.closest('.message-reaction') ||
            e.target.closest('.reaction-item') ||
            e.target.tagName === 'A' ||
            e.target.tagName === 'BUTTON') {
            clickCount = 0;
            clearTimeout(clickTimer);
            return;
        }

        // اگر روی عکس یا ویدیو کلیک شده، اجازه بده که single/double tap handle بشه
        // (حذف شد تا رفتار مثل پیام‌های عادی باشه)

        // اگر لمس طولانی رخ داده، از ادامه عملیات (کلیک/دابل کلیک) جلوگیری کن
        if (isLongPress) {
            setTimeout(() => {
                isLongPress = false;
            }, 200);
            e.preventDefault();
            return;
        }

        // اگر کاربر در حال اسکرول بوده، کلیک محسوب نشود
        if (isScrolling) {
            clickCount = 0;
            return;
        }

        // در حالت انتخاب، با تک کلیک پیام را انتخاب/لغو انتخاب کن
        if (isSelectionMode) {
            e.preventDefault();
            const messageId = messageDiv.dataset.messageId;
            if (messageId) {
                toggleMessageSelection(messageId);
            }
            return;
        }

        // جلوگیری از بزرگنمایی با دابل تاپ در موبایل (هنگام استفاده از preventDefault)
        if (e.cancelable && document.activeElement !== e.target && !e.target.closest('input') && !e.target.closest('textarea')) {
            e.preventDefault();
        }

        // اگر منو باز است، اول بستنش کن و از باز شدن منوی جدید جلوگیری کن
        const contextMenu = document.getElementById('message-context-menu');
        if (contextMenu && contextMenu.style.display === 'block') {
            contextMenu.style.display = 'none';
            clickCount = 0;
            clearTimeout(clickTimer);
            return;
        }

        clickCount++;

        if (clickCount === 1) {
            clickTimer = setTimeout(() => {
                // یک بار لمس (Single Tap) -> باز کردن منو
                clickCount = 0;

                // گرفتن مختصات تقریبی مرکز پیام برای باز کردن منو
                const rect = messageDiv.getBoundingClientRect();

                // محاسبه موقعیت منو براساس تاچ کاربر تا منو دقیقاً زیر انگشت باز نشود و صفحه دیده شود
                // ولی کادر را طوری در نظر می‌گیریم که از صفحه خارج نشود
                let x = rect.left + (rect.width / 2); // قراردادن در مرکز افقی پیام به صورت پیش فرض
                let y = rect.top + (rect.height / 2);

                if (window.innerWidth <= 768) {
                    // در موبایل، اگر پیام سمت چپ (others) باشد، منو را کمی متمایل به راست باز می‌کنیم
                    // اگر پیام سمت راست (own) باشد، منو را کمی متمایل به چپ باز می‌کنیم
                    if (isOwn) {
                        x = rect.left - 20; // باز شدن سمت چپ کشیده
                    } else {
                        x = rect.right + 20; // باز شدن سمت راست کشیده
                    }

                    // به منبع نمایش اطمینان می‌دهیم که x حداقل 10 پیکسل از چپ فاصله دارد
                    // و حداکثر به اندازه‌ای است که منو در سمت راست جا شود.
                    // عرض تقریبی منو را 200 در نظر می‌گیریم
                    const menuWidth = 200;
                    if (x < 10) x = 10;
                    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
                } else {
                    // دسکتاپ 
                    x = isOwn ? rect.left - 10 : rect.right + 10;
                }

                showContextMenu(x, y);

                // ارتعاش کوچک برای بازخورد
                if (navigator.vibrate) {
                    navigator.vibrate(20);
                }
            }, 300); // تاخیر برای تشخیص دابل تاپ
        } else if (clickCount === 2) {
            // دو بار لمس سریع (Double Tap) -> ثبت ریاکشن (mobile)
            // اگر در حال اسکرول هستیم یا روی المان‌های تعاملی کلیک شده، ریاکشن نزن
            if (isScrolling || e.target.closest('.audio-play-btn, .download-center-btn, .file-download-icon, .video-overlay, .message-reaction, a, button')) {
                clickCount = 0;
                clearTimeout(clickTimer);
                return;
            }
            clearTimeout(clickTimer);
            clickCount = 0;

            const messageId = messageDiv.dataset.messageId;
            if (messageId && typeof toggleReaction === 'function') {
                addReactionAnimation(messageDiv, messageId, '❤️');
            }
        }
    });

    // کلیک عادی برای باز کردن منو یا انتخاب پیام (دسکتاپ)
    messageDiv.addEventListener('click', (e) => {
        // ignore touch-generated clicks to avoid conflict with mobile handlers
        if ('ontouchstart' in window) {
            return;
        }

        // اگر روی یک المان تعاملی رسانه یا لینک کلیک شده، هیچ‌کاری نکن
        if (e.target.closest('.audio-play-btn, .download-center-btn, .file-download-icon, .video-overlay, .message-reaction, a, button')) {
            return;
        }

        // در حالت انتخاب، رفتار قبلی را داشته باش
        if (isSelectionMode) {
            e.preventDefault();
            e.stopPropagation();
            const messageId = messageDiv.dataset.messageId;
            if (messageId) toggleMessageSelection(messageId);
            return;
        }

        // اگر منو باز است، اول بستنش کن و از باز شدن منوی جدید جلوگیری کن
        const contextMenu = document.getElementById('message-context-menu');
        if (contextMenu && contextMenu.style.display === 'block') {
            contextMenu.style.display = 'none';
            return;
        }

        // اگر چپ کلیک عادی بود (بدون دابل کلیک)
        // نمایش منوی کانتکست مثل موبایل
        const rect = messageDiv.getBoundingClientRect();
        let x = rect.left + rect.width / 2;
        let y = rect.top + rect.height / 2;
        if (window.innerWidth <= 768) {
            // تلفن همراه: کمی جابجایی افقی بر اساس طرف پیام
            if (isOwn) x = rect.left - 20;
            else x = rect.right + 20;
            const menuWidth = 200;
            if (x < 10) x = 10;
            if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
        } else {
            x = isOwn ? rect.left - 10 : rect.right + 10;
        }
        showContextMenu(x, y);
    });

    // دسکتاپ: دوبار کلیک برای ثبت ریاکشن
    messageDiv.addEventListener('dblclick', (e) => {
        // desktop only, ignore touch devices
        if ('ontouchstart' in window) return;
        if (isSelectionMode) return;
        if (e.target.closest('.audio-play-btn, .download-center-btn, .file-download-icon, .video-overlay, .message-reaction, a, button')) {
            return;
        }
        const messageId = messageDiv.dataset.messageId;
        if (messageId) {
            addReactionAnimation(messageDiv, messageId, '❤️');
        }
    });
}

// راه‌اندازی event listener برای دکمه‌های context menu پیام
function initMessageContextMenu() {
    const contextMenu = document.getElementById('message-context-menu');
    const selectBtn = document.getElementById('context-menu-select');
    const replyBtn = document.getElementById('context-menu-reply');
    const editBtn = document.getElementById('context-menu-edit');
    const downloadBtn = document.getElementById('context-menu-download');
    const copyBtn = document.getElementById('context-menu-copy');
    const deleteBtn = document.getElementById('context-menu-delete-message');
    let isOpeningMenu = false;

    if (!contextMenu) return;

    // جلوگیری از propagate شدن event از context menu به document
    contextMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    contextMenu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    // بستن context menu با کلیک در هر جای صفحه
    document.addEventListener('click', (e) => {
        if (isOpeningMenu) {
            isOpeningMenu = false;
            return;
        }
        if (contextMenu && !contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    // بستن context menu با کلیک راست در هر جای صفحه
    document.addEventListener('contextmenu', (e) => {
        if (isOpeningMenu) {
            setTimeout(() => {
                isOpeningMenu = false;
            }, 100);
            return;
        }
        if (contextMenu && !contextMenu.contains(e.target) && !e.target.closest('.message')) {
            hideContextMenu();
        }
    });

    window.setContextMenuOpening = () => {
        isOpeningMenu = true;
        // ریست کردن فلگ با تاخیر کم برای اجازه دادن به کلیک‌های بعدی جهت بستن منو
        setTimeout(() => {
            isOpeningMenu = false;
        }, 100);
    };

    // helper to hide and reset context menu state
    const hideContextMenu = () => {
        if (!contextMenu) return;
        contextMenu.style.display = 'none';
        const wrapper = contextMenu.querySelector('.quick-reactions-wrapper');
        if (wrapper) wrapper.classList.remove('expanded');
        const expandBtnElem = contextMenu.querySelector('#context-menu-expand-reactions');
        if (expandBtnElem) expandBtnElem.setAttribute('aria-expanded', 'false');
        // reset opening flag so future right-clicks behave normally
        isOpeningMenu = false;
        // پاک کردن داده‌های ذخیره شده قدیمی تا کنسول مشکلی نداشته باشد
        contextMenu.removeAttribute('data-message-id');
        contextMenu.removeAttribute('data-message-text');
        contextMenu.removeAttribute('data-message-user');
        contextMenu.removeAttribute('data-file-id');
        contextMenu.removeAttribute('data-file-name');
        contextMenu.removeAttribute('data-is-own');
    };

    // انتخاب پیام - یک بار setup کن
    if (selectBtn) {
        selectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const messageId = contextMenu.dataset.messageId;

            hideContextMenu();

            if (!messageId) return;

            // فعال کردن حالت انتخاب
            enableSelectionMode();

            // انتخاب یا لغو انتخاب پیام
            toggleMessageSelection(messageId);
        });
    }

    // پاسخ (ریپلای) - یک بار setup کن
    if (replyBtn) {
        replyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const messageId = contextMenu.dataset.messageId;
            const messageText = contextMenu.dataset.messageText;
            const messageUser = contextMenu.dataset.messageUser;

            hideContextMenu();

            if (!messageId) return;

            // فعال کردن ریپلای با نمایش preview
            setReplyTo(messageId, messageUser || 'کاربر', messageText || '');
        });
    }

    // ویرایش پیام - یک بار setup کن
    if (editBtn) {
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const messageId = contextMenu.dataset.messageId;
            const messageText = contextMenu.dataset.messageText;

            hideContextMenu();

            if (!messageId || !messageText) return;

            // فعال کردن حالت ویرایش
            startEditingMessage(messageId, messageText);
        });
    }

    // دانلود فایل - یک بار setup کن
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const fileId = contextMenu.dataset.fileId;
            const fileName = contextMenu.dataset.fileName;

            hideContextMenu();

            if (!fileId) return;

            // فراخوانی تابع دانلود از media-handler.js
            if (typeof downloadFileById === 'function') {
                downloadFileById(fileId, fileName);
            } else {
                console.error('downloadFileById function not found');
                showToast('خطا در دانلود فایل');
            }
        });
    }

    // کپی پیام - یک بار setup کن
    if (copyBtn) {
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const messageText = contextMenu.dataset.messageText;

            if (messageText) {
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(messageText);
                    } else {
                        const textArea = document.createElement('textarea');
                        textArea.value = messageText;
                        textArea.style.position = 'fixed';
                        textArea.style.left = '-999999px';
                        textArea.style.top = '-999999px';
                        document.body.appendChild(textArea);
                        textArea.focus();
                        textArea.select();
                        document.execCommand('copy');
                        textArea.remove();
                    }
                    showToast('متن کپی شد');
                } catch (error) {
                    console.error('Copy error:', error);
                    showToast('خطا در کپی کردن');
                }
            }

            hideContextMenu();
        });
    }

    // Quick Reactions - یک بار setup کن
    const quickReactionBtns = contextMenu.querySelectorAll('.quick-reaction-btn');
    quickReactionBtns.forEach(btn => {
        // حذف event listener های قبلی
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const reaction = newBtn.dataset.reaction;
            const messageId = contextMenu.dataset.messageId;

            hideContextMenu();

            if (!messageId || !reaction) return;

            // پیدا کردن پیام
            const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
            if (!messageDiv) return;

            // اضافه کردن ریکشن برای همه ایموجی‌ها
            toggleReaction(messageDiv, messageId, reaction);
        });
    });

    // Expand/collapse extra reactions
    const expandBtn = contextMenu.querySelector('#context-menu-expand-reactions');
    if (expandBtn) {
        // حذف event listener قبلی برای جلوگیری از اجرای چندباره
        const newExpandBtn = expandBtn.cloneNode(true);
        expandBtn.parentNode.replaceChild(newExpandBtn, expandBtn);

        newExpandBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // جلوگیری از بسته شدن منو

            const wrapper = contextMenu.querySelector('.quick-reactions-wrapper');
            if (!wrapper) return;

            const isExpanded = wrapper.classList.toggle('expanded');
            newExpandBtn.setAttribute('aria-expanded', String(isExpanded));
        });
    }

    // حذف پیام - یک بار setup کن
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const messageId = contextMenu.dataset.messageId;

            hideContextMenu();

            if (!messageId) return;

            const confirmDelete = confirm('آیا مطمئن هستید که می‌خواهید این پیام را حذف کنید؟');
            if (!confirmDelete) return;

            try {
                let chatType = 'global';
                let groupId = null;

                if (currentChat === 'global') {
                    chatType = 'global';
                } else if (currentChat.startsWith('group_') || currentChat.startsWith('channel_')) {
                    chatType = 'custom_group';
                    groupId = currentChat;
                } else {
                    chatType = 'private';
                }

                const response = await fetch('/api/delete-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messageId: parseInt(messageId),
                        userId: currentUser.id,
                        chatType: chatType,
                        groupId: groupId
                    })
                });

                const data = await response.json();

                if (data.success) {
                    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
                    if (messageElement) {
                        messageElement.remove();
                    }
                    showToast('پیام حذف شد');
                } else {
                    showToast(data.error || 'خطا در حذف پیام');
                }
            } catch (error) {
                console.error('Delete message error:', error);
                showToast('خطا در حذف پیام');
            }
        });
    }
}

// متغیرهای ویرایش پیام
let editingMessageId = null;
let originalMessageText = '';

// شروع ویرایش پیام
function startEditingMessage(messageId, messageText) {
    // ذخیره اطلاعات پیام در حال ویرایش
    editingMessageId = messageId;
    originalMessageText = messageText;

    // قرار دادن متن در input
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        messageInput.textContent = messageText;
        messageInput.focus();

        // نمایش نشانگر ویرایش
        messageInput.placeholder = 'در حال ویرایش پیام... (ESC برای لغو)';
        messageInput.style.borderColor = 'var(--accent-color)';

        // تغییر آیکون دکمه ارسال به ویرایش
        const sendBtn = document.getElementById('send-btn');
        if (sendBtn) {
            sendBtn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            `;
        }

        // نمایش دکمه لغو ویرایش
        showCancelEditButton();

        // هایلایت کردن پیام در حال ویرایش
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.style.backgroundColor = 'rgba(82, 136, 193, 0.2)';
            messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// نمایش دکمه لغو ویرایش
function showCancelEditButton() {
    // بررسی اگر دکمه قبلاً وجود داره
    let cancelBtn = document.getElementById('cancel-edit-btn');
    if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancel-edit-btn';
        cancelBtn.className = 'cancel-edit-btn';
        cancelBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        cancelBtn.title = 'لغو ویرایش';
        cancelBtn.addEventListener('click', cancelEditingMessage);

        // اضافه کردن دکمه بالای دکمه ارسال
        const messageInputArea = document.querySelector('.message-input-area');
        const sendBtn = document.getElementById('send-btn');
        if (messageInputArea && sendBtn) {
            messageInputArea.insertBefore(cancelBtn, sendBtn);
        }
    }
    cancelBtn.style.display = 'flex';
}

// مخفی کردن دکمه لغو ویرایش
function hideCancelEditButton() {
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
    }
}

// لغو ویرایش پیام
function cancelEditingMessage() {
    editingMessageId = null;
    originalMessageText = '';

    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        messageInput.textContent = '';
        messageInput.setAttribute('data-placeholder', 'پیام خود را بنویسید...');
        messageInput.style.borderColor = '';
    }

    // بازگرداندن آیکون دکمه ارسال
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M2 21L23 12L2 3V10L17 12L2 14V21Z" fill="currentColor"/>
            </svg>
        `;
    }

    // مخفی کردن دکمه لغو
    hideCancelEditButton();

    // حذف هایلایت از پیام
    const allMessages = document.querySelectorAll('.message');
    allMessages.forEach(msg => {
        msg.style.backgroundColor = '';
    });
}

// توابع مدیریت انتخاب چند پیام

// فعال کردن حالت انتخاب
function enableSelectionMode() {
    if (!isSelectionMode) {
        isSelectionMode = true;
        showSelectionToolbar();
        updateSelectionCount();
        updateSelectionToolbarActions();
    }
}

// غیرفعال کردن حالت انتخاب
function disableSelectionMode() {
    isSelectionMode = false;
    selectedMessages.clear();
    hideSelectionToolbar();
    clearAllSelections();
}

// نمایش نوار ابزار انتخاب
function showSelectionToolbar() {
    const toolbar = document.getElementById('selection-toolbar');
    if (toolbar) {
        toolbar.style.display = 'flex';
    }
}

// مخفی کردن نوار ابزار انتخاب
function hideSelectionToolbar() {
    const toolbar = document.getElementById('selection-toolbar');
    if (toolbar) {
        toolbar.style.display = 'none';
    }
}

// به‌روزرسانی تعداد پیام‌های انتخاب شده
function updateSelectionCount() {
    const countElement = document.getElementById('selected-count');
    if (countElement) {
        countElement.textContent = selectedMessages.size;
    }
}

// به‌روزرسانی شمارنده‌های انتخاب
function updateSelectionCounters() {
    const selectedArray = Array.from(selectedMessages);

    selectedArray.forEach((messageId, index) => {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            let counter = messageElement.querySelector('.selection-counter');
            if (!counter) {
                counter = document.createElement('div');
                counter.className = 'selection-counter';
                messageElement.appendChild(counter);
            }
            counter.textContent = index + 1; // شماره ترتیب از 1 شروع می‌شود
        }
    });
}

// انتخاب یا لغو انتخاب یک پیام
function toggleMessageSelection(messageId) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);

    if (!messageElement) return;

    // اضافه کردن انیمیشن فلش
    messageElement.classList.add('selection-flash');
    setTimeout(() => {
        messageElement.classList.remove('selection-flash');
    }, 600);

    if (selectedMessages.has(messageId)) {
        // لغو انتخاب
        selectedMessages.delete(messageId);
        messageElement.classList.remove('selected');

        // حذف شمارنده انتخاب
        const counter = messageElement.querySelector('.selection-counter');
        if (counter) {
            counter.remove();
        }
    } else {
        // انتخاب
        selectedMessages.add(messageId);
        messageElement.classList.add('selected');

        // اضافه کردن شمارنده انتخاب
        const counter = document.createElement('div');
        counter.className = 'selection-counter';
        counter.textContent = selectedMessages.size;
        messageElement.appendChild(counter);
    }

    updateSelectionCount();

    // به‌روزرسانی شمارنده‌های همه پیام‌های انتخاب شده
    updateSelectionCounters();

    // به‌روزرسانی وضعیت دکمه‌های نوار انتخاب (مثلا نمایش/مخفی کردن حذف)
    updateSelectionToolbarActions();

    // اگر هیچ پیامی انتخاب نشده، حالت انتخاب غیرفعال شود
    if (selectedMessages.size === 0) {
        disableSelectionMode();
    }
}

// بررسی اینکه آیا یک المنت پیام برای کاربر فعلی قابل حذف است
function isMessageDeletable(messageElement) {
    if (!messageElement) return false;
    // اگر پیام متعلق به خودمان باشد
    if (messageElement.classList.contains('own')) return true;

    // اگر در گروه عمومی باشیم و کاربر ادمین سراسری باشد
    if (currentChat === 'global') {
        return currentUser && currentUser.isGlobalAdmin === true;
    }

    // در گروه‌های سفارشی، بررسی دسترسی ادمین گروه
    if (currentChat && (currentChat.startsWith('group_') || currentChat.startsWith('channel_'))) {
        return currentGroupSettings && currentGroupSettings.is_admin;
    }

    // در PV فقط پیام‌های خودمان قابل حذف هستند
    return false;
}

// به‌روزرسانی وضعیت دکمه‌های نوار ابزار انتخاب
function updateSelectionToolbarActions() {
    const toolbar = document.getElementById('selection-toolbar');
    const deleteBtn = document.getElementById('delete-selected-btn');
    const copyBtn = document.getElementById('copy-selected-btn');

    if (!toolbar) return;

    // اگر هیچ پیامی انتخاب نشده، مخفی کن
    if (selectedMessages.size === 0) {
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (copyBtn) copyBtn.style.display = 'none';
        return;
    }

    // نمایش دکمه کپی همیشه وقتی پیامی انتخاب شده
    if (copyBtn) copyBtn.style.display = 'flex';

    // نمایش دکمه حذف فقط اگر همه پیام‌های انتخاب‌شده قابل حذف باشند
    let allDeletable = true;
    for (const id of selectedMessages) {
        const el = document.querySelector(`[data-message-id="${id}"]`);
        if (!isMessageDeletable(el)) {
            allDeletable = false;
            break;
        }
    }

    if (deleteBtn) {
        deleteBtn.style.display = allDeletable ? 'flex' : 'none';
    }
}

// کپی کردن پیام‌های انتخاب شده
async function copySelectedMessages() {
    if (selectedMessages.size === 0) return;

    const texts = [];
    for (const id of selectedMessages) {
        const el = document.querySelector(`[data-message-id="${id}"]`);
        if (!el) continue;

        // اگر پیام فایل است، نام فایل را کپی کن
        const fileMessage = el.querySelector('.file-message');
        if (fileMessage && fileMessage.dataset.fileName) {
            texts.push(fileMessage.dataset.fileName);
            continue;
        }

        const textEl = el.querySelector('.message-text');
        if (textEl) {
            texts.push(textEl.textContent.trim());
        }
    }

    const finalText = texts.join('\n');
    if (!finalText) return;

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(finalText);
        } else {
            const ta = document.createElement('textarea');
            ta.value = finalText;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        showToast('متن کپی شد');
    } catch (err) {
        console.error('Copy selected error:', err);
        showToast('خطا در کپی کردن');
    }
}

// پاک کردن همه انتخاب‌ها
function clearAllSelections() {
    const selectedElements = document.querySelectorAll('.message.selected');
    selectedElements.forEach(element => {
        element.classList.remove('selected');
        // حذف شمارنده‌ها
        const counter = element.querySelector('.selection-counter');
        if (counter) {
            counter.remove();
        }
    });
    selectedMessages.clear();
    updateSelectionCount();
}

// حذف پیام‌های انتخاب شده
async function deleteSelectedMessages() {
    if (selectedMessages.size === 0) return;

    const confirmDelete = confirm(`آیا مطمئن هستید که می‌خواهید ${selectedMessages.size} پیام انتخاب شده را حذف کنید؟`);
    if (!confirmDelete) return;

    try {
        let chatType = 'global';
        let groupId = null;

        if (currentChat === 'global') {
            chatType = 'global';
        } else if (currentChat.startsWith('group_') || currentChat.startsWith('channel_')) {
            chatType = 'custom_group';
            groupId = currentChat;
        } else {
            chatType = 'private';
        }

        // حذف هر پیام به صورت جداگانه
        const deletePromises = Array.from(selectedMessages).map(async (messageId) => {
            const response = await fetch('/api/delete-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messageId: parseInt(messageId),
                    userId: currentUser.id,
                    chatType: chatType,
                    groupId: groupId
                })
            });

            const data = await response.json();
            return { messageId, success: data.success, error: data.error };
        });

        const results = await Promise.all(deletePromises);

        // بررسی نتایج
        const successfulDeletes = results.filter(r => r.success);
        const failedDeletes = results.filter(r => !r.success);

        // حذف پیام‌های موفق از UI
        successfulDeletes.forEach(result => {
            const messageElement = document.querySelector(`[data-message-id="${result.messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
        });

        // به‌روزرسانی انتخاب‌ها
        selectedMessages.clear();
        updateSelectionCount();

        if (failedDeletes.length > 0) {
            showToast(`${successfulDeletes.length} پیام حذف شد، ${failedDeletes.length} پیام با خطا مواجه شد`);
        } else {
            showToast(`${successfulDeletes.length} پیام با موفقیت حذف شد`);
        }

        // اگر همه پیام‌ها حذف شدند، حالت انتخاب غیرفعال شود
        if (selectedMessages.size === 0) {
            disableSelectionMode();
        }

    } catch (error) {
        console.error('Delete selected messages error:', error);
        showToast('خطا در حذف پیام‌ها');
    }
}

// راه‌اندازی event listener برای نوار ابزار انتخاب
function initSelectionToolbar() {
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const copySelectedBtn = document.getElementById('copy-selected-btn');

    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            disableSelectionMode();
        });
    }

    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', () => {
            deleteSelectedMessages();
        });
    }

    if (copySelectedBtn) {
        copySelectedBtn.addEventListener('click', () => {
            copySelectedMessages();
        });
    }

    // غیرفعال کردن حالت انتخاب یا لغو ویرایش با کلید Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (editingMessageId) {
                cancelEditingMessage();
            } else if (isSelectionMode) {
                disableSelectionMode();
            }
        }
    });
}

// تابع کمکی برای نمایش toast notification
function showToast(message) {
    // بررسی اینکه آیا toast قبلی وجود دارد
    let toast = document.getElementById('toast-notification');

    if (!toast) {
        // ساخت toast element
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';

    // مخفی کردن بعد از 2 ثانیه
    setTimeout(() => {
        toast.style.opacity = '0';
    }, 2000);
}

// بارگذاری پیام‌های عمومی از سرور
async function loadGlobalMessages() {
    try {
        const res = await fetch(`/api/messages?userId=${currentUser.id}`);
        const data = await res.json();

        if (data.success && data.messages) {
            data.messages.forEach(msg => {
                const isOwn = msg.username === username;
                const isRead = msg.is_read === 1;
                const reactions = msg.reactions || null;

                // بررسی اینکه آیا پیام سیستمی است
                if (msg.username === 'system') {
                    addSystemMessage(msg.message);
                } else {
                    addMessage(msg.username, msg.message, isOwn, msg.created_at, msg.id, isRead, msg.reply_to, reactions);
                }

                // ذخیره آخرین ID پیام
                if (msg.id > lastGroupMessageId) {
                    lastGroupMessageId = msg.id;
                }
            });

            // آپدیت آخرین پیام در sidebar
            if (data.messages.length > 0) {
                const lastMsg = data.messages[data.messages.length - 1];
                updateGroupLastMessage(lastMsg.message, lastMsg.created_at);
            }

            // علامت‌گذاری به عنوان خوانده شده
            if (lastGroupMessageId > 0) {
                markGroupMessagesAsRead();
            }
        }
    } catch (error) {
        console.error('خطا در بارگذاری پیام‌های عمومی:', error);
    }
}

// بارگذاری پیام‌های عمومی با نمایش پیام‌های جدید
async function loadGlobalMessagesWithUnread() {
    try {
        if (DEBUG) console.log('loadGlobalMessagesWithUnread called');
        // بارگذاری همه پیام‌ها
        const res = await fetch(`/api/messages?userId=${currentUser.id}`);
        const data = await res.json();

        if (DEBUG) console.log('Messages loaded:', data);

        if (data.success && data.messages) {
            // دریافت آخرین پیام خوانده شده از سرور
            const lastReadRes = await fetch(`/api/last-read-message/${currentUser.id}`);
            const lastReadData = await lastReadRes.json();
            const lastReadMessageId = lastReadData.success ? lastReadData.lastReadMessageId : 0;

            // debug log removed

            let hasUnreadMessages = false;

            // بررسی اینکه آیا پیام خوانده نشده وجود داره
            if (lastReadMessageId !== null && data.messages.length > 0) {
                for (let i = 0; i < data.messages.length; i++) {
                    const msg = data.messages[i];
                    if (msg.id > lastReadMessageId) {
                        hasUnreadMessages = true;
                        console.log('Found unread message:', msg.id);
                        break;
                    }
                }
            }

            if (DEBUG) console.log('Has unread messages:', hasUnreadMessages);

            // اضافه کردن پیام‌ها
            data.messages.forEach((msg, index) => {
                const isOwn = msg.username === username;
                const isRead = msg.is_read === 1;
                const reactions = msg.reactions || null;

                // بررسی اینکه آیا پیام قبلاً وجود داره
                const existingMessage = messagesDiv.querySelector(`[data-message-id="${msg.id}"]`);
                if (!existingMessage) {
                    // بررسی اینکه آیا پیام سیستمی است
                    if (msg.username === 'system') {
                        addSystemMessage(msg.message);
                    } else {
                        // استفاده از addMessage که خودش چک میکنه آیا پیام فایل هست یا نه
                        addMessage(msg.username, msg.message, isOwn, msg.created_at, msg.id, isRead, msg.reply_to, reactions);
                    }
                }

                // اگر این آخرین پیام خوانده شده است و پیام خوانده نشده وجود دارد، separator اضافه کن
                if (hasUnreadMessages && lastReadMessageId !== null && msg.id === lastReadMessageId) {
                    console.log('Adding separator after message:', msg.id);
                    // بررسی که separator قبلاً وجود نداره
                    const existingSeparator = messagesDiv.querySelector('.unread-separator');
                    if (!existingSeparator) {
                        const separator = document.createElement('div');
                        separator.className = 'unread-separator';
                        separator.innerHTML = '<span>پیام‌های جدید</span>';
                        messagesDiv.appendChild(separator);
                        console.log('Separator added');
                    }
                }

                // ذخیره آخرین ID پیام
                if (msg.id > lastGroupMessageId) {
                    lastGroupMessageId = msg.id;
                }
            });

            // اسکرول به separator اگر وجود داره
            const separator = messagesDiv.querySelector('.unread-separator');
            if (separator) {
                console.log('Scrolling to separator');
                // تاخیر کوچک برای اطمینان از رندر شدن کامل
                setTimeout(() => {
                    separator.scrollIntoView({ behavior: 'auto', block: 'center' });
                }, 100);
            } else {
                // اگر separator نیست، به آخر اسکرول کن
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            // علامت‌گذاری پیام‌ها به عنوان خوانده شده
            if (lastGroupMessageId > 0) {
                setTimeout(() => {
                    markGroupMessagesAsRead();
                }, 1000);
            }

            // آپدیت آخرین پیام در sidebar
            if (data.messages.length > 0) {
                const lastMsg = data.messages[data.messages.length - 1];
                updateGroupLastMessage(lastMsg.message, lastMsg.created_at);
            }
        }
    } catch (error) {
        console.error('خطا در بارگذاری پیام‌های عمومی:', error);
    }
}

function addPrivateChatToList(targetUser, lastMessage = 'شروع گفتگو', unreadCount = 0, timestamp = null) {
    const chatsList = document.getElementById('chats-list');

    // بررسی اینکه قبلا اضافه نشده باشه
    if (document.querySelector(`[data-chat="${targetUser}"]`)) return;

    const chatItem = document.createElement('div');
    chatItem.className = 'chat-item';
    chatItem.dataset.chat = targetUser;

    // ایجاد آواتار با عکس پروفایل یا حرف اول
    let avatarHTML;
    const profilePicture = usersProfilePictureMap.get(targetUser);

    if (profilePicture) {
        avatarHTML = `<div class="chat-avatar" style="background-image: url("${profilePicture}"); background-size: cover; background-position: center;"></div>`;
    } else {
        const avatar = targetUser.charAt(0).toUpperCase();
        avatarHTML = `<div class="chat-avatar">${avatar}</div>`;
    }

    const unreadBadge = unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : '';

    // محاسبه زمان
    let timeText = 'الان';
    if (timestamp) {
        const date = new Date(timestamp);
        timeText = date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    }

    chatItem.innerHTML = `
        ${avatarHTML}
        <div class="chat-info">
            <div class="chat-name">${targetUser}</div>
            <div class="chat-last-message">${lastMessage.substring(0, 30)}${lastMessage.length > 30 ? '...' : ''}</div>
        </div>
        <div class="chat-meta">
            <div class="chat-time">${timeText}</div>
            ${unreadBadge}
        </div>
    `;

    chatItem.addEventListener('click', () => {
        openPrivateChat(targetUser);
    });

    chatsList.appendChild(chatItem);
    // رندر ایموجی‌ها در نام چت/کاربر با پک برنامه
    try {
        const chatNameEl = chatItem.querySelector('.chat-name');
        if (chatNameEl) {
            if (typeof parseEmojis !== 'undefined') parseEmojis(chatNameEl);
            else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(chatNameEl);
        }
    } catch (err) {
        console.error('parseEmojis on chat list name failed', err);
    }

    // به‌روزرسانی لیست چت‌ها در صفحه خوش‌آمدگویی
    updateWelcomeChats();
}

// اضافه کردن گروه/کانال به سایدبار
function addGroupToSidebar(groupId, groupName, groupType, profilePicture) {
    const chatsList = document.getElementById('chats-list');

    // بررسی اینکه قبلا اضافه نشده باشه
    if (document.querySelector(`[data-chat="${groupId}"]`)) return;

    const chatItem = document.createElement('div');
    chatItem.className = 'chat-item';
    chatItem.dataset.chat = groupId;

    // حذف ایموجی از اول نام اگر وجود داشته باشه
    const cleanName = groupName.replace(/^[🌐👥📢]\s*/, '');

    // ایجاد آواتار
    let avatarHTML;
    if (profilePicture) {
        avatarHTML = `<div class="chat-avatar" style="background-image: url("${profilePicture}"); background-size: cover; background-position: center;"></div>`;
    } else {
        const icon = groupType === 'channel' ? '📢' : '👥';
        avatarHTML = `<div class="chat-avatar">${icon}</div>`;
    }

    const typeIcon = groupType === 'channel' ? '📢' : '👥';
    const typeText = groupType === 'channel' ? 'کانال' : 'گروه';

    chatItem.innerHTML = `
        ${avatarHTML}
        <div class="chat-info">
            <div class="chat-name">${typeIcon} ${cleanName}</div>
            <div class="chat-last-message">${typeText}</div>
        </div>
        <div class="chat-meta">
            <div class="chat-time">الان</div>
        </div>
    `;

    chatItem.addEventListener('click', () => {
        openGroupOrChannel(groupId, cleanName, groupType, profilePicture);
    });

    chatsList.appendChild(chatItem);
    // رندر ایموجی‌ها در نام گروه/کانال با پک برنامه
    try {
        const chatNameEl = chatItem.querySelector('.chat-name');
        if (chatNameEl) {
            if (typeof parseEmojis !== 'undefined') parseEmojis(chatNameEl);
            else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(chatNameEl);
        }
    } catch (err) {
        console.error('parseEmojis on group list name failed', err);
    }

    // به‌روزرسانی لیست چت‌ها در صفحه خوش‌آمدگویی
    updateWelcomeChats();
}

function updateChatLastMessage(targetUser, message, timestamp) {
    const chatItem = document.querySelector(`[data-chat="${targetUser}"]`);
    if (chatItem) {
        const lastMessageDiv = chatItem.querySelector('.chat-last-message');
        if (lastMessageDiv) {
            const truncatedMessage = message.substring(0, 30) + (message.length > 30 ? '...' : '');
            lastMessageDiv.textContent = truncatedMessage;

            // تبدیل ایموجی‌ها به تصویر Noto (Android)
            if (typeof twemoji !== 'undefined') {
                parseEmojis(lastMessageDiv);
            }
        }

        // به‌روزرسانی لیست چت‌ها در صفحه خوش‌آمدگویی
        updateWelcomeChats();
        const timeDiv = chatItem.querySelector('.chat-time');
        if (timeDiv) {
            if (timestamp) {
                const date = new Date(timestamp);
                timeDiv.textContent = date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
            } else {
                const now = new Date();
                timeDiv.textContent = now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
            }
        }

        // اگر چت فعلی نیست، badge را آپدیت کن
        if (currentChat !== targetUser) {
            let badge = chatItem.querySelector('.unread-badge');
            if (badge) {
                const currentCount = parseInt(badge.textContent) || 0;
                badge.textContent = currentCount + 1;
            } else {
                const chatMeta = chatItem.querySelector('.chat-meta');
                if (chatMeta) {
                    badge = document.createElement('div');
                    badge.className = 'unread-badge';
                    badge.textContent = '1';
                    chatMeta.appendChild(badge);
                }
            }
        }

        // انتقال چت به بالای لیست
        const chatsList = document.getElementById('chats-list');
        const globalChat = document.querySelector('[data-chat="global"]');
        if (chatsList && globalChat && chatItem !== globalChat) {
            chatsList.removeChild(chatItem);
            if (globalChat.nextSibling) {
                chatsList.insertBefore(chatItem, globalChat.nextSibling);
            } else {
                chatsList.appendChild(chatItem);
            }
        }
    } else {
        // اگر چت وجود نداره، اضافه کن
        addPrivateChatToList(targetUser, message, currentChat !== targetUser ? 1 : 0);
    }
}

// بارگذاری لیست چت‌های خصوصی از سرور
async function loadPrivateChats() {
    try {
        // بررسی وجود currentUser و id
        if (!currentUser || !currentUser.id) {
            console.log('کاربر لاگین نکرده است یا id موجود نیست');
            // تلاش مجدد بعد از 1 ثانیه
            setTimeout(() => {
                if (currentUser && currentUser.id && !privateChatsLoaded) {
                    loadPrivateChats();
                }
            }, 1000);
            return;
        }

        const res = await fetch(`/api/private-chats/${currentUser.id}`);

        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }

        const data = await res.json();

        if (data.success && data.chats) {
            data.chats.forEach(chat => {
                // اضافه کردن به نقشه userId و profilePicture
                usersIdMap.set(chat.chat_with, chat.chat_with_id);
                if (chat.profile_picture) {
                    usersProfilePictureMap.set(chat.chat_with, chat.profile_picture);
                }

                // اضافه کردن به لیست چت‌ها
                if (!document.querySelector(`[data-chat="${chat.chat_with}"]`)) {
                    addPrivateChatToList(chat.chat_with, chat.last_message || 'شروع گفتگو', chat.unread_count || 0, chat.last_message_time);
                }
            });

            // به‌روزرسانی لیست چت‌ها در صفحه خوش‌آمدگویی
            updateWelcomeChats();
        }
    } catch (error) {
        console.error('خطا در بارگذاری چت‌های خصوصی:', error);
        // در صورت خطا، فقط log می‌کنیم و ادامه می‌دهیم
    }
}

// کلیک روی آیتم‌های چت
document.addEventListener('DOMContentLoaded', () => {
    const chatsList = document.getElementById('chats-list');

    // Event delegation برای همه chat item ها
    if (chatsList) {
        chatsList.addEventListener('click', (e) => {
            // if user clicked the avatar inside sidebar, show a preview as well
            const avatarClicked = e.target.closest('.chat-avatar');
            if (avatarClicked) {
                showAvatarPreview(avatarClicked);
            }

            const chatItem = e.target.closest('.chat-item');
            if (!chatItem) return;

            const chatId = chatItem.dataset.chat;
            const chatType = chatItem.dataset.chatType;

            if (chatId === 'global') {
                switchToGlobalChat();
            } else if (chatType === 'group' || chatType === 'channel') {
                // گروه یا کانال
                // extract the visible text including custom emojis (Iran flag spans)
                // textContent alone would drop the SVG replacement, resulting in the flag
                // disappearing after a page reload.  getTextWithEmoji will return the
                // real character so it survives the regex.
                const nameEl = chatItem.querySelector('.chat-name');
                let chatName = 'گروه';
                if (nameEl) {
                    chatName = getTextWithEmoji(nameEl).replace(/^[📢👥]\s*/, '');
                }
                const avatarDiv = chatItem.querySelector('.chat-avatar');
                const profilePicture = avatarDiv?.style.backgroundImage ?
                    avatarDiv.style.backgroundImage.slice(5, -2) : null;

                openGroupOrChannel(chatId, chatName, chatType, profilePicture);
            } else {
                // چت خصوصی
                openPrivateChat(chatId);
            }
        });
    }

    // Context Menu
    // Attach avatar click handlers to enlarge profiles (header, settings, message avatars)
    // close logic for avatar preview modal
    const closeBtn = document.getElementById('close-avatar-preview');
    const previewModal = document.getElementById('avatar-preview-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (previewModal) previewModal.style.display = 'none';
        });
    }
    if (previewModal) {
        previewModal.addEventListener('click', (e) => {
            if (e.target === previewModal) {
                previewModal.style.display = 'none';
            }
        });
    }
    // close logic for media preview modal
    const closeMediaBtn = document.getElementById('close-media-preview');
    const mediaModal = document.getElementById('media-preview-modal');
    if (closeMediaBtn) {
        closeMediaBtn.addEventListener('click', () => {
            if (mediaModal) mediaModal.style.display = 'none';
            // stop any playing media
            const vid = mediaModal.querySelector('video');
            if (vid) vid.pause();
            const aud = mediaModal.querySelector('audio');
            if (aud) aud.pause();
        });
    }
    if (mediaModal) {
        mediaModal.addEventListener('click', (e) => {
            if (e.target === mediaModal) {
                mediaModal.style.display = 'none';
                const vid = mediaModal.querySelector('video');
                if (vid) vid.pause();
                const aud = mediaModal.querySelector('audio');
                if (aud) aud.pause();
            }
        });
    }

    // close with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (previewModal && previewModal.style.display === 'flex') {
                previewModal.style.display = 'none';
            }
            if (mediaModal && mediaModal.style.display === 'flex') {
                mediaModal.style.display = 'none';
                const vid = mediaModal.querySelector('video');
                if (vid) vid.pause();
                const aud = mediaModal.querySelector('audio');
                if (aud) aud.pause();
            }
        }
    });

    // Header avatar (chat header) – use delegation so updates don't break the listener
    const headerInfo = document.querySelector('.chat-header-info');
    if (headerInfo) {
        headerInfo.addEventListener('click', (e) => {
            const avatar = e.target.closest('.chat-avatar');
            if (!avatar) return;
            e.stopPropagation();
            showAvatarPreview(avatar);
            // no additional info display here; chatHeaderDetails handles navigation
        });
    }

    // Settings/profile avatar
    const profileAvatar = document.getElementById('profile-avatar');
    if (profileAvatar) {
        profileAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            showAvatarPreview(profileAvatar);
        });
    }

    // User info avatar
    const userInfoAvatar = document.getElementById('user-info-avatar');
    if (userInfoAvatar) {
        userInfoAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            showAvatarPreview(userInfoAvatar);
        });
    }

    // Group info avatar inside members modal
    const groupInfoAvatar = document.getElementById('group-info-avatar-display');
    if (groupInfoAvatar) {
        groupInfoAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            showAvatarPreview(groupInfoAvatar);
        });
    }
    // avatar shown in group edit modal (also allow preview)
    const editGroupAvatar = document.getElementById('edit-group-avatar-display');
    if (editGroupAvatar) {
        editGroupAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            showAvatarPreview(editGroupAvatar);
        });
    }

    // Delegate clicks on message avatars to show preview
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
        // متغیر برای track کردن double click/tap روی رسانه
        let mediaClickCount = 0;
        let mediaClickTimer = null;
        let lastMediaElement = null;

        // handler برای click (دسکتاپ) و touchend (موبایل)
        const handleMediaClick = (e, fileMsg, type, data) => {
            // برای فایل‌های صوتی، فقط اجازه پخش در همان جا بده (بدون fullscreen)
            if (!type.startsWith('audio/')) {
                // دوبار کلیک/تاچ برای باز کردن پیش‌نمایش
                if (lastMediaElement !== fileMsg) {
                    // اگر روی رسانه دیگه‌ای کلیک شده، reset کن
                    mediaClickCount = 0;
                    lastMediaElement = fileMsg;
                }

                mediaClickCount++;
                clearTimeout(mediaClickTimer);

                if (mediaClickCount === 2) {
                    // دوبار کلیک/تاچ - باز کردن پیش‌نمایش
                    mediaClickCount = 0;
                    showMediaPreview(data, type);
                    e.preventDefault();
                    e.stopPropagation();
                } else {
                    // یک بار کلیک/تاچ - منتظر کلیک دوم یا timeout
                    mediaClickTimer = setTimeout(() => {
                        mediaClickCount = 0;
                        // یک بار کلیک - هیچ کاری نکن (منو توسط handler پیام باز می‌شه)
                    }, 300);
                }
            }
        };

        messagesContainer.addEventListener('click', (e) => {
            // avatar preview first - but prevent context menu from opening
            const avatar = e.target.closest('.message-avatar');
            if (avatar) {
                e.stopPropagation();
                e.preventDefault();
                // Close context menu if open
                const contextMenu = document.getElementById('message-context-menu');
                if (contextMenu) {
                    contextMenu.style.display = 'none';
                }
                showAvatarPreview(avatar);
                return;
            }

            // اگر روی دکمه دانلود یا المان‌های تعاملی دیگه کلیک شده، هیچ کاری نکن
            if (e.target.closest('.download-center-btn') ||
                e.target.closest('.audio-play-btn') ||
                e.target.closest('.file-download-icon') ||
                e.target.closest('.video-overlay')) {
                return;
            }

            // media preview - فقط با دوبار کلیک
            const previewArea = e.target.closest('.file-preview');
            if (previewArea) {
                const fileMsg = previewArea.closest('.file-message');
                if (fileMsg) {
                    const type = fileMsg.dataset.fileType;
                    const data = decodeURIComponent(fileMsg.dataset.fileData || '');
                    if (type && data) {
                        handleMediaClick(e, fileMsg, type, data);
                        return;
                    }
                }
            }
        });
    }
    setupContextMenu();
    initMessageContextMenu();
    setupMemberContextMenu();

    // Delete Chat Modal
    setupDeleteChatModal();

    // Selection Toolbar
    initSelectionToolbar();

    // Emoji Picker
    initEmojiPicker();
});

// راه‌اندازی Member Context Menu - moved to moderation.js

// راه‌اندازی Context Menu
function setupContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    const contextMenuText = document.getElementById('context-menu-text');
    const contextMenuDelete = document.getElementById('context-menu-delete');
    let currentContextChat = null;
    let longPressTimer = null;

    // بستن context menu با کلیک در هر جای صفحه
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.classList.remove('show');
        }
    });

    // جلوگیری از باز شدن context menu پیش‌فرض مرورگر
    document.addEventListener('contextmenu', (e) => {
        const chatItem = e.target.closest('.chat-item');
        const welcomeChatItem = e.target.closest('.welcome-chat-item');
        if (chatItem || welcomeChatItem) {
            e.preventDefault();
        }
    });

    // تابع برای نمایش context menu
    function showContextMenu(chatItem, x, y) {
        const chatId = chatItem.dataset.chat;
        const chatType = chatItem.dataset.chatType;

        // برای گروه عمومی context menu نمایش داده نمی‌شود
        if (chatId === 'global') {
            return;
        }

        currentContextChat = chatId;

        // ذخیره نوع چت برای استفاده بعدی
        contextMenu.dataset.chatType = chatType || 'private';

        // تنظیم متن بر اساس نوع چت و نمایش یا مخفی کردن دکمه
        contextMenuDelete.style.display = 'flex';

        if (chatType === 'group') {
            contextMenuText.textContent = 'حذف گروه';
        } else if (chatType === 'channel') {
            contextMenuText.textContent = 'حذف کانال';
        } else {
            contextMenuText.textContent = 'حذف گفتگو';
        }

        // نمایش منو در موقعیت مناسب
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.classList.add('show');

        // بررسی اینکه منو از صفحه خارج نشه
        setTimeout(() => {
            const rect = contextMenu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                contextMenu.style.left = (x - rect.width) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
                contextMenu.style.top = (y - rect.height) + 'px';
            }
        }, 0);
    }

    // Event delegation برای چت‌ها
    const chatsList = document.getElementById('chats-list');

    // کلیک راست (دسکتاپ)
    chatsList.addEventListener('contextmenu', (e) => {
        const chatItem = e.target.closest('.chat-item');
        if (chatItem) {
            e.preventDefault();
            showContextMenu(chatItem, e.pageX, e.pageY);
        }
    });

    // نگه داشتن (موبایل)
    chatsList.addEventListener('touchstart', (e) => {
        const chatItem = e.target.closest('.chat-item');
        if (chatItem) {
            longPressTimer = setTimeout(() => {
                const touch = e.touches[0];
                showContextMenu(chatItem, touch.pageX, touch.pageY);
                // ارتعاش کوچک برای بازخورد
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            }, 500); // 500ms برای long press
        }
    });

    chatsList.addEventListener('touchend', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    chatsList.addEventListener('touchmove', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });

    // Event delegation برای welcome-chats-list
    const welcomeChatsList = document.getElementById('welcome-chats-list');

    if (welcomeChatsList) {
        // کلیک راست (دسکتاپ)
        welcomeChatsList.addEventListener('contextmenu', (e) => {
            const welcomeChatItem = e.target.closest('.welcome-chat-item');
            if (welcomeChatItem) {
                e.preventDefault();
                const chatId = welcomeChatItem.dataset.chat;
                // پیدا کردن chat-item اصلی در sidebar
                const originalChatItem = document.querySelector(`.chat-item[data-chat="${chatId}"]`);
                if (originalChatItem) {
                    showContextMenu(originalChatItem, e.pageX, e.pageY);
                }
            }
        });

        // نگه داشتن (موبایل)
        welcomeChatsList.addEventListener('touchstart', (e) => {
            const welcomeChatItem = e.target.closest('.welcome-chat-item');
            if (welcomeChatItem) {
                longPressTimer = setTimeout(() => {
                    const touch = e.touches[0];
                    const chatId = welcomeChatItem.dataset.chat;
                    // پیدا کردن chat-item اصلی در sidebar
                    const originalChatItem = document.querySelector(`.chat-item[data-chat="${chatId}"]`);
                    if (originalChatItem) {
                        showContextMenu(originalChatItem, touch.pageX, touch.pageY);
                    }
                    // ارتعاش کوچک برای بازخورد
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                }, 500); // 500ms برای long press
            }
        });

        welcomeChatsList.addEventListener('touchend', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        });

        welcomeChatsList.addEventListener('touchmove', () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        });
    }

    // کلیک روی دکمه حذف/خروج
    contextMenuDelete.addEventListener('click', async () => {
        contextMenu.classList.remove('show');

        if (!currentContextChat) return;

        const chatType = contextMenu.dataset.chatType;

        if (currentContextChat === 'global') {
            // خروج از گروه عمومی
            const confirm = window.confirm('آیا مطمئن هستید که می‌خواهید از گروه عمومی خارج شوید؟');
            if (confirm) {
                alert('قابلیت خروج از گروه به زودی اضافه می‌شود!');
            }
        } else if (chatType === 'group' || chatType === 'channel') {
            // حذف گروه یا کانال (فقط برای خودش)
            const typeName = chatType === 'channel' ? 'کانال' : 'گروه';
            const confirm = window.confirm(`آیا مطمئن هستید که می‌خواهید این ${typeName} را از لیست خود حذف کنید؟\n\nتوجه: این ${typeName} فقط از لیست شما حذف می‌شود و برای سایر اعضا باقی می‌ماند.`);
            if (confirm) {
                await deleteGroupOrChannel(currentContextChat, chatType);
            }
        } else {
            // نمایش مودال حذف چت خصوصی
            showDeleteChatModal(currentContextChat);
        }

        currentContextChat = null;
    });
}

// نمایش مودال حذف چت
function showDeleteChatModal(targetUsername) {
    const modal = document.getElementById('delete-chat-modal');
    const deleteForBothCheckbox = document.getElementById('delete-for-both');

    // ریست کردن checkbox
    deleteForBothCheckbox.checked = false;

    // ذخیره username برای استفاده در تأیید
    modal.dataset.targetUsername = targetUsername;

    modal.style.display = 'flex';
}

// نمایش مودال خروج از گروه
function showLeaveGroupModal(groupId, groupType, isAdmin) {
    const modal = document.getElementById('leave-group-modal');
    const modalTitle = document.getElementById('leave-group-modal-title');
    const modalText = document.getElementById('leave-group-modal-text');
    const deleteForAllContainer = document.getElementById('delete-for-all-container');
    const deleteForAllCheckbox = document.getElementById('delete-group-for-all');

    // تنظیم عنوان و متن
    const typeName = groupType === 'channel' ? 'کانال' : 'گروه';
    modalTitle.textContent = `خروج از ${typeName}`;
    modalText.textContent = `آیا مطمئن هستید که می‌خواهید از این ${typeName} خارج شوید؟`;

    // نمایش یا مخفی کردن checkbox بر اساس ادمین بودن
    if (isAdmin) {
        deleteForAllContainer.style.display = 'block';
        deleteForAllCheckbox.checked = false;
    } else {
        deleteForAllContainer.style.display = 'none';
    }

    // ذخیره اطلاعات برای استفاده در تأیید
    modal.dataset.groupId = groupId;
    modal.dataset.groupType = groupType;
    modal.dataset.isAdmin = isAdmin;

    modal.style.display = 'flex';
}

// تمام توابع گروه‌ها و کانال‌ها به panels.js منتقل شده‌اند

// حذف چت خصوصی
async function deletePrivateChat(targetUsername, deleteForBoth = false) {
    try {
        const targetUserId = usersIdMap.get(targetUsername);
        if (!targetUserId) {
            alert('خطا در حذف گفتگو');
            return;
        }

        const res = await fetch('/api/delete-private-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                otherUserId: targetUserId,
                deleteForBoth: deleteForBoth
            })
        });

        const data = await res.json();

        if (data.success) {
            // حذف از UI
            const chatItem = document.querySelector(`[data-chat="${targetUsername}"]`);
            if (chatItem) {
                chatItem.remove();
            }

            // حذف از حافظه
            privateChats.delete(targetUsername);

            // اگر چت فعلی همین بود، به گروه برگرد
            if (currentChat === targetUsername) {
                switchToGlobalChat();
            }

            // نمایش پیام موفقیت
            if (deleteForBoth) {
                addSystemMessage('گفتگو برای هر دو طرف حذف شد');
            } else {
                addSystemMessage('گفتگو حذف شد');
            }
        } else {
            alert(data.error || 'خطا در حذف گفتگو');
        }
    } catch (error) {
        console.error('Error deleting chat:', error);
        alert('خطا در حذف گفتگو');
    }
}

// اضافه کردن گروه یا کانال به sidebar
function addGroupOrChannelToSidebar(item, type) {
    const chatsList = document.getElementById('chats-list');

    // بررسی اینکه قبلا اضافه نشده باشه
    if (document.querySelector(`[data-chat="${item.id}"]`)) return;

    const chatItem = document.createElement('div');
    chatItem.className = 'chat-item';
    chatItem.dataset.chat = item.id;
    chatItem.dataset.chatType = type;

    // حذف ایموجی از اول نام اگر وجود داشته باشه
    let cleanName = item.name.replace(/^[🌐👥📢]\s*/, '');

    // ایجاد آواتار
    let avatarHTML;
    if (item.profilePicture) {
        avatarHTML = `<div class="chat-avatar" style="background-image: url("${item.profilePicture}"); background-size: cover; background-position: center;"></div>`;
    } else {
        // if the name itself starts with the Iran flag emoji, prefer showing
        // our custom SVG instead of a character.
        const iranFlag = '🇮🇷';
        if (cleanName.startsWith(iranFlag)) {
            const src = (typeof encryptedAssets !== 'undefined' && encryptedAssets.iranFlag)
                ? 'data:image/svg+xml;base64,' + encryptedAssets.iranFlag
                : null;
            if (src) {
                avatarHTML = `<div class="chat-avatar"><img src="${src}" class="iran-flag" alt="${iranFlag}" loading="lazy" style="width:100%;height:100%;"></div>`;
            } else {
                avatarHTML = `<div class="chat-avatar">${iranFlag}</div>`;
            }
        } else {
            const avatar = cleanName.charAt(0).toUpperCase();
            avatarHTML = `<div class="chat-avatar">${avatar}</div>`;
        }
    }

    const typeIcon = type === 'channel' ? '📢' : '👥';

    chatItem.innerHTML = `
        ${avatarHTML}
        <div class="chat-info">
            <div class="chat-name">${typeIcon} ${cleanName}</div>
            <div class="chat-last-message">شروع گفتگو</div>
        </div>
        <div class="chat-meta">
            <div class="chat-time">الان</div>
        </div>
    `;

    // render any emojis right away (this is called during page load when groups
    // are fetched).  previously we only parsed emojis when a group was created or
    // manually updated, so the custom Iran flag could slip through as plain text
    // after a reload.  parsing also ensures the size rules above apply.
    try {
        const nameEl = chatItem.querySelector('.chat-name');
        if (nameEl) {
            if (typeof parseEmojis !== 'undefined') {
                parseEmojis(nameEl);
            } else if (typeof replaceIranFlag !== 'undefined') {
                replaceIranFlag(nameEl);
            }
        }
    } catch (err) {
        console.error('emoji parse on sidebar item failed', err);
    }

    // اضافه کردن بعد از گروه عمومی
    const globalChat = document.querySelector('[data-chat="global"]');
    if (globalChat && globalChat.nextSibling) {
        chatsList.insertBefore(chatItem, globalChat.nextSibling);
    } else {
        chatsList.appendChild(chatItem);
    }

    // به‌روزرسانی لیست چت‌ها در صفحه خوش‌آمدگویی
    updateWelcomeChats();
}

// مدیریت پیوست فایل - به media-handler.js منتقل شده است


// راه‌اندازی Emoji Picker
function initEmojiPicker() {
    // بررسی اینکه آیا دستگاه اندروید است
    const isAndroid = /Android/i.test(navigator.userAgent);

    const emojiBtn = document.getElementById('emoji-btn');
    const emojiPicker = document.getElementById('emoji-picker');
    const emojiPickerContent = document.getElementById('emoji-picker-content');
    const emojiSearch = document.getElementById('emoji-search');
    const messageInput = document.getElementById('message-input');

    if (!emojiBtn || !emojiPicker || !emojiPickerContent) return;

    // اگر اندروید است، دکمه ایموجی رو مخفی کن
    if (isAndroid) {
        emojiBtn.style.display = 'none';
        return;
    }

    // تأیید دسترسی به twemoji
    let twemojiReady = false;
    const checkTwemoji = setInterval(() => {
        if (typeof twemoji !== 'undefined') {
            twemojiReady = true;
            clearInterval(checkTwemoji);
        }
    }, 100);

    // بارگذاری آخرین ایموجی‌های استفاده شده از localStorage
    let recentEmojis = [];
    try {
        const saved = localStorage.getItem('recentEmojis');
        if (saved) {
            recentEmojis = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Error loading recent emojis:', e);
    }

    // ذخیره ایموجی در لیست اخیر
    function addToRecent(emoji) {
        // حذف ایموجی اگر قبلاً وجود داشته
        recentEmojis = recentEmojis.filter(e => e !== emoji);
        // اضافه کردن به اول لیست
        recentEmojis.unshift(emoji);
        // نگه داشتن فقط 30 ایموجی اخیر
        recentEmojis = recentEmojis.slice(0, 30);
        // ذخیره در localStorage
        try {
            localStorage.setItem('recentEmojis', JSON.stringify(recentEmojis));
        } catch (e) {
            console.error('Error saving recent emojis:', e);
        }
    }

    // ساخت دکمه‌های ایموجی با پردازش خاص برای پرچم ایران
    function createEmojiButton(emoji, category) {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.style.border = 'none';
        btn.style.background = 'none';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = category === 'flags' ? '1.8em' : '1.5em';
        btn.style.padding = '4px';
        btn.style.borderRadius = '4px';
        btn.style.transition = 'background 0.2s';
        btn.style.fontFamily = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        btn.style.fontVariantEmoji = 'emoji';

        // اگر ایران است، پرچم کاستومی رو نمایش بده
        if (emoji === '🇮🇷' && typeof encryptedAssets !== 'undefined' && encryptedAssets.iranFlag) {
            const img = document.createElement('img');
            img.src = 'data:image/svg+xml;base64,' + encryptedAssets.iranFlag;
            img.alt = '🇮🇷';
            img.style.height = '1.8em';
            img.style.width = '1.8em';
            img.style.display = 'inline-block';
            img.style.verticalAlign = 'middle';
            btn.appendChild(img);
        } else {
            btn.textContent = emoji;
        }

        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(100, 100, 100, 0.2)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'none';
        });

        return btn;
    }

    // لیست ایموجی‌ها بر اساس دسته‌بندی
    const emojiCategories = {
        smileys: { name: 'لبخند', icon: '😊' },
        gestures: { name: 'حرکات', icon: '👋' },
        animals: { name: 'حیوانات', icon: '🐶' },
        food: { name: 'غذا', icon: '🍎' },
        travel: { name: 'سفر', icon: '🚗' },
        objects: { name: 'اشیاء', icon: '📱' },
        symbols: { name: 'نماد', icon: '❤️' },
        flags: { name: 'پرچم', icon: '🏁' }
    };

    let currentCategory = 'smileys';

    // نمایش ایموجی‌های یک دسته
    function showEmojis(category) {
        emojiPickerContent.innerHTML = '';
        let categoryEmojis;

        if (category === 'recent' && recentEmojis.length > 0) {
            categoryEmojis = recentEmojis;
        } else {
            categoryEmojis = emojis[category] || emojis.smileys;
        }

        categoryEmojis.forEach(emoji => {
            const emojiBtn = createEmojiButton(emoji, category);

            emojiBtn.addEventListener('click', () => {
                // insert the emoji into the input and immediately re‑process so it
                // becomes an <img> rather than a raw character.  previously we
                // relied on the input event listener, but programmatic appends
                // don't fire that, which is why flags ended up staying as text.
                messageInput.appendChild(document.createTextNode(emoji));
                messageInput.focus();
                // convert any newly‑inserted emoji (especially flags) right away
                if (typeof parseEmojis !== 'undefined') {
                    try {
                        parseEmojis(messageInput);
                    } catch (err) {
                        console.error('parseEmojis after picker insert error:', err);
                    }
                } else if (typeof replaceIranFlag !== 'undefined') {
                    try {
                        replaceIranFlag(messageInput);
                    } catch (err) {
                        console.error('replaceIranFlag after picker insert error:', err);
                    }
                }
                addToRecent(emoji);
                emojiPicker.style.display = 'none';
            });

            emojiPickerContent.appendChild(emojiBtn);

            // Parse emoji immediately using Noto (Android) pack for better rendering
            if (typeof parseEmojis !== 'undefined' && category === 'flags') {
                try {
                    parseEmojis(emojiBtn);
                } catch (err) {
                    console.error('Error parsing flag emoji:', err);
                }
            }
        });

        // Parse all emojis after they're added if parser is available
        if (typeof parseEmojis !== 'undefined') {
            try {
                parseEmojis(emojiPickerContent);
            } catch (err) {
                console.error('Error parsing emoji picker content:', err);
            }
        }

        // جایگزینی پرچم ایران با SVG سفارشی
        if (typeof replaceIranFlag !== 'undefined') {
            try {
                replaceIranFlag(emojiPickerContent);
            } catch (err) {
                console.error('Error replacing Iran flag in emoji picker:', err);
            }
        }
    }

    // جستجوی ایموجی
    if (emojiSearch) {
        emojiSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            emojiPickerContent.innerHTML = '';

            if (!query) {
                showEmojis(currentCategory);
                return;
            }

            // جستجو در تمام دسته‌ها
            Object.keys(emojis).forEach(category => {
                const categoryEmojis = emojis[category];
                const matchedEmojis = categoryEmojis.filter(emoji => {
                    const names = emojiNames[emoji] || '';
                    return names.includes(query);
                });

                if (matchedEmojis.length > 0) {
                    matchedEmojis.forEach(emoji => {
                        const emojiBtn = createEmojiButton(emoji, category);

                        emojiBtn.addEventListener('click', () => {
                            messageInput.appendChild(document.createTextNode(emoji));
                            messageInput.focus();
                            addToRecent(emoji);
                            emojiPicker.style.display = 'none';
                        });

                        emojiPickerContent.appendChild(emojiBtn);
                    });
                }
            });

            // Parse all emojis after they're added if parser is available
            if (typeof parseEmojis !== 'undefined') {
                try {
                    parseEmojis(emojiPickerContent);
                } catch (err) {
                    console.error('Error parsing emoji picker content:', err);
                }
            }
            // make sure any flag emojis use the twemoji svg assets (earlier helper)
            if (typeof ensureFlagEmojiRendering !== 'undefined') {
                try {
                    ensureFlagEmojiRendering();
                } catch (err) {
                    console.error('Error in ensureFlagEmojiRendering (search):', err);
                }
            }

            // جایگزینی پرچم ایران با SVG سفارشی
            if (typeof replaceIranFlag !== 'undefined') {
                try {
                    replaceIranFlag(emojiPickerContent);
                } catch (err) {
                    console.error('Error replacing Iran flag in search:', err);
                }
            }
        });
    }

    // کلیک روی دکمه ایموجی
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (emojiPicker.style.display === 'none' || !emojiPicker.style.display) {
            emojiPicker.style.display = 'flex';
            if (emojiSearch) {
                emojiSearch.value = '';
            }
            showEmojis(currentCategory);

            // نمایش پردازش ایموجی ها بعد کمی تأخیر برای اطمینان از ready بودن DOM
            setTimeout(() => {
                if (typeof parseEmojis !== 'undefined') {
                    try {
                        parseEmojis(emojiPickerContent);
                    } catch (err) {
                        console.error('Error parsing emoji picker on open:', err);
                    }
                }
                // جایگزینی پرچم ایران با SVG سفارشی
                if (typeof replaceIranFlag !== 'undefined') {
                    try {
                        replaceIranFlag(emojiPickerContent);
                    } catch (err) {
                        console.error('Error replacing Iran flag on open:', err);
                    }
                }
            }, 50);
        } else {
            emojiPicker.style.display = 'none';
        }
    });

    // کلیک روی دسته‌بندی‌ها
    const categoryButtons = document.querySelectorAll('.emoji-category');
    categoryButtons.forEach(btn => {
        // تبدیل ایموجی دسته‌بندی به تصاویر Noto (Android) با parseEmojis
        if (typeof parseEmojis !== 'undefined') {
            try {
                parseEmojis(btn);
            } catch (err) {
                console.error('Error parsing category emoji:', err);
            }
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const category = btn.dataset.category;
            currentCategory = category;

            // پاک کردن جستجو
            if (emojiSearch) {
                emojiSearch.value = '';
            }

            // آپدیت active class
            categoryButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // نمایش ایموجی‌های دسته
            showEmojis(category);

            // نمایش پردازش ایموجی ها بعد از تبدیل دسته
            setTimeout(() => {
                if (typeof parseEmojis !== 'undefined') {
                    try {
                        parseEmojis(emojiPickerContent);
                    } catch (err) {
                        console.error('Error parsing emoji picker on category change:', err);
                    }
                }
                // جایگزینی پرچم ایران با SVG سفارشی
                if (typeof replaceIranFlag !== 'undefined') {
                    try {
                        replaceIranFlag(emojiPickerContent);
                    } catch (err) {
                        console.error('Error replacing Iran flag on category change:', err);
                    }
                }
            }, 50);
        });
    });

    // بستن picker با کلیک خارج از آن
    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.style.display = 'none';
        }
    });
}



// توابع Swipe to Reply



function setupSwipeToReply(messageDiv, user, text, messageId, fileData) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isDragging = false;
    let isHorizontalSwipe = false;
    const swipeThreshold = 80; // حداقل فاصله برای فعال شدن ریپلای (پیکسل)

    // Double tap for heart reaction
    let lastTapTime = 0;
    const doubleTapDelay = 300; // milliseconds
    let isDoubleTap = false;

    const handleDoubleTap = (e) => {
        // if the user tapped on an avatar we don't want to trigger reactions
        if (e.target.closest('.message-avatar')) {
            return;
        }
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTapTime;

        if (tapLength < doubleTapDelay && tapLength > 0) {
            // Double tap detected!
            e.preventDefault();
            e.stopPropagation();

            isDoubleTap = true;

            // Clear long press timer to prevent context menu
            if (messageDiv.longPressTimer) {
                clearTimeout(messageDiv.longPressTimer);
                messageDiv.longPressTimer = null;
            }

            // Show heart animation
            showHeartAnimation(messageDiv);

            // Toggle heart reaction
            toggleReaction(messageDiv, messageId, '❤️');

            lastTapTime = 0; // Reset

            // Reset double tap flag after a delay
            setTimeout(() => {
                isDoubleTap = false;
            }, 100);
        } else {
            lastTapTime = currentTime;
        }
    };

    const handleStart = (e) => {
        // Don't start swipe if it's a double tap
        if (isDoubleTap) return;

        // فقط برای کلیک چپ موس یا touch
        if (e.type === 'mousedown' && e.button !== 0) return;

        const touch = e.type.includes('touch') ? e.touches[0] : e;
        startX = touch.clientX;
        startY = touch.clientY;
        currentX = startX;
        isDragging = true;
        isHorizontalSwipe = false;

        console.log('Swipe started at:', startX);
    };

    const handleMove = (e) => {
        if (!isDragging) return;

        const touch = e.type.includes('touch') ? e.touches[0] : e;
        currentX = touch.clientX;
        const currentY = touch.clientY;

        const deltaX = currentX - startX;
        const deltaY = currentY - startY;

        // تشخیص جهت حرکت
        if (!isHorizontalSwipe && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
            // اگر حرکت افقی بیشتر از عمودی باشه
            isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);

            if (!isHorizontalSwipe) {
                // اگر حرکت عمودیه، swipe رو متوقف کن
                isDragging = false;
                return;
            }
        }

        // اگر حرکت افقی تشخیص داده شد
        if (isHorizontalSwipe) {
            // جلوگیری از انتخاب متن و scroll
            e.preventDefault();
            e.stopPropagation();

            // محدود کردن حرکت به چپ (برای RTL)
            const maxSwipe = 100;
            const swipeDistance = Math.max(-maxSwipe, Math.min(0, deltaX));

            messageDiv.style.transform = `translateX(${swipeDistance}px)`;
            messageDiv.style.transition = 'none';

            // debug log removed

            // نمایش آیکون ریپلای وقتی به threshold رسیدیم
            if (Math.abs(swipeDistance) >= swipeThreshold) {
                messageDiv.classList.add('swiping');
            } else {
                messageDiv.classList.remove('swiping');
            }
        }
    };

    const handleEnd = (e) => {
        if (!isDragging) return;

        console.log('Swipe ended, isDragging:', isDragging, 'isHorizontalSwipe:', isHorizontalSwipe);

        const deltaX = currentX - startX;
        console.log('Delta X:', deltaX);

        // اگر به threshold رسیدیم و حرکت افقی بود، ریپلای رو فعال کن
        if (Math.abs(deltaX) >= swipeThreshold && isHorizontalSwipe) {
            // debug log removed
            const messageText = fileData ? fileData.fileName : text;
            setReplyTo(messageId, user, messageText);
        }

        // برگشت به حالت عادی با انیمیشن
        messageDiv.classList.remove('swiping');
        messageDiv.style.transition = 'transform 0.2s ease-out';
        messageDiv.style.transform = '';

        // پاک کردن transition بعد از انیمیشن
        setTimeout(() => {
            messageDiv.style.transition = '';
        }, 200);

        isDragging = false;
        isHorizontalSwipe = false;
    };

    // Touch events
    messageDiv.addEventListener('touchstart', (e) => {
        handleDoubleTap(e);
        handleStart(e);
    }, { passive: true });
    messageDiv.addEventListener('touchmove', handleMove, { passive: false });
    messageDiv.addEventListener('touchend', handleEnd);
    messageDiv.addEventListener('touchcancel', handleEnd);

    // Double tap for desktop (click)
    messageDiv.addEventListener('click', handleDoubleTap);

    // Mouse events (برای دسکتاپ)
    let mouseMoveHandler = null;
    let mouseUpHandler = null;

    messageDiv.addEventListener('mousedown', (e) => {
        handleStart(e);

        // ساخت handlers برای این swipe خاص
        mouseMoveHandler = (moveEvent) => {
            if (isDragging) {
                handleMove(moveEvent);
            }
        };

        mouseUpHandler = (upEvent) => {
            console.log('Mouse up detected');
            if (isDragging) {
                handleEnd(upEvent);
            }
            // حذف event listeners
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
            mouseMoveHandler = null;
            mouseUpHandler = null;
        };

        // اضافه کردن event listeners
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    });

    // جلوگیری از drag & drop پیش‌فرض
    messageDiv.addEventListener('dragstart', (e) => {
        e.preventDefault();
    });

    // جلوگیری از context menu هنگام swipe
    messageDiv.addEventListener('contextmenu', (e) => {
        if (isHorizontalSwipe) {
            e.preventDefault();
        }
    });
}

function setReplyTo(messageId, username, text) {
    replyToMessage = {
        messageId: messageId,
        username: username,
        text: text
    };

    // debug log removed
    showReplyPreview();
}

function showReplyPreview() {
    if (!replyToMessage) {
        console.error('replyToMessage is null');
        return;
    }

    // ذخیره اطلاعات قبل از clear کردن
    const replyData = {
        username: replyToMessage.username || 'کاربر',
        text: replyToMessage.text || 'پیام'
    };

    // حذف preview قبلی اگر وجود داره (بدون null کردن replyToMessage)
    const oldPreview = document.getElementById('reply-preview');
    if (oldPreview) {
        oldPreview.remove();
    }

    const messagesContainer = document.querySelector('.messages-container');
    if (!messagesContainer) {
        console.error('messages-container not found');
        return;
    }

    const replyPreview = document.createElement('div');
    replyPreview.className = 'reply-preview';
    replyPreview.id = 'reply-preview';

    const previewText = (replyData.text && replyData.text.length > 50)
        ? replyData.text.substring(0, 50) + '...'
        : replyData.text;

    replyPreview.innerHTML = `
        <div class="reply-preview-content">
            <div class="reply-preview-sender">${replyData.username}</div>
            <div class="reply-preview-text">${previewText}</div>
        </div>
        <button class="reply-preview-close" id="reply-preview-close-btn">✕</button>
    `;

    // اضافه کردن قبل از message-input-area
    const messageInputArea = document.querySelector('.message-input-area');
    if (!messageInputArea) {
        console.error('message-input-area not found');
        return;
    }

    messagesContainer.parentNode.insertBefore(replyPreview, messageInputArea);

    // اضافه کردن event listener برای دکمه بستن
    const closeBtn = document.getElementById('reply-preview-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearReplyPreview();
        });
    }

    // فوکوس روی input
    if (messageInput) {
        messageInput.focus();
    }

    // از پک ایموجی برنامه برای متن و فرستنده در preview استفاده کن
    try {
        const previewTextEl = replyPreview.querySelector('.reply-preview-text');
        const previewSenderEl = replyPreview.querySelector('.reply-preview-sender');
        if (typeof parseEmojis !== 'undefined') {
            if (previewTextEl) parseEmojis(previewTextEl);
            if (previewSenderEl) parseEmojis(previewSenderEl);
        } else if (typeof replaceIranFlag !== 'undefined') {
            // حداقل جایگزینی پرچم ایران
            if (previewTextEl) replaceIranFlag(previewTextEl);
            if (previewSenderEl) replaceIranFlag(previewSenderEl);
        }
    } catch (err) {
        console.error('parseEmojis on reply preview failed', err);
    }
}

function clearReplyPreview() {
    const replyPreview = document.getElementById('reply-preview');
    if (replyPreview) {
        replyPreview.remove();
    }
    replyToMessage = null;
}

function scrollToMessage(messageId) {
    if (!messageId) return;

    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // افکت highlight تمیزتر: از کلاس CSS با انیمیشن استفاده می‌کنیم
        const HIGHLIGHT_CLASS = 'message-highlight';
        // اگر قبلا کلاس وجود داشته، آن را ریست کن تا انیمیشن دوباره اجرا شود
        messageElement.classList.remove(HIGHLIGHT_CLASS);
        // force reflow to restart animation
        // eslint-disable-next-line no-unused-expressions
        messageElement.offsetWidth;
        messageElement.classList.add(HIGHLIGHT_CLASS);

        // پاک‌سازی کلاس پس از پایان انیمیشن (در صورت پشتیبانی)
        const removeHighlight = () => {
            messageElement.classList.remove(HIGHLIGHT_CLASS);
            messageElement.removeEventListener('animationend', removeHighlight);
            messageElement.removeEventListener('transitionend', removeHighlight);
        };
        messageElement.addEventListener('animationend', removeHighlight);
        messageElement.addEventListener('transitionend', removeHighlight);
    }
}

// دکمه بازگشت سخت افزاری (موبایل و وب)
function performHardwareBack() {
    // 1. انواع Context Menu ها
    const visibleContextMenus = Array.from(document.querySelectorAll('.context-menu, .message-slider')).filter(el => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
    if (visibleContextMenus.length > 0) {
        visibleContextMenus.forEach(el => el.style.display = 'none');
        return true;
    }

    // 2. کادرهای Modal و پاپ‌آپ‌ها
    const modals = Array.from(document.querySelectorAll('.modal, .settings-modal, .members-modal, #files-preview-modal, #media-preview-modal, #new-chat-modal, #create-group-modal, #create-channel-modal, #delete-chat-modal, #leave-group-modal, #upgrade-admin-modal, #banned-users-modal, #admin-database-modal, #database-list-modal')).filter(el =>
        el.id !== 'login-modal' &&
        el.style.display !== 'none' &&
        getComputedStyle(el).display !== 'none');

    if (modals.length > 0) {
        modals.forEach(el => {
            // برای مودال‌های مدالیته، ایونت کلیک تریگر کن یا فقط مخفی کن
            el.style.display = 'none';
        });

        // بستن پلیر صوتی/تصویری تمام صفحه در صورت باز بودن
        const mediaModal = document.getElementById('media-preview-modal');
        if (mediaModal && mediaModal.style.display !== 'none') {
            mediaModal.style.display = 'none';
        }

        // پاک‌سازی فیلد فایل در صورت نیاز
        const fileInput = document.getElementById('file-attachment-input');
        if (fileInput) fileInput.value = '';
        return true;
    }

    // 3. پیکر ایموجی
    const emojiPicker = document.getElementById('emoji-picker');
    if (emojiPicker && emojiPicker.style.display !== 'none' && getComputedStyle(emojiPicker).display !== 'none') {
        emojiPicker.style.display = 'none';
        return true;
    }

    // 4. بازگشت به صفحه خوش‌آمدگویی از داخل چت
    const chatArea = document.querySelector('.chat-area');
    const welcomeScreen = document.getElementById('welcome-screen');
    /*
        previously we relied on `welcomeScreen.style.display === 'none'` which only
        reflects an inline style. the UI hides the welcome screen by toggling the
        `active` CSS class, so the inline style is empty and the condition always
        failed. as a result pressing the hardware back button on a chat would not
        trigger navigation to home and the app would close instead.
        use the computed style to accurately determine visibility (or check the
        presence of the `active` class). */
    if (
        chatArea &&
        welcomeScreen &&
        getComputedStyle(welcomeScreen).display === 'none'
    ) {
        const backBtn = document.getElementById('back-to-home-btn');
        if (backBtn) {
            backBtn.click();
            return true;
        }
    }

    return false;
}

window.addEventListener('popstate', (e) => {
    // اگر مودال لاگین باز باشد، هیستوری را دستکاری نکن
    const loginModal = document.getElementById('login-modal');
    if (loginModal && loginModal.style.display !== 'none') return;

    if (e.state && (e.state.canGoBack || e.state.appInit)) {
        const handled = performHardwareBack();

        // اگر کاری انجام نشد (مثلاً قبلاً در صفحه اصلی بودیم)
        // اجازه بده کاربر با زدن بک بعدی خارج شود (یا هیستوری واقعاً عقب برود)
        if (!handled && e.state.canGoBack) {
            // اختیاری: می‌توانیم اینجا کاری نکنیم تا خود مرورگر عقب برود
        }
    }
});

// Fallback: ensure emoji button toggles picker even if initEmojiPicker failed
document.addEventListener('DOMContentLoaded', () => {
    try {
        const emojiBtn = document.getElementById('emoji-btn');
        const emojiPicker = document.getElementById('emoji-picker');
        if (!emojiBtn || !emojiPicker) return;

        // avoid double-attaching
        if (emojiBtn.dataset._emojiListener) return;

        // ensure button uses explicit type
        try { emojiBtn.type = 'button'; } catch (e) {}

        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const visible = emojiPicker.style.display === 'flex';
            emojiPicker.style.display = visible ? 'none' : 'flex';
        });
        emojiBtn.dataset._emojiListener = '1';
    } catch (err) {
        console.error('Emoji fallback init error:', err);
    }
});
