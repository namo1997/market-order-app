import { useEffect, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { productsAPI } from '../../../api/products';
import { adminAPI } from '../../../api/admin';
import { BackToSettings } from '../../../components/common/BackToSettings';

export const PurchaseWalkSettings = () => {
  const [productGroups, setProductGroups] = useState([]);
  const [selectedProductGroupId, setSelectedProductGroupId] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);

  useEffect(() => {
    fetchProductGroups();
  }, []);

  useEffect(() => {
    if (!selectedProductGroupId) return;
    fetchProducts(selectedProductGroupId);
  }, [selectedProductGroupId]);

  const fetchProductGroups = async () => {
    try {
      const data = await productsAPI.getProductGroups();
      setProductGroups(data || []);
      if (data?.length > 0) {
        setSelectedProductGroupId(String(data[0].id));
      }
    } catch (error) {
      console.error('Error fetching product groups:', error);
      alert('ไม่สามารถโหลดรายการกลุ่มสินค้าได้');
    }
  };

  const fetchProducts = async (productGroupId) => {
    try {
      setLoading(true);
      const response = await adminAPI.getPurchaseWalkProducts(productGroupId);
      const data = Array.isArray(response.data) ? response.data : [];
      const ordered = [...data].sort((a, b) => {
        const orderA = a.sort_order ?? 999999;
        const orderB = b.sort_order ?? 999999;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th');
      });
      setProducts(ordered);
      setHasChanges(false);
    } catch (error) {
      console.error('Error fetching purchase walk products:', error);
      setProducts([]);
      alert('ไม่สามารถโหลดรายการสินค้าได้');
    } finally {
      setLoading(false);
    }
  };

  const moveProduct = (index, direction) => {
    const next = [...products];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setProducts(next);
    setHasChanges(true);
  };

  const handleDragStart = (index) => {
    setDragIndex(index);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleDrop = (index) => {
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      return;
    }
    const next = [...products];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    setProducts(next);
    setHasChanges(true);
    setDragIndex(null);
  };

  const handleSaveOrder = async () => {
    if (!selectedProductGroupId) return;
    if (products.length === 0) return;
    try {
      setSaving(true);
      const orderedIds = products.map((product) => product.product_id);
      await adminAPI.updatePurchaseWalkOrder(selectedProductGroupId, orderedIds);
      await fetchProducts(selectedProductGroupId);
    } catch (error) {
      console.error('Error saving purchase walk order:', error);
      alert('บันทึกการจัดเรียงไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-3">
          <BackToSettings />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ตั้งค่าการเดินซื้อของ</h1>
            <p className="text-sm text-gray-500 mt-1">
              จัดเรียงรายการสินค้าเพื่อให้เดินซื้อของได้ตามลำดับที่ต้องการ (ลากขึ้นลงได้)
            </p>
          </div>
          <Button
            onClick={handleSaveOrder}
            disabled={!hasChanges || saving || products.length === 0}
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึกการจัดเรียง'}
          </Button>
        </div>

        <Card className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            เลือกกลุ่มสินค้า
          </label>
          <select
            value={selectedProductGroupId}
            onChange={(e) => setSelectedProductGroupId(e.target.value)}
            className="w-full sm:w-96 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {productGroups.length === 0 && <option value="">-- ไม่มีกลุ่มสินค้า --</option>}
            {productGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Card>

        <Card>
          {loading ? (
            <div className="py-10 text-center text-gray-500">กำลังโหลด...</div>
          ) : products.length === 0 ? (
            <div className="py-10 text-center text-gray-500">
              ไม่มีรายการสินค้าในกลุ่มสินค้านี้
            </div>
          ) : (
            <div className="divide-y">
              {products.map((product, index) => (
                <div
                  key={product.product_id}
                  className={`flex items-center justify-between gap-3 py-3 ${
                    dragIndex === index ? 'bg-slate-50' : ''
                  }`}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(index)}
                  onDragEnd={() => setDragIndex(null)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-gray-400 cursor-move select-none">☰</span>
                    <div>
                      <p className="font-medium text-gray-900 truncate">
                        {product.product_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        รหัส {product.code || '-'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => moveProduct(index, 'up')}
                      disabled={index === 0}
                    >
                      ขึ้น
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => moveProduct(index, 'down')}
                      disabled={index === products.length - 1}
                    >
                      ลง
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Layout>
  );
};
