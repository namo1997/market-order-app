import express from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import * as departmentProductsController from '../controllers/department-products.controller.js';

const router = express.Router();

router.use(authenticate);

router.get('/my', departmentProductsController.getMyDepartmentProducts);
router.get(
  '/admin/available/:departmentId',
  requireAdmin,
  departmentProductsController.getAvailableProductsByDepartment
);
router.get(
  '/admin/:departmentId',
  requireAdmin,
  departmentProductsController.getDepartmentProductsByDepartment
);
router.post('/admin', requireAdmin, departmentProductsController.addDepartmentProduct);
router.post(
  '/admin/copy-from-stock-template',
  requireAdmin,
  departmentProductsController.copyFromStockTemplate
);
router.delete(
  '/admin/:id',
  requireAdmin,
  departmentProductsController.deleteDepartmentProduct
);

export default router;
