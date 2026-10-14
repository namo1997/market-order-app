import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { Loading } from '../../../components/common/Loading';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { adminAPI } from '../../../api/admin';
import { productsAPI } from '../../../api/products';
import { masterAPI } from '../../../api/master';
import { downloadCsv } from '../../../utils/csv';

const formatNumber = (value) => Number(value || 0).toFixed(2);
const formatCurrency = (value) => `฿${Number(value || 0).toFixed(2)}`;
const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('th-TH');
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const downloadBlob = (filename, blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const exportAsExcel = (filename, title, headers, rows) => {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const rowsHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8" />
    <style>
      table { border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; }
      th { background: #f3f4f6; }
      h2 { margin: 0 0 8px; font-family: Arial, sans-serif; font-size: 16px; }
      .meta { color: #6b7280; margin-bottom: 10px; font-family: Arial, sans-serif; font-size: 12px; }
    </style>
  </head><body>
    <h2>${escapeHtml(title)}</h2>
    <div class="meta">ส่งออกเมื่อ ${escapeHtml(new Date().toLocaleString('th-TH'))}</div>
    <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
  </body></html>`;
  downloadBlob(
    filename,
    new Blob([`\uFEFF${html}`], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  );
};

const exportAsPdf = (title, headers, rows) => {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const rowsHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 10mm; }
      body { font-family: Arial, sans-serif; font-size: 12px; color: #111827; }
      h2 { margin: 0 0 8px; font-size: 16px; }
      .meta { color: #6b7280; margin-bottom: 10px; font-size: 12px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; }
    </style>
  </head><body>
    <h2>${escapeHtml(title)}</h2>
    <div class="meta">ส่งออกเมื่อ ${escapeHtml(new Date().toLocaleString('th-TH'))}</div>
    <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
    <script>window.onload = () => { setTimeout(() => window.print(), 100); };</script>
  </body></html>`;
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    if (iframe.parentNode) {
      document.body.removeChild(iframe);
    }
  }, 10000);
};

const PRICE_MODE_OPTIONS = [
  { id: 'default', label: 'อิงจากราคาตั้งต้น' },
  { id: 'latest', label: 'อิงจากราคาล่าสุด' },
  { id: 'day', label: 'อิงจากราคาในวันนั้นๆ' }
];

export const PurchaseReport = () => {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [priceMode, setPriceMode] = useState('day');
  const [useReceived, setUseReceived] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [productGroupId, setProductGroupId] = useState('');
  const [productGroups, setProductGroups] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [walkDetailOpen, setWalkDetailOpen] = useState(false);
  const [walkDetailRows, setWalkDetailRows] = useState([]);
  const [walkDetailLoading, setWalkDetailLoading] = useState(false);
  const [walkDetailError, setWalkDetailError] = useState('');
  const [exportFormat, setExportFormat] = useState('csv');
  const [exportDataMode, setExportDataMode] = useState('summary');
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportPreviewHeaders, setExportPreviewHeaders] = useState([]);
  const [exportPreviewRows, setExportPreviewRows] = useState([]);
  const [exportPreviewLoading, setExportPreviewLoading] = useState(false);
  const [exportPreviewError, setExportPreviewError] = useState('');
  const [productDailyOpen, setProductDailyOpen] = useState(false);
  const [productDailyRows, setProductDailyRows] = useState([]);
  const [productDailyLoading, setProductDailyLoading] = useState(false);
  const [productDailyError, setProductDailyError] = useState('');
  const [selectedProductDaily, setSelectedProductDaily] = useState(null);

  useEffect(() => {
    const fetchReport = async () => {
      try {
        setLoading(true);
        const response = await adminAPI.getPurchaseWalkValueReport({
          start: startDate,
          end: endDate,
          view: 'branch_department',
          priceMode,
          useReceived,
          branchId: branchId || undefined,
          departmentId: departmentId || undefined,
          productGroupId: productGroupId || undefined
        });
        setRows(Array.isArray(response.data) ? response.data : []);
      } catch (error) {
        console.error('Error fetching purchase report:', error);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [startDate, endDate, priceMode, useReceived, productGroupId, branchId, departmentId]);

  useEffect(() => {
    const fetchProductGroups = async () => {
      try {
        const data = await productsAPI.getProductGroups();
        setProductGroups(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error fetching product groups:', error);
        setProductGroups([]);
      }
    };

    fetchProductGroups();
  }, []);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const data = await masterAPI.getBranches();
        setBranches(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error fetching branches:', error);
        setBranches([]);
      }
    };

    fetchBranches();
  }, []);

  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        const data = await masterAPI.getDepartments();
        setDepartments(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Error fetching departments:', error);
        setDepartments([]);
      }
    };

    fetchDepartments();
  }, []);

  const filteredDepartments = useMemo(() => {
    if (!branchId) return departments;
    return departments.filter((department) => String(department.branch_id) === String(branchId));
  }, [departments, branchId]);

  useEffect(() => {
    if (!departmentId) return;
    const exists = filteredDepartments.some(
      (department) => String(department.id) === String(departmentId)
    );
    if (!exists) {
      setDepartmentId('');
    }
  }, [departmentId, filteredDepartments]);

  const filteredRows = useMemo(() => {
    let scoped = rows;
    if (branchId) {
      scoped = scoped.filter((row) => String(row.branch_id || '') === String(branchId));
    }
    if (departmentId) {
      scoped = scoped.filter((row) => String(row.department_id || '') === String(departmentId));
    }
    return scoped;
  }, [rows, branchId, departmentId]);

  const summary = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.total_amount += Number(row.total_amount || 0);
          acc.total_quantity += Number(row.total_quantity || 0);
          acc.item_count += Number(row.item_count || 0);
          return acc;
        },
        {
          total_amount: 0,
          total_quantity: 0,
          item_count: 0
        }
      ),
    [filteredRows]
  );

  const uniqueBranchCount = useMemo(
    () => new Set(filteredRows.map((row) => String(row.branch_id || '')).filter(Boolean)).size,
    [filteredRows]
  );

  const walkAggregateRows = useMemo(() => {
    const totalQuantity = filteredRows.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0);
    const totalAmount = filteredRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const itemCount = filteredRows.reduce((sum, row) => sum + Number(row.item_count || 0), 0);
    const branchLabel = branchId
      ? branches.find((branch) => String(branch.id) === String(branchId))?.name || '-'
      : 'ทั้งหมด';
    const departmentLabel = departmentId
      ? departments.find((department) => String(department.id) === String(departmentId))?.name || '-'
      : 'ทั้งหมด';
    const groupLabel = productGroupId
      ? productGroups.find((group) => String(group.id) === String(productGroupId))?.name || '-'
      : 'ทั้งหมด';

    if (itemCount <= 0 && totalQuantity <= 0 && totalAmount <= 0) {
      return [];
    }

    return [
      {
        id: 'walk-aggregate',
        period: `${formatDate(startDate)} - ${formatDate(endDate)}`,
        branch_name: branchLabel,
        department_name: departmentLabel,
        group_name: groupLabel,
        item_count: itemCount,
        total_quantity: totalQuantity,
        total_amount: totalAmount,
        price_mode_label:
          PRICE_MODE_OPTIONS.find((option) => option.id === priceMode)?.label || PRICE_MODE_OPTIONS[2].label,
        quantity_basis_label: useReceived ? 'รับเข้าจริง' : 'ซื้อจริง'
      }
    ];
  }, [
    filteredRows,
    branchId,
    branches,
    departmentId,
    departments,
    productGroupId,
    productGroups,
    startDate,
    endDate,
    priceMode,
    useReceived
  ]);

  const handleOpenWalkDetail = async () => {
    setWalkDetailOpen(true);
    setWalkDetailLoading(true);
    setWalkDetailError('');
    try {
      const response = await adminAPI.getPurchaseWalkValueDetailReport({
        start: startDate,
        end: endDate,
        priceMode,
        useReceived,
        branchId: branchId || undefined,
        departmentId: departmentId || undefined,
        productGroupId: productGroupId || undefined
      });
      setWalkDetailRows(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching purchase walk detail:', error);
      setWalkDetailRows([]);
      setWalkDetailError('โหลดรายละเอียดรายการสินค้าไม่สำเร็จ');
    } finally {
      setWalkDetailLoading(false);
    }
  };

  const handleOpenProductDailyDetail = async (row) => {
    if (!row?.product_id) return;
    setSelectedProductDaily({
      productId: row.product_id,
      productName: row.product_name || '-',
      unitAbbr: row.unit_abbr || '',
      branchName: row.branch_name || '',
      departmentName: row.department_name || ''
    });
    setProductDailyOpen(true);
    setProductDailyLoading(true);
    setProductDailyError('');
    try {
      const response = await adminAPI.getPurchaseWalkValueProductDetailByDateReport({
        start: startDate,
        end: endDate,
        productId: row.product_id,
        priceMode,
        useReceived,
        branchId: row.branch_id || branchId || undefined,
        departmentId: row.department_id || departmentId || undefined,
        productGroupId: productGroupId || undefined
      });
      setProductDailyRows(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching product daily detail:', error);
      setProductDailyRows([]);
      setProductDailyError('โหลดรายละเอียดรายวันของสินค้าไม่สำเร็จ');
    } finally {
      setProductDailyLoading(false);
    }
  };

  const walkColumnsNoDaily = useMemo(
    () => [
      { header: 'ช่วงวันที่', accessor: 'period', wrap: true },
      { header: 'สาขา', accessor: 'branch_name', wrap: true },
      { header: 'แผนก', accessor: 'department_name', wrap: true },
      { header: 'กลุ่มสินค้า', accessor: 'group_name', wrap: true },
      { header: 'ฐานจำนวน', accessor: 'quantity_basis_label', wrap: true },
      { header: 'จำนวนรายการ', accessor: 'item_count' },
      {
        header: useReceived ? 'ปริมาณรับจริง' : 'ปริมาณซื้อ',
        accessor: 'total_quantity',
        render: (row) => formatNumber(row.total_quantity)
      },
      {
        header: useReceived ? 'มูลค่าอิงรับจริง' : 'มูลค่าซื้อ',
        accessor: 'total_amount',
        render: (row) => (
          <button
            type="button"
            onClick={handleOpenWalkDetail}
            className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
          >
            {formatCurrency(row.total_amount)}
          </button>
        )
      },
      { header: 'โหมดราคา', accessor: 'price_mode_label', wrap: true }
    ],
    [handleOpenWalkDetail, useReceived]
  );

  const walkDetailColumns = useMemo(() => {
    const columns = [];
    if (!branchId) {
      columns.push({ header: 'สาขา', accessor: 'branch_name', wrap: true });
    }
    if (!departmentId) {
      columns.push({ header: 'แผนก', accessor: 'department_name', wrap: true });
    }
    columns.push(
      {
        header: 'สินค้า',
        accessor: 'product_name',
        wrap: true,
        render: (row) => (
          <button
            type="button"
            onClick={() => handleOpenProductDailyDetail(row)}
            className="font-medium text-blue-600 hover:text-blue-700 hover:underline text-left"
          >
            {row.product_name}
          </button>
        )
      },
      {
        header: 'จำนวน',
        accessor: 'total_quantity',
        render: (row) => `${formatNumber(row.total_quantity)} ${row.unit_abbr || ''}`.trim()
      },
      {
        header: 'ราคา',
        accessor: 'unit_price',
        render: (row) => formatCurrency(row.unit_price)
      },
      {
        header: 'มูลค่า',
        accessor: 'total_amount',
        render: (row) => formatCurrency(row.total_amount)
      }
    );
    return columns;
  }, [branchId, departmentId, handleOpenProductDailyDetail]);

  const walkDetailSummary = useMemo(
    () =>
      walkDetailRows.reduce(
        (acc, row) => {
          acc.totalQuantity += Number(row.total_quantity || 0);
          acc.totalAmount += Number(row.total_amount || 0);
          return acc;
        },
        { totalQuantity: 0, totalAmount: 0 }
      ),
    [walkDetailRows]
  );

  const productDailyColumns = useMemo(() => {
    const columns = [{ header: 'วันที่', accessor: 'report_date', render: (row) => formatDate(row.report_date) }];
    if (!branchId) {
      columns.push({ header: 'สาขา', accessor: 'branch_name', wrap: true });
    }
    if (!departmentId) {
      columns.push({ header: 'แผนก', accessor: 'department_name', wrap: true });
    }
    columns.push(
      {
        header: 'จำนวน',
        accessor: 'total_quantity',
        render: (row) => `${formatNumber(row.total_quantity)} ${row.unit_abbr || ''}`.trim()
      },
      {
        header: 'ราคา',
        accessor: 'unit_price',
        render: (row) => formatCurrency(row.unit_price)
      },
      {
        header: 'มูลค่า',
        accessor: 'total_amount',
        render: (row) => formatCurrency(row.total_amount)
      }
    );
    return columns;
  }, [branchId, departmentId]);

  const productDailySummary = useMemo(
    () =>
      productDailyRows.reduce(
        (acc, row) => {
          acc.totalQuantity += Number(row.total_quantity || 0);
          acc.totalAmount += Number(row.total_amount || 0);
          return acc;
        },
        { totalQuantity: 0, totalAmount: 0 }
      ),
    [productDailyRows]
  );

  const selectedPriceModeLabel =
    PRICE_MODE_OPTIONS.find((option) => option.id === priceMode)?.label || PRICE_MODE_OPTIONS[2].label;

  const mainExportHeaders = useMemo(
    () => ['ช่วงวันที่', 'สาขา', 'แผนก', 'กลุ่มสินค้า', 'ฐานจำนวน', 'จำนวนรายการ', 'ปริมาณ', 'มูลค่า', 'โหมดราคา'],
    []
  );
  const mainExportRows = useMemo(
    () =>
      walkAggregateRows.map((row) => [
        row.period,
        row.branch_name,
        row.department_name,
        row.group_name,
        row.quantity_basis_label,
        Number(row.item_count || 0),
        formatNumber(row.total_quantity),
        formatNumber(row.total_amount),
        row.price_mode_label
      ]),
    [walkAggregateRows]
  );

  const prepareExportData = async () => {
    if (exportDataMode === 'summary') {
      return {
        headers: mainExportHeaders,
        rows: mainExportRows,
        title: `รายงานการซื้อของ (${startDate} - ${endDate})`
      };
    }
    const response = await adminAPI.getPurchaseWalkValueDetailReport({
      start: startDate,
      end: endDate,
      priceMode,
      useReceived,
      branchId: branchId || undefined,
      departmentId: departmentId || undefined,
      productGroupId: productGroupId || undefined
    });
    const detailRows = Array.isArray(response.data) ? response.data : [];
    const headers = ['สาขา', 'แผนก', 'สินค้า', 'จำนวน', 'หน่วย', 'ราคา', 'มูลค่า'];
    const rows = detailRows.map((row) => [
      row.branch_name || '-',
      row.department_name || '-',
      row.product_name || '-',
      formatNumber(row.total_quantity),
      row.unit_abbr || '-',
      formatNumber(row.unit_price),
      formatNumber(row.total_amount)
    ]);
    return {
      headers,
      rows,
      title: `รายงานการซื้อของ (รายละเอียดสินค้า) (${startDate} - ${endDate})`
    };
  };

  const handleExportReport = async () => {
    const prepared =
      exportPreviewRows.length > 0
        ? {
            headers: exportPreviewHeaders,
            rows: exportPreviewRows,
            title:
              exportDataMode === 'summary'
                ? `รายงานการซื้อของ (${startDate} - ${endDate})`
                : `รายงานการซื้อของ (รายละเอียดสินค้า) (${startDate} - ${endDate})`
          }
        : await prepareExportData();
    if (!prepared.rows.length) return;
    const baseName = `purchase_report_${startDate}_${endDate}`;
    if (exportFormat === 'excel') {
      exportAsExcel(`${baseName}.xls`, prepared.title, prepared.headers, prepared.rows);
      return;
    }
    if (exportFormat === 'pdf') {
      exportAsPdf(prepared.title, prepared.headers, prepared.rows);
      return;
    }
    downloadCsv(`${baseName}.csv`, prepared.headers, prepared.rows);
  };

  const handleOpenExportPreview = async () => {
    if (mainExportRows.length === 0) return;
    setExportPreviewOpen(true);
    setExportPreviewLoading(true);
    setExportPreviewError('');
    try {
      const prepared = await prepareExportData();
      setExportPreviewHeaders(prepared.headers);
      setExportPreviewRows(prepared.rows);
    } catch (error) {
      console.error('Error preparing export preview:', error);
      setExportPreviewHeaders([]);
      setExportPreviewRows([]);
      setExportPreviewError('โหลดตัวอย่าง Export ไม่สำเร็จ');
    } finally {
      setExportPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!exportPreviewOpen) return;
    handleOpenExportPreview();
  }, [
    exportPreviewOpen,
    exportDataMode,
    startDate,
    endDate,
    priceMode,
    useReceived,
    branchId,
    departmentId,
    productGroupId
  ]);

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
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">รายงานการซื้อของ</h1>
            <p className="text-sm text-gray-500">สรุปรวมช่วงเวลา (ไม่แยกรายวัน)</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={exportDataMode}
              onChange={(e) => setExportDataMode(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
            >
              <option value="summary">สรุป</option>
              <option value="detail">รายละเอียดสินค้า</option>
            </select>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
            >
              <option value="csv">CSV</option>
              <option value="excel">Excel</option>
              <option value="pdf">PDF</option>
            </select>
            <button
              type="button"
              onClick={handleOpenExportPreview}
              disabled={mainExportRows.length === 0}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              ดูตัวอย่าง
            </button>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">เริ่ม</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">ถึง</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">สาขา</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="bg-transparent text-sm text-gray-900 focus:outline-none"
              >
                <option value="">ทั้งหมด</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">แผนก</label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="bg-transparent text-sm text-gray-900 focus:outline-none"
              >
                <option value="">ทั้งหมด</option>
                {filteredDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <label className="text-xs font-semibold text-gray-500">กลุ่มสินค้า</label>
              <select
                value={productGroupId}
                onChange={(e) => setProductGroupId(e.target.value)}
                className="bg-transparent text-sm text-gray-900 focus:outline-none"
              >
                <option value="">ทั้งหมด</option>
                {productGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm text-sm text-gray-700">
              <input
                type="checkbox"
                checked={useReceived}
                onChange={(e) => setUseReceived(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              อิงรับเข้าจริง (เดิม)
            </label>
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-2 text-xs font-semibold text-gray-500">
            การคำนวณมูลค่า: {selectedPriceModeLabel}
          </div>
          <div className="flex flex-wrap gap-2">
            {PRICE_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPriceMode(option.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                  priceMode === option.id
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-blue-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">{useReceived ? 'มูลค่าอิงรับจริง' : 'มูลค่าซื้อจริง'}</p>
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary.total_amount)}</p>
            </div>
          </Card>
          <Card className="bg-emerald-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">จำนวนรายการ</p>
              <p className="text-2xl font-bold text-emerald-600">{summary.item_count}</p>
            </div>
          </Card>
          <Card className="bg-amber-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">{useReceived ? 'ปริมาณรับจริง' : 'ปริมาณซื้อ'}</p>
              <p className="text-2xl font-bold text-amber-600">{formatNumber(summary.total_quantity)}</p>
            </div>
          </Card>
          <Card className="bg-rose-50">
            <div className="text-center">
              <p className="text-gray-600 text-sm">สาขาที่มีรายการในช่วง</p>
              <p className="text-2xl font-bold text-rose-600">{uniqueBranchCount}</p>
            </div>
          </Card>
        </div>

        <DataTable
          columns={walkColumnsNoDaily}
          data={walkAggregateRows}
          rowKey={(row, index) => row.id || `walk-summary-${index}`}
          showActions={false}
        />
      </div>
      <Modal
        isOpen={exportPreviewOpen}
        onClose={() => setExportPreviewOpen(false)}
        title="ตัวอย่างก่อน Export"
        size="xlarge"
      >
        <div className="space-y-3">
          <div className="text-sm text-gray-600">
            รูปแบบไฟล์: {exportFormat.toUpperCase()} · ข้อมูล:{' '}
            {exportDataMode === 'summary' ? 'สรุป' : 'รายละเอียดสินค้า'} · ช่วงวันที่ {formatDate(startDate)} -{' '}
            {formatDate(endDate)}
          </div>
          {exportPreviewLoading ? (
            <div className="py-6 text-center text-sm text-gray-500">กำลังโหลดตัวอย่าง...</div>
          ) : exportPreviewError ? (
            <div className="py-6 text-center text-sm text-red-600">{exportPreviewError}</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600">
                    {exportPreviewHeaders.map((header) => (
                      <th key={header} className="px-3 py-2 font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exportPreviewRows.map((row, rowIndex) => (
                    <tr key={`preview-row-${rowIndex}`} className="border-t border-gray-100">
                      {row.map((cell, cellIndex) => (
                        <td key={`preview-cell-${rowIndex}-${cellIndex}`} className="px-3 py-2 text-gray-900">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setExportPreviewOpen(false)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ปิด
            </button>
            <button
              type="button"
              onClick={handleExportReport}
              disabled={exportPreviewRows.length === 0 || exportPreviewLoading}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              ยืนยัน Export
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={walkDetailOpen}
        onClose={() => setWalkDetailOpen(false)}
        title="รายละเอียดรายการสินค้า (จำนวน/ราคา)"
        size="xlarge"
      >
        <div className="space-y-3">
          <div className="text-sm text-gray-600">
            ช่วงวันที่ {formatDate(startDate)} - {formatDate(endDate)} · โหมดราคา {selectedPriceModeLabel} · ฐานจำนวน{' '}
            {useReceived ? 'รับเข้าจริง' : 'ซื้อจริง'}
          </div>
          {walkDetailLoading ? (
            <div className="py-6 text-center text-sm text-gray-500">กำลังโหลดรายละเอียด...</div>
          ) : walkDetailError ? (
            <div className="py-6 text-center text-sm text-red-600">{walkDetailError}</div>
          ) : (
            <>
              <DataTable
                columns={walkDetailColumns}
                data={walkDetailRows}
                rowKey={(row, index) => `${row.branch_id || 'all'}-${row.product_id || 'p'}-${index}`}
                showActions={false}
                dense
              />
              {walkDetailRows.length > 0 && (
                <div className="flex items-center justify-end gap-6 border-t pt-3 text-sm font-semibold text-gray-900">
                  <span>รวมจำนวน {formatNumber(walkDetailSummary.totalQuantity)}</span>
                  <span>รวมมูลค่า {formatCurrency(walkDetailSummary.totalAmount)}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
      <Modal
        isOpen={productDailyOpen}
        onClose={() => setProductDailyOpen(false)}
        title={`รายละเอียดรายวัน: ${selectedProductDaily?.productName || '-'}`}
        size="large"
      >
        <div className="space-y-3">
          <div className="text-sm text-gray-600">
            ช่วงวันที่ {formatDate(startDate)} - {formatDate(endDate)} · โหมดราคา {selectedPriceModeLabel} · ฐานจำนวน{' '}
            {useReceived ? 'รับเข้าจริง' : 'ซื้อจริง'}
          </div>
          {productDailyLoading ? (
            <div className="py-6 text-center text-sm text-gray-500">กำลังโหลดรายละเอียดรายวัน...</div>
          ) : productDailyError ? (
            <div className="py-6 text-center text-sm text-red-600">{productDailyError}</div>
          ) : (
            <>
              <DataTable
                columns={productDailyColumns}
                data={productDailyRows}
                rowKey={(row, index) => `${row.report_date || 'd'}-${row.branch_id || 'b'}-${row.department_id || 'dp'}-${index}`}
                showActions={false}
                dense
              />
              {productDailyRows.length > 0 && (
                <div className="flex items-center justify-end gap-6 border-t pt-3 text-sm font-semibold text-gray-900">
                  <span>รวมจำนวน {formatNumber(productDailySummary.totalQuantity)}</span>
                  <span>รวมมูลค่า {formatCurrency(productDailySummary.totalAmount)}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </Layout>
  );
};
