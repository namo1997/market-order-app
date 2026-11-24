import express from 'express';
import * as packingController from '../controllers/production-packing.controller.js';
import { authenticate, requireAdminOrProduction } from '../middleware/auth.js';

// จัดของตามใบสั่ง: ผู้ดูแลหรือผู้ที่ดูคำสั่งซื้อตามกลุ่มสินค้าได้ (เหมือนหน้าคำสั่งซื้อ /production/print-orders)
const router = express.Router();

router.use(authenticate, requireAdminOrProduction);

router.get('/', packingController.getOverview);
router.get('/branches/:branchId', packingController.getBranch);
router.post('/branches/:branchId/scan', packingController.scan);
router.post('/branches/:branchId/adjust', packingController.adjust);
router.delete('/branches/:branchId/entries/:entryId', packingController.removeEntry);
router.put('/branches/:branchId/packed', packingController.setPacked);

export default router;
