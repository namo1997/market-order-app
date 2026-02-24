import { useState, useEffect } from 'react';
import { adminAPI } from '../../api/admin';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { Loading } from '../../components/common/Loading';

export const PurchaseRecording = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [prices, setPrices] = useState({});

  useEffect(() => {
    fetchData();
  }, [selectedDate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getOrdersByProductGroup(selectedDate);
      setSuppliers(response.data);

      // Initialize prices
      const initialPrices = {};
      response.data.forEach((supplier) => {
        supplier.products.forEach((product) => {
          initialPrices[product.product_id] = product.avg_price;
        });
      });
      setPrices(initialPrices);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRecordPurchase = async (itemId, productId) => {
    try {
      const actualPrice = parseFloat(prices[productId]);
      if (isNaN(actualPrice)) {
        alert('กรุณาระบุราคา');
        return;
      }

      await adminAPI.recordPurchase(itemId, actualPrice, true);
      alert('บันทึกสำเร็จ');
      fetchData();
    } catch (error) {
      alert('เกิดข้อผิดพลาด');
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
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            บันทึกการซื้อ
          </h1>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {suppliers.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            ไม่มีรายการที่ต้องซื้อ
          </div>
        ) : (
          <div className="space-y-6">
            {suppliers.map((supplier) => (
              <Card key={supplier.id}>
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  {supplier.name}
                </h2>

                <div className="space-y-3">
                  {supplier.products.map((product) => (
                    <div
                      key={product.product_id}
                      className="border-b pb-3 last:border-b-0"
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-2 md:space-y-0 mb-2">
                        <div className="flex-1">
                          <p className="font-semibold">{product.product_name}</p>
                          <p className="text-sm text-gray-600">
                            จำนวน: {product.total_quantity} {product.unit_abbr} •
                            ราคาเฉลี่ย: {parseFloat(product.avg_price || 0).toFixed(2)} บาท
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {product.ordered_by}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-end space-x-2">
                        <div className="flex-1">
                          <Input
                            label="ราคาที่ซื้อจริง"
                            type="number"
                            value={prices[product.product_id] || ''}
                            onChange={(e) =>
                              setPrices({
                                ...prices,
                                [product.product_id]: e.target.value
                              })
                            }
                            step="0.01"
                            min="0"
                          />
                        </div>
                        <Button
                          onClick={() =>
                            handleRecordPurchase(
                              product.product_id,
                              product.product_id
                            )
                          }
                          variant="success"
                        >
                          บันทึก
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};
