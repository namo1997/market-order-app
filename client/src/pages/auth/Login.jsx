import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authAPI } from '../../api/auth';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';

const getBranchCode = (branch) => String(branch?.code || '').toUpperCase();
const STORE_PIN = '1997';

const isStoreBranch = (branch) => {
  const code = getBranchCode(branch);
  const name = String(branch?.name || '');
  return code === 'BR001' || name.includes('สโตร์');
};

const isLocalRuntime = () => {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
};

const getBranchMeta = (branch) => {
  const code = getBranchCode(branch);
  if (code === 'KK') return { icon: '🛒', type: 'หน้าร้าน', codeLabel: 'KK' };
  if (code === 'SK') return { icon: '🧺', type: 'หน้าร้าน', codeLabel: 'SK' };
  if (code === 'PRODUCT1') return { icon: '🍳', type: 'ครัวกลาง', codeLabel: 'PRD-KK' };
  if (code === 'PRODUCT2') return { icon: '🥘', type: 'ครัวกลาง', codeLabel: 'PRD-SK' };
  if (code === 'BR001') return { icon: '📦', type: 'สโตร์', codeLabel: 'STORE' };
  if (code === 'CENTRAL') return { icon: '🏢', type: 'ส่วนกลาง', codeLabel: 'ADMIN' };
  return { icon: '📍', type: 'สาขา', codeLabel: code || '-' };
};

