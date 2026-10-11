// =======================================================
// EDUPULSE - DEDICATED TEACHER & ADMIN CONTROL CENTER SCRIPT
// =======================================================

const adminState = {
  admin: null,
  students: [],
  hasLoadedOverview: false,
  leaves: [],
  ptmBookings: [],
  announcements: [],
  holidays: [],
  facultyAccounts: [],
  syllabusSubjects: [],
  syllabusOpen: true,
  datesheetTitle: '',
  datesheetEntries: [],
  chatChannels: [],
  chatMessages: [],
  chatReports: [],
  activeChatChannel: 'general'
};

// ================= THEME INITIALIZATION =================
function initTheme() {
  const saved = localStorage.getItem('edupulse_theme') || 'light';
  applyTheme(saved);

  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const next = cur === 'dark' ? 'light' : 'dark';
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

// Quick demo fill for faculty
window.fillAdminDemo = function() {
  document.getElementById('adminEmail').value = 'admin@school.edu';
  document.getElementById('adminPassword').value = 'admin123';
};

// ================= SOCKET.IO LIVE CONNECTION =================
let socket = null;
try {
  socket = io();
  socket.on('connect', syncAdminPresence);
  socket.on('students_updated', () => loadAdminData());
  socket.on('leave_updated', () => loadAdminData());
  socket.on('attendance_updated', () => loadAdminData());
  socket.on('ptm_updated', () => loadAdminData());
  socket.on('new_announcement', () => loadAdminData());
  socket.on('holidays_updated', () => loadAdminHolidays());
  socket.on('syllabus_updated', () => loadAdminSubjects());
  socket.on('faculty_updated', () => loadFacultyAccounts());
  socket.on('new_message_global', message => {
    if (adminState.admin && message.channelId === adminState.activeChatChannel) loadAdminChatMessages();
  });
  socket.on('message_updated', message => {
    if (adminState.admin && message.channelId === adminState.activeChatChannel) loadAdminChatMessages();
  });
  socket.on('message_deleted', () => {
    if (adminState.admin) loadAdminChatMessages();
  });
  socket.on('chat_cleared', ({ channelId }) => {
    if (adminState.admin && channelId === adminState.activeChatChannel) loadAdminChatMessages();
  });
  socket.on('chat_report_created', () => {
    if (adminState.admin) loadAdminChatReports();
  });
  socket.on('chat_report_updated', () => {
    if (adminState.admin) loadAdminChatReports();
  });
  socket.on('syllabus_updated', () => {
    if (adminState.admin) loadAdminSubjects();
  });
} catch (e) {
  console.warn('Socket connection note:', e);
}

function syncAdminPresence() {
  if (socket && socket.connected && adminState.admin) {
    socket.emit('identify_user', { userId: adminState.admin.id });
  }
}

// ================= DOM READY & AUTHENTICATION GATE =================
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupAdminAuth();
  setupAdminForms();
  setupAddStudentModal();
  setupAdminChatManager();
  setupAdminSubjectManager();
  setupFacultyAccountManager();

  // Check stored admin session
  const adminId = localStorage.getItem('edupulse_admin_id');
  if (adminId) {
    await verifyAdminSession(adminId);
  } else {
    showAdminAuthScreen();
  }
  await loadAdminHolidays();

  // Set today's date in attendance form
  const attendDate = document.getElementById('attendDate');
  if (attendDate) {
    attendDate.value = new Date().toISOString().split('T')[0];
  }

  renderIcons();
});

function showAdminAuthScreen() {
  document.getElementById('adminAuthScreen').style.display = 'flex';
  document.getElementById('adminAppLayout').style.display = 'none';
  renderIcons();
}

function showAdminPortal() {
  document.getElementById('adminAuthScreen').style.display = 'none';
  document.getElementById('adminAppLayout').style.display = 'flex';
  renderIcons();
}

async function verifyAdminSession(adminId) {
  try {
    const res = await fetch('/api/auth/admin/me', {
      headers: { 'x-admin-id': adminId }
    });
    const data = await res.json();
    if (data.success && data.admin) {
      adminState.admin = data.admin;
      updateAdminProfileUI();
      showAdminPortal();
      await loadAdminData();
      await loadAdminChatChannels();
      await loadAdminSubjects();
      await loadFacultyAccounts();
    } else {
      localStorage.removeItem('edupulse_admin_id');
      showAdminAuthScreen();
    }
  } catch (err) {
    showAdminAuthScreen();
  }
}

function setupAdminAuth() {
  const loginForm = document.getElementById('adminLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('adminEmail').value.trim();
      const password = document.getElementById('adminPassword').value;

      try {
        const res = await fetch('/api/auth/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.success) {
          adminState.admin = data.admin;
          localStorage.setItem('edupulse_admin_id', data.admin.id);
          localStorage.setItem('edupulse_admin_token', data.token);

          updateAdminProfileUI();
          showAdminPortal();
          await loadAdminData();
          await loadAdminChatChannels();
          await loadAdminSubjects();
          await loadFacultyAccounts();
          showToast(`Welcome, ${data.admin.name}! Faculty session active.`, 'success');
        } else {
          showToast(data.error || 'Authentication failed', 'error');
        }
      } catch (err) {
        showToast('Server connection error', 'error');
      }
    });
  }

  const logoutBtn = document.getElementById('adminLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('edupulse_admin_id');
      localStorage.removeItem('edupulse_admin_token');
      if (socket) socket.emit('leave_presence');
      adminState.admin = null;
      showToast('Logged out of Faculty Admin portal', 'info');
      showAdminAuthScreen();
    });
  }

  const studentPreviewBtn = document.getElementById('studentPreviewBtn');
  if (studentPreviewBtn) {
    studentPreviewBtn.addEventListener('click', () => {
      if (!adminState.admin) {
        showToast('Sign in to the faculty panel before switching views.', 'error');
        return;
      }
      localStorage.setItem('edupulse_faculty_preview', 'true');
      window.location.href = '/';
    });
  }
}

