/**
 * Guardian Vigil HIS - Backend Server
 * Express + Socket.IO for real-time hospital queue management
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-Memory Data Store ──────────────────────────────────────────────────────
const store = {
  users: [
    // Seed demo users
    {
      id: 'u1', name: 'Dr. Arun Kumar', email: 'doctor@gvhis.com',
      password: 'doctor123', role: 'doctor', department: 'Cardiology',
      createdAt: new Date().toISOString()
    },
    {
      id: 'u2', name: 'Priya Sharma', email: 'patient@gvhis.com',
      password: 'patient123', role: 'patient', department: null,
      createdAt: new Date().toISOString()
    },
    {
      id: 'u3', name: 'Kavitha R', email: 'staff@gvhis.com',
      password: 'staff123', role: 'staff', department: 'Administration',
      createdAt: new Date().toISOString()
    }
  ],
  queues: {},       // department -> { tokens: [], currentToken: null, history: [] }
  announcements: [],
  stats: {
    totalPatients: 0,
    activeQueues: 0,
    avgServiceTime: 8  // minutes
  }
};

// Initialize department queues
const DEPARTMENTS = [
  'Cardiology', 'Neurology', 'Orthopedics', 'Pediatrics',
  'General Medicine', 'Dermatology', 'ENT', 'Ophthalmology',
  'Gynecology', 'Oncology', 'Administration', 'Emergency'
];

DEPARTMENTS.forEach(dept => {
  store.queues[dept] = {
    tokens: [],
    currentToken: null,
    history: [],
    doctorOnline: false,
    serviceStartTime: null
  };
});

// ─── Helper Functions ──────────────────────────────────────────────────────────
function generateToken(department) {
  const prefix = department.substring(0, 3).toUpperCase();
  const num = String(store.queues[department].tokens.length +
    store.queues[department].history.length + 1).padStart(3, '0');
  return `${prefix}-${num}`;
}

function getQueueStats() {
  const stats = {};
  let totalWaiting = 0;
  let activeQueues = 0;
  DEPARTMENTS.forEach(dept => {
    const q = store.queues[dept];
    stats[dept] = {
      waiting: q.tokens.length,
      current: q.currentToken ? q.currentToken.token : null,
      doctorOnline: q.doctorOnline,
      served: q.history.length
    };
    totalWaiting += q.tokens.length;
    if (q.tokens.length > 0 || q.currentToken) activeQueues++;
  });
  return { stats, totalWaiting, activeQueues };
}

function broadcastUpdate() {
  const { stats, totalWaiting, activeQueues } = getQueueStats();
  io.emit('queue-update', {
    departments: stats,
    totalWaiting,
    activeQueues,
    avgServiceTime: store.stats.avgServiceTime
  });
}

// ─── Auth Routes ───────────────────────────────────────────────────────────────
const authRouter = require('./routes/auth')(store);
const queueRouter = require('./routes/queue')(store, io, broadcastUpdate, DEPARTMENTS, generateToken);

app.use('/api/auth', authRouter);
app.use('/api/queue', queueRouter);

// ─── Socket.IO Real-time Events ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Send initial state on connect
  socket.emit('init-state', {
    ...getQueueStats(),
    announcements: store.announcements.slice(-10),
    avgServiceTime: store.stats.avgServiceTime
  });

  // Doctor marks themselves online for a department
  socket.on('doctor-online', ({ userId, department }) => {
    if (store.queues[department]) {
      store.queues[department].doctorOnline = true;
      socket.join(`dept-${department}`);
      socket.department = department;
      socket.userId = userId;
      broadcastUpdate();
      console.log(`[Socket] Doctor online in ${department}`);
    }
  });

  // Patient joins a room to get personal updates
  socket.on('patient-join', ({ userId, token, department }) => {
    socket.join(`patient-${userId}`);
    socket.userId = userId;
    console.log(`[Socket] Patient ${userId} joined with token ${token}`);
  });

  // Call next patient (doctor action)
  socket.on('call-next', ({ department, doctorId }) => {
    const q = store.queues[department];
    if (!q || q.tokens.length === 0) {
      socket.emit('call-result', { success: false, message: 'Queue is empty' });
      return;
    }

    // Move current to history
    if (q.currentToken) {
      q.history.push({ ...q.currentToken, completedAt: new Date().toISOString() });
    }

    // Get next token
    const next = q.tokens.shift();
    next.calledAt = new Date().toISOString();
    q.currentToken = next;
    q.serviceStartTime = Date.now();

    // Notify the specific patient
    io.to(`patient-${next.userId}`).emit('your-token-called', {
      token: next.token,
      department,
      message: `Token ${next.token} - Please proceed to ${department} counter.`
    });

    // Speech announcement payload
    const announcement = {
      id: uuidv4(),
      text: `Attention! Token number ${next.token} for ${department}, please proceed to the consultation room.`,
      department,
      token: next.token,
      timestamp: new Date().toISOString(),
      type: 'token-call'
    };
    store.announcements.push(announcement);
    io.emit('announcement', announcement);

    broadcastUpdate();
    socket.emit('call-result', { success: true, called: next });
  });

  // Staff / admin broadcast announcement
  socket.on('broadcast-announcement', ({ text, userId }) => {
    const announcement = {
      id: uuidv4(),
      text,
      timestamp: new Date().toISOString(),
      type: 'general',
      sentBy: userId
    };
    store.announcements.push(announcement);
    io.emit('announcement', announcement);
  });

  socket.on('disconnect', () => {
    if (socket.department) {
      const q = store.queues[socket.department];
      if (q) q.doctorOnline = false;
      broadcastUpdate();
    }
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// ─── Catch-all: serve index.html ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🏥 Guardian Vigil HIS running at http://localhost:${PORT}`);
  console.log(`\nDemo credentials:`);
  console.log(`  Doctor  → doctor@gvhis.com  / doctor123`);
  console.log(`  Patient → patient@gvhis.com / patient123`);
  console.log(`  Staff   → staff@gvhis.com   / staff123\n`);
});
