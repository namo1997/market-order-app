import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';

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
    const { name, code, branch_id, is_production, allowed_roles } = data;
    const normalizedCode = String(code || '').trim();
    const finalCode = normalizedCode || await generateNextCode({
        table: 'departments',
        prefix: 'DPT',
        codeField: 'code'
    });
    const encodedAllowedRoles = encodeAllowedRoles(allowed_roles);
    const [result] = await pool.query(
        'INSERT INTO departments (name, code, is_production, allowed_roles, branch_id, is_active) VALUES (?, ?, ?, ?, ?, true)',
        [name, finalCode, toBoolean(is_production), encodedAllowedRoles, branch_id]
    );
    return {
        id: result.insertId,
        ...data,
        code: finalCode,
        is_production: toBoolean(is_production),
        allowed_roles: decodeAllowedRoles(encodedAllowedRoles)
    };
};

export const updateDepartment = async (id, data) => {
    await ensureDepartmentColumns();
    const { name, code, branch_id, is_production, allowed_roles } = data;
    let finalCode = String(code ?? '').trim();

    if (!finalCode) {
        const [rows] = await pool.query(
            'SELECT code FROM departments WHERE id = ?',
            [id]
        );
        finalCode = rows?.[0]?.code;
    }
    const encodedAllowedRoles = encodeAllowedRoles(allowed_roles);
    await pool.query(
        'UPDATE departments SET name = ?, code = ?, is_production = ?, allowed_roles = ?, branch_id = ? WHERE id = ?',
        [name, finalCode, toBoolean(is_production), encodedAllowedRoles, branch_id, id]
    );
    return {
        id,
        ...data,
        code: finalCode,
        is_production: toBoolean(is_production),
        allowed_roles: decodeAllowedRoles(encodedAllowedRoles)
    };
};

export const updateDepartmentStatus = async (id, isActive) => {
    await pool.query(
        'UPDATE departments SET is_active = ? WHERE id = ?',
        [isActive, id]
    );
    return { id, is_active: isActive };
};

export const deleteDepartment = async (id) => {
    await pool.query(
        'UPDATE departments SET is_active = false WHERE id = ?',
        [id]
    );
    return { id };
};
