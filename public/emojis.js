// emojis.js - Emoji constants, emoji-related data, and emoji utility functions
// Contains emoji categories, search names, emoji processing functions, and reaction helpers
//
// NOTE: the application renders emojis using the iOS (Apple) emoji style via twemoji's
// SVG assets (https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/).
// custom Iran flag replacement logic has been removed; native emoji will display.

// ==================== REACTION HELPERS ====================

// جلوگیری از ارسال دوگانه ریکشن برای یک پیام/نوع در بازه کوتاه
let pendingReactions = new Set();

// ==================== EMOJI UTILITY FUNCTIONS ====================



// تابع wrapper برای twemoji.parse که پرچم ایران را جایگزین می‌کند
function parseEmojis(element, options = {}) {
    // Android (Noto Color Emoji) configuration - استفاده از ایموجی‌های اندرویدی
    // استفاده از Twemoji با تنظیمات سفارشی برای Noto Emoji
    const androidEmojiOptions = {
        callback: function(icon, options) {
            // Flags are represented by pairs of regional indicator symbols joined
            // with a hyphen (e.g. "1f1e7-1f1f3" for 🇧🇳).  The Google Noto emoji
            // repository occasionally omits or throttles those SVGs, which meant
            // that flags in the picker/input never loaded and stayed as text.
            // For those we fall back to the official twemoji CDN (Apple style),
            // which is what the rest of the app already uses elsewhere.
            if (icon.indexOf('-') !== -1) {
                return 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/' + icon + '.svg';
            }
            // تبدیل کد یونیکد به فرمت نام فایل Noto Emoji
            // مثال: 1f600 -> emoji_u1f600.svg
            return 'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/svg/emoji_u' + icon + '.svg';
        },
        className: 'emoji',
        attributes: function() {
            return {
                loading: 'lazy'
            };
        }
    };

    // اگر twemoji لود نشده، آن را داینامیک لود کن و سپس parse را اجرا کن.
    function ensureTwemojiLoaded() {
        return new Promise((resolve) => {
            if (typeof twemoji !== 'undefined') return resolve(true);
            const existing = document.querySelector('script[data-twemoji-loader]');
            if (existing) {
                existing.addEventListener('load', () => resolve(typeof twemoji !== 'undefined'));
                existing.addEventListener('error', () => resolve(false));
                return;
            }
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/twemoji@latest/dist/twemoji.min.js';
            s.crossOrigin = 'anonymous';
            s.async = true;
            s.setAttribute('data-twemoji-loader', '1');
            s.onload = () => resolve(typeof twemoji !== 'undefined');
            s.onerror = () => { console.error('Failed to load twemoji from CDN'); resolve(false); };
            document.head.appendChild(s);
        });
    }

    async function doParse() {
        if (!element) return;

        // 1) Run twemoji.parse if available (primary rendering path)
        if (typeof twemoji !== 'undefined') {
            try {
                twemoji.parse(element, androidEmojiOptions);
            } catch (err) {
                console.error('twemoji.parse error:', err);
            }

            // استایل بهتر برای تمام تصاویر ایموجی (SVG)
            const emojis = element.querySelectorAll('img.emoji');
            emojis.forEach(img => {
                img.style.height = '1.3em';
                img.style.width = '1.3em';
                img.style.marginRight = '2px';
                img.style.marginLeft = '2px';
                img.style.display = 'inline-block';
                img.style.verticalAlign = '-0.2em';
                img.style.backgroundColor = 'transparent';

                // برای پرچم‌ها (flags) اندازه کمی بزرگ‌تر در نظر بگیر
                const alt = img.getAttribute('alt') || '';
                if (alt.match(/[\uD83C][\uDDE6-\uDDFF]/)) { // Regional indicators (flags)
                    img.style.height = '1.4em';
                    img.style.width = '1.4em';
                }
            });
        }

        // 2) Regardless of whether twemoji ran, make sure the custom Iran flag
        //    replacement is applied.  doParse is called after twemoji loading is
        //    confirmed, but we also invoke this when twemoji is unavailable.
        try {
            if (typeof replaceIranFlag !== 'undefined') {
                replaceIranFlag(element);
            }
        } catch (e) {
            console.error('replaceIranFlag error:', e);
        }
    }

    // اگر twemoji موجود نیست، سعی کن آن را لود کنی و سپس parse را اجرا کن.
    if (typeof twemoji === 'undefined') {
        ensureTwemojiLoaded().then((available) => {
            if (available) {
                doParse();
            } else {
                // twemoji failed to load; still replace Iran flag on the target element
                if (typeof replaceIranFlag !== 'undefined') {
                    replaceIranFlag(element);
                }
            }
        }).catch(err => console.error('ensureTwemojiLoaded error:', err));
    } else {
        doParse();
    }
}

// تابع برای جایگزینی پرچم ایران (🇮🇷) با SVG سفارشی در `encryptedAssets.iranFlag`
// این تابع در تمام بخش‌های UI صدا زده می‌شود: جستجو، ساخت کانال/گروه، تغییر نام، ویرایش اطلاعات
function replaceIranFlag(root) {
    try {
        if (!root) return;
        const IRAN = '🇮🇷';

        // helper to build data URL from encryptedAssets if available
        function iranSrc() {
            try {
                if (typeof encryptedAssets !== 'undefined' && encryptedAssets.iranFlag) {
                    return 'data:image/svg+xml;base64,' + encryptedAssets.iranFlag;
                }
            } catch (e) {}
            return null;
        }

        const src = iranSrc();
        if (!src) return; // اگر SVG کاستومی موجود نیست، هیچ کاری نکن
        
        // replace occurrences inside text nodes
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        while (walker.nextNode()) {
            const v = walker.currentNode.nodeValue;
            if (v && v.indexOf(IRAN) !== -1) textNodes.push(walker.currentNode);
        }
        textNodes.forEach(textNode => {
            const parent = textNode.parentNode;
            if (!parent) return;
            const parts = textNode.nodeValue.split(IRAN);
            const frag = document.createDocumentFragment();
            for (let i = 0; i < parts.length; i++) {
                if (parts[i].length) frag.appendChild(document.createTextNode(parts[i]));
                if (i < parts.length - 1) {
                    const img = document.createElement('img');
                    img.src = src;
                    img.className = 'iran-flag emoji';
                    img.alt = IRAN;
                    img.loading = 'lazy';
                    img.style.height = '1.3em';
                    img.style.width = '1.3em';
                    img.style.display = 'inline-block';
                    img.style.verticalAlign = '-0.2em';
                    frag.appendChild(img);
                }
            }
            parent.replaceChild(frag, textNode);
        });

        // replace innerHTML occurrences for elements without children (safe replacement)
        const els = root.querySelectorAll('*');
        els.forEach(el => {
            if (el.children.length === 0 && el.innerHTML && el.innerHTML.indexOf(IRAN) !== -1) {
                el.innerHTML = el.innerHTML.split(IRAN).join('<img src="' + src + '" class="iran-flag emoji" alt="' + IRAN + '" style="height:1.3em;width:1.3em;display:inline-block;vertical-align:-0.2em;">');
            }
        });

        // update any existing twemoji img elements that represent the Iran flag
        const imgs = root.querySelectorAll('img.emoji');
        imgs.forEach(img => {
            try {
                if ((img.alt || '') === IRAN) {
                    img.src = src;
                    img.classList.add('iran-flag');
                }
            } catch (e) {}
        });
    } catch (err) {
        console.error('replaceIranFlag error:', err);
    }
}

