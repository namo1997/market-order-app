import { useState, useEffect } from 'react';
import { adminAPI } from '../../api/admin';
import { ordersAPI } from '../../api/orders';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';

export const OrderManagement = () => {
  const [view, setView] = useState('all'); // all, supplier, branch, department, person
  const [orders, setOrders] = useState([]);
  const [branchData, setBranchData] = useState([]);
  const [supplierData, setSupplierData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orderStatus, setOrderStatus] = useState(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  useEffect(() => {
    fetchData();
  }, [selectedDate]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [ordersRes, branchRes, supplierRes, statusRes] = await Promise.all([
        adminAPI.getAllOrders({ date: selectedDate }),
        adminAPI.getOrdersByBranch(selectedDate),
        adminAPI.getOrdersBySupplier(selectedDate),
        ordersAPI.getOrderStatus(selectedDate)
      ]);

      setOrders(ordersRes.data);
      setBranchData(branchRes.data);
      setSupplierData(supplierRes.data);
      setOrderStatus(statusRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseOrders = async () => {
    try {
      const confirmed = window.confirm('ยืนยันปิดรับคำสั่งซื้อ?');
      if (!confirmed) {
        return;
      }
      await adminAPI.closeOrders(selectedDate);
      alert('ปิดรับคำสั่งซื้อแล้ว');
      fetchData();
    } catch (error) {
      alert('เกิดข้อผิดพลาด');
    }
  };

  const handleOpenOrders = async () => {
    try {
      await adminAPI.openOrders(selectedDate);
      alert('เปิดรับคำสั่งซื้อแล้ว');
      fetchData();
    } catch (error) {
      alert('เกิดข้อผิดพลาด');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const getStatusBadge = (status) => {
    const badges = {
      draft: 'bg-gray-200 text-gray-700',
      submitted: 'bg-blue-200 text-blue-700',
      confirmed: 'bg-green-200 text-green-700',
      completed: 'bg-green-600 text-white'
    };

    const labels = {
      draft: 'แบบร่าง',
      submitted: 'ส่งแล้ว',
      confirmed: 'ยืนยันแล้ว',
      completed: 'เสร็จสิ้น'
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs ${badges[status]}`}>
        {labels[status]}
      </span>
    );
  };

  if (loading) {
    return (
      <Layout>
        <Loading />
      </Layout>
    );
  }

  const isClosed = orderStatus && !orderStatus.is_open;
  const totalAmount = orders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
  const submittedOrders = orders.filter((o) => o.status === 'submitted');

  // Group orders by person for person view
  const ordersByPerson = orders.reduce((acc, order) => {
    const key = order.user_id;
    if (!acc[key]) {
      acc[key] = {
        user_id: order.user_id,
        user_name: order.user_name,
        branch_name: order.branch_name,
        department_name: order.department_name,
        orders: []
      };
    }
    acc[key].orders.push(order);
    return acc;
  }, {});

  // Group orders by department for department view
  const ordersByDepartment = orders.reduce((acc, order) => {
    const key = `${order.department_id}`;
    if (!acc[key]) {
      acc[key] = {
        department_id: order.department_id,
        department_name: order.department_name,
        branch_name: order.branch_name,
        orders: []
      };
    }
    acc[key].orders.push(order);
    return acc;
  }, {});

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        {/* Header - Hide when printing */}
        <div className="print:hidden mb-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
            <h1 className="text-2xl font-bold text-gray-900">
              จัดการคำสั่งซื้อ
            </h1>
            <div className="flex items-center space-x-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
              <Button onClick={handlePrint} variant="secondary">
                🖨️ พิมพ์
              </Button>
              {isClosed ? (
                <Button onClick={handleOpenOrders} variant="success">
                  เปิดรับคำสั่งซื้อ
                </Button>
              ) : (
                <Button onClick={handleCloseOrders} variant="danger">
                  ปิดรับคำสั่งซื้อ
                </Button>
              )}
            </div>
          </div>

          {isClosed && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              ⚠️ ปิดรับคำสั่งซื้อแล้ว
            </div>
          )}

          {/* View Tabs */}
          <div className="flex space-x-2 overflow-x-auto pb-2">
            <button
              onClick={() => setView('all')}
              className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                view === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              ทั้งหมด
            </button>
            <button
              onClick={() => setView('supplier')}
              className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                view === 'supplier'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              📦 แยกตามกลุ่มสินค้า
            </button>
            <button
              onClick={() => setView('branch')}
              className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                view === 'branch'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              🏢 แยกตามสาขา
            </button>
            <button
              onClick={() => setView('department')}
              className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                view === 'department'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              📋 แยกตามแผนก
            </button>
            <button
              onClick={() => setView('person')}
              className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                view === 'person'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              👤 แยกตามรายบุคคล
            </button>
          </div>
        </div>

        {/* Print Header - Show only when printing */}
        <div className="hidden print:block mb-6 text-center">
          <h1 className="text-2xl font-bold mb-2">รายการคำสั่งซื้อ</h1>
          <p className="text-gray-600">วันที่: {selectedDate}</p>
          <p className="text-gray-600">
            {view === 'all' && 'แสดงทั้งหมด'}
            {view === 'supplier' && 'แยกตามกลุ่มสินค้า'}
            {view === 'branch' && 'แยกตามสาขา'}
            {view === 'department' && 'แยกตามแผนก'}
            {view === 'person' && 'แยกตามรายบุคคล'}
          </p>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 print:mb-4">
          <Card className="bg-blue-50 print:shadow-none">
            <div className="text-center">
              <p className="text-gray-600 text-sm">คำสั่งซื้อทั้งหมด</p>
              <p className="text-3xl font-bold text-blue-600">{orders.length}</p>
            </div>
          </Card>
          <Card className="bg-green-50 print:shadow-none">
            <div className="text-center">
              <p className="text-gray-600 text-sm">ส่งแล้ว</p>
              <p className="text-3xl font-bold text-green-600">
                {submittedOrders.length}
              </p>
            </div>
          </Card>
          <Card className="bg-purple-50 print:shadow-none">
            <div className="text-center">
              <p className="text-gray-600 text-sm">ยอดรวม</p>
              <p className="text-2xl font-bold text-purple-600">
                {totalAmount.toFixed(2)} บาท
              </p>
            </div>
          </Card>
        </div>

        {/* Content based on view */}
        {orders.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            ไม่มีคำสั่งซื้อ
          </div>
        ) : (
          <>
            {/* All Orders View */}
            {view === 'all' && (
              <div className="space-y-3">
                {orders.map((order) => (
                  <Card key={order.id} className="print:shadow-none print:border">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-2 md:space-y-0">
                      <div className="flex-1">
                        <p className="font-semibold">{order.order_number}</p>
                        <p className="text-sm text-gray-600">
                          {order.user_name} • {order.branch_name} • {order.department_name}
                        </p>
                      </div>
                      <div className="flex items-center space-x-4">
                        {getStatusBadge(order.status)}
                        <span className="font-semibold text-blue-600">
                          {parseFloat(order.total_amount || 0).toFixed(2)} บาท
                        </span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* Supplier View */}
            {view === 'supplier' && (
              <div className="space-y-6">
                {supplierData.map((supplier) => (
                  <Card key={supplier.id} className="print:shadow-none print:border print:break-inside-avoid">
                    <h3 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                      {supplier.name}
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left">รหัสสินค้า</th>
                            <th className="px-4 py-2 text-left">ชื่อสินค้า</th>
                            <th className="px-4 py-2 text-center">จำนวนรวม</th>
                            <th className="px-4 py-2 text-right">ราคาเฉลี่ย</th>
                            <th className="px-4 py-2 text-left print:hidden">ผู้สั่ง</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplier.products.map((product) => (
                            <tr key={product.product_id} className="border-t">
                              <td className="px-4 py-2">{product.product_code}</td>
                              <td className="px-4 py-2 font-medium">{product.product_name}</td>
                              <td className="px-4 py-2 text-center">
                                <span className="font-semibold text-blue-600">
                                  {product.total_quantity} {product.unit_abbr}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right">
                                ฿{parseFloat(product.avg_price || 0).toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-xs text-gray-500 print:hidden">
                                {product.ordered_by}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 pt-4 border-t text-right">
                      <p className="text-sm text-gray-600">
                        รวม {supplier.products.length} รายการ
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* Branch View */}
            {view === 'branch' && (
              <div className="space-y-6">
                {branchData.map((branch) => (
                  <Card key={branch.id} className="print:shadow-none print:border print:break-inside-avoid">
                    <h3 className="text-xl font-bold text-gray-900 mb-4">
                      🏢 {branch.name}
                    </h3>
                    {branch.departments.map((dept) => (
                      <div key={dept.id} className="mb-4 last:mb-0">
                        <h4 className="font-semibold text-gray-700 mb-2 pb-2 border-b">
                          {dept.name}
                        </h4>
                        <div className="space-y-2">
                          {dept.orders.map((order) => (
                            <div key={order.id} className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded">
                              <div>
                                <p className="font-medium">{order.user_name}</p>
                                <p className="text-xs text-gray-500">
                                  {order.order_number} • {order.item_count} รายการ
                                </p>
                              </div>
                              <span className="font-semibold text-blue-600">
                                ฿{parseFloat(order.total_amount || 0).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </Card>
                ))}
              </div>
            )}

            {/* Department View */}
            {view === 'department' && (
              <div className="space-y-4">
                {Object.values(ordersByDepartment).map((dept) => (
                  <Card key={dept.department_id} className="print:shadow-none print:border print:break-inside-avoid">
                    <h3 className="text-lg font-bold text-gray-900 mb-3">
                      📋 {dept.department_name} <span className="text-sm text-gray-500">({dept.branch_name})</span>
                    </h3>
                    <div className="space-y-2">
                      {dept.orders.map((order) => (
                        <div key={order.id} className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded">
                          <div>
                            <p className="font-medium">{order.user_name}</p>
                            <p className="text-xs text-gray-500">{order.order_number}</p>
                          </div>
                          <div className="flex items-center space-x-3">
                            <span className="print:hidden">{getStatusBadge(order.status)}</span>
                            <span className="font-semibold text-blue-600">
                              ฿{parseFloat(order.total_amount || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 pt-3 border-t text-right">
                      <p className="font-semibold text-gray-700">
                        รวม: ฿{dept.orders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0).toFixed(2)}
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* Person View */}
            {view === 'person' && (
              <div className="space-y-4">
                {Object.values(ordersByPerson).map((person) => (
                  <Card key={person.user_id} className="print:shadow-none print:border print:break-inside-avoid">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">
                          👤 {person.user_name}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {person.branch_name} • {person.department_name}
                        </p>
                      </div>
                      <span className="text-sm text-gray-500">
                        {person.orders.length} คำสั่งซื้อ
                      </span>
                    </div>
                    <div className="space-y-2">
                      {person.orders.map((order) => (
                        <div key={order.id} className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded">
                          <div>
                            <p className="font-medium">{order.order_number}</p>
                            <p className="text-xs text-gray-500">
                              {new Date(order.order_date).toLocaleDateString('th-TH')}
                            </p>
                          </div>
                          <div className="flex items-center space-x-3">
                            <span className="print:hidden">{getStatusBadge(order.status)}</span>
                            <span className="font-semibold text-blue-600">
                              ฿{parseFloat(order.total_amount || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 pt-3 border-t text-right">
                      <p className="font-semibold text-gray-700">
                        รวม: ฿{person.orders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0).toFixed(2)}
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #root, #root * {
            visibility: visible;
          }
          #root {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:block {
            display: block !important;
          }
          .print\\:shadow-none {
            box-shadow: none !important;
          }
          .print\\:border {
            border: 1px solid #e5e7eb !important;
          }
          .print\\:break-inside-avoid {
            break-inside: avoid !important;
          }
        }
      `}</style>
    </Layout>
  );
};
