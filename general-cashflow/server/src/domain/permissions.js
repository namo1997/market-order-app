const ROLE_PERMISSIONS = {
  cashier: new Set(['receipt:read', 'receipt:create', 'receipt:submit', 'attachment:create']),
  auditor: new Set(['receipt:read', 'receipt:check', 'receipt:correction', 'statement:import']),
  recorder: new Set(['receipt:read', 'receipt:close', 'report:read']),
  admin: new Set([
    'receipt:read',
    'receipt:create',
    'receipt:submit',
    'receipt:check',
    'receipt:correction',
    'receipt:close',
    'statement:import',
    'attachment:create',
    'settings:manage',
    'report:read'
  ])
};

export const hasPermission = (role, permission) => Boolean(ROLE_PERMISSIONS[role]?.has(permission));

export const assertPermission = (user, permission) => {
  if (!hasPermission(user?.role, permission)) {
    const error = new Error('Access denied.');
    error.statusCode = 403;
    throw error;
  }
};
