import { createContext } from 'react';

// All nested pickers (including row editors) use the document's context,
// especially when an admin receives for a different branch/department.
export const ReceivingProductScope = createContext({});
