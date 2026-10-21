// Phase 1 of retiring the old "รับสินค้า" menu (docs/receiving-rollout.md).
// The old page stays reachable for admins only (emergency rollback); everyone else is sent to the new system.
export const LEGACY_RECEIVING_PATH = '/order/receive';
export const NEW_RECEIVING_PATH = '/receiving';

// Owner 2026-10-21: staff go back to the old "รับสินค้า" menu for now. The new system stays reachable
// by URL and the mobile app but is not on the function menu. Set to false to resume phase 1.
export const LEGACY_RECEIVING_PRIMARY = true;

export const canOpenLegacyReceiving = user =>
  LEGACY_RECEIVING_PRIMARY || ['admin', 'super_admin'].includes(user?.role);
