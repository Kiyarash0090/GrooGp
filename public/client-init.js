// client-init.js – loaded before other scripts to set debug flag and favicon
window.DEBUG = false; // switch to true during development if needed
if (!window.DEBUG) {
    console.log = console.info = console.warn = console.debug = () => {};
}

// تنظیم favicon از فایل رمزنگاری شده
document.addEventListener('DOMContentLoaded', function () {
    if (typeof getFavicon !== 'undefined') {
        const faviconData = getFavicon();

        // تنظیم تمام link های favicon
        const links = [
            { rel: 'icon', type: 'image/png', sizes: '32x32' },
            { rel: 'icon', type: 'image/png', sizes: '16x16' },
            { rel: 'shortcut icon' },
            { rel: 'apple-touch-icon' }
        ];

        links.forEach(linkAttrs => {
            const link = document.createElement('link');
            Object.keys(linkAttrs).forEach(key => {
                link.setAttribute(key, linkAttrs[key]);
            });
            link.href = faviconData;
            document.head.appendChild(link);
        });
    }
});