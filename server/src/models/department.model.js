import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';

export const getAllDepartments = async (options = {}) => {
    const includeInactive = Boolean(options.includeInactive);
    const [rows] = await pool.query(
        `SELECT d.*, b.name as branch_name 
     FROM departments d 
     JOIN branches b ON d.branch_id = b.id 
     ${includeInactive ? '' : 'WHERE d.is_active = true'}
     ORDER BY d.name`
    );
    return rows;
};

export const getDepartmentsByBranch = async (branchId) => {
    const [rows] = await pool.query(
        'SELECT * FROM departments WHERE branch_id = ? AND is_active = true ORDER BY name',
        [branchId]
    );
    return rows;
};

export const getDepartmentById = async (id) => {
    const [rows] = await pool.query(
        'SELECT * FROM departments WHERE id = ?',
        [id]
    );
    return rows[0];
};

export const createDepartment = async (data) => {
    const { name, code, branch_id } = data;
    const normalizedCode = String(code || '').trim();
    const finalCode = normalizedCode || await generateNextCode({
        table: 'departments',
        prefix: 'DPT',
        codeField: 'code'
    });
    const [result] = await pool.query(
        'INSERT INTO departments (name, code, branch_id, is_active) VALUES (?, ?, ?, true)',
        [name, finalCode, branch_id]
    );
    return { id: result.insertId, ...data, code: finalCode };
};

export const updateDepartment = async (id, data) => {
    const { name, code, branch_id } = data;
    let finalCode = String(code ?? '').trim();

    if (!finalCode) {
        const [rows] = await pool.query(
            'SELECT code FROM departments WHERE id = ?',
            [id]
        );
        finalCode = rows?.[0]?.code;
    }
    await pool.query(
        'UPDATE departments SET name = ?, code = ?, branch_id = ? WHERE id = ?',
        [name, finalCode, branch_id, id]
    );
    return { id, ...data, code: finalCode };
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
