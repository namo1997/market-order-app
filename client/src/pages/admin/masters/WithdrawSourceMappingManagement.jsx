import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { withdrawAPI } from '../../../api/withdraw';

export const WithdrawSourceMappingManagement = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState([]);
  const [sourceDepartments, setSourceDepartments] = useState([]);
  const [mappingByBranch, setMappingByBranch] = useState({});

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await withdrawAPI.getSourceMappings();
      const payload = response?.data ?? {};
      const nextBranches = Array.isArray(payload?.branches) ? payload.branches : [];
      const nextDepartments = Array.isArray(payload?.source_departments)
        ? payload.source_departments
        : [];
      const nextMappings = Array.isArray(payload?.mappings) ? payload.mappings : [];

      const mapped = {};
      nextMappings.forEach((item) => {
        mapped[String(item.target_branch_id)] = item.source_department_id
          ? String(item.source_department_id)
          : '';
      });

      setBranches(nextBranches);
      setSourceDepartments(nextDepartments);
      setMappingByBranch(mapped);
    } catch (error) {
      console.error('Error loading withdraw source mappings:', error);
      alert(error.response?.data?.message || 'ไม่สามารถโหลดผังการเบิกสินค้าได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const sortedSourceDepartments = useMemo(() => {
    const list = [...sourceDepartments];
    list.sort((a, b) => {
      const aStore = String(a.department_name || '').includes('สโตร์') ? 0 : 1;
      const bStore = String(b.department_name || '').includes('สโตร์') ? 0 : 1;
      if (aStore !== bStore) return aStore - bStore;
      const branchCompare = String(a.branch_name || '').localeCompare(String(b.branch_name || ''), 'th');
      if (branchCompare !== 0) return branchCompare;
      return String(a.department_name || '').localeCompare(String(b.department_name || ''), 'th');
    });
    return list;
  }, [sourceDepartments]);

  const handleSelectSource = (branchId, sourceDepartmentId) => {
    setMappingByBranch((prev) => ({
      ...prev,
      [String(branchId)]: sourceDepartmentId
    }));
  };

  const handleSave = async () => {
    const mappings = branches
      .map((branch) => ({
        target_branch_id: Number(branch.id),
        source_department_id: Number(mappingByBranch[String(branch.id)] || 0)
      }))
      .filter(
        (item) =>
          Number.isFinite(item.target_branch_id) &&
          Number.isFinite(item.source_department_id) &&
          item.source_department_id > 0
      );

    try {
      setSaving(true);
      await withdrawAPI.saveSourceMappings(mappings);
      alert('บันทึกผังสาขา -> พื้นที่เก็บต้นทางเรียบร้อย');
      await loadData();
    } catch (error) {
      console.error('Error saving withdraw source mappings:', error);
      alert(error.response?.data?.message || 'บันทึกผังการเบิกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="mb-2">
          <BackToSettings />
        </div>

        <Card className="border border-orange-200 bg-orange-50/60">
          <h1 className="text-2xl font-bold text-gray-900">ผูกสาขากับพื้นที่เก็บสินค้า</h1>
          <p className="text-sm text-gray-600 mt-1">
            กำหนดว่าแต่ละสาขาปลายทาง ต้องเบิกจากพื้นที่เก็บต้นทางไหนเท่านั้น
          </p>
        </Card>

        <Card>
          {loading ? (
            <div className="text-sm text-gray-500 py-8 text-center">กำลังโหลดข้อมูล...</div>
          ) : (
            <div className="space-y-3">
              {branches.map((branch) => (
                <div
                  key={branch.id}
                  className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2 items-center border border-gray-200 rounded-lg p-3"
                >
                  <div>
                    <p className="font-semibold text-gray-900">{branch.name}</p>
                    <p className="text-xs text-gray-500">รหัส: {branch.code || '-'}</p>
                  </div>
                  <div>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      value={mappingByBranch[String(branch.id)] || ''}
                      onChange={(e) => handleSelectSource(branch.id, e.target.value)}
                    >
                      <option value="">ไม่ล็อกต้นทาง (ใช้ fallback เดิม)</option>
                      {sortedSourceDepartments.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.branch_name} / {dept.department_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกผังการเบิก'}
            </button>
          </div>
        </Card>
      </div>
    </Layout>
  );
};
