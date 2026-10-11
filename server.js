const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const WEB_PUSH_KEYS_FILE = path.join(__dirname, 'data', 'web-push-keys.json');
const onlineUsers = new Map();
const allSubjectsChatCooldowns = new Map();
const ALL_SUBJECTS_CHAT_CHANNEL = 'math-doubts';
const STUDENT_CHAT_COOLDOWN_MS = 60 * 1000;

function configureWebPush() {
  let vapidKeys;
  try {
    vapidKeys = JSON.parse(fs.readFileSync(WEB_PUSH_KEYS_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(WEB_PUSH_KEYS_FILE, JSON.stringify(vapidKeys, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  webpush.setVapidDetails('mailto:admin@school.edu', vapidKeys.publicKey, vapidKeys.privateKey);
  return vapidKeys.publicKey;
}

const webPushPublicKey = configureWebPush();

async function sendAnnouncementPush(notice) {
  const data = getData();
  const subscriptions = data.pushSubscriptions || [];
  if (!subscriptions.length) return;

  const payload = JSON.stringify({
    title: `${notice.category} school notice`,
    body: 'Open the portal to view the latest announcement.',
    url: '/'
  });
  const results = await Promise.allSettled(subscriptions.map(async entry => {
    try {
      await webpush.sendNotification(entry.subscription, payload);
      return null;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) return entry.subscription.endpoint;
      console.error(`Push notification failed for student ${entry.studentId}:`, error.message);
      return null;
    }
  }));
  const expiredEndpoints = new Set(results
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value));
  if (expiredEndpoints.size) {
    data.pushSubscriptions = subscriptions.filter(entry => !expiredEndpoints.has(entry.subscription.endpoint));
    if (!saveData(data)) console.error('Could not remove expired push subscriptions from the data store');
  }
  results.filter(result => result.status === 'rejected').forEach(result => {
    console.error('Push notification delivery failed:', result.reason);
  });
}

function getStudentChatCooldown(studentId) {
  const cooldownUntil = allSubjectsChatCooldowns.get(studentId) || 0;
  const remainingMs = cooldownUntil - Date.now();
  if (remainingMs <= 0) {
    allSubjectsChatCooldowns.delete(studentId);
    return { remainingMs: 0, cooldownUntil: 0 };
  }
  return { remainingMs, cooldownUntil };
}

function broadcastPresence() {
  io.emit('presence_update', { onlineUserIds: [...onlineUsers.keys()] });
}

function removeSocketPresence(socket) {
  const userId = socket.data.presenceUserId;
  if (!userId) return;

  const presence = onlineUsers.get(userId);
  if (presence && presence.connections <= 1) {
    onlineUsers.delete(userId);
  } else if (presence) {
    presence.connections -= 1;
  }
  delete socket.data.presenceUserId;
  broadcastPresence();
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Database Helpers
function getData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading data:', err);
    return { students: [], admins: [] };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving data:', err);
    return false;
  }
}

// Generate simple mock tokens
function makeToken(prefix, id) {
  return `${prefix}_${id}_${Buffer.from(String(Date.now())).toString('base64').slice(0, 10)}`;
}

// ================= DEDICATED PAGE ROUTES =================
// Dedicated Admin URL
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Dedicated Student Portal URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================= AUTHENTICATION APIS =================

// 1. Student Login
app.post('/api/auth/student/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Please enter Roll Number / Email and Password' });
  }

  const data = getData();
  const student = (data.students || []).find(
    s => (s.rollNo?.toLowerCase() === identifier.toLowerCase().trim() ||
          s.email?.toLowerCase() === identifier.toLowerCase().trim() ||
          s.id === identifier.trim()) &&
         s.password === password
  );

  if (!student) {
    return res.status(401).json({ error: 'Invalid Roll Number / Email or Password' });
  }

  const token = makeToken('std_tok', student.id);
  const { password: _, ...studentSafe } = student;
  res.json({ success: true, token, student: studentSafe });
});

