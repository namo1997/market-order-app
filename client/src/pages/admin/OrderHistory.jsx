import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { adminAPI } from '../../api/admin';
import { ordersAPI } from '../../api/orders';
import { masterAPI } from '../../api/master';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Loading } from '../../components/common/Loading';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';

const PRODUCTION_SUPPLIER_ID = 8;
const PRODUCTION_SUPPLIER_NAME = 'ผลิตสันกำแพง';

const isProductionItem = (item) =>
  String(item.supplier_id) === String(PRODUCTION_SUPPLIER_ID) ||
  String(item.supplier_name || '') === PRODUCTION_SUPPLIER_NAME;

const aggregateProducts = (items) => {
  const map = new Map();
  const normalizeNotes = (value) =>
    String(value || '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);

  items.forEach((item) => {
    const key = item.product_id;
    if (!map.has(key)) {
      map.set(key, {
        product_id: item.product_id,
        product_name: item.product_name,
        unit_abbr: item.unit_abbr,
        unit_name: item.unit_name,
        purchase_sort_order: item.purchase_sort_order ?? null,
        unit_price:
          item.actual_price ??
          item.requested_price ??
          item.last_actual_price ??
          null,
        total_quantity: 0,
        _notes: new Set()
      });
    }
    const entry = map.get(key);
    entry.total_quantity += Number(item.quantity || 0);
    normalizeNotes(item.notes).forEach((note) => entry._notes.add(note));
    if (
      entry.purchase_sort_order === null &&
      item.purchase_sort_order !== null &&
      item.purchase_sort_order !== undefined
    ) {
      entry.purchase_sort_order = item.purchase_sort_order;
    }
  });

  return Array.from(map.values()).map((product) => {
    const { _notes, ...rest } = product;
    return {
      ...rest,
      notes: Array.from(_notes || []).join(' | '),
      total_amount:
        rest.unit_price !== null
          ? Number(rest.total_quantity || 0) * Number(rest.unit_price || 0)
          : null
    };
  });
};

const formatQuantity = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '';
  const rounded = Math.round(num * 10) / 10;
  const text = rounded.toFixed(1);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
};

