import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../api/auth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
    }

    setLoading(false);
  }, []);

  const login = async (departmentId) => {
    try {
      console.log('🔐 Login attempt with departmentId:', departmentId);
      const response = await authAPI.login(departmentId);
      console.log('📦 Response from API:', response);

      if (!response?.success) {
        console.error('❌ Login failed - response.success is false:', response);
        return {
          success: false,
          message: response?.message || 'Login failed'
        };
      }

      const payload = response?.data ?? response;
      const token = payload?.token ?? response?.token;
      const userData = payload?.user ?? response?.user;
      console.log('🔑 Token:', token ? 'EXISTS' : 'MISSING');
      console.log('👤 User data:', userData);

      if (!token || !userData) {
        console.error('❌ Login failed - missing token or user:', { token: !!token, userData: !!userData });
        return {
          success: false,
          message: 'Login failed'
        };
      }

      sessionStorage.setItem('token', token);
      sessionStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);

      console.log('✅ Login successful!');
      return { success: true };
    } catch (error) {
      console.error('💥 Login error:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Login failed'
      };
    }
  };

  const logout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin }}>
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