// 2. Student Registration
app.post('/api/auth/student/register', (req, res) => {
  const { name, rollNo, grade, section, house, email, password } = req.body;
  if (!name || !rollNo || !password) {
    return res.status(400).json({ error: 'Name, Roll Number, and Password are required' });
  }

  const adminId = req.get('x-admin-id');
  const isAdminRegistration = Boolean(adminId && isAuthenticatedAdmin(req));
  if (adminId && !isAdminRegistration) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  if (!isAdminRegistration && section && !['A', 'B', 'C', 'D'].includes(section)) {
    return res.status(400).json({ error: 'Choose a valid Grade 8 section' });
  }

  const data = getData();
  data.students = data.students || [];

  const exists = data.students.some(
    s => s.rollNo?.toLowerCase() === rollNo.toLowerCase().trim() ||
         (email && s.email?.toLowerCase() === email.toLowerCase().trim())
  );
  if (exists) {
    return res.status(400).json({ error: 'A student with this Roll Number or Email already exists' });
  }

  const newId = 'std_' + Date.now();
  const avatarSeed = encodeURIComponent(name.replace(/\s+/g, ''));
  const newStudent = {
    id: newId,
    name,
    rollNo: rollNo.trim(),
    grade: isAdminRegistration
      ? (typeof grade === 'string' && grade.trim()) || 'Grade 10 - Section A'
      : `Grade 8 - Section ${section || 'A'}`,
    house: house || 'Phoenix House',
    email: email || `${rollNo.toLowerCase()}@school.edu`,
    password: password,
    role: 'Student',
    avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${avatarSeed}`,
    createdAt: new Date().toISOString()
  };

  data.students.push(newStudent);
  saveData(data);

  io.emit('students_updated', { students: data.students.map(({ password: _, ...s }) => s) });

  const token = makeToken('std_tok', newStudent.id);
  const { password: _, ...studentSafe } = newStudent;
  res.status(201).json({ success: true, token, student: studentSafe });
});

// 3. Current Student Verification
app.get('/api/auth/student/me', (req, res) => {
  const studentId = req.headers['x-student-id'];
  if (!studentId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const data = getData();
  const student = (data.students || []).find(s => s.id === studentId);
  if (!student) {
    return res.status(404).json({ error: 'Student account not found' });
  }

  const { password: _, ...studentSafe } = student;
  res.json({ success: true, student: studentSafe });
});

app.post('/api/auth/student/avatar', (req, res) => {
  const studentId = req.headers['x-student-id'];
  if (!studentId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const match = typeof req.body?.avatar === 'string'
    ? req.body.avatar.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/)
    : null;
  if (!match || match[1].length > 1400000 || match[1].length % 4 !== 0) {
    return res.status(400).json({ error: 'Upload a valid JPEG profile picture under 1 MB.' });
  }

  const image = Buffer.from(match[1], 'base64');
  if (
    image.length === 0 ||
    image.length > 1024 * 1024 ||
    image.toString('base64') !== match[1] ||
    image[0] !== 0xff ||
    image[1] !== 0xd8 ||
    image[2] !== 0xff ||
    image[image.length - 2] !== 0xff ||
    image[image.length - 1] !== 0xd9
  ) {
    return res.status(400).json({ error: 'Upload a valid JPEG profile picture under 1 MB.' });
  }

  const data = getData();
  const student = (data.students || []).find(s => s.id === studentId);
  if (!student) {
    return res.status(404).json({ error: 'Student account not found' });
  }

  student.avatar = req.body.avatar;
  if (!saveData(data)) {
    return res.status(500).json({ error: 'Could not save your profile picture. Please try again.' });
  }

  const { password: _, ...studentSafe } = student;
  io.emit('students_updated', { students: data.students.map(({ password: _password, ...s }) => s) });
  res.json({ success: true, student: studentSafe });
});

// 4. Admin / Teacher Login
app.post('/api/auth/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Please enter Faculty Email and Password' });
  }

  const data = getData();
  const admin = (data.admins || []).find(
    a => (a.email?.toLowerCase() === email.toLowerCase().trim() || a.id === email.trim()) &&
         a.password === password
  );

  if (!admin) {
    return res.status(401).json({ error: 'Invalid Faculty Credentials. (Default: admin@school.edu / admin123)' });
  }

  const token = makeToken('adm_tok', admin.id);
  const { password: _, ...adminSafe } = admin;
  res.json({ success: true, token, admin: adminSafe });
});

// 5. Current Admin Verification
app.get('/api/auth/admin/me', (req, res) => {
  const adminId = req.headers['x-admin-id'];
  if (!adminId) {
    return res.status(401).json({ error: 'Admin not authenticated' });
  }

  const data = getData();
  const admin = (data.admins || []).find(a => a.id === adminId);
  if (!admin) {
    return res.status(404).json({ error: 'Admin account not found' });
  }

  const { password: _, ...adminSafe } = admin;
  res.json({ success: true, admin: adminSafe });
});

// ================= CHAT APIS =================

app.get('/api/chat/channels', (req, res) => {
  const data = getData();
  res.json({
    channels: (data.channels || []).filter(channel => channel.id !== ALL_SUBJECTS_CHAT_CHANNEL),
    students: (data.students || []).map(({ password: _, ...s }) => s),
    admins: (data.admins || []).map(({ password: _, ...a }) => a),
    onlineUserIds: [...onlineUsers.keys()]
  });
});

app.get('/api/chat/messages', (req, res) => {
  const { channel = 'general' } = req.query;
  const data = getData();
  const student = (data.students || []).find(item => item.id === req.get('x-student-id'));
  const ownReports = new Set((data.chatReports || [])
    .filter(report => student && report.reporterId === student.id)
    .map(report => report.messageId));
  const messages = (data.messages || [])
    .filter(message => message.channelId === channel)
    .map(message => ({ ...message, reportedByCurrentStudent: ownReports.has(message.id) }));
  res.json({ messages });
});

function getAuthenticatedStudent(req) {
  const studentId = req.get('x-student-id');
  return (getData().students || []).find(student => student.id === studentId);
}

const chatReportReasons = new Set(['bullying', 'inappropriate', 'spam', 'other']);

app.post('/api/chat/messages/:id/report', (req, res) => {
  const student = getAuthenticatedStudent(req);
  if (!student) return res.status(401).json({ error: 'Student authentication required' });

  const body = req.body || {};
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const details = typeof body.details === 'string' ? body.details.trim() : '';
  if (!chatReportReasons.has(reason)) return res.status(400).json({ error: 'Choose a valid report reason' });
  if (details.length > 500) return res.status(400).json({ error: 'Report details must be 500 characters or fewer' });

  const data = getData();
  const message = (data.messages || []).find(item => item.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'Chat message not found' });
  if (message.senderId === student.id) return res.status(400).json({ error: 'You cannot report your own message' });

  data.chatReports = data.chatReports || [];
  if (data.chatReports.some(report => report.messageId === message.id && report.reporterId === student.id)) {
    return res.status(409).json({ error: 'You have already reported this message' });
  }

  const report = {
    id: crypto.randomUUID(),
    messageId: message.id,
    channelId: message.channelId,
    reporterId: student.id,
    reporterName: student.name,
    reason,
    details,
    messageSnapshot: {
      senderName: message.senderName,
      senderRole: message.senderRole || 'Student',
      text: message.text || '',
      attachmentName: message.attachment?.name || ''
    },
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  data.chatReports.push(report);
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the report' });

  io.emit('chat_report_created', { reportId: report.id });
  res.status(201).json({ success: true, reportId: report.id });
});

app.patch('/api/chat/messages/:id', (req, res) => {
  const student = getAuthenticatedStudent(req);
  if (!student) return res.status(401).json({ error: 'Student authentication required' });
  if (typeof req.body.text !== 'string') return res.status(400).json({ error: 'Message text is required' });

  const data = getData();
  const message = (data.messages || []).find(item => item.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'Chat message not found' });
  if (message.senderId !== student.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  if (message.channelId === 'announcements') return res.status(403).json({ error: 'Official announcements are read-only' });
  if (!req.body.text.trim() && !message.attachment) {
    return res.status(400).json({ error: 'A message cannot be empty' });
  }

  message.text = req.body.text.trim();
  message.updatedAt = new Date().toISOString();
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the updated message' });

  io.emit('message_updated', message);
  res.json({ success: true, message });
});

app.delete('/api/chat/messages/:id', (req, res) => {
  const student = getAuthenticatedStudent(req);
  if (!student) return res.status(401).json({ error: 'Student authentication required' });

  const data = getData();
  data.messages = data.messages || [];
  const index = data.messages.findIndex(item => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Chat message not found' });
  if (data.messages[index].senderId !== student.id) {
    return res.status(403).json({ error: 'You can only delete your own messages' });
  }
  if (data.messages[index].channelId === 'announcements') {
    return res.status(403).json({ error: 'Official announcements are read-only' });
  }

  const [deletedMessage] = data.messages.splice(index, 1);
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the updated chat' });

  removeUnusedChatAttachments([deletedMessage], data.messages);
  io.emit('message_deleted', { messageId: deletedMessage.id, channelId: deletedMessage.channelId });
  res.json({ success: true, messageId: deletedMessage.id, channelId: deletedMessage.channelId });
});

function isAuthenticatedAdmin(req) {
  const adminId = req.get('x-admin-id');
  return (getData().admins || []).some(admin => admin.id === adminId);
}

app.get('/api/push/public-key', (req, res) => {
  res.json({ publicKey: webPushPublicKey });
});

function isSupportedPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && (
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'push.services.mozilla.com' ||
      url.hostname.endsWith('.push.services.mozilla.com') ||
      url.hostname.endsWith('.push.apple.com') ||
      url.hostname.endsWith('.notify.windows.com')
    );
  } catch {
    return false;
  }
}

app.post('/api/push/subscriptions', (req, res) => {
  const student = getAuthenticatedStudent(req);
  if (!student) return res.status(401).json({ error: 'Student authentication required' });

  const subscription = req.body?.subscription;
  if (
    !subscription ||
    typeof subscription.endpoint !== 'string' ||
    subscription.endpoint.length > 2048 ||
    !isSupportedPushEndpoint(subscription.endpoint) ||
    typeof subscription.keys?.p256dh !== 'string' ||
    subscription.keys.p256dh.length > 512 ||
    typeof subscription.keys?.auth !== 'string' ||
    subscription.keys.auth.length > 512
  ) {
    return res.status(400).json({ error: 'A valid push subscription is required' });
  }

  const data = getData();
  data.pushSubscriptions = data.pushSubscriptions || [];
  data.pushSubscriptions = data.pushSubscriptions.filter(entry =>
    entry.subscription?.endpoint !== subscription.endpoint
  );
  data.pushSubscriptions.push({
    studentId: student.id,
    subscription,
    createdAt: new Date().toISOString()
  });
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save your notification settings' });
  res.status(201).json({ success: true });
});

app.delete('/api/push/subscriptions', (req, res) => {
  const student = getAuthenticatedStudent(req);
  if (!student) return res.status(401).json({ error: 'Student authentication required' });
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string' || !isSupportedPushEndpoint(endpoint)) {
    return res.status(400).json({ error: 'A valid push subscription endpoint is required' });
  }

  const data = getData();
  const subscriptions = data.pushSubscriptions || [];
  data.pushSubscriptions = subscriptions.filter(entry =>
    !(entry.studentId === student.id && entry.subscription?.endpoint === endpoint)
  );
  if (!saveData(data)) return res.status(500).json({ error: 'Could not update your notification settings' });
  res.json({ success: true });
});

function removeUnusedChatAttachments(removedMessages, remainingMessages) {
  const remainingUrls = new Set((remainingMessages || []).map(message => message.attachment && message.attachment.url));
  removedMessages.forEach(message => {
    const url = message.attachment && message.attachment.url;
    const match = typeof url === 'string' && url.match(/^\/api\/chat\/attachments\/([\da-f-]{36}\.[a-z0-9]+)$/i);
    if (match && !remainingUrls.has(url)) {
      const filePath = path.join(chatAttachmentDir, match[1]);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });
}

app.get('/api/admin/chat/messages', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });

  const { channel = 'general' } = req.query;
  const data = getData();
  if (!(data.channels || []).some(item => item.id === channel)) {
    return res.status(404).json({ error: 'Chat channel not found' });
  }

  res.json({ messages: (data.messages || []).filter(message => message.channelId === channel) });
});

app.get('/api/admin/chat/reports', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });

  const status = req.query.status || 'pending';
  if (status !== 'pending' && status !== 'all') {
    return res.status(400).json({ error: 'Report status must be pending or all' });
  }
  const data = getData();
  const messageIds = new Set((data.messages || []).map(message => message.id));
  const reports = (data.chatReports || [])
    .filter(report => status === 'all' || report.status === 'pending')
    .map(report => ({ ...report, messageAvailable: messageIds.has(report.messageId) }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ reports });
});

app.patch('/api/admin/chat/reports/:id', (req, res) => {
  const adminId = req.get('x-admin-id');
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const body = req.body || {};
  if (!['dismissed', 'actioned'].includes(body.status)) {
    return res.status(400).json({ error: 'Report status must be dismissed or actioned' });
  }

  const data = getData();
  const report = (data.chatReports || []).find(item => item.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Chat report not found' });
  if (report.status !== 'pending') return res.status(409).json({ error: 'This report has already been reviewed' });

  report.status = body.status;
  report.reviewedAt = new Date().toISOString();
  report.reviewedBy = adminId;
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the report review' });

  io.emit('chat_report_updated', { reportId: report.id, status: report.status });
  res.json({ success: true, report });
});

app.delete('/api/admin/chat/messages/:id', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });

  const data = getData();
  data.messages = data.messages || [];
  const index = data.messages.findIndex(message => message.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Chat message not found' });

  const [deletedMessage] = data.messages.splice(index, 1);
  const reviewedReports = (data.chatReports || []).filter(report => report.messageId === deletedMessage.id && report.status === 'pending');
  reviewedReports.forEach(report => {
    report.status = 'actioned';
    report.reviewedAt = new Date().toISOString();
    report.reviewedBy = req.get('x-admin-id');
  });
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the updated chat' });

  removeUnusedChatAttachments([deletedMessage], data.messages);
  io.emit('message_deleted', { messageId: deletedMessage.id, channelId: deletedMessage.channelId });
  reviewedReports.forEach(report => io.emit('chat_report_updated', { reportId: report.id, status: report.status }));
  res.json({ success: true, messageId: deletedMessage.id, channelId: deletedMessage.channelId });
});

app.delete('/api/admin/chat/channels/:channelId/messages', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });

  const data = getData();
  if (!(data.channels || []).some(channel => channel.id === req.params.channelId)) {
    return res.status(404).json({ error: 'Chat channel not found' });
  }

  data.messages = data.messages || [];
  const removedMessages = data.messages.filter(message => message.channelId === req.params.channelId);
  data.messages = data.messages.filter(message => message.channelId !== req.params.channelId);
  const removedMessageIds = new Set(removedMessages.map(message => message.id));
  const reviewedReports = (data.chatReports || []).filter(report => removedMessageIds.has(report.messageId) && report.status === 'pending');
  reviewedReports.forEach(report => {
    report.status = 'actioned';
    report.reviewedAt = new Date().toISOString();
    report.reviewedBy = req.get('x-admin-id');
  });
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the cleared chat' });

  removeUnusedChatAttachments(removedMessages, data.messages);
  io.emit('chat_cleared', { channelId: req.params.channelId });
  reviewedReports.forEach(report => io.emit('chat_report_updated', { reportId: report.id, status: report.status }));
  res.json({ success: true, channelId: req.params.channelId, deletedCount: removedMessages.length });
});

const chatAttachmentDir = path.join(__dirname, 'data', 'chat-attachments');
const attachmentTypes = {
  '.pdf': { kind: 'document', contentType: 'application/pdf', maxBytes: 3 * 1024 * 1024 },
  '.doc': { kind: 'document', contentType: 'application/msword', maxBytes: 3 * 1024 * 1024 },
  '.docx': { kind: 'document', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', maxBytes: 3 * 1024 * 1024 },
  '.ppt': { kind: 'document', contentType: 'application/vnd.ms-powerpoint', maxBytes: 3 * 1024 * 1024 },
  '.pptx': { kind: 'document', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', maxBytes: 3 * 1024 * 1024 },
  '.xls': { kind: 'document', contentType: 'application/vnd.ms-excel', maxBytes: 3 * 1024 * 1024 },
  '.xlsx': { kind: 'document', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', maxBytes: 3 * 1024 * 1024 },
  '.txt': { kind: 'document', contentType: 'text/plain', maxBytes: 3 * 1024 * 1024 },
  '.csv': { kind: 'document', contentType: 'text/csv', maxBytes: 3 * 1024 * 1024 },
  '.jpg': { kind: 'image', contentType: 'image/jpeg', maxBytes: 10 * 1024 * 1024 },
  '.jpeg': { kind: 'image', contentType: 'image/jpeg', maxBytes: 10 * 1024 * 1024 },
  '.png': { kind: 'image', contentType: 'image/png', maxBytes: 10 * 1024 * 1024 },
  '.gif': { kind: 'image', contentType: 'image/gif', maxBytes: 10 * 1024 * 1024 },
  '.webp': { kind: 'image', contentType: 'image/webp', maxBytes: 10 * 1024 * 1024 },
  '.mp4': { kind: 'video', contentType: 'video/mp4', maxBytes: 20 * 1024 * 1024 },
  '.m4v': { kind: 'video', contentType: 'video/x-m4v', maxBytes: 20 * 1024 * 1024 },
  '.mov': { kind: 'video', contentType: 'video/quicktime', maxBytes: 20 * 1024 * 1024 },
  '.webm': { kind: 'video', contentType: 'video/webm', maxBytes: 20 * 1024 * 1024 }
};

app.post('/api/chat/attachments', express.raw({ type: 'application/octet-stream', limit: '20mb' }), (req, res) => {
  let originalName;
  try {
    originalName = decodeURIComponent(req.get('x-file-name') || '');
  } catch (err) {
    return res.status(400).json({ error: 'Invalid file name' });
  }

  const safeName = originalName.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
  const extension = path.extname(safeName).toLowerCase();
  const attachmentType = attachmentTypes[extension];
  if (!attachmentType || !Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'Choose a supported document, image, or video file' });
  }
  if (req.body.length > attachmentType.maxBytes) {
    const maxMb = Math.floor(attachmentType.maxBytes / (1024 * 1024));
    return res.status(413).json({ error: `${attachmentType.kind} files must be ${maxMb} MB or smaller` });
  }

  const filename = `${crypto.randomUUID()}${extension}`;
  fs.mkdirSync(chatAttachmentDir, { recursive: true });
  fs.writeFileSync(path.join(chatAttachmentDir, filename), req.body);

  res.status(201).json({
    attachment: {
      name: safeName || `attachment${extension}`,
      size: req.body.length,
      kind: attachmentType.kind,
      contentType: attachmentType.contentType,
      url: `/api/chat/attachments/${filename}`
    }
  });
});

app.get('/api/chat/attachments/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^[\da-f-]{36}\.[a-z0-9]+$/i.test(filename)) {
    return res.status(404).end();
  }

  const filePath = path.join(chatAttachmentDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const attachmentType = attachmentTypes[path.extname(filename).toLowerCase()];
  if (!attachmentType) return res.status(404).end();
  res.type(attachmentType.contentType).set('X-Content-Type-Options', 'nosniff').sendFile(filePath);
});

app.post('/api/chat/messages', (req, res) => {
  const { channelId, text, senderId, senderName, senderRole, attachment } = req.body;
  if ((!text && !attachment) || !channelId) {
    return res.status(400).json({ error: 'A message or document and channelId are required' });
  }

  const data = getData();
  if (channelId === 'announcements') {
    return res.status(403).json({ error: 'Official Announcements can only be posted through the staff announcement tool' });
  }

  const adminId = req.get('x-admin-id');
  const admin = adminId && (data.admins || []).find(item => item.id === adminId);
  if (adminId && !admin) {
    return res.status(401).json({ error: 'Faculty authentication required' });
  }

  let messageSenderId = senderId || 'anon';
  let messageSenderName = senderName || 'Anonymous';
  let messageSenderRole = senderRole || 'Student';
  if (admin) {
    messageSenderId = admin.id;
    messageSenderName = admin.name;
    messageSenderRole = admin.role || 'Teacher';
  }
  let cooldownUntil = 0;
  if (channelId === ALL_SUBJECTS_CHAT_CHANNEL) {
    const studentId = req.get('x-student-id');
    const student = (data.students || []).find(item => item.id === studentId);
    if (!student) return res.status(401).json({ error: 'Student authentication required for this channel' });

    const cooldown = getStudentChatCooldown(student.id);
    if (cooldown.remainingMs > 0) {
      return res.status(429).json({
        error: `Please wait ${Math.ceil(cooldown.remainingMs / 1000)} seconds before sending another message.`,
        retryAfterMs: cooldown.remainingMs,
        cooldownUntil: cooldown.cooldownUntil
      });
    }

    messageSenderId = student.id;
    messageSenderName = student.name;
    messageSenderRole = 'Student';
    cooldownUntil = Date.now() + STUDENT_CHAT_COOLDOWN_MS;
  }

  const newMessage = {
    id: 'msg_' + Date.now(),
    channelId,
    senderId: messageSenderId,
    senderName: messageSenderName,
    senderRole: messageSenderRole,
    text: text || '',
    ...(attachment ? { attachment } : {}),
    timestamp: new Date().toISOString()
  };

  data.messages = data.messages || [];
  data.messages.push(newMessage);
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save chat message' });

  if (cooldownUntil) allSubjectsChatCooldowns.set(messageSenderId, cooldownUntil);

  const broadcastMessage = cooldownUntil ? { ...newMessage, cooldownUntil } : newMessage;
  io.to(channelId).emit('new_message', broadcastMessage);
  io.emit('new_message_global', broadcastMessage);

  res.status(201).json(broadcastMessage);
});

// ================= ATTENDANCE & LEAVES APIS =================

function getStudentAttendanceLogs(monthlyLog, student) {
  const uniqueByDate = new Map();
  (monthlyLog || []).forEach(log => {
    const belongsToStudent = log.studentId === student.id
      || (!log.studentId && log.studentName === student.name);
    if (belongsToStudent && log.date && !uniqueByDate.has(log.date)) {
      uniqueByDate.set(log.date, log);
    }
  });
  return [...uniqueByDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function summarizeStudentAttendance(logs, targetPercentage = 75) {
  const present = logs.filter(log => log.status === 'Present').length;
  const absent = logs.filter(log => log.status === 'Absent').length;
  const late = logs.filter(log => log.status === 'Late').length;
  let streak = 0;
  for (const log of logs) {
    if (log.status === 'Absent') break;
    if (log.status === 'Present' || log.status === 'Late') streak += 1;
  }
  const totalDays = logs.length;
  return {
    percentage: totalDays ? +(((present + late) / totalDays) * 100).toFixed(1) : 100,
    totalDays,
    present,
    absent,
    late,
    targetPercentage,
    streak
  };
}

app.get('/api/attendance', (req, res) => {
  const data = getData();
  const attendance = data.attendance || {};
  const studentId = req.get('x-student-id');
  if (!studentId) return res.json(attendance);

  const student = (data.students || []).find(item => item.id === studentId);
  if (!student) return res.status(401).json({ error: 'Student authentication required' });
  const overall = summarizeStudentAttendance(
    getStudentAttendanceLogs(attendance.monthlyLog, student),
    attendance.overall?.targetPercentage || 75
  );
  res.json({ ...attendance, overall });
});

// Student applies for leave
app.post('/api/attendance/leave', (req, res) => {
  const { studentId, studentName, studentGrade, startDate, endDate, reason, type } = req.body;
  if (!startDate || !reason) {
    return res.status(400).json({ error: 'Start date and reason are required' });
  }

  const data = getData();
  const newLeave = {
    id: 'lev_' + Date.now(),
    studentId: studentId || 'std',
    studentName: studentName || 'Student',
    studentGrade: studentGrade || 'Grade 10',
    startDate,
    endDate: endDate || startDate,
    reason,
    type: type || 'Casual Leave',
    status: 'Pending Approval',
    appliedOn: new Date().toISOString().split('T')[0]
  };

  data.attendance = data.attendance || { leaveRequests: [] };
  data.attendance.leaveRequests = data.attendance.leaveRequests || [];
  data.attendance.leaveRequests.unshift(newLeave);
  saveData(data);

  io.emit('leave_updated', { leaves: data.attendance.leaveRequests, newLeave });

  res.status(201).json({ success: true, leave: newLeave, allLeaves: data.attendance.leaveRequests });
});

// Student Self Check-in
app.post('/api/attendance/check-in', (req, res) => {
  const student = getAuthenticatedStudent(req);
  if (!student) return res.status(401).json({ error: 'Student authentication required' });

  const data = getData();
  data.attendance = data.attendance || { overall: { present: 0, totalDays: 0, percentage: 100 }, monthlyLog: [] };
  data.attendance.monthlyLog = data.attendance.monthlyLog || [];
  const today = new Date().toISOString().split('T')[0];

  const existing = getStudentAttendanceLogs(data.attendance.monthlyLog, student).find(log => log.date === today);
  if (existing) {
    return res.json({
      success: true,
      alreadyMarked: true,
      status: existing.status,
      attendance: {
        ...data.attendance,
        overall: summarizeStudentAttendance(
          getStudentAttendanceLogs(data.attendance.monthlyLog, student),
          data.attendance.overall?.targetPercentage || 75
        )
      }
    });
  }

  data.attendance.monthlyLog.unshift({
    id: crypto.randomUUID(),
    date: today,
    studentId: student.id,
    studentName: student.name,
    status: 'Present',
    remarks: 'Self Check-in via Student Portal'
  });

  if (!saveData(data)) return res.status(500).json({ error: 'Could not save attendance' });
  io.emit('attendance_updated', data.attendance);
  res.json({
    success: true,
    alreadyMarked: false,
    attendance: {
      ...data.attendance,
      overall: summarizeStudentAttendance(
        getStudentAttendanceLogs(data.attendance.monthlyLog, student),
        data.attendance.overall?.targetPercentage || 75
      )
    }
  });
});

// ================= ANNOUNCEMENTS & HOLIDAYS =================

app.get('/api/announcements', (req, res) => {
  const data = getData();
  res.json({ announcements: data.announcements || [] });
});

app.get('/api/holidays', (req, res) => {
  const data = getData();
  res.json({ holidays: data.holidays || [] });
});

// ================= PTM APIS =================

app.get('/api/ptm', (req, res) => {
  const data = getData();
  res.json(data.ptm || {});
});

app.post('/api/ptm/book', (req, res) => {
  const { teacherId, timeSlot, parentName, studentName, topic, mode } = req.body;
  if (!teacherId || !timeSlot || !parentName) {
    return res.status(400).json({ error: 'Teacher, time slot, and parent name required' });
  }

  const data = getData();
  const teacher = (data.ptm.teachers || []).find(t => t.id === teacherId);
  if (!teacher) {
    return res.status(404).json({ error: 'Teacher not found' });
  }

  const alreadyBooked = (data.ptm.bookings || []).some(
    b => b.teacherId === teacherId && b.timeSlot === timeSlot
  );
  if (alreadyBooked) {
    return res.status(400).json({ error: 'This time slot is already booked.' });
  }

  const newBooking = {
    id: 'bk_' + Date.now(),
    teacherId,
    teacherName: teacher.name,
    subject: teacher.subject,
    date: '2026-10-24',
    timeSlot,
    room: teacher.room,
    mode: mode || 'In-Person',
    parentName,
    studentName: studentName || 'Student',
    topic: topic || 'Academic performance and discussion',
    status: 'Confirmed'
  };

  data.ptm.bookings = data.ptm.bookings || [];
  data.ptm.bookings.push(newBooking);

  teacher.slotsAvailable = (teacher.slotsAvailable || []).filter(s => s !== timeSlot);
  saveData(data);
  io.emit('ptm_updated', data.ptm);

  res.status(201).json({ success: true, booking: newBooking, ptm: data.ptm });
});

app.delete('/api/ptm/cancel/:id', (req, res) => {
  const { id } = req.params;
  const data = getData();
  const idx = (data.ptm.bookings || []).findIndex(b => b.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });

  const [cancelled] = data.ptm.bookings.splice(idx, 1);
  const teacher = (data.ptm.teachers || []).find(t => t.id === cancelled.teacherId);
  if (teacher && !teacher.slotsAvailable.includes(cancelled.timeSlot)) {
    teacher.slotsAvailable.push(cancelled.timeSlot);
    teacher.slotsAvailable.sort();
  }

  saveData(data);
  io.emit('ptm_updated', data.ptm);
  res.json({ success: true, ptm: data.ptm });
});

// ================= EXAMS & SYLLABUS =================

app.get('/api/exams', (req, res) => {
  const data = getData();
  const exams = data.exams || {};
  res.json({ ...exams, syllabusOpen: exams.syllabusOpen !== false });
});

app.post('/api/exams/toggle-chapter', (req, res) => {
  const { subjectCode, chapterId, completed } = req.body;
  const data = getData();
  const subject = (data.exams.syllabus || []).find(s => s.code === subjectCode);
  if (!subject) return res.status(404).json({ error: 'Subject not found' });

  const chapter = (subject.chapters || []).find(c => c.id === chapterId);
  if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

  chapter.completed = completed;
  saveData(data);
  io.emit('syllabus_updated', data.exams);

  res.json({ success: true, chapter, syllabus: data.exams.syllabus });
});

function getManagedSubjects(data) {
  const subjectsByCode = new Map();
  const addSubjects = (items, source, getDetails = item => item) => {
    (items || []).forEach(item => {
      const details = getDetails(item);
      const code = String(details.code || '').trim().toUpperCase();
      if (!code) return;
      const existing = subjectsByCode.get(code) || {
        subject: details.subject || 'Untitled subject',
        code,
        teacher: details.teacher || 'Faculty',
        totalWeightage: details.totalWeightage || 'To be announced',
        sources: []
      };
      existing.subject = details.subject || existing.subject;
      existing.teacher = details.teacher || existing.teacher;
      existing.totalWeightage = details.totalWeightage || existing.totalWeightage;
      if (!existing.sources.includes(source)) existing.sources.push(source);
      subjectsByCode.set(code, existing);
    });
  };

  addSubjects(data.exams?.syllabus, 'Syllabus');
  addSubjects(data.exams?.timetable, 'Exam timetable', item => ({
    subject: item.subject,
    code: item.code,
    totalWeightage: item.maxMarks ? `${item.maxMarks} Marks` : ''
  }));
  addSubjects(data.attendance?.subjects, 'Attendance');
  return [...subjectsByCode.values()].sort((a, b) => a.subject.localeCompare(b.subject));
}

function normalizeExamDateEntry(entry, subjects) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { error: 'Exam details are required' };
  }

  const date = typeof entry.date === 'string' ? entry.date.trim() : '';
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  const subjectCode = typeof entry.code === 'string' ? entry.code.trim().toUpperCase() : '';
  const selectedSubject = subjects.find(subject => subject.code === subjectCode);
  const time = typeof entry.time === 'string' ? entry.time.trim() : '';
  const room = typeof entry.room === 'string' ? entry.room.trim() : '';
  const maxMarks = Number(entry.maxMarks);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return { error: 'Choose a valid exam date' };
  }
  if (!selectedSubject) return { error: 'Choose a subject from the managed syllabus' };
  if (!time || time.length > 60 || room.length > 60) return { error: 'Enter a valid exam time and hall (maximum 60 characters each)' };
  if (!Number.isInteger(maxMarks) || maxMarks < 1 || maxMarks > 1000) {
    return { error: 'Maximum marks must be a whole number between 1 and 1000' };
  }

  const day = new Date(`${date}T12:00:00.000Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return {
    entry: {
      date,
      day,
      subject: selectedSubject.subject,
      code: selectedSubject.code,
      time,
      room,
      maxMarks
    }
  };
}

app.get('/api/admin/exams/subjects', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const data = getData();
  res.json({ subjects: getManagedSubjects(data), syllabusOpen: data.exams?.syllabusOpen !== false });
});

app.get('/api/admin/exams/datesheet', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const data = getData();
  data.exams = data.exams || {};
  data.exams.timetable = data.exams.timetable || [];
  let addedIds = false;
  data.exams.timetable.forEach(entry => {
    if (!entry.id) {
      entry.id = crypto.randomUUID();
      addedIds = true;
    }
  });
  if (addedIds && !saveData(data)) return res.status(500).json({ error: 'Could not prepare the exam datesheet' });
  res.json({
    title: data.exams.title || '',
    timetable: data.exams.timetable,
    syllabusOpen: data.exams.syllabusOpen !== false
  });
});