// تابع برای اطمینان از اینکه emoji picker باید پرچم‌هایSVG استفاده کند
function ensureFlagEmojiRendering() {
    // تمام دکمه‌های انتخاب ایموجی شامل پرچم را با parseEmojis پردازش کن
    const emojiButtons = document.querySelectorAll('.emoji-picker-content .emoji-btn');
    emojiButtons.forEach(btn => {
        const text = btn.textContent;
        if (text && /[\uD83C][\uDDE6-\uDDFF]/.test(text)) { // Regional indicators pattern
            try {
                if (typeof parseEmojis !== 'undefined') {
                    parseEmojis(btn, { folder: 'svg', ext: '.svg' });
                } else if (typeof twemoji !== 'undefined') {
                    twemoji.parse(btn, { folder: 'svg', ext: '.svg' });
                }
            } catch (err) {
                console.error('Error rendering flag emoji:', err);
            }
        }
    });
}



// Auto-process any new content added to DOM with Apple emoji
// This ensures emoji are always converted to images, never system emoji
if (typeof MutationObserver !== 'undefined' && document.body) {
    const emojiObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                if (mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            try {
                                // Ensure twemoji is available before parsing dynamic nodes
                                if (typeof twemoji === 'undefined') {
                                    // load asynchronously but still attempt parse when ready
                                    (async () => { try { await (new Promise((res)=>{
                                        const s = document.querySelector('script[data-twemoji-loader]');
                                        if (s) { s.addEventListener('load', ()=>res(true)); s.addEventListener('error', ()=>res(false)); }
                                        else { res(true); }
                                    })); parseEmojis(node); } catch(e){ console.error(e); } })();
                                } else {
                                    parseEmojis(node);
                                }
                            } catch (e) {
                                console.error('MutationObserver parseEmojis error:', e);
                            }
                        }
                    });
                }
            }
        });
    });
    
    emojiObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: false
    });
}

// Process existing page content on load
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Load twemoji if needed then parse the whole document to enforce Apple emoji images
        (async () => {
            try {
                if (typeof twemoji === 'undefined') {
                    const s = document.querySelector('script[data-twemoji-loader]');
                    if (!s) {
                        const loader = document.createElement('script');
                        loader.src = 'https://cdn.jsdelivr.net/npm/twemoji@latest/dist/twemoji.min.js';
                        loader.crossOrigin = 'anonymous';
                        loader.async = true;
                        loader.setAttribute('data-twemoji-loader', '1');
                        document.head.appendChild(loader);
                        await new Promise((res) => { loader.addEventListener('load', () => res(true)); loader.addEventListener('error', () => res(false)); });
                    }
                }
            } catch (e) {
                console.error('twemoji loader error:', e);
            }
            try { parseEmojis(document.body); } catch (e) { console.error('Initial page emoji parsing error:', e); }
        })();
    } catch (e) {
        console.error('Initial page emoji parsing error:', e);
    }
});

// استخراج متن از یک عنصر شامل ایموجی‌های ساخته شده توسط twemoji
function getTextWithEmoji(element) {
    if (!element) return '';
    let text = '';
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            if (el.tagName === 'IMG' && el.classList.contains('emoji')) {
                text += el.alt || '';
            }
        }
    }
    return text.trim();
}

// ==================== EMOJI DATA ====================

