import express from 'express';
import * as conversionController from '../controllers/unit-conversion.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/', conversionController.getConversions);
router.post('/', conversionController.createConversion);
router.put('/:id', conversionController.updateConversion);
router.delete('/:id', conversionController.deleteConversion);

export default router;
