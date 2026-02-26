// media-handler.js - مدیریت پخش ویدیوها، نمایش تصاویر، و فایل‌های صوتی/اسناد

// تبدیل داده URI به Object URL برای جلوگیری از دانلود خودکار
async function convertDataUriElement(el) {
    if (!el) return;
    // avoid processing more than once
    if (el.dataset.converted) return;

    // determine the source string: element src or first <source> child
    let src = el.src;
    const sourceChild = el.querySelector && el.querySelector('source');
    if ((!src || src === '') && sourceChild) {
        src = sourceChild.src;
    }
    if (!src || !src.startsWith('data:')) return;

    try {
        const res = await fetch(src);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
            if (sourceChild) {
                sourceChild.src = url;
                // reload media element so it picks up new source
                el.load();
            }
        } else {
            el.src = url;
        }
        el.dataset.converted = 'true';
    } catch (err) {
        console.error('convertDataUriElement error', err);
    }
}

// نمایش پیش‌نمایش بزرگ شده برای تصاویر
function showAvatarPreview(avatarEl) {
    const modal = document.getElementById('avatar-preview-modal');
    const preview = modal.querySelector('.avatar-preview-image');
    if (!modal || !preview) return;

    // copy background or text
    // if avatar contains an <img>, use its src (better fidelity)
    const img = avatarEl.querySelector && avatarEl.querySelector('img');
    if (img && img.src) {
        // ensure we display as an <img> inside preview for proper scaling
        preview.style.backgroundImage = 'none';
        preview.textContent = '';
        preview.innerHTML = '';
        const big = document.createElement('img');
        big.src = img.src;
        big.alt = '';
        big.addEventListener('contextmenu', e => e.preventDefault());
        preview.appendChild(big);
    } else {
        const computed = window.getComputedStyle(avatarEl);
        const bg = computed.backgroundImage;
        if (bg && bg !== 'none') {
            preview.style.backgroundImage = bg;
            preview.textContent = '';
            preview.innerHTML = '';
        } else {
            preview.style.backgroundImage = 'none';
            preview.innerHTML = '';
            preview.textContent = avatarEl.textContent || '';
        }
    }
    modal.style.display = 'flex';
}

// نمایش پیش‌نمایش یا پخش رسانه (عکس/ویدیو/صوت)
async function showMediaPreview(src, type) {
    // افزودن وضعیت به تاریخچه برای دکمه برگشت گوشی
    if (!window.historyInitDone) {
        history.pushState({ appInit: true }, '');
        window.historyInitDone = true;
    }
    history.pushState({ canGoBack: true }, '');

    const modal = document.getElementById('media-preview-modal');
    const container = modal.querySelector('.media-preview-content');
    if (!modal || !container) return;
    container.innerHTML = '';

    // convert data URI to object URL to avoid browser treating it as a download link
    let previewSrc = src;
    if (src.startsWith('data:')) {
        try {
            const response = await fetch(src);
            const blob = await response.blob();
            previewSrc = URL.createObjectURL(blob);
        } catch (err) {
            console.error('Failed to convert data uri to blob:', err);
            previewSrc = src; // fallback
        }
    }

    if (type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = previewSrc;
        img.alt = '';
        // prevent context menu to discourage direct save
        img.addEventListener('contextmenu', e => e.preventDefault());
        container.appendChild(img);
    } else if (type.startsWith('video/')) {
        const video = document.createElement('video');
        video.controls = true;
        video.autoplay = true;
        video.src = previewSrc;
        // hide download button if supported
        video.setAttribute('controlsList', 'nodownload');
        video.controlsList = 'nodownload';
        // prevent context menu so user can't save directly
        video.addEventListener('contextmenu', e => e.preventDefault());
        container.appendChild(video);
    } else if (type.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.autoplay = true;
        audio.src = previewSrc;
        container.appendChild(audio);
    }

    modal.style.display = 'flex';
}

// utility used by both inline players and header player
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// header audio player state & helpers
let headerAudio = null;

function showHeaderAudio(audio) {
    const header = document.getElementById('header-audio-player');
    if (!header) return;
    if (headerAudio && headerAudio !== audio) {
        headerAudio.removeEventListener('timeupdate', headerTimeUpdate);
        headerAudio.removeEventListener('ended', hideHeaderAudio);
        headerAudio.removeEventListener('play', updateHeaderIcon);
        headerAudio.removeEventListener('pause', updateHeaderIcon);
    }
    headerAudio = audio;
    header.style.display = 'flex';
    const msgDiv = audio.closest('.file-message');
    let title = '';
    if (msgDiv) {
        const fn = msgDiv.querySelector('.file-name');
        if (fn) title = fn.textContent;
    }
    // store reference to the source message element so header click can jump to it
    header._targetMessage = msgDiv || null;

    // تنظیم عنوان و زمان
    const titleEl = header.querySelector('.header-audio-title');
    const totalTimeEl = header.querySelector('.total-time');
    if (titleEl) titleEl.textContent = title;
    if (totalTimeEl) totalTimeEl.textContent = formatTime(audio.duration || 0);

    updateHeaderIcon();
    audio.addEventListener('loadedmetadata', () => {
        if (totalTimeEl) totalTimeEl.textContent = formatTime(audio.duration);
    });
    audio.addEventListener('timeupdate', headerTimeUpdate);
    audio.addEventListener('ended', hideHeaderAudio);
    audio.addEventListener('play', updateHeaderIcon);
    audio.addEventListener('pause', updateHeaderIcon);
}