app.post('/api/admin/exams/datesheet', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 100) return res.status(400).json({ error: 'Exam or term name is required (maximum 100 characters)' });

  const data = getData();
  data.exams = data.exams || {};
  data.exams.timetable = data.exams.timetable || [];
  if (data.exams.syllabusOpen === false) return res.status(423).json({ error: 'Syllabus editing is closed. Open it before changing the datesheet.' });
  const normalized = normalizeExamDateEntry(body, getManagedSubjects(data));
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  const duplicate = data.exams.timetable.some(entry =>
    entry.date === normalized.entry.date && String(entry.code).toUpperCase() === normalized.entry.code
  );
  if (duplicate) return res.status(409).json({ error: 'A datesheet entry for this subject and date already exists' });

  const newEntry = { id: crypto.randomUUID(), ...normalized.entry };
  data.exams.title = title;
  data.exams.timetable.push(newEntry);
  data.exams.timetable.sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject));
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the exam datesheet' });
  io.emit('syllabus_updated', data.exams);
  res.status(201).json({ success: true, entry: newEntry, title: data.exams.title, timetable: data.exams.timetable });
});

app.patch('/api/admin/exams/datesheet/:id', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 100) return res.status(400).json({ error: 'Exam or term name is required (maximum 100 characters)' });

  const data = getData();
  data.exams = data.exams || {};
  data.exams.timetable = data.exams.timetable || [];
  if (data.exams.syllabusOpen === false) return res.status(423).json({ error: 'Syllabus editing is closed. Open it before changing the datesheet.' });
  const entryIndex = data.exams.timetable.findIndex(entry => entry.id === req.params.id);
  if (entryIndex === -1) return res.status(404).json({ error: 'Datesheet entry not found' });
  const normalized = normalizeExamDateEntry(body, getManagedSubjects(data));
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const duplicate = data.exams.timetable.some((entry, index) =>
    index !== entryIndex && entry.date === normalized.entry.date && String(entry.code).toUpperCase() === normalized.entry.code
  );
  if (duplicate) return res.status(409).json({ error: 'A datesheet entry for this subject and date already exists' });

  const updatedEntry = { id: req.params.id, ...normalized.entry };
  data.exams.title = title;
  data.exams.timetable[entryIndex] = updatedEntry;
  data.exams.timetable.sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject));
  if (!saveData(data)) return res.status(500).json({ error: 'Could not update the exam datesheet' });
  io.emit('syllabus_updated', data.exams);
  res.json({ success: true, entry: updatedEntry, title: data.exams.title, timetable: data.exams.timetable });
});