const emojis = {
    smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '😶‍🌫️', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'],
    gestures: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋'],
    animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔'],
    food: ['🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🥝', '🍅', '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️', '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦀', '🦞', '🦐', '🦑', '🦪', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍼', '🥛', '☕', '🍵', '🍶', '🍾', '🍷', '🍸', '🍹', '🍺', '🍻', '🥂', '🥃', '🥤', '🧃', '🧉', '🧊'],
    travel: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🚜', '🦯', '🦽', '🦼', '🛴', '🚲', '🛵', '🏍️', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '⛽', '🚧', '🚦', '🚥', '🚏', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🕍', '🛕', '🕋'],
    objects: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '🤺', '⛹️', '🤾', '🏌️', '🏇', '🧘', '🏊', '🏄', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩', '📱', '📲', '☎️', '📞', '📟', '📠', '🔋', '🔌', '💻', '🖥️', '🖨️', '⌨️', '🖱️', '🖲️', '💽', '💾', '💿', '📀', '🧮', '🎥', '🎞️', '📽️', '🎬', '📺', '📷', '📸', '📹', '📼', '🔍', '🔎', '🕯️', '💡', '🔦', '🏮', '🪔', '📔', '📕', '📖', '📗', '📘', '📙', '📚', '📓', '📒', '📃', '📜', '📄', '📰', '🗞️', '📑', '🔖', '🏷️', '💰', '💴', '💵', '💶', '💷', '💸', '💳', '🧾', '💹', '✉️', '📧', '📨', '📩', '📤', '📥', '📦', '📫', '📪', '📬', '📭', '📮', '🗳️', '✏️', '✒️', '🖋️', '🖊️', '🖌️', '🖍️', '📝', '💼', '📁', '📂', '🗂️', '📅', '📆', '🗒️', '🗓️', '📇', '📈', '📉', '📊', '📋', '📌', '📍', '📎', '🖇️', '📏', '📐', '✂️', '🗃️', '🗄️', '🗑️'],
    symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧'],
    flags: ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇦🇫', '🇦🇽', '🇦🇱', '🇩🇿', '🇦🇸', '🇦🇩', '🇦🇴', '🇦🇮', '🇦🇶', '🇦🇬', '🇦🇷', '🇦🇲', '🇦🇼', '🇦🇺', '🇦🇹', '🇦🇿', '🇧🇸', '🇧🇭', '🇧🇩', '🇧🇧', '🇧🇾', '🇧🇪', '🇧🇿', '🇧🇯', '🇧🇲', '🇧🇹', '🇧🇴', '🇧🇦', '🇧🇼', '🇧🇷', '🇮🇴', '🇻🇬', '🇧🇳', '🇧🇬', '🇧🇫', '🇧🇮', '🇰🇭', '🇨🇲', '🇨🇦', '🇮🇨', '🇨🇻', '🇧🇶', '🇰🇾', '🇨🇫', '🇹🇩', '🇨🇱', '🇨🇳', '🇨🇽', '🇨🇨', '🇨🇴', '🇰🇲', '🇨🇬', '🇨🇩', '🇨🇰', '🇨🇷', '🇨🇮', '🇭🇷', '🇨🇺', '🇨🇼', '🇨🇾', '🇨🇿', '🇩🇰', '🇩🇯', '🇩🇲', '🇩🇴', '🇪🇨', '🇪🇬', '🇸🇻', '🇬🇶', '🇪🇷', '🇪🇪', '🇪🇹', '🇪🇺', '🇫🇰', '🇫🇴', '🇫🇯', '🇫🇮', '🇫🇷', '🇬🇫', '🇵🇫', '🇹🇫', '🇬🇦', '🇬🇲', '🇬🇪', '🇩🇪', '🇬🇭', '🇬🇮', '🇬🇷', '🇬🇱', '🇬🇩', '🇬🇵', '🇬🇺', '🇬🇹', '🇬🇬', '🇬🇳', '🇬🇼', '🇬🇾', '🇭🇹', '🇭🇳', '🇭🇰', '🇭🇺', '🇮🇸', '🇮🇳', '🇮🇩', '🇮🇷', '🇮🇶', '🇮🇪', '🇮🇲', '🇮🇱', '🇮🇹', '🇯🇲', '🇯🇵', '🎌', '🇯🇪', '🇯🇴', '🇰🇿', '🇰🇪', '🇰🇮', '🇽🇰', '🇰🇼', '🇰🇬', '🇱🇦', '🇱🇻', '🇱🇧', '🇱🇸', '🇱🇷', '🇱🇾', '🇱🇮', '🇱🇹', '🇱🇺', '🇲🇴', '🇲🇰', '🇲🇬', '🇲🇼', '🇲🇾', '🇲🇻', '🇲🇱', '🇲🇹', '🇲🇭', '🇲🇶', '🇲🇷', '🇲🇺', '🇾🇹', '🇲🇽', '🇫🇲', '🇲🇩', '🇲🇨', '🇲🇳', '🇲🇪', '🇲🇸', '🇲🇦', '🇲🇿', '🇲🇲', '🇳🇦', '🇳🇷', '🇳🇵', '🇳🇱', '🇳🇨', '🇳🇿', '🇳🇮', '🇳🇪', '🇳🇬', '🇳🇺', '🇳🇫', '🇰🇵', '🇲🇵', '🇳🇴', '🇴🇲', '🇵🇰', '🇵🇼', '🇵🇸', '🇵🇦', '🇵🇬', '🇵🇾', '🇵🇪', '🇵🇭', '🇵🇳', '🇵🇱', '🇵🇹', '🇵🇷', '🇶🇦', '🇷🇪', '🇷🇴', '🇷🇺', '🇷🇼', '🇼🇸', '🇸🇲', '🇸🇹', '🇸🇦', '🇸🇳', '🇷🇸', '🇸🇨', '🇸🇱', '🇸🇬', '🇸🇽', '🇸🇰', '🇸🇮', '🇬🇸', '🇸🇧', '🇸🇴', '🇿🇦', '🇰🇷', '🇸🇸', '🇪🇸', '🇱🇰', '🇧🇱', '🇸🇭', '🇰🇳', '🇱🇨', '🇵🇲', '🇻🇨', '🇸🇩', '🇸🇷', '🇸🇿', '🇸🇪', '🇨🇭', '🇸🇾', '🇹🇼', '🇹🇯', '🇹🇿', '🇹🇭', '🇹🇱', '🇹🇬', '🇹🇰', '🇹🇴', '🇹🇹', '🇹🇳', '🇹🇷', '🇹🇲', '🇹🇨', '🇹🇻', '🇻🇮', '🇺🇬', '🇺🇦', '🇦🇪', '🇬🇧', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', '🇺🇸', '🇺🇾', '🇺🇿', '🇻🇺', '🇻🇦', '🇻🇪', '🇻🇳', '🇼🇫', '🇪🇭', '🇾🇪', '🇿🇲', '🇿🇼']
};

