import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as controller from '../controllers/receiving-documents.controller.js';

const router = express.Router();

// แก้ข้อ 9 (Low): ตรวจสิทธิ์ authenticate ก่อนอ่าน body ขนาดสูงสุด 6 MB
router.use(authenticate);
router.use(express.json({ limit: '6mb' }));

router.get('/expected', controller.getExpected);
router.get('/', controller.listDocuments);
router.post('/', controller.createDocument);
router.get('/:id', controller.getDocumentById);
router.put('/:id', controller.updateDocument);
router.post('/:id/images', controller.uploadImage);
router.get('/:id/images/:imageId', controller.getImageBinary);
router.post('/:id/ocr', controller.runOcr);
router.post('/:id/signatures', controller.addSignature);
router.get('/:id/signatures/:role', controller.getSignatureBinary);
router.post('/:id/confirm', controller.confirmDocument);
router.post('/:id/void', controller.voidDocument);

// แปลง error จาก body-parser (เช่น payload ใหญ่เกิน 6MB หรือ JSON เสีย) ให้ตรงตามสัญญา API
router.use((err, req, res, next) => {
  return controller.handleReceivingError(err, res, next, req);
});

export default router;