app.delete('/api/admin/exams/datesheet/:id', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const data = getData();
  data.exams = data.exams || {};
  data.exams.timetable = data.exams.timetable || [];
  if (data.exams.syllabusOpen === false) return res.status(423).json({ error: 'Syllabus editing is closed. Open it before changing the datesheet.' });
  const entryIndex = data.exams.timetable.findIndex(entry => entry.id === req.params.id);
  if (entryIndex === -1) return res.status(404).json({ error: 'Datesheet entry not found' });
  const [deletedEntry] = data.exams.timetable.splice(entryIndex, 1);
  if (!saveData(data)) return res.status(500).json({ error: 'Could not delete the datesheet entry' });
  io.emit('syllabus_updated', data.exams);
  res.json({ success: true, deletedId: deletedEntry.id, timetable: data.exams.timetable });
});

app.patch('/api/admin/exams/syllabus-status', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  if (typeof req.body.isOpen !== 'boolean') return res.status(400).json({ error: 'Syllabus status must be open or closed' });

  const data = getData();
  data.exams = data.exams || { syllabus: [] };
  data.exams.syllabusOpen = req.body.isOpen;
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save syllabus status' });

  io.emit('syllabus_updated', data.exams);
  res.json({ success: true, syllabusOpen: data.exams.syllabusOpen });
});

