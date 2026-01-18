import * as departmentModel from '../models/department.model.js';

export const getAllDepartments = async (req, res, next) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const allowInactive = req.user?.role === 'admin' && includeInactive;
        const departments = await departmentModel.getAllDepartments({
            includeInactive: allowInactive
        });
        res.json({ success: true, data: departments });
    } catch (error) {
        next(error);
    }
};

export const createDepartment = async (req, res, next) => {
    try {
        const department = await departmentModel.createDepartment(req.body);
        res.status(201).json({ success: true, data: department });
    } catch (error) {
        next(error);
    }
};

export const updateDepartment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const department = await departmentModel.updateDepartment(id, req.body);
        res.json({ success: true, data: department });
    } catch (error) {
        next(error);
    }
};

export const updateDepartmentStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;

        if (is_active === undefined) {
            return res.status(400).json({
                success: false,
                message: 'is_active is required'
            });
        }

        const normalized = (() => {
            if (typeof is_active === 'string') {
                return is_active === 'true' || is_active === '1';
            }
            if (typeof is_active === 'number') {
                return is_active === 1;
            }
            return Boolean(is_active);
        })();
        const department = await departmentModel.updateDepartmentStatus(id, normalized);
        res.json({ success: true, data: department });
    } catch (error) {
        next(error);
    }
};

export const deleteDepartment = async (req, res, next) => {
    try {
        const { id } = req.params;
        await departmentModel.deleteDepartment(id);
        res.json({ success: true, message: 'Department deleted successfully' });
    } catch (error) {
        next(error);
    }
};
