import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';

export const getAllSuppliers = async () => {
    const [rows] = await pool.query(
        'SELECT * FROM suppliers WHERE is_active = true ORDER BY name'
    );
    return rows;
};

export const getSupplierById = async (id) => {
    const [rows] = await pool.query(
        'SELECT * FROM suppliers WHERE id = ?',
        [id]
    );
    return rows[0];
};

export const createSupplier = async (data) => {
    const { name, code, contact_person, phone, address, line_id } = data;
    const normalizedCode = String(code || '').trim();
    const finalCode = normalizedCode || await generateNextCode({
        table: 'suppliers',
        prefix: 'SUP',
        codeField: 'code'
    });
    const [result] = await pool.query(
        `INSERT INTO suppliers 
    (name, code, contact_person, phone, address, line_id, is_active) 
    VALUES (?, ?, ?, ?, ?, ?, true)`,
        [name, finalCode, contact_person, phone, address, line_id]
    );
    return { id: result.insertId, ...data, code: finalCode };
};

export const updateSupplier = async (id, data) => {
    const { name, code, contact_person, phone, address, line_id } = data;
    let finalCode = String(code ?? '').trim();

    if (!finalCode) {
        const [rows] = await pool.query(
            'SELECT code FROM suppliers WHERE id = ?',
            [id]
        );
        finalCode = rows?.[0]?.code;
    }
    await pool.query(
        `UPDATE suppliers 
     SET name = ?, code = ?, contact_person = ?, phone = ?, address = ?, line_id = ? 
     WHERE id = ?`,
        [name, finalCode, contact_person, phone, address, line_id, id]
    );
    return { id, ...data, code: finalCode };
};

export const deleteSupplier = async (id) => {
    await pool.query(
        'UPDATE suppliers SET is_active = false WHERE id = ?',
        [id]
    );
    return { id };
};
