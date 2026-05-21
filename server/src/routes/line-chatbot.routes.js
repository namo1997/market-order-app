import express from 'express';
import * as lineChatbotController from '../controllers/line-chatbot.controller.js';

const router = express.Router();

// LINE webhook must read raw body for HMAC signature verification.
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  lineChatbotController.handleWebhook
);

// Local/manual test endpoint. It does not call LINE, it only returns the bot reply text.
router.post('/test-command', express.json(), lineChatbotController.testCommand);
router.get('/test-command', lineChatbotController.testCommand);

export default router;
