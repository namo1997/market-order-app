import express from 'express';
import * as lineChatbotController from '../controllers/line-chatbot.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// LINE webhook must read raw body for HMAC signature verification.
router.post(
  '/webhook-disabled',
  express.raw({ type: 'application/json' }),
  lineChatbotController.handleDisabledWebhook
);

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  lineChatbotController.handleWebhook
);

// Local/manual test endpoint. It does not call LINE, it only returns the bot reply text.
router.post('/test-command', authenticate, requireAdmin, express.json(), lineChatbotController.testCommand);
router.get('/test-command', authenticate, requireAdmin, lineChatbotController.testCommand);

export default router;
