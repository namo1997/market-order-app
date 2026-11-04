import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { authAPI } from '../api/auth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const sessionVersion = useRef(0);
  const acceptGoogleSession = useCallback(({ token, user: nextUser }) => {
    sessionVersion.current += 1;
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('user', JSON.stringify(nextUser));
    setUser(nextUser);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const version = sessionVersion.current;
    const isCurrent = () => !cancelled && version === sessionVersion.current;
    // โหลด user จาก sessionStorage (แยกตามแท็บ)
    let token = sessionStorage.getItem('token');
    let savedUser = sessionStorage.getItem('user');

    if ((!token || !savedUser) && localStorage.getItem('token') && localStorage.getItem('user')) {
      token = localStorage.getItem('token');
      savedUser = localStorage.getItem('user');
      sessionStorage.setItem('token', token);
      sessionStorage.setItem('user', savedUser);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }

    const devMockEnabled = import.meta.env.VITE_ENABLE_DEV_MOCK_AUTH === 'true';
    if (token === 'dev-mock-token' && !devMockEnabled) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('user');
      token = null;
      savedUser = null;
    }

    // Dev mock ต้องเปิดเองเท่านั้น ไม่งั้นหน้า login จะเด้งวนเมื่อ backend ทำงานจริง
    if (
      !token &&
      !savedUser &&
      import.meta.env.DEV &&
      devMockEnabled
    ) {
      const mockAdmin = { id: 0, name: 'Admin (จำลอง)', role: 'super_admin', department_name: 'ระบบ' };
      sessionStorage.setItem('token', 'dev-mock-token');
      sessionStorage.setItem('user', JSON.stringify(mockAdmin));
      setUser(mockAdmin);
      setLoading(false);
      return;
    }

    if (token && savedUser) {
      try {
        JSON.parse(savedUser);
      } catch {
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        setUser(null);
        setLoading(false);
        return;
      }
      if (import.meta.env.DEV && devMockEnabled && token === 'dev-mock-token') {
        setUser(JSON.parse(savedUser));
        setLoading(false);
        return;
      }
      authAPI.getCurrentUser()
        .then((response) => {
          if (!isCurrent()) return;
          const payload = response?.data ?? response;
          const latestUser = payload?.data ?? payload;
          if (latestUser) {
            sessionStorage.setItem('user', JSON.stringify(latestUser));
            setUser(latestUser);
          }
        })
        .catch((error) => {
          if (!isCurrent()) return;
          if (error.response?.status === 401) {
            sessionStorage.removeItem('token');
            sessionStorage.removeItem('user');
          }
          setUser(null);
        })
        .finally(() => { if (isCurrent()) setLoading(false); });
    } else {
      setLoading(false);
    }

    return () => { cancelled = true; };
  }, []);

  const login = async (departmentId) => {
    const version = ++sessionVersion.current;
    try {
      const response = await authAPI.login(departmentId);
      if (version !== sessionVersion.current) return { success: false };

      if (!response?.success) {
        return {
          success: false,
          message: response?.message || 'Login failed'
        };
      }

      const payload = response?.data ?? response;
      const token = payload?.token ?? response?.token;
      const userData = payload?.user ?? response?.user;

      if (!token || !userData) {
        return {
          success: false,
          message: 'Login failed'
        };
      }

      sessionStorage.setItem('token', token);
      sessionStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
      setLoading(false);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Login failed'
      };
    } finally {
      if (version === sessionVersion.current) setLoading(false);
    }
  };

  const loginSuperAdminWithLineCode = (code) => loginSuperAdmin(null, code);

  const loginSuperAdmin = async (pin, lineCode = null) => {
    const version = ++sessionVersion.current;
    try {
      const response = lineCode
        ? await authAPI.exchangeSuperAdminLineCode(lineCode)
        : await authAPI.loginSuperAdmin(pin);
      if (version !== sessionVersion.current) return { success: false };

      if (!response?.success) {
        return {
          success: false,
          message: response?.message || 'Login failed'
        };
      }

      const payload = response?.data ?? response;
      const token = payload?.token ?? response?.token;
      const userData = payload?.user ?? response?.user;

      if (!token || !userData) {
        return {
          success: false,
          message: 'Login failed'
        };
      }

      sessionStorage.setItem('token', token);
      sessionStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
      setLoading(false);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Login failed'
      };
    } finally {
      if (version === sessionVersion.current) setLoading(false);
    }
  };

  const logout = () => {
    sessionVersion.current += 1;
    setLoading(false);
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const isAdmin = ['admin', 'super_admin'].includes(user?.role);
  const isSuperAdmin = user?.role === 'super_admin';
  const isProduction = Boolean(user?.is_production_department);
  const canViewProductGroupOrders = Boolean(
    user?.can_view_product_group_orders ?? user?.can_view_supplier_orders
  );
  const allowedProductGroupIds = Array.isArray(
    user?.allowed_product_group_ids ?? user?.allowed_supplier_ids
  )
    ? (user?.allowed_product_group_ids ?? user?.allowed_supplier_ids)
    : [];
  const canViewSupplierOrders = canViewProductGroupOrders;
  const allowedSupplierIds = allowedProductGroupIds;
  const canUseStockCheck =
    user?.can_use_stock_check === undefined || user?.can_use_stock_check === null
      ? true
      : Boolean(user.can_use_stock_check);

  const canViewStockBalance = Boolean(user?.can_view_stock_balance);

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        acceptGoogleSession,
        loginSuperAdmin,
        loginSuperAdminWithLineCode,
        logout,
        loading,
        isAdmin,
        isSuperAdmin,
        isProduction,
        canViewProductGroupOrders,
        allowedProductGroupIds,
        canViewSupplierOrders,
        allowedSupplierIds,
        canUseStockCheck,
        canViewStockBalance
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
