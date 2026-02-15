import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { inventoryAPI } from '../../api/inventory';

export const StockCard = () => {
  const navigate = useNavigate();
  const { productId, departmentId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().split('T')[0];
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: today
  });

  useEffect(() => {
    if (productId && departmentId) {
      loadStockCard();
    }
  }, [productId, departmentId, filters]);

  const loadStockCard = async () => {
    try {
      setLoading(true);
      const result = await inventoryAPI.getStockCard(productId, departmentId, filters);
      setData(result);
    } catch (error) {
      console.error('Error loading stock card:', error);
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
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-500">กำลังโหลด...</div>
        </div>
      </Layout>
    );
  }

  if (!data || !data.product) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="text-center py-10">
            <p className="text-gray-500 mb-4">ไม่พบข้อมูล</p>
            <Button onClick={() => navigate('/inventory/balance')}>
              ← ย้อนกลับ
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  const product = data.product;
  const transactions = data.transactions || [];

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">บัตรคุมสต็อก</h1>
            <p className="text-sm text-gray-500 mt-1">
              ติดตามประวัติการเคลื่อนไหวรายสินค้า
            </p>
          </div>
          <Button variant="secondary" onClick={() => navigate('/inventory/balance')}>
            ← ย้อนกลับ
          </Button>
        </div>

        {/* Product Info */}
        <Card className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">{product.product_name}</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">รหัสสินค้า:</span>
                  <span className="font-medium">{product.product_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">กลุ่มสินค้า:</span>
                  <span className="font-medium">{product.supplier_name || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">หน่วยนับ:</span>
                  <span className="font-medium">{product.unit_name} ({product.unit_abbr})</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลคลัง</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">สาขา:</span>
                  <span className="font-medium">{product.branch_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">แผนก:</span>
                  <span className="font-medium">{product.department_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">ยอดคงเหลือปัจจุบัน:</span>
                  <span className="font-bold text-lg text-green-600">
                    {formatNumber(data.current_balance)} {product.unit_abbr}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Filters */}
        <Card className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          </div>
        </Card>

        {/* Transactions */}
        <Card>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            ประวัติการเคลื่อนไหว ({transactions.length} รายการ)
          </h2>

          {transactions.length === 0 ? (
            <div className="text-center py-10 text-gray-500">ไม่พบข้อมูล</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3">วันเวลา</th>
                    <th className="text-center px-4 py-3">ประเภท</th>
                    <th className="text-right px-4 py-3">จำนวน</th>
                    <th className="text-right px-4 py-3">ยอดก่อน</th>
                    <th className="text-right px-4 py-3">ยอดหลัง</th>
                    <th className="text-left px-4 py-3">ผู้ทำรายการ</th>
                    <th className="text-left px-4 py-3">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transactions.map((item) => {
                    const isNegative = item.quantity < 0;
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600">
                          {formatDateTime(item.created_at)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs font-semibold ${getTransactionTypeColor(item.transaction_type)}`}>
                            {getTransactionTypeLabel(item.transaction_type)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${isNegative ? 'text-red-600' : 'text-green-600'}`}>
                          {isNegative ? '' : '+'}{formatNumber(item.quantity)} {product.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {formatNumber(item.balance_before)} {product.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          {formatNumber(item.balance_after)} {product.unit_abbr}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {item.created_by_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {item.notes || '-'}
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