function updateAdminProfileUI() {
  if (!adminState.admin) return;
  const a = adminState.admin;

  const nameEl = document.getElementById('adminName');
  const avatarEl = document.getElementById('adminAvatar');
  const subEl = document.getElementById('adminSub');

  if (nameEl) nameEl.textContent = a.name;
  if (avatarEl) avatarEl.src = a.avatar;
  if (subEl) subEl.textContent = `${a.subject || 'Faculty'} • ${a.room || 'Cabin'}`;
  syncAdminPresence();
}

function setupAdminChatManager() {
  const channelSelect = document.getElementById('adminChatChannel');
  const clearButton = document.getElementById('clearChatBtn');
  if (channelSelect) {
    channelSelect.addEventListener('change', () => {
      adminState.activeChatChannel = channelSelect.value;
      loadAdminChatMessages();
    });
  }
  if (clearButton) clearButton.addEventListener('click', clearAdminChat);
  document.getElementById('adminChatReportsJump')?.addEventListener('click', () => {
    document.getElementById('adminChatReportsTitle')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  loadAdminChatReports();
}

async function loadAdminChatChannels() {
  if (!adminState.admin) return;
  try {
    const response = await fetch('/api/chat/channels');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load chat channels');

    adminState.chatChannels = data.channels || [];
    const select = document.getElementById('adminChatChannel');
    if (!select) return;
    select.replaceChildren();
    adminState.chatChannels.forEach(channel => {
      const option = document.createElement('option');
      option.value = channel.id;
      option.textContent = channel.name;
      select.appendChild(option);
    });

    if (!adminState.chatChannels.some(channel => channel.id === adminState.activeChatChannel)) {
      adminState.activeChatChannel = adminState.chatChannels[0]?.id || '';
    }
    select.value = adminState.activeChatChannel;
    await loadAdminChatMessages();
    await loadAdminChatReports();
  } catch (error) {
    showToast(error.message || 'Could not load chat channels', 'error');
  }
}

async function loadAdminChatMessages() {
  if (!adminState.admin || !adminState.activeChatChannel) return;
  try {
    const response = await fetch(`/api/admin/chat/messages?channel=${encodeURIComponent(adminState.activeChatChannel)}`, {
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load chat messages');
    adminState.chatMessages = data.messages || [];
    renderAdminChatMessages();
  } catch (error) {
    showToast(error.message || 'Could not load chat messages', 'error');
  }
}

async function loadAdminChatReports() {
  if (!adminState.admin) return;
  try {
    const response = await fetch('/api/admin/chat/reports', {
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load chat reports');
    adminState.chatReports = data.reports || [];
    renderAdminChatReports();
  } catch (error) {
    showToast(error.message || 'Could not load chat reports', 'error');
  }
}

function renderAdminChatReports() {
  const list = document.getElementById('adminChatReports');
  const count = document.getElementById('adminChatReportCount');
  if (!list) return;
  list.replaceChildren();
  if (count) count.textContent = `${adminState.chatReports.length} pending`;
  const shortcutCount = document.getElementById('adminChatReportShortcutCount');
  if (shortcutCount) shortcutCount.textContent = adminState.chatReports.length;

  if (!adminState.chatReports.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'admin-chat-empty';
    emptyState.textContent = 'No pending reports. New student reports will appear here.';
    list.appendChild(emptyState);
    return;
  }

  const reasonLabels = {
    bullying: 'Bullying or harassment',
    inappropriate: 'Inappropriate content',
    spam: 'Spam or disruption',
    other: 'Other safety concern'
  };
  adminState.chatReports.forEach(report => {
    const row = document.createElement('article');
    row.className = 'admin-chat-report';
    const content = document.createElement('div');
    content.className = 'admin-chat-content';
    const meta = document.createElement('div');
    meta.className = 'admin-chat-meta';
    const reporter = document.createElement('strong');
    reporter.textContent = report.reporterName || 'Student';
    const reason = document.createElement('span');
    reason.className = 'badge badge-amber';
    reason.textContent = reasonLabels[report.reason] || 'Other safety concern';
    const timestamp = document.createElement('time');
    timestamp.textContent = report.createdAt ? new Date(report.createdAt).toLocaleString() : '';
    meta.append(reporter, reason, timestamp);

    const snapshot = report.messageSnapshot || {};
    const messageMeta = document.createElement('div');
    messageMeta.className = 'admin-chat-meta admin-chat-reported-sender';
    const sender = document.createElement('strong');
    sender.textContent = snapshot.senderName || 'Unknown user';
    const role = document.createElement('span');
    const isTeacher = snapshot.senderRole === 'Teacher';
    role.className = `badge ${isTeacher ? 'badge-teacher' : 'badge-student'}`;
    role.textContent = isTeacher ? 'Teacher' : 'Student';
    messageMeta.append(sender, role);

    const messageText = document.createElement('p');
    messageText.textContent = snapshot.text || (snapshot.attachmentName ? `Attachment: ${snapshot.attachmentName}` : 'Attachment or empty message');
    content.append(meta, messageMeta, messageText);
    if (report.details) {
      const details = document.createElement('p');
      details.className = 'admin-chat-report-details';
      details.textContent = `Student details: ${report.details}`;
      content.appendChild(details);
    }

    const actions = document.createElement('div');
    actions.className = 'admin-chat-report-actions';
    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'btn btn-sm btn-secondary';
    dismissButton.textContent = 'Dismiss';
    dismissButton.addEventListener('click', () => reviewAdminChatReport(report, 'dismissed'));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn-sm btn-danger';
    deleteButton.textContent = 'Delete message';
    deleteButton.disabled = report.messageAvailable === false;
    deleteButton.title = deleteButton.disabled ? 'This message is no longer available' : 'Delete reported message';
    deleteButton.addEventListener('click', () => deleteReportedChatMessage(report));
    actions.append(dismissButton, deleteButton);
    row.append(content, actions);
    list.appendChild(row);
  });
}

async function reviewAdminChatReport(report, status) {
  try {
    const response = await fetch(`/api/admin/chat/reports/${encodeURIComponent(report.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-id': adminState.admin.id
      },
      body: JSON.stringify({ status })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not review report');
    adminState.chatReports = adminState.chatReports.filter(item => item.id !== report.id);
    renderAdminChatReports();
    showToast('Report dismissed.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not review report', 'error');
  }
}

async function deleteReportedChatMessage(report) {
  const senderName = report.messageSnapshot?.senderName || 'unknown user';
  if (!window.confirm(`Delete this reported message from ${senderName}? This cannot be undone.`)) return;
  await deleteAdminChatMessage({ id: report.messageId, senderName });
}

function renderAdminChatMessages() {
  const list = document.getElementById('adminChatMessages');
  const count = document.getElementById('adminChatMessageCount');
  const clearButton = document.getElementById('clearChatBtn');
  if (!list) return;
  list.replaceChildren();
  if (count) count.textContent = `${adminState.chatMessages.length} message${adminState.chatMessages.length === 1 ? '' : 's'}`;
  if (clearButton) clearButton.disabled = adminState.chatMessages.length === 0;

  if (!adminState.chatMessages.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'admin-chat-empty';
    emptyState.textContent = 'No messages in this channel.';
    list.appendChild(emptyState);
    return;
  }

  [...adminState.chatMessages].reverse().forEach(message => {
    const row = document.createElement('article');
    row.className = 'admin-chat-row';
    const content = document.createElement('div');
    content.className = 'admin-chat-content';
    const meta = document.createElement('div');
    meta.className = 'admin-chat-meta';
    const sender = document.createElement('strong');
    sender.textContent = message.senderName || 'Unknown user';
    const role = document.createElement('span');
    const isTeacher = message.senderRole === 'Teacher';
    role.className = `badge ${isTeacher ? 'badge-teacher' : 'badge-student'}`;
    role.textContent = isTeacher ? 'Teacher' : 'Student';
    const timestamp = document.createElement('time');
    timestamp.textContent = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
    meta.append(sender, role, timestamp);
    const text = document.createElement('p');
    text.textContent = message.text || (message.attachment ? `Attachment: ${message.attachment.name || 'file'}` : 'Empty message');
    content.append(meta, text);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn-icon admin-chat-delete';
    deleteButton.title = 'Delete message';
    deleteButton.setAttribute('aria-label', `Delete message from ${message.senderName || 'unknown user'}`);
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteButton.addEventListener('click', () => deleteAdminChatMessage(message));
    row.append(content, deleteButton);
    list.appendChild(row);
  });
  renderIcons();
}

async function deleteAdminChatMessage(message) {
  if (!window.confirm(`Delete this message from ${message.senderName || 'unknown user'}?`)) return;
  try {
    const response = await fetch(`/api/admin/chat/messages/${encodeURIComponent(message.id)}`, {
      method: 'DELETE',
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not delete message');
    adminState.chatMessages = adminState.chatMessages.filter(item => item.id !== data.messageId);
    renderAdminChatMessages();
    await loadAdminChatReports();
    showToast('Chat message deleted.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not delete message', 'error');
  }
}

async function clearAdminChat() {
  const channel = adminState.chatChannels.find(item => item.id === adminState.activeChatChannel);
  if (!channel || !adminState.chatMessages.length) return;
  if (!window.confirm(`Delete all ${adminState.chatMessages.length} messages from "${channel.name}"? This cannot be undone.`)) return;
  try {
    const response = await fetch(`/api/admin/chat/channels/${encodeURIComponent(channel.id)}/messages`, {
      method: 'DELETE',
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not clear chat');
    adminState.chatMessages = [];
    renderAdminChatMessages();
    await loadAdminChatReports();
    showToast(`Cleared ${data.deletedCount} messages from ${channel.name}.`, 'success');
  } catch (error) {
    showToast(error.message || 'Could not clear chat', 'error');
  }
}

// ================= LOAD DATA & RENDER =================
async function loadAdminData() {
  try {
    if (!adminState.admin) throw new Error('Admin authentication required');
    const res = await fetch('/api/admin/overview', {
      headers: { 'x-admin-id': adminState.admin.id }
    });
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || `Could not load admin overview (${res.status})`);
    }
    const data = await res.json();

    adminState.students = data.students || [];
    adminState.leaves = data.leaves || [];
    adminState.ptmBookings = data.ptmBookings || [];
    adminState.announcements = data.announcements || [];

    renderAdminStats();
    renderStudentRoster();
    populateStudentAttendanceSelect();
    renderLeaveApprovals();
    adminState.hasLoadedOverview = true;
  } catch (err) {
    console.error('Error loading admin overview:', err);
    if (!adminState.hasLoadedOverview) {
      const tbody = document.getElementById('studentRosterTableBody');
      if (tbody) {
        tbody.innerHTML = '';
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.style.cssText = 'text-align:center;color:var(--danger);padding:1.5rem;';
        cell.textContent = err.message || 'Could not load students. Please refresh and try again.';
        row.appendChild(cell);
        tbody.appendChild(row);
      }
      showToast(err.message || 'Could not load admin data', 'error');
    }
  }
}

function renderAdminStats() {
  const statStd = document.getElementById('statStudentCount');
  const statLev = document.getElementById('statPendingLeaves');
  const statPTM = document.getElementById('statPTMBookings');
  const statNot = document.getElementById('statNoticesCount');
  const badgeLev = document.getElementById('leaveBadge');

  const pendingLeaves = adminState.leaves.filter(l => l.status === 'Pending Approval').length;

  if (statStd) statStd.textContent = adminState.students.length;
  if (statLev) statLev.textContent = pendingLeaves;
  if (statPTM) statPTM.textContent = adminState.ptmBookings.length;
  if (statNot) statNot.textContent = adminState.announcements.length;
  if (badgeLev) badgeLev.textContent = `${pendingLeaves} Pending`;
}

function renderStudentRoster() {
  const tbody = document.getElementById('studentRosterTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (adminState.students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No students registered yet. Click "+ Register New Student" above.</td></tr>';
    return;
  }

  adminState.students.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:0.6rem;">
          <img src="${s.avatar}" style="width:30px;height:30px;border-radius:50%;border:1px solid var(--border-color);">
          <strong>${s.name}</strong>
        </div>
      </td>
      <td><code>${s.rollNo}</code></td>
      <td>${s.grade}</td>
      <td><span class="badge badge-purple">${s.house || 'Phoenix'}</span></td>
      <td>${s.email}</td>
      <td>
        <div style="display:flex;gap:0.4rem;">
          <button class="btn btn-sm btn-outline" onclick="resetStudentPassword('${s.id}', '${s.name}')" title="Reset Password">
            <i data-lucide="key"></i> Reset
          </button>
          <button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger);" onclick="deleteStudent('${s.id}')" title="Delete Student">
            <i data-lucide="trash-2"></i> Remove
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderIcons();
}

function populateStudentAttendanceSelect() {
  const select = document.getElementById('attendStudentSelect');
  if (!select) return;

  const curVal = select.value;
  select.innerHTML = '<option value="">-- Choose Student --</option>';

  adminState.students.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} (Roll: ${s.rollNo} - ${s.grade})`;
    select.appendChild(opt);
  });

  if (curVal) select.value = curVal;
}

function renderLeaveApprovals() {
  const container = document.getElementById('adminLeavesContainer');
  if (!container) return;
  container.innerHTML = '';

  const pending = adminState.leaves.filter(l => l.status === 'Pending Approval');
  if (pending.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:0.75rem;">✅ All student leave applications have been reviewed.</p>';
    return;
  }

  pending.forEach(l => {
    const div = document.createElement('div');
    div.className = 'admin-leave-card';
    div.innerHTML = `
      <div class="admin-leave-header">
        <span class="admin-leave-student">${l.studentName || 'Student'} (${l.type})</span>
        <span class="badge badge-amber">Pending</span>
      </div>
      <div style="font-size:0.85rem;color:var(--text-secondary);">${l.reason}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);">Duration: <strong>${l.startDate}</strong> to <strong>${l.endDate}</strong> • Applied: ${l.appliedOn}</div>
      <div class="admin-leave-actions">
        <button class="btn btn-sm btn-success" onclick="reviewLeave('${l.id}', 'Approved')">
          <i data-lucide="check"></i> Approve Leave
        </button>
        <button class="btn btn-sm btn-danger" onclick="reviewLeave('${l.id}', 'Rejected')">
          <i data-lucide="x"></i> Reject
        </button>
      </div>
    `;
    container.appendChild(div);
  });

  renderIcons();
}

// Actions
window.reviewLeave = async function(leaveId, status) {
  try {
    const res = await fetch(`/api/admin/leaves/${leaveId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Leave application ${status.toLowerCase()}!`, status === 'Approved' ? 'success' : 'info');
      await loadAdminData();
    }
  } catch (e) {
    showToast('Failed to review leave', 'error');
  }
};

window.deleteStudent = async function(studentId) {
  if (!confirm('Are you sure you want to remove this student from the portal?')) return;
  try {
    const res = await fetch(`/api/admin/students/${studentId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Student removed from roster', 'info');
      await loadAdminData();
    }
  } catch (e) {
    showToast('Failed to remove student', 'error');
  }
};

window.resetStudentPassword = async function(studentId, studentName) {
  const newPass = prompt(`Enter new password for ${studentName}:`, 'password123');
  if (!newPass) return;

  try {
    const res = await fetch(`/api/admin/students/${studentId}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: newPass })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Password updated for ${studentName}!`, 'success');
    }
  } catch (e) {
    showToast('Failed to update password', 'error');
  }
};

// ================= ADMIN FORMS SETUP =================
function setupAdminForms() {
  // 1. Mark Attendance
  const attendForm = document.getElementById('markAttendanceForm');
  if (attendForm) {
    attendForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const studentId = document.getElementById('attendStudentSelect').value;
      const date = document.getElementById('attendDate').value;
      const status = document.getElementById('attendStatus').value;
      const remarks = document.getElementById('attendRemarks').value;

      if (!studentId) {
        showToast('Please select a student', 'error');
        return;
      }

      const student = adminState.students.find(s => s.id === studentId);

      try {
        const res = await fetch('/api/admin/attendance/mark', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-id': adminState.admin.id
          },
          body: JSON.stringify({
            studentId,
            studentName: student ? student.name : 'Student',
            date,
            status,
            remarks
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to record attendance');
        if (data.success) {
          showToast(`Attendance marked as ${status} for ${student ? student.name : 'Student'}!`, 'success');
          attendForm.reset();
          document.getElementById('attendDate').value = new Date().toISOString().split('T')[0];
        }
      } catch (err) {
        showToast(err.message || 'Failed to record attendance', 'error');
      }
    });
  }

  // 2. Broadcast Announcement
  const noticeForm = document.getElementById('announcementForm');
  if (noticeForm) {
    noticeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('noticeTitle').value.trim();
      const category = document.getElementById('noticeCategory').value;
      const content = document.getElementById('noticeContent').value.trim();

      try {
        const res = await fetch('/api/admin/announcements', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-id': adminState.admin.id
          },
          body: JSON.stringify({ title, category, content })
        });
        const data = await res.json();
        if (data.success) {
          showToast('📢 Official Announcement broadcasted live!', 'success');
          noticeForm.reset();
          await loadAdminData();
        }
      } catch (e) {
        showToast('Failed to publish notice', 'error');
      }
    });
  }

  // 3. PTM Feedback
  const ptmForm = document.getElementById('ptmFeedbackForm');
  if (ptmForm) {
    ptmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const studentName = document.getElementById('feedbackStudentName').value.trim();
      const rating = document.getElementById('feedbackRating').value;
      const remarks = document.getElementById('feedbackRemarks').value.trim();
      const actionItems = document.getElementById('feedbackAction').value.trim();

      try {
        const res = await fetch('/api/admin/ptm/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentName, rating, remarks, actionItems })
        });
        const data = await res.json();
        if (data.success) {
          showToast('PTM academic observations saved for student!', 'success');
          ptmForm.reset();
        }
      } catch (e) {
        showToast('Failed to save feedback', 'error');
      }
    });
  }

  // 4. Declare Holiday
  const holForm = document.getElementById('holidayForm');
  if (holForm) {
    holForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('holidayTitle').value.trim();
      const type = document.getElementById('holidayType').value;
      const date = document.getElementById('holidayDate').value;
      const duration = document.getElementById('holidayDuration').value.trim();
      const description = document.getElementById('holidayDesc').value.trim();

      try {
        const res = await fetch('/api/admin/holidays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, type, date, duration, description })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Holiday added to School Calendar!', 'success');
          holForm.reset();
          await loadAdminHolidays();
        }
      } catch (e) {
        showToast('Failed to add holiday', 'error');
      }
    });
  }
}

function setupFacultyAccountManager() {
  const form = document.getElementById('facultyAccountForm');
  if (!form) return;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!adminState.admin) return;

    const account = {
      name: document.getElementById('facultyName').value.trim(),
      email: document.getElementById('facultyEmail').value.trim(),
      role: document.getElementById('facultyRole').value,
      password: document.getElementById('facultyPassword').value,
      subject: document.getElementById('facultySubject').value.trim(),
      room: document.getElementById('facultyRoom').value.trim()
    };

    try {
      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': adminState.admin.id },
        body: JSON.stringify(account)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create faculty account');
      adminState.facultyAccounts = data.accounts || [];
      renderFacultyAccounts();
      form.reset();
      showToast(`${data.account.role} account created for ${data.account.name}.`, 'success');
    } catch (error) {
      showToast(error.message || 'Could not create faculty account', 'error');
    }
  });
}

async function loadFacultyAccounts() {
  if (!adminState.admin) return;
  try {
    const response = await fetch('/api/admin/accounts', {
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load faculty accounts');
    adminState.facultyAccounts = data.accounts || [];
    renderFacultyAccounts();
  } catch (error) {
    showToast(error.message || 'Could not load faculty accounts', 'error');
  }
}

function renderFacultyAccounts() {
  const list = document.getElementById('facultyAccountList');
  if (!list) return;
  list.replaceChildren();

  if (!adminState.facultyAccounts.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'admin-holiday-empty';
    emptyState.textContent = 'No teacher or admin accounts have been created.';
    list.appendChild(emptyState);
    return;
  }

  adminState.facultyAccounts.forEach(account => {
    const row = document.createElement('div');
    row.className = 'admin-holiday-row';
    const details = document.createElement('div');
    details.className = 'admin-holiday-details';
    const title = document.createElement('strong');
    title.textContent = account.name || 'Faculty';
    const meta = document.createElement('span');
    const detailsText = [account.email, account.role, account.subject, account.room].filter(Boolean).join(' · ');
    meta.textContent = detailsText;
    details.append(title, meta);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn-icon admin-holiday-delete';
    deleteButton.setAttribute('aria-label', `Delete faculty account for ${account.name || account.email}`);
    deleteButton.title = account.id === adminState.admin?.id
      ? 'You cannot delete your signed-in account'
      : (adminState.facultyAccounts.length <= 1 ? 'At least one faculty account must remain' : 'Delete faculty account');
    deleteButton.disabled = account.id === adminState.admin?.id || adminState.facultyAccounts.length <= 1;
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteButton.addEventListener('click', () => deleteFacultyAccount(account));

    row.append(details, deleteButton);
    list.appendChild(row);
  });
  renderIcons();
}

async function deleteFacultyAccount(account) {
  if (account.id === adminState.admin?.id || adminState.facultyAccounts.length <= 1) return;
  if (!window.confirm(`Delete the ${account.role} account for ${account.name} (${account.email})? This cannot be undone.`)) return;

  try {
    const response = await fetch(`/api/admin/accounts/${encodeURIComponent(account.id)}`, {
      method: 'DELETE',
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not delete faculty account');
    adminState.facultyAccounts = data.accounts || [];
    renderFacultyAccounts();
    showToast(`${account.name}'s faculty account was deleted.`, 'success');
  } catch (error) {
    showToast(error.message || 'Could not delete faculty account', 'error');
  }
}

function setupAdminSubjectManager() {
  const form = document.getElementById('subjectForm');
  const datesheetForm = document.getElementById('datesheetForm');
  const statusButton = document.getElementById('toggleSyllabusStatusBtn');
  if (statusButton) statusButton.addEventListener('click', toggleSyllabusStatus);
  setupAdminDatesheetManager(datesheetForm);
  if (!form) return;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!adminState.admin) return;

    const subject = document.getElementById('subjectName').value.trim();
    const code = document.getElementById('subjectCode').value.trim();
    const teacher = document.getElementById('subjectTeacher').value.trim();
    const totalWeightage = document.getElementById('subjectWeightage').value.trim();
    try {
      const response = await fetch('/api/admin/exams/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': adminState.admin.id },
        body: JSON.stringify({ subject, code, teacher, totalWeightage })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add subject');
      adminState.syllabusSubjects = data.subjects || [];
      adminState.syllabusOpen = data.syllabusOpen !== false;
      renderAdminSubjects();
      renderDatesheetSubjectOptions();
      form.reset();
      showToast(`${data.subject.subject} added to the syllabus.`, 'success');
    } catch (error) {
      showToast(error.message || 'Could not add subject', 'error');
    }
  });
}

async function loadAdminSubjects() {
  if (!adminState.admin) return;
  try {
    const response = await fetch('/api/admin/exams/subjects', {
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load syllabus');
    adminState.syllabusSubjects = data.subjects || [];
    adminState.syllabusOpen = data.syllabusOpen !== false;
    renderAdminSubjects();
    await loadAdminDatesheet();
  } catch (error) {
    showToast(error.message || 'Could not load syllabus subjects', 'error');
  }
}

function renderAdminSubjects() {
  updateSyllabusEditingControls();
  renderDatesheetSubjectOptions();
  const list = document.getElementById('adminSubjectList');
  if (!list) return;
  list.replaceChildren();

  if (!adminState.syllabusSubjects.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'admin-holiday-empty';
    emptyState.textContent = 'No exam syllabus subjects have been added.';
    list.appendChild(emptyState);
    return;
  }

  adminState.syllabusSubjects.forEach(subject => {
    const row = document.createElement('div');
    row.className = 'admin-holiday-row';
    const details = document.createElement('div');
    details.className = 'admin-holiday-details';
    const title = document.createElement('strong');
    title.textContent = `${subject.subject} (${subject.code})`;
    const meta = document.createElement('span');
    meta.textContent = `${subject.teacher || 'Faculty'} · ${subject.totalWeightage || 'Weightage not set'} · ${(subject.sources || []).join(', ')}`;
    details.append(title, meta);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn-icon admin-holiday-delete';
    deleteButton.title = `Delete ${subject.subject}`;
    deleteButton.setAttribute('aria-label', deleteButton.title);
    deleteButton.disabled = !adminState.syllabusOpen;
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteButton.addEventListener('click', () => deleteAdminSubject(subject));
    row.append(details, deleteButton);
    list.appendChild(row);
  });
  renderIcons();
}

function updateSyllabusEditingControls() {
  const isOpen = adminState.syllabusOpen !== false;
  const badge = document.getElementById('syllabusStatusBadge');
  const toggleButton = document.getElementById('toggleSyllabusStatusBtn');
  const form = document.getElementById('subjectForm');
  const datesheetForm = document.getElementById('datesheetForm');

  if (badge) {
    badge.className = `badge badge-pill ${isOpen ? 'badge-green' : 'badge-red'}`;
    badge.textContent = isOpen ? 'Syllabus Open' : 'Syllabus Closed';
  }
  if (toggleButton) {
    toggleButton.textContent = isOpen ? 'Close Syllabus Editing' : 'Open Syllabus Editing';
    toggleButton.setAttribute('aria-pressed', String(!isOpen));
  }
  if (form) form.querySelectorAll('input, button').forEach(control => { control.disabled = !isOpen; });
  if (datesheetForm) datesheetForm.querySelectorAll('input, select, button').forEach(control => { control.disabled = !isOpen; });
  document.querySelectorAll('#adminSubjectList .admin-holiday-delete').forEach(button => { button.disabled = !isOpen; });
  document.querySelectorAll('#adminDatesheetBody button').forEach(button => { button.disabled = !isOpen; });
}

function setupAdminDatesheetManager(form) {
  if (!form) return;
  const cancelButton = document.getElementById('datesheetCancelEditBtn');
  cancelButton?.addEventListener('click', resetDatesheetForm);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!adminState.admin) return;

    const subject = adminState.syllabusSubjects.find(item => item.code === document.getElementById('datesheetSubject').value);
    if (!subject) {
      showToast('Choose a subject from the syllabus.', 'error');
      return;
    }
    const payload = {
      title: document.getElementById('datesheetExamTitle').value.trim(),
      date: document.getElementById('datesheetDate').value,
      subject: subject.subject,
      code: subject.code,
      time: document.getElementById('datesheetTime').value.trim(),
      room: document.getElementById('datesheetRoom').value.trim(),
      maxMarks: Number(document.getElementById('datesheetMaxMarks').value)
    };
    const editId = form.dataset.editId;
    const endpoint = editId
      ? `/api/admin/exams/datesheet/${encodeURIComponent(editId)}`
      : '/api/admin/exams/datesheet';
    try {
      const response = await fetch(endpoint, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-id': adminState.admin.id },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save exam datesheet');
      adminState.datesheetTitle = data.title || payload.title;
      adminState.datesheetEntries = data.timetable || [];
      renderAdminDatesheet();
      resetDatesheetForm();
      showToast(editId ? 'Exam datesheet entry updated.' : 'Exam added to the datesheet.', 'success');
    } catch (error) {
      showToast(error.message || 'Could not save exam datesheet', 'error');
    }
  });
}