function hideHeaderAudio() {
    const header = document.getElementById('header-audio-player');
    if (header) header.style.display = 'none';
    if (headerAudio) {
        headerAudio.removeEventListener('timeupdate', headerTimeUpdate);
        headerAudio.removeEventListener('ended', hideHeaderAudio);
        headerAudio.removeEventListener('play', updateHeaderIcon);
        headerAudio.removeEventListener('pause', updateHeaderIcon);
        headerAudio = null;
    }
}

function updateHeaderIcon() {
    const header = document.getElementById('header-audio-player');
    if (!header || !headerAudio) return;
    if (headerAudio.paused) {
        header.querySelector('.play-icon').style.display = 'block';
        header.querySelector('.pause-icon').style.display = 'none';
    } else {
        header.querySelector('.play-icon').style.display = 'none';
        header.querySelector('.pause-icon').style.display = 'block';
    }
}

function headerTimeUpdate() {
    if (!headerAudio) return;
    const header = document.getElementById('header-audio-player');
    const progressFill = header.querySelector('.audio-progress-fill');
    const progressHandle = header.querySelector('.audio-progress-handle');
    const currentTimeEl = header.querySelector('.current-time');
    const percentage = (headerAudio.currentTime / Math.max(headerAudio.duration, 1)) * 100;
    progressFill.style.width = percentage + '%';
    progressHandle.style.right = percentage + '%';
    currentTimeEl.textContent = formatTime(headerAudio.currentTime);
}

// header controls initialization
document.addEventListener('DOMContentLoaded', () => {
    const header = document.getElementById('header-audio-player');
    if (header) {
        const playBtn = header.querySelector('.audio-play-btn');
        const progressBar = header.querySelector('.audio-progress-bar');
        const closeBtn = header.querySelector('.header-audio-close-btn');

        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!headerAudio) return;
            if (headerAudio.paused) headerAudio.play();
            else headerAudio.pause();
        });

        progressBar.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!headerAudio) return;
            const rect = progressBar.getBoundingClientRect();
            const x = rect.right - e.clientX;
            const percentage = x / rect.width;
            headerAudio.currentTime = percentage * headerAudio.duration;
        });

        // دکمه بستن
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (headerAudio) {
                    headerAudio.pause();
                    headerAudio.currentTime = 0;
                }
                hideHeaderAudio();
            });
        }

        // dragging support for header
        let isDraggingHeader = false;
        progressBar.addEventListener('mousedown', (e) => {
            isDraggingHeader = true;
            e.stopPropagation();
        });
        document.addEventListener('mousemove', (e) => {
            if (isDraggingHeader && headerAudio) {
                const rect = progressBar.getBoundingClientRect();
                let x = rect.right - e.clientX;
                x = Math.max(0, Math.min(x, rect.width));
                const percentage = x / rect.width;
                headerAudio.currentTime = percentage * headerAudio.duration;
            }
        });
        document.addEventListener('mouseup', () => {
            isDraggingHeader = false;
        });
        // touch support
        progressBar.addEventListener('touchstart', (e) => {
            isDraggingHeader = true;
            e.stopPropagation();
        });
        document.addEventListener('touchmove', (e) => {
            if (isDraggingHeader && headerAudio && e.touches.length > 0) {
                const rect = progressBar.getBoundingClientRect();
                let x = rect.right - e.touches[0].clientX;
                x = Math.max(0, Math.min(x, rect.width));
                const percentage = x / rect.width;
                headerAudio.currentTime = percentage * headerAudio.duration;
            }
        });
        document.addEventListener('touchend', () => {
            isDraggingHeader = false;
        });
        // دکمه بستن پیش‌نمایش رسانه
        const closeMediaBtn = document.getElementById('close-media-preview');
        const mediaPreviewModal = document.getElementById('media-preview-modal');
        if (closeMediaBtn && mediaPreviewModal) {
            const closeFn = () => {
                mediaPreviewModal.style.display = 'none';
                const container = mediaPreviewModal.querySelector('.media-preview-content');
                if (container) {
                    // توقف ویدیوها یا صداها هنگام بستن
                    const media = container.querySelectorAll('video, audio');
                    media.forEach(m => {
                        m.pause();
                        m.src = '';
                        m.load();
                    });
                    container.innerHTML = '';
                }
            };
            closeMediaBtn.addEventListener('click', closeFn);
            mediaPreviewModal.addEventListener('click', (e) => {
                if (e.target === mediaPreviewModal) closeFn();
            });
        }

        // دکمه بستن پیش‌نمایش آواتار
        const closeAvatarBtn = document.getElementById('close-avatar-preview');
        const avatarPreviewModal = document.getElementById('avatar-preview-modal');
        if (closeAvatarBtn && avatarPreviewModal) {
            closeAvatarBtn.addEventListener('click', () => {
                avatarPreviewModal.style.display = 'none';
            });
            avatarPreviewModal.addEventListener('click', (e) => {
                if (e.target === avatarPreviewModal) {
                    avatarPreviewModal.style.display = 'none';
                }
            });
        }
    }
});

