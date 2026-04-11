import express from 'express';
import * as lineChatbotController from '../controllers/line-chatbot.controller.js';

const router = express.Router();

// LINE webhook must read raw body for HMAC signature verification.
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  lineChatbotController.handleWebhook
);

export default router;
