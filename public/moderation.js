// moderation.js - مدیریت محروم کردن و بازگردانی کاربران

// متغیر سراسری برای ذخیره اطلاعات منوی کلیک راست
let pendingUpgrade = {
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

// نمایش منوی کلیک راست برای کاربران عضو
function showMemberContextMenu(x, y) {
    const menu = document.getElementById('member-context-menu');
    if (!menu) return;
    
    // اطلاع دادن به سیستم کلیک راست که در حال باز شدن است تا
    // منوهای دیگر بلافاصله بسته نشوند
    if (window.setContextMenuOpening) window.setContextMenuOpening();

    // تنظیم متن دکمه بر اساس وضعیت فعلی
    const addBtn = document.getElementById('member-context-menu-add');
    const banBtn = document.getElementById('member-context-menu-ban');
    
    if (addBtn) {
        if (pendingUpgrade.isAdmin) {
            addBtn.textContent = 'حذف از مدیر';
        } else {
            addBtn.textContent = 'افزودن به مدیر';
        }
    }

    // determine whether ban button should show
    let showBan = false;
    if (banBtn) {
        if (pendingUpgrade.targetUserId !== currentUser.id && !pendingUpgrade.targetIsOwner) {
            showBan = true;
        }
        banBtn.style.display = showBan ? 'flex' : 'none';
    }

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';

    // بررسی اینکه منو از صفحه خارج نشود
    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (x - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (y - rect.height) + 'px';
        }
    });
}

// راه‌اندازی Member Context Menu
function setupMemberContextMenu() {
    const menu = document.getElementById('member-context-menu');
    const addBtn = document.getElementById('member-context-menu-add');
    const banBtn = document.getElementById('member-context-menu-ban');
    
    if (!menu || !addBtn || !banBtn) return;

    // بستن منو با کلیک در جای دیگر
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) {
            menu.style.display = 'none';
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
    });

    // دکمه افزودن/حذف مدیر
    addBtn.addEventListener('click', async () => {
        const { groupId, targetUserId, statusElem, groupType, isAdmin, menuTarget } = pendingUpgrade;
        console.log('context menu addBtn clicked', { groupId, targetUserId, isAdmin });
        
        if (groupId && targetUserId) {
            let result;
            if (isAdmin) {
                result = await removeGroupAdmin(groupId, targetUserId);
            } else {
                result = await makeGroupAdmin(groupId, targetUserId);
            }
            
            console.log('member action result', { groupId, targetUserId, isAdmin, result });
            
            if (result.success) {
                alert(isAdmin ? 'کاربر از مدیر حذف شد' : 'کاربر به مدیر تبدیل شد');
                
                if (isAdmin) {
                    if (menuTarget) menuTarget.dataset.isAdmin = 'false';
                    if (statusElem) {
                        const wasOnline = statusElem.classList.contains('online');
                        statusElem.textContent = wasOnline ? 'آنلاین' : 'آفلاین';
                    }
                    addBtn.textContent = 'افزودن به مدیر';
                    pendingUpgrade.isAdmin = false;
                } else {
                    if (menuTarget) menuTarget.dataset.isAdmin = 'true';
                    if (statusElem) statusElem.textContent = `ادمین${groupType ? ' ' + groupType : ''}`;
                    addBtn.textContent = 'حذف از مدیر';
                    pendingUpgrade.isAdmin = true;
                }
            } else {
                alert(result.error || (isAdmin ? 'خطا در حذف ادمین' : 'خطا در افزودن ادمین'));
            }
        } else {
            console.warn('addBtn click had missing groupId or targetUserId', { groupId, targetUserId });
        }
        
        // بستن منو اگر از مدیر حذف شد
        if (isAdmin) {
            menu.style.display = 'none';
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
    });
    
    // دکمه محروم کردن
    banBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        let { groupId, targetUserId, targetUsername, menuTarget } = pendingUpgrade;
        menu.style.display = 'none';

        if (!groupId) return;
        const confirmBan = confirm(`آیا مطمئن هستید که می‌خواهید ${targetUsername} را محروم کنید؟`);
        if (!confirmBan) return;

        try {
            // resolve id if missing
            if (!targetUserId) {
                try {
                    const res = await fetch(`/api/search-user?query=${encodeURIComponent(targetUsername)}`);
                    const data = await res.json();
                    if (data.success && data.user && data.user.id) {
                        targetUserId = data.user.id;
                    }
                } catch (err) {
                    console.warn('lookup for ban failed', err);
                }
            }
            if (!targetUserId) {
                alert('شناسه کاربر یافت نشد.');
                return;
            }

            const endpoint = '/api/ban-user-from-group';
            const payload = { groupId, userId: currentUser.id, targetUserId };

            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await resp.json();
            if (result.success) {
                alert('کاربر محروم شد');
                // اگر مودال کاربران محروم باز است و مربوط به همین گروه است، بازطراحی کن
                const bannedModalElem = document.getElementById('banned-users-modal');
                if (bannedModalElem && bannedModalElem.style.display === 'flex') {
                    // reload list for our current group (global in this path)
                    showBannedUsersModal(groupId);
                }
                // drop from UI similar to remove
                if (menuTarget && menuTarget.parentNode) {
                    menuTarget.parentNode.removeChild(menuTarget);
                    const countElem = document.getElementById('group-info-members-count');
                    if (countElem) {
                        // reuse removal update code
                        const text = countElem.textContent || '';
                        const match = text.match(/(\d+) آنلاین.*از (\d+) عضو/);
                        if (match) {
                            let online = parseInt(match[1], 10);
                            let total = parseInt(match[2], 10);
                            total = Math.max(0, total - 1);
                            // we don't know statusEl easily; just recalc later if needed
                            countElem.innerHTML = `<span style="color: #4caf50;">${online} آنلاین</span> <span style="color: #8b98a5;"> از ${total} عضو</span>`;
                        }
                    }
                }
            } else {
                alert(result.error || 'خطا در محروم کردن کاربر');
            }
        } catch (err) {
            console.error('ban user error', err);
            alert('خطا در ارتباط با سرور');
        }

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
    });
}