// تبدیل فایل به Base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

// فرمت کردن حجم فایل
function formatFileSize(bytes) {
    if (bytes === 0) return '0 بایت';
    const k = 1024;
    const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// تشخیص آیکون فایل بر اساس نوع
function getFileIcon(fileType) {
    if (!fileType) return '📄';

    if (fileType.startsWith('image/')) return '🖼️';
    if (fileType.startsWith('video/')) return '🎥';
    if (fileType.startsWith('audio/')) return '🎵';
    if (fileType.includes('pdf')) return '📕';
    if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('7z')) return '📦';
    if (fileType.includes('word') || fileType.includes('document')) return '📝';
    if (fileType.includes('excel') || fileType.includes('spreadsheet')) return '📊';
    if (fileType.includes('powerpoint') || fileType.includes('presentation')) return '📽️';
    if (fileType.includes('text')) return '📃';

    return '📄';
}

// دانلود فایل
function downloadFile(base64Data, fileName) {
    try {
        // ساخت لینک دانلود
        const link = document.createElement('a');
        link.href = base64Data;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('خطا در دانلود فایل:', error);
        alert('خطا در دانلود فایل');
    }
}

// اضافه کردن پیام فایل
function addFileMessage(user, fileData, isOwn, timestamp, messageId, isRead = false, replyTo = null, reactions = null) {
    const messageDiv = createMessageElement(user, '', isOwn, timestamp, messageId, isRead, fileData, replyTo, reactions);

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

    // درج پیام در محل زمانی مناسب
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
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

// نمایش پیش‌نمایش فایل‌های انتخاب شده
function showFilesPreview(event) {
    const files = Array.from(event.target.files);
    if (!files || files.length === 0) return;

    // بررسی حجم فایل‌ها
    const maxSize = 20 * 1024 * 1024;
    const invalidFiles = files.filter(file => file.size > maxSize);

    if (invalidFiles.length > 0) {
        alert(`فایل‌های زیر بیش از 20 مگابایت هستند و حذف می‌شوند:\n${invalidFiles.map(f => f.name).join('\n')}`);
        // حذف فایل‌های نامعتبر
        const validFiles = files.filter(file => file.size <= maxSize);
        if (validFiles.length === 0) {
            event.target.value = '';
            return;
        }
    }

    const filesPreviewModal = document.getElementById('files-preview-modal');
    const filesPreviewList = document.getElementById('files-preview-list');

    // پاک کردن لیست قبلی
    filesPreviewList.innerHTML = '';

    // اضافه کردن فایل‌ها به لیست
    files.forEach((file, index) => {
        if (file.size > maxSize) return; // رد کردن فایل‌های بزرگ

        const fileItem = document.createElement('div');
        const isImage = file.type.startsWith('image/');

        if (isImage) {
            fileItem.className = 'file-preview-item image-preview';

            // خواندن تصویر برای پیش‌نمایش
            const reader = new FileReader();
            reader.onload = (e) => {
                fileItem.innerHTML = `
                    <div class="preview-image">
                        <img src="${e.target.result}" alt="${file.name}">
                    </div>
                    <div class="file-info-row">
                        <div class="file-icon">${getFileIcon(file.type)}</div>
                        <div class="file-info">
                            <div class="file-name">${file.name}</div>
                            <div class="file-size">${formatFileSize(file.size)}</div>
                        </div>
                        <button class="remove-file-btn" data-index="${index}" title="حذف">✕</button>
                    </div>
                `;

                // اضافه کردن event listener برای دکمه حذف
                const removeBtn = fileItem.querySelector('.remove-file-btn');
                removeBtn.addEventListener('click', () => removeFileFromPreview(index, event.target));
            };
            reader.readAsDataURL(file);
        } else {
            fileItem.className = 'file-preview-item';
            fileItem.innerHTML = `
                <div class="file-icon">${getFileIcon(file.type)}</div>
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
                <button class="remove-file-btn" data-index="${index}" title="حذف">✕</button>
            `;

            // اضافه کردن event listener برای دکمه حذف
            const removeBtn = fileItem.querySelector('.remove-file-btn');
            removeBtn.addEventListener('click', () => removeFileFromPreview(index, event.target));
        }

        filesPreviewList.appendChild(fileItem);
    });

    // نمایش مودال
    filesPreviewModal.style.display = 'flex';
}

// حذف فایل از پیش‌نمایش
function removeFileFromPreview(index, inputElement) {
    const dt = new DataTransfer();
    const files = Array.from(inputElement.files);

    // اضافه کردن تمام فایل‌ها به جز فایل حذف شده
    files.forEach((file, i) => {
        if (i !== index) {
            dt.items.add(file);
        }
    });

    // آپدیت input
    inputElement.files = dt.files;

    // اگر فایلی باقی نمانده، مودال را ببند
    if (dt.files.length === 0) {
        const filesPreviewModal = document.getElementById('files-preview-modal');
        filesPreviewModal.style.display = 'none';
        inputElement.value = '';
    } else {
        // به‌روزرسانی پیش‌نمایش
        showFilesPreview({ target: inputElement });
    }
}

// مدیریت پیوست فایل
async function handleFileAttachment(event) {
    const files = event.target.files || [];
    if (files.length === 0) return;

    // بررسی اینکه یک گفتگو انتخاب شده باشد
    if (!currentChat) {
        alert('لطفا ابتدا یک گفتگو را انتخاب کنید');
        event.target.value = '';
        return;
    }

    let successCount = 0;
    let failCount = 0;

    const messagesDiv = document.getElementById('messages');

    // نمایش پیام loading
    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'system-message';
    loadingMessage.textContent = 'در حال ارسال فایل‌ها...';
    messagesDiv.appendChild(loadingMessage);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // ابتدا replyTo را تنظیم کن اگر وجود داشته باشد
    const replyToElement = document.querySelector('.reply-preview');
    let replyToMessage = null;
    if (replyToElement && replyToElement.dataset.messageId) {
        replyToMessage = replyToElement.dataset.messageId;
    }

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // بررسی حجم فایل
            if (file.size > 100 * 1024 * 1024) {
                failCount++;
                console.error(`فایل ${file.name} بیش از 100MB است`);
                continue;
            }

            try {
                const base64File = await fileToBase64(file);

                const fileData = {
                    type: 'file_message',
                    fileName: file.name,
                    fileSize: file.size,
                    fileType: file.type,
                    fileData: base64File,
                    chat: currentChat
                };

                // اضافه کردن replyTo اگر وجود داشته باشد
                if (replyToMessage) {
                    fileData.replyTo = replyToMessage;
                }

                if (currentChat === 'global') {
                    fileData.messageType = 'group';
                } else if (currentChat.startsWith('group_') || currentChat.startsWith('channel_')) {
                    fileData.messageType = 'custom_group';
                    fileData.groupId = currentChat;
                } else {
                    fileData.messageType = 'private';
                    fileData.to = currentChat;
                }

                ws.send(JSON.stringify(fileData));
                successCount++;

                // تاخیر کوچک بین ارسال فایل‌ها برای جلوگیری از فشار به سرور
                if (i < files.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

            } catch (error) {
                console.error(`خطا در ارسال فایل ${file.name}:`, error);
                failCount++;
            }
        }

        // حذف پیام loading
        loadingMessage.remove();

        // نمایش پیام موفقیت
        const successMessage = document.createElement('div');
        successMessage.className = 'system-message';

        if (files.length === 1) {
            if (successCount === 1) {
                successMessage.textContent = `فایل "${files[0].name}" با موفقیت ارسال شد ✓`;
            } else {
                successMessage.style.color = '#ff4444';
                successMessage.textContent = `خطا در ارسال فایل "${files[0].name}" ✗`;
            }
        } else {
            if (failCount === 0) {
                successMessage.textContent = `${successCount} فایل با موفقیت ارسال شد ✓`;
            } else if (successCount === 0) {
                successMessage.style.color = '#ff4444';
                successMessage.textContent = `خطا در ارسال تمام فایل‌ها ✗`;
            } else {
                successMessage.style.color = '#ffa500';
                successMessage.textContent = `${successCount} فایل ارسال شد، ${failCount} فایل با خطا مواجه شد ⚠`;
            }
        }

        messagesDiv.appendChild(successMessage);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        // حذف پیام موفقیت بعد از 3 ثانیه
        setTimeout(() => {
            successMessage.remove();
        }, 3000);

        // پاک کردن reply preview
        clearReplyPreview();

    } catch (error) {
        console.error('خطا در ارسال فایل‌ها:', error);
        loadingMessage.remove();

        const errorMessage = document.createElement('div');
        errorMessage.className = 'system-message';
        errorMessage.style.color = '#ff4444';
        errorMessage.textContent = `خطا در ارسال فایل‌ها: ${error.message}`;
        messagesDiv.appendChild(errorMessage);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        setTimeout(() => {
            errorMessage.remove();
        }, 5000);
    }

    // ریست کردن input
    event.target.value = '';
}

