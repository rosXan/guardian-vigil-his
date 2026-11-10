/**
 * Guardian Vigil HIS — Frontend Application
 * Handles: Auth flow, Socket.IO, Queue management, UI state
 */

'use strict';

// ─── State ─────────────────────────────────────────────────────────────────────
const State = {
  user: null,
  socket: null,
  currentPage: 'dashboard',
  queueData: {},
  announcements: [],
  unreadCount: 0,
  serviceTimer: null,
  departments: []
};

// ─── Constants ─────────────────────────────────────────────────────────────────
const API = {
  login:    '/api/auth/login',
  signup:   '/api/auth/signup',
  profile:  (id) => `/api/auth/profile/${id}`,
  updateProfile: (id) => `/api/auth/profile/${id}`,
  queueStatus: '/api/queue/status',
  queueJoin:   '/api/queue/join',
  queueLeave:  '/api/queue/leave',
  queueDept:   (d) => `/api/queue/${encodeURIComponent(d)}`,
  departments: '/api/queue/departments'
};

const DEPT_ICONS = {
  'Cardiology': '🫀', 'Neurology': '🧠', 'Orthopedics': '🦴',
  'Pediatrics': '👶', 'General Medicine': '🩺', 'Dermatology': '🧴',
  'ENT': '👂', 'Ophthalmology': '👁️', 'Gynecology': '🌸',
  'Oncology': '🔬', 'Administration': '🗂️', 'Emergency': '🚨'
};

// ─── Initialization ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check persisted session
  const saved = localStorage.getItem('gv_user');
  if (saved) {
    try {
      State.user = JSON.parse(saved);
      initApp();
    } catch {
      showAuthPage();
    }
  } else {
    showAuthPage();
  }

  // Enter key on login
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
});

// ─── Auth Helpers ──────────────────────────────────────────────────────────────
function showAuthPage() {
  document.getElementById('auth-container').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  showLogin();
}

function showLogin() {
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('signup-page').classList.add('hidden');
}

function showSignup() {
  document.getElementById('signup-page').classList.remove('hidden');
  document.getElementById('login-page').classList.add('hidden');
}

function toggleDeptField() {
  const role = document.getElementById('signup-role').value;
  const deptField = document.getElementById('dept-field');
  if (role === 'doctor' || role === 'staff') {
    deptField.classList.remove('hidden');
  } else {
    deptField.classList.add('hidden');
  }
}

// ─── Login ─────────────────────────────────────────────────────────────────────
async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  if (!email || !password) {
    showAuthError('login-error', 'Please fill in all fields.');
    return;
  }

  // Loading state
  btn.querySelector('.btn-text').classList.add('hidden');
  btn.querySelector('.btn-loader').classList.remove('hidden');
  btn.disabled = true;
  errEl.classList.add('hidden');

  try {
    const res = await fetch(API.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!data.success) {
      showAuthError('login-error', data.message);
    } else {
      State.user = data.user;
      localStorage.setItem('gv_user', JSON.stringify(data.user));
      initApp();
    }
  } catch (err) {
    showAuthError('login-error', 'Connection error. Is the server running?');
  } finally {
    btn.querySelector('.btn-text').classList.remove('hidden');
    btn.querySelector('.btn-loader').classList.add('hidden');
    btn.disabled = false;
  }
}

// ─── Signup ────────────────────────────────────────────────────────────────────
async function handleSignup() {
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const role     = document.getElementById('signup-role').value;
  const department = document.getElementById('signup-department').value;

  if (!name || !email || !password || !role) {
    showAuthError('signup-error', 'All fields are required.');
    return;
  }
  if ((role === 'doctor' || role === 'staff') && !department) {
    showAuthError('signup-error', 'Please select a department.');
    return;
  }

  try {
    const res = await fetch(API.signup, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role, department })
    });
    const data = await res.json();

    if (!data.success) {
      showAuthError('signup-error', data.message);
    } else {
      document.getElementById('signup-error').classList.add('hidden');
      const succ = document.getElementById('signup-success');
      succ.textContent = 'Account created! Redirecting to login…';
      succ.classList.remove('hidden');
      setTimeout(() => {
        showLogin();
        document.getElementById('login-email').value = email;
        succ.classList.add('hidden');
      }, 1800);
    }
  } catch {
    showAuthError('signup-error', 'Connection error. Is the server running?');
  }
}

