import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Input } from '../../../components/common/Input';
import { Select } from '../../../components/common/Select';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { adminAPI } from '../../../api/admin';
import { productsAPI } from '../../../api/products';

const DEFAULT_FORM = {
  enabled: false,
  cutoff_time: '12:00',
  line_group_id: '',
  merge_mode: 'group_daily'
};

const normalizeCutoffInput = (value) => {
  const text = String(value || '').trim();
  if (!text) return '12:00';
  return text.length >= 5 ? text.slice(0, 5) : text;
};

export const DirectOrderRuleManagement = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [enabledFilter, setEnabledFilter] = useState('');
  const [productGroupFilter, setProductGroupFilter] = useState('');
  const [rows, setRows] = useState([]);
  const [productGroups, setProductGroups] = useState([]);
  const [lineGroups, setLineGroups] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedRow = useMemo(
    () => rows.find((row) => Number(row.product_id) === Number(selectedProductId)) || null,
    [rows, selectedProductId]
  );

  const mergeModeOptions = [
    { value: 'group_daily', label: 'รวมตามกลุ่ม + วันสั่ง' },
    { value: 'group_order', label: 'รวมตามกลุ่ม + เลขที่ออเดอร์' }
  ];

  const enabledFilterOptions = [
    { value: 'true', label: 'เปิดใช้งานแล้ว' },
    { value: 'false', label: 'ยังไม่เปิดใช้งาน' }
  ];
  const productGroupFilterOptions = useMemo(
    () =>
      (productGroups || []).map((group) => ({
        value: String(group.id),
        label: group.name || `กลุ่ม ${group.id}`
      })),
    [productGroups]
  );
  const lineGroupOptions = useMemo(
    () =>
      (lineGroups || []).map((group) => ({
        value: String(group.id || ''),
        label: `${group.name || 'กลุ่ม LINE'} (${group.id || '-'})`
      })),
    [lineGroups]
  );

  const applySelectionToForm = (row) => {
    if (!row) {
      setForm(DEFAULT_FORM);
      return;
    }
    setForm({
      enabled: Boolean(row.enabled),
      cutoff_time: normalizeCutoffInput(row.cutoff_time),
      line_group_id: String(row.line_group_id || ''),
      merge_mode: row.merge_mode || 'group_daily'
    });
  };

  const fetchRules = async (keepSelection = true) => {
    try {
      setLoading(true);
      setError('');
      const response = await adminAPI.getDirectOrderRules({
        search: search.trim(),
        enabled: enabledFilter || undefined,
        productGroupId: productGroupFilter || undefined,
        limit: 1000,
        offset: 0
      });
      const items = Array.isArray(response?.data?.items) ? response.data.items : [];
      setRows(items);

      if (!keepSelection || !selectedProductId) {
        const first = items[0] || null;
        setSelectedProductId(first ? Number(first.product_id) : null);
        applySelectionToForm(first);
        return;
      }

      const selected = items.find((item) => Number(item.product_id) === Number(selectedProductId));
      if (selected) {
        applySelectionToForm(selected);
      } else {
        const first = items[0] || null;
        setSelectedProductId(first ? Number(first.product_id) : null);
        applySelectionToForm(first);
      }
    } catch (fetchError) {
      console.error('Error loading direct order rules:', fetchError);
      setError(fetchError?.response?.data?.message || 'ไม่สามารถโหลดข้อมูลการตั้งค่าสั่งตรงได้');
      setRows([]);
      setSelectedProductId(null);
      setForm(DEFAULT_FORM);
    } finally {
      setLoading(false);
    }
  };

  const fetchLineGroups = async ({ silent = false } = {}) => {
    try {
      if (!silent) setGroupsLoading(true);
      const response = await adminAPI.getLineNotificationSettings();
      const data = response?.data || {};
      if (String(data.provider || 'line').toLowerCase() !== 'line') {
        setLineGroups([]);
        return;
      }
      const groups = Array.isArray(data.groups) ? data.groups : [];
      setLineGroups(
        groups
          .filter((group) => group && group.enabled !== false && String(group.id || '').trim())
          .map((group) => ({
            id: String(group.id || '').trim(),
            name: String(group.name || '').trim()
          }))
      );
    } catch (fetchError) {
      console.error('Error loading line groups:', fetchError);
      if (!silent) {
        setError('ไม่สามารถโหลดกลุ่ม LINE ได้');
      }
      setLineGroups([]);
    } finally {
      if (!silent) setGroupsLoading(false);
    }
  };

  useEffect(() => {
    fetchRules(false);
    fetchLineGroups();
    (async () => {
      try {
        const groups = await productsAPI.getProductGroups();
        setProductGroups(Array.isArray(groups) ? groups : []);
      } catch (fetchError) {
        console.error('Error loading product groups:', fetchError);
        setProductGroups([]);
      }
    })();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRules(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, enabledFilter, productGroupFilter]);

  useEffect(() => {
    if (message || error) {
      const timer = setTimeout(() => {
        setMessage('');
        setError('');
      }, 2500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [message, error]);

  const handleSelectProduct = (row) => {
    setSelectedProductId(Number(row.product_id));
    applySelectionToForm(row);
  };

  const handleSave = async () => {
    if (!selectedRow) return;
    if (form.enabled && !String(form.line_group_id || '').trim()) {
      setError('ถ้าเปิดใช้งาน ต้องระบุ LINE Group ID');
      return;
    }

    try {
      setSaving(true);
      setError('');
      setMessage('');
      await adminAPI.updateDirectOrderRule(selectedRow.product_id, {
        enabled: form.enabled,
        cutoff_time: normalizeCutoffInput(form.cutoff_time),
        line_group_id: String(form.line_group_id || '').trim(),
        merge_mode: form.merge_mode
      });
      setMessage('บันทึกสำเร็จ');
      await fetchRules(true);
    } catch (saveError) {
      console.error('Error saving direct order rule:', saveError);
      setError(saveError?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleAddLineGroup = async () => {
    try {
      setSaving(true);
      const current = await adminAPI.getLineNotificationSettings();
      const data = current?.data || {};
      if (String(data.provider || 'line').toLowerCase() !== 'line') {
        setError('กรุณาเปลี่ยนช่องทางแจ้งเตือนเป็น LINE ก่อนเพิ่มกลุ่ม');
        return;
      }

      const name = String(window.prompt('ชื่อกลุ่ม LINE ใหม่') || '').trim();
      if (!name) return;
      const groupId = String(window.prompt('LINE Group ID (เช่น C1234567890abcdef)') || '').trim();
      if (!groupId) return;

      const groups = Array.isArray(data.groups) ? [...data.groups] : [];
      const existed = groups.some((group) => String(group?.id || '').trim() === groupId);
      if (existed) {
        setError('LINE Group ID นี้มีอยู่แล้ว');
        return;
      }

      groups.push({
        id: groupId,
        name,
        enabled: true,
        fields: Array.isArray(data.fields) && data.fields.length > 0 ? data.fields : ['date', 'branch', 'department', 'count', 'items'],
        accessTokens: [],
        quotaMode: 'manual'
      });

      await adminAPI.updateLineNotificationSettings({
        enabled: Boolean(data.enabled),
        provider: 'line',
        fields: Array.isArray(data.fields) && data.fields.length > 0 ? data.fields : ['date', 'branch', 'department', 'count', 'items'],
        groups
      });

      setForm((prev) => ({ ...prev, line_group_id: groupId }));
      setMessage('เพิ่มกลุ่ม LINE สำเร็จ');
      await fetchLineGroups({ silent: true });
    } catch (saveError) {
      console.error('Error adding line group:', saveError);
      setError(saveError?.response?.data?.message || 'เพิ่มกลุ่ม LINE ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ตั้งค่าสั่งตรงผู้ขาย (หลังเวลา)</h1>
            <p className="text-sm text-gray-500 mt-1">
              โครงสร้าง Phase 1: ตั้งค่าสินค้าว่าหลังเวลา cutoff ให้ส่งเข้ากลุ่ม LINE ไหน
            </p>
          </div>
          <BackToSettings />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Card className="xl:col-span-5">
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <Input
                  className="md:col-span-2"
                  placeholder="ค้นหา ชื่อสินค้า / รหัสสินค้า / กลุ่มสินค้า"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Select
                  value={enabledFilter}
                  onChange={(e) => setEnabledFilter(e.target.value)}
                  options={enabledFilterOptions}
                  placeholder="ทุกสถานะ"
                />
                <Select
                  value={productGroupFilter}
                  onChange={(e) => setProductGroupFilter(e.target.value)}
                  options={productGroupFilterOptions}
                  placeholder="ทุกกลุ่มสินค้า"
                />
              </div>

              <div className="border rounded-lg divide-y max-h-[65vh] overflow-auto">
                {loading ? (
                  <div className="p-4 text-sm text-gray-500">กำลังโหลดข้อมูล...</div>
                ) : rows.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">ไม่พบสินค้า</div>
                ) : (
                  rows.map((row) => {
                    const active = Number(row.product_id) === Number(selectedProductId);
                    return (
                      <button
                        key={row.product_id}
                        type="button"
                        onClick={() => handleSelectProduct(row)}
                        className={`w-full text-left p-3 transition ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate">{row.product_name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {row.product_code || '-'} • {row.unit_name || row.unit_abbr || '-'}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 truncate">
                              {row.product_group_names || '-'}
                            </p>
                          </div>
                          <span
                            className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${
                              row.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {row.enabled ? 'เปิด' : 'ปิด'}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </Card>

          <Card className="xl:col-span-7">
            {!selectedRow ? (
              <div className="text-sm text-gray-500">เลือกสินค้าเพื่อเริ่มตั้งค่า</div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{selectedRow.product_name}</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedRow.product_code || '-'} • {selectedRow.unit_name || selectedRow.unit_abbr || '-'}
                  </p>
                  <p className="text-sm text-gray-500 truncate">
                    กลุ่มสินค้า: {selectedRow.product_group_names || '-'}
                  </p>
                </div>

                <div className="border rounded-lg p-3 bg-gray-50">
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={Boolean(form.enabled)}
                      onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    เปิดใช้งานสั่งตรงผู้ขายหลังเวลา cutoff
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="เวลา cutoff (เวลาไทย)"
                    type="time"
                    value={form.cutoff_time}
                    onChange={(e) => setForm((prev) => ({ ...prev, cutoff_time: e.target.value }))}
                  />
                  <Select
                    label="โหมดรวมคำสั่ง"
                    value={form.merge_mode}
                    onChange={(e) => setForm((prev) => ({ ...prev, merge_mode: e.target.value }))}
                    options={mergeModeOptions}
                    placeholder="เลือกโหมดรวม"
                  />
                </div>

                <Input
                  label="LINE Group ID"
                  placeholder="เช่น C1234567890abcdef"
                  value={form.line_group_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, line_group_id: e.target.value }))}
                  required={form.enabled}
                />
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                  <Select
                    label="เลือกจากกลุ่ม LINE ที่มีอยู่"
                    value={form.line_group_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, line_group_id: e.target.value }))}
                    options={lineGroupOptions}
                    placeholder={groupsLoading ? 'กำลังโหลดกลุ่ม LINE...' : 'เลือกกลุ่ม LINE'}
                    disabled={groupsLoading}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => fetchLineGroups()}
                    disabled={groupsLoading || saving}
                  >
                    รีโหลดกลุ่ม
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleAddLineGroup}
                    disabled={saving}
                  >
                    เพิ่มกลุ่ม
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => navigate('/admin/settings/line-notifications')}
                    disabled={saving}
                  >
                    จัดการกลุ่ม
                  </Button>
                </div>

                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                  Phase 1 จะเก็บเฉพาะโครงสร้างการตั้งค่า ยังไม่ส่ง LINE จริงจนกว่าจะเริ่ม Phase 2
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => applySelectionToForm(selectedRow)} disabled={saving}>
                    รีเซ็ต
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {(message || error) && (
          <div className="fixed bottom-4 right-4 z-50">
            <div
              className={`px-4 py-3 rounded-lg text-sm shadow-lg ${
                error ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
              }`}
            >
              {error || message}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};
