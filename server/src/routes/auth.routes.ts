import { Router } from 'express';
import { AuthService } from '../services/auth.service.js';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { db } from '../db/database.js';

const router = Router();

router.post('/register', (req, res) => {
  try {
    const { org_id = 'org-default', email, password, name, role = 'developer' } = req.body;
    if (!email || !password || !name) {
      res.status(400).json({ success: false, error: 'email, password, and name are required' });
      return;
    }

    const result = AuthService.register(org_id, email, password, name, role);
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'email and password are required' });
      return;
    }

    const result = AuthService.login(email, password);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message });
  }
});

router.get('/me', authenticate, (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }

  const user = AuthService.getUserById(req.user.userId);
  res.json({ success: true, data: user });
});

router.post('/generate-key', authenticate, (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }

  const newKey = AuthService.generateApiKey();
  db.run('UPDATE users SET api_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newKey, req.user.userId]);
  res.json({ success: true, data: { apiKey: newKey } });
});

export default router;