function showAuthError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ─── Logout ────────────────────────────────────────────────────────────────────
function handleLogout() {
  if (State.socket) State.socket.disconnect();
  if (State.serviceTimer) clearInterval(State.serviceTimer);
  State.user = null;
  State.socket = null;
  State.queueData = {};
  State.announcements = [];
  State.unreadCount = 0;
  localStorage.removeItem('gv_user');

  // Reset login form
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.add('hidden');

  showAuthPage();
  showToast('Logged out successfully.', 'info');
}

// ─── App Init ──────────────────────────────────────────────────────────────────
function initApp() {
  document.getElementById('auth-container').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // Set nav user info
  const user = State.user;
  document.getElementById('nav-user-name').textContent = user.name;
  document.getElementById('nav-user-role').textContent = user.role;
  document.getElementById('user-avatar').textContent   = user.name.charAt(0).toUpperCase();
  document.getElementById('sidebar-role-text').textContent = user.role.toUpperCase();

  // Adjust sidebar role badge color
  const rb = document.getElementById('sidebar-role-badge');
  rb.className = 'role-badge';
  if (user.role === 'doctor') rb.style.cssText = 'background:rgba(14,165,233,0.1);color:#38bdf8;border:1px solid rgba(14,165,233,0.2);';
  if (user.role === 'patient') rb.style.cssText = 'background:rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2);';
  if (user.role === 'staff') rb.style.cssText = 'background:rgba(245,158,11,0.1);color:#fbbf24;border:1px solid rgba(245,158,11,0.2);';

  // Load departments
  loadDepartments();

  // Init socket
  initSocket();

  // Show dashboard
  showPage('dashboard');
  updateDashboardGreeting();
}

// ─── Load Departments ──────────────────────────────────────────────────────────
async function loadDepartments() {
  try {
    const res = await fetch(API.departments);
    const data = await res.json();
    if (data.success) {
      State.departments = data.departments;
      populateDeptDropdown();
      renderFacilities();
    }
  } catch {}
}

function populateDeptDropdown() {
  const sel = document.getElementById('join-dept');
  sel.innerHTML = '<option value="">Choose department…</option>';
  State.departments.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `${DEPT_ICONS[d] || '🏥'} ${d}`;
    sel.appendChild(opt);
  });
}

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
function initSocket() {
  State.socket = io();

  State.socket.on('connect', () => {
    setConnStatus(true);

    // Register user
    if (State.user.role === 'doctor' && State.user.department) {
      State.socket.emit('doctor-online', {
        userId: State.user.id,
        department: State.user.department
      });
    }
    if (State.user.role === 'patient' && State.user.token) {
      State.socket.emit('patient-join', {
        userId: State.user.id,
        token: State.user.token,
        department: State.user.tokenDept
      });
    }
  });

  State.socket.on('disconnect', () => setConnStatus(false));

  // Initial state from server
  State.socket.on('init-state', (data) => {
    State.queueData = data.departments || {};
    State.announcements = data.announcements || [];
    updateAllStats(data);
    renderAnnouncements();
  });

  // Live queue updates
  State.socket.on('queue-update', (data) => {
    State.queueData = data.departments || {};
    updateAllStats(data);
    if (State.currentPage === 'queue-status') renderQueueStatus();
    if (State.currentPage === 'queue-ops' && State.user.role === 'doctor') renderDoctorQueue();
    if (State.currentPage === 'dashboard') updateDeptOverview();
    updatePatientTokenInfo();
    updateLastUpdated();
  });

  // Announcements
  State.socket.on('announcement', (ann) => {
    State.announcements.unshift(ann);
    if (State.announcements.length > 50) State.announcements.pop();
    renderAnnouncements();
    addNotification(ann);
    // Speech synthesis
    speak(ann.text);
    updateLastUpdated();
  });

  // Personal token call
  State.socket.on('your-token-called', (data) => {
    showTokenAlert(data.token, data.message);
    // Update local user
    State.user.token = null;
    State.user.tokenDept = null;
    localStorage.setItem('gv_user', JSON.stringify(State.user));
    updatePatientTokenInfo();
  });
}

