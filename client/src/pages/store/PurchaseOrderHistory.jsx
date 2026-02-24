import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { purchaseOrderAPI } from '../../api/purchase-orders';

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
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    startDate: toLocalDateString(new Date(Date.now() - 30 * 86400000)),
    endDate: toLocalDateString()
  });

  const load = async () => {
    try {
      setLoading(true);
      const result = await purchaseOrderAPI.getAll(filters);
      setOrders(result?.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters]);

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ใบสั่งซื้อจากซัพ</h1>
            <p className="text-sm text-gray-500 mt-0.5">ประวัติและสถานะคำสั่งซื้อจากผู้จำหน่ายภายนอก</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/')}>← ย้อนกลับ</Button>
            <Button variant="primary" onClick={() => navigate('/purchase-orders/new')}>+ สร้าง PO ใหม่</Button>
          </div>
        </div>

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
                        <td className="px-4 py-3 text-gray-600">{formatDate(po.po_date)}</td>
                        <td className="px-4 py-3 text-center text-gray-700">{po.item_count || 0} รายการ</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/purchase-orders/${po.id}`); }}
                            className="text-purple-600 hover:text-purple-800 text-xs font-medium"
                          >
                            {['draft', 'confirmed', 'partial'].includes(po.status) ? 'รับสินค้า / ดูรายละเอียด' : 'ดูรายละเอียด'}
                          </button>
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
