import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Select } from '../../components/common/Select';
import { BackToSettings } from '../../components/common/BackToSettings';
import { adminAPI } from '../../api/admin';

const REPORT_TABS = [
  { key: 'stock_check', label: 'เช็คสินค้าคงเหลือ', description: 'ดูการเช็คสต็อกล่าสุดรายแผนก' },
  { key: 'receiving', label: 'การรับสินค้า', description: 'ดูการรับสินค้าล่าสุดรายแผนก' },
  { key: 'production_transform', label: 'การแปรรูปสินค้า', description: 'เฉพาะแผนกฝ่ายผลิต' }
];

const formatDateTime = (value) => {
  if (!value) return 'ยังไม่มีข้อมูล';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ยังไม่มีข้อมูล';
  return date.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatQuantity = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
};

const getDateKeyTH = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
};

const getDayDiff = (fromDateKey, toDateKey) => {
  if (!fromDateKey || !toDateKey) return Number.POSITIVE_INFINITY;
  const from = new Date(`${fromDateKey}T00:00:00Z`);
  const to = new Date(`${toDateKey}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(Math.floor((to.getTime() - from.getTime()) / 86400000), 0);
};

export const AdminReports = () => {
  const [activeType, setActiveType] = useState(REPORT_TABS[0].key);
  const [summaryRows, setSummaryRows] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [showOnlyNoMovementToday, setShowOnlyNoMovementToday] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [detailRows, setDetailRows] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const activeTab = useMemo(
    () => REPORT_TABS.find((tab) => tab.key === activeType) || REPORT_TABS[0],
    [activeType]
  );

  const loadSummary = async (type) => {
    try {
      setSummaryLoading(true);
      setSummaryError('');
      const response = await adminAPI.getDepartmentActivitySummary(type);
      const rows = Array.isArray(response?.data) ? response.data : [];
      setSummaryRows(rows);
      setSelectedDepartment(null);
      setDetailRows([]);
    } catch (error) {
      setSummaryRows([]);
      setSelectedDepartment(null);
      setDetailRows([]);
      setSummaryError(error?.response?.data?.message || 'ไม่สามารถโหลดรายงานได้');
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadDetail = async (type, departmentId) => {
    if (!departmentId) {
      setDetailRows([]);
      return;
    }
    try {
      setDetailLoading(true);
      setDetailError('');
      const response = await adminAPI.getDepartmentActivityDetail(type, departmentId, 120);
      setDetailRows(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      setDetailRows([]);
      setDetailError(error?.response?.data?.message || 'ไม่สามารถโหลดรายละเอียดได้');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    setSelectedBranchId('');
    setSelectedDepartment(null);
    setDetailRows([]);
    loadSummary(activeType);
  }, [activeType]);

  const branchOptions = useMemo(() => {
    const map = new Map();
    summaryRows.forEach((row) => {
      if (row?.branch_id === null || row?.branch_id === undefined) return;
      const value = String(row.branch_id);
      if (!map.has(value)) {
        map.set(value, {
          value,
          label: row.branch_name || `สาขา ${row.branch_id}`
        });
      }
    });
    return Array.from(map.values());
  }, [summaryRows]);

  const filteredSummaryRows = useMemo(() => {
    if (!selectedBranchId) return [];
    return summaryRows.filter((row) => String(row.branch_id) === String(selectedBranchId));
  }, [summaryRows, selectedBranchId]);

  const todayKey = useMemo(
    () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }),
    []
  );

  const monitoredRows = useMemo(() => {
    const rows = filteredSummaryRows.map((row) => {
      const latestKey = getDateKeyTH(row.latest_activity_at);
      const dayDiff = getDayDiff(latestKey, todayKey);
      const movedToday = dayDiff === 0;
      const requiresAlert =
        activeType === 'stock_check'
          ? dayDiff > 1
          : dayDiff > 0;
      return {
        ...row,
        movedToday,
        dayDiff,
        requiresAlert
      };
    });

    const sorted = rows.sort((a, b) => {
      if (a.requiresAlert !== b.requiresAlert) return a.requiresAlert ? -1 : 1;
      return String(a.department_name || '').localeCompare(String(b.department_name || ''), 'th');
    });

    if (showOnlyNoMovementToday) {
      return sorted.filter((row) => row.requiresAlert);
    }
    return sorted;
  }, [filteredSummaryRows, showOnlyNoMovementToday, todayKey, activeType]);

  const movementStats = useMemo(() => {
    const total = filteredSummaryRows.length;
    const alertCount = filteredSummaryRows.filter((row) => {
      const latestKey = getDateKeyTH(row.latest_activity_at);
      const dayDiff = getDayDiff(latestKey, todayKey);
      return activeType === 'stock_check' ? dayDiff > 1 : dayDiff > 0;
    }).length;
    return {
      total,
      okCount: Math.max(total - alertCount, 0),
      alertCount
    };
  }, [filteredSummaryRows, todayKey, activeType]);

  useEffect(() => {
    if (!selectedBranchId) {
      setSelectedDepartment(null);
      setDetailRows([]);
      return;
    }
    if (filteredSummaryRows.length === 0) {
      setSelectedDepartment(null);
      setDetailRows([]);
      return;
    }
    const hasSelected = filteredSummaryRows.some(
      (row) => Number(row.department_id) === Number(selectedDepartment?.department_id)
    );
    if (!hasSelected) {
      setSelectedDepartment(filteredSummaryRows[0]);
    }
  }, [selectedBranchId, filteredSummaryRows, selectedDepartment?.department_id]);

  useEffect(() => {
    if (!selectedDepartment?.department_id) return;
    const hasSelected = monitoredRows.some(
      (row) => Number(row.department_id) === Number(selectedDepartment.department_id)
    );
    if (!hasSelected) {
      setSelectedDepartment(monitoredRows[0] || null);
    }
  }, [monitoredRows, selectedDepartment]);

  useEffect(() => {
    if (!selectedDepartment?.department_id) return;
    loadDetail(activeType, selectedDepartment.department_id);
  }, [activeType, selectedDepartment?.department_id]);

  const handleCopyReminderList = async () => {
    const rows = filteredSummaryRows.filter((row) => {
      const latestKey = getDateKeyTH(row.latest_activity_at);
      const dayDiff = getDayDiff(latestKey, todayKey);
      return activeType === 'stock_check' ? dayDiff > 1 : dayDiff > 0;
    });
    if (rows.length === 0) {
      alert('ไม่มีแผนกที่ต้องแจ้งเตือน');
      return;
    }

    const messageHeader =
      activeType === 'stock_check'
        ? `แผนกที่เช็คสต็อกเกิน 1 วัน (${rows.length} แผนก)`
        : `แผนกที่ยังไม่มีการเคลื่อนไหววันนี้ (${rows.length} แผนก)`;
    const messageLines = rows.map((row, index) => {
      const latest = formatDateTime(row.latest_activity_at);
      return `${index + 1}. ${row.department_name} (${row.branch_name}) - ล่าสุด: ${latest}`;
    });
    const message = `${messageHeader}\n${messageLines.join('\n')}`;

    try {
      await navigator.clipboard.writeText(message);
      alert('คัดลอกรายชื่อแผนกที่ยังไม่เคลื่อนไหวแล้ว');
    } catch (error) {
      alert('คัดลอกไม่สำเร็จ');
    }
  };

  const renderDetailRow = (row) => {
    if (activeType === 'stock_check') {
      return (
        <div key={`sc-${row.id}`} className="border-b border-gray-100 py-2 last:border-b-0">
          <div className="text-xs text-gray-500">{formatDateTime(row.activity_at)}</div>
          <div className="text-sm font-medium text-gray-900">
            {row.product_name || '-'}
            {row.unit_abbr ? ` (${row.unit_abbr})` : ''}
          </div>
          <div className="text-xs text-gray-600">
            เช็ค {formatQuantity(row.stock_quantity)} • วันที่เช็ค {row.check_date || '-'} • โดย {row.actor_name || '-'}
          </div>
        </div>
      );
    }

    if (activeType === 'receiving') {
      return (
        <div key={`rc-${row.id}`} className="border-b border-gray-100 py-2 last:border-b-0">
          <div className="text-xs text-gray-500">{formatDateTime(row.activity_at)}</div>
          <div className="text-sm font-medium text-gray-900">
            {row.product_name || '-'}
            {row.unit_abbr ? ` (${row.unit_abbr})` : ''}
          </div>
          <div className="text-xs text-gray-600">
            รับจริง {formatQuantity(row.received_quantity)} จากออเดอร์ {row.order_number || '-'} • โดย {row.actor_name || '-'}
          </div>
          {row.receive_notes && (
            <div className="text-xs text-gray-500 mt-1">{row.receive_notes}</div>
          )}
        </div>
      );
    }

    return (
      <div key={`pt-${row.id}`} className="border-b border-gray-100 py-2 last:border-b-0">
        <div className="text-xs text-gray-500">{formatDateTime(row.activity_at)}</div>
        <div className="text-sm font-medium text-gray-900">
          {row.product_name || '-'}
          {row.unit_abbr ? ` (${row.unit_abbr})` : ''}
        </div>
        <div className="text-xs text-gray-600">
          แปรรูป {formatQuantity(row.quantity)} • เลขอ้างอิง {row.reference_id || '-'} • โดย {row.actor_name || '-'}
        </div>
        {row.notes && <div className="text-xs text-gray-500 mt-1">{row.notes}</div>}
      </div>
    );
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">รายงานเฉพาะ</h1>
          <BackToSettings />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {REPORT_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveType(tab.key)}
                className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                  activeType === tab.key
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="text-sm font-semibold">{tab.label}</div>
                <div className="text-xs opacity-80 mt-0.5">{tab.description}</div>
              </button>
            ))}
          </div>
          <Select
            label="เลือกสาขา"
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            options={branchOptions}
            placeholder="กรุณาเลือกสาขาก่อน"
          />
          {selectedBranchId && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs rounded-full bg-gray-100 px-3 py-1 text-gray-700">
                ทั้งหมด {movementStats.total} แผนก
              </span>
              <span className="text-xs rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                ปกติ {movementStats.okCount} แผนก
              </span>
              <span className="text-xs rounded-full bg-rose-100 px-3 py-1 text-rose-700">
                ต้องแจ้งเตือน {movementStats.alertCount} แผนก
              </span>
              <button
                type="button"
                className={`text-xs px-3 py-1 rounded-full border ${
                  showOnlyNoMovementToday
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-white border-gray-200 text-gray-600'
                }`}
                onClick={() => setShowOnlyNoMovementToday((prev) => !prev)}
              >
                {showOnlyNoMovementToday ? 'แสดงทั้งหมด' : 'ดูเฉพาะที่ต้องแจ้งเตือน'}
              </button>
              <button
                type="button"
                className="text-xs px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700"
                onClick={handleCopyReminderList}
              >
                คัดลอกรายชื่อเพื่อแจ้งเตือน
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">รายการแผนก</h2>
                <span className="text-xs text-gray-500">
                  {selectedBranchId ? `${filteredSummaryRows.length} แผนก` : 'รอเลือกสาขา'}
                </span>
              </div>

              {summaryLoading && <div className="text-sm text-gray-500">กำลังโหลดข้อมูล...</div>}
              {summaryError && <div className="text-sm text-red-600">{summaryError}</div>}
              {!summaryLoading && !summaryError && !selectedBranchId && (
                <div className="text-sm text-gray-500">กรุณาเลือกสาขาก่อน</div>
              )}

              {!summaryLoading && !summaryError && selectedBranchId && filteredSummaryRows.length === 0 && (
                <div className="text-sm text-gray-500">ยังไม่มีข้อมูลในหมวดนี้</div>
              )}

              <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-1">
                {monitoredRows.map((row) => {
                  const isSelected = selectedDepartment?.department_id === row.department_id;
                  return (
                    <button
                      key={`dept-${row.department_id}`}
                      type="button"
                      onClick={() => setSelectedDepartment(row)}
                      className={`w-full text-left border rounded-lg p-3 transition-colors ${
                        isSelected
                          ? 'border-blue-200 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900">
                        {row.department_name}
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                        <span>{row.branch_name}</span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 ${
                            row.requiresAlert
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {activeType === 'stock_check'
                            ? row.requiresAlert
                              ? 'เกิน 1 วัน'
                              : row.dayDiff === 1
                                ? 'ล่าสุดเมื่อวาน'
                                : 'เช็ควันนี้'
                            : row.requiresAlert
                              ? 'ยังไม่เคลื่อนไหววันนี้'
                              : 'เคลื่อนไหววันนี้'}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 ${
                            row.movedToday
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          ล่าสุดห่าง {Number.isFinite(row.dayDiff) ? row.dayDiff : '-'} วัน
                        </span>
                      </div>
                      <div className="text-xs text-gray-700 mt-2">
                        เคลื่อนไหวล่าสุด: {formatDateTime(row.latest_activity_at)}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        จำนวนรายการ: {formatQuantity(row.total_records)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card>
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedDepartment?.department_name || 'เลือกรายการแผนก'}
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  {!selectedBranchId
                    ? 'กรุณาเลือกสาขาก่อน'
                    : selectedDepartment
                    ? `เคลื่อนไหวล่าสุด: ${formatDateTime(selectedDepartment.latest_activity_at)}`
                    : 'เลือกแผนกทางซ้ายเพื่อดูรายละเอียด'}
                </p>
              </div>

              {detailLoading && <div className="text-sm text-gray-500">กำลังโหลดรายละเอียด...</div>}
              {detailError && <div className="text-sm text-red-600">{detailError}</div>}

              {!detailLoading && !detailError && selectedDepartment && detailRows.length === 0 && (
                <div className="text-sm text-gray-500">ยังไม่มีประวัติการเคลื่อนไหว</div>
              )}

              <div className="max-h-[62vh] overflow-y-auto pr-1">
                {detailRows.map((row) => renderDetailRow(row))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Layout>
  );
};