function setConnStatus(connected) {
  const dot  = document.getElementById('conn-dot');
  const text = document.getElementById('conn-text');
  if (connected) {
    dot.className  = 'w-2 h-2 rounded-full bg-emerald-400 transition-colors animate-pulse';
    text.textContent = 'Live';
    text.className = 'text-xs text-emerald-400';
  } else {
    dot.className  = 'w-2 h-2 rounded-full bg-rose-500 transition-colors';
    text.textContent = 'Disconnected';
    text.className = 'text-xs text-rose-400';
  }
}

// ─── Page Navigation ───────────────────────────────────────────────────────────
function showPage(page) {
  State.currentPage = page;

  // Hide all pages
  document.querySelectorAll('.page-content').forEach(el => el.classList.add('hidden'));
  // Show target
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.remove('hidden');

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Page-specific init
  switch (page) {
    case 'dashboard':
      updateDeptOverview();
      updatePatientTokenInfo();
      renderAnnouncements();
      break;
    case 'queue-ops':
      setupQueueOpsPage();
      break;
    case 'facilities':
      renderFacilities();
      break;
    case 'queue-status':
      renderQueueStatus();
      break;
    case 'profile':
      renderProfile();
      break;
  }
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────
function updateAllStats(data) {
  animateNumber('stat-waiting', data.totalWaiting || 0);
  animateNumber('stat-active', data.activeQueues || 0);
  document.getElementById('stat-avgwait').textContent = `${data.avgServiceTime || 8}m`;

  // Current token: find any active token across departments
  let current = '—';
  if (data.departments) {
    const depts = Object.values(data.departments);
    const withCurrent = depts.find(d => d.current);
    if (withCurrent) current = withCurrent.current;
  }
  document.getElementById('stat-current').textContent = current;
  updateDeptOverview();
}

function animateNumber(elId, val) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (el.textContent !== String(val)) {
    el.textContent = val;
    el.classList.remove('num-updated');
    void el.offsetWidth; // reflow
    el.classList.add('num-updated');
  }
}

function updateDashboardGreeting() {
  const hour = new Date().getHours();
  let greeting = 'Good morning';
  if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
  if (hour >= 17) greeting = 'Good evening';
  document.getElementById('dash-greeting').textContent =
    `${greeting}, ${State.user.name.split(' ')[0]}! Here's the live overview.`;
}

