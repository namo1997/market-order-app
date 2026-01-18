import pool from '../config/database.js';

export const getAllUnits = async () => {
    const [rows] = await pool.query(
        'SELECT * FROM units WHERE is_active = true ORDER BY name'
    );
    return rows;
};

export const getUnitById = async (id) => {
    const [rows] = await pool.query(
        'SELECT * FROM units WHERE id = ?',
        [id]
    );
    return rows[0];
};

export const createUnit = async (data) => {
    const { name, abbreviation } = data;
    const [result] = await pool.query(
        'INSERT INTO units (name, abbreviation, is_active) VALUES (?, ?, true)',
        [name, abbreviation]
    );
    return { id: result.insertId, ...data };
};

export const updateUnit = async (id, data) => {
    const { name, abbreviation } = data;
    await pool.query(
        'UPDATE units SET name = ?, abbreviation = ? WHERE id = ?',
        [name, abbreviation, id]
    );
    return { id, ...data };
};

export const deleteUnit = async (id) => {
    await pool.query(
        'UPDATE units SET is_active = false WHERE id = ?',
        [id]
    );
    return { id };
};
