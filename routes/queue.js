/**
 * Queue Routes — Patient queue management
 */
const express = require('express');

module.exports = function(store, io, broadcastUpdate, DEPARTMENTS, generateToken) {
  const router = express.Router();

  // GET /api/queue/departments
  router.get('/departments', (req, res) => {
    res.json({ success: true, departments: DEPARTMENTS });
  });

  // GET /api/queue/status
  router.get('/status', (req, res) => {
    const status = {};
    DEPARTMENTS.forEach(dept => {
      const q = store.queues[dept];
      status[dept] = {
        waiting: q.tokens.length,
        current: q.currentToken,
        doctorOnline: q.doctorOnline,
        served: q.history.length,
        estimatedWait: q.tokens.length * store.stats.avgServiceTime
      };
    });
    res.json({ success: true, status, avgServiceTime: store.stats.avgServiceTime });
  });

  // POST /api/queue/join
  router.post('/join', (req, res) => {
    const { userId, department, userName } = req.body;

    if (!DEPARTMENTS.includes(department)) {
      return res.status(400).json({ success: false, message: 'Invalid department.' });
    }

    const q = store.queues[department];

    // Check if user already in any queue
    const alreadyInQueue = DEPARTMENTS.some(d =>
      store.queues[d].tokens.some(t => t.userId === userId) ||
      (store.queues[d].currentToken && store.queues[d].currentToken.userId === userId)
    );
    if (alreadyInQueue) {
      return res.status(409).json({ success: false, message: 'You are already in a queue.' });
    }

    const token = generateToken(department);
    const position = q.tokens.length + 1;
    const estimatedWait = position * store.stats.avgServiceTime;

    const entry = {
      token,
      userId,
      userName,
      department,
      position,
      joinedAt: new Date().toISOString(),
      calledAt: null,
      estimatedWait
    };

    q.tokens.push(entry);

    // Update user's token info
    const userIdx = store.users.findIndex(u => u.id === userId);
    if (userIdx !== -1) {
      store.users[userIdx].token = token;
      store.users[userIdx].tokenDept = department;
    }

    broadcastUpdate();
    res.json({
      success: true,
      token,
      position,
      estimatedWait,
      department,
      message: `Successfully joined ${department} queue. Your token: ${token}`
    });
  });

  // POST /api/queue/leave
  router.post('/leave', (req, res) => {
    const { userId } = req.body;

    DEPARTMENTS.forEach(dept => {
      const q = store.queues[dept];
      const idx = q.tokens.findIndex(t => t.userId === userId);
      if (idx !== -1) q.tokens.splice(idx, 1);
      // Recalculate positions
      q.tokens.forEach((t, i) => { t.position = i + 1; t.estimatedWait = (i + 1) * store.stats.avgServiceTime; });
    });

    const userIdx = store.users.findIndex(u => u.id === userId);
    if (userIdx !== -1) {
      store.users[userIdx].token = null;
      store.users[userIdx].tokenDept = null;
    }

    broadcastUpdate();
    res.json({ success: true, message: 'Left queue successfully.' });
  });

  // GET /api/queue/:department
  router.get('/:department', (req, res) => {
    const dept = decodeURIComponent(req.params.department);
    if (!store.queues[dept]) {
      return res.status(404).json({ success: false, message: 'Department not found.' });
    }
    const q = store.queues[dept];
    res.json({
      success: true,
      department: dept,
      tokens: q.tokens,
      currentToken: q.currentToken,
      history: q.history.slice(-5),
      doctorOnline: q.doctorOnline,
      waiting: q.tokens.length
    });
  });

  // POST /api/queue/call-next
  router.post('/call-next', (req, res) => {
    const { department, doctorId } = req.body;
    const q = store.queues[department];

    if (!q) return res.status(404).json({ success: false, message: 'Department not found.' });
    if (q.tokens.length === 0) return res.status(400).json({ success: false, message: 'Queue is empty.' });

    if (q.currentToken) {
      q.history.push({ ...q.currentToken, completedAt: new Date().toISOString() });
    }

    const next = q.tokens.shift();
    next.calledAt = new Date().toISOString();
    q.currentToken = next;
    q.serviceStartTime = Date.now();

    // Recalc positions
    q.tokens.forEach((t, i) => { t.position = i + 1; });

    broadcastUpdate();
    res.json({ success: true, called: next, remaining: q.tokens.length });
  });

  return router;
};
