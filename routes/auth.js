/**
 * Auth Routes — Login & Signup
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');

module.exports = function(store) {
  const router = express.Router();

  // POST /api/auth/signup
  router.post('/signup', (req, res) => {
    const { name, email, password, role, department } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const exists = store.users.find(u => u.email === email);
    if (exists) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    const user = {
      id: uuidv4(),
      name,
      email,
      password, // NOTE: In production, hash with bcrypt
      role,
      department: role === 'doctor' || role === 'staff' ? department : null,
      createdAt: new Date().toISOString(),
      token: null,
      tokenDept: null
    };
    store.users.push(user);

    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser, message: 'Account created successfully!' });
  });

  // POST /api/auth/login
  router.post('/login', (req, res) => {
    const { email, password } = req.body;

    const user = store.users.find(u => u.email === email && u.password === password);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser, message: 'Login successful!' });
  });

  // GET /api/auth/profile/:id
  router.get('/profile/:id', (req, res) => {
    const user = store.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
  });

  // PUT /api/auth/profile/:id
  router.put('/profile/:id', (req, res) => {
    const idx = store.users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'User not found.' });

    const { name, department } = req.body;
    if (name) store.users[idx].name = name;
    if (department) store.users[idx].department = department;

    const { password: _, ...safeUser } = store.users[idx];
    res.json({ success: true, user: safeUser });
  });

  return router;
};