function updateDeptOverview() {
  const grid = document.getElementById('dept-overview');
  if (!grid) return;
  grid.innerHTML = '';

  Object.entries(State.queueData).forEach(([dept, info]) => {
    const card = document.createElement('div');
    card.className = `dept-mini-card ${info.waiting > 0 ? 'has-patients' : ''}`;
    card.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-slate-500 truncate">${dept}</span>
        <span class="text-lg">${DEPT_ICONS[dept] || '🏥'}</span>
      </div>
      <div class="waiting-count">${info.waiting}</div>
      <div class="text-xs text-slate-500">waiting${info.current ? ` · ${info.current}` : ''}</div>
      <div class="mt-1.5 flex items-center gap-1">
        <div class="w-1.5 h-1.5 rounded-full ${info.doctorOnline ? 'bg-emerald-400' : 'bg-slate-600'}"></div>
        <span class="text-xs text-slate-600">${info.doctorOnline ? 'Doctor online' : 'Offline'}</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

function updateLastUpdated() {
  const el = document.getElementById('last-updated');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

// ─── Announcements ─────────────────────────────────────────────────────────────
function renderAnnouncements() {
  const list = document.getElementById('announcements-list');
  if (!list) return;
  if (State.announcements.length === 0) {
    list.innerHTML = '<p class="text-slate-500 text-sm text-center py-6">No announcements yet</p>';
    return;
  }
  list.innerHTML = State.announcements.slice(0, 15).map(ann => `
    <div class="announcement-item ${ann.type || 'general'}">
      <div class="flex items-start justify-between gap-2">
        <span class="text-sm text-slate-300 leading-relaxed">${ann.text}</span>
        <span class="text-xs text-slate-600 whitespace-nowrap flex-shrink-0">
          ${new Date(ann.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  `).join('');
}

function addNotification(ann) {
  State.unreadCount++;
  const badge = document.getElementById('notif-badge');
  badge.textContent = State.unreadCount > 9 ? '9+' : State.unreadCount;
  badge.classList.remove('hidden');

  // Add to notification panel
  const list = document.getElementById('notif-list');
  const empty = list.querySelector('p');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'px-4 py-3 text-sm text-slate-300 hover:bg-slate-800/50 transition-colors';
  item.innerHTML = `
    <p class="leading-relaxed">${ann.text}</p>
    <p class="text-xs text-slate-600 mt-1">${new Date(ann.timestamp).toLocaleTimeString()}</p>
  `;
  list.insertBefore(item, list.firstChild);

  // Show toast
  showToast(ann.text.substring(0, 60) + '…', ann.type === 'token-call' ? 'success' : 'info');
}

function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    State.unreadCount = 0;
    document.getElementById('notif-badge').classList.add('hidden');
  }
}

// ─── Queue Operations Page ─────────────────────────────────────────────────────
function setupQueueOpsPage() {
  const role = State.user.role;
  document.getElementById('patient-join-section').classList.toggle('hidden', role !== 'patient');
  document.getElementById('doctor-section').classList.toggle('hidden', role !== 'doctor');
  document.getElementById('staff-section').classList.toggle('hidden', role !== 'staff');

  if (role === 'doctor') {
    document.getElementById('doctor-dept-name').textContent = State.user.department || '—';
    renderDoctorQueue();
    startServiceTimer();
  }
  if (role === 'patient') {
    updatePatientTokenInfo();
  }
}

async function joinQueue() {
  const dept = document.getElementById('join-dept').value;
  if (!dept) { showToast('Please select a department.', 'error'); return; }
  if (State.user.token) { showToast('You are already in a queue!', 'error'); return; }

  try {
    const res = await fetch(API.queueJoin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: State.user.id,
        userName: State.user.name,
        department: dept
      })
    });
    const data = await res.json();
    if (data.success) {
      State.user.token    = data.token;
      State.user.tokenDept = data.department;
      localStorage.setItem('gv_user', JSON.stringify(State.user));

      // Register with socket for personal updates
      State.socket.emit('patient-join', {
        userId: State.user.id,
        token: data.token,
        department: dept
      });

      showToast(`Joined queue! Token: ${data.token}  |  Position: ${data.position}`, 'success');
      updatePatientTokenInfo();
    } else {
      showToast(data.message, 'error');
    }
  } catch {
    showToast('Failed to join queue. Try again.', 'error');
  }
}

async function leaveQueue() {
  if (!State.user.token) return;
  try {
    const res = await fetch(API.queueLeave, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: State.user.id })
    });
    const data = await res.json();
    if (data.success) {
      State.user.token = null;
      State.user.tokenDept = null;
      localStorage.setItem('gv_user', JSON.stringify(State.user));
      updatePatientTokenInfo();
      showToast('Left queue successfully.', 'info');
    }
  } catch {
    showToast('Error leaving queue.', 'error');
  }
}

