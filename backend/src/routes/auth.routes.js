const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth');

router.post('/login', authController.login);

// Only ADMIN can register new internal staff
router.post('/register', authenticateToken, authorizeRoles('ADMIN'), authController.register);

// Get current user profile
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
