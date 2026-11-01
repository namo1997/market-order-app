import express from 'express';
import * as lineChatbotController from '../controllers/line-chatbot.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// LINE webhook must read raw body for HMAC signature verification.
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  lineChatbotController.handleWebhook
);

// Local/manual test endpoint. It does not call LINE, it only returns the bot reply text.
// ปิดใน production (เว้นแต่ตั้ง LINE_BOT_TEST_ENABLED=true) และต้องเป็นแอดมินเสมอ
const requireTestCommandEnabled = (req, res, next) => {
  const flag = String(process.env.LINE_BOT_TEST_ENABLED || '').trim().toLowerCase();
  const enabled = flag ? flag === 'true' : process.env.NODE_ENV !== 'production';
  if (!enabled) {
    return res.status(404).json({ success: false, message: 'LINE bot test endpoint is disabled' });
  }
  next();
};

router.post('/test-command', requireTestCommandEnabled, authenticate, requireAdmin, express.json(), lineChatbotController.testCommand);
router.get('/test-command', requireTestCommandEnabled, authenticate, requireAdmin, lineChatbotController.testCommand);

export default router;
