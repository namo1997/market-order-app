import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { purchaseOrderAPI } from '../../api/purchase-orders';
import { useAuth } from '../../contexts/AuthContext';

const STATUS_MAP = {
  draft:      { label: 'ร่าง',          color: 'bg-gray-100 text-gray-600' },
  confirmed:  { label: 'ยืนยันแล้ว',    color: 'bg-blue-100 text-blue-700' },
  partial:    { label: 'รับบางส่วน',    color: 'bg-yellow-100 text-yellow-700' },
  completed:  { label: 'รับครบแล้ว',    color: 'bg-green-100 text-green-700' },
  cancelled:  { label: 'ยกเลิก',        color: 'bg-red-100 text-red-700' }
};

const toLocalDateString = (date = new Date()) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().split('T')[0];
};

export const PurchaseOrderHistory = () => {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [copyingId, setCopyingId] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    startDate: toLocalDateString(new Date(Date.now() - 30 * 86400000)),
    endDate: toLocalDateString()
  });

  const load = async () => {
    try {
      setLoading(true);
      const scopedFilters = isAdmin
        ? filters
        : {
            ...filters,
            branchId: user?.branch_id || undefined,
            departmentId: user?.department_id || undefined
          };
      const result = await purchaseOrderAPI.getAll(scopedFilters);
      setOrders(result?.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters, isAdmin, user?.branch_id, user?.department_id]);

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
  const formatQty = (value) => {
    const qty = Number(value);
    if (!Number.isFinite(qty)) return '0';
    return Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, '');
  };

  const writeText = async (text) => {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

  const handleCopyItems = async (po) => {
    try {
      setCopyingId(po.id);
      const detailRes = await purchaseOrderAPI.getById(po.id);
      const detail = detailRes?.data || detailRes;
      const items = Array.isArray(detail?.items) ? detail.items : [];

      if (items.length === 0) {
        alert('ไม่พบรายการสินค้าในใบสั่งซื้อนี้');
        return;
      }

      const lines = items.map((item, index) => {
        const name = String(item?.product_name || '-').trim();
        const qty = formatQty(item?.quantity_ordered);
        const unit = String(item?.unit_abbr || '').trim();
        return `${index + 1}. ${name} ${qty}${unit ? ` ${unit}` : ''}`;
      });

      const text = [
        `ใบสั่งซื้อ ${detail?.po_number || po.po_number || '-'}`,
        `ซัพพลายเออร์ ${detail?.supplier_name || po.supplier_name || '-'}`,
        `วันที่ ${formatDate(detail?.po_date || po.po_date)}`,
        '',
        ...lines
      ].join('\n');

      await writeText(text);
      alert('คัดลอกรายการสินค้าแล้ว');
    } catch (error) {
      console.error('Error copying purchase order items:', error);
      alert('คัดลอกรายการไม่สำเร็จ');
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ใบสั่งซื้อจากซัพ</h1>
            <p className="text-sm text-gray-500 mt-0.5">ประวัติและสถานะคำสั่งซื้อจากผู้จำหน่ายภายนอก</p>
          </div>
          <div>
            <Button variant="secondary" onClick={() => navigate('/')}>← ย้อนกลับ</Button>
          </div>
        </div>

        <Card className="p-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => navigate('/purchase-orders')}
              className="rounded-lg px-3 py-2 text-sm font-semibold border border-gray-300 text-gray-700 bg-white hover:border-purple-300"
            >
              สั่งซื้อ
            </button>
            <button
              type="button"
              onClick={() => navigate('/purchase-orders/history')}
              className="rounded-lg px-3 py-2 text-sm font-semibold bg-purple-600 text-white"
            >
              คำสั่งซื้อของฉัน
            </button>
          </div>
        </Card>

        {!isAdmin && (
          <Card className="p-3 bg-blue-50 border-blue-200">
            <p className="text-xs text-blue-700">
              แสดงเฉพาะคำสั่งซื้อของแผนกคุณ: <span className="font-semibold">{user?.department_name || '-'}</span>
            </p>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">สถานะ</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters(p => ({ ...p, status: e.target.value }))}
                className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              >
                <option value="">ทั้งหมด</option>
                {Object.entries(STATUS_MAP).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">จากวันที่</label>
              <input type="date" value={filters.startDate}
                onChange={(e) => setFilters(p => ({ ...p, startDate: e.target.value }))}
                className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ถึงวันที่</label>
              <input type="date" value={filters.endDate}
                onChange={(e) => setFilters(p => ({ ...p, endDate: e.target.value }))}
                className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
          </div>
        </Card>

        {/* Table */}
        <Card>
          {loading ? (
            <div className="text-center py-10 text-gray-500">กำลังโหลด...</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-10 text-gray-400">ไม่พบรายการ</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-3">เลข PO</th>
                    <th className="text-left px-4 py-3">ซัพพลายเออร์</th>
                    <th className="text-left px-4 py-3">แผนกที่สั่ง</th>
                    <th className="text-left px-4 py-3">วันที่สั่ง</th>
                    <th className="text-center px-4 py-3">รายการ</th>
                    <th className="text-center px-4 py-3">สถานะ</th>
                    <th className="text-center px-4 py-3">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {orders.map((po) => {
                    const st = STATUS_MAP[po.status] || STATUS_MAP.draft;
                    return (
                      <tr key={po.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/purchase-orders/${po.id}`)}>
                        <td className="px-4 py-3 font-mono font-semibold text-purple-700">{po.po_number}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{po.supplier_name || '-'}</div>
                          {po.supplier_phone && <div className="text-xs text-gray-400">{po.supplier_phone}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-800">{po.department_name || '-'}</div>
                          {po.branch_name && <div className="text-xs text-gray-400">{po.branch_name}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatDate(po.po_date)}</td>
                        <td className="px-4 py-3 text-center text-gray-700">{po.item_count || 0} รายการ</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyItems(po);
                              }}
                              className="text-emerald-600 hover:text-emerald-800 text-xs font-medium"
                            >
                              {copyingId === po.id ? 'กำลังคัดลอก...' : 'คัดลอกรายการ'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/purchase-orders/${po.id}`); }}
                              className="text-purple-600 hover:text-purple-800 text-xs font-medium"
                            >
                              {['draft', 'confirmed', 'partial'].includes(po.status) ? 'รับสินค้า / ดูรายละเอียด' : 'ดูรายละเอียด'}
                            </button>
                          </div>
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
