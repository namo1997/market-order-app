/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { generalPurchaseAPI } from '../api/general-purchase';
import { generalPurchaseAuthAPI } from '../api/general-purchase-auth';

export const STATUS_META = {
  pending_review: { label: 'รอตรวจสอบ', color: 'amber', step: 1 },
  approved: { label: 'อนุมัติแล้ว (รอออก PO)', color: 'sky', step: 2 },
  awaiting_receipt: { label: 'รอรับสินค้า', color: 'indigo', step: 3 },
  received: { label: 'รับเสร็จแล้ว', color: 'emerald', step: 4 },
  rejected: { label: 'ไม่อนุมัติ', color: 'rose', step: 0 },
};

const GeneralPurchaseContext = createContext(null);

const replaceOne = (rows, next) => rows.map((row) => (row.id === next.id ? next : row));

export const GeneralPurchaseProvider = ({ children }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [access, setAccess] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('general_purchase_access') || 'null');
    } catch {
      return null;
    }
  });

  const saveAccess = useCallback((payload) => {
    const data = payload?.data || payload;
    if (!data?.token) return null;
    sessionStorage.setItem('general_purchase_token', data.token);
    sessionStorage.setItem('general_purchase_access', JSON.stringify(data));
    setAccess(data);
    return data;
  }, []);

  const clearAccess = useCallback(() => {
    sessionStorage.removeItem('general_purchase_token');
    sessionStorage.removeItem('general_purchase_access');
    setAccess(null);
  }, []);

  const loginReadonlyPin = useCallback(async (pin) => {
    const result = await generalPurchaseAuthAPI.loginReadonlyPin(pin);
    return saveAccess(result);
  }, [saveAccess]);

  useEffect(() => {
    const exchangeFromHash = async () => {
      try {
        const hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
        const employeeToken = hash.get('employee_token');
        if (employeeToken) {
          const result = await generalPurchaseAuthAPI.exchangeEmployeeToken(employeeToken);
          saveAccess(result);
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
          return;
        }

        const storedToken = sessionStorage.getItem('general_purchase_token');
        if (!storedToken) setAccess(null);
      } catch (err) {
        clearAccess();
        setError(err.response?.data?.message || 'ยืนยันสิทธิ์ PR/PO ไม่สำเร็จ');
      } finally {
        setAuthLoading(false);
      }
    };

    exchangeFromHash();
  }, [clearAccess, saveAccess]);

  const refresh = useCallback(async () => {
    if (!sessionStorage.getItem('general_purchase_token')) {
      setRequests([]);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const result = await generalPurchaseAPI.getAll({ limit: 500 });
      setRequests(Array.isArray(result?.data) ? result.data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลสั่งซื้อทั่วไปไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) refresh();
  }, [authLoading, access?.token, refresh]);

  const createRequest = useCallback(async ({ header, items, requestedBy, clientRequestId }) => {
    if (access?.readonly) {
      throw new Error('ไม่มีสิทธิ์สั่งซื้อ ต้องสั่งจากแอพหัวหน้างาน');
    }
    const result = await generalPurchaseAPI.create({ header, items, requestedBy, clientRequestId });
    if (result?.data) {
      setRequests((current) => {
        if (current.some((row) => row.id === result.data.id)) return current;
        return [result.data, ...current];
      });
      return result.data.id;
    }
    await refresh();
    return null;
  }, [access?.readonly, refresh]);

  const approveRequest = useCallback(async (id, note) => {
    const result = await generalPurchaseAPI.approve(id, note);
    if (result?.data) setRequests((current) => replaceOne(current, result.data));
  }, []);

  const rejectRequest = useCallback(async (id, reason) => {
    const result = await generalPurchaseAPI.reject(id, reason);
    if (result?.data) setRequests((current) => replaceOne(current, result.data));
  }, []);

  const issuePO = useCallback(async (id, payload) => {
    const result = await generalPurchaseAPI.issuePO(id, payload);
    if (result?.data) setRequests((current) => replaceOne(current, result.data));
  }, []);

  const receiveAndPrice = useCallback(async (id, payload) => {
    const result = await generalPurchaseAPI.receive(id, payload);
    if (result?.data) setRequests((current) => replaceOne(current, result.data));
  }, []);

  const stats = useMemo(() => {
    const counts = { pending_review: 0, approved: 0, awaiting_receipt: 0, received: 0, rejected: 0 };
    for (const r of requests) counts[r.status] = (counts[r.status] || 0) + 1;
    return counts;
  }, [requests]);

  const value = useMemo(
    () => ({
      requests,
      stats,
      loading,
      authLoading,
      access,
      canCreate: !!access?.canCreate,
      canApprove: !!access?.canApprove,
      canOperate: !!access,
      isReadonly: !!access?.readonly,
      error,
      refresh,
      resetAll: refresh,
      loginReadonlyPin,
      clearAccess,
      createRequest,
      approveRequest,
      rejectRequest,
      issuePO,
      receiveAndPrice,
    }),
    [requests, stats, loading, authLoading, access, error, refresh, loginReadonlyPin, clearAccess, createRequest, approveRequest, rejectRequest, issuePO, receiveAndPrice]
  );

  return <GeneralPurchaseContext.Provider value={value}>{children}</GeneralPurchaseContext.Provider>;
};

export const useGeneralPurchase = () => {
  const ctx = useContext(GeneralPurchaseContext);
  if (!ctx) throw new Error('useGeneralPurchase must be used within GeneralPurchaseProvider');
  return ctx;
};
