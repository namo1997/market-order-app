import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as controller from '../controllers/receiving-documents.controller.js';

const router = express.Router();

// รองรับ base64 image_data_url สำหรับรูปบิลขนาดสูงสุด 3 MB (base64 ประมาณ 4 MB)
router.use(express.json({ limit: '6mb' }));

router.use(authenticate);

router.get('/expected', controller.getExpected);
router.get('/', controller.listDocuments);
router.post('/', controller.createDocument);
router.get('/:id', controller.getDocumentById);
router.put('/:id', controller.updateDocument);
router.post('/:id/images', controller.uploadImage);
router.get('/:id/images/:imageId', controller.getImageBinary);
router.post('/:id/ocr', controller.runOcr);
router.post('/:id/signatures', controller.addSignature);
router.post('/:id/confirm', controller.confirmDocument);
router.post('/:id/void', controller.voidDocument);

// แปลง error จาก body-parser (เช่น payload ใหญ่เกิน 6MB) ให้ตรงตามสัญญา API
router.use((err, req, res, next) => {
  return controller.handleReceivingError(err, res, next);
});

export default router;
