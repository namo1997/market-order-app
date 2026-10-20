import pool from '../config/database.js';
import { emptyUnitUsage, loadUnitUsage } from './unit-usage.model.js';
import { findUnitNameConflict } from '../utils/unit-master-rules.js';

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
    const [result] = await pool.query(
        'UPDATE units SET name = ?, abbreviation = ? WHERE id = ?',
        [name, abbreviation, id]
    );
    if (!result.affectedRows && !await getUnitById(id)) return null;
    return { id, ...data };
};

export const deleteUnit = async (id) => {
    await pool.query(
        'UPDATE units SET is_active = false WHERE id = ?',
        [id]
    );
    return { id };
};

export const listUnitsWithUsage = async ({ includeInactive = false } = {}) => {
    const [rows] = await pool.query(
        `SELECT * FROM units ${includeInactive ? '' : 'WHERE is_active = true'} ORDER BY name`
    );
    const usage = await loadUnitUsage();
    return rows.map((unit) => ({ ...unit, usage: usage.get(String(unit.id)) || emptyUnitUsage() }));
};

export const countUnitReferences = async (unitId) => {
    const usage = await loadUnitUsage();
    return usage.get(String(unitId)) || emptyUnitUsage();
};

export const findUnitsByName = async (name) => {
    // รวมหน่วยที่ลบแล้ว และเทียบช่องว่าง/ตัวพิมพ์เหมือนกติกา pure function
    const [rows] = await pool.query('SELECT * FROM units ORDER BY is_active DESC, id');
    const matches = rows.filter((unit) => findUnitNameConflict([unit], name));
    if (matches.length) return matches;
    // UNIQUE อาจเทียบสำเนียง/ตัวอักษรตาม collation ต่างจาก JavaScript
    const [collationMatches] = await pool.query('SELECT * FROM units WHERE name = ?', [name]);
    return collationMatches;
};

export const restoreUnit = async (id) => {
    await pool.query('UPDATE units SET is_active = true WHERE id = ?', [id]);
    return (await getUnitById(id)) || null;
};
