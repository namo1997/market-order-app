import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authAPI } from '../../api/auth';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';

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
  const [superAdminModalOpen, setSuperAdminModalOpen] = useState(false);
  const [superAdminPin, setSuperAdminPin] = useState('');
  const [superAdminError, setSuperAdminError] = useState('');
  const [superAdminLoading, setSuperAdminLoading] = useState(false);

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
      console.log('🏢 Department selected:', dept);
      setLoading(true);
      setError('');
      setSelectedDepartment(dept);
      console.log('🏢 Calling login with dept.id:', dept.id);
      const result = await login(dept.id);
      console.log('🏢 Login result:', result);

      if (!result.success) {
        console.error('🏢 Login failed:', result.message);
        setError(result.message || 'เข้าสู่ระบบไม่สำเร็จ');
      }
    } catch (err) {
      console.error('🏢 Login error:', err);
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
    }
  };

  const handleSuperAdminLogin = async () => {
    if (!superAdminPin.trim()) {
      setSuperAdminError('กรุณาใส่ PIN');
      return;
    }
    try {
      setSuperAdminLoading(true);
      setSuperAdminError('');
      const result = await loginSuperAdmin(superAdminPin.trim());
      if (!result.success) {
        setSuperAdminError(result.message || 'เข้าสู่ระบบไม่สำเร็จ');
        return;
      }
      setSuperAdminModalOpen(false);
      setSuperAdminPin('');
    } finally {
      setSuperAdminLoading(false);
    }
  };

  if (loading && branches.length === 0) {
    return <Loading fullScreen />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm p-4 text-center sticky top-0 z-10">
        <h1 className="text-xl font-bold text-gray-800">ระบบสั่งซื้อสินค้า</h1>
        {step > 1 && (
          <div className="text-sm text-gray-500 mt-1 flex items-center justify-center space-x-2">
            {selectedBranch && <span>{selectedBranch.name}</span>}
            {selectedDepartment && (
              <>
                <span>&gt;</span>
                <span>{selectedDepartment.name}</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 p-4 max-w-4xl mx-auto w-full">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {/* Step 1: สาขา */}
        {step === 1 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-700 mb-4 text-center">เลือกสาขา</h2>
            {loading ? (
              <Loading />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {branches.map((branch) => (
                  <Card
                    key={branch.id}
                    onClick={() => handleBranchSelect(branch)}
                    className="hover:bg-blue-50 border-2 border-transparent hover:border-blue-200 min-h-[100px] flex items-center justify-center text-center"
                  >
                    <span className="text-lg font-medium text-gray-800">{branch.name}</span>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: แผนก */}
        {step === 2 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-700">เลือกแผนก</h2>
              <Button onClick={handleBack} variant="secondary" size="sm">ย้อนกลับ</Button>
            </div>

            {loading ? (
              <Loading />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {departments.map((dept) => (
                  <Card
                    key={dept.id}
                    onClick={() => handleDepartmentSelect(dept)}
                    className="hover:bg-green-50 border-2 border-transparent hover:border-green-200 min-h-[100px] flex items-center justify-center text-center"
                  >
                    <span className="text-lg font-medium text-gray-800">{dept.name}</span>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex justify-center">
          <Button variant="danger" onClick={() => setSuperAdminModalOpen(true)}>
            Supper Admin
          </Button>
        </div>
      </div>

      <Modal
        isOpen={superAdminModalOpen}
        onClose={() => {
          setSuperAdminModalOpen(false);
          setSuperAdminError('');
        }}
        title="เข้าสู่ระบบ Supper Admin"
        size="small"
      >
        <div className="space-y-4">
          <Input
            type="password"
            value={superAdminPin}
            onChange={(e) => setSuperAdminPin(e.target.value)}
            placeholder="กรอก PIN"
          />
          {superAdminError && (
            <div className="text-sm text-red-600">{superAdminError}</div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setSuperAdminModalOpen(false);
                setSuperAdminError('');
              }}
            >
              ยกเลิก
            </Button>
            <Button onClick={handleSuperAdminLogin} disabled={superAdminLoading}>
              {superAdminLoading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
