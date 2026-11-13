import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { listPackSizes, savePackSize } from '../models/product-pack-size.model.js';

// "บรรจุแพ็คละ" ต่อสินค้า: ทุกคนที่ล็อกอินอ่านได้ (ใช้ตอนพิมพ์สติกเกอร์), แก้ได้เฉพาะฝ่ายผลิตหรือผู้ดูแล
const router = express.Router();
router.use(authenticate);

export const canEditPackSize = (user) => ['admin', 'super_admin'].includes(user?.role)
  || Boolean(user?.is_production_department);

router.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, data: await listPackSizes() });
  } catch (error) {
    next(error);
  }
});

router.put('/:productId', async (req, res, next) => {
  try {
    if (!canEditPackSize(req.user)) {
      return res.status(403).json({ success: false, message: 'ตั้งค่าแพ็คได้เฉพาะฝ่ายผลิต' });
    }
    const result = await savePackSize({
      productId: req.params.productId,
      packSize: req.body?.pack_size,
      packUnitLabel: req.body?.pack_unit_label,
      userId: req.user?.id
    });
    if (result.status !== 'ok') return res.status(400).json({ success: false, message: 'จำนวนต่อแพ็คไม่ถูกต้อง' });
    res.json({ success: true, data: result.pack });
  } catch (error) {
    next(error);
  }
});

export default router;
