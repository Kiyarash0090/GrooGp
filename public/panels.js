// panels.js - مدیریت پنل‌های کاربری، اطلاعات گروه/کانال، و مودال‌های مرتبط

// نمایش مودال ارتقاء ادمین
function showUpgradeAdminModal(username) {
    const modal = document.getElementById('upgrade-admin-modal');
    const text = document.getElementById('upgrade-admin-text');
    if (text) {
        text.textContent = `آیا مطمئن هستید که می‌خواهید ${username} را به مدیر ارتقا دهید؟`;
    }
    if (modal) modal.style.display = 'flex';
}

// بستن مودال ارتقاء ادمین
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

// راه‌اندازی دکمه‌های confirm/cancel برای مودال ارتقاء
function initUpgradeAdminModal() {
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
}

// نمایش مودال اعضا (برای گروه عمومی)
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
        leaveGroupBtn.style.display = 'none';
    }

    let groupId = currentChat || 'global';

    if (groupId === 'global' && bannedFromGlobal) {
        alert('شما از گروه عمومی حذف شده‌اید');
        return;
    }

    if (groupId === 'global') {
        await checkGlobalAdminStatus();
    }

    if (!membersModal || !membersList) return;

    let settings = null;
    try {
        const res = await fetch(`/api/group-settings/${groupId}`);
        const d = await res.json();
        if (d.success && d.settings) settings = d.settings;
    } catch (err) {
        console.error('Error fetching group settings for', groupId, err);
    }

    const adminIds = settings && Array.isArray(settings.admins) ? settings.admins.slice() : [];
    let ownerId = settings && settings.owner_id ? settings.owner_id : null;
    const currentUserIsOwner = ownerId && currentUser.id === ownerId;
    if (!ownerId && settings && settings.group_id === 'global' && settings.admin_email === currentUser.email) {
        ownerId = currentUser.id;
    }
    if (ownerId && !adminIds.includes(ownerId)) {
        adminIds.push(ownerId);
    }
    if (settings && settings.group_id === 'global') {
        if (settings.admin_email && settings.admin_email === currentUser.email) {
            if (!adminIds.includes(currentUser.id)) adminIds.push(currentUser.id);
        }
    }
    let currentUserIsAdmin = adminIds.includes(currentUser.id) || (ownerId && currentUser.id === ownerId);
    if (groupId === 'global' && currentUser.isGlobalAdmin) {
        currentUserIsAdmin = true;
    }

    if (editGroupInfoBtn) {
        editGroupInfoBtn.style.display = currentUserIsAdmin ? 'flex' : 'none';
    }

    const bannedUsersSection = document.getElementById('banned-users-section');
    if (bannedUsersSection) {
        if (currentUserIsAdmin) {
            // show banned list for any group we administer (including global if we're a global admin)
            bannedUsersSection.style.display = 'block';
            bannedUsersSection.dataset.groupId = groupId;
            // figure out text label for type
            let groupTypeText = 'گروه';
            if (settings && settings.group_type === 'channel') {
                groupTypeText = 'کانال';
            }
            bannedUsersSection.dataset.groupType = groupTypeText;
        } else {
            bannedUsersSection.style.display = 'none';
            delete bannedUsersSection.dataset.groupId;
            delete bannedUsersSection.dataset.groupType;
        }
    }

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

    if (groupInfoName) {
        const nameText = settings && settings.group_name ? settings.group_name : 'گروه عمومی';
        groupInfoName.innerHTML = escapeHtml(`🌐 ${nameText}`);
        try {
            if (typeof parseEmojis !== 'undefined') {
                parseEmojis(groupInfoName, { folder: 'svg', ext: '.svg' });
            } else if (typeof replaceIranFlag !== 'undefined') {
                replaceIranFlag(groupInfoName);
            }
        } catch (err) {
            console.error('parseEmojis on groupInfoName failed', err);
        }
    }

    if (groupInfoUserid) {
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
        newUserid.innerHTML = `${escapeHtml(displayUserid)} <span class="copy-icon">📋</span>`;

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
                    newUserid.innerHTML = `${escapeHtml(displayUserid)} <span class="copy-icon">📋</span>`;
                }, 2000);
            } catch (err) {
                console.error('خطا در کپی کردن:', err);
                alert('خطا در کپی کردن آیدی');
            }
        });
    }

    if (groupInfoDescription) {
        if (settings && settings.description && settings.description.trim()) {
            groupInfoDescription.textContent = settings.description;
            try {
                if (typeof parseEmojis !== 'undefined') {
                    parseEmojis(groupInfoDescription, { folder: 'svg', ext: '.svg' });
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
        const uid = user.id != null ? user.id : user.userId;
        const isAdmin = uid != null && adminIds.includes(uid);
        const isOwner = ownerId && uid === ownerId;

        // avatar element (sanitized)
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

        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';
        userInfo.style.cursor = 'pointer';
        userInfo.dataset.username = user.username;

        const userNameDiv = document.createElement('div');
        userNameDiv.className = 'user-name';
        userNameDiv.textContent = user.username + (isCurrentUser ? ' (شما)' : '');
        userInfo.appendChild(userNameDiv);

        const statusDiv = document.createElement('div');
        statusDiv.className = 'user-status ' + statusClass;
        statusDiv.textContent = isOwner ? 'مالک' : (isAdmin ? 'ادمین' : statusText);
        userInfo.appendChild(statusDiv);

        userDiv.appendChild(userInfo);

        try {
            if (userNameDiv && typeof parseEmojis !== 'undefined') {
                parseEmojis(userNameDiv, { folder: 'svg', ext: '.svg' });
            }
        } catch (err) {
            console.error('emoji parsing in members list failed for', user.username, err);
        }

        if (userInfo && !isCurrentUser) {
            userInfo.addEventListener('click', () => {
                membersModal.style.display = 'none';
                showUserInfo(user.username);
            });
        }

        userDiv.dataset.userid = uid;
        userDiv.dataset.username = user.username;
        userDiv.dataset.isAdmin = isAdmin;
        userDiv.dataset.isOwner = isOwner;
        userDiv.dataset.isCurrentUser = isCurrentUser;

        if (!isCurrentUser && currentUserIsAdmin && !isOwner) {
            const handlePromo = (x, y) => {
                const statusDiv = userDiv.querySelector('.user-status');
                const alreadyAdmin = userDiv.dataset.isAdmin === 'true';
                const targetUid = uid;
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
async function showBannedUsersModal(groupId = null) {
    const bannedUsersModal = document.getElementById('banned-users-modal');
    const bannedUsersList = document.getElementById('banned-users-list');

    if (!bannedUsersModal || !bannedUsersList) return;

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
            bannedUsersList.innerHTML = '<div style="text-align: center; padding: 20px; color: #8b98a5;">هیچ کاربر حذف‌شده‌ای وجود ندارد</div>';
            bannedUsersModal.style.display = 'flex';
            return;
        }

        data.bannedUsers.forEach(user => {
            const userDiv = document.createElement('div');
            userDiv.className = 'member-item';

            let avatarHTML;
            if (user.profilePicture) {
                avatarHTML = `<div class="user-avatar" style="background-image: url("${user.profilePicture}"); background-size: cover; background-position: center;"></div>`;
            } else {
                const avatar = user.username.charAt(0).toUpperCase();
                avatarHTML = `<div class="user-avatar">${avatar}</div>`;
            }

            userDiv.innerHTML = `
                ${avatarHTML}
                <div class="user-info">
                    <div class="user-name">${user.username}</div>
                    <div class="user-status offline">حذف‌شده</div>
                </div>
                <button class="unban-user-btn" data-userid="${user.id}">
                    بازگردانی
                </button>
            `;

            const unbanBtn = userDiv.querySelector('.unban-user-btn');
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

// بازگردانی کاربر حذف‌شده
async function unbanUser(targetUserId, username, buttonElement, groupId = null) {
    if (!confirm(`آیا می‌خواهید ${username} را بازگردانی کنید؟`)) {
        return;
    }

    try {
        const userId = currentUser.id || currentUser.userId;

        if (!userId) {
            alert('خطا: کاربر لاگین نشده است');
            return;
        }

        if (!targetUserId) {
            alert('خطا: targetUserId تعریف نشده است');
            return;
        }

        if (!groupId) {
            groupId = 'global';
        }

        const endpoint = groupId === 'global' ? '/api/unban-user' : '/api/unban-user-from-group';
        const payload = groupId === 'global'
            ? { userId: parseInt(userId), targetUserId: parseInt(targetUserId) }
            : { groupId: groupId, userId: parseInt(userId), targetUserId: parseInt(targetUserId) };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!data.success) {
            alert(data.error || 'خطا در بازگردانی کاربر');
            return;
        }

        buttonElement.closest('.member-item').remove();
        showToast(`${username} بازگردانی شد`);

        const bannedUsersList = document.getElementById('banned-users-list');
        if (bannedUsersList.children.length === 0) {
            bannedUsersList.innerHTML = '<div style="text-align: center; padding: 20px; color: #8b98a5;">هیچ کاربر حذف‌شده‌ای وجود ندارد</div>';
        }
    } catch (error) {
        console.error('Error unbanning user:', error);
        alert('خطا در بازگردانی کاربر');
    }
}

// نمایش اطلاعات کاربر
async function showUserInfo(targetUsername) {
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
                        parseEmojis(userInfoName, { folder: 'svg', ext: '.svg' });
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

                const newUserid = userInfoUserid.cloneNode(true);
                if (userInfoUserid.parentNode) {
                    userInfoUserid.parentNode.replaceChild(newUserid, userInfoUserid);
                }

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
                                newUserid.innerHTML = `${escapeHtml(userid)} <span class="copy-icon">📋</span>`;
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

            if (userInfoBio) {
                if (data.user.bio && data.user.bio.trim()) {
                    userInfoBio.textContent = data.user.bio;
                    try {
                        if (typeof parseEmojis !== 'undefined') {
                            parseEmojis(userInfoBio, { folder: 'svg', ext: '.svg' });
                        } else if (typeof replaceIranFlag !== 'undefined') {
                            replaceIranFlag(userInfoBio);
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
        if (ownerId && !adminIds.includes(ownerId)) adminIds.push(ownerId);
        const isGroupAdmin = adminIds.includes(currentUser.id) || (ownerId && currentUser.id === ownerId);
        const currentUserIsAdmin = isGroupAdmin;
        const groupType = groupSettings.group_type === 'channel' ? 'کانال' : 'گروه';
        const groupIcon = groupSettings.group_type === 'channel' ? '📢' : '👥';

        const cleanName = groupSettings.group_name.replace(/^[🌐👥📢]\s*/, '');

        const editGroupInfoBtn = document.getElementById('edit-group-info-btn');
        if (editGroupInfoBtn) {
            editGroupInfoBtn.style.display = isGroupAdmin ? 'flex' : 'none';
        }

        const bannedUsersSection = document.getElementById('banned-users-section');
        if (bannedUsersSection) {
            if (groupId !== 'global' && isGroupAdmin) {
                bannedUsersSection.style.display = 'block';
                bannedUsersSection.dataset.groupId = groupId;
                bannedUsersSection.dataset.groupType = groupType;
            } else {
                bannedUsersSection.style.display = 'none';
            }
        }

        const leaveGroupBtn = document.getElementById('leave-group-btn');
        if (leaveGroupBtn) {
            if (groupId !== 'global') {
                leaveGroupBtn.style.display = 'flex';

                const newLeaveBtn = leaveGroupBtn.cloneNode(true);
                leaveGroupBtn.parentNode.replaceChild(newLeaveBtn, leaveGroupBtn);

                newLeaveBtn.addEventListener('click', () => {
                    showLeaveGroupModal(groupId, groupType, isGroupAdmin);
                });
            } else {
                leaveGroupBtn.style.display = 'none';
            }
        }

        if (groupInfoName) {
            groupInfoName.innerHTML = escapeHtml(`${groupIcon} ${cleanName}`);
            try {
                if (typeof parseEmojis !== 'undefined') parseEmojis(groupInfoName, { folder: 'svg', ext: '.svg' });
                else if (typeof replaceIranFlag !== 'undefined') replaceIranFlag(groupInfoName);
            } catch (err) {
                console.error('parseEmojis on groupInfoName failed', err);
            }
        }

        if (groupInfoDescription) {
            if (groupSettings.description && groupSettings.description.trim()) {
                groupInfoDescription.textContent = groupSettings.description;
                try {
                    if (typeof parseEmojis !== 'undefined') {
                        parseEmojis(groupInfoDescription, { folder: 'svg', ext: '.svg' });
                    } else if (typeof replaceIranFlag !== 'undefined') {
                        replaceIranFlag(groupInfoDescription);
                    }
                } catch (err) {
                    console.error('emoji rendering on groupInfoDescription failed', err);
                }
            }
        }

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

        if (groupInfoUserid) {
            const displayUserid = groupSettings.group_userid ? `@${groupSettings.group_userid}` : 'آیدی ثبت نشده';

            let newUserid = groupInfoUserid;
            const parent = groupInfoUserid.parentNode;
            if (parent) {
                newUserid = groupInfoUserid.cloneNode(true);
                parent.replaceChild(newUserid, groupInfoUserid);
            }

            newUserid.innerHTML = `${escapeHtml(displayUserid)} <span class="copy-icon">📋</span>`;

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

        try {
            const membersRes = await fetch(`/api/group-members/${groupId}`);
            const membersData = await membersRes.json();

            if (membersData.success && membersData.members) {
                const members = membersData.members;
                const onlineCount = members.filter(m => m.online).length;
                const totalCount = members.length;

                if (groupInfoMembersCount) {
                    groupInfoMembersCount.innerHTML = `
                        <span style="color: #4caf50;">${onlineCount} آنلاین</span>
                        <span style="color: #8b98a5;"> از ${totalCount} عضو</span>
                    `;
                }

                membersList.innerHTML = '';
                members.forEach(member => {
                    const isCurrentUser = member.id === currentUser.id;
                    const statusText = member.online ? 'آنلاین' : 'آفلاین';
                    const statusClass = member.online ? 'online' : 'offline';
                    const isAdmin = adminIds.includes(member.id);
                    const isOwner = ownerId && member.id === ownerId;

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

                    const userInfoDiv = memberDiv.querySelector('.user-info');
                    if (userInfoDiv && !isCurrentUser) {
                        userInfoDiv.addEventListener('click', () => {
                            membersModal.style.display = 'none';
                            showUserInfo(member.username);
                        });
                    }

                    if (!isCurrentUser && currentUserIsAdmin) {
                        memberDiv.dataset.userid = member.id;
                        memberDiv.dataset.username = member.username;
                        memberDiv.dataset.isAdmin = isAdmin;
                        memberDiv.dataset.isOwner = isOwner;
                        memberDiv.dataset.isCurrentUser = isCurrentUser;

                        if (!isCurrentUser && currentUserIsAdmin && !isOwner) {
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
                    }

                    membersList.appendChild(memberDiv);
                });

                // پردازش ایموجی‌ها در اسم کاربران
                try {
                    const userNames = membersList.querySelectorAll('.user-name');
                    userNames.forEach(nameElem => {
                        if (typeof parseEmojis !== 'undefined') {
                            parseEmojis(nameElem, { folder: 'svg', ext: '.svg' });
                        }
                    });
                } catch (err) {
                    console.error('parseEmojis on member names failed', err);
                }
            }
        } catch (error) {
            console.error('Error loading members:', error);
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
            currentUser.isGlobalAdmin = data.isAdmin || data.is_admin;
        }
    } catch (error) {
        console.error('Error checking admin status:', error);
        currentUser.isGlobalAdmin = false;
    }
}

// آپدیت تعداد پیام‌های جدید گروه
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

// آپدیت تعداد پیام‌های جدید گروه سفارشی
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

// آپدیت هدر گروه‌های سفارشی
async function updateCustomGroupHeader() {
    if (!currentChat || currentChat === 'global' || currentChat.startsWith('private_')) {
        return;
    }

    try {
        const membersResponse = await fetch(`/api/group-members/${currentChat}`);
        const membersData = await membersResponse.json();

        if (membersData.success && membersData.members) {
            const totalCount = membersData.members.length;

            const chatHeaderStatus = document.querySelector('.chat-header-status');
            if (chatHeaderStatus) {
                const groupType = currentGroupSettings ? currentGroupSettings.group_type : 'group';

                if (groupType === 'channel') {
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
            }
        }
    } catch (error) {
        console.error('Error updating custom group header:', error);
    }
}

// نمایش context menu اعضا
function showMemberContextMenu(x, y) {
    const contextMenu = document.getElementById('member-context-menu');
    if (!contextMenu) {
        console.warn('Member context menu element not found');
        return;
    }

    // determine which buttons should display
    const isAdmin = pendingUpgrade.isAdmin;
    const isOwner = pendingUpgrade.targetIsOwner;
    const isSelf = pendingUpgrade.targetUserId === currentUser.id;
    const groupId = pendingUpgrade.groupId;

    const promoteBtn = contextMenu.querySelector('[data-action="promote"]');
    const demoteBtn = contextMenu.querySelector('[data-action="demote"]');
    const banBtn = document.getElementById('member-context-menu-ban');

    if (promoteBtn) {
        promoteBtn.style.display = !isAdmin ? 'flex' : 'none';
    }
    if (demoteBtn) {
        demoteBtn.style.display = isAdmin ? 'flex' : 'none';
    }

    if (banBtn) {
        // ban is available for any non-self, non-owner
        let showBan = !isSelf && !isOwner;
        banBtn.style.display = showBan ? 'flex' : 'none';
    }

    // position menu
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.display = 'block';

    // make sure menu stays on screen
    requestAnimationFrame(() => {
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            contextMenu.style.left = (x - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            contextMenu.style.top = (y - rect.height) + 'px';
        }
    });
}

// نمایش مودال خروج از گروه
function showLeaveGroupModal(groupId, groupType, isAdmin) {
    const modal = document.getElementById('leave-group-modal');
    const text = document.getElementById('leave-group-text');
    const deleteCheckbox = document.getElementById('delete-group-checkbox');
    const deleteCheckboxContainer = document.getElementById('delete-group-checkbox-container');

    if (!modal) return;

    // تعیین متن پیام
    const actionText = isAdmin ? 'حذف' : 'خروج از';
    text.textContent = `آیا می‌خواهید ${actionText} این ${groupType} را انجام دهید؟`;

    // نمایش/مخفی option حذف
    if (deleteCheckboxContainer) {
        if (isAdmin) {
            deleteCheckboxContainer.style.display = 'block';
            deleteCheckboxContainer.textContent = `حذف کلی ${groupType}`;
        } else {
            deleteCheckboxContainer.style.display = 'none';
        }
    }

    // ذخیره groupId برای استفاده بعدی
    modal.dataset.groupId = groupId;
    modal.dataset.isAdmin = isAdmin;
    modal.dataset.groupType = groupType;

    modal.style.display = 'flex';
}

// بستن مودال خروج
function closeLeaveGroupModal() {
    const modal = document.getElementById('leave-group-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.removeAttribute('data-group-id');
    }
}

// بارگذاری گروه‌ها و کانال‌های کاربر
async function loadUserGroups() {
    try {
        const res = await fetch(`/api/user-groups/${currentUser.id}`);
        const data = await res.json();

        if (data.success && data.groups) {
            // بارگذاری گروه‌ها و آخرین پیام هر کدام
            for (const group of data.groups) {
                // اضافه کردن به sidebar
                if (!document.querySelector(`[data-chat="${group.group_id}"]`)) {
                    addGroupOrChannelToSidebar({
                        id: group.group_id,
                        name: group.group_name,
                        groupId: group.group_userid,
                        profilePicture: group.profile_picture
                    }, group.group_type);

                    // بارگذاری آخرین پیام گروه
                    try {
                        const messagesRes = await fetch(`/api/group-messages/${group.group_id}?limit=1`);
                        const messagesData = await messagesRes.json();

                        if (messagesData.success && messagesData.messages && messagesData.messages.length > 0) {
                            const lastMsg = messagesData.messages[0];
                            updateChatLastMessage(group.group_id, lastMsg.message, lastMsg.created_at);
                        }
                    } catch (error) {
                        console.error('خطا در بارگذاری آخرین پیام گروه:', error);
                    }

                    // بارگذاری تعداد پیام‌های جدید
                    updateCustomGroupUnreadBadge(group.group_id);
                }
            }

            // به‌روزرسانی لیست چت‌ها در صفحه خوش‌آمدگویی
            if (typeof updateWelcomeChats !== 'undefined') {
                updateWelcomeChats();
            }
        }
    } catch (error) {
        console.error('خطا در بارگذاری گروه‌ها:', error);
    }
}

// آپلود عکس پروفایل
async function handleProfilePictureUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // بررسی نوع فایل
    if (!file.type.startsWith('image/')) {
        alert('لطفا یک فایل تصویری انتخاب کنید');
        event.target.value = '';
        return;
    }

    // بررسی حجم فایل (حداکثر 10MB)
    if (file.size > 10 * 1024 * 1024) {
        alert('حجم فایل نباید بیشتر از 10 مگابایت باشد');
        event.target.value = '';
        return;
    }

    // نمایش loading
    const profileAvatar = document.getElementById('profile-avatar');
    const originalContent = profileAvatar.innerHTML;
    const originalBackground = profileAvatar.style.backgroundImage;

    // تبدیل به Base64
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64Image = e.target.result;

        // نمایش پیش‌نمایش فوری
        profileAvatar.style.backgroundImage = `url(${base64Image})`;
        profileAvatar.style.backgroundSize = 'cover';
        profileAvatar.style.backgroundPosition = 'center';
        profileAvatar.innerHTML = '';

        // اضافه کردن overlay loading
        const loadingOverlay = document.createElement('div');
        loadingOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 20px;
        `;
        loadingOverlay.textContent = '⏳';
        profileAvatar.parentElement.appendChild(loadingOverlay);

        try {
            const res = await fetch('/api/update-profile-picture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.id,
                    profilePicture: base64Image
                })
            });

            const data = await res.json();

            // حذف loading overlay
            loadingOverlay.remove();

            if (data.success) {
                currentUser.profile_picture = base64Image;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));

                // نمایش پیام موفقیت با انیمیشن
                const successMsg = document.createElement('div');
                successMsg.textContent = '✓ عکس پروفایل ذخیره شد';
                successMsg.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #4caf50;
                    color: white;
                    padding: 12px 20px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    z-index: 10000;
                    animation: slideIn 0.3s ease;
                    font-family: inherit;
                `;
                document.body.appendChild(successMsg);
                setTimeout(() => {
                    successMsg.style.animation = 'slideOut 0.3s ease';
                    setTimeout(() => successMsg.remove(), 300);
                }, 2000);
            } else {
                // بازگشت به حالت قبل در صورت خطا
                profileAvatar.innerHTML = originalContent;
                profileAvatar.style.backgroundImage = originalBackground;
                alert(data.error || 'خطا در ذخیره عکس پروفایل');
            }
        } catch (error) {
            // حذف loading overlay
            loadingOverlay.remove();
            // بازگشت به حالت قبل در صورت خطا
            profileAvatar.innerHTML = originalContent;
            profileAvatar.style.backgroundImage = originalBackground;
            console.error('Error:', error);
            alert('خطا در ارتباط با سرور');
        }
    };

    reader.onerror = () => {
        profileAvatar.innerHTML = originalContent;
        profileAvatar.style.backgroundImage = originalBackground;
        alert('خطا در خواندن فایل');
    };

    reader.readAsDataURL(file);

    // ریست کردن input برای امکان انتخاب مجدد همان فایل
    event.target.value = '';
}

// ساخت گروه جدید
let newGroupPicture = null; // ذخیره عکس گروه جدید

function resetGroupForm() {
    const nameEl = document.getElementById('group-name-input');
    const idEl = document.getElementById('group-id-input');
    const descEl = document.getElementById('group-description-input');
    if (nameEl) nameEl.innerHTML = '';
    if (idEl) idEl.innerHTML = '';
    if (descEl) descEl.innerHTML = '';

    const avatar = document.getElementById('new-group-avatar');
    if (avatar) {
        avatar.style.backgroundImage = 'none';
        avatar.textContent = 'گ';
    }

    newGroupPicture = null;
}

async function handleNewGroupPictureUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('لطفا یک فایل تصویری انتخاب کنید');
        event.target.value = '';
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        alert('حجم فایل نباید بیشتر از 10 مگابایت باشد');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        newGroupPicture = e.target.result;
        const avatar = document.getElementById('new-group-avatar');
        if (avatar) {
            avatar.style.backgroundImage = `url(${newGroupPicture})`;
            avatar.style.backgroundSize = 'cover';
            avatar.style.backgroundPosition = 'center';
            avatar.textContent = '';
        }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

async function createGroup() {
    const nameInput = document.getElementById('group-name-input');
    const idInput = document.getElementById('group-id-input');
    const descriptionInput = document.getElementById('group-description-input');
    const createGroupModal = document.getElementById('create-group-modal');
    const confirmBtn = document.getElementById('confirm-create-group-btn');

    // بررسی لاگین بودن کاربر
    if (!currentUser || !currentUser.id) {
        alert('لطفا ابتدا وارد حساب کاربری خود شوید');
        createGroupModal.style.display = 'none';
        return;
    }

    const name = getTextWithEmoji(nameInput).trim();
    const groupId = getTextWithEmoji(idInput).trim().toLowerCase();
    const description = getTextWithEmoji(descriptionInput).trim();

    if (!name) {
        alert('لطفا نام گروه را وارد کنید');
        return;
    }

    if (name.length < 3) {
        alert('نام گروه باید حداقل 3 کاراکتر باشد');
        return;
    }

    // بررسی فرمت آیدی
    if (groupId) {
        const idRegex = /^[a-z0-9_]+$/;
        if (!idRegex.test(groupId)) {
            alert('آیدی فقط باید شامل حروف انگلیسی کوچک، اعداد و _ باشد');
            return;
        }
        if (groupId.length < 3) {
            alert('آیدی باید حداقل 3 کاراکتر باشد');
            return;
        }
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'در حال ساخت...';

    try {
        const res = await fetch('/api/create-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                name: name,
                groupId: groupId || null,
                description: description,
                profilePicture: newGroupPicture
            })
        });

        const data = await res.json();

        if (data.success) {
            createGroupModal.style.display = 'none';
            resetGroupForm();

            // اضافه کردن گروه به sidebar
            addGroupOrChannelToSidebar(data.group, 'group');

            const successMsg = document.createElement('div');
            successMsg.textContent = '✓ گروه با موفقیت ساخته شد';
            successMsg.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #4caf50;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 10000;
                animation: slideIn 0.3s ease;
                font-family: inherit;
            `;
            document.body.appendChild(successMsg);
            setTimeout(() => {
                successMsg.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => successMsg.remove(), 300);
            }, 2000);
        } else {
            alert(data.error || 'خطا در ساخت گروه');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('خطا در ارتباط با سرور');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'ساخت گروه';
    }
}

// ساخت کانال جدید
let newChannelPicture = null; // ذخیره عکس کانال جدید

function resetChannelForm() {
    const nameEl = document.getElementById('channel-name-input');
    const idEl = document.getElementById('channel-id-input');
    const descEl = document.getElementById('channel-description-input');
    if (nameEl) nameEl.innerHTML = '';
    if (idEl) idEl.innerHTML = '';
    if (descEl) descEl.innerHTML = '';

    const avatar = document.getElementById('new-channel-avatar');
    if (avatar) {
        avatar.style.backgroundImage = 'none';
        avatar.textContent = 'ک';
    }

    newChannelPicture = null;
}

async function handleNewChannelPictureUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('لطفا یک فایل تصویری انتخاب کنید');
        event.target.value = '';
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        alert('حجم فایل نباید بیشتر از 10 مگابایت باشد');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        newChannelPicture = e.target.result;
        const avatar = document.getElementById('new-channel-avatar');
        if (avatar) {
            avatar.style.backgroundImage = `url(${newChannelPicture})`;
            avatar.style.backgroundSize = 'cover';
            avatar.style.backgroundPosition = 'center';
            avatar.textContent = '';
        }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

async function createChannel() {
    const nameInput = document.getElementById('channel-name-input');
    const idInput = document.getElementById('channel-id-input');
    const descriptionInput = document.getElementById('channel-description-input');
    const createChannelModal = document.getElementById('create-channel-modal');
    const confirmBtn = document.getElementById('confirm-create-channel-btn');

    // بررسی لاگین بودن کاربر
    if (!currentUser || !currentUser.id) {
        alert('لطفا ابتدا وارد حساب کاربری خود شوید');
        createChannelModal.style.display = 'none';
        return;
    }

    const name = getTextWithEmoji(nameInput).trim();
    const channelId = getTextWithEmoji(idInput).trim().toLowerCase();
    const description = getTextWithEmoji(descriptionInput).trim();

    if (!name) {
        alert('لطفا نام کانال را وارد کنید');
        return;
    }

    if (name.length < 3) {
        alert('نام کانال باید حداقل 3 کاراکتر باشد');
        return;
    }

    // بررسی فرمت آیدی
    if (channelId) {
        const idRegex = /^[a-z0-9_]+$/;
        if (!idRegex.test(channelId)) {
            alert('آیدی فقط باید شامل حروف انگلیسی کوچک، اعداد و _ باشد');
            return;
        }
        if (channelId.length < 3) {
            alert('آیدی باید حداقل 3 کاراکتر باشد');
            return;
        }
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'در حال ساخت...';

    try {
        const res = await fetch('/api/create-channel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                name: name,
                channelId: channelId || null,
                description: description,
                profilePicture: newChannelPicture
            })
        });

        const data = await res.json();

        if (data.success) {
            createChannelModal.style.display = 'none';
            resetChannelForm();

            // اضافه کردن کانال به sidebar
            addGroupOrChannelToSidebar(data.channel, 'channel');

            const successMsg = document.createElement('div');
            successMsg.textContent = '✓ کانال با موفقیت ساخته شد';
            successMsg.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #4caf50;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 10000;
                animation: slideIn 0.3s ease;
                font-family: inherit;
            `;
            document.body.appendChild(successMsg);
            setTimeout(() => {
                successMsg.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => successMsg.remove(), 300);
            }, 2000);
        } else {
            alert(data.error || 'خطا در ساخت کانال');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('خطا در ارتباط با سرور');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'ساخت کانال';
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
        const avatar = cleanName.charAt(0).toUpperCase();
        avatarHTML = `<div class="chat-avatar">${avatar}</div>`;
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

    try {
        const nameEl = chatItem.querySelector('.chat-name');
        if (nameEl) {
            if (typeof parseEmojis !== 'undefined') {
                parseEmojis(nameEl, { folder: 'svg', ext: '.svg' });
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
    if (typeof updateWelcomeChats !== 'undefined') {
        updateWelcomeChats();
    }
}
// آپلود پروفایل گروه
async function handleGroupProfileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // بررسی نوع فایل
    if (!file.type.startsWith('image/')) {
        alert('لطفا یک فایل تصویری انتخاب کنید');
        event.target.value = '';
        return;
    }

    // بررسی حجم فایل (حداکثر 10MB)
    if (file.size > 10 * 1024 * 1024) {
        alert('حجم فایل نباید بیشتر از 10 مگابایت باشد');
        event.target.value = '';
        return;
    }

    // تشخیص اینکه کدام گروه در حال ویرایش است
    const groupId = currentChat;
    let isAdmin = false;

    // بررسی دسترسی ادمین با کمک endpoint جدید
    if (groupId) {
        try {
            const resp = await fetch('/api/check-admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId, userId: currentUser.id })
            });
            const adminData = await resp.json();
            if (adminData.success) {
                isAdmin = adminData.isAdmin;
            }
        } catch (error) {
            console.error('Error checking admin status:', error);
        }
    }

    if (!isAdmin) {
        alert('فقط ادمین گروه می‌تواند پروفایل گروه را تغییر دهد');
        event.target.value = '';
        return;
    }

    // نمایش loading - تشخیص اینکه از کدام مودال استفاده می‌شود
    const editModalAvatar = document.getElementById('edit-group-avatar-display');
    const groupInfoAvatar = document.getElementById('group-info-avatar-display');
    const groupProfileAvatar = editModalAvatar || groupInfoAvatar;

    const originalContent = groupProfileAvatar ? groupProfileAvatar.innerHTML : '';
    const originalBackground = groupProfileAvatar ? groupProfileAvatar.style.backgroundImage : '';

    // تبدیل به Base64
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64Image = e.target.result;

        // نمایش پیش‌نمایش فوری
        if (groupProfileAvatar) {
            groupProfileAvatar.style.backgroundImage = `url(${base64Image})`;
            groupProfileAvatar.style.backgroundSize = 'cover';
            groupProfileAvatar.style.backgroundPosition = 'center';
            groupProfileAvatar.innerHTML = '';

            // اضافه کردن overlay loading
            const loadingOverlay = document.createElement('div');
            loadingOverlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 24px;
            `;
            loadingOverlay.textContent = '⏳';
            groupProfileAvatar.parentElement.appendChild(loadingOverlay);

            try {
                // تشخیص API endpoint بر اساس نوع گروه
                let apiEndpoint = '/api/update-group-profile';
                let requestBody = {
                    userId: currentUser.id,
                    profilePicture: base64Image
                };

                if (groupId !== 'global') {
                    // برای گروه‌های سفارشی
                    apiEndpoint = '/api/update-custom-group-profile';
                    requestBody.groupId = groupId;
                }

                // ارسال به سرور برای ذخیره‌سازی
                const res = await fetch(apiEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });

                const data = await res.json();

                // حذف loading overlay
                loadingOverlay.remove();

                if (data.success) {
                    // آپدیت آواتار گروه در هدر
                    const chatAvatar = document.querySelector('.chat-header-info .chat-avatar');
                    if (chatAvatar && currentChat === groupId) {
                        chatAvatar.style.backgroundImage = `url(${base64Image})`;
                        chatAvatar.style.backgroundSize = 'cover';
                        chatAvatar.style.backgroundPosition = 'center';
                        chatAvatar.textContent = '';
                    }

                    // آپدیت آواتار گروه در sidebar
                    const chatItemAvatar = document.querySelector(`[data-chat="${groupId}"] .chat-avatar`);
                    if (chatItemAvatar) {
                        chatItemAvatar.style.backgroundImage = `url(${base64Image})`;
                        chatItemAvatar.style.backgroundSize = 'cover';
                        chatItemAvatar.style.backgroundPosition = 'center';
                        chatItemAvatar.textContent = '';
                    }

                    // ذخیره در localStorage برای کش
                    if (groupId === 'global') {
                        localStorage.setItem('groupProfilePicture', base64Image);
                    }

                    // اطلاع‌رسانی به سایر کاربران از طریق WebSocket
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'group_profile_updated',
                            groupId: groupId,
                            profilePicture: base64Image
                        }));
                    }

                    // نمایش پیام موفقیت با انیمیشن
                    const successMsg = document.createElement('div');
                    successMsg.textContent = '✓ پروفایل گروه ذخیره شد';
                    successMsg.style.cssText = `
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        background: #4caf50;
                        color: white;
                        padding: 12px 20px;
                        border-radius: 8px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                        z-index: 10000;
                        animation: slideIn 0.3s ease;
                        font-family: inherit;
                    `;
                    document.body.appendChild(successMsg);
                    setTimeout(() => {
                        successMsg.style.animation = 'slideOut 0.3s ease';
                        setTimeout(() => successMsg.remove(), 300);
                    }, 2000);
                } else {
                    // بازگشت به حالت قبل در صورت خطا
                    if (groupProfileAvatar) {
                        groupProfileAvatar.innerHTML = originalContent;
                        groupProfileAvatar.style.backgroundImage = originalBackground;
                    }
                    alert(data.error || 'خطا در تغییر پروفایل گروه');
                }
            } catch (error) {
                // حذف loading overlay
                if (loadingOverlay && loadingOverlay.parentElement) {
                    loadingOverlay.remove();
                }
                // بازگشت به حالت قبل در صورت خطا
                if (groupProfileAvatar) {
                    groupProfileAvatar.innerHTML = originalContent;
                    groupProfileAvatar.style.backgroundImage = originalBackground;
                }
                console.error('Error:', error);
                alert('خطا در ارتباط با سرور');
            }
        }
    };

    reader.onerror = () => {
        if (groupProfileAvatar) {
            groupProfileAvatar.innerHTML = originalContent;
            groupProfileAvatar.style.backgroundImage = originalBackground;
        }
        alert('خطا در خواندن فایل');
    };

    reader.readAsDataURL(file);

    // ریست کردن input برای امکان انتخاب مجدد همان فایل
    event.target.value = '';
}
// باز کردن گروه یا کانال
async function openGroupOrChannel(groupId, groupName, type, profilePicture) {
    // افزودن وضعیت به تاریخچه برای دکمه برگشت گوشی
    if (!window.historyInitDone) {
        history.pushState({ appInit: true }, '');
        window.historyInitDone = true;
    }
    history.pushState({ canGoBack: true }, '');

    // غیرفعال کردن حالت انتخاب هنگام تغییر چت
    if (typeof isSelectionMode !== 'undefined' && isSelectionMode) {
        if (typeof disableSelectionMode !== 'undefined') disableSelectionMode();
    }

    console.log('Opening group/channel:', { groupId, groupName, type, profilePicture });

    // اگر قبلاً در همین گروه بودیم، فقط هدر را آپدیت کن و پیام‌ها را پاک نکن
    const wasInSameGroup = currentChat === groupId;

    currentChat = groupId;
    if (typeof saveChatState !== 'undefined') saveChatState(); // ذخیره وضعیت چت

    // بارگذاری تنظیمات گروه/کانال
    try {
        const settingsResponse = await fetch(`/api/group-settings/${groupId}?userId=${currentUser.id}`);
        const settingsData = await settingsResponse.json();

        if (settingsData.success && settingsData.settings) {
            currentGroupSettings = settingsData.settings;
        } else {
            // اگر تنظیمات یافت نشد، از اطلاعات موجود استفاده کن
            currentGroupSettings = {
                group_id: groupId,
                group_name: groupName,
                group_type: type,
                profile_picture: profilePicture,
                is_admin: false
            };
        }
    } catch (error) {
        console.error('Error loading group settings:', error);
        // در صورت خطا، از اطلاعات موجود استفاده کن
        currentGroupSettings = {
            group_id: groupId,
            group_name: groupName,
            group_type: type,
            profile_picture: profilePicture,
            is_admin: false
        };
    }

    // مخفی کردن صفحه خوش‌آمدگویی
    if (typeof hideWelcomeScreen !== 'undefined') hideWelcomeScreen();

    // فقط اگر از چت دیگری آمدیم، پیام‌ها را پاک کن
    if (!wasInSameGroup) {
        // پاک کردن پیام‌ها
        const messagesDiv = document.getElementById('messages');
        if (messagesDiv) {
            messagesDiv.innerHTML = '';
        }
    }

    // آپدیت هدر - استفاده از querySelector به جای getElementById
    const chatHeaderName = document.querySelector('.chat-header-name');
    const chatHeaderStatus = document.querySelector('.chat-header-status');
    const chatAvatar = document.querySelector('.chat-header-info .chat-avatar');
    const chatHeaderDetails = document.getElementById('chat-header-details');

    if (!chatHeaderName || !chatHeaderStatus || !chatAvatar) {
        console.error('Header elements not found!');
        return;
    }

    // حذف ایموجی از اول نام اگر وجود داشته باشه
    const cleanName = groupName.replace(/^[🌐👥📢]\s*/, '');

    const typeIcon = type === 'channel' ? '📢' : '👥';
    chatHeaderName.textContent = `${typeIcon} ${cleanName}`;

    try {
        if (typeof parseEmojis !== 'undefined') {
            parseEmojis(chatHeaderName, { folder: 'svg', ext: '.svg' });
        } else if (typeof replaceIranFlag !== 'undefined') {
            replaceIranFlag(chatHeaderName);
        }
    } catch (err) {
        console.error('parseEmojis on chatHeaderName failed', err);
    }

    // دریافت اعضای گروه برای نمایش تعداد
    try {
        const membersResponse = await fetch(`/api/group-members/${groupId}`);
        const membersData = await membersResponse.json();

        if (membersData.success && membersData.members) {
            const totalCount = membersData.members.length;

            if (type === 'channel') {
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
        } else {
            chatHeaderStatus.textContent = type === 'channel' ? 'کانال' : 'گروه';
        }
    } catch (error) {
        console.error('Error loading group members:', error);
        chatHeaderStatus.textContent = type === 'channel' ? 'کانال' : 'گروه';
    }

    // نمایش عکس پروفایل
    if (profilePicture) {
        chatAvatar.style.backgroundImage = `url(${profilePicture})`;
        chatAvatar.style.backgroundSize = 'cover';
        chatAvatar.style.backgroundPosition = 'center';
        chatAvatar.textContent = '';
    } else {
        chatAvatar.style.backgroundImage = 'none';
        chatAvatar.textContent = groupName.charAt(0).toUpperCase();
    }

    // تنظیم cursor برای نمایش اینکه قابل کلیک است
    if (chatHeaderDetails) {
        chatHeaderDetails.style.cursor = 'pointer';
        // تغییر listener برای گروه/کانال سفارشی
        chatHeaderDetails.onclick = () => {
            if (currentChat === 'global') {
                if (typeof showMembersModal !== 'undefined') showMembersModal();
            } else if (currentChat && (currentChat.startsWith('group_') || currentChat.startsWith('channel_'))) {
                if (typeof showCustomGroupInfo !== 'undefined') showCustomGroupInfo(currentChat);
            }
        };
    }

    // بررسی اینکه کاربر از این گروه/کانال محروم نشده باشد
    try {
        const banCheckResponse = await fetch('/api/check-group-ban', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId, userId: currentUser.id })
        });

        const banCheckData = await banCheckResponse.json();

        if (banCheckData.success && banCheckData.isBanned) {
            // کاربر محروم است
            alert('شما از این گروه/کانال محروم هستید');
            // بازگشت به گروه عمومی
            if (typeof switchToGlobalChat !== 'undefined') switchToGlobalChat();
            return;
        }
    } catch (error) {
        console.error('Error checking ban status:', error);
    }

    // بررسی عضویت کاربر
    try {
        const membershipResponse = await fetch('/api/check-membership', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId, userId: currentUser.id })
        });

        const membershipData = await membershipResponse.json();

        const messageInputArea = document.querySelector('.message-input-area');
        const joinGroupArea = document.getElementById('join-group-area');
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');

        if (membershipData.success && membershipData.isMember) {
            // کاربر عضو است
            if (joinGroupArea) joinGroupArea.style.display = 'none';

            // اگر کانال است، بررسی کن که ادمین هست یا نه
            if (type === 'channel') {
                const adminResponse = await fetch('/api/check-admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupId, userId: currentUser.id })
                });

                const adminData = await adminResponse.json();

                if (adminData.success && adminData.isAdmin) {
                    // ادمین است - نمایش کیبورد
                    if (messageInputArea) messageInputArea.style.display = 'flex';
                    if (messageInput) {
                        messageInput.setAttribute('contenteditable', 'true');
                        messageInput.setAttribute('data-placeholder', 'پیام خود را بنویسید...');
                        messageInput.focus();
                    }
                    if (sendBtn) sendBtn.disabled = false;
                } else {
                    // ادمین نیست - مخفی کردن کیبورد
                    if (messageInputArea) messageInputArea.style.display = 'none';
                }
            } else {
                // گروه است - همه می‌تونن پیام بفرستن
                if (messageInputArea) messageInputArea.style.display = 'flex';
                if (messageInput) {
                    messageInput.setAttribute('contenteditable', 'true');
                    messageInput.setAttribute('data-placeholder', 'پیام خود را بنویسید...');
                    messageInput.focus();
                }
                if (sendBtn) sendBtn.disabled = false;
            }

            // بارگذاری پیام‌های گروه/کانال از سرور - فقط اگر از چت دیگری آمدیم
            if (!wasInSameGroup && typeof ws !== 'undefined' && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'load_group_history',
                    groupId: groupId
                }));
            }
        } else {
            // کاربر عضو نیست - ابتدا بررسی محرومیت انجام می‌دهیم
            try {
                const banResponse = await fetch('/api/check-group-ban', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groupId, userId: currentUser.id })
                });
                const banData = await banResponse.json();
                if (banData.success && banData.isBanned) {
                    // محرومیت - هشدار بده و دکمه پیوستن را نشان نده
                    alert('شما از این گروه/کانال محروم هستید');
                    if (messageInputArea) messageInputArea.style.display = 'none';
                    if (joinGroupArea) joinGroupArea.style.display = 'none';
                    return;
                }
            } catch (err) {
                console.error('Error checking group ban:', err);
            }

            if (messageInputArea) messageInputArea.style.display = 'none';
            if (joinGroupArea) {
                joinGroupArea.style.display = 'flex';

                // ذخیره اطلاعات گروه برای استفاده در join
                joinGroupArea.dataset.groupId = groupId;
                joinGroupArea.dataset.groupName = groupName;
                joinGroupArea.dataset.groupType = type;
                joinGroupArea.dataset.profilePicture = profilePicture || '';
            }
        }
    } catch (error) {
        console.error('Error checking membership:', error);
        // در صورت خطا، به صورت پیش‌فرض کیبورد را نمایش بده
        const messageInputArea = document.querySelector('.message-input-area');
        const joinGroupArea = document.getElementById('join-group-area');
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');

        if (messageInputArea) messageInputArea.style.display = 'flex';
        if (joinGroupArea) joinGroupArea.style.display = 'none';
        if (messageInput) messageInput.setAttribute('contenteditable', 'true');
        if (sendBtn) sendBtn.disabled = false;
    }

    // حذف active از چت‌های دیگر
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });

    // اضافه کردن active به چت فعلی
    const currentChatItem = document.querySelector(`[data-chat="${groupId}"]`);
    if (currentChatItem) {
        currentChatItem.classList.add('active');
    }
}

// حذف گروه یا کانال (فقط برای کاربر فعلی)
async function deleteGroupOrChannel(groupId, groupType) {
    try {
        const response = await fetch('/api/leave-group', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: currentUser.id,
                groupId: groupId
            })
        });

        const data = await response.json();

        if (data.success) {
            // حذف از لیست
            const chatItem = document.querySelector(`[data-chat="${groupId}"]`);
            if (chatItem) {
                chatItem.remove();
            }

            // اگر در همین چت بودیم، به گروه عمومی برگردیم
            if (currentChat === groupId) {
                if (typeof switchToGlobalChat !== 'undefined') switchToGlobalChat();
            }

            if (typeof showToast !== 'undefined') {
                showToast(`${groupType === 'channel' ? 'کانال' : 'گروه'} از لیست شما حذف شد`);
            }
        } else {
            alert(data.error || 'خطا در حذف');
        }
    } catch (error) {
        console.error('Error deleting group/channel:', error);
        alert('خطا در ارتباط با سرور');
    }
}

// خروج از گروه/کانال (از صفحه اطلاعات)
async function leaveGroupAction(groupId, groupType) {
    try {
        const response = await fetch('/api/leave-group', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: currentUser.id,
                groupId: groupId
            })
        });

        const data = await response.json();

        if (data.success) {
            // show system message for groups
            if (groupType !== 'کانال') {
                if (typeof addSystemMessage !== 'undefined') addSystemMessage('شما از گروه خارج شدید');
            }
            // بستن مودال
            const membersModal = document.getElementById('members-modal');
            if (membersModal) {
                membersModal.style.display = 'none';
            }

            // حذف از لیست
            const chatItem = document.querySelector(`[data-chat="${groupId}"]`);
            if (chatItem) {
                chatItem.remove();
            }

            // اگر در همین چت بودیم، به گروه عمومی برگردیم
            if (currentChat === groupId) {
                if (typeof switchToGlobalChat !== 'undefined') switchToGlobalChat();
            }

            if (typeof showToast !== 'undefined') {
                showToast(`با موفقیت از ${groupType} خارج شدید`);
            }
        } else {
            alert(data.error || 'خطا در خروج');
        }
    } catch (error) {
        console.error('Error leaving group:', error);
        alert('خطا در ارتباط با سرور');
    }
}

// حذف گروه/کانال برای همه (فقط ادمین)
async function deleteGroupForEveryone(groupId, groupType) {
    try {
        const response = await fetch('/api/delete-group', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: currentUser.id,
                groupId: groupId
            })
        });

        const data = await response.json();

        if (data.success) {
            // بستن مودال
            const membersModal = document.getElementById('members-modal');
            if (membersModal) {
                membersModal.style.display = 'none';
            }

            // حذف از لیست
            const chatItem = document.querySelector(`[data-chat="${groupId}"]`);
            if (chatItem) {
                chatItem.remove();
            }

            // اگر در همین چت بودیم، به گروه عمومی برگردیم
            if (currentChat === groupId) {
                if (typeof switchToGlobalChat !== 'undefined') switchToGlobalChat();
            }

            if (typeof showToast !== 'undefined') {
                showToast(`${groupType} برای همه حذف شد`);
            }
        } else {
            alert(data.error || 'خطا در حذف');
        }
    } catch (error) {
        console.error('Error deleting group for everyone:', error);
        alert('خطا در ارتباط با سرور');
    }
}

// راه‌اندازی مودال حذف چت
function setupDeleteChatModal() {
    const modal = document.getElementById('delete-chat-modal');
    const closeBtn = document.getElementById('close-delete-chat-modal');
    const confirmBtn = document.getElementById('confirm-delete-chat');
    const cancelBtn = document.getElementById('cancel-delete-chat');
    const deleteForBothCheckbox = document.getElementById('delete-for-both');

    if (!modal || !closeBtn || !confirmBtn || !cancelBtn) return;

    // بستن مودال
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    cancelBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // کلیک خارج از مودال
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // تأیید حذف چت
    confirmBtn.addEventListener('click', async () => {
        const targetUsername = modal.dataset.targetUsername;
        const deleteForBoth = deleteForBothCheckbox ? deleteForBothCheckbox.checked : false;

        if (!targetUsername) return;

        try {
            const res = await fetch('/api/delete-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.id,
                    targetUser: targetUsername,
                    deleteForBoth: deleteForBoth
                })
            });

            const data = await res.json();

            if (data.success) {
                modal.style.display = 'none';

                // حذف از لیست
                const chatItem = document.querySelector(`[data-chat="${targetUsername}"]`);
                if (chatItem) {
                    chatItem.remove();
                }

                // اگر در همین چت بودیم، به گروه عمومی برگردیم
                if (currentChat === targetUsername) {
                    if (typeof switchToGlobalChat !== 'undefined') switchToGlobalChat();
                }

                if (deleteForBoth) {
                    if (typeof addSystemMessage !== 'undefined') {
                        addSystemMessage('گفتگو برای هر دو طرف حذف شد');
                    }
                } else {
                    if (typeof addSystemMessage !== 'undefined') {
                        addSystemMessage('گفتگو حذف شد');
                    }
                }
            } else {
                alert(data.error || 'خطا در حذف گفتگو');
            }
        } catch (error) {
            console.error('Error deleting chat:', error);
            alert('خطا در حذف گفتگو');
        }
    });
}

// نمایش مودال حذف چت
function showDeleteChatModal(targetUsername) {
    const modal = document.getElementById('delete-chat-modal');
    const deleteForBothCheckbox = document.getElementById('delete-for-both');

    if (!modal) return;

    // ریست کردن checkbox
    if (deleteForBothCheckbox) deleteForBothCheckbox.checked = false;

    // ذخیره username برای استفاده در تأیید
    modal.dataset.targetUsername = targetUsername;

    modal.style.display = 'flex';
}

// نمایش مودال خروج از گروه (اصلاح شده برای استفاده از showLeaveGroupModal موجود)
function showLeaveGroupModalAction(groupId, groupType, isAdmin) {
    showLeaveGroupModal(groupId, groupType, isAdmin);
}

