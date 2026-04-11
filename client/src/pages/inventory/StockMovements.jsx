import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { inventoryAPI } from '../../api/inventory';
import { masterAPI } from '../../api/master';
import { recipesAPI } from '../../api/recipes';

export const StockMovements = () => {
  const navigate = useNavigate();
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncingSales, setSyncingSales] = useState(false);
  const [deletingSales, setDeletingSales] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);

  const today = new Date().toISOString().split('T')[0];
  const defaultStartDate = (() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return date.toISOString().split('T')[0];
  })();
  const [filters, setFilters] = useState({
    branchId: '',
    departmentId: '',
    transactionType: '',
    search: '',
    startDate: defaultStartDate,
    endDate: today,
    limit: 100
  });
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    fetchMasterData();
    loadMovements();
  }, []);

  useEffect(() => {
    if (filters.branchId) {
      fetchDepartments(filters.branchId);
    } else {
      setDepartments([]);
      setFilters(prev => ({ ...prev, departmentId: '' }));
    }
  }, [filters.branchId]);

  useEffect(() => {
    loadMovements();
  }, [filters]);

  const fetchMasterData = async () => {
    try {
      const branchData = await masterAPI.getBranches();
      setBranches(branchData || []);
    } catch (error) {
      console.error('Error fetching master data:', error);
    }
  };

  const fetchDepartments = async (branchId) => {
    try {
      const data = await masterAPI.getDepartmentsByBranch(branchId);
      setDepartments(data || []);
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const loadMovements = async () => {
    try {
      setLoading(true);
      const data = await inventoryAPI.getMovements(filters);
      setMovements(data || []);
    } catch (error) {
      console.error('Error loading movements:', error);
      alert('ไม่สามารถโหลดข้อมูลได้');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num) => {
    return Number(num || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const parseRecipeSaleBillRef = (referenceId) => {
    const ref = String(referenceId || '');
    const match = ref.match(
      /^recipe-sale-bill:(\d{4}-\d{2}-\d{2}):(\d{14}):branch\d+:dept\d+:product\d+:doc(.+)$/
    );
    if (!match) return null;
    const [, saleDate, dateTime14, docNo] = match;
    return {
      saleDate,
      dateTime14,
      saleDocNo: docNo
    };
  };

  const formatThaiFromDateTime14 = (dateTime14) => {
    if (!/^\d{14}$/.test(String(dateTime14 || ''))) return '-';
    const y = Number(dateTime14.slice(0, 4));
    const m = Number(dateTime14.slice(4, 6));
    const d = Number(dateTime14.slice(6, 8));
    const hh = Number(dateTime14.slice(8, 10));
    const mm = Number(dateTime14.slice(10, 12));
    const ss = Number(dateTime14.slice(12, 14));
    const dt = new Date(y, m - 1, d, hh, mm, ss);
    return dt.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatMovementDateTime = (item) => {
    const referenceType = String(item?.reference_type || '');
    const referenceId = String(item?.reference_id || '');

    if (referenceType === 'recipe_sale') {
      const billRef = parseRecipeSaleBillRef(referenceId);
      if (billRef?.dateTime14) {
        return formatThaiFromDateTime14(billRef.dateTime14);
      }
    }

    if (
      referenceType === 'recipe_sale' &&
      /^recipe-sale:\d{4}-\d{2}-\d{2}:branch\d+:dept\d+:product\d+$/.test(referenceId)
    ) {
      const match = referenceId.match(/^recipe-sale:(\d{4}-\d{2}-\d{2}):/);
      if (match?.[1]) {
        const day = new Date(`${match[1]}T00:00:00`);
        if (!Number.isNaN(day.getTime())) {
          return `${day.toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })} (ยอดขายรวมทั้งวัน)`;
        }
      }
    }

    return formatDateTime(item?.effective_at || item?.created_at);
  };

  const formatReferenceLabel = (item) => {
    const referenceType = String(item?.reference_type || '');
    const referenceId = String(item?.reference_id || '');
    const labelMap = {
      order_receiving: 'รับสินค้า',
      production_transform: 'แปรรูป',
      stock_check: 'เช็คสต็อก',
      withdrawal: 'เบิกสินค้า',
      withdrawal_update: 'แก้ไขใบเบิก',
      recipe_sale: 'ขายจาก POS'
    };
    if (referenceType !== 'recipe_sale') {
      return labelMap[referenceType] || referenceType || '-';
    }

    const billRef = parseRecipeSaleBillRef(referenceId);
    if (billRef?.saleDocNo) {
      return `บิล ${billRef.saleDocNo}`;
    }
    if (/^recipe-sale:\d{4}-\d{2}-\d{2}:branch\d+:dept\d+:product\d+$/.test(referenceId)) {
      return 'สรุปรายวัน (เดิม)';
    }
    return '-';
  };

  const formatReferenceDetail = (item) => {
    const referenceType = String(item?.reference_type || '').trim();
    const referenceId = String(item?.reference_id || '').trim();
    const notes = String(item?.notes || '').trim();
    const transferCounterparty = [item?.counterparty_branch_name, item?.counterparty_department_name]
      .filter(Boolean)
      .join(' / ');

    if (!referenceType && !referenceId) return '-';

    if (referenceType === 'order_receiving') {
      const orderMatch = notes.match(/ORD-\d{8}-\d+/);
      const baseText = orderMatch?.[0]
        ? `จากใบสั่งซื้อ ${orderMatch[0]}`
        : `รับสินค้า (${referenceId || '-'})`;
      if (item?.transaction_type === 'transfer_out' && transferCounterparty) {
        return `${baseText} • โอนไป: ${transferCounterparty}`;
      }
      if (item?.transaction_type === 'transfer_in' && transferCounterparty) {
        return `${baseText} • โอนมาจาก: ${transferCounterparty}`;
      }
      return baseText;
    }

    if (referenceType === 'production_transform') {
      return `บันทึกแปรรูป ${referenceId || '-'}`;
    }

    if (referenceType === 'stock_check') {
      return `ปรับจากเช็คสต็อก ${referenceId || '-'}`;
    }

    if (referenceType === 'withdrawal') {
      return `เบิกสินค้า ${referenceId || '-'}`;
    }

    if (referenceType === 'withdrawal_update') {
      return `แก้ไขใบเบิก ${referenceId || '-'}`;
    }

    if (referenceType === 'recipe_sale') {
      const billRef = parseRecipeSaleBillRef(referenceId);
      if (billRef?.saleDocNo) return `ขายจาก POS • บิล ${billRef.saleDocNo}`;
      return 'ขายจาก POS';
    }

    if (item?.transaction_type === 'transfer_out' && transferCounterparty) {
      return `โอนไป: ${transferCounterparty}`;
    }
    if (item?.transaction_type === 'transfer_in' && transferCounterparty) {
      return `โอนมาจาก: ${transferCounterparty}`;
    }

    return `${referenceType}${referenceId ? ` • ${referenceId}` : ''}`;
  };

  const getTransactionTypeLabel = (type) => {
    const labels = {
      receive: 'รับเข้า',
      sale: 'ขาย',
      adjustment: 'ปรับปรุง',
      transfer_in: 'โอนเข้า',
      transfer_out: 'โอนออก',
      initial: 'ยอดเริ่มต้น'
    };
    return labels[type] || type;
  };

  const getTransactionTypeColor = (type) => {
    const colors = {
      receive: 'bg-green-100 text-green-700',
      sale: 'bg-red-100 text-red-700',
      adjustment: 'bg-blue-100 text-blue-700',
      transfer_in: 'bg-purple-100 text-purple-700',
      transfer_out: 'bg-orange-100 text-orange-700',
      initial: 'bg-gray-100 text-gray-700'
    };
    return colors[type] || 'bg-gray-100 text-gray-700';
  };

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const handlePrintMovements = () => {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1280,height=900');
    if (!printWindow) {
      alert('ไม่สามารถเปิดหน้าพิมพ์ได้ กรุณาอนุญาต pop-up');
      return;
    }

    const branchLabel =
      branches.find((branch) => String(branch.id) === String(filters.branchId))?.name || 'ทั้งหมด';
    const departmentLabel =
      departments.find((dept) => String(dept.id) === String(filters.departmentId))?.name || 'ทั้งหมด';
    const typeLabel = filters.transactionType ? getTransactionTypeLabel(filters.transactionType) : 'ทั้งหมด';

    const rowsHtml = movements
      .map((item, index) => {
        const quantityNumber = Number(item.quantity || 0);
        const quantityText =
          (quantityNumber > 0 ? '+' : '') + `${formatNumber(quantityNumber)} ${item.unit_abbr || ''}`.trim();
        const beforeText = `${formatNumber(item.balance_before)} ${item.unit_abbr || ''}`.trim();
        const afterText = `${formatNumber(item.balance_after)} ${item.unit_abbr || ''}`.trim();

        return `
          <tr>
            <td class="center">${index + 1}</td>
            <td>${escapeHtml(formatMovementDateTime(item))}</td>
            <td>
              <div class="name">${escapeHtml(item.product_name || '-')}</div>
            </td>
            <td>
              <div>${escapeHtml(item.department_name || '-')}</div>
              <div class="sub">${escapeHtml(item.branch_name || '-')}</div>
            </td>
            <td class="center">${escapeHtml(getTransactionTypeLabel(item.transaction_type))}</td>
            <td>
              <div>${escapeHtml(formatReferenceLabel(item))}</div>
              <div class="sub">${escapeHtml(formatReferenceDetail(item))}</div>
            </td>
            <td class="right">${escapeHtml(quantityText)}</td>
            <td class="right">${escapeHtml(beforeText)}</td>
            <td class="right">${escapeHtml(afterText)}</td>
            <td>${escapeHtml(item.created_by_name || '-')}</td>
          </tr>
        `;
      })
      .join('');

    const html = `
      <!doctype html>
      <html lang="th">
        <head>
          <meta charset="utf-8" />
          <title>พิมพ์ประวัติการเคลื่อนไหวสินค้า</title>
          <style>
            @page { size: A4 landscape; margin: 12mm; }
            body { font-family: "Sarabun", "Noto Sans Thai", sans-serif; color: #111827; margin: 0; }
            .header { margin-bottom: 12px; }
            .title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
            .meta { font-size: 12px; color: #4b5563; margin-bottom: 2px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #d1d5db; padding: 6px; vertical-align: top; }
            th { background: #f3f4f6; text-align: left; font-weight: 700; }
            .center { text-align: center; }
            .right { text-align: right; }
            .name { font-weight: 600; }
            .sub { color: #6b7280; font-size: 10px; margin-top: 2px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">ประวัติการเคลื่อนไหวสินค้า</div>
            <div class="meta">ช่วงวันที่: ${escapeHtml(filters.startDate || '-')} ถึง ${escapeHtml(filters.endDate || '-')}</div>
            <div class="meta">สาขา: ${escapeHtml(branchLabel)} | แผนก: ${escapeHtml(departmentLabel)} | ประเภท: ${escapeHtml(typeLabel)}</div>
            <div class="meta">ค้นหา: ${escapeHtml(filters.search || '-')} | จำนวนรายการ: ${movements.length}</div>
            <div class="meta">พิมพ์เมื่อ: ${escapeHtml(new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }))}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th class="center" style="width:42px;">ลำดับ</th>
                <th style="width:120px;">วันเวลา</th>
                <th style="width:220px;">สินค้า</th>
                <th style="width:160px;">แผนก/สาขา</th>
                <th class="center" style="width:90px;">ประเภท</th>
                <th style="width:220px;">อ้างอิง</th>
                <th class="right" style="width:100px;">จำนวน</th>
                <th class="right" style="width:100px;">ยอดก่อน</th>
                <th class="right" style="width:100px;">ยอดหลัง</th>
                <th style="width:110px;">ผู้ทำรายการ</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="10" class="center">ไม่พบข้อมูล</td></tr>'}
            </tbody>
          </table>
          <script>
            window.onload = () => {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handleSyncSalesFromClickHouse = async () => {
    if (!filters.startDate || !filters.endDate) {
      alert('กรุณาเลือกช่วงวันที่ก่อน');
      return;
    }

    try {
      setSyncingSales(true);
      const response = await recipesAPI.syncUsageToInventory({
        start: filters.startDate,
        end: filters.endDate,
        branchId: filters.branchId || undefined
      });
      const data = response?.data ?? response;
      alert(
        `ดึงขายออกจาก ClickHouse เรียบร้อย\n` +
          `บันทึกใหม่ ${formatNumber(data?.applied_deductions || 0)} รายการ\n` +
          `ข้ามที่มีแล้ว ${formatNumber(data?.skipped_existing || 0)} รายการ`
      );
      await loadMovements();
    } catch (error) {
      console.error('Error syncing sales from ClickHouse:', error);
      alert(error.response?.data?.message || 'ไม่สามารถดึงขายออกจาก ClickHouse ได้');
    } finally {
      setSyncingSales(false);
    }
  };

  const handleDeleteSaleMovements = async () => {
    if (!filters.startDate || !filters.endDate) {
      alert('กรุณาเลือกช่วงวันที่ก่อน');
      return;
    }
    setShowDeleteConfirm(false);
    try {
      setDeletingSales(true);
      const result = await inventoryAPI.deleteSaleMovements({
        startDate: filters.startDate,
        endDate: filters.endDate,
        departmentId: filters.departmentId || undefined
      });
      alert(
        `ลบรายการขายออกเรียบร้อย\n` +
        `ลบ ${result.deleted} รายการ\n` +
        `ย้อน balance ${result.affected_keys} สินค้า-แผนก`
      );
      await loadMovements();
    } catch (error) {
      console.error('Error deleting sale movements:', error);
      alert(error.response?.data?.message || 'ลบรายการไม่สำเร็จ');
    } finally {
      setDeletingSales(false);
    }
  };

  const handleApplySearch = () => {
    setFilters((prev) => ({ ...prev, search: String(searchInput || '').trim() }));
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">ประวัติการเคลื่อนไหว</h1>
            <p className="text-sm text-gray-500 mt-1">
              ติดตามการเคลื่อนไหวสต็อกสินค้า
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/inventory')}>
            ← ย้อนกลับ
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ค้นหาสินค้า
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleApplySearch();
                    }
                  }}
                  placeholder="พิมพ์ชื่อหรือรหัสสินค้า"
                  className="flex-1"
                />
                <Button
                  type="button"
                  onClick={handleApplySearch}
                  className="px-3 py-2 text-sm shrink-0"
                >
                  ค้นหา
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                สาขา
              </label>
              <select
                value={filters.branchId}
                onChange={(e) => setFilters(prev => ({ ...prev, branchId: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">ทั้งหมด</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                แผนก
              </label>
              <select
                value={filters.departmentId}
                onChange={(e) => setFilters(prev => ({ ...prev, departmentId: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!filters.branchId}
              >
                <option value="">ทั้งหมด</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ประเภท
              </label>
              <select
                value={filters.transactionType}
                onChange={(e) => setFilters(prev => ({ ...prev, transactionType: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">ทั้งหมด</option>
                <option value="receive">รับเข้า</option>
                <option value="sale">ขาย</option>
                <option value="adjustment">ปรับปรุง</option>
                <option value="transfer_in">โอนเข้า</option>
                <option value="transfer_out">โอนออก</option>
                <option value="initial">ยอดเริ่มต้น</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                วันที่เริ่มต้น
              </label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                วันที่สิ้นสุด
              </label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                จำนวนแสดง
              </label>
              <select
                value={filters.limit}
                onChange={(e) => setFilters(prev => ({ ...prev, limit: Number(e.target.value) }))}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="50">50 รายการ</option>
                <option value="100">100 รายการ</option>
                <option value="200">200 รายการ</option>
                <option value="500">500 รายการ</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Results */}
        <Card>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-gray-900">
              ผลลัพธ์: {movements.length} รายการ
            </h2>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="secondary"
                onClick={handlePrintMovements}
                disabled={loading}
              >
                🖨️ พิมพ์รายการ
              </Button>
              <Button
                onClick={handleSyncSalesFromClickHouse}
                disabled={syncingSales || loading || deletingSales}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {syncingSales ? 'กำลังดึงขายออก...' : 'ดึงขายออกจาก ClickHouse'}
              </Button>
              <Button
                variant="danger"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={syncingSales || loading || deletingSales}
              >
                {deletingSales ? 'กำลังลบ...' : '🗑️ ลบขายออก'}
              </Button>
            </div>
          </div>

          {/* Delete Confirm Dialog */}
          {showDeleteConfirm && (
            <div className="mb-4 border border-red-200 bg-red-50 rounded-lg p-4">
              <p className="font-semibold text-red-700 mb-1">⚠️ ยืนยันการลบ transaction ขายออก</p>
              <p className="text-sm text-red-600 mb-3">
                จะลบรายการ <strong>ประเภทขาย (sale)</strong> ระหว่างวันที่{' '}
                <strong>{filters.startDate}</strong> ถึง <strong>{filters.endDate}</strong>
                {filters.departmentId
                  ? ` เฉพาะแผนก: ${departments.find(d => String(d.id) === String(filters.departmentId))?.name || filters.departmentId}`
                  : ' ทุกแผนก'}
                {' '}และ<strong>ย้อน inventory balance กลับ</strong> — ไม่สามารถกู้คืนได้
              </p>
              <div className="flex gap-2">
                <Button variant="danger" onClick={handleDeleteSaleMovements}>
                  ยืนยันลบ
                </Button>
                <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
                  ยกเลิก
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-10 text-gray-500">กำลังโหลด...</div>
          ) : movements.length === 0 ? (
            <div className="text-center py-10 text-gray-500">ไม่พบข้อมูล</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3">วันเวลา</th>
                    <th className="text-left px-4 py-3">สินค้า</th>
                    <th className="text-left px-4 py-3">แผนก</th>
                    <th className="text-center px-4 py-3">ประเภท</th>
                    <th className="text-left px-4 py-3">อ้างอิง</th>
                    <th className="text-right px-4 py-3">จำนวน</th>
                    <th className="text-right px-4 py-3">ยอดก่อน</th>
                    <th className="text-right px-4 py-3">ยอดหลัง</th>
                    <th className="text-left px-4 py-3">ผู้ทำรายการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {movements.map((item) => {
                    const isNegative = item.quantity < 0;
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600">
                          {formatMovementDateTime(item)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{item.product_name}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-gray-900">{item.department_name}</div>
                          <div className="text-xs text-gray-500">{item.branch_name}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${getTransactionTypeColor(item.transaction_type)}`}>
                            {getTransactionTypeLabel(item.transaction_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          <div className="font-medium text-gray-700">{formatReferenceLabel(item)}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">{formatReferenceDetail(item)}</div>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${isNegative ? 'text-red-600' : 'text-green-600'}`}>
                          {isNegative ? '' : '+'}{formatNumber(item.quantity)} {item.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {formatNumber(item.balance_before)} {item.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          {formatNumber(item.balance_after)} {item.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {item.created_by_name || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
};
