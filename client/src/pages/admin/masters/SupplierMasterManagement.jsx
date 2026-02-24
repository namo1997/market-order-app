import { useEffect, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';
import { productsAPI } from '../../../api/products';

export const SupplierMasterManagement = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [productGroups, setProductGroups] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSaving, setProductSaving] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [targetSupplier, setTargetSupplier] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState(new Set());
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    contact_person: '',
    phone: '',
    address: '',
    line_id: ''
  });

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    try {
      const data = await masterAPI.getSupplierMasters();
      setSuppliers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching supplier masters:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      contact_person: '',
      phone: '',
      address: '',
      line_id: ''
    });
    setSelectedId(null);
  };

  const openEdit = (row) => {
    setFormData({
      name: row.name || '',
      code: row.code || '',
      contact_person: row.contact_person || '',
      phone: row.phone || '',
      address: row.address || '',
      line_id: row.line_id || ''
    });
    setSelectedId(row.id);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (selectedId) {
        await masterAPI.updateSupplierMaster(selectedId, formData);
      } else {
        await masterAPI.createSupplierMaster(formData);
      }
      setIsModalOpen(false);
      resetForm();
      fetchSuppliers();
    } catch (error) {
      console.error('Error saving supplier master:', error);
      alert('บันทึกซัพพลายเออร์ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (row) => {
    if (!confirm(`ต้องการลบซัพพลายเออร์ "${row.name}" ใช่หรือไม่?`)) return;

    try {
      await masterAPI.deleteSupplierMaster(row.id);
      fetchSuppliers();
    } catch (error) {
      console.error('Error deleting supplier master:', error);
      alert('ลบซัพพลายเออร์ไม่สำเร็จ');
    }
  };

  const fetchProducts = async () => {
    try {
      setProductsLoading(true);
      const response = await productsAPI.getProducts();
      const data = Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []);
      setProducts(data);
    } catch (error) {
      console.error('Error fetching products:', error);
      alert('โหลดสินค้าไม่สำเร็จ');
    } finally {
      setProductsLoading(false);
    }
  };

  const fetchProductGroups = async () => {
    try {
      const data = await masterAPI.getProductGroups();
      setProductGroups(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching product groups:', error);
      setProductGroups([]);
    }
  };

  const resetProductSelection = () => {
    setSelectedProductIds(new Set());
    setProductSearch('');
    setSelectedGroupId('');
    setTargetSupplier(null);
  };

  const openAssignProducts = (supplier) => {
    setTargetSupplier(supplier);
    setSelectedProductIds(new Set());
    setProductSearch('');
    setIsProductModalOpen(true);
    fetchProducts();
    fetchProductGroups();
  };

  const toggleProductSelection = (productId) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const handleGroupFilterSelect = (groupId) => {
    setSelectedGroupId(groupId);
    setSelectedProductIds(new Set());
  };

  const filteredProducts = products.filter((product) => {
    if (selectedGroupId) {
      const filterGroupId = Number(selectedGroupId);
      const productGroupId = Number(product.product_group_id ?? product.supplier_id);
      if (!Number.isFinite(filterGroupId) || filterGroupId <= 0) return false;
      if (productGroupId !== filterGroupId) return false;
    }

    const search = String(productSearch || '').trim().toLowerCase();
    if (!search) return true;
    const name = String(product.name || '').toLowerCase();
    const code = String(product.code || '').toLowerCase();
    return name.includes(search) || code.includes(search);
  });

  const handleSelectAll = () => {
    const next = new Set();
    filteredProducts.forEach((product) => {
      if (Number(product.supplier_master_id) === Number(targetSupplier?.id)) return;
      next.add(product.id);
    });
    setSelectedProductIds(next);
  };

  const handleSelectUnassigned = () => {
    const next = new Set();
    filteredProducts.forEach((product) => {
      if (!product.supplier_master_id) {
        next.add(product.id);
      }
    });
    setSelectedProductIds(next);
  };

  const handleAssignProducts = async (event) => {
    event.preventDefault();
    if (!targetSupplier?.id) {
      alert('ไม่พบซัพพลายเออร์');
      return;
    }

    const selectedProducts = products.filter((product) => selectedProductIds.has(product.id));
    if (selectedProducts.length === 0) {
      alert('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ');
      return;
    }

    setProductSaving(true);
    try {
      const results = await Promise.allSettled(
        selectedProducts.map((product) =>
          productsAPI.updateProduct(product.id, {
            name: product.name,
            code: product.code,
            default_price: product.default_price,
            unit_id: product.unit_id,
            supplier_id: product.supplier_id,
            supplier_master_id: targetSupplier.id,
            is_countable: product.is_countable
          })
        )
      );

      const successCount = results.filter((row) => row.status === 'fulfilled').length;
      const failedCount = results.length - successCount;

      setIsProductModalOpen(false);
      resetProductSelection();
      alert(
        `เพิ่มสินค้าเข้า "${targetSupplier.name}" สำเร็จ ${successCount} รายการ` +
        (failedCount ? `, ล้มเหลว ${failedCount} รายการ` : '')
      );
    } catch (error) {
      console.error('Error assigning products to supplier master:', error);
      alert('เพิ่มสินค้าเข้า ซัพพลายเออร์ไม่สำเร็จ');
    } finally {
      setProductSaving(false);
    }
  };

  const columns = [
    { header: 'รหัส', accessor: 'code' },
    { header: 'ชื่อซัพพลายเออร์', accessor: 'name' },
    { header: 'ผู้ติดต่อ', accessor: 'contact_person' },
    { header: 'เบอร์โทร', accessor: 'phone' },
    { header: 'Line ID', accessor: 'line_id' },
    {
      header: 'ที่อยู่',
      accessor: 'address',
      wrap: true,
      render: (row) => row.address || '-'
    }
  ];

  return (
    <Layout mainClassName="!max-w-none">
      <div className="w-full">
        <div className="mb-3">
          <BackToSettings />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">จัดการซัพพลายเออร์</h1>
          <button
            onClick={() => {
              resetForm();
              setIsModalOpen(true);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            เพิ่มซัพพลายเออร์
          </button>
        </div>

        <DataTable
          columns={columns}
          data={suppliers}
          renderActions={(row) => (
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => openAssignProducts(row)}
                className="text-emerald-600 hover:text-emerald-900"
              >
                เพิ่มสินค้า
              </button>
              <button
                onClick={() => openEdit(row)}
                className="text-blue-600 hover:text-blue-900"
              >
                แก้ไข
              </button>
              <button
                onClick={() => handleDelete(row)}
                className="text-red-600 hover:text-red-900"
              >
                ลบ
              </button>
            </div>
          )}
        />

        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={selectedId ? 'แก้ไขซัพพลายเออร์' : 'เพิ่มซัพพลายเออร์'}
          size="xlarge"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="รหัส"
                value={formData.code}
                onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="เว้นว่างให้ระบบกำหนด"
              />
              <Input
                label="ชื่อซัพพลายเออร์"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="ผู้ติดต่อ"
                value={formData.contact_person}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, contact_person: e.target.value }))
                }
              />
              <Input
                label="เบอร์โทร"
                value={formData.phone}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Line ID"
                value={formData.line_id}
                onChange={(e) => setFormData((prev) => ({ ...prev, line_id: e.target.value }))}
              />
              <Input
                label="ที่อยู่"
                value={formData.address}
                onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
              />
            </div>

            <div className="flex justify-end space-x-2 mt-6">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
              >
                {loading ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        </Modal>

        <Modal
          isOpen={isProductModalOpen}
          onClose={() => {
            if (productSaving) return;
            setIsProductModalOpen(false);
            resetProductSelection();
          }}
          title="เพิ่มสินค้าเข้า ซัพพลายเออร์"
          size="large"
        >
          <form onSubmit={handleAssignProducts} className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              ซัพพลายเออร์: <span className="font-medium">{targetSupplier?.name || '-'}</span>
            </div>
            <Input
              label="ค้นหาสินค้า"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="พิมพ์ชื่อหรือรหัสสินค้า"
            />
            <div className="rounded-lg border border-gray-200 px-3 py-2">
              <p className="text-xs text-gray-500 mb-2">ตัวกรองตามกลุ่มสินค้า</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleGroupFilterSelect('')}
                  className={`rounded-lg px-3 py-1.5 text-xs border transition ${
                    !selectedGroupId
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  ทั้งหมด
                </button>
                {productGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => handleGroupFilterSelect(String(group.id))}
                    className={`rounded-lg px-3 py-1.5 text-xs border transition ${
                      String(selectedGroupId) === String(group.id)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <div>เลือกแล้ว {selectedProductIds.size} รายการ</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSelectUnassigned}
                  className="rounded-full border border-gray-200 px-3 py-1 text-gray-600 hover:bg-gray-50"
                >
                  เลือกเฉพาะที่ยังไม่ระบุซัพพลายเออร์
                </button>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="rounded-full border border-gray-200 px-3 py-1 text-gray-600 hover:bg-gray-50"
                >
                  เลือกทั้งหมด
                </button>
              </div>
            </div>
            <div className="border rounded-lg max-h-[360px] overflow-y-auto">
              {productsLoading ? (
                <div className="px-4 py-6 text-center text-gray-500">กำลังโหลดสินค้า...</div>
              ) : (
                <div className="divide-y">
                  {filteredProducts.map((product) => {
                    const isAssigned = Number(product.supplier_master_id) === Number(targetSupplier?.id);
                    const isSelected = selectedProductIds.has(product.id);
                    return (
                      <label
                        key={product.id}
                        className={`flex items-center gap-3 px-4 py-3 text-sm ${
                          isAssigned ? 'text-gray-400' : 'text-gray-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={isAssigned}
                          checked={isSelected}
                          onChange={() => toggleProductSelection(product.id)}
                        />
                        <div className="flex-1">
                          <div className="font-medium">{product.name}</div>
                          <div className="text-xs text-gray-500">
                            {product.code || '-'} • {product.unit_abbr || product.unit_name || '-'}
                            {product.barcode ? ` • บาร์โค้ด: ${product.barcode}` : ''}
                            {product.qr_code ? ` • QR: ${product.qr_code}` : ''}
                            {product.supplier_master_name
                              ? ` • ปัจจุบัน: ${product.supplier_master_name}`
                              : ' • ยังไม่ระบุซัพพลายเออร์'}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <div className="px-4 py-6 text-center text-gray-500">ไม่พบสินค้า</div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setIsProductModalOpen(false);
                  resetProductSelection();
                }}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                disabled={productSaving}
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={productSaving}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-emerald-300"
              >
                {productSaving ? 'กำลังบันทึก...' : 'บันทึกการเพิ่มสินค้า'}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  );
};
