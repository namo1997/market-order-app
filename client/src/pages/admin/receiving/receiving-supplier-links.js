// Cross-links between the old admin supplier pages and the receiving supplier pages.
// Pure helpers so both sides (and the tests) build exactly the same paths.
export const RECEIVING_SUPPLIERS_PATH = '/admin/receiving/suppliers';
export const SUPPLIER_MASTER_PATH = '/admin/settings/suppliers';
export const PRODUCT_GROUP_PATH = '/admin/settings/product-groups';
export const RECEIVING_LINK_TEXT = 'ชื่อย่อในบิล / การรับของ →';
export const CONTACT_LINK_TEXT = 'ข้อมูลผู้ติดต่อ / บัญชี (หน้าซัพพลายเออร์) →';

// Row of the old supplier-master page => receiving key `sm:<id>`; product group => `pg:<id>`.
export const receivingSupplierPath = (kind, id) => `${RECEIVING_SUPPLIERS_PATH}/${encodeURIComponent(`${kind === 'group' ? 'pg' : 'sm'}:${id}`)}`;

// Admin-only target (bank data lives there). A master row opens the supplier page pre-filtered by code (or name);
// a product-group-only row opens the product-group page.
export function legacySupplierPath(detail) {
  if (detail?.kind === 'group') return PRODUCT_GROUP_PATH;
  const term = String(detail?.code || detail?.name || '').trim();
  return term ? `${SUPPLIER_MASTER_PATH}?q=${encodeURIComponent(term)}` : SUPPLIER_MASTER_PATH;
}

export const initialSupplierQuery = search => {
  const value = new URLSearchParams(search || '').get('q');
  return value ? value.slice(0, 100) : '';
};
