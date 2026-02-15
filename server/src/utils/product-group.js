const ALIAS_FIELDS = [
  ['supplier_id', 'product_group_id'],
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

export const resolveSupplierId = (source = {}) => {
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

export const withSupplierFallback = (payload = {}) => {
  const next = { ...payload };
  if (next.supplier_id === undefined && next.product_group_id !== undefined) {
    next.supplier_id = next.product_group_id;
  }
  if (next.supplierId === undefined && next.productGroupId !== undefined) {
    next.supplierId = next.productGroupId;
  }
  return next;
};
