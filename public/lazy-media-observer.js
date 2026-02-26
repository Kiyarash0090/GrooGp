// lazy-media-observer.js - Intersection Observer برای بارگذاری هوشمند رسانه‌ها

// تنظیمات Intersection Observer
const observerOptions = {
    root: null,
    rootMargin: '200px', // بارگذاری 200px قبل از ورود به viewport
    threshold: 0.01
};

// نگهداری رسانه‌های در حال بارگذاری
const loadingMedia = new Set();
const maxConcurrentLoads = 3; // حداکثر 3 رسانه همزمان

// صف رسانه‌های در انتظار بارگذاری
const mediaQueue = [];

// بارگذاری رسانه بعدی از صف
async function processMediaQueue() {
    if (loadingMedia.size >= maxConcurrentLoads || mediaQueue.length === 0) {
        return;
    }

    const element = mediaQueue.shift();
    if (!element || element.classList.contains('loaded') || element.classList.contains('loading')) {
        processMediaQueue();
        return;
    }

    loadingMedia.add(element);

    try {
        await loadLazyMedia(element);
    } catch (err) {
        console.error('Error loading media:', err);
    } finally {
        loadingMedia.delete(element);
        // بارگذاری رسانه بعدی
        setTimeout(processMediaQueue, 100);
    }
}

// Intersection Observer برای تشخیص رسانه‌های قابل مشاهده
const mediaObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const element = entry.target;
            const fileId = element.dataset.fileId;

            // بررسی اینکه آیا قبلاً توسط کاربر دانلود شده یا خیر
            const isDownloaded = fileId && localStorage.getItem(`downloaded_${fileId}`) === 'true';

            // فقط اگر قبلاً دانلود شده، به صورت خودکار بارگذاری کن
            if (isDownloaded) {
                if (!element.classList.contains('loaded') &&
                    !element.classList.contains('loading') &&
                    !mediaQueue.includes(element)) {
                    mediaQueue.push(element);
                    processMediaQueue();
                }
            }

            // توقف مشاهده بعد از بارگذاری
            if (element.classList.contains('loaded')) {
                mediaObserver.unobserve(element);
            }
        }
    });
}, observerOptions);

// مشاهده تمام رسانه‌های lazy
function observeAllLazyMedia() {
    const lazyElements = document.querySelectorAll('.lazy-media:not(.loaded):not(.loading)');
    lazyElements.forEach(element => {
        if (!element.dataset.observed) {
            mediaObserver.observe(element);
            element.dataset.observed = 'true';
        }
    });
}

// راه‌اندازی اولیه
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeAllLazyMedia);
} else {
    observeAllLazyMedia();
}

// MutationObserver برای رسانه‌های جدید
const domObserver = new MutationObserver((mutations) => {
    let hasNewMedia = false;

    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
                // بررسی خود node
                if (node.classList && node.classList.contains('lazy-media')) {
                    hasNewMedia = true;
                }
                // بررسی فرزندان
                const lazyChildren = node.querySelectorAll && node.querySelectorAll('.lazy-media');
                if (lazyChildren && lazyChildren.length > 0) {
                    hasNewMedia = true;
                }
            }
        });
    });

    if (hasNewMedia) {
        // استفاده از requestIdleCallback برای بهینه‌سازی عملکرد
        if ('requestIdleCallback' in window) {
            requestIdleCallback(observeAllLazyMedia, { timeout: 1000 });
        } else {
            setTimeout(observeAllLazyMedia, 100);
        }
    }
});

// شروع مشاهده تغییرات DOM
const messagesContainer = document.getElementById('messages');
if (messagesContainer) {
    domObserver.observe(messagesContainer, {
        childList: true,
        subtree: true
    });
}

// پاکسازی cache قدیمی (هر 5 دقیقه)
setInterval(async () => {
    try {
        const cacheName = 'groogp-media-cache';
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();

        // حذف فایل‌های قدیمی‌تر از 1 ساعت
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        for (const request of requests) {
            const response = await cache.match(request);
            if (response) {
                const dateHeader = response.headers.get('date');
                if (dateHeader) {
                    const responseDate = new Date(dateHeader).getTime();
                    if (responseDate < oneHourAgo) {
                        await cache.delete(request);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Cache cleanup error:', err);
    }
}, 5 * 60 * 1000);

// Export برای استفاده در سایر فایل‌ها
window.observeAllLazyMedia = observeAllLazyMedia;
