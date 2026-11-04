/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
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
  const [pagination, setPagination] = useState(null);
  const [aggregateStats, setAggregateStats] = useState(null);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const status = {
    '/general-purchase/review': 'pending_review',
    '/general-purchase/po': 'approved',
    '/general-purchase/awaiting': 'awaiting_receipt',
    '/general-purchase/receive': searchParams.get('status') === 'received' ? 'received' : 'awaiting_receipt'
  }[location.pathname] || '';
  const inWorkspace = location.pathname.startsWith('/general-purchase/');
  const requestVersion = useRef(0);
  const inFlight = useRef(null);
  const details = useRef(new Map());
  const setPage = useCallback((nextPage) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('page', String(nextPage));
      return next;
    });
  }, [setSearchParams]);
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

  const refresh = useCallback(() => {
    const token = sessionStorage.getItem('general_purchase_token');
    if (!inWorkspace || !token) {
      if (!token) setRequests([]);
      return Promise.resolve();
    }
    const key = `${token}:${status}:${page}`;
    if (inFlight.current?.key === key) return inFlight.current.promise;
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    const promise = generalPurchaseAPI.getAll({ summary: true, page, pageSize: 30, status }).then((result) => {
      if (version !== requestVersion.current) return;
      if (result?.pagination && page > Math.max(1, Number(result.pagination.total_pages) || 1)) {
        setPage(Math.max(1, Number(result.pagination.total_pages) || 1));
        return;
      }
      setRequests(Array.isArray(result?.data) ? result.data : []);
      setPagination(result?.pagination || null);
      setAggregateStats(result?.stats?.byStatus || null);
    }).catch((err) => {
      if (version === requestVersion.current) setError(err.response?.data?.message || 'โหลดข้อมูลสั่งซื้อทั่วไปไม่สำเร็จ');
    }).finally(() => {
      if (version === requestVersion.current) setLoading(false);
      if (inFlight.current?.promise === promise) inFlight.current = null;
    });
    inFlight.current = { key, promise };
    return promise;
  }, [inWorkspace, status, page, setPage]);

  useEffect(() => {
    requestVersion.current++;
    inFlight.current = null;
    setRequests([]); setPagination(null); setAggregateStats(null);
    if (!authLoading && inWorkspace) refresh();
    return () => { requestVersion.current++; inFlight.current = null; };
  }, [authLoading, access?.token, refresh, inWorkspace]);

  const loadDetail = useCallback((id) => {
    const key = `${sessionStorage.getItem('general_purchase_token')}:${id}`;
    if (details.current.has(key)) return details.current.get(key);
    const promise = generalPurchaseAPI.getById(id).then((result) => result?.data ?? result).catch((error) => {
      details.current.delete(key);
      throw error;
    }).finally(() => { if (details.current.get(key) === promise) details.current.delete(key); });
    details.current.set(key, promise);
    return promise;
  }, []);

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
    details.current.clear();
    if (result?.data) setRequests((current) => replaceOne(current, result.data));
    await refresh();
  }, [refresh]);

  const rejectRequest = useCallback(async (id, reason) => {
    const result = await generalPurchaseAPI.reject(id, reason);
    details.current.clear();
    if (result?.data) setRequests((current) => replaceOne(current, result.data));
    await refresh();
  }, [refresh]);

  const issuePO = useCallback(async (id, payload) => {
    const result = await generalPurchaseAPI.issuePO(id, payload);
    details.current.clear();
    if (result?.data) setRequests((current) => replaceOne(current, result.data));
    await refresh();
  }, [refresh]);

  const receiveAndPrice = useCallback(async (id, payload) => {
    const result = await generalPurchaseAPI.receive(id, payload);
    details.current.clear();
    if (result?.data) setRequests((current) => replaceOne(current, result.data));
    await refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    if (aggregateStats) return aggregateStats;
    const counts = { pending_review: 0, approved: 0, awaiting_receipt: 0, received: 0, rejected: 0 };
    for (const r of requests) counts[r.status] = (counts[r.status] || 0) + 1;
    return counts;
  }, [requests, aggregateStats]);

  const value = useMemo(
    () => ({
      requests,
      stats,
      pagination,
      setPage,
      loadDetail,
      loading,
      authLoading,
      access,
      canCreate: !!access?.canCreate,
      canApprove: !!access?.canApprove,
      canOperate: access?.user?.mode === 'employee_head' && !access?.readonly,
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
    [requests, stats, pagination, setPage, loadDetail, loading, authLoading, access, error, refresh, loginReadonlyPin, clearAccess, createRequest, approveRequest, rejectRequest, issuePO, receiveAndPrice]
  );

  return <GeneralPurchaseContext.Provider value={value}>{children}</GeneralPurchaseContext.Provider>;
};

export const useGeneralPurchase = () => {
  const ctx = useContext(GeneralPurchaseContext);
  if (!ctx) throw new Error('useGeneralPurchase must be used within GeneralPurchaseProvider');
  return ctx;
};
