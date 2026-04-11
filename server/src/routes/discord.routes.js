import express from 'express';
import * as discordController from '../controllers/discord.controller.js';

const router = express.Router();

// Discord requires raw body for Ed25519 signature verification
router.post(
  '/interactions',
  express.raw({ type: 'application/json' }),
  discordController.handleInteraction
);

export default router;

