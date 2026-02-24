import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { withdrawAPI } from '../../api/withdraw';

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString('th-TH')} ${date.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
};

export const WithdrawStock = () => {
  const navigate = useNavigate();
  const { canViewProductGroupOrders, isAdmin, isProduction } = useAuth();
  const canUseWithdraw = isAdmin || canViewProductGroupOrders || isProduction;

  const [activeTab, setActiveTab] = useState('create');
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState([]);
  const [products, setProducts] = useState([]);
  const [history, setHistory] = useState([]);

  const [targetBranchId, setTargetBranchId] = useState('');
  const [targetDepartmentId, setTargetDepartmentId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [documentNote, setDocumentNote] = useState('');
  const [draftItems, setDraftItems] = useState([]);
  const [isDraftModalOpen, setIsDraftModalOpen] = useState(false);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const historyRes = await withdrawAPI.getHistory({ limit: 50 });
      setHistory(Array.isArray(historyRes?.data) ? historyRes.data : []);
    } catch (error) {
      console.error('Error loading withdraw history:', error);
      alert(error.response?.data?.message || 'ไม่สามารถโหลดประวัติการเบิกได้');
    } finally {
      setHistoryLoading(false);
    }
  };

  const openWithdrawalDetail = async (withdrawalId) => {
    setIsDetailModalOpen(true);
    setSelectedWithdrawal(null);
    setDetailLoading(true);
    try {
      const res = await withdrawAPI.getById(withdrawalId);
      setSelectedWithdrawal(res?.data || null);
    } catch (error) {
      console.error('Error loading withdrawal detail:', error);
      alert(error.response?.data?.message || 'ไม่สามารถโหลดรายละเอียดได้');
      setIsDetailModalOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const startEditing = () => {
    if (!selectedWithdrawal) return;
    setEditItems(
      (selectedWithdrawal.items || []).map((item) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        product_code: item.product_code,
        unit_abbr: item.unit_abbr || item.unit_name || '',
        quantity: toNumber(item.quantity, 0),
        notes: item.notes || ''
      }))
    );
    setEditNotes(selectedWithdrawal.notes || '');
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditItems([]);
    setEditNotes('');
  };

  const setEditItemQty = (productId, value) => {
    const qty = toNumber(value, 0);
    setEditItems((prev) =>
      prev.map((item) =>
        Number(item.product_id) === Number(productId) ? { ...item, quantity: qty } : item
      )
    );
  };

  const saveEdit = async () => {
    if (!selectedWithdrawal) return;
    const validItems = editItems.filter((item) => item.quantity > 0);
    if (validItems.length === 0) {
      alert('กรุณาระบุจำนวนอย่างน้อย 1 รายการ');
      return;
    }
    try {
      setIsSavingEdit(true);
      const res = await withdrawAPI.update(selectedWithdrawal.id, {
        notes: editNotes,
        items: validItems.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          notes: item.notes
        }))
      });
      setSelectedWithdrawal(res?.data || null);
      setIsEditing(false);
      setEditItems([]);
      setEditNotes('');
      await loadHistory();
      alert('บันทึกการแก้ไขเรียบร้อย');
    } catch (error) {
      console.error('Error saving withdrawal edit:', error);
      alert(error.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [targetRes, productRes] = await Promise.all([
        withdrawAPI.getTargets(),
        withdrawAPI.getProducts({ limit: 300 })
      ]);

      const targetRows = Array.isArray(targetRes?.data) ? targetRes.data : [];
      const productRows = Array.isArray(productRes?.data) ? productRes.data : [];

      setTargets(targetRows);
      setProducts(productRows);

      if (targetRows.length > 0) {
        const fallbackBranchId = String(targetRows[0].branch_id);
        const nextBranchId = targetBranchId || fallbackBranchId;
        const branchTargets = targetRows.filter(
          (target) => String(target.branch_id) === String(nextBranchId)
        );
        const fallbackDepartmentId = branchTargets[0]?.id ?? targetRows[0].id;
        setTargetBranchId(String(nextBranchId));
        if (!targetDepartmentId) {
          setTargetDepartmentId(String(fallbackDepartmentId));
        }
      }
    } catch (error) {
      console.error('Error loading withdraw data:', error);
      alert(error.response?.data?.message || 'ไม่สามารถโหลดข้อมูลการเบิกสินค้าได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canUseWithdraw) return;
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseWithdraw]);

  const filteredProducts = useMemo(() => {
    const keyword = String(productSearch || '').trim().toLowerCase();
    if (!keyword) return products;
    return products.filter((product) =>
      String(product?.name || '').toLowerCase().includes(keyword) ||
      String(product?.code || '').toLowerCase().includes(keyword)
    );
  }, [products, productSearch]);

  const targetDepartment = useMemo(
    () => targets.find((target) => String(target.id) === String(targetDepartmentId)) || null,
    [targets, targetDepartmentId]
  );

  const availableBranches = useMemo(() => {
    const map = new Map();
    for (const target of targets) {
      const branchId = String(target.branch_id);
      if (!map.has(branchId)) {
        map.set(branchId, {
          branch_id: target.branch_id,
          branch_name: target.branch_name
        });
      }
    }
    return Array.from(map.values());
  }, [targets]);

  const availableDepartments = useMemo(() => {
    if (!targetBranchId) return [];
    return targets.filter((target) => String(target.branch_id) === String(targetBranchId));
  }, [targets, targetBranchId]);

  const handleSwitchTab = (tab) => {
    setActiveTab(tab);
    if (tab === 'history' && history.length === 0) {
      loadHistory();
    }
  };

  const getDraftItem = (productId) =>
    draftItems.find((item) => Number(item.product_id) === Number(productId));

  const setDraftQuantity = (product, quantityValue) => {
    const quantity = toNumber(quantityValue, 0);
    const productId = Number(product?.id);
    if (!Number.isFinite(productId)) return;

    if (quantity <= 0) {
      setDraftItems((prev) =>
        prev.filter((item) => Number(item.product_id) !== productId)
      );
      return;
    }

    setDraftItems((prev) => {
      const existingIndex = prev.findIndex((item) => Number(item.product_id) === productId);
      if (existingIndex >= 0) {
        return prev.map((item, index) =>
          index === existingIndex ? { ...item, quantity } : item
        );
      }

      return [
        ...prev,
        {
          product_id: productId,
          product_name: product.name,
          product_code: product.code,
          unit_abbr: product.unit_abbr || product.unit_name || '',
          quantity,
          notes: ''
        }
      ];
    });
  };

  const adjustDraftQuantity = (product, delta) => {
    const current = toNumber(getDraftItem(product.id)?.quantity, 0);
    const next = Math.max(0, current + delta);
    setDraftQuantity(product, next);
  };

  const handleCardClick = (product) => {
    adjustDraftQuantity(product, 1);
  };

  const updateDraftNote = (productId, value) => {
    setDraftItems((prev) =>
      prev.map((item) =>
        Number(item.product_id) === Number(productId)
          ? { ...item, notes: value }
          : item
      )
    );
  };

  const updateDraftQuantityById = (productId, value) => {
    const quantity = toNumber(value, 0);
    if (quantity <= 0) {
      removeDraftItem(productId);
      return;
    }
    setDraftItems((prev) =>
      prev.map((item) =>
        Number(item.product_id) === Number(productId)
          ? { ...item, quantity }
          : item
      )
    );
  };

  const removeDraftItem = (productId) => {
    setDraftItems((prev) => prev.filter((item) => Number(item.product_id) !== Number(productId)));
  };

  const saveWithdrawal = async () => {
    const targetId = Number(targetDepartmentId);
    if (!Number.isFinite(targetId)) {
      alert('กรุณาเลือกแผนกปลายทาง');
      return;
    }

    const payloadItems = draftItems
      .map((item) => ({
        product_id: Number(item.product_id),
        quantity: toNumber(item.quantity, 0),
        notes: String(item.notes || '').trim() || undefined
      }))
      .filter((item) => Number.isFinite(item.product_id) && item.quantity > 0);

    if (payloadItems.length === 0) {
      alert('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ');
      return;
    }

    try {
      setSaving(true);
      const response = await withdrawAPI.createWithdrawal({
        target_department_id: targetId,
        notes: documentNote,
        items: payloadItems
      });

      const withdrawalNo = response?.data?.withdrawal_number || '-';
      alert(`บันทึกใบเบิกเรียบร้อย: ${withdrawalNo}`);

      setDraftItems([]);
      setDocumentNote('');
      setIsDraftModalOpen(false);
      await loadHistory();
    } catch (error) {
      console.error('Error creating withdrawal:', error);
      alert(error.response?.data?.message || 'บันทึกใบเบิกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (!canUseWithdraw) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return <Loading fullScreen />;
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4">
        <Card className="border border-orange-200 bg-orange-50/70">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">เบิกสินค้า</h1>
              <p className="text-sm text-gray-600 mt-1">บันทึกการเบิกแล้ว ปลายทางไม่ต้องกดรับสินค้า</p>
            </div>
            <Button variant="secondary" onClick={() => navigate('/')}>
              กลับหน้าเลือกเมนู
            </Button>
          </div>
        </Card>

        <Card className="p-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleSwitchTab('create')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                activeTab === 'create'
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              สร้างการเบิก
            </button>
            <button
              type="button"
              onClick={() => handleSwitchTab('history')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                activeTab === 'history'
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              ประวัติการเบิก
            </button>
          </div>
        </Card>

        {activeTab === 'create' && (
          <>
            <Card>
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">สาขาปลายทาง</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={targetBranchId}
                    onChange={(e) => {
                      const nextBranchId = e.target.value;
                      setTargetBranchId(nextBranchId);
                      const firstDept = targets.find(
                        (target) => String(target.branch_id) === String(nextBranchId)
                      );
                      setTargetDepartmentId(firstDept ? String(firstDept.id) : '');
                    }}
                  >
                    <option value="">เลือกสาขาปลายทาง</option>
                    {availableBranches.map((branch) => (
                      <option key={branch.branch_id} value={branch.branch_id}>
                        {branch.branch_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">แผนกปลายทาง</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    value={targetDepartmentId}
                    onChange={(e) => setTargetDepartmentId(e.target.value)}
                    disabled={!targetBranchId}
                  >
                    <option value="">เลือกแผนกปลายทาง</option>
                    {availableDepartments.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.department_name}
                      </option>
                    ))}
                  </select>
                  {availableDepartments.length === 0 && (
                    <p className="mt-1 text-xs text-red-600">
                      ไม่พบแผนกปลายทางที่เบิกได้ (ตรวจสอบสิทธิ์หรือผังการผูกต้นทาง)
                    </p>
                  )}
                  {targetDepartment && (
                    <p className="text-xs text-gray-500 mt-1">
                      ปลายทาง: {targetDepartment.branch_name} / {targetDepartment.department_name}
                    </p>
                  )}
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุใบเบิก (ถ้ามี)</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="เช่น เบิกรอบเช้า"
                    value={documentNote}
                    onChange={(e) => setDocumentNote(e.target.value)}
                  />
                </div>
              </div>
            </Card>

            <Card>
              <h2 className="text-lg font-semibold text-gray-900">เพิ่มรายการสินค้า</h2>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">ค้นหาสินค้า</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="พิมพ์ชื่อหรือรหัสสินค้า"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>

              {filteredProducts.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  ไม่พบรายการสินค้า
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mt-3">
                  {filteredProducts.slice(0, 200).map((product) => (
                    <Card
                      key={product.id}
                      onClick={() => handleCardClick(product)}
                      className="relative border border-gray-200 shadow-sm p-3 cursor-pointer hover:shadow-md"
                    >
                      <div className="flex flex-col h-full">
                        <div className="flex-1">
                          <h3 className="font-bold text-sm md:text-base text-gray-900 line-clamp-2 mb-1">
                            {product.name}
                          </h3>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500 truncate">{product.code || '-'}</span>
                            <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded">
                              {product.unit_abbr || product.unit_name || '-'}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 pt-2 border-t">
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => adjustDraftQuantity(product, -0.5)}
                              className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-lg font-bold hover:bg-gray-200 transition-colors flex-shrink-0"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="w-full text-center border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                              placeholder="จำนวน"
                              value={getDraftItem(product.id)?.quantity ?? 0}
                              onChange={(e) => setDraftQuantity(product, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              type="button"
                              onClick={() => adjustDraftQuantity(product, 0.5)}
                              className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-lg font-bold hover:bg-blue-100 transition-colors flex-shrink-0"
                            >
                              +
                            </button>
                          </div>
                          <input
                            type="text"
                            className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                            placeholder="หมายเหตุ"
                            value={getDraftItem(product.id)?.notes ?? ''}
                            onChange={(e) => updateDraftNote(product.id, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}

        {activeTab === 'history' && (
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">ประวัติการเบิก</h2>
              <Button variant="secondary" size="sm" onClick={loadHistory} disabled={historyLoading}>
                {historyLoading ? 'กำลังโหลด...' : 'รีเฟรช'}
              </Button>
            </div>
            {historyLoading ? (
              <p className="text-sm text-gray-500 mt-3">กำลังโหลดประวัติ...</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-500 mt-3">ยังไม่มีประวัติการเบิก</p>
            ) : (
              <div className="mt-3 space-y-2">
                {history.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => openWithdrawalDetail(row.id)}
                    className="w-full text-left border border-gray-200 rounded-lg p-3 hover:border-orange-300 hover:bg-orange-50/50 transition-colors cursor-pointer"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{row.withdrawal_number}</p>
                        <p className="text-sm text-gray-600">ไปที่ {row.target_branch_name} / {row.target_department_name}</p>
                        {row.notes && (
                          <p className="text-xs text-gray-400 mt-0.5">{row.notes}</p>
                        )}
                      </div>
                      <div className="text-right text-sm text-gray-600">
                        <p>{formatDateTime(row.created_at)}</p>
                        <p>{row.item_count} รายการ • รวม {toNumber(row.total_quantity, 0).toFixed(2)}</p>
                        <p className="text-xs text-orange-500 font-medium mt-0.5">กดดูรายละเอียด →</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      {activeTab === 'create' && draftItems.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-40 md:left-auto md:right-8 md:w-[360px]">
          <button
            type="button"
            onClick={() => setIsDraftModalOpen(true)}
            className="w-full rounded-2xl bg-green-600 text-white shadow-lg px-4 py-3 flex items-center justify-between"
          >
            <div className="text-left">
              <p className="font-semibold">รายการที่จะเบิก ({draftItems.length})</p>
              <p className="text-xs text-green-100">กดเพื่อดูรายการที่เลือก</p>
            </div>
            <span className="text-sm font-semibold">เปิด</span>
          </button>
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => {
          if (isEditing) { cancelEditing(); return; }
          setIsDetailModalOpen(false);
          setSelectedWithdrawal(null);
        }}
        title={
          selectedWithdrawal
            ? `${isEditing ? '✏️ แก้ไข ' : ''}${selectedWithdrawal.withdrawal_number}`
            : 'รายละเอียดใบเบิก'
        }
        size="large"
      >
        {detailLoading ? (
          <p className="text-sm text-gray-500 py-4 text-center">กำลังโหลด...</p>
        ) : selectedWithdrawal ? (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">ต้นทาง</p>
                <p className="font-medium text-gray-900">{selectedWithdrawal.source_branch_name}</p>
                <p className="text-gray-600">{selectedWithdrawal.source_department_name}</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">ปลายทาง</p>
                <p className="font-medium text-gray-900">{selectedWithdrawal.target_branch_name}</p>
                <p className="text-gray-600">{selectedWithdrawal.target_department_name}</p>
              </div>
              <div className="col-span-2 flex flex-wrap gap-4 text-xs text-gray-600">
                <span>📅 {formatDateTime(selectedWithdrawal.created_at)}</span>
                {selectedWithdrawal.created_by_name && (
                  <span>👤 {selectedWithdrawal.created_by_name}</span>
                )}
              </div>
            </div>

            {/* Notes — แก้ไขได้ */}
            {isEditing ? (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">หมายเหตุใบเบิก</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="หมายเหตุ (ถ้ามี)"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
            ) : selectedWithdrawal.notes ? (
              <p className="text-xs text-gray-500">📝 {selectedWithdrawal.notes}</p>
            ) : null}

            {/* Items */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                รายการสินค้า ({(isEditing ? editItems : selectedWithdrawal.items)?.length || 0} รายการ)
              </h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[45vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">สินค้า</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">จำนวน</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">หน่วย</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {isEditing
                      ? editItems.map((item) => (
                          <tr key={item.product_id} className={item.quantity <= 0 ? 'opacity-40' : ''}>
                            <td className="px-3 py-2 font-medium text-gray-900">{item.product_name}</td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditItemQty(item.product_id, Math.max(0, item.quantity - 1))}
                                  className="w-7 h-7 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-base font-bold hover:bg-gray-200 flex-shrink-0"
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="w-20 text-center border border-gray-300 rounded-md px-1 py-1 text-sm font-semibold text-orange-700"
                                  value={item.quantity}
                                  onChange={(e) => setEditItemQty(item.product_id, e.target.value)}
                                />
                                <button
                                  type="button"
                                  onClick={() => setEditItemQty(item.product_id, item.quantity + 1)}
                                  className="w-7 h-7 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-base font-bold hover:bg-orange-200 flex-shrink-0"
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{item.unit_abbr || '-'}</td>
                          </tr>
                        ))
                      : (selectedWithdrawal.items || []).map((item) => (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-900">{item.product_name}</td>
                            <td className="px-3 py-2 text-right font-semibold text-orange-700">
                              {toNumber(item.quantity, 0).toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-gray-600">{item.unit_abbr || item.unit_name || '-'}</td>
                          </tr>
                        ))}
                  </tbody>
                  <tfoot className="bg-orange-50 sticky bottom-0">
                    <tr>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-600">รวมทั้งหมด</td>
                      <td className="px-3 py-2 text-right font-bold text-orange-700">
                        {(isEditing ? editItems : (selectedWithdrawal.items || []))
                          .reduce((sum, item) => sum + toNumber(item.quantity, 0), 0)
                          .toFixed(2)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {isEditing && (
                <p className="text-xs text-gray-400 mt-1">* รายการที่จำนวน = 0 จะไม่ถูกบันทึก (สต็อกจะถูกปรับตามส่วนต่าง)</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 py-4 text-center">ไม่พบข้อมูล</p>
        )}

        {/* Footer buttons */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <div>
            {!detailLoading && selectedWithdrawal && !isEditing && (
              <Button variant="primary" onClick={startEditing}>
                ✏️ แก้ไขจำนวน
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button variant="secondary" onClick={cancelEditing} disabled={isSavingEdit}>
                  ยกเลิก
                </Button>
                <Button variant="success" onClick={saveEdit} disabled={isSavingEdit}>
                  {isSavingEdit ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={() => { setIsDetailModalOpen(false); setSelectedWithdrawal(null); }}
              >
                ปิด
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {/* Draft Modal */}
      <Modal
        isOpen={isDraftModalOpen}
        onClose={() => setIsDraftModalOpen(false)}
        title={`รายการที่จะเบิก (${draftItems.length})`}
        size="large"
      >
        {draftItems.length === 0 ? (
          <p className="text-sm text-gray-500">ยังไม่มีรายการ</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {draftItems.map((item) => (
              <div
                key={item.product_id}
                className="border border-gray-200 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <p className="flex-1 font-medium text-gray-900 truncate">
                    {item.product_name}
                  </p>
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                      value={item.quantity}
                      onChange={(e) => updateDraftQuantityById(item.product_id, e.target.value)}
                    />
                    <span className="text-sm text-gray-700">
                      {item.unit_abbr || '-'}
                    </span>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => removeDraftItem(item.product_id)}>
                    ลบ
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setIsDraftModalOpen(false)}>
            ปิด
          </Button>
          <Button
            variant="success"
            onClick={saveWithdrawal}
            disabled={saving || draftItems.length === 0 || !targetDepartmentId}
          >
            {saving ? 'กำลังบันทึก...' : 'ยืนยันเบิกสินค้า'}
          </Button>
        </div>
      </Modal>
    </Layout>
  );
};
