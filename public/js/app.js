// =======================================================
// EDUPULSE - SECURE STUDENT PORTAL JAVASCRIPT
// =======================================================

const state = {
  currentStudent: null,
  isFacultyPreview: false,
  activeTab: 'dashboard',
  activeChannel: 'announcements',
  channels: [],
  chatUsers: { students: [], admins: [] },
  onlineUserIds: [],
  messages: [],
  attendance: null,
  holidays: [],
  ptm: null,
  exams: null,
  announcements: [],
  chatCooldownUntil: 0,
  chatCooldownTimer: null,
  reportingMessageId: null
};

let pushServiceWorkerRegistration = null;

function getPushServiceWorkerRegistration() {
  if (!pushServiceWorkerRegistration) {
    pushServiceWorkerRegistration = navigator.serviceWorker.register('/service-worker.js');
  }
  return pushServiceWorkerRegistration;
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

function setPushNotificationStatus(message) {
  const status = document.getElementById('pushNotificationStatus');
  if (status) status.textContent = message;
}

async function updatePushNotificationControl() {
  const card = document.getElementById('pushNotificationCard');
  const button = document.getElementById('pushNotificationButton');
  if (!card || !button) return;

  button.hidden = false;
  card.hidden = !state.currentStudent ||
    state.isFacultyPreview ||
    ('Notification' in window && Notification.permission === 'granted');
  if (card.hidden) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    button.disabled = true;
    button.innerHTML = '<i data-lucide="bell-off"></i><span>Not supported</span>';
    setPushNotificationStatus('Phone push notifications are not supported by this browser.');
    renderIcons();
    return;
  }

  if (Notification.permission === 'denied') {
    button.disabled = true;
    button.innerHTML = '<i data-lucide="bell-off"></i><span>Notifications blocked</span>';
    setPushNotificationStatus('Notifications are blocked in browser settings. Allow them there to enable school alerts.');
    renderIcons();
    return;
  }

  try {
    const registration = await getPushServiceWorkerRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const response = await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': state.currentStudent.id
        },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not sync notification settings');
    }
    button.disabled = false;
    button.innerHTML = '<i data-lucide="bell"></i><span>Enable notifications</span>';
    setPushNotificationStatus('Get important school notices on this phone, even when the portal is closed.');
    renderIcons();
  } catch (error) {
    console.error('Could not initialize phone notifications:', error);
    button.disabled = true;
    setPushNotificationStatus('Could not set up notifications. Please reload the portal and try again.');
  }
}

async function togglePushNotifications() {
  if (!state.currentStudent || state.isFacultyPreview) return;
  const button = document.getElementById('pushNotificationButton');
  if (button) button.disabled = true;

  try {
    const registration = await getPushServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const response = await fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': state.currentStudent.id
        },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not turn off notifications');
      await subscription.unsubscribe();
      showToast('School notifications turned off for this phone.', 'info');
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Allow notifications in your browser to receive school alerts.');

      const keyResponse = await fetch('/api/push/public-key');
      const keyData = await keyResponse.json();
      if (!keyResponse.ok || !keyData.publicKey) throw new Error(keyData.error || 'Could not configure notifications');
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
      });

      const response = await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': state.currentStudent.id
        },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      const result = await response.json();
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error(result.error || 'Could not save notification settings');
      }
      showToast('School notifications enabled on this phone.', 'success');
    }
  } catch (error) {
    console.error('Phone notification settings failed:', error);
    showToast(error.message || 'Could not update notification settings.', 'error');
  } finally {
    await updatePushNotificationControl();
  }
}

// ================= THEME CHANGER =================
function initTheme() {
  const savedTheme = localStorage.getItem('edupulse_theme') || 'light';
  applyTheme(savedTheme);

  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage.setItem('edupulse_theme', next);
      showToast(`Switched to ${next === 'dark' ? 'Dark 🌙' : 'Light ☀️'} theme`, 'info');
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  const text = document.getElementById('themeText');
  if (icon && text) {
    if (theme === 'dark') {
      icon.setAttribute('data-lucide', 'sun');
      text.textContent = 'Light';
    } else {
      icon.setAttribute('data-lucide', 'moon');
      text.textContent = 'Dark';
    }
    renderIcons();
  }
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Quick demo fill for student login
window.fillStudentDemo = function() {
  document.getElementById('loginIdentifier').value = '10A-01';
  document.getElementById('loginPassword').value = 'password123';
};

// Switch between Login and Register tabs on Auth Screen
window.switchAuthTab = function(mode) {
  const loginBtn = document.getElementById('tabBtnLogin');
  const regBtn = document.getElementById('tabBtnRegister');
  const loginForm = document.getElementById('studentLoginForm');
  const regForm = document.getElementById('studentRegisterForm');

  if (mode === 'login') {
    loginBtn.classList.add('active');
    regBtn.classList.remove('active');
    loginForm.style.display = 'flex';
    regForm.style.display = 'none';
  } else {
    loginBtn.classList.remove('active');
    regBtn.classList.add('active');
    loginForm.style.display = 'none';
    regForm.style.display = 'flex';
  }
  renderIcons();
};

// ================= REAL-TIME SOCKET.IO =================
let socket = null;
try {
  socket = io();

  socket.on('connect', () => {
    if (state.activeChannel) {
      socket.emit('join_channel', state.activeChannel);
    }
    syncStudentPresence();
  });

  socket.on('presence_update', ({ onlineUserIds = [] } = {}) => {
    state.onlineUserIds = onlineUserIds;
    renderOnlineUsers(state.chatUsers.students, state.chatUsers.admins);
  });

  socket.on('students_updated', ({ students = [] } = {}) => {
    state.chatUsers.students = students;
    const updatedStudent = students.find(student => student.id === state.currentStudent?.id);
    if (updatedStudent) {
      state.currentStudent = { ...state.currentStudent, avatar: updatedStudent.avatar };
      updateStudentUI();
    }
    renderOnlineUsers(state.chatUsers.students, state.chatUsers.admins);
    if (state.activeTab === 'chat') renderChatMessages();
  });

  socket.on('new_message', (msg) => {
    if (msg.channelId === 'math-doubts' && state.currentStudent && msg.senderId === state.currentStudent.id && msg.cooldownUntil) {
      startChatCooldown(msg.cooldownUntil);
    }
    if (msg.channelId === state.activeChannel) {
      if (!state.messages.some(message => message.id === msg.id)) state.messages.push(msg);
      appendChatMessage(msg);
      scrollToBottom();
    }
    if (state.activeTab !== 'chat') {
      const badge = document.getElementById('chatBadge');
      if (badge) badge.textContent = parseInt(badge.textContent || 0) + 1;
    }
  });

  socket.on('message_deleted', ({ messageId, channelId }) => {
    removeChatMessage(messageId, channelId);
  });

  socket.on('message_updated', (message) => {
    applyUpdatedChatMessage(message);
  });

  socket.on('message_rejected', ({ error, cooldownUntil }) => {
    if (cooldownUntil) startChatCooldown(cooldownUntil);
    showToast(error || 'You cannot post in this channel.', 'error');
  });

  socket.on('chat_cleared', ({ channelId }) => {
    if (channelId === state.activeChannel) {
      state.messages = [];
      renderChatMessages();
    }
  });

  socket.on('syllabus_updated', (exams) => {
    state.exams = exams;
    renderExamsUI();
  });

  socket.on('new_announcement', (notice) => {
    state.announcements.unshift(notice);
    renderDashboardNotices();
    showToast(`📢 New School Notice: ${notice.title}`, 'info');
  });

  socket.on('leave_updated', (data) => {
    if (state.attendance) {
      state.attendance.leaveRequests = data.leaves;
      renderAttendanceUI();
    }
  });

  socket.on('attendance_updated', (att) => {
    state.attendance = att;
    renderAttendanceUI();
  });

  socket.on('ptm_updated', (ptmData) => {
    state.ptm = ptmData;
    renderPTMUI();
  });

  socket.on('holidays_updated', (data) => {
    state.holidays = data.holidays || [];
    renderHolidaysUI();
    calculateHolidayCountdown();
  });

} catch (e) {
  console.warn('Socket note:', e);
}

// ================= DOM INITIALIZATION =================
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  const pushButton = document.getElementById('pushNotificationButton');
  if (pushButton) pushButton.addEventListener('click', togglePushNotifications);
  if ('serviceWorker' in navigator) {
    getPushServiceWorkerRegistration().catch(error => {
      console.error('Could not register the notification service worker:', error);
    });
  }
  setupNavigation();
  setupStudentAuth();
  setupChatHandlers();
  setupImageViewer();
  setupChatReportDialog();
  setupAttendanceHandlers();
  setupHolidaysHandlers();
  setupPTMHandlers();
  setupSyllabusHandlers();
  setupLeaveModal();

  if (localStorage.getItem('edupulse_faculty_preview') === 'true') {
    state.isFacultyPreview = true;
    await verifyFacultyPreview();
  } else {
    const studentId = localStorage.getItem('edupulse_student_id');
    if (studentId) {
      await verifyStudentSession(studentId);
    } else {
      showStudentAuthScreen();
    }
  }

  renderIcons();
});