// ایجاد HTML برای نمایش فایل‌ها در پیام (بهینه‌شده با Lazy Loading)
function createFileMessageHTML(fileData) {
    const fileIcon = getFileIcon(fileData.fileType);
    const isImage = fileData.fileType && fileData.fileType.startsWith('image/');
    const isVideo = fileData.fileType && fileData.fileType.startsWith('video/');
    const isAudio = fileData.fileType && fileData.fileType.startsWith('audio/');

    let fileClass = 'file-message';
    if (isImage) fileClass += ' image-file';
    else if (isVideo) fileClass += ' video-file';
    else if (isAudio) fileClass += ' audio-file';

    // ذخیره فقط fileId برای کاهش حجم DOM
    const fileId = fileData.fileId;
    const fileName = fileData.fileName;
    const fileSize = formatFileSize(fileData.fileSize);

    if (isImage) {
        return `
            <div class="${fileClass} lazy-media" data-file-id="${fileId}" data-file-type="${fileData.fileType}" onclick="loadLazyMedia(this, event)">
                <div class="file-preview placeholder image-placeholder">
                    <div class="download-center-btn">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg>
                    </div>
                </div>
                <div class="file-info-row">
                    <div class="file-icon">${fileIcon}</div>
                    <div class="file-info">
                        <div class="file-name">${fileName}</div>
                        <div class="file-size">${fileSize}</div>
                    </div>
                </div>
            </div>
        `;
    } else if (isVideo) {
        return `
            <div class="${fileClass} lazy-media" data-file-id="${fileId}" data-file-type="${fileData.fileType}" onclick="loadLazyMedia(this, event)">
                <div class="file-preview video-preview placeholder video-placeholder">
                    <div class="download-center-btn">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg>
                    </div>
                    <div class="video-overlay">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                    </div>
                </div>
                <div class="file-info-row">
                    <div class="file-icon">${fileIcon}</div>
                    <div class="file-info">
                        <div class="file-name">${fileName}</div>
                        <div class="file-size">${fileSize}</div>
                    </div>
                </div>
            </div>
        `;
    } else if (isAudio) {
        const audioId = 'audio-' + Math.random().toString(36).substr(2, 9);
        return `
            <div class="${fileClass} lazy-media" data-file-id="${fileId}" data-file-type="${fileData.fileType}" data-audio-id="${audioId}" onclick="loadLazyMedia(this, event)">
                <div class="custom-audio-player placeholder audio-placeholder" data-audio-id="${audioId}">
                    <div class="download-center-btn">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg>
                    </div>
                    <div class="lazy-load-text">فایل صوتی (${fileSize})</div>
                </div>
                <div class="file-info-row">
                    <div class="file-icon">${fileIcon}</div>
                    <div class="file-info">
                        <div class="file-name">${fileName}</div>
                        <div class="file-size">${fileSize}</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        return `
            <div class="${fileClass}" onclick="downloadFileById('${fileId}', '${fileName}', event)">
                <div class="file-icon">${fileIcon}</div>
                <div class="file-info">
                    <div class="file-name">${fileName}</div>
                    <div class="file-size">${fileSize}</div>
                </div>
                <div class="file-download-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                </div>
            </div>
        `;
    }
}


// راه‌اندازی پلیر صوتی سفارشی
function initCustomAudioPlayer(playerElement) {
    if (!playerElement || playerElement.dataset.initialized) return;
    playerElement.dataset.initialized = 'true';

    const audioId = playerElement.dataset.audioId;
    const audio = document.getElementById(audioId);
    if (!audio) return;

    const playBtn = playerElement.querySelector('.audio-play-btn');
    const playIcon = playerElement.querySelector('.play-icon');
    const pauseIcon = playerElement.querySelector('.pause-icon');
    const progressBar = playerElement.querySelector('.audio-progress-bar');
    const progressFill = playerElement.querySelector('.audio-progress-fill');
    const progressHandle = playerElement.querySelector('.audio-progress-handle');
    const currentTimeEl = playerElement.querySelector('.current-time');
    const totalTimeEl = playerElement.querySelector('.total-time');

    // block context menu / callout on mobile
    playerElement.addEventListener('contextmenu', ev => {
        ev.preventDefault();
        ev.stopPropagation();
    });
    if (playBtn) {
        playBtn.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            ev.stopPropagation();
        });
    }

    // آپدیت زمان کل
    const updateDuration = () => {
        if (audio.duration && !isNaN(audio.duration)) {
            totalTimeEl.textContent = formatTime(audio.duration);
        }
    };

    if (audio.readyState >= 1) {
        updateDuration();
    }
    audio.addEventListener('loadedmetadata', updateDuration);

    // وقتی صدا شروع می‌شود، پلیر هدر را هم نمایش بده
    audio.addEventListener('play', () => {
        showHeaderAudio(audio);
    });

    // آپدیت پیشرفت
    audio.addEventListener('timeupdate', () => {
        const progress = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = progress + '%';
        // برای RTL: دایره از راست شروع می‌شود
        progressHandle.style.right = progress + '%';
        progressHandle.style.left = 'auto';
        currentTimeEl.textContent = formatTime(audio.currentTime);
    });

    // تابع مشترک برای پخش/توقف
    const togglePlayPause = async (e) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }

        // اگر فایل هنوز بارگذاری نشده، اول بارگذاری کن
        const sourceChild = audio.querySelector('source');
        if ((!audio.src || audio.src === '') && sourceChild && sourceChild.src) {
            audio.src = sourceChild.src;
            audio.load();
        }

        if (audio.paused) {
            try {
                // نمایش loading
                playBtn.disabled = true;
                playIcon.style.display = 'none';
                pauseIcon.style.display = 'none';

                // اضافه کردن اسپینر اگر وجود ندارد
                let spinner = playBtn.querySelector('.audio-loading-spinner');
                if (!spinner) {
                    spinner = document.createElement('div');
                    spinner.className = 'audio-loading-spinner';
                    playBtn.appendChild(spinner);
                } else {
                    spinner.style.display = 'block';
                }

                // توقف تمام صداهای دیگر
                document.querySelectorAll('audio').forEach(a => {
                    if (a !== audio && !a.paused) {
                        a.pause();
                        // آپدیت آیکون پلیر دیگر
                        const otherPlayer = a.closest('.custom-audio-player');
                        if (otherPlayer) {
                            const otherPlayIcon = otherPlayer.querySelector('.play-icon');
                            const otherPauseIcon = otherPlayer.querySelector('.pause-icon');
                            if (otherPlayIcon) otherPlayIcon.style.display = 'block';
                            if (otherPauseIcon) otherPauseIcon.style.display = 'none';
                        }
                    }
                });

                // بارگذاری metadata اگر هنوز بارگذاری نشده
                if (audio.readyState === 0) {
                    await new Promise((resolve, reject) => {
                        const onLoaded = () => {
                            audio.removeEventListener('error', onError);
                            resolve();
                        };
                        const onError = (err) => {
                            audio.removeEventListener('loadedmetadata', onLoaded);
                            reject(err);
                        };
                        audio.addEventListener('loadedmetadata', onLoaded, { once: true });
                        audio.addEventListener('error', onError, { once: true });
                        setTimeout(() => {
                            audio.removeEventListener('loadedmetadata', onLoaded);
                            audio.removeEventListener('error', onError);
                            reject(new Error('Timeout'));
                        }, 10000);
                    });
                }

                await audio.play();

                // بازگردانی آیکون
                let currentSpinner = playBtn.querySelector('.audio-loading-spinner');
                if (currentSpinner) currentSpinner.style.display = 'none';

                playIcon.style.display = 'none';
                pauseIcon.style.display = 'block';
                playBtn.disabled = false;
            } catch (err) {
                console.error('Error playing audio:', err);
                // بازگردانی آیکون در صورت خطا
                let currentSpinner = playBtn.querySelector('.audio-loading-spinner');
                if (currentSpinner) currentSpinner.style.display = 'none';

                playIcon.style.display = 'block';
                pauseIcon.style.display = 'none';
                playBtn.disabled = false;
                alert('خطا در پخش فایل صوتی. لطفا دوباره تلاش کنید.');
            }
        } else {
            audio.pause();
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        }
    };

    // پخش/توقف - هم برای کلیک و هم برای تاچ
    playBtn.addEventListener('click', togglePlayPause);
    playBtn.addEventListener('touchend', (e) => {
        e.stopPropagation();
        e.preventDefault();
        togglePlayPause(e);
    });

    // وقتی صدا تمام شد
    audio.addEventListener('ended', () => {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        progressFill.style.width = '0%';
        progressHandle.style.right = '0%';
        progressHandle.style.left = 'auto';
        currentTimeEl.textContent = '0:00';
    });

    // کلیک روی نوار پیشرفت (RTL - از راست به چپ)
    progressBar.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!audio.duration) return;
        const rect = progressBar.getBoundingClientRect();
        // برای RTL: از راست به چپ محاسبه می‌کنیم
        const x = rect.right - e.clientX;
        const percentage = x / rect.width;
        audio.currentTime = percentage * audio.duration;
    });

    // کشیدن نوار پیشرفت
    let isDragging = false;

    progressBar.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging && audio.duration) {
            const rect = progressBar.getBoundingClientRect();
            // برای RTL: از راست به چپ محاسبه می‌کنیم
            let x = rect.right - e.clientX;
            x = Math.max(0, Math.min(x, rect.width));
            const percentage = x / rect.width;
            audio.currentTime = percentage * audio.duration;
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // پشتیبانی از لمس (موبایل)
    progressBar.addEventListener('touchstart', (e) => {
        isDragging = true;
        e.stopPropagation();
    });

    document.addEventListener('touchmove', (e) => {
        if (isDragging && audio.duration && e.touches.length > 0) {
            const rect = progressBar.getBoundingClientRect();
            // برای RTL: از راست به چپ محاسبه می‌کنیم
            let x = rect.right - e.touches[0].clientX;
            x = Math.max(0, Math.min(x, rect.width));
            const percentage = x / rect.width;
            audio.currentTime = percentage * audio.duration;
        }
    });

    document.addEventListener('touchend', () => {
        isDragging = false;
    });
}

// راه‌اندازی تمام پلیرهای صوتی در صفحه
function initAllAudioPlayers() {
    document.querySelectorAll('.custom-audio-player').forEach(player => {
        // بررسی اینکه قبلاً راه‌اندازی نشده باشد
        if (!player.dataset.initialized) {
            initCustomAudioPlayer(player);
        }
    });
}

// راه‌اندازی پلیرها بعد از لود شدن DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllAudioPlayers);
} else {
    initAllAudioPlayers();
}

// MutationObserver برای راه‌اندازی پلیرهای جدید
const audioObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) { // Element node
                // بررسی خود node
                if (node.classList && node.classList.contains('custom-audio-player')) {
                    if (!node.dataset.initialized) {
                        initCustomAudioPlayer(node);
                        node.dataset.initialized = 'true';
                    }
                }
                // بررسی فرزندان
                const players = node.querySelectorAll && node.querySelectorAll('.custom-audio-player');
                if (players) {
                    players.forEach(player => {
                        initCustomAudioPlayer(player);
                    });
                }
            }
        });
    });
});

// شروع مشاهده تغییرات
audioObserver.observe(document.body, {
    childList: true,
    subtree: true
});
// کش کردن و دریافت رسانه
async function fetchAndCacheMedia(fileId) {
    const cacheName = 'groogp-media-cache';
    const relativeUrl = `/api/files/${fileId}`;
    const url = new URL(relativeUrl, window.location.origin).href;

    try {
        const cache = await caches.open(cacheName);
        let response = await cache.match(url);

        if (!response) {
            console.log('Fetching from server:', fileId);
            response = await fetch(url);
            if (response.ok) {
                await cache.put(url, response.clone());
            }
        } else {
            console.log('Loading from cache:', fileId);
        }

        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (err) {
        console.error('Cache/Fetch error:', err);
        return url; // fallback to direct URL
    }
}

// بررسی اینکه آیا فایل در کش مرورگر موجود است یا خیر
async function isFileInCache(fileId) {
    if (!fileId) return false;

    // فقط اگر کاربر آیکون دانلود را زده باشد (ذخیره در localStorage)، دکمه دانلود مخفی می‌شود.
    // بررسی Cache API حذف شد چون مدیاهایی که لود می‌شوند هم در کش می‌روند اما به معنی دانلود توسط کاربر نیستند.
    if (localStorage.getItem(`downloaded_${fileId}`) === 'true') {
        return true;
    }

    return false;
}

// بارگذاری رسانه Lazy (بهینه‌شده)
async function loadLazyMedia(element, event) {
    // اگر این المان قبلاً لود شده، شاید کاربر روی کنترل‌های داخلی صوتی یا سایر
    // المان‌ها کلیک کند؛ اجازه می‌دهیم آن تعاملات انجام شود. ویدیو را از لیست
    // المان‌های تعاملی خارج می‌کنیم چون برای ویدیو همیشه باید پیش‌نمایش تمام
    // صفحه باز شود، نه اینکه ابزار داخلی فعال گردد.
    if (event && element.classList.contains('loaded')) {
        const interactive = event.target.closest('audio, button, .audio-play-btn, .audio-progress-bar, .audio-progress-handle');
        if (interactive) {
            return;
        }
    }

    // جلوگیری از انتشار event به المان والد (فقط زمانی که می‌خواهیم خودمان مدیریت کنیم)
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    // اگر قبلاً لود شده، نمایش پیشنمایش بزرگ
    if (element.classList.contains('loaded')) {
        const fileType = element.dataset.fileType;
        
        if (fileType.startsWith('image/')) {
            const img = element.querySelector('.file-preview img');
            if (img && img.src) {
                showMediaPreview(img.src, fileType);
            }
        } else if (fileType.startsWith('video/')) {
            const video = element.querySelector('.file-preview video');
            if (video) {
                const source = video.querySelector('source');
                if (source && source.src) {
                    showMediaPreview(source.src, fileType);
                }
            }
        }
        return;
    }
    
    if (element.classList.contains('loading')) return;

    const fileId = element.dataset.fileId;
    const fileType = element.dataset.fileType;

    if (!fileId || !fileType) return;

    element.classList.add('loading');
    const centerBtn = element.querySelector('.download-center-btn');
    if (centerBtn) {
        centerBtn.innerHTML = '<div class="lazy-load-loading"></div>';
        centerBtn.classList.add('is-loading');
    }
    const placeholderText = element.querySelector('.lazy-load-text');
    if (placeholderText) {
        placeholderText.textContent = 'در حال بارگذاری...';
    }

    try {
        const objectUrl = await fetchAndCacheMedia(fileId);
        const fileName = element.querySelector('.file-name')?.textContent || 'file';
        const fileSize = element.querySelector('.file-size')?.textContent || '';

        if (fileType.startsWith('image/')) {
            const preview = element.querySelector('.file-preview');
            preview.classList.remove('placeholder');
            preview.innerHTML = `<img src="${objectUrl}" alt="${fileName}" loading="lazy" decoding="async">`;
            
            // اضافه کردن event handlers برای باز کردن عکس در تمام صفحه
            requestAnimationFrame(() => {
                const img = preview.querySelector('img');
                if (img) {
                    // تابع مشترک برای باز کردن عکس
                    const openImage = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        showMediaPreview(img.src, fileType);
                    };
                    
                    // برای دسکتاپ
                    img.addEventListener('click', openImage);
                    
                    // برای موبایل - استفاده از touchstart به جای touchend
                    let touchStartTime = 0;
                    img.addEventListener('touchstart', (e) => {
                        touchStartTime = Date.now();
                        e.stopPropagation();
                    }, { passive: true });
                    
                    img.addEventListener('touchend', (e) => {
                        const touchDuration = Date.now() - touchStartTime;
                        // فقط اگر تاچ کوتاه بود (کمتر از 500ms) - یعنی tap نه long press
                        if (touchDuration < 500) {
                            e.stopPropagation();
                            e.preventDefault();
                            openImage(e);
                        }
                    });
                    
                    img.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
                    
                    // prevent native context menu on long-press
                    img.addEventListener('contextmenu', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                    });
                }
            });
        } else if (fileType.startsWith('video/')) {
            const preview = element.querySelector('.file-preview');
            preview.classList.remove('placeholder');
            preview.innerHTML = `
                <video preload="metadata" muted playsinline>
                    <source src="${objectUrl}" type="${fileType}">
                </video>
                <div class="video-overlay">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                </div>
            `;
            
            // اضافه کردن event listener برای باز کردن ویدیو در حالت تمام صفحه
            requestAnimationFrame(() => {
                const video = preview.querySelector('video');
                const overlay = preview.querySelector('.video-overlay');
                
                // تابع مشترک برای باز کردن ویدیو
                const openVideo = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const source = video.querySelector('source');
                    if (source && source.src) {
                        showMediaPreview(source.src, fileType);
                    }
                };
                
                if (video) {
                    // prevent long‑press callout and stop propagation so container doesn't intercept
                    video.addEventListener('touchstart', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }, { passive: false });
                    video.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
                    video.addEventListener('contextmenu', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                    });
                }
                
                // کلیک روی overlay برای باز کردن ویدیو - هم دسکتاپ و هم موبایل
                if (overlay) {
                    overlay.addEventListener('click', openVideo);
                    overlay.addEventListener('contextmenu', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                    });
                    
                    // برای موبایل - استفاده از touchstart به جای touchend
                    let touchStartTime = 0;
                    overlay.addEventListener('touchstart', (e) => {
                        touchStartTime = Date.now();
                        e.stopPropagation();
                    }, { passive: true });
                    
                    overlay.addEventListener('touchend', (e) => {
                        const touchDuration = Date.now() - touchStartTime;
                        // فقط اگر تاچ کوتاه بود (کمتر از 500ms)
                        if (touchDuration < 500) {
                            e.stopPropagation();
                            e.preventDefault();
                            openVideo(e);
                        }
                    });
                    
                    overlay.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
                }
            });
        } else if (fileType.startsWith('audio/')) {
            const audioId = element.dataset.audioId || 'audio-' + Math.random().toString(36).substr(2, 9);
            const fileIcon = getFileIcon(fileType);
            element.innerHTML = `
                <div class="custom-audio-player" data-audio-id="${audioId}">
                    <audio id="${audioId}" preload="metadata">
                        <source src="${objectUrl}" type="${fileType}">
                    </audio>
                    <button class="audio-play-btn">
                        <svg class="play-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                        <svg class="pause-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                        </svg>
                    </button>
                    <div class="audio-progress-container">
                        <div class="audio-time current-time">0:00</div>
                        <div class="audio-progress-bar">
                            <div class="audio-progress-fill"></div>
                            <div class="audio-progress-handle"></div>
                        </div>
                        <div class="audio-time total-time">0:00</div>
                    </div>
                </div>
                <div class="file-info-row">
                    <div class="file-icon">${fileIcon}</div>
                    <div class="file-info">
                        <div class="file-name">${fileName}</div>
                        <div class="file-size">${fileSize}</div>
                    </div>
                </div>
            `;
            requestAnimationFrame(() => {
                const player = element.querySelector('.custom-audio-player');
                if (player) {
                    initCustomAudioPlayer(player);
                }
            });
        }

        element.classList.remove('lazy-media', 'loading');
        element.classList.add('loaded');

        // once loaded we no longer want the parent click handler to steal events
        element.onclick = null;
        element.removeAttribute('onclick');

        // ذخیره وضعیت دانلود در localStorage برای نمایش خودکار در مراجعات بعدی
        localStorage.setItem(`downloaded_${fileId}`, 'true');

    } catch (err) {
        console.error('Lazy load error:', err);
        element.classList.remove('loading');
        const preview = element.querySelector('.file-preview');
        if (preview) {
            preview.innerHTML = '<div class="lazy-load-text">خطا در بارگذاری. دوباره کلیک کنید.</div>';
        }
    }
}

// دانلود فایل با ID
async function downloadFileById(fileId, fileName, event) {
    // جلوگیری از انتشار event به المان والد
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    try {
        const objectUrl = await fetchAndCacheMedia(fileId);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // ذخیره وضعیت دانلود در localStorage برای ماندگاری بعد از رفرش
        localStorage.setItem(`downloaded_${fileId}`, 'true');

        // آپدیت تمام پیام‌های مربوط به این فایل در صفحه
        document.querySelectorAll(`.lazy-media[data-file-id="${fileId}"]`).forEach(el => {
            loadLazyMedia(el);
        });
    } catch (err) {
        console.error('Download error:', err);
    }
}
