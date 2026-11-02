import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as controller from '../controllers/receiving-payables.controller.js';
import { handleReceivingError } from '../controllers/receiving-documents.controller.js';

// Owner 2026-11-02 ระบบรวบรวมเจ้าหนี้: accounting/admin only (checked in the controller).
const router = express.Router();
router.use(authenticate);
router.get('/summary', controller.summary);
router.get('/bills', controller.list);
router.post('/bills', express.json({ limit: '4kb' }), controller.create);
router.get('/bills/:id', controller.detail);
router.post('/bills/:id/pages', express.json({ limit: '6mb' }), controller.upload);
router.get('/bills/:id/pages/:page', controller.image);
router.post('/bills/:id/read', controller.read);
router.put('/bills/:id', express.json({ limit: '8kb' }), controller.update);
router.delete('/bills/:id', controller.remove);
// Body-parser errors (too large / bad JSON) answer in the receiving error format.
router.use((err, req, res, next) => handleReceivingError(err, res, next, req));
export default router;
