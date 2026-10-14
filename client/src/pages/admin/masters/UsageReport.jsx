import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Select } from '../../../components/common/Select';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { recipesAPI } from '../../../api/recipes';
import { masterAPI } from '../../../api/master';

export const UsageReport = () => {
  const formatDateInput = (date) => {
    const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return offsetDate.toISOString().split('T')[0];
  };

  const formatNumber = (value, options = {}) =>
    Number(value || 0).toLocaleString('th-TH', options);

  const today = formatDateInput(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [units, setUnits] = useState([]);
  const [report, setReport] = useState(null);
  const [branchReports, setBranchReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedMissing, setSelectedMissing] = useState(null);
  const [selectedUsage, setSelectedUsage] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchBranches();
    fetchUnits();
  }, []);

  const fetchBranches = async () => {
    try {
      const data = await masterAPI.getBranches();
      setBranches(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching branches:', error);
      setBranches([]);
    }
  };

  const fetchUnits = async () => {
    try {
      const data = await masterAPI.getUnits();
      setUnits(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching units:', error);
      setUnits([]);
    }
  };

  const handleLoadReport = async (overrides = {}) => {
    const effectiveStartDate = overrides.startDate ?? startDate;
    const effectiveEndDate = overrides.endDate ?? endDate;
    const effectiveBranchId = overrides.branchId ?? branchId;
    try {
      setLoading(true);
      if (effectiveBranchId) {
        const response = await recipesAPI.getUsageReport({
          start: effectiveStartDate,
          end: effectiveEndDate,
          branchId: effectiveBranchId || undefined
        });
        const data = response?.data ?? response;
        setReport(data);
        setBranchReports([]);
        return;
      }

      const availableBranches = branches.filter((branch) => branch.clickhouse_branch_id);
      const results = await Promise.allSettled(
        availableBranches.map((branch) =>
          recipesAPI.getUsageReport({
            start: effectiveStartDate,
            end: effectiveEndDate,
            branchId: branch.id
          })
        )
      );
      const nextReports = results
        .map((result, index) => {
          if (result.status !== 'fulfilled') {
            return null;
          }
          return {
            branch: availableBranches[index],
            data: result.value?.data ?? result.value
          };
        })
        .filter(Boolean);
      setBranchReports(nextReports);
      setReport(null);
    } catch (error) {
      console.error('Error fetching usage report:', error);
      alert(error.response?.data?.message || 'ไม่สามารถโหลดรายงานได้');
      setReport(null);
      setBranchReports([]);
    } finally {
      setLoading(false);
    }
  };

  const applyQuickRange = (range) => {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);

    if (range === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end = new Date(start);
    } else if (range === 'week') {
      start.setDate(start.getDate() - 6);
    } else if (range === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const nextStart = formatDateInput(start);
    const nextEnd = formatDateInput(end);
    setStartDate(nextStart);
    setEndDate(nextEnd);
    handleLoadReport({ startDate: nextStart, endDate: nextEnd });
  };

  const handleSyncByRecipe = async () => {
    const targetLabel = branchId
      ? branches.find((branch) => String(branch.id) === String(branchId))?.name || 'สาขาที่เลือก'
      : 'ทุกสาขา';
    const confirmed = window.confirm(
      `ยืนยันตัดคลังตามสูตรจากยอดขาย (${targetLabel})\nช่วงวันที่ ${startDate} ถึง ${endDate}`
    );
    if (!confirmed) return;

    try {
      setSyncing(true);
      const response = await recipesAPI.syncUsageToInventory({
        start: startDate,
        end: endDate,
        branchId: branchId || undefined
      });
      const data = response?.data ?? response;
      alert(
        `ตัดตามสูตรเรียบร้อย\n` +
          `วางแผน ${formatNumber(data?.planned_deductions || 0)} รายการ\n` +
          `บันทึกใหม่ ${formatNumber(data?.applied_deductions || 0)} รายการ\n` +
          `ข้ามที่มีอยู่แล้ว ${formatNumber(data?.skipped_existing || 0)} รายการ`
      );
      await handleLoadReport();
    } catch (error) {
      console.error('Error syncing usage to inventory:', error);
      alert(error.response?.data?.message || 'ไม่สามารถตัดคลังตามสูตรได้');
    } finally {
      setSyncing(false);
    }
  };

  const branchOptions = useMemo(
    () =>
      branches.map((branch) => ({
        value: branch.id,
        label: branch.clickhouse_branch_id ? branch.name : `${branch.name} (ไม่มี ClickHouse ID)`
      })),
    [branches]
  );

  const unitMap = useMemo(() => {
    const map = new Map();
    units.forEach((unit) => {
      map.set(unit.id, unit.abbreviation ? `${unit.name} (${unit.abbreviation})` : unit.name);
    });
    return map;
  }, [units]);

  const getUnitLabel = (unitId) => unitMap.get(unitId) || unitId || '-';

  const handleOpenConversion = (item) => {
    navigate('/admin/settings/unit-conversions', {
      state: {
        prefill: {
          from_unit_id: item.from_unit_id,
          to_unit_id: item.to_unit_id,
          multiplier: 1
        },
        context: {
          product_name: item.product_name,
          menu_barcode: item.menu_barcode
        }
      }
    });
  };

  const getTotals = (items = []) => {
    const expectedTotalUsed = items.reduce((sum, item) => sum + Number(item.total_used || 0), 0);
    const actualTotalUsed = items.reduce((sum, item) => sum + Number(item.actual_used || 0), 0);
    return {
      itemCount: items.length,
      expectedTotalUsed,
      actualTotalUsed,
      varianceTotal: actualTotalUsed - expectedTotalUsed
    };
  };

  const usageColumns = [
    {
      header: 'วัตถุดิบ',
      accessor: 'product_name',
      wrap: true,
      render: (row) => (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setSelectedUsage(row)}
            className="text-left font-semibold text-blue-700 hover:text-blue-900 hover:underline"
          >
            {row.product_name}
          </button>
          <p className="text-xs text-gray-500">
            {(row.menu_breakdown || []).length} เมนู
          </p>
        </div>
      )
    },
    {
      header: 'ตามสูตร',
      accessor: 'total_used',
      render: (row) =>
        formatNumber(row.total_used, {
          maximumFractionDigits: 2
        })
    },
    {
      header: 'ตามคลัง',
      accessor: 'actual_used',
      render: (row) =>
        formatNumber(row.actual_used, {
          maximumFractionDigits: 2
        })
    },
    {
      header: 'ส่วนต่าง',
      accessor: 'usage_variance',
      render: (row) => {
        const variance = Number(row.usage_variance || 0);
        const tone =
          variance > 0 ? 'text-emerald-600' : variance < 0 ? 'text-rose-600' : 'text-gray-700';
        return (
          <span className={`font-semibold ${tone}`}>
            {formatNumber(variance, { maximumFractionDigits: 2 })}
          </span>
        );
      }
    },
    { header: 'หน่วย', accessor: 'unit_abbr' }
  ];

  const renderMissingConversions = (data) => (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900">หน่วยที่ยังไม่มีการแปลง</h3>
        <span className="text-xs text-gray-500">
          {formatNumber(data.missing_conversions?.length || 0)} รายการ
        </span>
      </div>
      {(data.missing_conversions || []).length === 0 ? (
        <p className="text-sm text-gray-500">ไม่มีข้อมูลที่ขาดการแปลงหน่วย</p>
      ) : (
        <div className="space-y-2 text-sm">
          {data.missing_conversions.map((item, index) => (
            <div
              key={`${item.product_id}-${index}`}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedMissing(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setSelectedMissing(item);
              }}
              className="border border-amber-100 bg-amber-50/60 rounded-lg px-3 py-2 cursor-pointer hover:border-amber-200"
            >
              <p className="font-medium text-gray-900">{item.product_name}</p>
              <p className="text-xs text-gray-500">
                ต้องแปลงจาก {getUnitLabel(item.from_unit_id)} ไป {getUnitLabel(item.to_unit_id)}
              </p>
              <p className="text-xs text-gray-500">
                ปริมาณที่คำนวณไม่สำเร็จ: {formatNumber(item.quantity, { maximumFractionDigits: 2 })}{' '}
                {item.unit_abbr || ''}
              </p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleOpenConversion(item);
                  }}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  ไปตั้งค่าแปลงหน่วย
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderReportSection = (data, title) => {
    const totals = getTotals(data.items || []);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <div className="text-xs text-gray-500">
            ช่วงวันที่ {startDate} ถึง {endDate}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {[
            {
              label: 'วัตถุดิบทั้งหมด',
              value: formatNumber(totals.itemCount)
            },
            {
              label: 'ตามสูตรรวม',
              value: formatNumber(
                data.summary?.expected_total_used ?? totals.expectedTotalUsed,
                { maximumFractionDigits: 2 }
              )
            },
            {
              label: 'ตามคลังรวม',
              value: formatNumber(
                data.summary?.actual_total_used ?? totals.actualTotalUsed,
                { maximumFractionDigits: 2 }
              )
            },
            {
              label: 'ส่วนต่างรวม',
              value: formatNumber(
                data.summary?.variance_total ?? totals.varianceTotal,
                { maximumFractionDigits: 2 }
              )
            },
            {
              label: 'ขาดการแปลงหน่วย',
              value: formatNumber(data.missing_conversions?.length || 0)
            }
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-gray-200 bg-white px-4 py-3"
            >
              <p className="text-xs font-medium text-gray-500">{card.label}</p>
              <p className="text-lg font-semibold text-gray-900">{card.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">รายการวัตถุดิบที่ใช้</h3>
              <span className="text-xs text-gray-500">
                {formatNumber(totals.itemCount)} รายการ
              </span>
            </div>
            <DataTable
              columns={usageColumns}
              data={data.items || []}
              renderActions={() => <span className="text-xs text-gray-300">-</span>}
            />
          </div>
          <div className="space-y-4">
            {renderMissingConversions(data)}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">ตรรกะเชื่อมคลัง</h3>
              <p className="text-xs text-gray-600 leading-5">
                {data.inventory_logic?.description ||
                  'เทียบผลตามสูตรกับ movement คลังเพื่อดูส่วนต่าง'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-3">
          <BackToSettings />
        </div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">รายงานใช้วัตถุดิบ</h1>
          <p className="text-sm text-gray-500 mt-1">
            คำนวณจากยอดขาย ClickHouse (อ่านอย่างเดียว) + สูตรเมนูที่กำหนดไว้
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">ตัวกรองรายงาน</h2>
              <p className="text-xs text-gray-500">เลือกช่วงวันที่และสาขาเพื่อดูข้อมูล</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncByRecipe}
                disabled={syncing || loading}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {syncing ? 'กำลังตัดตามสูตร...' : 'ตัดตามสูตรเข้าคลัง'}
              </button>
              <button
                onClick={handleLoadReport}
                disabled={loading || syncing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'กำลังโหลด...' : 'โหลดรายงาน'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              label="วันที่เริ่มต้น"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="วันที่สิ้นสุด"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <Select
              label="สาขา"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={branchOptions}
              placeholder="รวมทุกสาขา"
            />
            <div className="flex items-end">
              <div className="w-full rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                รายงานจะอัปเดตตามตัวกรองด้านซ้าย
              </div>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">ทางลัดช่วงเวลา</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'today', label: 'วันนี้' },
                { id: 'yesterday', label: 'เมื่อวาน' },
                { id: 'week', label: 'สัปดาห์นี้' },
                { id: 'month', label: 'เดือนนี้' }
              ].map((shortcut) => (
                <button
                  key={shortcut.id}
                  type="button"
                  onClick={() => applyQuickRange(shortcut.id)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-blue-200 hover:text-blue-700"
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {report && renderReportSection(report, 'สรุปวัตถุดิบที่ใช้')}

        {!report && branchReports.length > 0 && (
          <div className="space-y-8">
            {branchReports.map((entry) => (
              <div key={entry.branch.id} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {entry.branch.name}
                  </h2>
                  <span className="text-xs text-gray-500">
                    {formatNumber(getTotals(entry.data.items || []).itemCount)} รายการ
                  </span>
                </div>
                {renderReportSection(entry.data, `วัตถุดิบที่ใช้ - ${entry.branch.name}`)}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={Boolean(selectedMissing)}
        onClose={() => setSelectedMissing(null)}
        title="รายละเอียดหน่วยที่ยังไม่ได้แปลง"
      >
        {selectedMissing && (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">วัตถุดิบ</p>
              <p className="font-semibold text-gray-900">{selectedMissing.product_name}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-500">จากหน่วย</p>
                <p className="font-medium text-gray-900">{getUnitLabel(selectedMissing.from_unit_id)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">ไปหน่วย</p>
                <p className="font-medium text-gray-900">{getUnitLabel(selectedMissing.to_unit_id)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500">ปริมาณที่คำนวณไม่สำเร็จ</p>
              <p className="font-medium text-gray-900">
                {formatNumber(selectedMissing.quantity, { maximumFractionDigits: 2 })}{' '}
                {selectedMissing.unit_abbr || ''}
              </p>
            </div>
            {selectedMissing.menu_barcode && (
              <div>
                <p className="text-xs text-gray-500">เมนูที่อ้างอิง</p>
                <p className="font-medium text-gray-900">{selectedMissing.menu_barcode}</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedMissing(null)}
                className="px-3 py-2 border rounded-lg hover:bg-gray-50"
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={() => handleOpenConversion(selectedMissing)}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                ไปตั้งค่าแปลงหน่วย
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(selectedUsage)}
        onClose={() => setSelectedUsage(null)}
        title="รายละเอียดการใช้วัตถุดิบ"
        size="large"
      >
        {selectedUsage && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-gray-500">วัตถุดิบ</p>
                <p className="text-lg font-semibold text-gray-900">
                  {selectedUsage.product_name}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">ตามสูตรรวม</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatNumber(selectedUsage.total_used, { maximumFractionDigits: 2 })}{' '}
                  {selectedUsage.unit_abbr || ''}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <p className="text-xs text-gray-500">ตามคลัง</p>
                <p className="text-base font-semibold text-gray-900">
                  {formatNumber(selectedUsage.actual_used, { maximumFractionDigits: 2 })}{' '}
                  {selectedUsage.unit_abbr || ''}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <p className="text-xs text-gray-500">ส่วนต่าง</p>
                <p
                  className={`text-base font-semibold ${
                    Number(selectedUsage.usage_variance || 0) > 0
                      ? 'text-emerald-600'
                      : Number(selectedUsage.usage_variance || 0) < 0
                        ? 'text-rose-600'
                        : 'text-gray-900'
                  }`}
                >
                  {formatNumber(selectedUsage.usage_variance, { maximumFractionDigits: 2 })}{' '}
                  {selectedUsage.unit_abbr || ''}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-xs text-gray-600">
              แสดงเฉพาะเมนูที่คำนวณหน่วยได้สำเร็จ
            </div>

            {(selectedUsage.menu_breakdown || []).length === 0 ? (
              <p className="text-sm text-gray-500">ไม่มีข้อมูลเมนูที่เกี่ยวข้อง</p>
            ) : (
              <div className="space-y-2">
                {[...(selectedUsage.menu_breakdown || [])]
                  .sort((a, b) => Number(b.total_used || 0) - Number(a.total_used || 0))
                  .map((menu) => (
                    <div
                      key={menu.menu_barcode}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{menu.menu_name}</p>
                        <p className="text-xs text-gray-500">{menu.menu_barcode}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">ใช้ไป</p>
                        <p className="font-semibold text-gray-900">
                          {formatNumber(menu.total_used, { maximumFractionDigits: 2 })}{' '}
                          {selectedUsage.unit_abbr || ''}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </Layout>
  );
};
