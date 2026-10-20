// Rollout switch for the OLD "รับสินค้า" write endpoints (see docs/receiving-rollout.md).
//
//   true  (phase 1, current) : the old write endpoints keep working, but every call logs a
//                              deprecation warning so remaining users can be found.
//   false (phase 2)          : the old write endpoints answer 410 Gone with a Thai message
//                              pointing to the new receiving system. Nothing else changes.
//
// Affected endpoints (writes only; GET /orders/receiving/bill-photos stays read-only/available):
//   POST /api/orders/receiving/bill-photos, PUT /api/orders/receiving,
//   POST /api/orders/receiving/manual-item,
//   PUT /api/admin/orders/receiving, POST /api/admin/orders/receiving/bulk
//
// Deliberately a code constant (not env/.env): flipping it is a reviewed one-line change.
export const LEGACY_RECEIVING_WRITES_ENABLED = true;