// دیکشنری نام‌های ایموجی‌ها برای جستجو
const emojiNames = {
    '😀': 'خنده لبخند شاد happy smile',
    '😃': 'خنده لبخند شاد happy smile',
    '😄': 'خنده لبخند شاد happy smile',
    '😁': 'خنده لبخند شاد happy smile',
    '😆': 'خنده لبخند شاد happy smile',
    '😅': 'خنده عرق sweat smile',
    '🤣': 'خنده laugh',
    '😂': 'خنده اشک laugh tear',
    '😊': 'خنده لبخند blush smile',
    '😍': 'عشق love heart',
    '🥰': 'عشق love heart',
    '😘': 'بوسه kiss',
    '😗': 'بوسه kiss',
    '😚': 'بوسه kiss',
    '😙': 'بوسه kiss',
    '😋': 'خوشمزه yummy',
    '😛': 'زبان tongue',
    '😜': 'زبان چشمک wink tongue',
    '🤪': 'دیوانه crazy',
    '😝': 'زبان tongue',
    '🤑': 'پول money',
    '🤗': 'بغل hug',
    '🤭': 'خجالت shy',
    '🤫': 'ساکت quiet shh',
    '🤔': 'فکر think',
    '😐': 'خنثی neutral',
    '😑': 'خنثی neutral',
    '😶': 'ساکت silent',
    '😏': 'شیطون smirk',
    '😒': 'ناراحت upset',
    '🙄': 'چشم غلت roll eyes',
    '😬': 'دندان teeth',
    '😌': 'آرام relief',
    '😔': 'غمگین sad',
    '😪': 'خواب sleep',
    '😴': 'خواب sleep',
    '😷': 'ماسک mask',
    '🤒': 'مریض sick',
    '🤕': 'زخم hurt',
    '🤢': 'حالت تهوع nausea',
    '🤮': 'استفراغ vomit',
    '🤧': 'عطسه sneeze',
    '🥵': 'گرم hot',
    '🥶': 'سرد cold',
    '😵': 'گیج dizzy',
    '🤯': 'انفجار explode mind',
    '🤠': 'کابوی cowboy',
    '🥳': 'جشن party',
    '😎': 'عینک cool sunglasses',
    '🤓': 'عینک nerd',
    '😕': 'گیج confused',
    '😟': 'نگران worried',
    '🙁': 'ناراحت sad',
    '😮': 'تعجب wow',
    '😯': 'تعجب wow',
    '😲': 'شوکه shock',
    '😳': 'خجالت blush',
    '🥺': 'التماس plead',
    '😢': 'گریه cry',
    '😭': 'گریه cry',
    '😱': 'ترس fear scream',
    '😖': 'ناراحت upset',
    '😞': 'ناراحت disappointed',
    '😓': 'عرق sweat',
    '😩': 'خسته tired',
    '😫': 'خسته tired',
    '😤': 'عصبانی angry',
    '😡': 'عصبانی angry',
    '😠': 'عصبانی angry',
    '🤬': 'فحش curse',
    '😈': 'شیطان devil',
    '👿': 'شیطان devil',
    '💀': 'جمجمه skull',
    '☠️': 'جمجمه skull',
    '💩': 'مدفوع poop',
    '🤡': 'دلقک clown',
    '👋': 'سلام دست wave hand',
    '🤚': 'دست hand',
    '✋': 'دست hand',
    '👌': 'اوکی ok',
    '✌️': 'صلح peace',
    '🤞': 'انگشت finger cross',
    '🤟': 'عشق love',
    '🤘': 'راک rock',
    '👈': 'انگشت finger',
    '👉': 'انگشت finger',
    '👆': 'انگشت finger',
    '👇': 'انگشت finger',
    '👍': 'لایک like thumb',
    '👎': 'دیسلایک dislike thumb',
    '✊': 'مشت fist',
    '👊': 'مشت fist',
    '👏': 'دست زدن clap',
    '🙌': 'دست hand',
    '🙏': 'دعا pray',
    '💪': 'عضله muscle strong',
    '👀': 'چشم eye',
    '👁️': 'چشم eye',
    '👅': 'زبان tongue',
    '👄': 'لب lip',
    '💋': 'بوسه kiss',
    '🐶': 'سگ dog',
    '🐱': 'گربه cat',
    '🐭': 'موش mouse',
    '🐹': 'همستر hamster',
    '🐰': 'خرگوش rabbit',
    '🦊': 'روباه fox',
    '🐻': 'خرس bear',
    '🐼': 'پاندا panda',
    '🐨': 'کوالا koala',
    '🐯': 'ببر tiger',
    '🦁': 'شیر lion',
    '🐮': 'گاو cow',
    '🐷': 'خوک pig',
    '🐸': 'قورباغه frog',
    '🐵': 'میمون monkey',
    '🐔': 'مرغ chicken',
    '🐧': 'پنگوئن penguin',
    '🐦': 'پرنده bird',
    '🦆': 'اردک duck',
    '🦅': 'عقاب eagle',
    '🦉': 'جغد owl',
    '🐺': 'گرگ wolf',
    '🐴': 'اسب horse',
    '🦄': 'تک شاخ unicorn',
    '🐝': 'زنبور bee',
    '🦋': 'پروانه butterfly',
    '🐌': 'حلزون snail',
    '🐞': 'کفشدوزک ladybug',
    '🐜': 'مورچه ant',
    '🐢': 'لاک پشت turtle',
    '🐍': 'مار snake',
    '🦎': 'مارمولک lizard',
    '🐙': 'اختاپوس octopus',
    '🦑': 'ماهی مرکب squid',
    '🦐': 'میگو shrimp',
    '🦀': 'خرچنگ crab',
    '🐡': 'ماهی fish',
    '🐠': 'ماهی fish',
    '🐟': 'ماهی fish',
    '🐬': 'دلفین dolphin',
    '🐳': 'نهنگ whale',
    '🐋': 'نهنگ whale',
    '🦈': 'کوسه shark',
    '🐊': 'تمساح crocodile',
    '🐅': 'ببر tiger',
    '🐆': 'پلنگ leopard',
    '🐘': 'فیل elephant',
    '🦏': 'کرگدن rhino',
    '🐪': 'شتر camel',
    '🦒': 'زرافه giraffe',
    '🐕': 'سگ dog',
    '🐈': 'گربه cat',
    '🐓': 'خروس rooster',
    '🍇': 'انگور grape',
    '🍈': 'خربزه melon',
    '🍉': 'هندوانه watermelon',
    '🍊': 'پرتقال orange',
    '🍋': 'لیمو lemon',
    '🍌': 'موز banana',
    '🍍': 'آناناس pineapple',
    '🍎': 'سیب apple',
    '🍏': 'سیب apple',
    '🍐': 'گلابی pear',
    '🍑': 'هلو peach',
    '🍒': 'گیلاس cherry',
    '🍓': 'توت فرنگی strawberry',
    '🥝': 'کیوی kiwi',
    '🍅': 'گوجه tomato',
    '🥑': 'آووکادو avocado',
    '🍆': 'بادمجان eggplant',
    '🥔': 'سیب زمینی potato',
    '🥕': 'هویج carrot',
    '🌽': 'ذرت corn',
    '🌶️': 'فلفل pepper',
    '🥒': 'خیار cucumber',
    '🍄': 'قارچ mushroom',
    '🍞': 'نان bread',
    '🥐': 'کروسان croissant',
    '🥖': 'باگت baguette',
    '🧀': 'پنیر cheese',
    '🍖': 'گوشت meat',
    '🍗': 'مرغ chicken',
    '🥩': 'گوشت meat steak',
    '🥓': 'بیکن bacon',
    '🍔': 'همبرگر burger',
    '🍟': 'سیب زمینی fries',
    '🍕': 'پیتزا pizza',
    '🌭': 'هات داگ hotdog',
    '🥪': 'ساندویچ sandwich',
    '🌮': 'تاکو taco',
    '🌯': 'بوریتو burrito',
    '🥚': 'تخم مرغ egg',
    '🍳': 'تخم مرغ egg',
    '🍲': 'سوپ soup',
    '🍿': 'پاپ کورن popcorn',
    '🍱': 'غذا food',
    '🍜': 'نودل noodle',
    '🍝': 'اسپاگتی spaghetti pasta',
    '🍣': 'سوشی sushi',
    '🍦': 'بستنی ice cream',
    '🍧': 'بستنی ice cream',
    '🍨': 'بستنی ice cream',
    '🍩': 'دونات donut',
    '🍪': 'کوکی cookie',
    '🎂': 'کیک cake',
    '🍰': 'کیک cake',
    '🧁': 'کاپ کیک cupcake',
    '🍫': 'شکلات chocolate',
    '🍬': 'آب نبات candy',
    '🍭': 'آب نبات candy lollipop',
    '🍯': 'عسل honey',
    '🥛': 'شیر milk',
    '☕': 'قهوه coffee',
    '🍵': 'چای tea',
    '🍶': 'ساکه sake',
    '🍷': 'شراب wine',
    '🍸': 'نوشیدنی drink cocktail',
    '🍹': 'نوشیدنی drink',
    '🍺': 'آبجو beer',
    '🍻': 'آبجو beer',
    '🥂': 'جشن cheers',
    '🥃': 'ویسکی whiskey',
    '🚗': 'ماشین car',
    '🚕': 'تاکسی taxi',
    '🚙': 'ماشین car',
    '🚌': 'اتوبوس bus',
    '🚎': 'اتوبوس bus',
    '🏎️': 'ماشین مسابقه race car',
    '🚓': 'پلیس police',
    '🚑': 'آمبولانس ambulance',
    '🚒': 'آتش نشانی fire truck',
    '🚚': 'کامیون truck',
    '🚛': 'کامیون truck',
    '🚲': 'دوچرخه bike bicycle',
    '🛵': 'موتور motor',
    '🏍️': 'موتور motorcycle',
    '✈️': 'هواپیما airplane plane',
    '🚀': 'موشک rocket',
    '🚁': 'هلیکوپتر helicopter',
    '🛶': 'قایق boat',
    '⛵': 'قایق boat',
    '🚤': 'قایق boat',
    '🛳️': 'کشتی ship',
    '🚢': 'کشتی ship',
    '🏠': 'خانه home house',
    '🏡': 'خانه home house',
    '🏢': 'ساختمان building',
    '🏥': 'بیمارستان hospital',
    '🏦': 'بانک bank',
    '🏨': 'هتل hotel',
    '🏪': 'فروشگاه shop store',
    '🏫': 'مدرسه school',
    '⛪': 'کلیسا church',
    '🕌': 'مسجد mosque',
    '⚽': 'فوتبال football soccer',
    '🏀': 'بسکتبال basketball',
    '🏈': 'فوتبال آمریکایی football',
    '⚾': 'بیسبال baseball',
    '🎾': 'تنیس tennis',
    '🏐': 'والیبال volleyball',
    '🏉': 'راگبی rugby',
    '🎱': 'بیلیارد billiard',
    '🏓': 'پینگ پنگ ping pong',
    '🏸': 'بدمینتون badminton',
    '🥊': 'بوکس boxing',
    '🥋': 'کاراته karate',
    '🏆': 'جام trophy',
    '🥇': 'مدال طلا gold medal',
    '🥈': 'مدال نقره silver medal',
    '🥉': 'مدال برنز bronze medal',
    '🏅': 'مدال medal',
    '🎮': 'بازی game',
    '🎯': 'هدف target dart',
    '🎲': 'تاس dice',
    '🎭': 'تئاتر theater',
    '🎨': 'هنر art paint',
    '🎬': 'فیلم movie',
    '🎤': 'میکروفون microphone',
    '🎧': 'هدفون headphone',
    '🎼': 'موسیقی music',
    '🎹': 'پیانو piano',
    '🎸': 'گیتار guitar',
    '🎻': 'ویولن violin',
    '📱': 'موبایل mobile phone',
    '💻': 'لپ تاپ laptop computer',
    '🖥️': 'کامپیوتر computer',
    '⌨️': 'کیبورد keyboard',
    '🖱️': 'موس mouse',
    '📷': 'دوربین camera',
    '📸': 'دوربین camera',
    '📺': 'تلویزیون tv',
    '📻': 'رادیو radio',
    '⏰': 'ساعت clock alarm',
    '⌚': 'ساعت watch',
    '📞': 'تلفن phone',
    '☎️': 'تلفن phone',
    '📧': 'ایمیل email',
    '✉️': 'نامه mail letter',
    '📮': 'صندوق پست mailbox',
    '📝': 'یادداشت note',
    '📖': 'کتاب book',
    '📚': 'کتاب book',
    '💰': 'پول money',
    '💵': 'دلار dollar',
    '💳': 'کارت card',
    '🔑': 'کلید key',
    '🔒': 'قفل lock',
    '🔓': 'باز unlock',
    '❤️': 'قلب عشق love heart',
    '🧡': 'قلب نارنجی orange heart',
    '💛': 'قلب زرد yellow heart',
    '💚': 'قلب سبز green heart',
    '💙': 'قلب آبی blue heart',
    '💜': 'قلب بنفش purple heart',
    '🖤': 'قلب سیاه black heart',
    '🤍': 'قلب سفید white heart',
    '💔': 'قلب شکسته broken heart',
    '💕': 'قلب عشق love heart',
    '💞': 'قلب عشق love heart',
    '💓': 'قلب عشق love heart',
    '💗': 'قلب عشق love heart',
    '💖': 'قلب عشق love heart',
    '💘': 'قلب عشق love heart',
    '💝': 'قلب عشق love heart',
    '✨': 'ستاره star sparkle',
    '⭐': 'ستاره star',
    '🌟': 'ستاره star',
    '💫': 'ستاره star dizzy',
    '✅': 'تیک چک check',
    '❌': 'ضربدر cross x',
    '⭕': 'دایره circle',
    '❗': 'علامت تعجب exclamation',
    '❓': 'علامت سوال question',
    '💯': 'صد hundred',
    '🔥': 'آتش fire',
    '💧': 'آب water drop',
    '🌈': 'رنگین کمان rainbow',
    '☀️': 'خورشید sun',
    '🌙': 'ماه moon',
    '⚡': 'برق lightning',
    '☁️': 'ابر cloud',
    '🌧️': 'باران rain',
    '❄️': 'برف snow',
    '🎄': 'درخت کریسمس christmas tree',
    '🎁': 'هدیه gift present',
    '🎈': 'بادکنک balloon',
    '🎉': 'جشن party celebration',
    '🎊': 'جشن party celebration',
    '🏁': 'پرچم flag',
    '🚩': 'پرچم flag',
    '🏴': 'پرچم سیاه black flag',
    '🏳️': 'پرچم سفید white flag',
    '🏳️‍🌈': 'پرچم رنگین کمان rainbow flag',
    '🇮🇷': 'ایران iran',
    '🇺🇸': 'آمریکا america usa',
    '🇬🇧': 'انگلیس england uk',
    '🇫🇷': 'فرانسه france',
    '🇩🇪': 'آلمان germany',
    '🇮🇹': 'ایتالیا italy',
    '🇪🇸': 'اسپانیا spain',
    '🇯🇵': 'ژاپن japan',
    '🇨🇳': 'چین china',
    '🇰🇷': 'کره جنوبی korea',
    '🇷🇺': 'روسیه russia',
    '🇧🇷': 'برزیل brazil',
    '🇨🇦': 'کانادا canada',
    '🇦🇺': 'استرالیا australia',
    '🇮🇳': 'هند india',
    '🇹🇷': 'ترکیه turkey',
    '🇸🇦': 'عربستان saudi arabia',
    '🇦🇪': 'امارات uae',
    '🇪🇬': 'مصر egypt',
    '🇮🇶': 'عراق iraq'
};

