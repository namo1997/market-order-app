import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useGeneralPurchase } from '../../contexts/GeneralPurchaseContext';
import { employeeRefsAPI } from '../../api/employee-refs';
import { PageShell, formatCurrency } from '../general-purchase/shared';


const EXPENSE_TYPES = [
  'อุปกรณ์ครัว',
  'อุปกรณ์หน้าร้าน',
  'อุปกรณ์สำนักงาน',
  'ค่าซ่อมบำรุง',
  'ค่าบริการทั่วไป',
  'วัสดุสิ้นเปลือง',
  'ของใช้ทำความสะอาด',
  'ค่าเดินทาง/ขนส่ง',
  'อื่นๆ',
];

const employeeLabel = (employee) => {
  const name = employee.full_name || `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
  const nick = employee.nickname ? ` (${employee.nickname})` : '';
  return `${employee.employee_code} - ${name}${nick}`;
};

const blankItem = () => ({
  id: Date.now() + Math.random(),
  name: '',
  quantity: '',
  unit: '',
  totalPrice: '',
  note: '',
  imageDataUrl: '',
  imageName: '',
});

export const GeneralPurchase = () => {
  const navigate = useNavigate();
  const { access, createRequest } = useGeneralPurchase();
  const sessionUser = access?.user || {};
  const isEmployeeHeadSession = sessionUser.mode === 'employee_head';
  const [items, setItems] = useState([blankItem()]);
  const [requestedBy, setRequestedBy] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [employees, setEmployees] = useState([]);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeError, setEmployeeError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [header, setHeader] = useState({
    branch: '',
    department: '',
    expenseType: '',
    requestDate: new Date().toISOString().slice(0, 10),
    purpose: '',
  });

  useEffect(() => {
    if (isEmployeeHeadSession) return;
    const loadEmployees = async () => {
      try {
        setEmployeeLoading(true);
        setEmployeeError('');
        const result = await employeeRefsAPI.getAll({ isActive: true, isHead: true, limit: 500 });
        setEmployees(Array.isArray(result?.data) ? result.data : []);
      } catch (error) {
        setEmployeeError('โหลดรายชื่อพนักงานไม่สำเร็จ');
      } finally {
        setEmployeeLoading(false);
      }
    };

    loadEmployees();
  }, [isEmployeeHeadSession]);

  useEffect(() => {
    if (!isEmployeeHeadSession) return;
    setSelectedEmployeeId(`employee:${sessionUser.employeeCode || sessionUser.employeeId || 'current'}`);
    setRequestedBy(sessionUser.fullName || sessionUser.employeeCode || 'หัวหน้างาน');
    setHeader((current) => ({
      ...current,
      branch: sessionUser.branchName || '',
      department: sessionUser.departmentName || '',
    }));
  }, [
    isEmployeeHeadSession,
    sessionUser.branchName,
    sessionUser.departmentName,
    sessionUser.employeeCode,
    sessionUser.employeeId,
    sessionUser.fullName,
  ]);

  const handleEmployeeSelect = (employeeId) => {
    setSelectedEmployeeId(employeeId);
    const employee = employees.find((item) => String(item.id) === String(employeeId));
    if (!employee) {
      setRequestedBy('');
      return;
    }

    setRequestedBy(employee.full_name || `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || employee.employee_code);
    setHeader((current) => ({
      ...current,
      branch: employee.branch_name || '',
      department: employee.department_name || '',
    }));
  };

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0),
    [items]
  );
  const updateHeader = (field, value) => setHeader((cur) => ({ ...cur, [field]: value }));
  const updateItem = (id, field, value) =>
    setItems((cur) => cur.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  const addItem = () => setItems((cur) => [...cur, blankItem()]);
  const removeItem = (id) =>
    setItems((cur) => (cur.length === 1 ? cur : cur.filter((item) => item.id !== id)));

  const attachItemImage = (id, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setSubmitError('แนบได้เฉพาะไฟล์รูปภาพ');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSubmitError('รูปภาพต้องไม่เกิน 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      updateItem(id, 'imageDataUrl', String(reader.result || ''));
      updateItem(id, 'imageName', file.name);
      setSubmitError('');
    };
    reader.readAsDataURL(file);
  };

  const removeItemImage = (id) => {
    updateItem(id, 'imageDataUrl', '');
    updateItem(id, 'imageName', '');
  };

  const validate = () => {
    if (!selectedEmployeeId) return 'ไม่พบข้อมูลผู้ขอซื้อจากระบบพนักงาน';
    if (!header.branch.trim()) return 'ไม่พบสาขาของพนักงาน';
    if (!header.department.trim()) return 'ไม่พบแผนกของพนักงาน';
    if (!header.expenseType.trim()) return 'เลือกประเภทค่าใช้จ่าย';
    if (!header.purpose.trim()) return 'กรอกวัตถุประสงค์';
    const validItems = items.filter((it) => it.name.trim() && Number(it.totalPrice) > 0);
    if (validItems.length === 0) return 'ต้องมีรายการอย่างน้อย 1 รายการ พร้อมราคาประมาณ';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setSubmitError(err);
      return;
    }
    setSubmitError('');
    const cleanItems = items
      .filter((it) => it.name.trim() && Number(it.totalPrice) > 0)
      .map((it) => ({
        name: it.name.trim(),
        quantity: Number(it.quantity) || 0,
        unit: it.unit || '',
        totalPrice: Number(it.totalPrice) || 0,
        note: it.note || '',
        imageDataUrl: it.imageDataUrl || '',
        imageName: it.imageName || '',
      }));
    try {
      await createRequest({ header, items: cleanItems, requestedBy: requestedBy.trim() || 'ผู้ใช้' });
      navigate('/general-purchase/hub?created=1');
    } catch (error) {
      setSubmitError(error.response?.data?.message || 'ส่ง PR ไม่สำเร็จ');
    }
  };

  return (
    <PageShell
      current="/general-purchase"
      stepperKey="pr"
      title="สั่งซื้อทั่วไป — สร้าง PR"
      subtitle="พนักงานผู้ขอซื้อกรอกข้อมูล แล้วส่งให้ฝ่ายตรวจสอบ"
      role="ผู้ขอซื้อ"
    >
      <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">ข้อมูลคำขอ</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="วันที่ขอซื้อ" type="date" value={header.requestDate} onChange={(e) => updateHeader('requestDate', e.target.value)} />
          {isEmployeeHeadSession ? (
            <div className="lg:col-span-2">
              <Input
                label="ผู้ขอซื้อ (เชื่อมจากระบบพนักงาน)"
                required
                value={[
                  sessionUser.employeeCode,
                  sessionUser.fullName,
                  sessionUser.positionName,
                ].filter(Boolean).join(' - ')}
                disabled
              />
            </div>
          ) : (
            <label className="block text-sm font-medium text-gray-700 lg:col-span-2">
              ผู้ขอซื้อ (หัวหน้างานขึ้นไป) <span className="text-red-500">*</span>
              <select
                value={selectedEmployeeId}
                onChange={(e) => handleEmployeeSelect(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{employeeLoading ? 'กำลังโหลดรายชื่อ...' : 'เลือกหัวหน้างาน'}</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employeeLabel(employee)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium text-gray-700">
            ประเภทค่าใช้จ่าย <span className="text-red-500">*</span>
            <select
              required
              value={header.expenseType}
              onChange={(e) => updateHeader('expenseType', e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">เลือกประเภท</option>
              {EXPENSE_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          <Input label="สาขาตามสังกัด" required value={header.branch} disabled placeholder="เลือกพนักงานก่อน" />
          <Input label="แผนกตามสังกัด" required value={header.department} disabled placeholder="เลือกพนักงานก่อน" />
          <div className="sm:col-span-2">
            <Input label="วัตถุประสงค์ / หมายเหตุรวม" required value={header.purpose} onChange={(e) => updateHeader('purpose', e.target.value)} placeholder="อธิบายเหตุผลการสั่งซื้อ" />
          </div>
        </div>
        {employeeError && !isEmployeeHeadSession && (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {employeeError} — ให้กด sync พนักงานจาก backend ก่อน
          </div>
        )}
      </div>


      <div className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">รายการที่ต้องการซื้อ</h2>
            <p className="text-sm text-slate-500">ราคา ณ จุดนี้คือราคาประมาณ ฝ่ายรับของจะลงราคาจริงตอนรับสินค้า</p>
          </div>
          <Button type="button" onClick={addItem}>+ เพิ่มรายการ</Button>
        </div>

        <div className="mt-4 space-y-3">
          {items.map((item, index) => (
            <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">รายการที่ {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={items.length === 1}
                  className="rounded-md px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:text-slate-300 disabled:hover:bg-transparent"
                >
                  ลบ
                </button>
              </div>
              <div className="space-y-2">
                <Input label="ชื่อรายการ" value={item.name} onChange={(e) => updateItem(item.id, 'name', e.target.value)} placeholder="เช่น หม้อสแตนเลส" />
                <div className="grid grid-cols-2 gap-2">
                  <Input label="จำนวน" type="number" value={item.quantity} onChange={(e) => updateItem(item.id, 'quantity', e.target.value)} placeholder="0" />
                  <Input label="หน่วย" value={item.unit} onChange={(e) => updateItem(item.id, 'unit', e.target.value)} placeholder="ใบ / อัน" />
                </div>
                <Input label="ราคารวม (ประมาณ)" type="number" value={item.totalPrice} onChange={(e) => updateItem(item.id, 'totalPrice', e.target.value)} placeholder="0.00" />
                <Input label="หมายเหตุ" value={item.note} onChange={(e) => updateItem(item.id, 'note', e.target.value)} placeholder="ไม่บังคับ" />
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-700">รูปสินค้า / ตัวอย่างสินค้า</div>
                      <div className="text-xs text-slate-500">แนบได้ 1 รูปต่อรายการ ขนาดไม่เกิน 2MB</div>
                    </div>
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100">
                      แนบรูป
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => attachItemImage(item.id, e.target.files?.[0])}
                      />
                    </label>
                  </div>
                  {item.imageDataUrl && (
                    <div className="mt-3 flex items-center gap-3">
                      <img src={item.imageDataUrl} alt={item.imageName || item.name || 'item'} className="h-20 w-20 rounded-xl border border-slate-200 object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-700">{item.imageName || 'รูปสินค้า'}</div>
                        <button type="button" onClick={() => removeItemImage(item.id)} className="mt-1 text-xs font-bold text-rose-600">
                          ลบรูป
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {submitError && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {submitError}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-slate-900 p-4 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-slate-300">ยอดรวมประมาณ</div>
            <div className="text-2xl font-bold">{formatCurrency(subtotal)}</div>
            <div className="mt-1 text-xs text-slate-400">ข้อมูลผู้ขาย/ภาษีจะกรอกตอนออก PO</div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button type="button" variant="secondary" fullWidth onClick={() => window.print()}>
              พิมพ์แบบร่าง
            </Button>
            <Button type="button" fullWidth onClick={handleSubmit}>
              ส่ง PR
            </Button>
          </div>
        </div>
      </div>
    </PageShell>
  );
};