async function verifyFacultyPreview() {
  const adminId = localStorage.getItem('edupulse_admin_id');
  if (!adminId) {
    localStorage.removeItem('edupulse_faculty_preview');
    showStudentAuthScreen();
    return;
  }

  try {
    const response = await fetch('/api/auth/admin/me', {
      headers: { 'x-admin-id': adminId }
    });
    const data = await response.json();
    if (!response.ok || !data.success || !data.admin) {
      throw new Error(data.error || 'Faculty session could not be verified.');
    }

    state.currentStudent = {
      ...data.admin,
      rollNo: 'Faculty',
      grade: data.admin.subject || 'Teacher Preview',
      role: data.admin.role || 'Teacher'
    };
    updateStudentUI();
    showStudentPortal();
    setFacultyPreviewControls();
    await loadPortalData();
    switchTab('chat');
  } catch (error) {
    localStorage.removeItem('edupulse_faculty_preview');
    state.isFacultyPreview = false;
    showStudentAuthScreen();
    showToast(error.message || 'Faculty session could not be verified.', 'error');
  }
}

function setFacultyPreviewControls() {
  document.body.classList.add('faculty-preview');
  const sessionStatus = document.getElementById('sessionStatusText');
  const sessionMode = document.getElementById('sessionModeTag');
  const avatar = document.getElementById('userAvatar');
  const subtitle = document.getElementById('portalSubtitle');
  const sidebarTitle = document.getElementById('sidebarSessionTitle');
  const sidebarRoll = document.getElementById('sidebarStudentRoll');
  if (sessionStatus) sessionStatus.textContent = 'Faculty Preview Active';
  if (sessionMode) sessionMode.textContent = 'Teacher View';
  if (avatar) avatar.alt = 'Faculty profile picture';
  if (subtitle) subtitle.textContent = 'Faculty Preview • Student Portal';
  if (sidebarTitle) sidebarTitle.textContent = 'Faculty Preview';
  if (sidebarRoll) sidebarRoll.textContent = state.currentStudent.name;

  const roleBadge = document.querySelector('.user-name-role .badge');
  if (roleBadge) {
    roleBadge.textContent = 'Teacher Preview';
    roleBadge.classList.remove('badge-student');
    roleBadge.classList.add('badge-teacher');
  }

  const avatarUpload = document.querySelector('.avatar-upload-button');
  const avatarInput = document.getElementById('profilePictureInput');
  if (avatarUpload) avatarUpload.title = 'Faculty profile picture';
  if (avatarInput) avatarInput.hidden = true;

  const logoutButton = document.getElementById('studentLogoutBtn');
  if (logoutButton) {
    logoutButton.title = 'Return to Faculty Admin';
    logoutButton.innerHTML = '<i data-lucide="arrow-left"></i><span>Back to Admin</span>';
  }

  renderIcons();
}

function showStudentAuthScreen() {
  document.getElementById('studentAuthScreen').style.display = 'flex';
  document.getElementById('studentAppLayout').style.display = 'none';
  renderIcons();
}

function showStudentPortal() {
  document.getElementById('studentAuthScreen').style.display = 'none';
  document.getElementById('studentAppLayout').style.display = 'flex';
  renderIcons();
}

// Verify Session
async function verifyStudentSession(studentId) {
  try {
    const res = await fetch('/api/auth/student/me', {
      headers: { 'x-student-id': studentId }
    });
    const data = await res.json();
    if (data.success && data.student) {
      state.currentStudent = data.student;
      updateStudentUI();
      showStudentPortal();
      await loadPortalData();
    } else {
      localStorage.removeItem('edupulse_student_id');
      showStudentAuthScreen();
    }
  } catch (err) {
    showStudentAuthScreen();
  }
}

// Setup Auth Forms
function setupStudentAuth() {
  setupProfilePictureUpload();

  // Login Form
  const loginForm = document.getElementById('studentLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const identifier = document.getElementById('loginIdentifier').value.trim();
      const password = document.getElementById('loginPassword').value;

      try {
        const res = await fetch('/api/auth/student/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password })
        });
        const data = await res.json();
        if (data.success) {
          state.currentStudent = data.student;
          localStorage.setItem('edupulse_student_id', data.student.id);
          localStorage.setItem('edupulse_student_token', data.token);

          updateStudentUI();
          showStudentPortal();
          await loadPortalData();
          showToast(`Welcome back, ${data.student.name}!`, 'success');
        } else {
          showToast(data.error || 'Login failed', 'error');
        }
      } catch (err) {
        showToast('Server connection error', 'error');
      }
    });
  }

  // Register Form
  const regForm = document.getElementById('studentRegisterForm');
  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const rollNo = document.getElementById('regRollNo').value.trim();
      const section = document.getElementById('regSection').value;
      const grade = `Grade 8 - Section ${section}`;
      const house = document.getElementById('regHouse').value;
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;

      try {
        const res = await fetch('/api/auth/student/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, rollNo, grade, section, house, email, password })
        });
        const data = await res.json();
        if (data.success) {
          state.currentStudent = data.student;
          localStorage.setItem('edupulse_student_id', data.student.id);
          localStorage.setItem('edupulse_student_token', data.token);

          updateStudentUI();
          showStudentPortal();
          await loadPortalData();
          showToast(`🎉 Registration complete! Welcome, ${data.student.name}`, 'success');
        } else {
          showToast(data.error || 'Registration failed', 'error');
        }
      } catch (err) {
        showToast('Error registering account', 'error');
      }
    });
  }

  // Logout Button
  const logoutBtn = document.getElementById('studentLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (state.isFacultyPreview) {
        localStorage.removeItem('edupulse_faculty_preview');
        if (socket) socket.emit('leave_presence');
        window.location.href = '/admin';
        return;
      }
      localStorage.removeItem('edupulse_student_id');
      localStorage.removeItem('edupulse_student_token');
      if (socket) socket.emit('leave_presence');
      state.currentStudent = null;
      showToast('Logged out of Student Portal', 'info');
      showStudentAuthScreen();
    });
  }
}

function setupProfilePictureUpload() {
  const input = document.getElementById('profilePictureInput');
  if (!input) return;

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!state.currentStudent) {
      showToast('Log in before changing your profile picture.', 'error');
      input.value = '';
      return;
    }

    input.disabled = true;
    try {
      const avatar = await resizeProfilePicture(file);
      const response = await fetch('/api/auth/student/avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': state.currentStudent.id
        },
        body: JSON.stringify({ avatar })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not update your profile picture.');
      }

      state.currentStudent = data.student;
      state.chatUsers.students = state.chatUsers.students.map(student =>
        student.id === data.student.id ? { ...student, avatar: data.student.avatar } : student
      );
      updateStudentUI();
      renderOnlineUsers(state.chatUsers.students, state.chatUsers.admins);
      if (state.activeTab === 'chat') renderChatMessages();
      showToast('Profile picture updated.', 'success');
    } catch (err) {
      showToast(err.message || 'Could not update your profile picture.', 'error');
    } finally {
      input.disabled = false;
      input.value = '';
    }
  });
}