// ==================== REACTION FUNCTIONS ====================

// تابع نمایش انیمیشن قلب
function showHeartAnimation(messageDiv) {
    const messageBubble = messageDiv.querySelector('.message-bubble');
    if (!messageBubble) return;
    
    // Create heart animation element
    const heart = document.createElement('div');
    heart.className = 'heart-animation';
    heart.textContent = '❤️';
    
    messageBubble.style.position = 'relative';
    messageBubble.appendChild(heart);
    
    // Remove after animation
    setTimeout(() => {
        heart.remove();
    }, 800);
}

// تابع یکپارچه برای مدیریت همه ریکشن‌ها
function toggleReaction(messageDiv, messageId, reaction) {
    // do nothing when selecting messages
    if (typeof isSelectionMode !== 'undefined' && isSelectionMode) return;

    if (!messageId || !reaction) return;

    // debounce: جلوگیری از ارسال‌های مکرر برای همان messageId+reaction
    try {
        const key = `${messageId}:${reaction}`;
        if (pendingReactions.has(key)) return;
        pendingReactions.add(key);
        setTimeout(() => pendingReactions.delete(key), 600);
    } catch (err) {
        console.error('toggleReaction debounce error', err);
    }
    
    const messageBubble = messageDiv.querySelector('.message-bubble');
    if (!messageBubble) return;
    
    // تعیین نوع چت
    let chatType = 'global';
    let groupId = null;
    if (currentChat && currentChat !== 'global') {
        if (currentChat.startsWith('group_') || currentChat.startsWith('channel_')) {
            chatType = 'custom_group';
            groupId = currentChat;
        } else {
            chatType = 'private';
        }
    }
    
    // پیدا کردن یا ساخت container ریکشن‌ها
    let reactionsContainer = messageBubble.querySelector('.message-reactions-container');
    if (!reactionsContainer) {
        reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'message-reactions-container';
        messageBubble.appendChild(reactionsContainer);
    }
    
    // ابتدا بررسی کن آیا کاربر قبلاً ریکشن دیگری داده
    const allReactions = Array.from(reactionsContainer.children);
    let userHasThisReaction = false;
    let userPreviousReaction = null;
    
    allReactions.forEach(el => {
        const reactionData = el.dataset.users ? JSON.parse(el.dataset.users) : [];
        const userIndex = reactionData.findIndex(u => u.username === currentUser.username);
        
        if (userIndex !== -1) {
            if (el.dataset.reaction === reaction) {
                userHasThisReaction = true;
            } else {
                userPreviousReaction = {
                    element: el,
                    reaction: el.dataset.reaction,
                    data: reactionData,
                    userIndex: userIndex
                };
            }
        }
    });
    
    // اگر کاربر روی همون ریکشن کلیک کرده، فقط حذفش کن
    if (userHasThisReaction) {
        const reactionElement = allReactions.find(el => el.dataset.reaction === reaction);
        const reactionData = JSON.parse(reactionElement.dataset.users);
        const userIndex = reactionData.findIndex(u => u.username === currentUser.username);
        
        reactionData.splice(userIndex, 1);
        
        if (reactionData.length === 0) {
            reactionElement.remove();
            if (reactionsContainer.children.length === 0) {
                reactionsContainer.remove();
            }
        } else {
            reactionElement.dataset.users = JSON.stringify(reactionData);
            reactionElement.querySelector('.reaction-count').textContent = reactionData.length;
        }
        
        // ارسال به سرور
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'remove_reaction',
                messageId: messageId,
                reaction: reaction,
                chatType: chatType,
                groupId: groupId
            }));
        }
        return;
    }
    
    // اگر کاربر ریکشن قبلی داشته، حذفش کن
    if (userPreviousReaction) {
        userPreviousReaction.data.splice(userPreviousReaction.userIndex, 1);
        
        if (userPreviousReaction.data.length === 0) {
            userPreviousReaction.element.remove();
        } else {
            userPreviousReaction.element.dataset.users = JSON.stringify(userPreviousReaction.data);
            userPreviousReaction.element.querySelector('.reaction-count').textContent = userPreviousReaction.data.length;
        }
        
        // ارسال به سرور
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'remove_reaction',
                messageId: messageId,
                reaction: userPreviousReaction.reaction,
                chatType: chatType,
                groupId: groupId
            }));
        }
    }
    
    // اضافه کردن ریکشن جدید
    let reactionElement = allReactions.find(el => el.dataset.reaction === reaction);
    
    if (reactionElement) {
        // ریکشن وجود داره، فقط کاربر رو اضافه کن
        const reactionData = JSON.parse(reactionElement.dataset.users);
        reactionData.push({
            username: currentUser.username,
            userid: currentUser.user_id,
            profile_picture: currentUser.profile_picture,
            timestamp: new Date().toISOString()
        });
        
        reactionElement.dataset.users = JSON.stringify(reactionData);
        reactionElement.querySelector('.reaction-count').textContent = reactionData.length;
    } else {
        // ساخت ریکشن جدید
        reactionElement = document.createElement('div');
        reactionElement.className = 'message-reaction';
        reactionElement.dataset.reaction = reaction;
        reactionElement.dataset.users = JSON.stringify([{
            username: currentUser.username,
            userid: currentUser.user_id,
            profile_picture: currentUser.profile_picture,
            timestamp: new Date().toISOString()
        }]);
        reactionElement.innerHTML = `
            <span class="reaction-icon">${reaction}</span>
            <span class="reaction-count">1</span>
        `;
        
        // clicking an existing reaction adds/removes current user's reaction
        const attachReactionHandlers = (el) => {
            const messageDivEl = messageBubble.closest('.message');
            
            // click handler for desktop
            el.addEventListener('click', (ev) => {
                // ignore touch-generated clicks
                if ('ontouchstart' in window) return;
                ev.stopPropagation();
                ev.preventDefault();
                toggleReaction(messageDivEl, messageId, el.dataset.reaction);
            });

            // جلوگیری از باز شدن context menu مرورگر
            el.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
            });

            // long-press to view who reacted
            let longPressT = null;
            let longPressTriggered = false;
            
            const startLongPress = (ev) => {
                ev.stopPropagation();
                if (ev.cancelable) ev.preventDefault();
                longPressTriggered = false;
                if (longPressT) clearTimeout(longPressT);
                longPressT = setTimeout(() => {
                    longPressTriggered = true;
                    showReactionUsers(messageId, el);
                }, 1000);
            };
            
            const cancelLongPress = (ev) => {
                if (ev) {
                    ev.stopPropagation();
                    if (ev.cancelable) ev.preventDefault();
                }
                if (longPressT) { 
                    clearTimeout(longPressT); 
                    longPressT = null; 
                }
                
                // اگر long press trigger نشده بود، یعنی یک tap معمولی بوده
                // پس ریکشن رو toggle کن
                if (ev && ev.type === 'touchend' && !longPressTriggered) {
                    toggleReaction(messageDivEl, messageId, el.dataset.reaction);
                }
                longPressTriggered = false;
            };

            el.addEventListener('mousedown', startLongPress);
            el.addEventListener('mouseup', cancelLongPress);
            el.addEventListener('mouseleave', cancelLongPress);
            el.addEventListener('touchstart', startLongPress, { passive: false });
            el.addEventListener('touchend', cancelLongPress, { passive: false });
            el.addEventListener('touchmove', (ev) => {
                ev.stopPropagation();
                if (longPressT) { 
                    clearTimeout(longPressT); 
                    longPressT = null; 
                }
            }, { passive: false });
        };

        attachReactionHandlers(reactionElement);
        
        reactionsContainer.appendChild(reactionElement);
    }
    
    // ارسال به سرور
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'add_reaction',
            messageId: messageId,
            reaction: reaction,
            chatType: chatType,
            groupId: groupId
        }));
    }
}

