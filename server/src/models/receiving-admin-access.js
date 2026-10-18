// Cross-branch access is granted only on explicitly read-only receiving paths.
export const canReadReceivingLedger = user =>
  ['admin', 'super_admin', 'accounting', 'accountant'].includes(user?.role);