async function resizeProfilePicture(file) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 10 MB.');
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This image could not be opened.'));
      element.src = imageUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) {
      throw new Error('Choose a valid image with dimensions under 40 megapixels.');
    }

    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not process this image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const avatar = canvas.toDataURL('image/jpeg', 0.82);
    if (avatar.length > 1400000) {
      throw new Error('This image could not be compressed enough. Please choose another.');
    }
    return avatar;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function updateStudentUI() {
  if (!state.currentStudent) return;
  const s = state.currentStudent;

  const nameEl = document.getElementById('userName');
  const avatarEl = document.getElementById('userAvatar');
  const subEl = document.getElementById('userSub');
  const welcomeEl = document.getElementById('dashWelcomeName');
  const sidebarRoll = document.getElementById('sidebarStudentRoll');

  if (nameEl) nameEl.textContent = s.name;
  if (avatarEl) avatarEl.src = s.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(s.name)}`;
  if (subEl) subEl.textContent = state.isFacultyPreview
    ? `${s.role} • ${s.grade}`
    : `Roll No: ${s.rollNo} • ${s.grade}`;
  if (welcomeEl) welcomeEl.textContent = s.name.split(' ')[0];
  if (sidebarRoll) sidebarRoll.textContent = `Roll: ${s.rollNo}`;
  updatePushNotificationControl();
  syncStudentPresence();
}

function syncStudentPresence() {
  if (socket && socket.connected && state.currentStudent) {
    socket.emit('identify_user', { userId: state.currentStudent.id });
  }
}

async function loadPortalData() {
  await loadAnnouncements();
  await loadChatChannels();
  await loadAttendanceData();
  await loadHolidaysData();
  await loadPTMData();
  await loadExamsData();
  renderIcons();
}

// ================= NAVIGATION =================
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.getAttribute('data-tab'));
    });
  });
  window.addEventListener('resize', updateMobilePageMode);
}

function updateMobilePageMode() {
  const appLayout = document.getElementById('studentAppLayout');
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  if (!appLayout) return;

  const isMobilePageOpen = isMobile && state.activeTab !== 'dashboard';
  appLayout.classList.toggle('mobile-page-open', isMobilePageOpen);
  const isMobileChatOpen = isMobilePageOpen && state.activeTab === 'chat';
  document.documentElement.classList.toggle('mobile-chat-open', isMobileChatOpen);
  document.body.classList.toggle('mobile-chat-open', isMobileChatOpen);
}

function switchTab(tabId) {
  const isAnnouncementsPanel = tabId === 'announcements';
  const panelTabId = isAnnouncementsPanel ? 'chat' : tabId;
  state.activeTab = panelTabId;
  updateMobilePageMode();
  if (panelTabId !== 'chat') {
    document.querySelector('.chat-container')?.classList.remove('channels-collapsed');
  }

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });

  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.remove('active');
  });

  const targetPanel = document.getElementById(`tab-${panelTabId}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  document.querySelector('.app-layout')?.classList.toggle('chat-fullscreen', panelTabId === 'chat');

  if (isAnnouncementsPanel && state.channels.some(channel => channel.id === 'announcements')) {
    selectChannel('announcements');
  } else if (tabId === 'chat' && state.activeChannel === 'announcements') {
    const chatChannel = state.channels.find(channel => channel.id === 'general')
      || state.channels.find(channel => channel.id !== 'announcements');
    if (chatChannel) selectChannel(chatChannel.id);
  }

  if (panelTabId === 'chat') {
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.querySelector('.chat-container')?.classList.add('channels-collapsed');
    }
    const badge = document.getElementById('chatBadge');
    if (badge) badge.textContent = '0';
    scrollActiveChannelIntoView();
    scrollToBottom();
  }

  renderIcons();
}

// ================= DASHBOARD & ANNOUNCEMENTS =================
async function loadAnnouncements() {
  try {
    const res = await fetch('/api/announcements');
    const data = await res.json();
    state.announcements = data.announcements || [];
    renderDashboardNotices();
  } catch (err) {
    console.error('Error loading notices:', err);
  }
}

function renderDashboardNotices() {
  const container = document.getElementById('dashboardNoticesList');
  if (!container) return;
  container.innerHTML = '';

  if (state.announcements.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No circulars posted yet.</p>';
    return;
  }

  state.announcements.slice(0, 4).forEach(notice => {
    const div = document.createElement('div');
    div.className = `notice-item ${notice.badgeClass === 'urgent' ? 'urgent' : ''}`;
    div.innerHTML = `
      <div class="notice-badge ${notice.badgeClass}">${notice.category}</div>
      <div class="notice-content">
        <h4>${notice.title}</h4>
        <p>${notice.content}</p>
        <small class="notice-date"><i data-lucide="calendar"></i> ${notice.date} • ${notice.author}</small>
      </div>
    `;
    container.appendChild(div);
  });

  renderIcons();
}

// ================= 2. CHAT FUNCTIONALITY =================
async function loadChatChannels() {
  try {
    const res = await fetch('/api/chat/channels');
    const data = await res.json();
    state.channels = data.channels || [];
    state.chatUsers = { students: data.students || [], admins: data.admins || [] };
    state.onlineUserIds = data.onlineUserIds || state.onlineUserIds;

    renderChannels();
    renderOnlineUsers(state.chatUsers.students, state.chatUsers.admins);

    if (state.channels.length > 0) {
      const preferredChannel = state.isFacultyPreview ? 'general' : 'announcements';
      const defaultChannel = state.channels.find(channel => channel.id === preferredChannel) || state.channels[0];
      selectChannel(defaultChannel.id);
    }
  } catch (err) {
    console.error('Error loading channels:', err);
  }
}

function renderChannels() {
  const container = document.getElementById('channelList');
  if (!container) return;
  container.innerHTML = '';

  state.channels
    .filter(channel => channel.id !== 'announcements')
    .forEach(ch => {
      const el = document.createElement('div');
      el.className = `channel-item ${ch.id === state.activeChannel ? 'active' : ''}`;
      el.innerHTML = `
        <i data-lucide="${ch.icon || 'hash'}"></i>
        <span>${ch.name}</span>
      `;
      el.addEventListener('click', () => selectChannel(ch.id, true));
      container.appendChild(el);
    });
  renderIcons();
}

function renderOnlineUsers(students, admins) {
  const container = document.getElementById('onlineUsersList');
  if (!container) return;
  container.innerHTML = '';

  const allUsers = [...admins, ...students];
  allUsers.forEach(u => {
    const isOnline = state.onlineUserIds.includes(u.id);
    const el = document.createElement('div');
    el.className = 'user-item';
    const avatar = document.createElement('img');
    avatar.src = u.avatar || '';
    avatar.className = 'user-item-avatar';
    avatar.alt = u.name || 'User';

    const details = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'user-item-name';
    name.textContent = u.name || 'User';
    const role = document.createElement('small');
    role.className = 'user-item-role';
    role.textContent = u.role === 'Student' ? (u.grade || 'Student') : (u.subject || 'Faculty');
    details.append(name, role);

    const status = document.createElement('span');
    status.className = `user-presence ${isOnline ? 'online' : 'offline'}`;
    status.setAttribute('aria-label', isOnline ? 'Online' : 'Offline');
    status.innerHTML = `<span class="user-item-status ${isOnline ? 'online' : 'offline'}"></span><span>${isOnline ? 'Online' : 'Offline'}</span>`;

    el.append(avatar, details, status);
    container.appendChild(el);
  });
}

function selectChannel(channelId, collapseChannelPanel = false) {
  state.activeChannel = channelId;
  const channel = state.channels.find(c => c.id === channelId) || { name: channelId, description: '' };
  const isReadOnly = channelId === 'announcements';
  const chatContainer = document.querySelector('.chat-container');
  chatContainer?.classList.toggle('announcement-view', isReadOnly);
  if (collapseChannelPanel && window.matchMedia('(max-width: 900px)').matches) {
    chatContainer?.classList.add('channels-collapsed');
  }

  if (state.activeTab === 'chat') {
    document.querySelector('.nav-item[data-tab="chat"]')?.classList.toggle('active', !isReadOnly);
    document.querySelector('.nav-item[data-tab="announcements"]')?.classList.toggle('active', isReadOnly);
  }

  const nameEl = document.getElementById('currentChannelName');
  const descEl = document.getElementById('currentChannelDesc');
  if (nameEl) nameEl.innerHTML = `<i data-lucide="${channel.icon || (isReadOnly ? 'megaphone' : 'hash')}"></i> ${channel.name}`;
  if (descEl) descEl.textContent = channel.description;

  renderChatComposerState();
  if (isReadOnly) {
    document.getElementById('removePendingAttachment')?.click();
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.hidden = true;
  }

  document.querySelectorAll('.channel-item').forEach(el => {
    el.classList.toggle('active', el.textContent.includes(channel.name));
  });
  scrollActiveChannelIntoView();

  if (socket) {
    socket.emit('join_channel', channelId);
  }

  loadChatMessages(channelId);
  renderIcons();
}

