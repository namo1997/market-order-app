import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';
import { httpError, optionalText, requireText, toDuplicateError } from '../utils/master-data-validation.js';

const BRANCH_DUPLICATE_FIELDS = { code: 'รหัสสาขา' };

const normalizeBranchInput = (data = {}) => ({
    name: requireText(data.name, 'ชื่อสาขา', 100),
    code: optionalText(data.code, 'รหัสสาขา', 20),
    clickhouse_branch_id: optionalText(data.clickhouse_branch_id, 'ClickHouse Branch ID', 100)
});

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
    const { name, code, clickhouse_branch_id } = normalizeBranchInput(data);
    const normalizedCode = String(code || '').trim();
    const finalCode = normalizedCode || await generateNextCode({
        table: 'branches',
        prefix: 'BR',
        codeField: 'code'
    });
    let result;
    try {
        [result] = await pool.query(
            'INSERT INTO branches (name, code, clickhouse_branch_id, is_active) VALUES (?, ?, ?, true)',
            [name, finalCode, clickhouse_branch_id || null]
        );
    } catch (error) {
        throw toDuplicateError(error, BRANCH_DUPLICATE_FIELDS);
    }
    return { id: result.insertId, ...data, name, code: finalCode, clickhouse_branch_id };
};

export const updateBranch = async (id, data) => {
    await ensureBranchColumns();
    const { name, code, clickhouse_branch_id } = normalizeBranchInput(data);
    const [existingRows] = await pool.query(
        'SELECT id, code FROM branches WHERE id = ?',
        [id]
    );
    if (existingRows.length === 0) {
        throw httpError('ไม่พบสาขา', 404);
    }
    const finalCode = code || existingRows[0].code;
    try {
        await pool.query(
            'UPDATE branches SET name = ?, code = ?, clickhouse_branch_id = ? WHERE id = ?',
            [name, finalCode, clickhouse_branch_id || null, id]
        );
    } catch (error) {
        throw toDuplicateError(error, BRANCH_DUPLICATE_FIELDS);
    }
    return { id, ...data, name, code: finalCode, clickhouse_branch_id: clickhouse_branch_id || null };
};

export const deleteBranch = async (id) => {
    const [existingRows] = await pool.query(
        'SELECT id FROM branches WHERE id = ? AND is_active = true',
        [id]
    );
    if (existingRows.length === 0) {
        throw httpError('ไม่พบสาขา', 404);
    }
    const [[usage]] = await pool.query(
        'SELECT COUNT(*) AS total FROM departments WHERE branch_id = ? AND is_active = true',
        [id]
    );
    const activeDepartments = Number(usage?.total || 0);
    if (activeDepartments > 0) {
        throw httpError(
            `ลบสาขาไม่ได้ เพราะยังมีแผนกที่ใช้งานอยู่ในสาขานี้ ${activeDepartments} แผนก กรุณาย้ายหรือปิดแผนกก่อน`
        );
    }
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
