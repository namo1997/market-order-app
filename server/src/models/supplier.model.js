import pool from '../config/database.js';
import { generateNextCode } from '../utils/code.js';

export const ensureSupplierColumns = async () => {
    const [isInternalColumn] = await pool.query(
        "SHOW COLUMNS FROM product_groups LIKE 'is_internal'"
    );
    if (isInternalColumn.length === 0) {
        await pool.query(
            'ALTER TABLE product_groups ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT false AFTER line_id'
        );
    }

    const [linkedBranchColumn] = await pool.query(
        "SHOW COLUMNS FROM product_groups LIKE 'linked_branch_id'"
    );
    if (linkedBranchColumn.length === 0) {
        await pool.query(
            'ALTER TABLE product_groups ADD COLUMN linked_branch_id INT NULL AFTER is_internal'
        );
    }

    const [linkedDepartmentColumn] = await pool.query(
        "SHOW COLUMNS FROM product_groups LIKE 'linked_department_id'"
    );
    if (linkedDepartmentColumn.length === 0) {
        await pool.query(
            'ALTER TABLE product_groups ADD COLUMN linked_department_id INT NULL AFTER linked_branch_id'
        );
    }

    const [skipReceivingRequiredColumn] = await pool.query(
        "SHOW COLUMNS FROM product_groups LIKE 'skip_receiving_required'"
    );
    if (skipReceivingRequiredColumn.length === 0) {
        await pool.query(
            'ALTER TABLE product_groups ADD COLUMN skip_receiving_required BOOLEAN NOT NULL DEFAULT true AFTER is_internal'
        );
    }
};

let ensuredSupplierScopeTable = false;
let ensuredInternalOrderScopeTable = false;
let ensuredTransformScopeTable = false;
let ensuredWithdrawSourceTable = false;

const columnExists = async (tableName, columnName) => {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND column_name = ?`,
        [tableName, columnName]
    );
    return Number(rows?.[0]?.total || 0) > 0;
};

const indexExists = async (tableName, indexName) => {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND index_name = ?`,
        [tableName, indexName]
    );
    return Number(rows?.[0]?.total || 0) > 0;
};

const ensureScopeTableCompatibility = async (tableName, indexName) => {
    const hasProductGroupId = await columnExists(tableName, 'product_group_id');
    if (!hasProductGroupId) {
        const hasSupplierId = await columnExists(tableName, 'supplier_id');
        if (hasSupplierId) {
            await pool.query(
                `ALTER TABLE ${tableName}
                 ADD COLUMN product_group_id INT NULL AFTER supplier_id`
            );
            await pool.query(
                `UPDATE ${tableName}
                 SET product_group_id = supplier_id
                 WHERE product_group_id IS NULL`
            );
            await pool.query(
                `ALTER TABLE ${tableName}
                 MODIFY COLUMN product_group_id INT NOT NULL`
            );
        } else {
            await pool.query(
                `ALTER TABLE ${tableName}
                 ADD COLUMN product_group_id INT NOT NULL AFTER id`
            );
        }
    }

    const hasIndex = await indexExists(tableName, indexName);
    if (!hasIndex) {
        await pool.query(
            `ALTER TABLE ${tableName}
             ADD INDEX ${indexName} (product_group_id)`
        );
    }
};