function scrollActiveChannelIntoView() {
  const activeChannelItem = document.querySelector('.channel-item.active');
  const channelList = document.getElementById('channelList');
  if (!activeChannelItem || !channelList || channelList.clientWidth === 0) return;

  const itemBounds = activeChannelItem.getBoundingClientRect();
  const listBounds = channelList.getBoundingClientRect();
  if (itemBounds.left < listBounds.left) {
    channelList.scrollLeft += itemBounds.left - listBounds.left;
  } else if (itemBounds.right > listBounds.right) {
    channelList.scrollLeft += itemBounds.right - listBounds.right;
  }
}

function renderChatComposerState() {
  const isReadOnly = state.activeChannel === 'announcements';
  const isCooldownChannel = state.activeChannel === 'math-doubts';
  const remainingSeconds = isCooldownChannel
    ? Math.max(0, Math.ceil((state.chatCooldownUntil - Date.now()) / 1000))
    : 0;
  const isCoolingDown = remainingSeconds > 0;
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const readOnlyNotice = document.getElementById('chatReadOnlyNotice');
  const cooldownNotice = document.getElementById('chatCooldownNotice');

  if (chatForm) chatForm.hidden = isReadOnly;
  if (chatInput) {
    chatInput.disabled = isReadOnly || isCoolingDown;
    chatInput.placeholder = isReadOnly
      ? 'Official Announcements is read-only.'
      : (isCoolingDown
        ? `You can send another message in ${remainingSeconds} seconds.`
        : (state.isFacultyPreview ? 'Message your class... (Press Enter to send)' : 'Ask a doubt or message your classmates... (Press Enter to send)'));
  }
  if (chatForm) {
    chatForm.querySelectorAll('button, input[type="file"]').forEach(control => {
      control.disabled = isReadOnly || isCoolingDown;
    });
  }
  if (readOnlyNotice) readOnlyNotice.hidden = !isReadOnly;
  if (cooldownNotice) {
    cooldownNotice.hidden = !isCoolingDown;
    cooldownNotice.textContent = isCoolingDown
      ? `Please wait ${remainingSeconds} seconds before sending another message.`
      : '';
  }
}

function startChatCooldown(cooldownUntil) {
  state.chatCooldownUntil = Math.max(state.chatCooldownUntil, Number(cooldownUntil) || 0);
  renderChatComposerState();
  if (state.chatCooldownTimer) return;

  state.chatCooldownTimer = setInterval(() => {
    renderChatComposerState();
    if (state.chatCooldownUntil <= Date.now()) {
      clearInterval(state.chatCooldownTimer);
      state.chatCooldownTimer = null;
      state.chatCooldownUntil = 0;
      renderChatComposerState();
    }
  }, 1000);
}

