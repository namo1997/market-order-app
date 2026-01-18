import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';

export const getAllBranches = async () => {
    const [rows] = await pool.query(
        'SELECT * FROM branches WHERE is_active = true ORDER BY name'
    );
    return rows;
};

export const getBranchById = async (id) => {
    const [rows] = await pool.query(
        'SELECT * FROM branches WHERE id = ?',
        [id]
    );
    return rows[0];
};

export const createBranch = async (data) => {
    const { name, code } = data;
    const normalizedCode = String(code || '').trim();
    const finalCode = normalizedCode || await generateNextCode({
        table: 'branches',
        prefix: 'BR',
        codeField: 'code'
    });
    const [result] = await pool.query(
        'INSERT INTO branches (name, code, is_active) VALUES (?, ?, true)',
        [name, finalCode]
    );
    return { id: result.insertId, ...data, code: finalCode };
};

export const updateBranch = async (id, data) => {
    const { name, code } = data;
    let finalCode = String(code ?? '').trim();

    if (!finalCode) {
        const [rows] = await pool.query(
            'SELECT code FROM branches WHERE id = ?',
            [id]
        );
        finalCode = rows?.[0]?.code;
    }
    await pool.query(
        'UPDATE branches SET name = ?, code = ? WHERE id = ?',
        [name, finalCode, id]
    );
    return { id, ...data, code: finalCode };
};

export const deleteBranch = async (id) => {
    await pool.query(
        'UPDATE branches SET is_active = false WHERE id = ?',
        [id]
    );
    return { id };
};
