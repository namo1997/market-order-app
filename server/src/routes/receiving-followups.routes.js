import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as controller from '../controllers/receiving-followups.controller.js';
import { handleReceivingError } from '../controllers/receiving-documents.controller.js';
const router = express.Router();
router.use(authenticate);
router.use(express.json({ limit: '8kb' }));
router.get('/lead-times', controller.leads);
router.put('/lead-times/:supplierKey', controller.setLead);
router.get('/', controller.list);
router.post('/', controller.create);
router.patch('/:id', controller.update);
router.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ success: false, code: 'REQUEST_TOO_LARGE', message: 'ข้อมูลตามของยาวเกินกำหนด' });
  return handleReceivingError(error, res, next, req);
});
export default router;