async function loadChatMessages(channelId) {
  try {
    const headers = state.currentStudent ? { 'x-student-id': state.currentStudent.id } : {};
    const res = await fetch(`/api/chat/messages?channel=${encodeURIComponent(channelId)}`, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load chat messages');
    state.messages = data.messages || [];
    renderChatMessages();
  } catch (err) {
    console.error('Error fetching chat:', err);
  }
}

function renderChatMessages() {
  const container = document.getElementById('messagesContainer');
  if (!container) return;
  container.innerHTML = '';

  state.messages.forEach((msg, index) => appendChatMessage(msg, false, index));
  scrollToBottom();
  renderIcons();
}

function appendChatMessage(msg, shouldScroll = true, animationIndex = 0) {
  const container = document.getElementById('messagesContainer');
  if (!container) return;

  const isSelf = state.currentStudent && (msg.senderId === state.currentStudent.id || msg.senderName === state.currentStudent.name);
  const avatar = getChatAvatar(msg);
  const date = new Date(msg.timestamp || Date.now());
  const timeStr = `${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${msg.updatedAt ? ' · edited' : ''}`;

  const card = document.createElement('div');
  card.className = `message-card ${isSelf ? 'is-self' : ''}`;
  card.dataset.messageId = msg.id || '';
  card.style.animationDelay = `${Math.min(animationIndex * 28, 280)}ms`;
  card.innerHTML = `
    <img src="${escapeHTML(avatar)}" class="msg-avatar" alt="${escapeHTML(msg.senderName)} avatar">
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-sender">${escapeHTML(msg.senderName)}</span>
        <span class="badge ${msg.senderRole === 'Teacher' ? 'badge-teacher' : 'badge-student'}" title="${msg.senderRole === 'Teacher' ? 'School teacher or staff account' : 'Student account'}">${msg.senderRole === 'Teacher' ? 'Teacher' : 'Student'}</span>
        <span class="msg-time">${timeStr}</span>
      </div>
      <div class="msg-bubble">${escapeHTML(msg.text)}</div>
    </div>
  `;

  const attachment = msg.attachment;
  const attachmentMatch = attachment && attachment.url && attachment.url.match(/^\/api\/chat\/attachments\/[\da-f-]{36}\.([a-z0-9]+)$/i);
  if (attachmentMatch) {
    const extension = attachmentMatch[1].toLowerCase();
    const bubble = card.querySelector('.msg-bubble');
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const videoExtensions = ['.mp4', '.m4v', '.mov', '.webm'];
    const fileExtension = `.${extension}`;

    if (imageExtensions.includes(fileExtension)) {
      const imageLink = document.createElement('a');
      const image = document.createElement('img');
      imageLink.className = 'chat-media-preview';
      imageLink.href = attachment.url;
      imageLink.setAttribute('aria-label', `View ${attachment.name || 'shared image'}`);
      image.alt = attachment.name || 'Shared image';
      image.src = attachment.url;
      image.loading = 'lazy';
      imageLink.addEventListener('click', event => {
        event.preventDefault();
        openImageViewer(attachment.url, attachment.name || 'Shared image');
      });
      imageLink.appendChild(image);
      bubble.appendChild(imageLink);
    } else if (videoExtensions.includes(fileExtension)) {
      const video = document.createElement('video');
      video.className = 'chat-media-preview';
      video.controls = true;
      video.preload = 'metadata';
      video.src = attachment.url;
      video.setAttribute('aria-label', attachment.name || 'Shared video');
      bubble.appendChild(video);
    }

    const link = document.createElement('a');
    const icon = document.createElement('i');
    const label = document.createElement('span');
    link.className = 'chat-attachment';
    link.href = attachment.url;
    if (imageExtensions.includes(fileExtension)) {
      link.setAttribute('aria-label', `View ${attachment.name || 'shared image'}`);
      link.addEventListener('click', event => {
        event.preventDefault();
        openImageViewer(attachment.url, attachment.name || 'Shared image');
      });
    } else {
      link.download = attachment.name || 'attachment';
    }
    icon.setAttribute('data-lucide', imageExtensions.includes(fileExtension) ? 'image' : (videoExtensions.includes(fileExtension) ? 'video' : 'file-text'));
    label.textContent = attachment.name || 'Download attachment';
    link.append(icon, label);
    bubble.appendChild(link);
  }

  if (isSelf && !state.isFacultyPreview && msg.channelId !== 'announcements') {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'chat-message-action';
    editButton.innerHTML = '<i data-lucide="pencil"></i><span>Edit</span>';
    editButton.addEventListener('click', () => beginMessageEdit(msg, card));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'chat-message-action delete';
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i><span>Delete</span>';
    deleteButton.addEventListener('click', () => deleteOwnChatMessage(msg));
    actions.append(editButton, deleteButton);
    card.querySelector('.msg-body').appendChild(actions);
  } else if (!isSelf && state.currentStudent && !state.isFacultyPreview && msg.channelId !== 'announcements') {
    const actions = document.createElement('div');
    actions.className = 'message-actions message-actions-report';
    const reportButton = document.createElement('button');
    reportButton.type = 'button';
    reportButton.className = 'chat-message-action chat-message-report';
    reportButton.disabled = Boolean(msg.reportedByCurrentStudent);
    reportButton.title = reportButton.disabled ? 'You have already reported this message' : 'Report this message';
    reportButton.setAttribute('aria-label', reportButton.title);
    reportButton.innerHTML = msg.reportedByCurrentStudent
      ? '<i data-lucide="check"></i>'
      : '<i data-lucide="flag"></i>';
    reportButton.addEventListener('click', () => openChatReportDialog(msg.id));
    actions.appendChild(reportButton);
    card.querySelector('.msg-body').appendChild(actions);
  }

  container.appendChild(card);
  renderIcons();
  if (shouldScroll) scrollToBottom();
}

function setupChatReportDialog() {
  const dialog = document.getElementById('chatReportDialog');
  const form = document.getElementById('chatReportForm');
  const closeButton = document.getElementById('closeChatReport');
  const cancelButton = document.getElementById('cancelChatReport');
  if (!dialog || !form) return;

  const close = () => {
    dialog.close();
    state.reportingMessageId = null;
    form.reset();
  };
  closeButton?.addEventListener('click', close);
  cancelButton?.addEventListener('click', close);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.currentStudent || !state.reportingMessageId) {
      showToast('Sign in as a student before reporting a message.', 'error');
      return;
    }

    const submitButton = document.getElementById('submitChatReport');
    submitButton.disabled = true;
    try {
      const response = await fetch(`/api/chat/messages/${encodeURIComponent(state.reportingMessageId)}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': state.currentStudent.id
        },
        body: JSON.stringify({
          reason: document.getElementById('chatReportReason').value,
          details: document.getElementById('chatReportDetails').value
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not send report');

      const message = state.messages.find(item => item.id === state.reportingMessageId);
      if (message) message.reportedByCurrentStudent = true;
      close();
      renderChatMessages();
      showToast('Report sent to school staff for review.', 'success');
    } catch (error) {
      showToast(error.message || 'Could not send report', 'error');
    } finally {
      submitButton.disabled = false;
    }
  });
}

function openChatReportDialog(messageId) {
  const dialog = document.getElementById('chatReportDialog');
  if (!dialog || !state.currentStudent || state.isFacultyPreview) return;
  state.reportingMessageId = messageId;
  dialog.showModal();
}

function setupImageViewer() {
  const viewer = document.getElementById('imageViewer');
  const closeButton = document.getElementById('closeImageViewer');
  const image = document.getElementById('imageViewerImage');
  const caption = document.getElementById('imageViewerCaption');
  if (!viewer || !closeButton || !image || !caption) return;

  closeButton.addEventListener('click', () => viewer.close());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && viewer.open) {
      event.preventDefault();
      viewer.close();
    }
  });
  viewer.addEventListener('cancel', event => {
    event.preventDefault();
    viewer.close();
  });
  viewer.addEventListener('click', event => {
    if (event.target === viewer) viewer.close();
  });
  viewer.addEventListener('close', () => {
    image.removeAttribute('src');
    caption.textContent = '';
  });
}

function openImageViewer(src, name) {
  const viewer = document.getElementById('imageViewer');
  const image = document.getElementById('imageViewerImage');
  const caption = document.getElementById('imageViewerCaption');
  if (!viewer || !image || !caption) return;

  image.src = src;
  image.alt = name;
  caption.textContent = name;
  if (!viewer.open) viewer.showModal();
}

function getChatAvatar(message) {
  const sender = [...state.chatUsers.students, ...state.chatUsers.admins]
    .find(user => user.id === message.senderId);
  const fallback = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(message.senderName || 'User')}`;
  if (state.currentStudent && message.senderId === state.currentStudent.id) {
    return state.currentStudent.avatar || sender?.avatar || fallback;
  }
  return sender?.avatar || fallback;
}

function beginMessageEdit(message, card) {
  if (card.querySelector('.chat-message-edit')) return;
  const bubble = card.querySelector('.msg-bubble');
  const actions = card.querySelector('.message-actions');
  const form = document.createElement('form');
  form.className = 'chat-message-edit';
  const textarea = document.createElement('textarea');
  textarea.className = 'form-textarea';
  textarea.rows = 2;
  textarea.maxLength = 2000;
  textarea.value = message.text || '';
  textarea.setAttribute('aria-label', 'Edit message');
  const buttons = document.createElement('div');
  buttons.className = 'chat-message-edit-actions';
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'btn btn-sm btn-primary';
  saveButton.textContent = 'Save';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn-sm btn-outline';
  cancelButton.textContent = 'Cancel';
  buttons.append(saveButton, cancelButton);
  form.append(textarea, buttons);
  bubble.hidden = true;
  actions.hidden = true;
  card.querySelector('.msg-body').appendChild(form);
  textarea.focus();

  cancelButton.addEventListener('click', () => {
    form.remove();
    bubble.hidden = false;
    actions.hidden = false;
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    saveButton.disabled = true;
    try {
      const response = await fetch(`/api/chat/messages/${encodeURIComponent(message.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-student-id': state.currentStudent.id
        },
        body: JSON.stringify({ text: textarea.value.trim() })
      });
      const data = await parseChatResponse(response);
      if (!response.ok) throw new Error(data.error || 'Could not update message');
      applyUpdatedChatMessage(data.message);
      showToast('Message updated.', 'success');
    } catch (error) {
      showToast(error.message || 'Could not update message', 'error');
      saveButton.disabled = false;
    }
  });
}

function applyUpdatedChatMessage(message) {
  if (!message) return;
  state.messages = state.messages.map(item => item.id === message.id ? message : item);
  if (message.channelId !== state.activeChannel) return;

  const card = document.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  if (!card) return;
  const bubble = card.querySelector('.msg-bubble');
  Array.from(bubble.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
  bubble.insertBefore(document.createTextNode(message.text || ''), bubble.firstChild);
  card.querySelector('.chat-message-edit')?.remove();
  bubble.hidden = false;
  const actions = card.querySelector('.message-actions');
  if (actions) actions.hidden = false;
  const timestamp = card.querySelector('.msg-time');
  if (timestamp) timestamp.textContent += timestamp.textContent.includes('edited') ? '' : ' · edited';
}

async function deleteOwnChatMessage(message) {
  if (!window.confirm('Delete this message? This cannot be undone.')) return;
  try {
    const response = await fetch(`/api/chat/messages/${encodeURIComponent(message.id)}`, {
      method: 'DELETE',
      headers: { 'x-student-id': state.currentStudent.id }
    });
    const data = await parseChatResponse(response);
    if (!response.ok) throw new Error(data.error || 'Could not delete message');
    removeChatMessage(data.messageId, data.channelId);
    showToast('Message deleted.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not delete message', 'error');
  }
}

function removeChatMessage(messageId, channelId) {
  state.messages = state.messages.filter(message => message.id !== messageId);
  if (channelId === state.activeChannel) {
    document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)?.remove();
  }
}

function scrollToBottom() {
  const container = document.getElementById('messagesContainer');
  if (container) container.scrollTop = container.scrollHeight;
}

async function parseChatResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch (err) {
      throw new Error('The server returned invalid JSON. Restart node server.js and reload.');
    }
  }

  if (response.status === 413) {
    throw new Error('The selected file exceeds the server upload limit.');
  }
  if (contentType.includes('text/html') && response.status === 404) {
    throw new Error('The chat API is missing on this port. Restart node server.js and reload.');
  }
  throw new Error(`Unexpected server response (HTTP ${response.status}).`);
}

function setupChatHandlers() {
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  const emojiBtn = document.getElementById('quickEmojiBtn');
  const attachBtn = document.getElementById('attachBtn');
  const emojiPicker = document.getElementById('emojiPicker');
  const fileInput = document.getElementById('chatFileInput');
  const attachmentPreview = document.getElementById('pendingAttachment');
  const attachmentName = document.getElementById('pendingAttachmentName');
  const removeAttachmentBtn = document.getElementById('removePendingAttachment');
  let pendingFile = null;

  if (form && input) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.activeChannel === 'announcements') return;
      if (state.activeChannel === 'math-doubts' && state.chatCooldownUntil > Date.now()) {
        renderChatComposerState();
        return;
      }
      const text = input.value.trim();
      if (!text && !pendingFile) return;

      const sendButton = form.querySelector('.btn-send');
      if (sendButton) sendButton.disabled = true;

      try {
        let attachment;
        if (pendingFile) {
          const uploadResponse = await fetch('/api/chat/attachments', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-File-Name': encodeURIComponent(pendingFile.name)
            },
            body: pendingFile
          });
          const uploadData = await parseChatResponse(uploadResponse);
          if (!uploadResponse.ok) throw new Error(uploadData.error || 'Document upload failed');
          attachment = uploadData.attachment;
        }

        const payload = {
          channelId: state.activeChannel,
          senderId: state.currentStudent ? state.currentStudent.id : 'std_1',
          senderName: state.currentStudent ? state.currentStudent.name : 'Student',
          senderRole: state.isFacultyPreview ? (state.currentStudent.role || 'Teacher') : 'Student',
          text,
          ...(attachment ? { attachment } : {})
        };
        const response = await fetch('/api/chat/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(state.isFacultyPreview
              ? { 'x-admin-id': state.currentStudent.id }
              : (state.currentStudent ? { 'x-student-id': state.currentStudent.id } : {}))
          },
          body: JSON.stringify(payload)
        });
        const message = await parseChatResponse(response);
        if (!response.ok) {
          if (message.cooldownUntil) startChatCooldown(message.cooldownUntil);
          throw new Error(message.error || 'Message could not be sent');
        }
        if (message.cooldownUntil) startChatCooldown(message.cooldownUntil);

        input.value = '';
        pendingFile = null;
        if (fileInput) fileInput.value = '';
        if (attachmentPreview) attachmentPreview.hidden = true;
        if (!socket || !socket.connected) appendChatMessage(message);
      } catch (err) {
        showToast(err.message || 'Message could not be sent', 'error');
      } finally {
        renderChatComposerState();
      }
    });
  }

  if (emojiBtn && input && emojiPicker) {
    emojiBtn.addEventListener('click', () => {
      emojiPicker.hidden = !emojiPicker.hidden;
      emojiBtn.setAttribute('aria-expanded', String(!emojiPicker.hidden));
    });

    emojiPicker.addEventListener('emoji-click', (event) => {
      const emoji = event.detail && event.detail.unicode;
      if (!emoji) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.setRangeText(emoji, start, end, 'end');
      input.focus();
      emojiPicker.hidden = true;
      emojiBtn.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('click', (event) => {
      if (!emojiPicker.contains(event.target) && !emojiBtn.contains(event.target)) {
        emojiPicker.hidden = true;
        emojiBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        emojiPicker.hidden = true;
        emojiBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const selectedFile = fileInput.files && fileInput.files[0];
      if (!selectedFile) return;
      const extension = selectedFile.name.slice(selectedFile.name.lastIndexOf('.')).toLowerCase();
      const videoExtensions = ['.mp4', '.m4v', '.mov', '.webm'];
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const maxBytes = videoExtensions.includes(extension) ? 20 * 1024 * 1024 : (imageExtensions.includes(extension) ? 10 * 1024 * 1024 : 3 * 1024 * 1024);
      const maxMegabytes = Math.floor(maxBytes / (1024 * 1024));
      if (selectedFile.size > maxBytes) {
        showToast(`This file must be ${maxMegabytes} MB or smaller`, 'error');
        fileInput.value = '';
        return;
      }

      pendingFile = selectedFile;
      if (attachmentName) attachmentName.textContent = selectedFile.name;
      if (attachmentPreview) attachmentPreview.hidden = false;
      renderIcons();
    });
  }

  if (removeAttachmentBtn) {
    removeAttachmentBtn.addEventListener('click', () => {
      pendingFile = null;
      if (fileInput) fileInput.value = '';
      if (attachmentPreview) attachmentPreview.hidden = true;
      if (input) input.focus();
    });
  }
}

// ================= 3. ATTENDANCE FUNCTIONALITY =================
async function loadAttendanceData() {
  try {
    const headers = state.currentStudent ? { 'x-student-id': state.currentStudent.id } : {};
    const res = await fetch('/api/attendance', { headers });
    if (!res.ok) throw new Error(`Attendance request failed (${res.status})`);
    const data = await res.json();
    state.attendance = data;
    renderAttendanceUI();
  } catch (err) {
    console.error('Error loading attendance:', err);
  }
}

function getCurrentStudentAttendanceLogs(attendance) {
  if (!state.currentStudent) return attendance.monthlyLog || [];
  const byDate = new Map();
  (attendance.monthlyLog || []).forEach(log => {
    const isStudentLog = log.studentId === state.currentStudent.id
      || (!log.studentId && log.studentName === state.currentStudent.name);
    if (isStudentLog && log.date && !byDate.has(log.date)) byDate.set(log.date, log);
  });
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function getStudentAttendanceSummary(logs) {
  const present = logs.filter(log => log.status === 'Present').length;
  const absent = logs.filter(log => log.status === 'Absent').length;
  const late = logs.filter(log => log.status === 'Late').length;
  let streak = 0;
  for (const log of logs) {
    if (log.status === 'Absent') break;
    if (log.status === 'Present' || log.status === 'Late') streak += 1;
  }
  return {
    percentage: logs.length ? +(((present + late) / logs.length) * 100).toFixed(1) : 100,
    totalDays: logs.length,
    present,
    absent,
    late,
    streak
  };
}

function renderAttendanceUI() {
  if (!state.attendance) return;
  const att = state.attendance;
  const myLogs = getCurrentStudentAttendanceLogs(att);
  const overall = state.currentStudent
    ? getStudentAttendanceSummary(myLogs)
    : (att.overall || {});
  const checkInBtn = document.getElementById('selfCheckInBtn');
  if (checkInBtn && state.currentStudent) {
    const today = new Date().toISOString().split('T')[0];
    const todayLog = myLogs.find(log => log.date === today);
    checkInBtn.innerHTML = todayLog
      ? `<i data-lucide="check-circle-2"></i> Marked ${todayLog.status} Today`
      : '<i data-lucide="check-square"></i> Self Check-in Today';
    checkInBtn.classList.toggle('attendance-already-marked', Boolean(todayLog));
  }

  const percEl = document.getElementById('overallPercVal');
  const barEl = document.getElementById('overallProgressBar');
  const presentEl = document.getElementById('daysPresentVal');
  const totalEl = document.getElementById('totalDaysVal');
  const absentEl = document.getElementById('daysAbsentVal');
  const streakEl = document.getElementById('streakVal');
  const dashAttEl = document.getElementById('dashAttendanceVal');
  const sideAttEl = document.getElementById('sidebarAttendanceRate');

  const perc = overall.percentage ?? 100;
  if (percEl) percEl.textContent = `${perc}%`;
  if (dashAttEl) dashAttEl.textContent = `${perc}%`;
  if (sideAttEl) sideAttEl.textContent = `${perc}%`;
  if (barEl) barEl.style.width = `${perc}%`;
  if (presentEl) presentEl.textContent = overall.present ?? 0;
  if (totalEl) totalEl.textContent = overall.totalDays ?? 0;
  if (absentEl) absentEl.textContent = overall.absent ?? 0;
  if (streakEl) streakEl.textContent = `${overall.streak ?? 0} Days`;

  // Subject table
  const tbody = document.getElementById('subjectAttendanceTable');
  if (tbody && att.subjects) {
    tbody.innerHTML = '';
    att.subjects.forEach(sub => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${sub.subject}</strong><br><small style="color:var(--text-muted);">${sub.code}</small></td>
        <td>${sub.teacher}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Display only this student's dated attendance, collapsing same-day duplicates.
  const logContainer = document.getElementById('dailyLogsList');
  if (logContainer && att.monthlyLog) {
    logContainer.innerHTML = '';

    if (myLogs.length === 0) {
      logContainer.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No attendance logged yet. Click "Self Check-in Today" above.</p>';
    } else {
      myLogs.slice(0, 7).forEach(log => {
        const isPresent = log.status === 'Present';
        const isLate = log.status === 'Late';
        const badgeClass = isPresent ? 'badge-green' : (isLate ? 'badge-amber' : 'badge-red');
        const div = document.createElement('div');
        div.className = 'daily-log-row';
        div.innerHTML = `
          <div class="daily-log-date">
            <i data-lucide="${isPresent ? 'check-circle-2' : (isLate ? 'clock' : 'alert-circle')}"></i>
            <span>${log.date}</span>
          </div>
          <div style="font-size:0.75rem; color:var(--text-secondary);">${log.remarks}</div>
          <div class="daily-log-status"><span class="badge ${badgeClass}">${log.status}</span></div>
        `;
        logContainer.appendChild(div);
      });
    }
  }

  // My Leave Applications
  const leaveContainer = document.getElementById('leaveHistoryList');
  if (leaveContainer && att.leaveRequests) {
    leaveContainer.innerHTML = '';
    const myLeaves = state.currentStudent
      ? att.leaveRequests.filter(l => l.studentId === state.currentStudent.id)
      : att.leaveRequests;

    if (myLeaves.length === 0) {
      leaveContainer.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No leave applications submitted yet.</p>';
    } else {
      myLeaves.forEach(l => {
        const div = document.createElement('div');
        div.className = 'leave-item';
        div.innerHTML = `
          <div class="leave-item-header">
            <span class="leave-item-title">${l.type}</span>
            <span class="badge ${l.status === 'Approved' ? 'badge-green' : (l.status === 'Rejected' ? 'badge-red' : 'badge-amber')}">${l.status}</span>
          </div>
          <div class="leave-item-desc">${l.reason}</div>
          <div class="leave-item-meta">Duration: ${l.startDate} to ${l.endDate} • Applied: ${l.appliedOn} ${l.reviewedBy ? `(Reviewed by: ${l.reviewedBy})` : ''}</div>
        `;
        leaveContainer.appendChild(div);
      });
    }
  }

  renderIcons();
}

function setupAttendanceHandlers() {
  const checkInBtn = document.getElementById('selfCheckInBtn');
  if (checkInBtn) {
    checkInBtn.addEventListener('click', async () => {
      if (state.isFacultyPreview) return;
      if (!state.currentStudent) {
        showToast('Sign in as a student before checking in.', 'error');
        return;
      }
      try {
        const res = await fetch('/api/attendance/check-in', {
          method: 'POST',
          headers: { 'x-student-id': state.currentStudent.id }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not check in');
        if (data.success) {
          state.attendance = data.attendance;
          renderAttendanceUI();
          showToast(
            data.alreadyMarked
              ? `Your attendance is already marked ${data.status || ''} for today.`.trim()
              : '✅ Attendance verified for today!',
            data.alreadyMarked ? 'info' : 'success'
          );
        }
      } catch (e) {
        showToast(e.message || 'Check-in error', 'error');
      }
    });
  }
}

// ================= LEAVE MODAL =================
function setupLeaveModal() {
  const modal = document.getElementById('leaveModal');
  const openBtn = document.getElementById('openLeaveModalBtn');
  const closeBtn = document.getElementById('closeLeaveModalBtn');
  const cancelBtn = document.getElementById('cancelLeaveBtn');
  const form = document.getElementById('leaveForm');

  if (!modal) return;

  const open = () => {
    if (state.isFacultyPreview) return;
    modal.style.display = 'flex';
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('leaveStartDate').value = today;
    document.getElementById('leaveEndDate').value = today;
  };
  const close = () => { modal.style.display = 'none'; };

  if (openBtn) openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.isFacultyPreview) return;
      const startDate = document.getElementById('leaveStartDate').value;
      const endDate = document.getElementById('leaveEndDate').value;
      const type = document.getElementById('leaveType').value;
      const reason = document.getElementById('leaveReason').value;

      try {
        const res = await fetch('/api/attendance/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: state.currentStudent ? state.currentStudent.id : 'std_1',
            studentName: state.currentStudent ? state.currentStudent.name : 'Student',
            studentGrade: state.currentStudent ? state.currentStudent.grade : 'Grade 10',
            startDate,
            endDate,
            type,
            reason
          })
        });
        const data = await res.json();
        if (data.success) {
          state.attendance.leaveRequests = data.allLeaves;
          renderAttendanceUI();
          close();
          form.reset();
          showToast('📄 Leave application submitted for Faculty review!', 'success');
        }
      } catch (err) {
        showToast('Error submitting leave application', 'error');
      }
    });
  }
}

// ================= 4. HOLIDAYS FUNCTIONALITY =================
async function loadHolidaysData() {
  try {
    const res = await fetch('/api/holidays');
    const data = await res.json();
    state.holidays = data.holidays || [];
    renderHolidaysUI('all');
    calculateHolidayCountdown();
  } catch (err) {
    console.error('Error loading holidays:', err);
  }
}

function calculateHolidayCountdown() {
  const countdownEl = document.getElementById('holidayCountdown');
  const nameEl = document.getElementById('holidayCountdownName');
  const dashNameEl = document.getElementById('dashNextHolidayName');
  const dashDatesEl = document.getElementById('dashNextHolidayDates');

  if (state.holidays.length === 0) {
    if (countdownEl) countdownEl.textContent = 'None';
    return;
  }

  const nextHoliday = state.holidays[0];
  const targetDate = new Date(nextHoliday.date);
  const today = new Date();
  const diffTime = targetDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (countdownEl) countdownEl.textContent = diffDays > 0 ? `${diffDays} Days` : 'Today!';
  if (nameEl) nameEl.textContent = nextHoliday.title;
  if (dashNameEl) dashNameEl.textContent = nextHoliday.title;
  if (dashDatesEl) dashDatesEl.textContent = `${nextHoliday.date} (${nextHoliday.duration})`;
}

function renderHolidaysUI(filter = 'all') {
  const container = document.getElementById('holidaysGrid');
  if (!container) return;
  container.innerHTML = '';

  const list = state.holidays.filter(h => filter === 'all' || h.type === filter);

  list.forEach(h => {
    const d = new Date(h.date);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();

    const card = document.createElement('div');
    card.className = 'holiday-card';
    card.innerHTML = `
      <div class="holiday-card-top">
        <div class="holiday-date-badge">
          <span class="h-month">${month}</span>
          <span class="h-day">${day}</span>
        </div>
        <div class="holiday-info">
          <h3>${h.title}</h3>
          <p>${h.description}</p>
        </div>
      </div>
      <div class="holiday-footer">
        <span><i data-lucide="clock"></i> Duration: <strong>${h.duration}</strong></span>
        <span class="badge ${h.type === 'Festival' ? 'badge-amber' : (h.type === 'Vacation' ? 'badge-purple' : 'badge-blue')}">${h.type}</span>
      </div>
    `;
    container.appendChild(card);
  });

  renderIcons();
}

function setupHolidaysHandlers() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderHolidaysUI(btn.getAttribute('data-filter'));
    });
  });
}

// ================= 5. PTM FUNCTIONALITY =================
async function loadPTMData() {
  try {
    const res = await fetch('/api/ptm');
    const data = await res.json();
    state.ptm = data;
    renderPTMUI();
  } catch (err) {
    console.error('Error loading PTM:', err);
  }
}

function renderPTMUI() {
  if (!state.ptm) return;
  const ptm = state.ptm;

  const teacherSelect = document.getElementById('ptmTeacherSelect');
  if (teacherSelect && ptm.teachers) {
    const curVal = teacherSelect.value;
    teacherSelect.innerHTML = '<option value="">-- Choose Teacher / Subject --</option>';
    ptm.teachers.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.subject}) - ${t.room}`;
      teacherSelect.appendChild(opt);
    });
    if (curVal) teacherSelect.value = curVal;
  }

  updateSlotPills();
  renderBookingsList();
  renderPTMFeedback();
  renderIcons();
}

function updateSlotPills() {
  const teacherSelect = document.getElementById('ptmTeacherSelect');
  const container = document.getElementById('slotSelectorPills');
  const hiddenInput = document.getElementById('selectedTimeSlot');
  if (!container || !teacherSelect) return;

  const teacherId = teacherSelect.value;
  container.innerHTML = '';
  hiddenInput.value = '';

  if (!teacherId || !state.ptm) {
    container.innerHTML = '<small style="color:var(--text-muted);">Select a teacher above to view available time slots.</small>';
    return;
  }

  const teacher = (state.ptm.teachers || []).find(t => t.id === teacherId);
  if (!teacher || (teacher.slotsAvailable || []).length === 0) {
    container.innerHTML = '<small style="color:var(--danger);font-weight:700;">No available slots remaining for this teacher.</small>';
    return;
  }

  teacher.slotsAvailable.forEach((slot, idx) => {
    const pill = document.createElement('div');
    pill.className = `slot-pill ${idx === 0 ? 'selected' : ''}`;
    pill.textContent = slot;

    if (idx === 0) hiddenInput.value = slot;

    pill.addEventListener('click', () => {
      document.querySelectorAll('.slot-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      hiddenInput.value = slot;
    });

    container.appendChild(pill);
  });
}

function renderBookingsList() {
  const container = document.getElementById('ptmBookingsList');
  const countBadge = document.getElementById('ptmBookingsCount');
  const dashCount = document.getElementById('dashPTMCount');
  if (!container || !state.ptm) return;

  container.innerHTML = '';
  const myBookings = state.currentStudent 
    ? (state.ptm.bookings || []).filter(b => b.studentName === state.currentStudent.name)
    : (state.ptm.bookings || []);

  if (countBadge) countBadge.textContent = `${myBookings.length} ${myBookings.length === 1 ? 'Meeting' : 'Meetings'}`;
  if (dashCount) dashCount.textContent = `${myBookings.length} Booked`;

  if (myBookings.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No appointments booked yet. Choose a teacher to schedule a discussion slot.</p>';
    return;
  }

  myBookings.forEach(b => {
    const item = document.createElement('div');
    item.className = 'ptm-booking-item';
    item.innerHTML = `
      <div class="booking-header">
        <span class="booking-title">${b.subject}</span>
        <span class="badge badge-green">${b.status}</span>
      </div>
      <div class="booking-details">
        <span><i data-lucide="user"></i> <strong>Teacher:</strong> ${b.teacherName}</span>
        <span><i data-lucide="clock"></i> <strong>Slot:</strong> ${b.timeSlot} (${b.date})</span>
        <span><i data-lucide="map-pin"></i> <strong>Venue:</strong> ${b.room} • Mode: ${b.mode}</span>
        <span><i data-lucide="message-square"></i> <strong>Agenda:</strong> ${b.topic}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.4rem;">
        <small style="color:var(--text-muted);">Parent: ${b.parentName}</small>
        <button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger);" onclick="cancelPTMBooking('${b.id}')">
          <i data-lucide="x-circle"></i> Cancel Slot
        </button>
      </div>
    `;
    container.appendChild(item);
  });

  renderIcons();
}

async function cancelPTMBooking(bookingId) {
  if (state.isFacultyPreview) return;
  if (!confirm('Are you sure you want to cancel this PTM appointment?')) return;
  try {
    const res = await fetch(`/api/ptm/cancel/${bookingId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      state.ptm = data.ptm;
      renderPTMUI();
      showToast('PTM slot cancelled.', 'info');
    }
  } catch (e) {
    showToast('Failed to cancel slot', 'error');
  }
}

function renderPTMFeedback() {
  const container = document.getElementById('ptmFeedbackGrid');
  if (!container || !state.ptm) return;
  container.innerHTML = '';

  const feedbackList = (state.ptm.pastFeedback || []).filter(
    fb => !state.currentStudent || !fb.studentName || fb.studentName === state.currentStudent.name
  );

  if (feedbackList.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No remarks recorded for your profile yet.</p>';
    return;
  }

  feedbackList.forEach(fb => {
    const stars = '★'.repeat(fb.rating) + '☆'.repeat(5 - fb.rating);
    const div = document.createElement('div');
    div.className = 'feedback-card';
    div.innerHTML = `
      <div class="feedback-header">
        <span class="feedback-teacher">${fb.teacher}</span>
        <span class="feedback-stars">${stars}</span>
      </div>
      <div class="feedback-remarks">"${fb.remarks}"</div>
      <div class="feedback-action"><strong>Action Item:</strong> ${fb.actionItems}</div>
    `;
    container.appendChild(div);
  });
}

function setupPTMHandlers() {
  const teacherSelect = document.getElementById('ptmTeacherSelect');
  if (teacherSelect) {
    teacherSelect.addEventListener('change', updateSlotPills);
  }

  const form = document.getElementById('ptmBookingForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.isFacultyPreview) return;
      const teacherId = document.getElementById('ptmTeacherSelect').value;
      const timeSlot = document.getElementById('selectedTimeSlot').value;
      const parentName = document.getElementById('ptmParentName').value.trim();
      const mode = document.getElementById('ptmMode').value;
      const topic = document.getElementById('ptmTopic').value.trim();

      if (!teacherId || !timeSlot) {
        showToast('Please select both a teacher and a time slot', 'error');
        return;
      }

      try {
        const res = await fetch('/api/ptm/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teacherId,
            timeSlot,
            parentName,
            studentName: state.currentStudent ? state.currentStudent.name : 'Student',
            mode,
            topic
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          state.ptm = data.ptm;
          renderPTMUI();
          showToast(`🎉 PTM slot booked successfully with ${data.booking.teacherName}!`, 'success');
          form.reset();
        } else {
          showToast(data.error || 'Failed to book slot', 'error');
        }
      } catch (err) {
        showToast('Error booking PTM slot', 'error');
      }
    });
  }
}

// ================= 6. EXAM SYLLABUS FUNCTIONALITY =================
async function loadExamsData() {
  try {
    const res = await fetch('/api/exams');
    const data = await res.json();
    state.exams = data;
    renderExamsUI();
  } catch (err) {
    console.error('Error loading exams:', err);
  }
}

function renderExamsUI() {
  if (!state.exams) return;
  const exams = state.exams;
  const examTitle = document.getElementById('activeExamTitle');
  if (examTitle) {
    examTitle.textContent = exams.title || 'Mid-Term Examination (Term 1) 2026 Timetable';
  }
  const syllabusStatus = document.getElementById('studentSyllabusStatus');
  const syllabusOpen = exams.syllabusOpen !== false;
  if (syllabusStatus) {
    syllabusStatus.className = `badge badge-pill ${syllabusOpen ? 'badge-green' : 'badge-red'}`;
    syllabusStatus.textContent = syllabusOpen ? 'Syllabus Open' : 'Syllabus Closed';
  }
  const openView = document.getElementById('examOpenView');
  const closedView = document.getElementById('examClosedView');
  if (openView) openView.hidden = !syllabusOpen;
  if (closedView) closedView.hidden = syllabusOpen;
  if (!syllabusOpen) return;

  // Timetable
  const timetableBody = document.getElementById('examTimetableBody');
  if (timetableBody) {
    timetableBody.innerHTML = '';
    const timetable = exams.timetable || [];
    if (timetable.length === 0) {
      const row = document.createElement('tr');
      const emptyState = document.createElement('td');
      emptyState.colSpan = 7;
      emptyState.className = 'exam-timetable-empty';
      emptyState.textContent = 'The exam datesheet has not been published yet.';
      row.appendChild(emptyState);
      timetableBody.appendChild(row);
    }
    timetable.forEach(t => {
      const tr = document.createElement('tr');
      const dateCell = document.createElement('td');
      const date = document.createElement('strong');
      date.textContent = t.date || '';
      dateCell.appendChild(date);
      const dayCell = document.createElement('td');
      dayCell.textContent = t.day || '';
      const subjectCell = document.createElement('td');
      const subject = document.createElement('strong');
      subject.textContent = t.subject || '';
      subjectCell.appendChild(subject);
      const codeCell = document.createElement('td');
      const code = document.createElement('code');
      code.textContent = t.code || '';
      codeCell.appendChild(code);
      const timeCell = document.createElement('td');
      timeCell.textContent = t.time || '';
      const roomCell = document.createElement('td');
      roomCell.textContent = t.room || '';
      const marksCell = document.createElement('td');
      const marksBadge = document.createElement('span');
      marksBadge.className = 'badge badge-purple';
      marksBadge.textContent = `${t.maxMarks || 0} Marks`;
      marksCell.appendChild(marksBadge);
      tr.append(dateCell, dayCell, subjectCell, codeCell, timeCell, roomCell, marksCell);
      timetableBody.appendChild(tr);
    });
  }
  renderIcons();
}

function setupSyllabusHandlers() {
  const printBtn = document.getElementById('printSyllabusBtn');
  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }
}

// Utility: HTML escaping
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// Global expose
window.switchTab = switchTab;
window.cancelPTMBooking = cancelPTMBooking;
