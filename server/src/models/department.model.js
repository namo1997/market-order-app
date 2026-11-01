import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';
import { httpError, optionalText, requirePositiveId, requireText, toDuplicateError } from '../utils/master-data-validation.js';

const DEPARTMENT_DUPLICATE_FIELDS = { unique_dept_code: 'รหัสแผนก (ในสาขาเดียวกัน)' };

const normalizeDepartmentInput = async (data = {}, currentBranchId = null) => {
    const name = requireText(data.name, 'ชื่อแผนก', 100);
    const code = optionalText(data.code, 'รหัสแผนก', 20);
    const branchId = requirePositiveId(data.branch_id, 'สาขา');
    // Keeping the current branch is always allowed (even if that branch was hidden later).
    if (currentBranchId !== null && Number(currentBranchId) === branchId) {
        return { name, code, branchId };
    }
    const [branchRows] = await pool.query(
        'SELECT id FROM branches WHERE id = ? AND is_active = true',
        [branchId]
    );
    if (branchRows.length === 0) {
        throw httpError('ไม่พบสาขาที่เลือก');
    }
    return { name, code, branchId };
};

const ensureDepartmentColumns = async () => {
    const [rows] = await pool.query(
        "SHOW COLUMNS FROM departments LIKE 'is_production'"
    );
    if (rows.length === 0) {
        await pool.query(
            'ALTER TABLE departments ADD COLUMN is_production BOOLEAN NOT NULL DEFAULT false AFTER code'
        );
    }

    const [roleRows] = await pool.query(
        "SHOW COLUMNS FROM departments LIKE 'allowed_roles'"
    );
    if (roleRows.length === 0) {
        await pool.query(
            "ALTER TABLE departments ADD COLUMN allowed_roles VARCHAR(64) NOT NULL DEFAULT 'user,admin' AFTER is_production"
        );
    }

    const [stockCheckRows] = await pool.query(
        "SHOW COLUMNS FROM departments LIKE 'stock_check_required'"
    );
    if (stockCheckRows.length === 0) {
        await pool.query(
            'ALTER TABLE departments ADD COLUMN stock_check_required BOOLEAN NOT NULL DEFAULT true AFTER allowed_roles'
        );
    }

    const [stockBalanceRows] = await pool.query(
        "SHOW COLUMNS FROM departments LIKE 'can_view_stock_balance'"
    );
    if (stockBalanceRows.length === 0) {
        await pool.query(
            'ALTER TABLE departments ADD COLUMN can_view_stock_balance BOOLEAN NOT NULL DEFAULT false AFTER stock_check_required'
        );
    }
};

const toBoolean = (value) => {
    if (typeof value === 'string') {
        return value === 'true' || value === '1';
    }
    if (typeof value === 'number') {
        return value === 1;
    }
    return Boolean(value);
};

const DEPARTMENT_ROLE_OPTIONS = ['user', 'admin', 'super_admin'];

const normalizeAllowedRoles = (roles) => {
    const raw = Array.isArray(roles)
        ? roles
        : String(roles || '')
            .split(/[|,]/)
            .map((item) => item.trim())
            .filter(Boolean);
    const normalized = raw.filter((role) => DEPARTMENT_ROLE_OPTIONS.includes(role));
    return normalized.length > 0 ? Array.from(new Set(normalized)) : ['user'];
};

const encodeAllowedRoles = (roles) => normalizeAllowedRoles(roles).join(',');

const decodeAllowedRoles = (value) => normalizeAllowedRoles(value);

export const getAllDepartments = async (options = {}) => {
    await ensureDepartmentColumns();
    const includeInactive = Boolean(options.includeInactive);
    const [rows] = await pool.query(
        `SELECT d.*, b.name as branch_name 
     FROM departments d 
     JOIN branches b ON d.branch_id = b.id 
     ${includeInactive ? '' : 'WHERE d.is_active = true'}
     ORDER BY d.name`
    );
    return rows.map((row) => ({
        ...row,
        allowed_roles: decodeAllowedRoles(row.allowed_roles)
    }));
};

export const getDepartmentsByBranch = async (branchId) => {
    await ensureDepartmentColumns();
    const [rows] = await pool.query(
        'SELECT * FROM departments WHERE branch_id = ? AND is_active = true ORDER BY name',
        [branchId]
    );
    return rows.map((row) => ({
        ...row,
        allowed_roles: decodeAllowedRoles(row.allowed_roles)
    }));
};

