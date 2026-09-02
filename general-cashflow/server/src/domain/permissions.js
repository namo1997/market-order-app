const ROLE_PERMISSIONS = {
  cashier: new Set(['receipt:read', 'receipt:create', 'receipt:submit', 'attachment:create']),
  auditor: new Set(['receipt:read', 'receipt:check', 'receipt:correction', 'receipt:note', 'receipt:adjust-closed', 'statement:import', 'attachment:create', 'inbox:read']),
  recorder: new Set(['receipt:read', 'receipt:note', 'receipt:close', 'receipt:adjust-closed', 'report:read', 'inbox:read']),
  admin: new Set([
    'receipt:read',
    'receipt:create',
    'receipt:submit',
    'receipt:check',
    'receipt:correction',
    'receipt:note',
    'receipt:close',
    'receipt:adjust-closed',
    'statement:import',
    'attachment:create',
    'inbox:read',
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