function updatePatientTokenInfo() {
  if (State.user.role !== 'patient') return;

  const section = document.getElementById('patient-token-section');
  const myToken = document.getElementById('my-token-display');
  const myDept  = document.getElementById('my-token-dept');
  const myPos   = document.getElementById('my-token-pos');
  const myWait  = document.getElementById('my-token-wait');

  // Also update profile section
  const profSection = document.getElementById('profile-token-section');
  const profToken = document.getElementById('profile-token');
  const profDept  = document.getElementById('profile-token-dept');

  if (State.user.token) {
    section?.classList.remove('hidden');
    profSection?.classList.remove('hidden');
    myToken.textContent = State.user.token;
    profToken && (profToken.textContent = State.user.token);

    const dept = State.user.tokenDept || '—';
    myDept.textContent = dept;
    profDept && (profDept.textContent = dept);

    // Find position in queue data
    const qInfo = State.queueData[dept];
    if (qInfo) {
      const pos = qInfo.waiting;
      myPos.textContent = pos > 0 ? `#${pos}` : 'You\'re next!';
      myWait.textContent = `~${pos * 8} min`;
    } else {
      myPos.textContent = '—';
      myWait.textContent = '—';
    }
  } else {
    section?.classList.add('hidden');
    profSection?.classList.add('hidden');
  }
}

// ─── Doctor Queue ──────────────────────────────────────────────────────────────
async function renderDoctorQueue() {
  const dept = State.user.department;
  if (!dept) return;

  try {
    const res = await fetch(API.queueDept(dept));
    const data = await res.json();
    if (!data.success) return;

    // Current token
    document.getElementById('doc-current-token').textContent =
      data.currentToken ? data.currentToken.token : '—';
    document.getElementById('doc-current-name').textContent =
      data.currentToken ? data.currentToken.userName : 'No patient';
    document.getElementById('doc-queue-count').textContent = data.tokens.length;

    // Queue list
    const listEl = document.getElementById('doctor-queue-list');
    if (data.tokens.length === 0) {
      listEl.innerHTML = '<p class="text-slate-500 text-sm text-center py-6">Queue is empty</p>';
    } else {
      listEl.innerHTML = data.tokens.map((t, i) => `
        <div class="queue-list-item">
          <div class="pos-badge">${i + 1}</div>
          <div class="flex-1">
            <p class="text-white text-sm font-medium">${t.userName}</p>
            <p class="text-slate-500 text-xs">Token: ${t.token} · Wait: ~${(i + 1) * 8}m</p>
          </div>
          <span class="text-xs text-slate-600">${new Date(t.joinedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
        </div>
      `).join('');
    }
  } catch {}
}

async function callNextPatient() {
  const dept = State.user.department;
  if (!dept) { showToast('No department assigned.', 'error'); return; }

  // Use socket for real-time notification
  State.socket.emit('call-next', { department: dept, doctorId: State.user.id });

  // Also via REST
  try {
    const res = await fetch('/api/queue/call-next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department: dept, doctorId: State.user.id })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Called: ${data.called.token} — ${data.called.userName}`, 'success');
      renderDoctorQueue();
    } else {
      showToast(data.message, 'error');
    }
  } catch {}
}

// Service timer for doctor
function startServiceTimer() {
  if (State.serviceTimer) clearInterval(State.serviceTimer);
  let seconds = 0;
  State.serviceTimer = setInterval(() => {
    seconds++;
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const el = document.getElementById('doc-service-timer');
    if (el) el.textContent = `Service time: ${mm}:${ss}`;
  }, 1000);
}

// ─── Staff Broadcast ───────────────────────────────────────────────────────────
function broadcastAnnouncement() {
  const text = document.getElementById('broadcast-text').value.trim();
  if (!text) { showToast('Please enter a message.', 'error'); return; }
  State.socket.emit('broadcast-announcement', { text, userId: State.user.id });
  document.getElementById('broadcast-text').value = '';
  showToast('Announcement sent!', 'success');
}

