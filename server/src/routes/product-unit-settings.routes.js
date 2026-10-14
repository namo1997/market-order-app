import express from 'express';
import * as controller from '../controllers/product-unit-settings.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);
router.get('/', controller.list);
router.put('/:productId', controller.save);

export default router;