app.post('/api/admin/exams/subjects', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });

  const subjectName = String(req.body.subject || '').trim();
  const code = String(req.body.code || '').trim().toUpperCase();
  const teacher = String(req.body.teacher || '').trim();
  const totalWeightage = String(req.body.totalWeightage || '').trim();
  if (!subjectName || !/^[A-Z0-9_-]{2,20}$/.test(code)) {
    return res.status(400).json({ error: 'Enter a subject name and a code containing 2-20 letters, numbers, underscores, or hyphens' });
  }

  const data = getData();
  data.exams = data.exams || { syllabus: [] };
  data.exams.syllabus = data.exams.syllabus || [];
  if (data.exams.syllabusOpen === false) {
    return res.status(423).json({ error: 'Syllabus editing is closed. Open it before adding subjects.' });
  }
  const duplicate = data.exams.syllabus.some(item => item.code.toLowerCase() === code.toLowerCase() || item.subject.toLowerCase() === subjectName.toLowerCase());
  if (duplicate) return res.status(409).json({ error: 'A syllabus subject with this name or code already exists' });

  const newSubject = {
    subject: subjectName,
    code,
    teacher: teacher || 'Faculty',
    totalWeightage: totalWeightage || 'To be announced',
    chapters: []
  };
  data.exams.syllabus.push(newSubject);
  data.attendance = data.attendance || {};
  data.attendance.subjects = data.attendance.subjects || [];
  if (!data.attendance.subjects.some(item => item.code.toUpperCase() === code)) {
    data.attendance.subjects.push({
      subject: subjectName,
      code,
      teacher: newSubject.teacher,
      attended: 0,
      total: 0,
      percentage: 0
    });
  }
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the syllabus subject' });

  io.emit('syllabus_updated', data.exams);
  io.emit('attendance_updated', data.attendance);
  res.status(201).json({ success: true, subject: newSubject, subjects: getManagedSubjects(data), syllabusOpen: data.exams.syllabusOpen !== false });
});