async function loadAdminDatesheet() {
  if (!adminState.admin) return;
  try {
    const response = await fetch('/api/admin/exams/datesheet', {
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load exam datesheet');
    adminState.datesheetTitle = data.title || '';
    adminState.datesheetEntries = data.timetable || [];
    const titleInput = document.getElementById('datesheetExamTitle');
    if (titleInput && !document.getElementById('datesheetForm')?.dataset.editId) {
      titleInput.value = adminState.datesheetTitle;
    }
    renderAdminDatesheet();
  } catch (error) {
    showToast(error.message || 'Could not load exam datesheet', 'error');
  }
}

function renderDatesheetSubjectOptions() {
  const select = document.getElementById('datesheetSubject');
  if (!select) return;
  const selectedCode = select.value;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a subject';
  select.appendChild(placeholder);
  adminState.syllabusSubjects.forEach(subject => {
    const option = document.createElement('option');
    option.value = subject.code;
    option.textContent = `${subject.subject} (${subject.code})`;
    select.appendChild(option);
  });
  if (adminState.syllabusSubjects.some(subject => subject.code === selectedCode)) select.value = selectedCode;
}

function renderAdminDatesheet() {
  const body = document.getElementById('adminDatesheetBody');
  const count = document.getElementById('datesheetEntryCount');
  if (!body) return;
  body.replaceChildren();
  if (count) count.textContent = `${adminState.datesheetEntries.length} exam${adminState.datesheetEntries.length === 1 ? '' : 's'}`;
  if (!adminState.datesheetEntries.length) {
    const row = document.createElement('tr');
    const empty = document.createElement('td');
    empty.colSpan = 6;
    empty.className = 'admin-datesheet-empty';
    empty.textContent = 'No datesheet entries yet. Add the first exam above.';
    row.appendChild(empty);
    body.appendChild(row);
    return;
  }

  adminState.datesheetEntries.forEach(entry => {
    const row = document.createElement('tr');
    const values = [
      entry.date ? `${entry.date}${entry.day ? ` · ${entry.day}` : ''}` : '',
      `${entry.subject || 'Subject'}${entry.code ? ` (${entry.code})` : ''}`,
      entry.time || '',
      entry.room || '—',
      `${entry.maxMarks || '—'}`
    ];
    values.forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });

    const actions = document.createElement('td');
    actions.className = 'admin-datesheet-actions';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn-icon';
    editButton.title = `Edit ${entry.subject || 'exam'} datesheet entry`;
    editButton.setAttribute('aria-label', editButton.title);
    editButton.innerHTML = '<i data-lucide="pencil"></i>';
    editButton.addEventListener('click', () => editDatesheetEntry(entry));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn-icon admin-holiday-delete';
    deleteButton.title = `Delete ${entry.subject || 'exam'} datesheet entry`;
    deleteButton.setAttribute('aria-label', deleteButton.title);
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteButton.addEventListener('click', () => deleteDatesheetEntry(entry));
    actions.append(editButton, deleteButton);
    row.appendChild(actions);
    body.appendChild(row);
  });
  renderIcons();
  updateSyllabusEditingControls();
}

