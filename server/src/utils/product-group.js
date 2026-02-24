const ALIAS_FIELDS = [
  ['supplier_id', 'product_group_id'],
  ['supplier_ids', 'product_group_ids'],
  ['supplier_name', 'product_group_name'],
  ['supplier_code', 'product_group_code'],
  ['allowed_supplier_ids', 'allowed_product_group_ids'],
  ['can_view_supplier_orders', 'can_view_product_group_orders'],
  ['internal_suppliers', 'internal_product_groups']
];

const isPlainObject = (value) =>
  Object.prototype.toString.call(value) === '[object Object]';

export const withProductGroupAliases = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => withProductGroupAliases(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const next = {};
  for (const [key, itemValue] of Object.entries(value)) {
    next[key] = withProductGroupAliases(itemValue);
  }

  ALIAS_FIELDS.forEach(([legacyKey, newKey]) => {
    if (next[newKey] === undefined && next[legacyKey] !== undefined) {
      next[newKey] = next[legacyKey];
    }
  });

  return next;
};

export const resolveProductGroupId = (source = {}) => {
  const value =
    source.product_group_id ??
    source.productGroupId ??
    source.supplier_id ??
    source.supplierId ??
    null;
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

export const withProductGroupFallback = (payload = {}) => {
  const next = { ...payload };
  if (next.supplier_id === undefined && next.product_group_id !== undefined) {
    next.supplier_id = next.product_group_id;
  }
  if (next.supplier_ids === undefined && next.product_group_ids !== undefined) {
    next.supplier_ids = next.product_group_ids;
  }
  if (next.product_group_ids === undefined && next.supplier_ids !== undefined) {
    next.product_group_ids = next.supplier_ids;
  }
  if (next.supplierId === undefined && next.productGroupId !== undefined) {
    next.supplierId = next.productGroupId;
  }
  return next;
};

// Legacy aliases (deprecated): keep for old code paths
export const resolveSupplierId = resolveProductGroupId;
export const withSupplierFallback = withProductGroupFallback;
