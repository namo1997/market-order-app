import { createContext, useContext } from 'react';
const Auth = createContext(null);
export const ReceivingAuth = Auth.Provider;
export const useAuth = () => useContext(Auth);