export const Login = () => {
  const navigate = useNavigate();
  const { user, login, loginSuperAdmin, isAdmin } = useAuth();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1: สาขา
  const [branches, setBranches] = useState([]);

  // Step 2: แผนก
  const [departments, setDepartments] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null);

  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [storePinModalOpen, setStorePinModalOpen] = useState(false);
  const [storePinValue, setStorePinValue] = useState('');
  const [storePinError, setStorePinError] = useState('');
  const [pendingStoreBranch, setPendingStoreBranch] = useState(null);
  const bypassStorePin = !import.meta.env.PROD || isLocalRuntime();
  const showSyncButton = !import.meta.env.PROD;
  const storefrontBranches = branches.filter((branch) => {
    const code = getBranchCode(branch);
    return code === 'KK' || code === 'SK';
  });
  const kitchenBranches = branches.filter((branch) => {
    const code = getBranchCode(branch);
    return code === 'PRODUCT1' || code === 'PRODUCT2';
  });
  const storeBranch =
    branches.find((branch) => getBranchCode(branch) === 'BR001') ||
    branches.find((branch) => branch.name === 'สโตร์');
  const centralBranch =
    branches.find((branch) => getBranchCode(branch) === 'CENTRAL') ||
    branches.find((branch) => branch.name === 'สาขาส่วนกลาง');

  // ถ้า login แล้ว redirect ไปหน้าที่เหมาะสม
  useEffect(() => {
    if (user) {
      navigate(isAdmin ? '/admin/orders' : '/');
    }
  }, [user, navigate, isAdmin]);

  // โหลดรายการสาขา
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        setLoading(true);
        const response = await authAPI.getBranches();
        setBranches(response.data);
      } catch (err) {
        setError('ไม่สามารถโหลดรายการสาขาได้');
      } finally {
        setLoading(false);
      }
    };

    fetchBranches();
  }, []);

  // เมื่อเลือกสาขา
  const handleBranchSelect = async (branch) => {
    try {
      setLoading(true);
      setError('');
      setSelectedBranch(branch);
      setSelectedDepartment(null);
      const response = await authAPI.getDepartments(branch.id);
      setDepartments(response.data);
      setStep(2);
    } catch (err) {
      setError('ไม่สามารถโหลดรายการแผนกได้');
    } finally {
      setLoading(false);
    }
  };

  // เมื่อเลือกแผนก
  const handleDepartmentSelect = async (dept) => {
    try {
      setLoading(true);
      setError('');
      setSelectedDepartment(dept);
      const result = await login(dept.id);

      if (!result.success) {
        setError(result.message || 'เข้าสู่ระบบไม่สำเร็จ');
      }
    } catch (err) {
      setError('เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  // ย้อนกลับ
  const handleBack = () => {
    if (step === 2) {
      setStep(1);
      setDepartments([]);
      setSelectedBranch(null);
      setSelectedDepartment(null);
    }
  };

  const closeStorePinModal = () => {
    if (loading) return;
    setStorePinModalOpen(false);
    setStorePinValue('');
    setStorePinError('');
    setPendingStoreBranch(null);
  };

  const handleBranchCardClick = async (branch) => {
    if (!isStoreBranch(branch) || bypassStorePin) {
      await handleBranchSelect(branch);
      return;
    }
    setPendingStoreBranch(branch);
    setStorePinValue('');
    setStorePinError('');
    setStorePinModalOpen(true);
  };

  const handleStorePinSubmit = async () => {
    if (String(storePinValue || '').trim() !== STORE_PIN) {
      setStorePinError('PIN ไม่ถูกต้อง');
      return;
    }
    const targetBranch = pendingStoreBranch;
    setStorePinModalOpen(false);
    setStorePinValue('');
    setStorePinError('');
    setPendingStoreBranch(null);
    if (targetBranch) {
      await handleBranchSelect(targetBranch);
    }
  };

  const handleSuperAdminLogin = async () => {
    try {
      setLoading(true);
      setError('');
      const result = await loginSuperAdmin('1997'); // Auto login without PIN
      if (!result.success) {
        setError(result.message || 'เข้าสู่ระบบไม่สำเร็จ');
        return;
      }
    } catch (err) {
      setError('เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncRailway = async () => {
    let progressTimer = null;
    try {
      setSyncLoading(true);
      setSyncError('');
      setSyncProgress(5);
      setSyncStatus('กำลังซิงค์ข้อมูลจาก Railway โปรดรอสักครู่...');
      progressTimer = setInterval(() => {
        setSyncProgress((prev) => {
          if (prev >= 95) return 95;
          return prev + 5;
        });
      }, 350);
      const result = await authAPI.syncRailwayDatabase();
      if (!result.success) {
        setSyncStatus('');
        setSyncError(result.message || 'ซิงค์ข้อมูลไม่สำเร็จ');
        setSyncProgress(0);
        return;
      }
      setSyncProgress(100);
      setSyncStatus('ซิงค์ข้อมูลเรียบร้อยแล้ว');
      await new Promise((resolve) => setTimeout(resolve, 500));
      alert('ซิงค์ข้อมูลเสร็จแล้ว');
      await new Promise((resolve) => setTimeout(resolve, 250));
      setSyncModalOpen(false);
      setSyncStatus('');
      setSyncProgress(0);
    } catch (error) {
      setSyncStatus('');
      setSyncProgress(0);
      setSyncError('ซิงค์ข้อมูลไม่สำเร็จ');
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      setSyncLoading(false);
    }
  };

  if (loading && branches.length === 0) {
    return <Loading fullScreen />;
  }

  const renderBranchCard = (branch, tone = 'primary') => {
    const meta = getBranchMeta(branch);

    // Tone-based styling with clearer visual hierarchy
    const toneStyles = {
      primary: 'bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:shadow-md hover:text-blue-600',
      kitchen: 'bg-white border-slate-200 text-slate-600 hover:border-emerald-400 hover:shadow-md hover:text-emerald-600',
      store: 'bg-white border-slate-200 text-slate-600 hover:border-cyan-400 hover:shadow-md hover:text-cyan-600',
      central: 'bg-white border-slate-200 text-slate-600 hover:border-orange-400 hover:shadow-md hover:text-orange-600',
      danger: 'bg-white border-slate-200 text-slate-600 hover:border-rose-400 hover:shadow-md hover:text-rose-600',
    };

    const activeClass = toneStyles[tone] || toneStyles.primary;

    return (
      <button
        key={branch.id}
        onClick={() => handleBranchCardClick(branch)}
        className={`group relative flex items-center gap-3 p-3 w-full rounded-xl border-2 transition-all duration-200 ease-in-out ${activeClass}`}
      >
        <span className="text-2xl shrink-0 transition-transform group-hover:scale-110 duration-200">
          {meta.icon}
        </span>
        <div className="text-left min-w-0">
          <span className="text-sm font-bold leading-tight line-clamp-1 block">
            {branch.name}
          </span>
          <span className="text-[10px] font-semibold text-slate-400">
            {meta.codeLabel}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center p-3 sm:p-6 font-sarabun">

      {/* Main Container */}
      <div className="w-full max-w-md mx-auto">

        {/* Header Logo/Title */}
        <div className="text-center mb-4 animate-fade-in">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            โซลาว
          </h1>
        </div>

        {/* Card Content */}
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden animate-fade-slide-up">

          {/* Progress / Navigation Header */}
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-white">
            {step === 1 ? (
              <span className="text-xs font-semibold text-slate-400">เลือกสาขา</span>
            ) : (
              <button
                onClick={handleBack}
                className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors -ml-1 px-1.5 py-0.5 rounded-lg hover:bg-blue-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
                </svg>
                ย้อนกลับ
              </button>
            )}

            <div className="flex gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${step >= 1 ? 'bg-blue-600' : 'bg-slate-200'}`} />
              <div className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${step >= 2 ? 'bg-blue-600' : 'bg-slate-200'}`} />
            </div>
          </div>

          <div className="p-4">
            {error && (
              <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-100 flex items-start gap-2">
                <span className="text-red-500 text-xs">⚠️</span>
                <p className="text-xs text-red-600 font-medium">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-400 gap-2">
                <Loading />
                <span className="text-xs animate-pulse">กำลังโหลดข้อมูล...</span>
              </div>
            ) : (
              <>
                {/* Step 1: Branch Selection */}
                {step === 1 && (
                  <div className="space-y-4 animate-fade-in">
                    {/* Storefront Section */}
                    <div className="space-y-1.5">
                      <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">
                        สาขาหน้าร้าน
                      </h2>
                      <div className="grid grid-cols-2 gap-2">
                        {storefrontBranches.map((branch) => renderBranchCard(branch, 'primary'))}
                      </div>
                    </div>

                    {/* Kitchen Section */}
                    {kitchenBranches.length > 0 && (
                      <div className="space-y-1.5">
                        <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">
                          ครัวกลาง
                        </h2>
                        <div className="grid grid-cols-2 gap-2">
                          {kitchenBranches.map((branch) => renderBranchCard(branch, 'kitchen'))}
                        </div>
                      </div>
                    )}

                    {/* Other Systems */}
                    <div className="pt-3 border-t border-slate-100 space-y-1.5">
                      <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">
                        ระบบอื่นๆ
                      </h2>
                      <div className="grid grid-cols-2 gap-2">
                        {storeBranch && renderBranchCard(storeBranch, 'store')}
                        {centralBranch && renderBranchCard(centralBranch, 'central')}

                        {/* Super Admin Button */}
                        <button
                          onClick={handleSuperAdminLogin}
                          className="group relative flex items-center gap-3 p-3 w-full rounded-xl border-2 border-slate-200 bg-white hover:border-rose-400 hover:shadow-md transition-all duration-200"
                        >
                          <span className="text-2xl shrink-0 group-hover:scale-110 transition-transform duration-200">🔐</span>
                          <span className="text-sm font-bold text-slate-600 group-hover:text-rose-600">Super Admin</span>
                        </button>

                        {/* Sync Button */}
                        {showSyncButton && (
                          <button
                            onClick={() => setSyncModalOpen(true)}
                            className="group relative flex items-center gap-3 p-3 w-full rounded-xl border-2 border-slate-200 bg-white hover:border-indigo-400 hover:shadow-md transition-all duration-200"
                          >
                            <span className="text-2xl shrink-0 group-hover:scale-110 transition-transform duration-200">🔄</span>
                            <span className="text-sm font-bold text-slate-600 group-hover:text-indigo-600">Sync Data</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Department Selection */}
                {step === 2 && (
                  <div className="space-y-3 animate-fade-in">
                    <div className="text-center mb-2">
                      <h2 className="text-base font-bold text-slate-800">
                        {selectedBranch?.name}
                      </h2>
                      <p className="text-xs text-slate-500">เลือกแผนกเพื่อเข้าสู่ระบบ</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {departments.map((dept) => (
                        <button
                          key={dept.id}
                          onClick={() => handleDepartmentSelect(dept)}
                          className="group flex items-center gap-2.5 p-3 w-full rounded-xl border-2 border-slate-200 bg-white hover:border-blue-500 hover:shadow-md hover:bg-blue-50/30 transition-all duration-200"
                        >
                          <span className="text-xl shrink-0 group-hover:scale-110 transition-transform duration-200">
                            👤
                          </span>
                          <span className="text-sm font-bold text-slate-600 group-hover:text-blue-700 leading-tight text-left">
                            {dept.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-3 text-center">
          <p className="text-[10px] text-slate-300">
            © 2024 Market Order System
          </p>
        </div>
      </div>

      <Modal
        isOpen={syncModalOpen}
        onClose={() => {
          if (syncLoading) return;
          setSyncModalOpen(false);
          setSyncError('');
          setSyncStatus('');
          setSyncProgress(0);
        }}
        title="ซิงค์ข้อมูลจาก Railway"
        size="small"
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-700">
            ต้องการซิงค์ข้อมูลจาก Railway และทับข้อมูลในเครื่องใช่ไหม?
          </div>
          {syncError && (
            <div className="text-sm text-red-600">{syncError}</div>
          )}
          {syncStatus && (
            <div
              className={`text-sm rounded-md px-3 py-2 border ${syncLoading
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-green-50 text-green-700 border-green-200'
                }`}
            >
              <span className="inline-flex items-center gap-2 mb-2">
                {syncLoading && (
                  <span className="h-3 w-3 rounded-full border-2 border-blue-300 border-t-blue-600 animate-spin" />
                )}
                {syncStatus} ({syncProgress}%)
              </span>
              <div className="h-2 w-full rounded-full bg-white/70 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${syncLoading ? 'bg-blue-500' : 'bg-green-500'
                    }`}
                  style={{ width: `${syncProgress}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={syncLoading}
              onClick={() => {
                setSyncModalOpen(false);
                setSyncError('');
                setSyncStatus('');
                setSyncProgress(0);
              }}
            >
              ยกเลิก
            </Button>
            <Button onClick={handleSyncRailway} disabled={syncLoading}>
              {syncLoading ? 'กำลังซิงค์...' : 'ทำต่อ'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={storePinModalOpen}
        onClose={closeStorePinModal}
        title="กรอก PIN เข้าสโตร์"
        size="small"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleStorePinSubmit();
          }}
        >
          <Input
            type="password"
            value={storePinValue}
            onChange={(e) => {
              setStorePinValue(e.target.value);
              if (storePinError) setStorePinError('');
            }}
            placeholder="กรอก PIN"
          />
          {storePinError && (
            <div className="text-sm text-red-600">{storePinError}</div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={closeStorePinModal}
              disabled={loading}
            >
              ยกเลิก
            </Button>
            <Button type="submit" disabled={loading}>
              ยืนยัน
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