app.delete('/api/admin/exams/subjects/:code', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });

  const data = getData();
  data.exams = data.exams || { syllabus: [] };
  data.exams.syllabus = data.exams.syllabus || [];
  if (data.exams.syllabusOpen === false) {
    return res.status(423).json({ error: 'Syllabus editing is closed. Open it before deleting subjects.' });
  }
  const code = req.params.code.toUpperCase();
  const subjects = getManagedSubjects(data);
  const deletedSubject = subjects.find(item => item.code === code);
  if (!deletedSubject) return res.status(404).json({ error: 'Subject not found' });

  data.exams.syllabus = data.exams.syllabus.filter(item => item.code.toUpperCase() !== code);
  data.exams.timetable = (data.exams.timetable || []).filter(item => item.code.toUpperCase() !== code);
  if (data.attendance) {
    data.attendance.subjects = (data.attendance.subjects || []).filter(item => item.code.toUpperCase() !== code);
  }
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the updated syllabus' });

  io.emit('syllabus_updated', data.exams);
  if (data.attendance) io.emit('attendance_updated', data.attendance);
  res.json({ success: true, deletedCode: deletedSubject.code, subjects: getManagedSubjects(data), syllabusOpen: data.exams.syllabusOpen !== false });
});

// ================= ADMIN DEDICATED APIS =================

