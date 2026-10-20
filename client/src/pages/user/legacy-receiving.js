// Phase 1 of retiring the old "รับสินค้า" menu (docs/receiving-rollout.md).
// The old page stays reachable for admins only (emergency rollback); everyone else is sent to the new system.
export const LEGACY_RECEIVING_PATH = '/order/receive';
export const NEW_RECEIVING_PATH = '/receiving';

export const canOpenLegacyReceiving = user => ['admin', 'super_admin'].includes(user?.role);