function editDatesheetEntry(entry) {
  const form = document.getElementById('datesheetForm');
  if (!form) return;
  form.dataset.editId = entry.id;
  document.getElementById('datesheetExamTitle').value = adminState.datesheetTitle;
  document.getElementById('datesheetDate').value = entry.date || '';
  document.getElementById('datesheetSubject').value = entry.code || '';
  document.getElementById('datesheetTime').value = entry.time || '';
  document.getElementById('datesheetRoom').value = entry.room || '';
  document.getElementById('datesheetMaxMarks').value = entry.maxMarks || '';
  document.getElementById('datesheetSubmitBtn').innerHTML = '<i data-lucide="save"></i> Save Changes';
  document.getElementById('datesheetCancelEditBtn').hidden = false;
  renderIcons();
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetDatesheetForm() {
  const form = document.getElementById('datesheetForm');
  if (!form) return;
  delete form.dataset.editId;
  form.reset();
  document.getElementById('datesheetExamTitle').value = adminState.datesheetTitle;
  document.getElementById('datesheetSubmitBtn').innerHTML = '<i data-lucide="plus"></i> Add Exam';
  document.getElementById('datesheetCancelEditBtn').hidden = true;
  renderIcons();
}

async function deleteDatesheetEntry(entry) {
  if (!window.confirm(`Remove ${entry.subject || 'this exam'} from the datesheet?`)) return;
  try {
    const response = await fetch(`/api/admin/exams/datesheet/${encodeURIComponent(entry.id)}`, {
      method: 'DELETE',
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not remove exam datesheet entry');
    adminState.datesheetEntries = data.timetable || [];
    renderAdminDatesheet();
    showToast('Exam removed from the datesheet.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not remove exam datesheet entry', 'error');
  }
}

async function toggleSyllabusStatus() {
  if (!adminState.admin) return;
  const isOpen = adminState.syllabusOpen === false;
  try {
    const response = await fetch('/api/admin/exams/syllabus-status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-id': adminState.admin.id },
      body: JSON.stringify({ isOpen })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not change syllabus status');
    adminState.syllabusOpen = data.syllabusOpen !== false;
    updateSyllabusEditingControls();
    showToast(`Syllabus editing ${adminState.syllabusOpen ? 'opened' : 'closed'}.`, 'success');
  } catch (error) {
    showToast(error.message || 'Could not change syllabus status', 'error');
  }
}

async function deleteAdminSubject(subject) {
  if (!window.confirm(`Delete ${subject.subject} (${subject.code}) from the syllabus, exam timetable, and attendance records?`)) return;
  try {
    const response = await fetch(`/api/admin/exams/subjects/${encodeURIComponent(subject.code)}`, {
      method: 'DELETE',
      headers: { 'x-admin-id': adminState.admin.id }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not delete subject');
    adminState.syllabusSubjects = data.subjects || [];
    adminState.syllabusOpen = data.syllabusOpen !== false;
    renderAdminSubjects();
    showToast(`${subject.subject} removed from the syllabus.`, 'success');
  } catch (error) {
    showToast(error.message || 'Could not delete subject', 'error');
  }
}

async function loadAdminHolidays() {
  try {
    const response = await fetch('/api/holidays');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load calendar');
    adminState.holidays = data.holidays || [];
    renderAdminHolidays();
  } catch (error) {
    showToast(error.message || 'Could not load festivals and holidays', 'error');
  }
}

function renderAdminHolidays() {
  const list = document.getElementById('adminHolidayList');
  if (!list) return;
  list.replaceChildren();

  if (!adminState.holidays.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'admin-holiday-empty';
    emptyState.textContent = 'No festivals or holidays have been added.';
    list.appendChild(emptyState);
    return;
  }

  adminState.holidays.forEach((holiday) => {
    const row = document.createElement('div');
    row.className = 'admin-holiday-row';

    const details = document.createElement('div');
    details.className = 'admin-holiday-details';
    const title = document.createElement('strong');
    title.textContent = holiday.title || 'Untitled holiday';
    const meta = document.createElement('span');
    const date = holiday.date ? new Date(`${holiday.date}T00:00:00`).toLocaleDateString() : 'Date not set';
    meta.textContent = `${date} · ${holiday.type || 'Holiday'} · ${holiday.duration || '1 Day'}`;
    details.append(title, meta);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn-icon admin-holiday-delete';
    deleteButton.title = `Delete ${holiday.title || 'holiday'}`;
    deleteButton.setAttribute('aria-label', deleteButton.title);
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteButton.addEventListener('click', () => deleteAdminHoliday(holiday));

    row.append(details, deleteButton);
    list.appendChild(row);
  });

  renderIcons();
}

async function deleteAdminHoliday(holiday) {
  if (!window.confirm(`Delete "${holiday.title || 'this holiday'}" from the school calendar?`)) return;

  try {
    const response = await fetch(`/api/admin/holidays/${encodeURIComponent(holiday.id)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not delete holiday');
    adminState.holidays = data.holidays || [];
    renderAdminHolidays();
    showToast('Festival or holiday deleted from the calendar.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not delete holiday', 'error');
  }
}

// ================= REGISTER STUDENT MODAL =================
function setupAddStudentModal() {
  const modal = document.getElementById('addStudentModal');
  const closeBtn = document.getElementById('closeAddStudentModalBtn');
  const cancelBtn = document.getElementById('cancelAddStudentBtn');
  const form = document.getElementById('addStudentForm');

  if (!modal) return;

  const open = () => { modal.style.display = 'flex'; };
  const close = () => { modal.style.display = 'none'; };

  window.openAddStudentModal = open;
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('adminNewName').value.trim();
      const rollNo = document.getElementById('adminNewRoll').value.trim();
      const grade = document.getElementById('adminNewGrade').value.trim();
      const house = document.getElementById('adminNewHouse').value;
      const email = document.getElementById('adminNewEmail').value.trim();
      const password = document.getElementById('adminNewPassword').value;

      try {
        const res = await fetch('/api/auth/student/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-id': adminState.admin.id
          },
          body: JSON.stringify({ name, rollNo, grade, house, email, password })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`Student ${data.student.name} enrolled with Roll No ${data.student.rollNo}!`, 'success');
          close();
          form.reset();
          await loadAdminData();
        } else {
          showToast(data.error || 'Failed to create student account', 'error');
        }
      } catch (err) {
        showToast('Error registering student', 'error');
      }
    });
  }
}