// Overview
app.get('/api/admin/overview', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const data = getData();
  res.json({
    students: (data.students || []).map(({ password: _, ...s }) => s),
    admins: (data.admins || []).map(({ password: _, ...a }) => a),
    leaves: data.attendance?.leaveRequests || [],
    ptmBookings: data.ptm?.bookings || [],
    announcements: data.announcements || []
  });
});

app.get('/api/admin/accounts', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const accounts = (getData().admins || []).map(({ password: _, ...account }) => account);
  res.json({ accounts });
});

app.post('/api/admin/accounts', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });

  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = req.body.role;
  const subject = String(req.body.subject || '').trim();
  const room = String(req.body.room || '').trim();
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !['Teacher', 'Administrator'].includes(role)) {
    return res.status(400).json({ error: 'Enter a name, valid email, password of at least 8 characters, and account role' });
  }

  const data = getData();
  data.admins = data.admins || [];
  const emailInUse = [...data.admins, ...(data.students || [])].some(account => account.email?.toLowerCase() === email);
  if (emailInUse) return res.status(409).json({ error: 'An account with this email already exists' });

  const newAccount = {
    id: `fac_${crypto.randomUUID()}`,
    name,
    email,
    password,
    role,
    subject: subject || (role === 'Administrator' ? 'School Administration' : 'Faculty'),
    room: room || 'Faculty Room',
    createdAt: new Date().toISOString(),
    avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`
  };
  data.admins.push(newAccount);
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save faculty account' });

  const { password: _, ...accountSafe } = newAccount;
  const accounts = data.admins.map(({ password: __, ...account }) => account);
  io.emit('faculty_updated', { accounts });
  res.status(201).json({ success: true, account: accountSafe, accounts });
});

app.delete('/api/admin/accounts/:id', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const requestingAdminId = req.get('x-admin-id');
  if (req.params.id === requestingAdminId) {
    return res.status(403).json({ error: 'You cannot delete your own signed-in account' });
  }

  const data = getData();
  data.admins = data.admins || [];
  if (data.admins.length <= 1) {
    return res.status(409).json({ error: 'At least one faculty account must remain' });
  }

  const accountIndex = data.admins.findIndex(account => account.id === req.params.id);
  if (accountIndex === -1) return res.status(404).json({ error: 'Faculty account not found' });
  const [deletedAccount] = data.admins.splice(accountIndex, 1);
  if (!saveData(data)) return res.status(500).json({ error: 'Could not save faculty account changes' });

  for (const client of io.sockets.sockets.values()) {
    if (client.data.presenceUserId === deletedAccount.id) client.disconnect(true);
  }

  const accounts = data.admins.map(({ password: _, ...account }) => account);
  io.emit('faculty_updated', { accounts });
  res.json({ success: true, deletedId: deletedAccount.id, accounts });
});

// Admin deletes a student
app.delete('/api/admin/students/:id', (req, res) => {
  const { id } = req.params;
  const data = getData();
  data.students = (data.students || []).filter(s => s.id !== id);
  saveData(data);
  io.emit('students_updated', { students: data.students.map(({ password: _, ...s }) => s) });
  res.json({ success: true });
});

// Admin resets student password
app.post('/api/admin/students/:id/password', (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New password required' });

  const data = getData();
  const student = (data.students || []).find(s => s.id === id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  student.password = newPassword;
  saveData(data);
  res.json({ success: true, message: 'Password updated successfully' });
});

// Admin marks attendance
app.post('/api/admin/attendance/mark', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const { studentId, status, remarks, date } = req.body;
  if (!studentId || !date || !['Present', 'Absent', 'Late'].includes(status)) {
    return res.status(400).json({ error: 'Student, valid date, and attendance status are required' });
  }
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== date) {
    return res.status(400).json({ error: 'A valid attendance date is required' });
  }

  const data = getData();
  const student = (data.students || []).find(item => item.id === studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  data.attendance = data.attendance || { overall: {}, monthlyLog: [] };
  data.attendance.monthlyLog = data.attendance.monthlyLog || [];

  const matchingLogs = data.attendance.monthlyLog.filter(log =>
    log.studentId === student.id && log.date === date
  );
  const attendanceLog = {
    ...(matchingLogs[0] || {}),
    id: matchingLogs[0]?.id || crypto.randomUUID(),
    date,
    studentId: student.id,
    studentName: student.name,
    status,
    remarks: (typeof remarks === 'string' && remarks.trim()) || 'Recorded by Faculty'
  };

  data.attendance.monthlyLog = data.attendance.monthlyLog.filter(log =>
    !(log.studentId === student.id && log.date === date)
  );
  data.attendance.monthlyLog.unshift(attendanceLog);

  if (!saveData(data)) return res.status(500).json({ error: 'Could not save attendance' });
  io.emit('attendance_updated', data.attendance);

  res.json({
    success: true,
    attendance: data.attendance,
    studentSummary: summarizeStudentAttendance(
      getStudentAttendanceLogs(data.attendance.monthlyLog, student),
      data.attendance.overall?.targetPercentage || 75
    )
  });
});

// Admin approves or rejects leave
app.post('/api/admin/leaves/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, remarks } = req.body;
  const data = getData();

  data.attendance = data.attendance || { leaveRequests: [] };
  const leave = (data.attendance.leaveRequests || []).find(l => l.id === id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });

  leave.status = status || 'Approved';
  leave.reviewedBy = 'Faculty Coordinator';
  leave.reviewRemarks = remarks || '';
  leave.reviewedAt = new Date().toISOString();

  saveData(data);
  io.emit('leave_updated', { leaves: data.attendance.leaveRequests, updatedLeave: leave });

  res.json({ success: true, leave, leaves: data.attendance.leaveRequests });
});

// Admin broadcasts announcement
app.post('/api/admin/announcements', (req, res) => {
  if (!isAuthenticatedAdmin(req)) return res.status(401).json({ error: 'Admin authentication required' });
  const { title, category, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });

  const data = getData();
  const newNotice = {
    id: 'not_' + Date.now(),
    title,
    category: category || 'ACADEMIC',
    badgeClass: category === 'URGENT' ? 'urgent' : (category === 'EVENT' ? 'success' : 'info'),
    content,
    author: 'Faculty Office',
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  };
  const admin = (data.admins || []).find(item => item.id === req.get('x-admin-id'));

  data.announcements = data.announcements || [];
  data.announcements.unshift(newNotice);

  // Send to chat announcements channel
  const chatNotice = {
    id: 'msg_' + Date.now(),
    channelId: 'announcements',
    senderId: admin.id,
    senderName: admin.name || 'Faculty Office',
    senderRole: 'Teacher',
    text: `📢 [${newNotice.category}] ${title}: ${content}`,
    timestamp: new Date().toISOString()
  };
  data.messages = data.messages || [];
  data.messages.push(chatNotice);

  if (!saveData(data)) return res.status(500).json({ error: 'Could not save the announcement' });
  io.emit('new_announcement', newNotice);
  io.to('announcements').emit('new_message', chatNotice);
  sendAnnouncementPush(newNotice).catch(error => {
    console.error('Could not deliver announcement push notifications:', error);
  });

  res.status(201).json({ success: true, announcement: newNotice });
});

// Admin submits PTM feedback
app.post('/api/admin/ptm/feedback', (req, res) => {
  const { studentName, teacher, rating, remarks, actionItems } = req.body;
  if (!studentName || !remarks) return res.status(400).json({ error: 'Student name and remarks required' });

  const data = getData();
  data.ptm = data.ptm || { pastFeedback: [] };
  data.ptm.pastFeedback = data.ptm.pastFeedback || [];

  const newFeedback = {
    id: 'fb_' + Date.now(),
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    teacher: teacher || 'Faculty',
    studentName,
    rating: parseInt(rating) || 5,
    remarks,
    actionItems: actionItems || 'Consistent daily study revision.'
  };

  data.ptm.pastFeedback.unshift(newFeedback);
  saveData(data);
  io.emit('ptm_updated', data.ptm);

  res.status(201).json({ success: true, feedback: newFeedback, ptm: data.ptm });
});

// Admin adds holiday
app.post('/api/admin/holidays', (req, res) => {
  const { title, date, endDate, type, duration, description } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'Title and date required' });

  const data = getData();
  const newHoliday = {
    id: 'hol_' + Date.now(),
    title,
    date,
    endDate: endDate || date,
    type: type || 'Festival',
    duration: duration || '1 Day',
    badge: type || 'Holiday',
    description: description || 'Official school holiday declared.'
  };

  data.holidays = data.holidays || [];
  data.holidays.push(newHoliday);
  data.holidays.sort((a, b) => new Date(a.date) - new Date(b.date));

  saveData(data);
  io.emit('holidays_updated', { holidays: data.holidays, newHoliday });

  res.status(201).json({ success: true, holiday: newHoliday, holidays: data.holidays });
});

app.delete('/api/admin/holidays/:id', (req, res) => {
  const data = getData();
  data.holidays = data.holidays || [];
  const holidayIndex = data.holidays.findIndex(holiday => holiday.id === req.params.id);
  if (holidayIndex === -1) {
    return res.status(404).json({ error: 'Festival or holiday not found' });
  }

  const [deletedHoliday] = data.holidays.splice(holidayIndex, 1);
  if (!saveData(data)) {
    return res.status(500).json({ error: 'Could not save the updated calendar' });
  }

  io.emit('holidays_updated', { holidays: data.holidays, deletedHolidayId: deletedHoliday.id });
  res.json({ success: true, holidays: data.holidays });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api/')) return next(err);
  if (res.headersSent) return next(err);

  const status = err.statusCode || err.status || 500;
  const error = status === 413
    ? 'Request exceeds the upload size limit'
    : (status === 400 ? 'Invalid request body' : 'API request failed');
  res.status(status).json({ error });
});

// ================= SOCKET.IO REALTIME =================

io.on('connection', (socket) => {
  socket.emit('presence_update', { onlineUserIds: [...onlineUsers.keys()] });

  socket.on('identify_user', ({ userId } = {}) => {
    if (typeof userId !== 'string') return;
    if (socket.data.presenceUserId === userId) return;

    const data = getData();
    const user = [...(data.students || []), ...(data.admins || [])].find(item => item.id === userId);
    if (!user) return;

    removeSocketPresence(socket);
    const presence = onlineUsers.get(userId) || { connections: 0 };
    presence.connections += 1;
    onlineUsers.set(userId, presence);
    socket.data.presenceUserId = userId;
    broadcastPresence();
  });

  socket.on('leave_presence', () => removeSocketPresence(socket));

  socket.on('join_channel', (channelId) => {
    socket.join(channelId);
  });

  socket.on('send_message', (msgData) => {
    const data = getData();
    const channelId = msgData.channelId || 'general';
    const senderId = socket.data.presenceUserId;
    const student = (data.students || []).find(item => item.id === senderId);
    const admin = (data.admins || []).find(item => item.id === senderId);
    const sender = student || admin;
    if (channelId === 'announcements') {
      socket.emit('message_rejected', { error: 'Official Announcements can only be posted through the staff announcement tool' });
      return;
    }
    if (!sender) {
      socket.emit('message_rejected', { error: 'Sign in before sending a chat message' });
      return;
    }

    let cooldownUntil = 0;
    const messageSenderId = sender.id;
    const messageSenderName = sender.name;
    const messageSenderRole = admin || sender.role === 'Teacher' ? 'Teacher' : 'Student';
    if (channelId === ALL_SUBJECTS_CHAT_CHANNEL) {
      if (!student) {
        socket.emit('message_rejected', { error: 'Student authentication required for this channel' });
        return;
      }

      const cooldown = getStudentChatCooldown(student.id);
      if (cooldown.remainingMs > 0) {
        socket.emit('message_rejected', {
          error: `Please wait ${Math.ceil(cooldown.remainingMs / 1000)} seconds before sending another message.`,
          retryAfterMs: cooldown.remainingMs,
          cooldownUntil: cooldown.cooldownUntil
        });
        return;
      }

      cooldownUntil = Date.now() + STUDENT_CHAT_COOLDOWN_MS;
    }

    const newMsg = {
      id: 'msg_' + Date.now(),
      channelId,
      senderId: messageSenderId,
      senderName: messageSenderName,
      senderRole: messageSenderRole,
      text: msgData.text,
      timestamp: new Date().toISOString()
    };

    data.messages = data.messages || [];
    data.messages.push(newMsg);
    if (!saveData(data)) {
      socket.emit('message_rejected', { error: 'Could not save chat message' });
      return;
    }

    if (cooldownUntil) allSubjectsChatCooldowns.set(messageSenderId, cooldownUntil);

    const broadcastMessage = cooldownUntil ? { ...newMsg, cooldownUntil } : newMsg;
    io.to(newMsg.channelId).emit('new_message', broadcastMessage);
    io.emit('new_message_global', broadcastMessage);
  });

  socket.on('typing', (data) => {
    socket.to(data.channelId).emit('user_typing', data);
  });

  socket.on('disconnect', () => removeSocketPresence(socket));
});

// Start Server
server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🎓 B.S.M.P School Live Portal Server running on :${PORT}`);
  console.log(`🔒 Student Portal URL: http://localhost:${PORT}/`);
  console.log(`🛡️ Dedicated Admin URL: http://localhost:${PORT}/admin`);
  console.log(`=================================================`);
});
