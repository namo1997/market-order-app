import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';

export const ensureSupplierColumns = async () => {
    const [isInternalColumn] = await pool.query(
        "SHOW COLUMNS FROM suppliers LIKE 'is_internal'"
    );
    if (isInternalColumn.length === 0) {
        await pool.query(
            'ALTER TABLE suppliers ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT false AFTER line_id'
        );
    }

    const [linkedBranchColumn] = await pool.query(
        "SHOW COLUMNS FROM suppliers LIKE 'linked_branch_id'"
    );
    if (linkedBranchColumn.length === 0) {
        await pool.query(
            'ALTER TABLE suppliers ADD COLUMN linked_branch_id INT NULL AFTER is_internal'
        );
    }

    const [linkedDepartmentColumn] = await pool.query(
        "SHOW COLUMNS FROM suppliers LIKE 'linked_department_id'"
    );
    if (linkedDepartmentColumn.length === 0) {
        await pool.query(
            'ALTER TABLE suppliers ADD COLUMN linked_department_id INT NULL AFTER linked_branch_id'
        );
    }
};

let ensuredSupplierScopeTable = false;
let ensuredInternalOrderScopeTable = false;

export const ensureSupplierScopeTable = async () => {
    if (ensuredSupplierScopeTable) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_group_scopes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            supplier_id INT NOT NULL,
            branch_id INT NOT NULL,
            department_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product_group_scope (supplier_id, branch_id, department_id),
            INDEX idx_product_group_scope_supplier (supplier_id),
            INDEX idx_product_group_scope_branch (branch_id),
            INDEX idx_product_group_scope_department (department_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    ensuredSupplierScopeTable = true;
};

export const ensureInternalOrderScopeTable = async () => {
    if (ensuredInternalOrderScopeTable) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_group_internal_scopes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            supplier_id INT NOT NULL,
            branch_id INT NOT NULL,
            department_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product_group_internal_scope (supplier_id, branch_id, department_id),
            INDEX idx_product_group_internal_scope_supplier (supplier_id),
            INDEX idx_product_group_internal_scope_branch (branch_id),
            INDEX idx_product_group_internal_scope_department (department_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    ensuredInternalOrderScopeTable = true;
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

const validateBranchDepartmentPair = async (branchId, departmentId, db = pool) => {
    const [branchRows] = await db.query(
        'SELECT id FROM branches WHERE id = ? AND is_active = true',
        [branchId]
    );
    if (branchRows.length === 0) {
        const error = new Error('ไม่พบสาขาที่เลือก');
        error.statusCode = 400;
        throw error;
    }

    const [departmentRows] = await db.query(
        'SELECT id, branch_id FROM departments WHERE id = ? AND is_active = true',
        [departmentId]
    );
    if (departmentRows.length === 0) {
        const error = new Error('ไม่พบแผนกที่เลือก');
        error.statusCode = 400;
        throw error;
    }

    if (Number(departmentRows[0].branch_id) !== branchId) {
        const error = new Error('แผนกที่เลือกไม่ได้อยู่ในสาขาที่เลือก');
        error.statusCode = 400;
        throw error;
    }

    return {
        branchId,
        departmentId
    };
};

const normalizeScope = async (linkedBranchId, linkedDepartmentId, db = pool) => {
    const branchId = linkedBranchId ? Number(linkedBranchId) : null;
    const departmentId = linkedDepartmentId ? Number(linkedDepartmentId) : null;

    if (!branchId && !departmentId) {
        return {
            linkedBranchId: null,
            linkedDepartmentId: null
        };
    }

    if (!branchId || !departmentId) {
        const error = new Error('กรุณาเลือกทั้งสาขาและแผนกสำหรับการจำกัดการแสดงกลุ่มสินค้า');
        error.statusCode = 400;
        throw error;
    }

    const validated = await validateBranchDepartmentPair(branchId, departmentId, db);
    return {
        linkedBranchId: validated.branchId,
        linkedDepartmentId: validated.departmentId
    };
};

const normalizeSupplierRelation = async (isInternal, linkedBranchId, linkedDepartmentId, db = pool) => {
    const internal = toBoolean(isInternal);
    const scope = await normalizeScope(linkedBranchId, linkedDepartmentId, db);

    return {
        isInternal: internal,
        linkedBranchId: scope.linkedBranchId,
        linkedDepartmentId: scope.linkedDepartmentId
    };
};

const normalizeScopeList = async (
    scopeList,
    db = pool
) => {
    const source = Array.isArray(scopeList) ? scopeList : [];

    const dedup = new Set();
    const normalized = [];

    for (const item of source) {
        const rawBranchId =
            item?.branch_id ?? item?.linked_branch_id ?? item?.branchId ?? null;
        const rawDepartmentId =
            item?.department_id ?? item?.linked_department_id ?? item?.departmentId ?? null;
        const branchId = rawBranchId ? Number(rawBranchId) : null;
        const departmentId = rawDepartmentId ? Number(rawDepartmentId) : null;

        if (!branchId && !departmentId) {
            continue;
        }
        if (!branchId || !departmentId) {
            const error = new Error('กรุณาเลือกทั้งสาขาและแผนกในทุกแถวที่เพิ่ม');
            error.statusCode = 400;
            throw error;
        }

        const pair = await validateBranchDepartmentPair(branchId, departmentId, db);
        const key = `${pair.branchId}:${pair.departmentId}`;
        if (dedup.has(key)) continue;
        dedup.add(key);
        normalized.push({
            branch_id: pair.branchId,
            department_id: pair.departmentId
        });
    }

    return normalized;
};

const replaceScopesForTable = async (tableName, supplierId, scopes, db, ensureTable) => {
    await ensureTable();
    await db.query(
        `DELETE FROM ${tableName} WHERE supplier_id = ?`,
        [supplierId]
    );
    if (!Array.isArray(scopes) || scopes.length === 0) return;

    const values = scopes.map((scope) => [
        supplierId,
        scope.branch_id,
        scope.department_id
    ]);
    await db.query(
        `INSERT INTO ${tableName} (supplier_id, branch_id, department_id) VALUES ?`,
        [values]
    );
};

const replaceSupplierScopes = async (supplierId, scopes, db) =>
    replaceScopesForTable('product_group_scopes', supplierId, scopes, db, ensureSupplierScopeTable);

const replaceInternalOrderScopes = async (supplierId, scopes, db) =>
    replaceScopesForTable('product_group_internal_scopes', supplierId, scopes, db, ensureInternalOrderScopeTable);

const loadScopesMapByTable = async (tableName, supplierIds, ensureTable) => {
    await ensureTable();
    if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
        return new Map();
    }

    const [rows] = await pool.query(
        `SELECT pgs.supplier_id, pgs.branch_id, pgs.department_id,
                b.name AS branch_name, d.name AS department_name
         FROM ${tableName} pgs
         LEFT JOIN branches b ON pgs.branch_id = b.id
         LEFT JOIN departments d ON pgs.department_id = d.id
         WHERE pgs.supplier_id IN (?)
         ORDER BY pgs.supplier_id, b.name, d.name`,
        [supplierIds]
    );

    const map = new Map();
    for (const row of rows) {
        const list = map.get(row.supplier_id) || [];
        list.push({
            branch_id: row.branch_id,
            department_id: row.department_id,
            branch_name: row.branch_name,
            department_name: row.department_name
        });
        map.set(row.supplier_id, list);
    }
    return map;
};

const loadSupplierScopesMap = async (supplierIds) =>
    loadScopesMapByTable('product_group_scopes', supplierIds, ensureSupplierScopeTable);

const loadInternalOrderScopesMap = async (supplierIds) =>
    loadScopesMapByTable('product_group_internal_scopes', supplierIds, ensureInternalOrderScopeTable);

const attachSupplierScopes = async (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const supplierIds = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    const scopesMap = await loadSupplierScopesMap(supplierIds);
    const internalScopesMap = await loadInternalOrderScopesMap(supplierIds);

    return rows.map((row) => {
        const scopes = scopesMap.get(row.id) || [];
        const internalScopes = internalScopesMap.get(row.id) || [];
        return {
            ...row,
            scope_list: scopes,
            scope_count: scopes.length,
            internal_scope_list: internalScopes,
            internal_scope_count: internalScopes.length
        };
    });
};

export const getAllSuppliers = async () => {
    await ensureSupplierColumns();
    await ensureSupplierScopeTable();
    const [rows] = await pool.query(
        `SELECT s.*, b.name AS linked_branch_name, d.name AS linked_department_name
         FROM suppliers s
         LEFT JOIN branches b ON s.linked_branch_id = b.id
         LEFT JOIN departments d ON s.linked_department_id = d.id
         WHERE s.is_active = true
         ORDER BY s.name`
    );
    return attachSupplierScopes(rows);
};

export const getSupplierById = async (id) => {
    await ensureSupplierColumns();
    await ensureSupplierScopeTable();
    const [rows] = await pool.query(
        `SELECT s.*, b.name AS linked_branch_name, d.name AS linked_department_name
         FROM suppliers s
         LEFT JOIN branches b ON s.linked_branch_id = b.id
         LEFT JOIN departments d ON s.linked_department_id = d.id
         WHERE s.id = ?`,
        [id]
    );
    if (rows.length === 0) return null;
    const enriched = await attachSupplierScopes([rows[0]]);
    return enriched[0];
};

export const getSupplierByCode = async (code) => {
    await ensureSupplierColumns();
    const [rows] = await pool.query(
        'SELECT * FROM suppliers WHERE code = ? AND is_active = true LIMIT 1',
        [String(code || '').trim()]
    );
    return rows[0] || null;
};

export const createSupplier = async (data) => {
    await ensureSupplierColumns();
    await ensureSupplierScopeTable();
    await ensureInternalOrderScopeTable();
    const {
        name,
        code,
        contact_person,
        phone,
        address,
        line_id,
        is_internal,
        linked_branch_id,
        linked_department_id,
        scope_list,
        internal_scope_list
    } = data;

    const scopes = await normalizeScopeList(scope_list);
    const internalScopes = await normalizeScopeList(internal_scope_list);
    const normalizedCode = String(code || '').trim();
    const finalCode = normalizedCode || await generateNextCode({
        table: 'suppliers',
        prefix: 'SUP',
        codeField: 'code'
    });
    const relation = await normalizeSupplierRelation(
        is_internal,
        linked_branch_id,
        linked_department_id
    );
    if (relation.isInternal && internalScopes.length === 0) {
        const error = new Error('กรุณาเลือกอย่างน้อย 1 สาขา/แผนกสำหรับสิทธิ์ดูคำสั่งซื้อ');
        error.statusCode = 400;
        throw error;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.query(
            `INSERT INTO suppliers 
        (name, code, contact_person, phone, address, line_id, is_internal, linked_branch_id, linked_department_id, is_active) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
            [
                name,
                finalCode,
                contact_person,
                phone,
                address,
                line_id,
                relation.isInternal,
                relation.linkedBranchId,
                relation.linkedDepartmentId
            ]
        );
        const supplierId = result.insertId;
        await replaceSupplierScopes(supplierId, scopes, connection);
        await replaceInternalOrderScopes(supplierId, internalScopes, connection);
        await connection.commit();

        return {
            id: supplierId,
            ...data,
            code: finalCode,
            is_internal: relation.isInternal,
            linked_branch_id: relation.linkedBranchId,
            linked_department_id: relation.linkedDepartmentId,
            scope_list: scopes,
            internal_scope_list: internalScopes
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const updateSupplier = async (id, data) => {
    await ensureSupplierColumns();
    await ensureSupplierScopeTable();
    await ensureInternalOrderScopeTable();
    const {
        name,
        code,
        contact_person,
        phone,
        address,
        line_id,
        is_internal,
        linked_branch_id,
        linked_department_id,
        scope_list,
        internal_scope_list
    } = data;

    const scopes = await normalizeScopeList(scope_list);
    const internalScopes = await normalizeScopeList(internal_scope_list);
    let finalCode = String(code ?? '').trim();

    if (!finalCode) {
        const [rows] = await pool.query(
            'SELECT code FROM suppliers WHERE id = ?',
            [id]
        );
        finalCode = rows?.[0]?.code;
    }
    const relation = await normalizeSupplierRelation(
        is_internal,
        linked_branch_id,
        linked_department_id
    );
    if (relation.isInternal && internalScopes.length === 0) {
        const error = new Error('กรุณาเลือกอย่างน้อย 1 สาขา/แผนกสำหรับสิทธิ์ดูคำสั่งซื้อ');
        error.statusCode = 400;
        throw error;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(
            `UPDATE suppliers 
         SET name = ?, code = ?, contact_person = ?, phone = ?, address = ?, line_id = ?, is_internal = ?, linked_branch_id = ?, linked_department_id = ? 
         WHERE id = ?`,
            [
                name,
                finalCode,
                contact_person,
                phone,
                address,
                line_id,
                relation.isInternal,
                relation.linkedBranchId,
                relation.linkedDepartmentId,
                id
            ]
        );
        await replaceSupplierScopes(id, scopes, connection);
        await replaceInternalOrderScopes(id, internalScopes, connection);
        await connection.commit();

        return {
            id,
            ...data,
            code: finalCode,
            is_internal: relation.isInternal,
            linked_branch_id: relation.linkedBranchId,
            linked_department_id: relation.linkedDepartmentId,
            scope_list: scopes,
            internal_scope_list: internalScopes
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

export const deleteSupplier = async (id) => {
    await ensureSupplierColumns();
    await ensureSupplierScopeTable();
    await ensureInternalOrderScopeTable();
    await pool.query(
        'UPDATE suppliers SET is_active = false WHERE id = ?',
        [id]
    );
    await pool.query(
        'DELETE FROM product_group_scopes WHERE supplier_id = ?',
        [id]
    );
    await pool.query(
        'DELETE FROM product_group_internal_scopes WHERE supplier_id = ?',
        [id]
    );
    return { id };
};

export const getInternalSuppliersByScope = async ({ branchId, departmentId }) => {
    await ensureSupplierColumns();
    await ensureInternalOrderScopeTable();

    const normalizedBranchId = Number(branchId);
    const normalizedDepartmentId = Number(departmentId);
    if (!Number.isFinite(normalizedBranchId) || !Number.isFinite(normalizedDepartmentId)) {
        return [];
    }

    const [rows] = await pool.query(
        `SELECT id, code, name
         FROM suppliers
         WHERE is_active = true
           AND is_internal = true
           AND EXISTS (
             SELECT 1
             FROM product_group_internal_scopes pgs
             WHERE pgs.supplier_id = suppliers.id
               AND pgs.branch_id = ?
               AND pgs.department_id = ?
           )
         ORDER BY name`,
        [normalizedBranchId, normalizedDepartmentId]
    );
    return rows;
};

export const getAllProductGroups = getAllSuppliers;
export const getProductGroupById = getSupplierById;
export const getProductGroupByCode = getSupplierByCode;
export const createProductGroup = createSupplier;
export const updateProductGroup = updateSupplier;
export const deleteProductGroup = deleteSupplier;
export const getInternalProductGroupsByScope = getInternalSuppliersByScope;
