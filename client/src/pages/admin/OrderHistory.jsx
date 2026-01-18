import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminAPI } from '../../api/admin';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';

const aggregateProducts = (items) => {
  const map = new Map();

  items.forEach((item) => {
    const key = item.product_id;
    if (!map.has(key)) {
      map.set(key, {
        product_id: item.product_id,
        product_name: item.product_name,
        unit_abbr: item.unit_abbr,
        unit_name: item.unit_name,
        unit_price:
          item.actual_price ??
          item.requested_price ??
          item.last_actual_price ??
          null,
        total_quantity: 0
      });
    }
    const entry = map.get(key);
    entry.total_quantity += Number(item.quantity || 0);
  });

  return Array.from(map.values()).map((product) => ({
    ...product,
    total_amount:
      product.unit_price !== null
        ? Number(product.total_quantity || 0) * Number(product.unit_price || 0)
        : null
  }));
};

const groupItems = (items, type) => {
  const groups = new Map();

  items.forEach((item) => {
    let key = '';
    let name = '';

    if (type === 'supplier') {
      key = item.supplier_id || 'none';
      name = item.supplier_name || 'ไม่ระบุซัพพลายเออร์';
    } else if (type === 'branch') {
      key = item.branch_id || 'none';
      name = item.branch_name || 'ไม่ระบุสาขา';
    } else {
      key = item.department_id || 'none';
      name = item.department_name || 'ไม่ระบุแผนก';
      if (item.branch_name) {
        name = `${name} (${item.branch_name})`;
      }
    }

    if (!groups.has(key)) {
      groups.set(key, { id: key, name, items: [] });
    }
    groups.get(key).items.push(item);
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    products: aggregateProducts(group.items)
  }));
};

export const OrderHistory = () => {
  const [searchParams] = useSearchParams();
  const initialDate =
    searchParams.get('date') || new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printDate, setPrintDate] = useState(initialDate);
  const [printType, setPrintType] = useState('supplier');
  const [printData, setPrintData] = useState(null);
  const [printLoading, setPrintLoading] = useState(false);

  useEffect(() => {
    fetchHistory();
  }, [selectedDate]);

  useEffect(() => {
    setPrintDate(selectedDate);
  }, [selectedDate]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getAllOrders({ date: selectedDate });
      const data = Array.isArray(response.data) ? response.data : [];
      setOrders(data.filter((order) => order.status !== 'submitted'));
    } catch (error) {
      console.error('Error fetching order history:', error);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const totalAmount = useMemo(
    () => orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
    [orders]
  );

  const handlePrint = async () => {
    try {
      setPrintLoading(true);
      const response = await adminAPI.getOrderItems(printDate);
      const items = Array.isArray(response.data) ? response.data : [];
      const grouped = groupItems(items, printType);
      setPrintData({
        date: printDate,
        type: printType,
        groups: grouped
      });
      setPrintModalOpen(false);
      setTimeout(() => window.print(), 200);
    } catch (error) {
      console.error('Error preparing print:', error);
      alert('ไม่สามารถเตรียมข้อมูลพิมพ์ได้');
    } finally {
      setPrintLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto print:hidden">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ประวัติคำสั่งซื้อ</h1>
            <p className="text-sm text-gray-500">คำสั่งซื้อที่ปิดรับแล้ว</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button onClick={() => setPrintModalOpen(true)} variant="secondary">
              พิมพ์
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="bg-blue-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">จำนวนคำสั่งซื้อ</p>
              <p className="text-3xl font-bold text-blue-600">{orders.length}</p>
            </div>
          </Card>
          <Card className="bg-green-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">ยอดรวมทั้งหมด</p>
              <p className="text-2xl font-bold text-green-600">
                ฿{totalAmount.toFixed(2)}
              </p>
            </div>
          </Card>
        </div>

        {orders.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
            ไม่มีคำสั่งซื้อในวันนี้
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <Card key={order.id}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">{order.order_number}</p>
                    <p className="text-sm text-gray-600">
                      {order.user_name} • {order.branch_name} • {order.department_name}
                    </p>
                  </div>
                  <div className="font-semibold text-blue-600">
                    ฿{Number(order.total_amount || 0).toFixed(2)}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={printModalOpen}
        onClose={() => setPrintModalOpen(false)}
        title="พิมพ์รายการสั่งซื้อ"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
            <input
              type="date"
              value={printDate}
              onChange={(e) => setPrintDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">รูปแบบพิมพ์</label>
            <div className="grid grid-cols-1 gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="printType"
                  value="department"
                  checked={printType === 'department'}
                  onChange={() => setPrintType('department')}
                />
                ตามแผนก
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="printType"
                  value="branch"
                  checked={printType === 'branch'}
                  onChange={() => setPrintType('branch')}
                />
                ตามสาขา
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="printType"
                  value="supplier"
                  checked={printType === 'supplier'}
                  onChange={() => setPrintType('supplier')}
                />
                ตามซัพพลายเออร์
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setPrintModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handlePrint} disabled={printLoading}>
              {printLoading ? 'กำลังเตรียม...' : 'พิมพ์'}
            </Button>
          </div>
        </div>
      </Modal>

      {printData && (
        <div className="hidden print:block p-4">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold">สรุปรายการสั่งซื้อ</h1>
            <p className="text-sm text-gray-600">
              วันที่ {new Date(printData.date).toLocaleDateString('th-TH')}
            </p>
          </div>
          {printData.groups.map((group) => (
            <div key={group.id} className="mb-6">
              <h2 className="font-semibold mb-2">{group.name}</h2>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1">สินค้า</th>
                    <th className="text-right py-1">จำนวน</th>
                    <th className="text-right py-1">ราคา/หน่วย</th>
                    <th className="text-right py-1">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {group.products.map((product) => (
                    <tr key={product.product_id} className="border-b">
                      <td className="py-1">
                        {product.product_name}
                      </td>
                      <td className="py-1 text-right">
                        {product.total_quantity} {product.unit_abbr}
                      </td>
                      <td className="py-1 text-right">
                        {product.unit_price !== null
                          ? Number(product.unit_price || 0).toFixed(2)
                          : '-'}
                      </td>
                      <td className="py-1 text-right">
                        {product.total_amount !== null
                          ? Number(product.total_amount || 0).toFixed(2)
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
};