// نمایش لیست کاربران محروم شده
async function showBannedUsersModal(groupId = null) {
    const bannedUsersModal = document.getElementById('banned-users-modal');
    const bannedUsersList = document.getElementById('banned-users-list');

    if (!bannedUsersModal || !bannedUsersList) return;

    // اگر groupId داده نشده، از global استفاده کن
    if (!groupId) {
        groupId = 'global';
    }

    try {
        const userId = currentUser.id || currentUser.userId;

        if (!userId) {
            alert('خطا: کاربر لاگین نشده است');
            return;
        }

        const endpoint = groupId === 'global' ? '/api/get-banned-users' : '/api/get-group-banned-users';
        const payload = groupId === 'global'
            ? { userId: parseInt(userId) }
            : { groupId: groupId, userId: parseInt(userId) };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!data.success) {
            alert(data.error || 'خطا در بارگذاری لیست کاربران حذف‌شده');
            return;
        }

        bannedUsersList.innerHTML = '';

        if (data.bannedUsers.length === 0) {
            const noneDiv = document.createElement('div');
            noneDiv.style.textAlign = 'center';
            noneDiv.style.padding = '20px';
            noneDiv.style.color = '#8b98a5';
            noneDiv.textContent = 'هیچ کاربر حذف‌شده‌ای وجود ندارد';
            bannedUsersList.appendChild(noneDiv);
            bannedUsersModal.style.display = 'flex';
            return;
        }

        data.bannedUsers.forEach(user => {
            const userDiv = document.createElement('div');
            userDiv.className = 'member-item';

            const avatarElem = document.createElement('div');
            avatarElem.className = 'user-avatar';
            if (user.profilePicture) {
                avatarElem.style.backgroundImage = `url("${encodeURI(user.profilePicture)}")`;
                avatarElem.style.backgroundSize = 'cover';
                avatarElem.style.backgroundPosition = 'center';
            } else {
                avatarElem.textContent = user.username.charAt(0).toUpperCase();
            }
            userDiv.appendChild(avatarElem);

            const infoDiv = document.createElement('div');
            infoDiv.className = 'user-info';
            const nameDiv = document.createElement('div');
            nameDiv.className = 'user-name';
            nameDiv.textContent = user.username;
            infoDiv.appendChild(nameDiv);
            const statusDiv = document.createElement('div');
            statusDiv.className = 'user-status offline';
            statusDiv.textContent = 'حذف‌شده';
            infoDiv.appendChild(statusDiv);
            userDiv.appendChild(infoDiv);

            const unbanBtn = document.createElement('button');
            unbanBtn.className = 'unban-user-btn';
            unbanBtn.dataset.userid = user.id;
            unbanBtn.textContent = 'بازگردانی';
            userDiv.appendChild(unbanBtn);

            const userId = user.id || user.user_id;
            unbanBtn.addEventListener('click', async () => {
                await unbanUser(userId, user.username, unbanBtn, groupId);
            });

            bannedUsersList.appendChild(userDiv);
        });

        bannedUsersModal.style.display = 'flex';
    } catch (error) {
        console.error('Error loading banned users:', error);
        alert('خطا در بارگذاری لیست کاربران حذف‌شده');
    }
}

// بازگردانی کاربر محروم شده
async function unbanUser(targetUserId, username, buttonElement, groupId = null) {
    if (!confirm(`آیا می‌خواهید ${username} را بازگردانی کنید؟`)) {
        return;
    }
    
    try {
        const userId = currentUser.id || currentUser.userId;
        
        console.log('Current user:', currentUser);
        console.log('userId:', userId);
        console.log('targetUserId:', targetUserId);
        console.log('groupId:', groupId);
        
        if (!userId) {
            alert('خطا: کاربر لاگین نشده است');
            return;
        }
        
        if (!targetUserId) {
            alert('خطا: targetUserId تعریف نشده است');
            return;
        }
        
        // اگر groupId داده نشده، از global استفاده کن
        if (!groupId) {
            groupId = 'global';
        }
        
        const endpoint = groupId === 'global' ? '/api/unban-user' : '/api/unban-user-from-group';
        const payload = groupId === 'global'
            ? { userId: parseInt(userId), targetUserId: parseInt(targetUserId) }
            : { groupId: groupId, userId: parseInt(userId), targetUserId: parseInt(targetUserId) };
        
        console.log('Unban payload:', payload);
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        console.log('Unban response:', data);
        
        if (!data.success) {
            alert(data.error || 'خطا در بازگردانی کاربر');
            return;
        }
        
        // حذف کاربر از لیست
        buttonElement.closest('.member-item').remove();
        showToast(`${username} بازگردانی شد`);
        
        // اگر لیست خالی شد، پیام خالی نشان بده
        const bannedUsersList = document.getElementById('banned-users-list');
        if (bannedUsersList.children.length === 0) {
            bannedUsersList.innerHTML = '<div style="text-align: center; padding: 20px; color: #8b98a5;">هیچ کاربر حذف‌شده‌ای وجود ندارد</div>';
        }
    } catch (error) {
        console.error('Error unbanning user:', error);
        alert('خطا در بازگردانی کاربر');
    }
}