// تابع نمایش کاربرانی که ریکشن دادند
function showReactionUsers(messageId, heartReaction) {
    const users = heartReaction.dataset.users ? JSON.parse(heartReaction.dataset.users) : [];
    
    if (users.length === 0) return;
    
    // بررسی اینکه آیا در کانال هستیم
    const isChannel = currentGroupSettings && currentGroupSettings.group_type === 'channel';

    if (isChannel) {
        // در کانال، فقط تعداد ریکشن‌ها رو نشون بده (anonymous)
        const modal = document.createElement('div');
        modal.className = 'reaction-users-modal';
        modal.innerHTML = `
            <div class="reaction-users-content">
                <div class="reaction-users-header">
                    <h3>
                        <span class="reaction-icon"></span>
                        <span>ریکشن‌ها</span>
                    </h3>
                    <span class="close-modal" id="close-reaction-users-modal">✕</span>
                </div>
                <div class="reaction-users-list" id="reaction-users-list">
                    <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                        <div class="reaction-big-icon" style="font-size: 48px; margin-bottom: 16px;"></div>
                        <div style="font-size: 24px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">${users.length}</div>
                        <div>نفر به این پیام ریکشن دادند</div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // set icon from the clicked reaction element (if provided)
        try {
            const icon = (heartReaction && heartReaction.dataset && heartReaction.dataset.reaction) ? heartReaction.dataset.reaction : '❤️';
            const iconElem = modal.querySelector('.reaction-icon');
            const bigIcon = modal.querySelector('.reaction-big-icon');
            if (iconElem) iconElem.textContent = icon;
            if (bigIcon) bigIcon.textContent = icon;

            if (typeof parseEmojis !== 'undefined') {
                parseEmojis(modal, { folder: 'svg', ext: '.svg' });
            } else if (typeof replaceIranFlag !== 'undefined') {
                replaceIranFlag(modal);
            }
        } catch (err) {
            console.error('apply icon in channel reaction modal failed', err);
        }

        // Close modal events
        const closeBtn = modal.querySelector('#close-reaction-users-modal');
        closeBtn.addEventListener('click', () => modal.remove());

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        return;
    }
    
    // برای گروه‌ها و پیوی‌ها، لیست کامل کاربران رو نشون بده
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'reaction-users-modal';
    modal.innerHTML = `
        <div class="reaction-users-content">
            <div class="reaction-users-header">
                <h3>
                    <span class="reaction-icon">❤️</span>
                    <span>ریکشن‌ها</span>
                </h3>
                <span class="close-modal" id="close-reaction-users-modal">✕</span>
            </div>
            <div class="reaction-users-list" id="reaction-users-list"></div>
        </div>
    `;
    
    document.body.appendChild(modal);

    // set header icon from clicked reaction element if available
    try {
        const icon = (heartReaction && heartReaction.dataset && heartReaction.dataset.reaction) ? heartReaction.dataset.reaction : '❤️';
        const iconElem = modal.querySelector('.reaction-icon');
        if (iconElem) iconElem.textContent = icon;

        if (typeof parseEmojis !== 'undefined') {
            parseEmojis(modal, { folder: 'svg', ext: '.svg' });
        }
    } catch (err) {
        console.error('apply icon in reaction users modal failed', err);
    }

    // Populate users list
    const usersList = modal.querySelector('#reaction-users-list');
    // Make list scrollable for many users
    usersList.style.maxHeight = '60vh';
    usersList.style.overflowY = 'auto';
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'reaction-user-item';
        
        // Create avatar
        let avatarHTML;
        if (user.profile_picture) {
            avatarHTML = `<div class="reaction-user-avatar" style="background-image: url("${user.profile_picture}"); background-size: cover; background-position: center;"></div>`;
        } else {
            const avatar = user.username.charAt(0).toUpperCase();
            avatarHTML = `<div class="reaction-user-avatar">${avatar}</div>`;
        }
        
        // Format time
        let timeText = '';
        if (user.timestamp) {
            // اگر timestamp فرمت ISO string نداره، به عنوان UTC در نظر بگیر
            let date;
            if (user.timestamp.includes('T') || user.timestamp.includes('Z')) {
                // ISO format
                date = new Date(user.timestamp);
            } else {
                // SQLite datetime format - به عنوان UTC در نظر بگیر
                date = new Date(user.timestamp + 'Z');
            }
            
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            
            if (diffMins < 1) {
                timeText = 'الان';
            } else if (diffMins < 60) {
                timeText = `${diffMins} دقیقه پیش`;
            } else if (diffMins < 1440) {
                const hours = Math.floor(diffMins / 60);
                timeText = `${hours} ساعت پیش`;
            } else {
                const days = Math.floor(diffMins / 1440);
                timeText = `${days} روز پیش`;
            }
        }
        
        userItem.innerHTML = `
            ${avatarHTML}
            <div class="reaction-user-info">
                <div class="reaction-user-name">${user.username}</div>
                <div class="reaction-user-userid">@${user.userid || user.username}</div>
            </div>
            <div class="reaction-user-time">${timeText}</div>
        `;
        
        // Add click event to open user profile
        userItem.addEventListener('click', () => {
            modal.remove();
            showUserInfo(user.username);
        });
        
        usersList.appendChild(userItem);
    });
    
    // Close modal events
    const closeBtn = modal.querySelector('#close-reaction-users-modal');
    closeBtn.addEventListener('click', () => modal.remove());
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// رندر کردن ریکشن‌ها به صورت گروه‌بندی‌شده بر اساس نوع ریکشن
function renderReactions(messageBubble, reactions, messageId) {
    if (!messageBubble) return;

    // Remove existing reactions container if any
    const existing = messageBubble.querySelector('.message-reactions-container');
    if (existing) existing.remove();

    if (!reactions || reactions.length === 0) return;

    // Group by reaction_type
    const grouped = {};
    reactions.forEach(r => {
        const type = r.reaction_type || r.reaction || '❤️';
        if (!grouped[type]) grouped[type] = [];
        grouped[type].push({
            username: r.username,
            userid: r.userid || r.user_id_text || r.user_id,
            profile_picture: r.profile_picture,
            timestamp: r.timestamp
        });
    });

    const container = document.createElement('div');
    container.className = 'message-reactions-container';
    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';
    container.style.gap = '4px';
    container.style.alignItems = 'center';

    // Show all reaction types inline; allow wrapping to next line when space runs out
    const types = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);

    types.forEach(type => {
        const users = grouped[type];
        const el = document.createElement('div');
        el.className = 'message-reaction';
        el.dataset.reaction = type;
        el.dataset.users = JSON.stringify(users);
        el.innerHTML = `
            <span class="reaction-icon">${type}</span>
            <span class="reaction-count">${users.length}</span>
        `;

        // compact style
        el.style.fontSize = '0.8rem';
        el.style.padding = '2px 6px';
        el.style.margin = '0';
        el.style.borderRadius = '10px';
        el.style.display = 'inline-flex';
        el.style.alignItems = 'center';
        el.style.gap = '4px';

        // Tooltip with up to 5 usernames
        el.title = users.map(u => u.username).slice(0, 5).join(', ');

        // click to toggle reaction for current user
        const messageDivEl = messageBubble.closest('.message');
        
        // click handler for desktop
        el.addEventListener('click', (e) => {
            // ignore touch-generated clicks
            if ('ontouchstart' in window) return;
            e.stopPropagation();
            e.preventDefault();
            toggleReaction(messageDivEl, messageId, el.dataset.reaction);
        });

        // جلوگیری از باز شدن context menu مرورگر
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        // long-press to view who reacted (1s)
        let longPressTimer = null;
        let longPressTriggered = false;
        
        const startLongPress = (e) => {
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();
            longPressTriggered = false;
            if (longPressTimer) clearTimeout(longPressTimer);
            longPressTimer = setTimeout(() => {
                longPressTriggered = true;
                showReactionUsers(messageId, el);
            }, 1000);
        };
        
        const cancelLongPress = (e) => {
            if (e) {
                e.stopPropagation();
                if (e.cancelable) e.preventDefault();
            }
            if (longPressTimer) { 
                clearTimeout(longPressTimer); 
                longPressTimer = null; 
            }
            
            // اگر long press trigger نشده بود، یعنی یک tap معمولی بوده
            // پس ریکشن رو toggle کن
            if (e && e.type === 'touchend' && !longPressTriggered) {
                toggleReaction(messageDivEl, messageId, el.dataset.reaction);
            }
            longPressTriggered = false;
        };

        el.addEventListener('mousedown', startLongPress);
        el.addEventListener('mouseup', cancelLongPress);
        el.addEventListener('mouseleave', cancelLongPress);
        el.addEventListener('touchstart', startLongPress, { passive: false });
        el.addEventListener('touchend', cancelLongPress, { passive: false });
        el.addEventListener('touchmove', (e) => {
            e.stopPropagation();
            if (longPressTimer) { 
                clearTimeout(longPressTimer); 
                longPressTimer = null; 
            }
        }, { passive: false });

        container.appendChild(el);
    });

    messageBubble.appendChild(container);
    // Replace flag emoji images inside reactions
    try {
        if (typeof parseEmojis !== 'undefined') {
            parseEmojis(container, { folder: 'svg', ext: '.svg' });
        }
    } catch (err) {
        console.error('parseEmojis on reactions failed', err);
    }
}

// نمایش یک مودال که همهٔ انواع ریکشن را با تعدادشان نشان می‌دهد
function showAllReactions(messageId, grouped) {
    const modal = document.createElement('div');
    modal.className = 'reaction-users-modal all-reactions-modal';
    modal.innerHTML = `
        <div class="reaction-users-content">
            <div class="reaction-users-header">
                <h3>همهٔ ریکشن‌ها</h3>
                <span class="close-modal" id="close-all-reactions-modal">✕</span>
            </div>
            <div class="reaction-types-list" id="reaction-types-list" style="max-height:60vh; overflow:auto;"></div>
        </div>
    `;

    document.body.appendChild(modal);

    const list = modal.querySelector('#reaction-types-list');
    Object.keys(grouped).forEach(type => {
        const users = grouped[type];
        const item = document.createElement('div');
        item.className = 'reaction-type-item';
        item.innerHTML = `
            <span class="reaction-icon">${type}</span>
            <span class="reaction-type-count">${users.length}</span>
            <span class="reaction-type-name">${type}</span>
        `;

        // replace flag emoji if needed
        try {
            if (typeof parseEmojis !== 'undefined') {
                parseEmojis(item, { folder: 'svg', ext: '.svg' });
            }
        } catch (err) {
            console.error('parseEmojis on reaction-type-item failed', err);
        }

        item.addEventListener('click', () => {
            // Build a temporary element that showReactionUsers can use
            const tmp = document.createElement('div');
            tmp.dataset.users = JSON.stringify(users);
            modal.remove();
            showReactionUsers(messageId, tmp);
        });

        list.appendChild(item);
    });

    const closeBtn = modal.querySelector('#close-all-reactions-modal');
    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}