// ─── Facilities Page ───────────────────────────────────────────────────────────
function renderFacilities() {
  const grid = document.getElementById('facilities-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const facilityData = {
    'Cardiology':       { beds: 24, doctors: 4, desc: 'Heart & cardiovascular care' },
    'Neurology':        { beds: 18, doctors: 3, desc: 'Brain & nervous system' },
    'Orthopedics':      { beds: 20, doctors: 5, desc: 'Bones, joints & muscles' },
    'Pediatrics':       { beds: 30, doctors: 6, desc: 'Child & infant health' },
    'General Medicine': { beds: 50, doctors: 10, desc: 'Primary & general care' },
    'Dermatology':      { beds: 8,  doctors: 2, desc: 'Skin conditions & treatment' },
    'ENT':              { beds: 12, doctors: 3, desc: 'Ear, nose & throat' },
    'Ophthalmology':    { beds: 10, doctors: 2, desc: 'Eye care & surgery' },
    'Gynecology':       { beds: 22, doctors: 4, desc: "Women's health" },
    'Oncology':         { beds: 15, doctors: 3, desc: 'Cancer treatment' },
    'Administration':   { beds: 0,  doctors: 0, desc: 'Hospital administration' },
    'Emergency':        { beds: 40, doctors: 12, desc: '24/7 emergency care' }
  };

  State.departments.forEach(dept => {
    const info = facilityData[dept] || { beds: 10, doctors: 2, desc: 'Medical department' };
    const qInfo = State.queueData[dept] || { waiting: 0, doctorOnline: false };
    const card = document.createElement('div');
    card.className = 'facility-card';
    card.innerHTML = `
      <div class="flex items-start justify-between mb-3">
        <div>
          <span class="text-2xl mb-1 block">${DEPT_ICONS[dept] || '🏥'}</span>
          <h3 class="font-display font-semibold text-white text-sm">${dept}</h3>
          <p class="text-xs text-slate-500 mt-0.5">${info.desc}</p>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-2 h-2 rounded-full ${qInfo.doctorOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}"></div>
          <span class="text-xs ${qInfo.doctorOnline ? 'text-emerald-400' : 'text-slate-600'}">${qInfo.doctorOnline ? 'Active' : 'Offline'}</span>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-700/50">
        <div class="text-center">
          <p class="font-display font-bold text-vigil-400">${info.beds}</p>
          <p class="text-xs text-slate-600">Beds</p>
        </div>
        <div class="text-center">
          <p class="font-display font-bold text-emerald-400">${info.doctors}</p>
          <p class="text-xs text-slate-600">Doctors</p>
        </div>
        <div class="text-center">
          <p class="font-display font-bold text-amber-400">${qInfo.waiting}</p>
          <p class="text-xs text-slate-600">Waiting</p>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ─── Queue Status Page ─────────────────────────────────────────────────────────
function renderQueueStatus() {
  const grid = document.getElementById('queue-status-grid');
  if (!grid) return;
  grid.innerHTML = '';

  Object.entries(State.queueData).forEach(([dept, info]) => {
    const card = document.createElement('div');
    card.className = 'queue-status-card';

    const waitBar = Math.min(100, (info.waiting / 20) * 100);
    card.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="text-xl">${DEPT_ICONS[dept] || '🏥'}</span>
          <div>
            <h3 class="font-display font-semibold text-white text-sm">${dept}</h3>
            <div class="flex items-center gap-1.5 mt-0.5">
              <div class="w-1.5 h-1.5 rounded-full ${info.doctorOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}"></div>
              <span class="text-xs ${info.doctorOnline ? 'text-emerald-400' : 'text-slate-600'}">${info.doctorOnline ? 'Doctor online' : 'Offline'}</span>
            </div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-display text-2xl font-bold text-white">${info.waiting}</div>
          <div class="text-xs text-slate-500">in queue</div>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-3">
        <div class="h-full rounded-full transition-all duration-700 ${info.waiting === 0 ? 'bg-slate-700' : 'bg-gradient-to-r from-vigil-600 to-vigil-400'}"
          style="width: ${waitBar}%"></div>
      </div>

      <div class="flex items-center justify-between text-xs text-slate-500">
        <span>Current: <span class="text-white font-medium">${info.current || '—'}</span></span>
        <span>Est. wait: <span class="text-amber-400 font-medium">~${info.waiting * 8}m</span></span>
        <span>Served: <span class="text-emerald-400 font-medium">${info.served || 0}</span></span>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ─── Profile Page ──────────────────────────────────────────────────────────────
function renderProfile() {
  const u = State.user;
  document.getElementById('profile-avatar-letter').textContent = u.name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent        = u.name;
  document.getElementById('profile-email').textContent       = u.email;
  document.getElementById('profile-detail-name').textContent = u.name;
  document.getElementById('profile-detail-email').textContent = u.email;
  document.getElementById('profile-detail-role').textContent = u.role;
  document.getElementById('profile-detail-dept').textContent = u.department || 'N/A';
  document.getElementById('profile-detail-date').textContent =
    new Date(u.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  // Role badge
  const roleBadge = document.getElementById('profile-role-badge');
  roleBadge.textContent = u.role.charAt(0).toUpperCase() + u.role.slice(1);
  roleBadge.className = `inline-block px-4 py-1.5 rounded-full text-sm font-medium badge-${u.role}`;

  // Token section
  if (u.role === 'patient') {
    updatePatientTokenInfo();
  }

  // Hide dept field for patients in edit modal
  const editDeptField = document.getElementById('edit-dept-field');
  if (editDeptField) {
    editDeptField.style.display = (u.role === 'patient') ? 'none' : 'block';
  }
}

function openEditModal() {
  document.getElementById('edit-name').value = State.user.name;
  if (State.user.department) {
    const sel = document.getElementById('edit-dept');
    for (let opt of sel.options) {
      if (opt.value === State.user.department) { opt.selected = true; break; }
    }
  }
  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
}

async function saveProfile() {
  const name = document.getElementById('edit-name').value.trim();
  const dept = document.getElementById('edit-dept').value;

  if (!name) { showToast('Name cannot be empty.', 'error'); return; }

  try {
    const body = { name };
    if (State.user.role !== 'patient') body.department = dept;

    const res = await fetch(API.updateProfile(State.user.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      State.user = { ...State.user, ...data.user };
      localStorage.setItem('gv_user', JSON.stringify(State.user));
      closeEditModal();
      renderProfile();
      document.getElementById('nav-user-name').textContent = State.user.name;
      document.getElementById('user-avatar').textContent = State.user.name.charAt(0).toUpperCase();
      showToast('Profile updated!', 'success');
    }
  } catch {
    showToast('Failed to update profile.', 'error');
  }
}

// ─── Token Alert Modal ─────────────────────────────────────────────────────────
function showTokenAlert(token, message) {
  document.getElementById('alert-token').textContent = token;
  document.getElementById('alert-message').textContent = message;
  document.getElementById('token-alert-modal').classList.remove('hidden');
  // Also speak
  speak(`Your token ${token} has been called. Please proceed immediately.`);
}

function closeTokenAlert() {
  document.getElementById('token-alert-modal').classList.add('hidden');
}

// ─── Speech Synthesis ──────────────────────────────────────────────────────────
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang  = 'en-IN';
  utterance.rate  = 0.85;
  utterance.pitch = 1;
  utterance.volume = 1;
  // Try to use a local voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang === 'en-IN' || v.lang === 'en-US');
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  const inner = toast.querySelector('.flex');
  const text  = document.getElementById('toast-text');
  const icon  = document.getElementById('toast-icon');

  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  icon.textContent = icons[type] || '✓';
  text.textContent = msg;

  inner.className = `flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium toast-${type}`;
  toast.classList.remove('hidden');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ─── Close panels on outside click ────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notif-panel');
  const bell  = e.target.closest('button[onclick="toggleNotifications()"]');
  if (!bell && panel && !panel.classList.contains('hidden') && !panel.contains(e.target)) {
    panel.classList.add('hidden');
  }
});
