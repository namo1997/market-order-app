import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';

const ensureBranchColumns = async () => {
    const [rows] = await pool.query(
        "SHOW COLUMNS FROM branches LIKE 'clickhouse_branch_id'"
    );
    if (rows.length === 0) {
        await pool.query(
            'ALTER TABLE branches ADD COLUMN clickhouse_branch_id VARCHAR(100) NULL AFTER code'
        );
    }
};

export const getAllBranches = async () => {
    await ensureBranchColumns();
    const [rows] = await pool.query(
        'SELECT * FROM branches WHERE is_active = true ORDER BY name'
    );
    return rows;
};

export const getBranchById = async (id) => {
    await ensureBranchColumns();
    const [rows] = await pool.query(
        'SELECT * FROM branches WHERE id = ?',
        [id]
    );
    return rows[0];
};

export const createBranch = async (data) => {
    await ensureBranchColumns();
    const { name, code, clickhouse_branch_id } = data;
    const normalizedCode = String(code || '').trim();
    const finalCode = normalizedCode || await generateNextCode({
        table: 'branches',
        prefix: 'BR',
        codeField: 'code'
    });
    const [result] = await pool.query(
        'INSERT INTO branches (name, code, clickhouse_branch_id, is_active) VALUES (?, ?, ?, true)',
        [name, finalCode, clickhouse_branch_id || null]
    );
    return { id: result.insertId, ...data, code: finalCode };
};

export const updateBranch = async (id, data) => {
    await ensureBranchColumns();
    const { name, code, clickhouse_branch_id } = data;
    let finalCode = String(code ?? '').trim();

    if (!finalCode) {
        const [rows] = await pool.query(
            'SELECT code FROM branches WHERE id = ?',
            [id]
        );
        finalCode = rows?.[0]?.code;
    }
    await pool.query(
        'UPDATE branches SET name = ?, code = ?, clickhouse_branch_id = ? WHERE id = ?',
        [name, finalCode, clickhouse_branch_id || null, id]
    );
    return { id, ...data, code: finalCode, clickhouse_branch_id: clickhouse_branch_id || null };
};

export const deleteBranch = async (id) => {
    await pool.query(
        'UPDATE branches SET is_active = false WHERE id = ?',
        [id]
    );
    return { id };
};

export const syncClickHouseBranchIds = async (mapping = {}) => {
    await ensureBranchColumns();
    const entries = Object.entries(mapping).filter(([, value]) => value);
    if (entries.length === 0) {
        const [rows] = await pool.query(
            'SELECT * FROM branches WHERE is_active = true ORDER BY name'
        );
        return { updated: 0, branches: rows };
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        let updated = 0;
        for (const [name, clickhouseId] of entries) {
            const [result] = await connection.query(
                'UPDATE branches SET clickhouse_branch_id = ? WHERE name = ?',
                [clickhouseId, name]
            );
            updated += result.affectedRows || 0;
        }
        await connection.commit();
        const [rows] = await connection.query(
            'SELECT * FROM branches WHERE is_active = true ORDER BY name'
        );
        return { updated, branches: rows };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};
