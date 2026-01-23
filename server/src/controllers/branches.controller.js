import * as branchModel from '../models/branch.model.js';

const DEFAULT_CLICKHOUSE_BRANCH_MAPPING = {
    'สาขาคันคลอง': '2PdQF0n9TADAVUEV2dDeqOo7D9N',
    'สาขาสันกำแพง': '2PxT0SwTMlORbcER7eaIqi08v4k'
};

export const getAllBranches = async (req, res, next) => {
    try {
        const branches = await branchModel.getAllBranches();
        res.json({ success: true, data: branches });
    } catch (error) {
        next(error);
    }
};

export const createBranch = async (req, res, next) => {
    try {
        const branch = await branchModel.createBranch(req.body);
        res.status(201).json({ success: true, data: branch });
    } catch (error) {
        next(error);
    }
};

export const updateBranch = async (req, res, next) => {
    try {
        const { id } = req.params;
        const branch = await branchModel.updateBranch(id, req.body);
        res.json({ success: true, data: branch });
    } catch (error) {
        next(error);
    }
};

export const deleteBranch = async (req, res, next) => {
    try {
        const { id } = req.params;
        await branchModel.deleteBranch(id);
        res.json({ success: true, message: 'Branch deleted successfully' });
    } catch (error) {
        next(error);
    }
};

export const syncClickHouseBranchIds = async (req, res, next) => {
    try {
        const result = await branchModel.syncClickHouseBranchIds(
            DEFAULT_CLICKHOUSE_BRANCH_MAPPING
        );
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};
