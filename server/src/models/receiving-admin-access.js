// Cross-branch access is granted only on explicitly read-only receiving paths.
export const canReadReceivingLedger = user =>
  ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);
// Supplier registry and alias maintenance: same four roles as the ledger, read and write.
export const canManageReceivingSuppliers = canReadReceivingLedger;