const groupItems = (items, type, sortByWalk = false) => {
  const groups = new Map();

  items.forEach((item) => {
    let key = '';
    let name = '';

    if (type === 'supplier') {
      key = item.supplier_id || 'none';
      name = item.supplier_name || 'ไม่ระบุกลุ่มสินค้า';
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

  return Array.from(groups.values()).map((group) => {
    const products = aggregateProducts(group.items);
    const orderedProducts = sortByWalk
      ? [...products].sort((a, b) => {
          const orderA = a.purchase_sort_order ?? 999999;
          const orderB = b.purchase_sort_order ?? 999999;
          if (orderA !== orderB) return orderA - orderB;
          return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th');
        })
      : products;

    return {
      ...group,
      products: orderedProducts
    };
  });
};

const groupItemsByBranchSupplier = (items, sortByWalk = false) => {
  const branches = new Map();

  items.forEach((item) => {
    const key = item.branch_id || 'none';
    const name = item.branch_name || 'ไม่ระบุสาขา';
    if (!branches.has(key)) {
      branches.set(key, { id: key, name, items: [] });
    }
    branches.get(key).items.push(item);
  });

  return Array.from(branches.values())
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      suppliers: groupSuppliers(branch.items, sortByWalk)
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
};
const groupSuppliers = (items, sortByWalk = false) => {
  const suppliers = new Map();

  items.forEach((item) => {
    const key = item.supplier_id || 'none';
    const name = item.supplier_name || 'ไม่ระบุกลุ่มสินค้า';
    if (!suppliers.has(key)) {
      suppliers.set(key, { id: key, name, items: [] });
    }
    suppliers.get(key).items.push(item);
  });

  return Array.from(suppliers.values())
    .map((supplier) => {
      const products = aggregateProducts(supplier.items);
      const orderedProducts = sortByWalk
        ? [...products].sort((a, b) => {
            const orderA = a.purchase_sort_order ?? 999999;
            const orderB = b.purchase_sort_order ?? 999999;
            if (orderA !== orderB) return orderA - orderB;
            return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th');
          })
        : products;
      const totalAmount = products.reduce(
        (sum, product) => sum + Number(product.total_amount || 0),
        0
      );
      return {
        id: supplier.id,
        name: supplier.name,
        products: orderedProducts,
        total_amount: totalAmount
      };
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
};

const buildBranchSupplierMatrix = (branchGroups, sortByWalk = false) => {
  const normalizeBranchName = (name) =>
    String(name || '')
      .replace(/\s+/g, '')
      .trim();
  const getBaseKey = (name) => {
    const normalized = normalizeBranchName(name);
    return normalized
      .replace(/^สาขาผลิต/, '')
      .replace(/^ผลิตสาขา/, '')
      .replace(/^สาขา/, '')
      .replace(/^ผลิต/, '')
      .replace(/สาขา/g, '')
      .replace(/ผลิต/g, '')
      .trim();
  };
  const isProductionBranch = (name) => normalizeBranchName(name).includes('ผลิต');
  const walkBasePriority = ['คันคลอง', 'สันกำแพง'];
  const priorityBases = walkBasePriority;
  const getWalkRank = (name) => {
    const base = getBaseKey(name);
    const baseIndex = walkBasePriority.indexOf(base);
    if (baseIndex === -1) return null;
    const prodRank = isProductionBranch(name) ? 0 : 1;
    return baseIndex * 2 + prodRank;
  };

  const branchList = branchGroups
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      base: getBaseKey(branch.name),
      isProduction: isProductionBranch(branch.name),
      walkRank: getWalkRank(branch.name)
    }))
    .sort((a, b) => {
      if (sortByWalk) {
        const hasRankA = a.walkRank !== null && a.walkRank !== undefined;
        const hasRankB = b.walkRank !== null && b.walkRank !== undefined;
        if (hasRankA || hasRankB) {
          if (!hasRankA) return 1;
          if (!hasRankB) return -1;
          if (a.walkRank !== b.walkRank) return a.walkRank - b.walkRank;
        }
        return String(a.name || '').localeCompare(String(b.name || ''), 'th');
      }

      const indexA = priorityBases.indexOf(a.base);
      const indexB = priorityBases.indexOf(b.base);
      const isPriorityA = indexA !== -1;
      const isPriorityB = indexB !== -1;

      if (isPriorityA || isPriorityB) {
        if (!isPriorityA) return 1;
        if (!isPriorityB) return -1;
        const prodGroupA = a.isProduction ? 0 : 1;
        const prodGroupB = b.isProduction ? 0 : 1;
        if (prodGroupA !== prodGroupB) return prodGroupA - prodGroupB;
        if (indexA !== indexB) return indexA - indexB;
        return String(a.name || '').localeCompare(String(b.name || ''), 'th');
      }

      if (a.base !== b.base) {
        return a.base.localeCompare(b.base, 'th');
      }
      const prodA = a.isProduction ? 1 : 0;
      const prodB = b.isProduction ? 1 : 0;
      if (prodA !== prodB) {
        return prodA - prodB;
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'th');
    })
    .map(({ id, name }) => ({ id, name }));
  const supplierMap = new Map();

  branchGroups.forEach((branch) => {
    branch.suppliers.forEach((supplier) => {
      if (!supplierMap.has(supplier.id)) {
        supplierMap.set(supplier.id, {
          id: supplier.id,
          name: supplier.name,
          products: new Map()
        });
      }
      const supplierEntry = supplierMap.get(supplier.id);

      supplier.products.forEach((product) => {
        if (!supplierEntry.products.has(product.product_id)) {
          supplierEntry.products.set(product.product_id, {
            product_id: product.product_id,
            product_name: product.product_name,
            unit_abbr: product.unit_abbr,
            purchase_sort_order: product.purchase_sort_order ?? null,
            quantities: {},
            total_quantity: 0,
            notes: ''
          });
        }
        const productEntry = supplierEntry.products.get(product.product_id);
        const qty = Number(product.total_quantity || 0);
        if (
          productEntry.purchase_sort_order === null &&
          product.purchase_sort_order !== null &&
          product.purchase_sort_order !== undefined
        ) {
          productEntry.purchase_sort_order = product.purchase_sort_order;
        }
        if (product.notes) {
          const current = new Set(
            String(productEntry.notes || '')
              .split('|')
              .map((part) => part.trim())
              .filter(Boolean)
          );
          String(product.notes)
            .split('|')
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((note) => current.add(note));
          productEntry.notes = Array.from(current).join(' | ');
        }
        productEntry.quantities[branch.id] =
          (productEntry.quantities[branch.id] || 0) + qty;
        productEntry.total_quantity += qty;
      });
    });
  });

  const suppliers = Array.from(supplierMap.values()).map((supplier) => {
    const products = Array.from(supplier.products.values());
    const orderedProducts = sortByWalk
      ? [...products].sort((a, b) => {
          const orderA = a.purchase_sort_order ?? 999999;
          const orderB = b.purchase_sort_order ?? 999999;
          if (orderA !== orderB) return orderA - orderB;
          return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th');
        })
      : products.sort((a, b) =>
          String(a.product_name || '').localeCompare(String(b.product_name || ''), 'th')
        );
    return {
      ...supplier,
      products: orderedProducts
    };
  });

  return { branches: branchList, suppliers };
};

const formatBranchHeader = (name) => {
  if (!name) return [''];
  let label = String(name);
  label = label.replace(/สาขาผลิต/g, 'สาขาผลิต\n');
  label = label.replace(/สาขา(?!ผลิต)/g, 'สาขา\n');
  label = label.replace(/\s+/g, '\n');
  return label
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const formatPrintDate = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('th-TH');
};

const DEFAULT_PRINT_SETTINGS = {
  rowsPerColumn: 0,
  fontSize: 10,
  headerFontSize: 9,
  rowHeight: 16,
  columnGap: 8
};
const DELIVERY_NOTE_ROWS_PER_COLUMN = 24;
const BRANCH_SUPPLIER_ROWS_PER_COLUMN = 48;

const renderProductLabel = (product) => (
  <>
    <div className="branch-product-name">
      {product.product_name}
      {product.unit_abbr ? ` (${product.unit_abbr})` : ''}
    </div>
    {product.notes ? (
      <div className="branch-product-note">หมายเหตุ: {product.notes}</div>
    ) : null}
  </>
);

const splitDeliveryNotePages = (products) => {
  const perPage = DELIVERY_NOTE_ROWS_PER_COLUMN * 2;
  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }

  const pages = [];
  for (let i = 0; i < products.length; i += perPage) {
    const pageProducts = products.slice(i, i + perPage);
    pages.push({
      left: pageProducts.slice(0, DELIVERY_NOTE_ROWS_PER_COLUMN),
      right: pageProducts.slice(DELIVERY_NOTE_ROWS_PER_COLUMN)
    });
  }
  return pages;
};

const toDeliveryNoteRows = (left = [], right = []) =>
  Array.from({ length: Math.max(left.length, right.length) }, (_, index) => ({
    rowNo: index + 1,
    left: left[index] || null,
    right: right[index] || null
  }));

const renderDeliveryNoteSingleTable = (products, keyPrefix) => (
  <table className="print-table print-compact">
    <thead>
      <tr>
        <th className="text-center border" style={{ width: '10%' }}>ลำดับ</th>
        <th className="text-left border" style={{ width: '66%' }}>รายการสินค้า</th>
        <th className="text-center border" style={{ width: '24%' }}>จำนวน</th>
      </tr>
    </thead>
    <tbody>
      {products.map((item, index) => (
        <tr key={`${keyPrefix}-single-${index + 1}`}>
          <td className="border text-center">{index + 1}</td>
          <td className="border text-left">
            {item ? renderProductLabel(item) : ''}
          </td>
          <td className="border text-center">
            {`${formatQuantity(item?.total_quantity || 0)} ${item?.unit_abbr || ''}`.trim()}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const renderDeliveryNoteDualTable = (left, right, keyPrefix) => {
  const hasLeft = left.length > 0;
  const hasRight = right.length > 0;

  if (!hasLeft && !hasRight) {
    return null;
  }

  if (!hasLeft) {
    return renderDeliveryNoteSingleTable(right, `${keyPrefix}-right-only`);
  }

  if (!hasRight) {
    return renderDeliveryNoteSingleTable(left, `${keyPrefix}-left-only`);
  }

  const rows = toDeliveryNoteRows(left, right);

  const renderSideCells = (item, rowNo) => (
    <>
      <td className="border text-center" style={{ width: '6%' }}>
        {item ? rowNo : ''}
      </td>
      <td className="border text-left" style={{ width: '30%' }}>
        {item ? renderProductLabel(item) : ''}
      </td>
      <td className="border text-center" style={{ width: '14%' }}>
        {item
          ? `${formatQuantity(item.total_quantity)} ${item.unit_abbr || ''}`.trim()
          : ''}
      </td>
    </>
  );

  return (
    <table className="print-table print-compact">
      <thead>
        <tr>
          <th colSpan={3} className="text-center border">รายการซ้าย</th>
          <th colSpan={3} className="text-center border">รายการขวา</th>
        </tr>
        <tr>
          <th className="text-center border" style={{ width: '6%' }}>ลำดับ</th>
          <th className="text-left border" style={{ width: '30%' }}>รายการสินค้า</th>
          <th className="text-center border" style={{ width: '14%' }}>จำนวน</th>
          <th className="text-center border" style={{ width: '6%' }}>ลำดับ</th>
          <th className="text-left border" style={{ width: '30%' }}>รายการสินค้า</th>
          <th className="text-center border" style={{ width: '14%' }}>จำนวน</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${keyPrefix}-row-${row.rowNo}`}>
            {renderSideCells(row.left, row.rowNo)}
            {renderSideCells(row.right, row.rowNo)}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const renderBranchDeliveryNoteSheets = (groups, printDate, headingLevel = 2) => {
  const HeadingTag = `h${headingLevel}`;
  const sheets = [];

  groups.forEach((group) => {
    const pages = splitDeliveryNotePages(group.products || []);
    pages.forEach((page, pageIndex) => {
      sheets.push({
        key: `${group.id}-${pageIndex}`,
        groupName: group.name,
        pageIndex,
        totalPages: pages.length,
        totalItems: Number(group.products?.length || 0),
        left: page.left,
        right: page.right
      });
    });
  });

  if (sheets.length === 0) {
    return (
      <div className="text-center text-[11px] text-gray-500 py-6">
        ไม่มีรายการสินค้า
      </div>
    );
  }

  return (
    <div>
      {sheets.map((sheet, index) => {
        const isLast = index === sheets.length - 1;

        return (
          <div
            key={sheet.key}
            className="print-sheet-page delivery-note-page"
            style={{
              breakAfter: isLast ? 'auto' : 'page',
              pageBreakAfter: isLast ? 'auto' : 'always'
            }}
          >
            <div className="delivery-note-layout">
              <div className="delivery-note-main">
                <div className="print-sheet-header">
                  <HeadingTag className="print-sheet-title">ใบส่งสินค้า</HeadingTag>
                  <div className="print-sheet-meta">
                    สาขา {sheet.groupName} • วันที่ {formatPrintDate(printDate)} • รวม {sheet.totalItems}{' '}
                    รายการ • หน้า {sheet.pageIndex + 1}/{sheet.totalPages}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] text-gray-700">
                    เลขที่เอกสาร: DN-{String(printDate || '').replaceAll('-', '')}-{sheet.groupName}
                  </div>
                  <div>
                    {renderDeliveryNoteDualTable(
                      sheet.left,
                      sheet.right,
                      `${sheet.key}-dual`
                    )}
                  </div>
                </div>
              </div>
              <div className="delivery-note-signatures grid grid-cols-2 gap-8 text-[10px] pt-2">
                <div className="text-center">
                  <div>ผู้ส่งสินค้า __________________________</div>
                  <div className="mt-1">วันที่ ______ / ______ / ______</div>
                </div>
                <div className="text-center">
                  <div>ผู้รับสินค้า __________________________</div>
                  <div className="mt-1">วันที่ ______ / ______ / ______</div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const renderBranchSupplierMatrix = (groups, sortByWalk, headingLevel = 2) => {
  const matrix = buildBranchSupplierMatrix(groups, sortByWalk);
  const HeadingTag = `h${headingLevel}`;

  const splitProducts = (products = [], columnCount = 1) => {
    if (products.length === 0) return [];
    const columns = [];
    let startIndex = 0;

    for (let index = 0; index < columnCount; index += 1) {
      if (startIndex >= products.length) break;
      const nextColumn = products.slice(
        startIndex,
        startIndex + BRANCH_SUPPLIER_ROWS_PER_COLUMN
      );
      columns.push(nextColumn);
      startIndex += BRANCH_SUPPLIER_ROWS_PER_COLUMN;
    }

    // กันกรณีข้อมูลเกินความจุจากการคำนวณคอลัมน์ผิดพลาด
    while (startIndex < products.length) {
      columns.push(products.slice(startIndex, startIndex + BRANCH_SUPPLIER_ROWS_PER_COLUMN));
      startIndex += BRANCH_SUPPLIER_ROWS_PER_COLUMN;
    }

    return columns;
  };

  const renderProductTable = (products, keyPrefix) => {
    return (
      <table className="print-table print-compact branch-supplier-table">
        <thead>
          <tr>
            <th className="text-left border" style={{width: '40%'}}>สินค้า</th>
            {matrix.branches.map((branch) => (
              <th
                key={`${keyPrefix}-branch-${branch.id}`}
                className="text-center border whitespace-normal text-[9px] leading-tight"
                style={{width: '35px', maxWidth: '35px'}}
              >
                {formatBranchHeader(branch.name).map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </th>
            ))}
            <th className="text-center border" style={{width: '80px'}}>รวม</th>
            <th className="text-center border" style={{width: '60px'}}>ราคา</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product, rowIndex) => (
            <tr key={`${keyPrefix}-row-${rowIndex}`}>
              <td className="border text-left">
                {renderProductLabel(product)}
              </td>
              {matrix.branches.map((branch) => {
                const qty = Number(product.quantities[branch.id] || 0);
                return (
                  <td
                    key={`${keyPrefix}-row-${rowIndex}-branch-${branch.id}`}
                    className="border text-center"
                  >
                    {qty > 0 ? formatQuantity(qty) : ''}
                  </td>
                );
              })}
              <td className="border text-left font-semibold" style={{width: '80px'}}>
                {formatQuantity(product.total_quantity)}
              </td>
              <td className="border text-center" style={{width: '60px'}} />
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div>
      {matrix.suppliers.map((supplier, index) => {
        const isLast = index === matrix.suppliers.length - 1;
        const columnCount = Math.max(
          1,
          Math.ceil(Number(supplier.products.length || 0) / BRANCH_SUPPLIER_ROWS_PER_COLUMN)
        );
        const columns = splitProducts(supplier.products, columnCount);

        return (
          <div
            key={supplier.id}
            className="print-sheet-page"
            style={{
              breakAfter: isLast ? 'auto' : 'page',
              pageBreakAfter: isLast ? 'auto' : 'always'
            }}
          >
            <div className="print-sheet-header">
              <HeadingTag className="print-sheet-title">{supplier.name}</HeadingTag>
              <div className="print-sheet-meta">
                รวม {supplier.products.length} รายการ
              </div>
            </div>
            <div
              className="print-two-columns"
              style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
            >
              {columns.map((columnProducts, columnIndex) => (
                <div className="print-column" key={`${supplier.id}-col-${columnIndex}`}>
                  {renderProductTable(columnProducts, `${supplier.id}-col-${columnIndex}`)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const buildSummaryGroups = (items, mode) => {
  if (mode === 'all') {
    return [
      {
        id: 'all',
        name: 'รวมทุกสาขา',
        suppliers: groupSuppliers(items)
      }
    ];
  }

  const groups = new Map();

  items.forEach((item) => {
    let key = '';
    let name = '';

    if (mode === 'branch') {
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

  return Array.from(groups.values())
    .map((group) => ({
      id: group.id,
      name: group.name,
      suppliers: groupSuppliers(group.items)
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
};

export const OrderHistory = () => {
  const { isProduction, isAdmin, canViewSupplierOrders, allowedSupplierIds } = useAuth();
  const navigate = useNavigate();
  const [scopedOrderIds, setScopedOrderIds] = useState([]);
  const [searchParams] = useSearchParams();
  const initialDate =
    searchParams.get('date') || new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summaryItems, setSummaryItems] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryView, setSummaryView] = useState('all');
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printDate, setPrintDate] = useState(initialDate);
  const [printType, setPrintType] = useState('supplier');
  const [printSortByWalk, setPrintSortByWalk] = useState(true);
  const [printData, setPrintData] = useState(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingOrderId, setDeletingOrderId] = useState(null);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [moveBranchId, setMoveBranchId] = useState('');
  const [moveDepartmentId, setMoveDepartmentId] = useState('');
  const [movingOrder, setMovingOrder] = useState(false);
  const isSupplierScopedView = canViewSupplierOrders && !isAdmin;
  const scopedSupplierIdSet = useMemo(() => {
    const ids = new Set(
      (allowedSupplierIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    );
    if (isProduction && ids.size === 0) {
      ids.add(PRODUCTION_SUPPLIER_ID);
    }
    return ids;
  }, [allowedSupplierIds, isProduction]);
  const isScopedSupplierItem = (item) => {
    if (scopedSupplierIdSet.size > 0) {
      return scopedSupplierIdSet.has(Number(item.supplier_id));
    }
    if (isProduction) return isProductionItem(item);
    return true;
  };
  const canOpenOrderDetail = !isSupplierScopedView || isProduction;
  const printOptions = [
    { id: 'all', label: 'ทุกรูปแบบ' },
    { id: 'branch', label: 'ตามสาขา' },
    { id: 'department', label: 'ตามแผนก' },
    { id: 'supplier', label: 'ตามกลุ่มสินค้า' },
    { id: 'branch_supplier', label: 'ตามสาขา/กลุ่มสินค้า' }
  ];

  useEffect(() => {
    if (isSupplierScopedView) {
      fetchSummaryItems(true).then((ids) => fetchHistory(ids || []));
      return;
    }
    fetchHistory();
    fetchSummaryItems();
  }, [selectedDate, isSupplierScopedView, scopedSupplierIdSet]);

  useEffect(() => {
    fetchMasterData();
  }, []);

  useEffect(() => {
    if (!selectedOrder || departments.length === 0) return;
    const departmentId = selectedOrder.department_id ? String(selectedOrder.department_id) : '';
    const dept = departments.find((item) => String(item.id) === departmentId);
    setMoveDepartmentId(departmentId);
    setMoveBranchId(dept ? String(dept.branch_id) : '');
  }, [selectedOrder, departments]);

  useEffect(() => {
    setPrintDate(selectedDate);
  }, [selectedDate]);

  const fetchMasterData = async () => {
    try {
      const [branchData, departmentData] = await Promise.all([
        masterAPI.getBranches(),
        masterAPI.getDepartments()
      ]);
      setBranches(Array.isArray(branchData) ? branchData : []);
      setDepartments(Array.isArray(departmentData) ? departmentData : []);
    } catch (error) {
      console.error('Error fetching master data:', error);
      setBranches([]);
      setDepartments([]);
    }
  };

  const fetchHistory = async (orderIds = null) => {
    try {
      setLoading(true);
      const response = await adminAPI.getAllOrders({ date: selectedDate });
      const data = Array.isArray(response.data) ? response.data : [];
      const filtered = data.filter((order) => order.status !== 'submitted');
      if (isSupplierScopedView) {
        const allowedIds = orderIds || scopedOrderIds;
        const idSet = new Set(allowedIds || []);
        setOrders(filtered.filter((order) => idSet.has(order.id)));
        return;
      }
      setOrders(filtered);
    } catch (error) {
      console.error('Error fetching order history:', error);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchSummaryItems = async (returnIds = false) => {
    try {
      setSummaryLoading(true);
      const response = await adminAPI.getOrderItems(selectedDate);
      const items = Array.isArray(response.data) ? response.data : [];
      const filteredItems = isSupplierScopedView ? items.filter(isScopedSupplierItem) : items;
      setSummaryItems(filteredItems);
      if (isSupplierScopedView) {
        const ids = Array.from(
          new Set(filteredItems.map((item) => item.order_id).filter(Boolean))
        );
        setScopedOrderIds(ids);
        if (returnIds) return ids;
      }
    } catch (error) {
      console.error('Error fetching order items:', error);
      setSummaryItems([]);
      if (returnIds) return [];
    } finally {
      setSummaryLoading(false);
    }
    return null;
  };

  const totalAmount = useMemo(() => {
    if (isSupplierScopedView) {
      return summaryItems.reduce((sum, item) => {
        const price =
          item.actual_price ?? item.requested_price ?? item.last_actual_price ?? 0;
        return sum + Number(item.quantity || 0) * Number(price || 0);
      }, 0);
    }
    return orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  }, [orders, summaryItems, isSupplierScopedView]);
  const canEdit = !isSupplierScopedView;
  const canTransferOrder = isAdmin;

  const availableDepartments = useMemo(() => {
    if (!moveBranchId) return [];
    return departments.filter((dept) => String(dept.branch_id) === String(moveBranchId));
  }, [departments, moveBranchId]);

  const formatOrderTime = (value) => {
    if (!value) return '';
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return '';
    return dateValue.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const summaryGroups = useMemo(
    () => buildSummaryGroups(summaryItems, summaryView),
    [summaryItems, summaryView]
  );

  const handlePrint = async () => {
    try {
      setPrintLoading(true);
      const response = await adminAPI.getOrderItems(printDate);
      const items = Array.isArray(response.data) ? response.data : [];
      const filteredItems = isProduction ? items.filter(isProductionItem) : items;
      const effectiveSortByWalk = printType === 'branch_supplier' ? true : printSortByWalk;
      if (printType === 'all') {
        const sections = ['department', 'branch', 'supplier', 'branch_supplier'].map((type) => ({
          type,
          label: printOptions.find((opt) => opt.id === type)?.label || type,
          groups:
            type === 'branch_supplier'
              ? groupItemsByBranchSupplier(filteredItems, true)
              : groupItems(filteredItems, type, effectiveSortByWalk)
        }));
        setPrintData({
          date: printDate,
          type: printType,
          sortByWalk: effectiveSortByWalk,
          sections
        });
      } else if (printType === 'branch_supplier') {
        setPrintData({
          date: printDate,
          type: printType,
          sortByWalk: true,
          groups: groupItemsByBranchSupplier(filteredItems, true)
        });
      } else {
        const grouped = groupItems(filteredItems, printType, effectiveSortByWalk);
        setPrintData({
          date: printDate,
          type: printType,
          sortByWalk: effectiveSortByWalk,
          groups: grouped
        });
      }
      if (isProduction) {
        try {
          await ordersAPI.logProductionPrint({
            date: printDate,
            branchId: 0,
            departmentId: 0
          });
        } catch (logError) {
          console.error('Failed to log production print', logError);
        }
      }
      setPrintModalOpen(false);
      setTimeout(() => window.print(), 200);
    } catch (error) {
      console.error('Error preparing print:', error);
      alert('ไม่สามารถเตรียมข้อมูลพิมพ์ได้');
    } finally {
      setPrintLoading(false);
    }
  };

  const openOrderDetail = async (orderId) => {
    try {
      setDetailLoading(true);
      setEditMode(false);
      const response = await ordersAPI.getOrderById(orderId);
      const order = response.data;
      let scopedItems = order?.items || [];
      if (isProduction) {
        scopedItems = scopedItems.filter((item) =>
          String(item.supplier_name || '') === PRODUCTION_SUPPLIER_NAME
        );
      }
      if (isProduction) {
        const totalAmount = scopedItems.reduce(
          (sum, item) =>
            sum +
            Number(item.quantity || 0) * Number(item.requested_price || 0),
          0
        );
        const nextOrder = {
          ...order,
          items: scopedItems,
          total_amount: totalAmount
        };
        setSelectedOrder(nextOrder);
      } else {
        setSelectedOrder(order);
      }
      setEditItems(
        (scopedItems || []).map((item) => ({
          id: item.id,
          product_id: item.product_id,
          product_name: item.product_name,
          unit_abbr: item.unit_abbr,
          unit_name: item.unit_name,
          quantity: item.quantity,
          requested_price: item.requested_price,
          notes: item.notes || ''
        }))
      );
    } catch (error) {
      console.error('Error fetching order detail:', error);
      alert('ไม่สามารถโหลดรายละเอียดคำสั่งซื้อได้');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleEditItemChange = (itemId, field, value) => {
    setEditItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item
      )
    );
  };

  const handleRemoveEditItem = (itemId) => {
    setEditItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleSaveEdit = async () => {
    if (!canEdit) return;
    if (!selectedOrder) return;
    if (editItems.length === 0) {
      alert('ไม่พบรายการสินค้าให้บันทึก');
      return;
    }

    try {
      setSavingEdit(true);
      const payload = editItems.map((item) => ({
        product_id: item.product_id,
        quantity: Number(item.quantity || 0),
        requested_price: Number(item.requested_price || 0),
        notes: item.notes || ''
      }));
      await ordersAPI.updateOrder(selectedOrder.id, payload);
      alert('บันทึกการแก้ไขคำสั่งซื้อแล้ว');
      await openOrderDetail(selectedOrder.id);
      fetchHistory();
      fetchSummaryItems();
    } catch (error) {
      console.error('Error updating order:', error);
      alert(error.response?.data?.message || 'บันทึกการแก้ไขไม่สำเร็จ');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditItems(
      (selectedOrder?.items || []).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        unit_abbr: item.unit_abbr,
        unit_name: item.unit_name,
        quantity: item.quantity,
        requested_price: item.requested_price,
        notes: item.notes || ''
      }))
    );
  };

  const editTotal = useMemo(() => {
    return editItems.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0) * Number(item.requested_price || 0),
      0
    );
  }, [editItems]);

  const handleMoveBranchChange = (value) => {
    setMoveBranchId(value);
    const nextDept = departments.find((dept) => String(dept.branch_id) === String(value));
    setMoveDepartmentId(nextDept ? String(nextDept.id) : '');
  };

  const handleTransferOrder = async () => {
    if (!selectedOrder) return;
    if (!moveDepartmentId) {
      alert('กรุณาเลือกแผนกที่ต้องการย้าย');
      return;
    }
    if (String(moveDepartmentId) === String(selectedOrder.department_id)) {
      alert('เลือกแผนกใหม่ที่ต่างจากเดิม');
      return;
    }

    const targetDept = departments.find((dept) => String(dept.id) === String(moveDepartmentId));
    const targetBranch = branches.find((branch) => String(branch.id) === String(targetDept?.branch_id));
    const label = `${targetBranch?.name || 'ไม่ระบุสาขา'} • ${targetDept?.name || 'ไม่ระบุแผนก'}`;
    const confirmed = window.confirm(`ย้ายคำสั่งซื้อไปยัง ${label} ใช่หรือไม่?`);
    if (!confirmed) return;

    try {
      setMovingOrder(true);
      await adminAPI.transferOrder(selectedOrder.id, {
        department_id: moveDepartmentId
      });
      alert('ย้ายคำสั่งซื้อแล้ว');
      await openOrderDetail(selectedOrder.id);
      fetchHistory();
      fetchSummaryItems();
    } catch (error) {
      console.error('Error transferring order:', error);
      alert(error.response?.data?.message || 'ย้ายคำสั่งซื้อไม่สำเร็จ');
    } finally {
      setMovingOrder(false);
    }
  };

  const handleDeleteOrder = async () => {
    if (!selectedOrder?.id) return;
    const confirmed = window.confirm('ลบคำสั่งซื้อนี้ออกทั้งหมด?');
    if (!confirmed) return;

    try {
      setDeletingOrderId(selectedOrder.id);
      await ordersAPI.deleteOrder(selectedOrder.id);
      alert('ลบคำสั่งซื้อแล้ว');
      setSelectedOrder(null);
      fetchHistory();
      fetchSummaryItems();
    } catch (error) {
      console.error('Error deleting order:', error);
      alert(error.response?.data?.message || 'ลบคำสั่งซื้อไม่สำเร็จ');
    } finally {
      setDeletingOrderId(null);
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
            {isProduction && (
              <button
                type="button"
                onClick={() => navigate('/')}
                className="px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-100"
              >
                ← ย้อนกลับ
              </button>
            )}
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

        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">สรุปรายการสินค้า</h2>
              <p className="text-sm text-gray-500">
                แยกกลุ่มสินค้าและรวมสินค้าในคำสั่งซื้อ
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {[
                { id: 'all', label: 'รวมทุกสาขา' },
                { id: 'branch', label: 'แยกสาขา' },
                { id: 'department', label: 'แยกแผนก+สาขา' }
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => setSummaryView(option.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold transition ${
                    summaryView === option.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {summaryLoading ? (
            <div className="py-6 text-center text-gray-500">กำลังโหลด...</div>
          ) : summaryItems.length === 0 ? (
            <div className="py-6 text-center text-gray-500">ไม่มีรายการสินค้าในวันนี้</div>
          ) : (
            <div className="mt-4 space-y-4">
              {summaryGroups.map((group) => (
                <div key={group.id} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">{group.name}</h3>
                    <span className="text-xs text-gray-500">
                      {group.suppliers.length} กลุ่มสินค้า
                    </span>
                  </div>
                  {group.suppliers.length === 0 ? (
                    <div className="mt-3 text-sm text-gray-500">
                      ไม่มีรายการสินค้า
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {group.suppliers.map((supplier) => (
                        <div key={supplier.id} className="rounded-lg border border-gray-100 p-3">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-gray-900">{supplier.name}</p>
                            <span className="text-sm text-blue-600 font-semibold">
                              ฿{Number(supplier.total_amount || 0).toFixed(2)}
                            </span>
                          </div>
                          <div className="mt-2 space-y-2 text-sm">
                            {supplier.products.map((product) => (
                              <div
                                key={product.product_id}
                                className="flex items-center justify-between text-gray-600"
                              >
                                <span className="pr-3 min-w-0">
                                  <span className="block truncate">{product.product_name}</span>
                                  {product.notes ? (
                                    <span className="block text-[11px] text-gray-400">
                                      หมายเหตุ: {product.notes}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="whitespace-nowrap">
                                  {product.total_quantity} {product.unit_abbr}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {orders.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow-sm">
            ไม่มีคำสั่งซื้อในวันนี้
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <Card
                key={order.id}
                onClick={() => openOrderDetail(order.id)}
                className="cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {order.branch_name} • {order.department_name}
                    </p>
                    <p className="text-sm text-gray-600">
                      {order.order_number}
                      {formatOrderTime(order.submitted_at || order.created_at || order.order_date)
                        ? ` • เวลา ${formatOrderTime(order.submitted_at || order.created_at || order.order_date)}`
                        : ''}
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
        isOpen={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        title="รายละเอียดคำสั่งซื้อ"
        size="large"
      >
        {detailLoading ? (
          <div className="py-8 text-center text-gray-500">กำลังโหลด...</div>
        ) : (
          selectedOrder && (
            <div>
              <div className="mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">
                    {selectedOrder.branch_name} • {selectedOrder.department_name}
                  </p>
                  <p className="text-sm text-gray-500">
                    {selectedOrder.order_number}
                    {formatOrderTime(selectedOrder.submitted_at || selectedOrder.created_at || selectedOrder.order_date)
                      ? ` • เวลา ${formatOrderTime(selectedOrder.submitted_at || selectedOrder.created_at || selectedOrder.order_date)}`
                      : ''}
                  </p>
                  {canTransferOrder && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                          ย้ายไปสาขา
                        </label>
                        <select
                          value={moveBranchId}
                          onChange={(e) => handleMoveBranchChange(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">เลือกสาขา</option>
                          {branches.map((branch) => (
                            <option key={branch.id} value={branch.id}>
                              {branch.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                          ย้ายไปแผนก
                        </label>
                        <select
                          value={moveDepartmentId}
                          onChange={(e) => setMoveDepartmentId(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={!moveBranchId}
                        >
                          <option value="">เลือกแผนก</option>
                          {availableDepartments.map((dept) => (
                            <option key={dept.id} value={dept.id}>
                              {dept.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={handleTransferOrder}
                          className="w-full px-3 py-2 rounded-lg text-sm text-white bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300"
                          disabled={!moveDepartmentId || movingOrder}
                        >
                          {movingOrder ? 'กำลังย้าย...' : 'ย้ายคำสั่งซื้อ'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {editMode ? (
                    <>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50"
                        disabled={savingEdit}
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        className="px-3 py-1.5 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300"
                        disabled={savingEdit}
                      >
                        {savingEdit ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
                      </button>
                    </>
                  ) : (
                    canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditMode(true)}
                          className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50"
                          disabled={Boolean(deletingOrderId)}
                        >
                          แก้ไขคำสั่งซื้อ
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteOrder}
                          className="px-3 py-1.5 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300"
                          disabled={Boolean(deletingOrderId)}
                        >
                          {deletingOrderId ? 'กำลังลบ...' : 'ลบคำสั่งซื้อ'}
                        </button>
                      </>
                    )
                  )}
                </div>
              </div>
              <div className={editMode ? 'space-y-2 overflow-x-auto' : 'space-y-3'}>
                {editMode && (
                  <div className="min-w-[720px] grid grid-cols-[minmax(180px,2fr)_90px_110px_minmax(140px,2fr)_110px_60px] gap-2 text-xs font-semibold text-gray-500">
                    <div>สินค้า</div>
                    <div className="text-center">จำนวน</div>
                    <div className="text-center">ราคา</div>
                    <div>หมายเหตุ</div>
                    <div className="text-right">รวม</div>
                    <div className="text-right">ลบ</div>
                  </div>
                )}
                {(editMode ? editItems : selectedOrder.items || []).map((item) => (
                  <div
                    key={item.id}
                    className="border-b pb-2 last:border-b-0"
                  >
                    {editMode ? (
                      <div className="min-w-[720px] grid grid-cols-[minmax(180px,2fr)_90px_110px_minmax(140px,2fr)_110px_60px] items-center gap-2">
                        <div className="text-sm font-medium text-gray-900">{item.product_name}</div>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.quantity}
                          onChange={(e) => handleEditItemChange(item.id, 'quantity', e.target.value)}
                          className="px-2 py-1 border rounded-lg text-sm text-right"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.requested_price}
                          onChange={(e) => handleEditItemChange(item.id, 'requested_price', e.target.value)}
                          className="px-2 py-1 border rounded-lg text-sm text-right"
                        />
                        <input
                          type="text"
                          value={item.notes || ''}
                          onChange={(e) => handleEditItemChange(item.id, 'notes', e.target.value)}
                          className="px-2 py-1 border rounded-lg text-sm"
                          placeholder="หมายเหตุ"
                        />
                        <div className="text-right font-semibold text-blue-600">
                          ฿{(Number(item.quantity || 0) * Number(item.requested_price || 0)).toFixed(2)}
                        </div>
                        <div className="text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveEditItem(item.id)}
                            className="text-sm text-red-500 hover:text-red-700"
                          >
                            ลบ
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1">
                          <p className="font-medium">{item.product_name}</p>
                          <p className="text-xs text-gray-500">
                            {item.quantity} {item.unit_abbr} × ฿{item.requested_price}
                          </p>
                          {item.notes && (
                            <p className="text-xs text-gray-400 mt-1">
                              หมายเหตุ: {item.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="font-semibold text-blue-600">
                            ฿{(Number(item.quantity || 0) * Number(item.requested_price || 0)).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t pt-3 mt-4 flex justify-between items-center">
                <span className="font-semibold">ยอดรวม</span>
                <span className="font-bold text-blue-600">
                  ฿{(editMode ? editTotal : Number(selectedOrder.total_amount || 0)).toFixed(2)}
                </span>
              </div>
            </div>
          )
        )}
      </Modal>

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
              {printOptions.map((option) => (
                <label key={option.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="printType"
                    value={option.id}
                    checked={printType === option.id}
                    onChange={() => setPrintType(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">ตัวเลือกเพิ่มเติม</label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={printType === 'branch_supplier' ? true : printSortByWalk}
                onChange={(e) => setPrintSortByWalk(e.target.checked)}
                disabled={printType === 'branch_supplier'}
              />
              เรียงตามการเดินซื้อของ{printType === 'branch_supplier' ? ' (บังคับ)' : ''}
            </label>
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
        <div className="hidden print:block p-2">
          <style>{`
            @page { size: A4 portrait; margin: 6mm; }
            body { margin: 6mm; }
            .print-nowrap { white-space: nowrap; }
            .print-compact th, .print-compact td { padding-top: 2px; padding-bottom: 2px; }
            .print-grid { border-collapse: collapse; width: 100%; }
            .print-grid th, .print-grid td { border: 1px solid #bdbdbd; }
            .print-grid td { height: 18px; }
            .print-page-header { position: fixed; top: 0; left: 0; right: 0; text-align: center; font-size: 10px; color: #6b7280; }
            .print-page-spacer { height: 10px; }
            .print-table { border-collapse: collapse; width: 100%; font-size: 10px; }
            .print-table th, .print-table td { border: 1px solid #000; padding: 3px 6px; }
            .print-table th { font-size: 9px; font-weight: 600; background-color: #f3f4f6; }
            .print-table td { font-size: 10px; }
            .print-sheet-page { page-break-after: always; }
            .print-sheet-page:last-child { page-break-after: auto; }
            .print-sheet-header { text-align: center; margin-bottom: 8px; }
            .print-sheet-title { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
            .print-sheet-meta { font-size: 10px; color: #6b7280; }
            .print-two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .print-column { }
            .branch-supplier-table th, .branch-supplier-table td { padding: 1px 4px; }
            .branch-supplier-table th { font-size: 9.5px; line-height: 1.1; }
            .branch-supplier-table td {
              font-size: 10px;
              line-height: 1.15;
              vertical-align: middle;
            }
            .branch-supplier-table tbody tr { height: 5.25mm; }
            .branch-product-name, .branch-product-note {
              display: block;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 100%;
            }
            .branch-supplier-table .branch-product-name { font-size: 9.5px; line-height: 1.1; }
            .branch-supplier-table .branch-product-note { font-size: 8.5px; line-height: 1.1; }
            .branch-product-note { color: #4b5563; }
            .delivery-note-page { min-height: 260mm; display: flex; flex-direction: column; }
            .delivery-note-layout { flex: 1; display: flex; flex-direction: column; }
            .delivery-note-main { }
            .delivery-note-signatures { margin-top: auto; }
          `}</style>
          {printData.type !== 'branch' && (
            <>
              <div className="print-page-header">
                วันที่ {formatPrintDate(printData.date)}
              </div>
              <div className="print-page-spacer" />
            </>
          )}
          {printData.type !== 'branch_supplier' && printData.type !== 'branch' && (
            <div className="text-center mb-6">
              <h1 className="text-xl font-bold">สรุปรายการสั่งซื้อ</h1>
              <p className="text-sm text-gray-600">
                วันที่ {formatPrintDate(printData.date)}
              </p>
              <p className="text-xs text-gray-500">
                รูปแบบ: {printOptions.find((option) => option.id === printData.type)?.label || printData.type}
                {printData.sortByWalk ? ' • เรียงตามการเดินซื้อของ' : ''}
              </p>
            </div>
          )}
          {printData.type === 'branch_supplier' && (
            <div className="text-center mb-2">
              <p className="text-xs text-gray-500">
                รูปแบบ: {printOptions.find((option) => option.id === printData.type)?.label || printData.type}
                {printData.sortByWalk ? ' • เรียงตามการเดินซื้อของ' : ''}
              </p>
            </div>
          )}
          {printData.type === 'all'
            ? printData.sections.map((section) => (
                <div key={section.type} className="mb-8">
                  <h2 className="font-bold mb-3">{section.label}</h2>
                  {section.type === 'branch_supplier'
                    ? (() => {
                        return renderBranchSupplierMatrix(
                          section.groups,
                          printData.sortByWalk,
                          3
                        );
                      })()
                    : section.type === 'branch'
                      ? (() => {
                          return renderBranchDeliveryNoteSheets(
                            section.groups,
                            printData.date,
                            3
                          );
                        })()
                    : section.groups.map((group) => (
                        <div key={group.id} className="mb-6">
                          <h3 className="font-semibold mb-2">{group.name}</h3>
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
                                    {renderProductLabel(product)}
                                  </td>
                                  <td className="py-1 text-right">
                                    {formatQuantity(product.total_quantity)} {product.unit_abbr}
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
              ))
            : printData.type === 'branch_supplier'
              ? (() => {
                  return renderBranchSupplierMatrix(
                    printData.groups,
                    printData.sortByWalk,
                    2
                  );
                })()
              : printData.type === 'branch'
                ? (() => {
                    return renderBranchDeliveryNoteSheets(
                      printData.groups,
                      printData.date,
                      2
                    );
                  })()
              : printData.groups.map((group) => (
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
                              {renderProductLabel(product)}
                            </td>
                            <td className="py-1 text-right">
                              {formatQuantity(product.total_quantity)} {product.unit_abbr}
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
