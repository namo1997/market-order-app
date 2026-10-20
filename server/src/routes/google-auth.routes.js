import express from 'express';
import pool from '../config/database.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { getUserById } from '../models/user.model.js';
import { buildUserPayload } from '../controllers/auth.controller.js';
import { generateToken } from '../utils/jwt.js';
import { createGoogleAccountsStore } from '../models/google-accounts.model.js';
import { createGoogleIdTokenVerifier } from '../services/google-id-token.js';
import { createGoogleAuthHandlers, googleLoginRateLimit } from '../controllers/google-auth.controller.js';

const router = express.Router();
const handlers = createGoogleAuthHandlers({ verify: createGoogleIdTokenVerifier(),
  store: createGoogleAccountsStore(pool), getUserById, buildUserPayload, generateToken });
router.post('/google', googleLoginRateLimit(), handlers.login);
router.get('/google-accounts', authenticate, requireAdmin, handlers.list);
router.post('/google-accounts', authenticate, requireAdmin, handlers.add);
router.post('/google-accounts/disable', authenticate, requireAdmin, handlers.disable);
export default router;
