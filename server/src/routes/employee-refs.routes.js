import express from 'express';
import * as controller from '../controllers/employee-ref.controller.js';

const router = express.Router();

// Phase 1: no auth, local import only. Add permission after employee identity is connected.
router.get('/', controller.listEmployeeRefs);
router.get('/stats', controller.getEmployeeRefStats);
router.post('/sync', controller.syncEmployeeRefs);

export default router;
