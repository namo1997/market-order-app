import express from 'express';
import { createBillOrderReferenceController } from '../controllers/bill-order-reference.controller.js';
import { createBillOrderReferenceModel } from '../models/bill-order-reference.model.js';

export const createBillOrderReferenceRoutes = (database, env = process.env) => {
  const router = express.Router();
  const controller = createBillOrderReferenceController({ model: createBillOrderReferenceModel(database), env });
  router.use(controller.authenticate);
  router.get('/lines', controller.listLines);
  return router;
};