export const ensureSupplierScopeTable = async () => {
    if (ensuredSupplierScopeTable) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_group_scopes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_group_id INT NOT NULL,
            branch_id INT NOT NULL,
            department_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product_group_scope (product_group_id, branch_id, department_id),
            INDEX idx_product_group_scope_group (product_group_id),
            INDEX idx_product_group_scope_branch (branch_id),
            INDEX idx_product_group_scope_department (department_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await ensureScopeTableCompatibility('product_group_scopes', 'idx_product_group_scope_group');
    ensuredSupplierScopeTable = true;
};

export const ensureInternalOrderScopeTable = async () => {
    if (ensuredInternalOrderScopeTable) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_group_internal_scopes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_group_id INT NOT NULL,
            branch_id INT NOT NULL,
            department_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product_group_internal_scope (product_group_id, branch_id, department_id),
            INDEX idx_product_group_internal_scope_group (product_group_id),
            INDEX idx_product_group_internal_scope_branch (branch_id),
            INDEX idx_product_group_internal_scope_department (department_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await ensureScopeTableCompatibility(
        'product_group_internal_scopes',
        'idx_product_group_internal_scope_group'
    );
    ensuredInternalOrderScopeTable = true;
};

export const ensureTransformScopeTable = async () => {
    if (ensuredTransformScopeTable) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_group_transform_scopes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_group_id INT NOT NULL,
            branch_id INT NOT NULL,
            department_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_product_group_transform_scope (product_group_id, branch_id, department_id),
            INDEX idx_product_group_transform_scope_group (product_group_id),
            INDEX idx_product_group_transform_scope_branch (branch_id),
            INDEX idx_product_group_transform_scope_department (department_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await ensureScopeTableCompatibility(
        'product_group_transform_scopes',
        'idx_product_group_transform_scope_group'
    );
    ensuredTransformScopeTable = true;
};

export const ensureProductGroupWithdrawSourceTable = async () => {
    if (ensuredWithdrawSourceTable) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_group_withdraw_sources (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_group_id INT NOT NULL,
            source_department_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_product_group_withdraw_source (product_group_id),
            INDEX idx_product_group_withdraw_source_department (source_department_id),
            CONSTRAINT fk_product_group_withdraw_source_group
              FOREIGN KEY (product_group_id) REFERENCES product_groups(id) ON DELETE CASCADE,
            CONSTRAINT fk_product_group_withdraw_source_department
              FOREIGN KEY (source_department_id) REFERENCES departments(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    ensuredWithdrawSourceTable = true;
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

const validateBranchDepartmentPair = async (
    branchId,
    departmentId,
    db = pool,
    options = {}
) => {
    const requireProduction = Boolean(options.requireProduction);
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
        'SELECT id, branch_id, is_production FROM departments WHERE id = ? AND is_active = true',
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
    if (requireProduction && !Boolean(Number(departmentRows[0].is_production || 0))) {
        const error = new Error('แผนกที่ผูกสินค้าการแปรรูป ต้องเป็นฝ่ายผลิตเท่านั้น');
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

const normalizeScopeList = async (scopeList, db = pool, options = {}) => {
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

        const pair = await validateBranchDepartmentPair(branchId, departmentId, db, options);
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

const normalizeTransformScopeList = async (scopeList, db = pool) =>
    normalizeScopeList(scopeList, db, { requireProduction: true });

const normalizeWithdrawSourceDepartmentId = async (sourceDepartmentId, db = pool) => {
    if (sourceDepartmentId === undefined || sourceDepartmentId === null || sourceDepartmentId === '') {
        return null;
    }

    const normalizedId = Number(sourceDepartmentId);
    if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
        const error = new Error('พื้นที่เก็บต้นทางไม่ถูกต้อง');
        error.statusCode = 400;
        throw error;
    }

    const [rows] = await db.query(
        `SELECT id
         FROM departments
         WHERE id = ? AND is_active = true
         LIMIT 1`,
        [normalizedId]
    );

    if (rows.length === 0) {
        const error = new Error('ไม่พบพื้นที่เก็บต้นทางที่เลือก');
        error.statusCode = 400;
        throw error;
    }

    return normalizedId;
};

const replaceScopesForTable = async (tableName, supplierId, scopes, db, ensureTable) => {
    await ensureTable();
    await db.query(
        `DELETE FROM ${tableName} WHERE product_group_id = ?`,
        [supplierId]
    );
    if (!Array.isArray(scopes) || scopes.length === 0) return;

    const values = scopes.map((scope) => [
        supplierId,
        scope.branch_id,
        scope.department_id
    ]);
    await db.query(
        `INSERT INTO ${tableName} (product_group_id, branch_id, department_id) VALUES ?`,
        [values]
    );
};

const replaceSupplierScopes = async (supplierId, scopes, db) =>
    replaceScopesForTable('product_group_scopes', supplierId, scopes, db, ensureSupplierScopeTable);

const replaceInternalOrderScopes = async (supplierId, scopes, db) =>
    replaceScopesForTable('product_group_internal_scopes', supplierId, scopes, db, ensureInternalOrderScopeTable);

const replaceTransformScopes = async (supplierId, scopes, db) =>
    replaceScopesForTable('product_group_transform_scopes', supplierId, scopes, db, ensureTransformScopeTable);

const replaceWithdrawSource = async (supplierId, sourceDepartmentId, db) => {
    await ensureProductGroupWithdrawSourceTable();
    await db.query(
        'DELETE FROM product_group_withdraw_sources WHERE product_group_id = ?',
        [supplierId]
    );
    if (!Number.isFinite(Number(sourceDepartmentId)) || Number(sourceDepartmentId) <= 0) return;

    await db.query(
        `INSERT INTO product_group_withdraw_sources (product_group_id, source_department_id)
         VALUES (?, ?)`,
        [supplierId, Number(sourceDepartmentId)]
    );
};

const loadScopesMapByTable = async (tableName, supplierIds, ensureTable) => {
    await ensureTable();
    if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
        return new Map();
    }

    const [rows] = await pool.query(
        `SELECT pgs.product_group_id, pgs.branch_id, pgs.department_id,
                b.name AS branch_name, d.name AS department_name
         FROM ${tableName} pgs
         LEFT JOIN branches b ON pgs.branch_id = b.id
         LEFT JOIN departments d ON pgs.department_id = d.id
         WHERE pgs.product_group_id IN (?)
         ORDER BY pgs.product_group_id, b.name, d.name`,
        [supplierIds]
    );

    const map = new Map();
    for (const row of rows) {
        const list = map.get(row.product_group_id) || [];
        list.push({
            branch_id: row.branch_id,
            department_id: row.department_id,
            branch_name: row.branch_name,
            department_name: row.department_name
        });
        map.set(row.product_group_id, list);
    }
    return map;
};

const loadSupplierScopesMap = async (supplierIds) =>
    loadScopesMapByTable('product_group_scopes', supplierIds, ensureSupplierScopeTable);

const loadInternalOrderScopesMap = async (supplierIds) =>
    loadScopesMapByTable('product_group_internal_scopes', supplierIds, ensureInternalOrderScopeTable);

const loadTransformScopesMap = async (supplierIds) =>
    loadScopesMapByTable('product_group_transform_scopes', supplierIds, ensureTransformScopeTable);

const loadWithdrawSourceMap = async (supplierIds) => {
    await ensureProductGroupWithdrawSourceTable();
    if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
        return new Map();
    }

    const [rows] = await pool.query(
        `SELECT
            pgws.product_group_id,
            pgws.source_department_id,
            d.name AS source_department_name,
            b.id AS source_branch_id,
            b.name AS source_branch_name
         FROM product_group_withdraw_sources pgws
         JOIN departments d ON d.id = pgws.source_department_id
         JOIN branches b ON b.id = d.branch_id
         WHERE pgws.product_group_id IN (?)
         ORDER BY pgws.product_group_id`,
        [supplierIds]
    );

    return new Map(
        rows.map((row) => [
            Number(row.product_group_id),
            {
                source_department_id: Number(row.source_department_id),
                source_department_name: row.source_department_name || null,
                source_branch_id: Number(row.source_branch_id),
                source_branch_name: row.source_branch_name || null
            }
        ])
    );
};

const attachSupplierScopes = async (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const supplierIds = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    const scopesMap = await loadSupplierScopesMap(supplierIds);
    const internalScopesMap = await loadInternalOrderScopesMap(supplierIds);
    const transformScopesMap = await loadTransformScopesMap(supplierIds);
    const withdrawSourceMap = await loadWithdrawSourceMap(supplierIds);

    return rows.map((row) => {
        const scopes = scopesMap.get(row.id) || [];
        const internalScopes = internalScopesMap.get(row.id) || [];
        const transformScopes = transformScopesMap.get(row.id) || [];
        const withdrawSource = withdrawSourceMap.get(Number(row.id)) || null;
        return {
            ...row,
            scope_list: scopes,
            scope_count: scopes.length,
            internal_scope_list: internalScopes,
            internal_scope_count: internalScopes.length,
            transform_scope_list: transformScopes,
            transform_scope_count: transformScopes.length,
            withdraw_source_department_id: withdrawSource?.source_department_id || null,
            withdraw_source_department_name: withdrawSource?.source_department_name || null,
            withdraw_source_branch_id: withdrawSource?.source_branch_id || null,
            withdraw_source_branch_name: withdrawSource?.source_branch_name || null
        };
    });
};

export const getAllSuppliers = async () => {
    await ensureSupplierColumns();
    await ensureSupplierScopeTable();
    await ensureInternalOrderScopeTable();
    await ensureTransformScopeTable();
    await ensureProductGroupWithdrawSourceTable();
    const [rows] = await pool.query(
        `SELECT s.*, b.name AS linked_branch_name, d.name AS linked_department_name
         FROM product_groups s
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
    await ensureInternalOrderScopeTable();
    await ensureTransformScopeTable();
    await ensureProductGroupWithdrawSourceTable();
    const [rows] = await pool.query(
        `SELECT s.*, b.name AS linked_branch_name, d.name AS linked_department_name
         FROM product_groups s
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
        'SELECT * FROM product_groups WHERE code = ? AND is_active = true LIMIT 1',
        [String(code || '').trim()]
    );
    return rows[0] || null;
};

export const createSupplier = async (data) => {
    await ensureSupplierColumns();
    await ensureSupplierScopeTable();
    await ensureInternalOrderScopeTable();
    await ensureTransformScopeTable();
    const {
        name,
        code,
        contact_person,
        phone,
        address,
        line_id,
        is_internal,
        skip_receiving_required,
        linked_branch_id,
        linked_department_id,
        scope_list,
        internal_scope_list,
        transform_scope_list,
        withdraw_source_department_id
    } = data;

    const scopes = await normalizeScopeList(scope_list);
    const internalScopes = await normalizeScopeList(internal_scope_list);
    const transformScopes = await normalizeTransformScopeList(transform_scope_list);
    const withdrawSourceDepartmentId = await normalizeWithdrawSourceDepartmentId(withdraw_source_department_id);
    const normalizedCode = String(code || '').trim();
    const finalCode = normalizedCode || await generateNextCode({
        table: 'product_groups',
        prefix: 'SUP',
        codeField: 'code'
    });
    const relation = await normalizeSupplierRelation(
        is_internal,
        linked_branch_id,
        linked_department_id
    );
    const skipReceivingRequired = skip_receiving_required === undefined
        ? true
        : toBoolean(skip_receiving_required);
    if (relation.isInternal && internalScopes.length === 0) {
        const error = new Error('กรุณาเลือกอย่างน้อย 1 สาขา/แผนกสำหรับสิทธิ์ดูคำสั่งซื้อ');
        error.statusCode = 400;
        throw error;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.query(
            `INSERT INTO product_groups 
        (name, code, contact_person, phone, address, line_id, is_internal, skip_receiving_required, linked_branch_id, linked_department_id, is_active) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
            [
                name,
                finalCode,
                contact_person,
                phone,
                address,
                line_id,
                relation.isInternal,
                skipReceivingRequired,
                relation.linkedBranchId,
                relation.linkedDepartmentId
            ]
        );
        const supplierId = result.insertId;
        await replaceSupplierScopes(supplierId, scopes, connection);
        await replaceInternalOrderScopes(supplierId, internalScopes, connection);
        await replaceTransformScopes(supplierId, transformScopes, connection);
        await replaceWithdrawSource(supplierId, withdrawSourceDepartmentId, connection);
        await connection.commit();

        return {
            id: supplierId,
            ...data,
            code: finalCode,
            is_internal: relation.isInternal,
            skip_receiving_required: skipReceivingRequired,
            linked_branch_id: relation.linkedBranchId,
            linked_department_id: relation.linkedDepartmentId,
            scope_list: scopes,
            internal_scope_list: internalScopes,
            transform_scope_list: transformScopes,
            withdraw_source_department_id: withdrawSourceDepartmentId
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
    await ensureTransformScopeTable();
    const {
        name,
        code,
        contact_person,
        phone,
        address,
        line_id,
        is_internal,
        skip_receiving_required,
        linked_branch_id,
        linked_department_id,
        scope_list,
        internal_scope_list,
        transform_scope_list,
        withdraw_source_department_id
    } = data;

    const scopes = await normalizeScopeList(scope_list);
    const internalScopes = await normalizeScopeList(internal_scope_list);
    const transformScopes = await normalizeTransformScopeList(transform_scope_list);
    const withdrawSourceDepartmentId = await normalizeWithdrawSourceDepartmentId(withdraw_source_department_id);
    let finalCode = String(code ?? '').trim();

    if (!finalCode) {
        const [rows] = await pool.query(
            'SELECT code FROM product_groups WHERE id = ?',
            [id]
        );
        finalCode = rows?.[0]?.code;
    }
    const relation = await normalizeSupplierRelation(
        is_internal,
        linked_branch_id,
        linked_department_id
    );
    const skipReceivingRequired = skip_receiving_required === undefined
        ? true
        : toBoolean(skip_receiving_required);
    if (relation.isInternal && internalScopes.length === 0) {
        const error = new Error('กรุณาเลือกอย่างน้อย 1 สาขา/แผนกสำหรับสิทธิ์ดูคำสั่งซื้อ');
        error.statusCode = 400;
        throw error;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(
            `UPDATE product_groups 
         SET name = ?, code = ?, contact_person = ?, phone = ?, address = ?, line_id = ?, is_internal = ?, skip_receiving_required = ?, linked_branch_id = ?, linked_department_id = ? 
         WHERE id = ?`,
            [
                name,
                finalCode,
                contact_person,
                phone,
                address,
                line_id,
                relation.isInternal,
                skipReceivingRequired,
                relation.linkedBranchId,
                relation.linkedDepartmentId,
                id
            ]
        );
        await replaceSupplierScopes(id, scopes, connection);
        await replaceInternalOrderScopes(id, internalScopes, connection);
        await replaceTransformScopes(id, transformScopes, connection);
        await replaceWithdrawSource(id, withdrawSourceDepartmentId, connection);
        await connection.commit();

        return {
            id,
            ...data,
            code: finalCode,
            is_internal: relation.isInternal,
            skip_receiving_required: skipReceivingRequired,
            linked_branch_id: relation.linkedBranchId,
            linked_department_id: relation.linkedDepartmentId,
            scope_list: scopes,
            internal_scope_list: internalScopes,
            transform_scope_list: transformScopes,
            withdraw_source_department_id: withdrawSourceDepartmentId
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
    await ensureTransformScopeTable();
    await ensureProductGroupWithdrawSourceTable();
    await pool.query(
        'UPDATE product_groups SET is_active = false WHERE id = ?',
        [id]
    );
    await pool.query(
        'DELETE FROM product_group_scopes WHERE product_group_id = ?',
        [id]
    );
    await pool.query(
        'DELETE FROM product_group_internal_scopes WHERE product_group_id = ?',
        [id]
    );
    await pool.query(
        'DELETE FROM product_group_transform_scopes WHERE product_group_id = ?',
        [id]
    );
    await pool.query(
        'DELETE FROM product_group_withdraw_sources WHERE product_group_id = ?',
        [id]
    );
    return { id };
};

export const getProductGroupWithdrawSourcesMap = async ({
    productGroupIds = [],
    connection = pool
} = {}) => {
    await ensureProductGroupWithdrawSourceTable();

    const ids = Array.isArray(productGroupIds)
        ? productGroupIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
        : [];
    if (ids.length === 0) {
        return new Map();
    }

    const [rows] = await connection.query(
        `SELECT
            pgws.product_group_id,
            pgws.source_department_id,
            d.name AS source_department_name,
            b.id AS source_branch_id,
            b.name AS source_branch_name
         FROM product_group_withdraw_sources pgws
         JOIN departments d ON d.id = pgws.source_department_id
         JOIN branches b ON b.id = d.branch_id
         WHERE pgws.product_group_id IN (?)
           AND d.is_active = true
         ORDER BY pgws.product_group_id`,
        [ids]
    );

    return new Map(
        rows.map((row) => [
            Number(row.product_group_id),
            {
                source_department_id: Number(row.source_department_id),
                source_department_name: row.source_department_name || null,
                source_branch_id: Number(row.source_branch_id),
                source_branch_name: row.source_branch_name || null
            }
        ])
    );
};

export const getMappedSourceDepartmentByProductGroup = async ({
    productGroupId,
    connection = pool
} = {}) => {
    const normalizedGroupId = Number(productGroupId);
    if (!Number.isFinite(normalizedGroupId) || normalizedGroupId <= 0) {
        return null;
    }

    const map = await getProductGroupWithdrawSourcesMap({
        productGroupIds: [normalizedGroupId],
        connection
    });
    return map.get(normalizedGroupId) || null;
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
         FROM product_groups
         WHERE is_active = true
           AND is_internal = true
           AND EXISTS (
             SELECT 1
             FROM product_group_internal_scopes pgs
             WHERE pgs.product_group_id = product_groups.id
               AND pgs.branch_id = ?
               AND pgs.department_id = ?
           )
         ORDER BY name`,
        [normalizedBranchId, normalizedDepartmentId]
    );
    return rows;
};

export const getTransformProductGroupsByScope = async ({ branchId, departmentId }) => {
    await ensureSupplierColumns();
    await ensureTransformScopeTable();

    const normalizedBranchId = Number(branchId);
    const normalizedDepartmentId = Number(departmentId);
    if (!Number.isFinite(normalizedBranchId) || !Number.isFinite(normalizedDepartmentId)) {
        return [];
    }

    const [rows] = await pool.query(
        `SELECT id, code, name
         FROM product_groups
         WHERE is_active = true
           AND EXISTS (
             SELECT 1
             FROM product_group_transform_scopes pgts
             WHERE pgts.product_group_id = product_groups.id
               AND pgts.branch_id = ?
               AND pgts.department_id = ?
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
export const ensureProductGroupColumns = ensureSupplierColumns;
export const ensureProductGroupScopeTable = ensureSupplierScopeTable;
export const ensureProductGroupInternalScopeTable = ensureInternalOrderScopeTable;
export const ensureProductGroupTransformScopeTable = ensureTransformScopeTable;