export const getDepartmentById = async (id) => {
    await ensureDepartmentColumns();
    const [rows] = await pool.query(
        'SELECT * FROM departments WHERE id = ?',
        [id]
    );
    if (!rows[0]) return null;
    return {
        ...rows[0],
        allowed_roles: decodeAllowedRoles(rows[0].allowed_roles)
    };
};

export const createDepartment = async (data) => {
    await ensureDepartmentColumns();
    const { is_production, allowed_roles, stock_check_required, can_view_stock_balance } = data;
    const { name, code, branchId } = await normalizeDepartmentInput(data);
    const finalCode = code || await generateNextCode({
        table: 'departments',
        prefix: 'DPT',
        codeField: 'code'
    });
    const encodedAllowedRoles = encodeAllowedRoles(allowed_roles);
    const stockCheckRequired =
        stock_check_required === undefined ? true : toBoolean(stock_check_required);
    const canViewStockBalance = toBoolean(can_view_stock_balance);
    let result;
    try {
        [result] = await pool.query(
            'INSERT INTO departments (name, code, is_production, allowed_roles, stock_check_required, can_view_stock_balance, branch_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, true)',
            [name, finalCode, toBoolean(is_production), encodedAllowedRoles, stockCheckRequired, canViewStockBalance, branchId]
        );
    } catch (error) {
        throw toDuplicateError(error, DEPARTMENT_DUPLICATE_FIELDS);
    }
    return {
        id: result.insertId,
        ...data,
        name,
        branch_id: branchId,
        code: finalCode,
        is_production: toBoolean(is_production),
        allowed_roles: decodeAllowedRoles(encodedAllowedRoles),
        stock_check_required: stockCheckRequired,
        can_view_stock_balance: canViewStockBalance
    };
};

export const updateDepartment = async (id, data) => {
    await ensureDepartmentColumns();
    const { is_production, allowed_roles, stock_check_required, can_view_stock_balance } = data;
    const [currentRows] = await pool.query(
        'SELECT code, branch_id, stock_check_required, can_view_stock_balance FROM departments WHERE id = ?',
        [id]
    );
    const current = currentRows[0];
    if (!current) {
        throw httpError('ไม่พบแผนก', 404);
    }
    const { name, code, branchId } = await normalizeDepartmentInput(data, current.branch_id);
    const finalCode = code || current.code;
    const encodedAllowedRoles = encodeAllowedRoles(allowed_roles);
    const stockCheckRequired =
        stock_check_required === undefined ? true : toBoolean(stock_check_required);
    const canViewStockBalance = can_view_stock_balance === undefined
        ? toBoolean(Number(current.can_view_stock_balance || 0))
        : toBoolean(can_view_stock_balance);
    try {
        await pool.query(
            'UPDATE departments SET name = ?, code = ?, is_production = ?, allowed_roles = ?, stock_check_required = ?, branch_id = ?, can_view_stock_balance = ? WHERE id = ?',
            [name, finalCode, toBoolean(is_production), encodedAllowedRoles, stockCheckRequired, branchId, canViewStockBalance, id]
        );
    } catch (error) {
        throw toDuplicateError(error, DEPARTMENT_DUPLICATE_FIELDS);
    }
    return {
        id,
        ...data,
        name,
        branch_id: branchId,
        code: finalCode,
        is_production: toBoolean(is_production),
        allowed_roles: decodeAllowedRoles(encodedAllowedRoles),
        stock_check_required: stockCheckRequired,
        can_view_stock_balance: canViewStockBalance
    };
};

export const updateDepartmentStatus = async (id, isActive) => {
    const [result] = await pool.query(
        'UPDATE departments SET is_active = ? WHERE id = ?',
        [isActive, id]
    );
    if (result.affectedRows === 0) {
        throw httpError('ไม่พบแผนก', 404);
    }
    return { id, is_active: isActive };
};

export const deleteDepartment = async (id) => {
    const [result] = await pool.query(
        'UPDATE departments SET is_active = false WHERE id = ?',
        [id]
    );
    if (result.affectedRows === 0) {
        throw httpError('ไม่พบแผนก', 404);
    }
    return { id };
};
