import express from 'express';
import { getSalesReport } from '../controllers/reports.controller.js';
import * as branchModel from '../models/branch.model.js';

const router = express.Router();

router.get('/reports/sales', getSalesReport);

router.get('/branches', async (req, res, next) => {
  try {
    const branches = await branchModel.getAllBranches();
    const publicBranches = branches
      .filter((branch) => String(branch.clickhouse_branch_id || '').trim())
      .map((branch) => ({
        id: branch.id,
        name: branch.name,
        clickhouse_branch_id: branch.clickhouse_branch_id
      }));

    res.json({ success: true, data: publicBranches });
  } catch (error) {
    next(error);
  }
});

export default router;
