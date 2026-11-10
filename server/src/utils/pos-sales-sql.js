// SQL ยอดขาย POS (ClickHouse) ที่ใช้ร่วมกันทุกจุด: Discord, AI, LINE, ตัดสต็อกตามสูตร, HRMS
// ตรวจกับข้อมูลจริงแล้ว 10 พ.ย. 69 (กติกาเดียวกับ reports.controller ที่ตรงกับแอป POS ทุกวัน):
// - dedebi.doc.docdatetime เป็นนาฬิกาไทยอยู่แล้ว (server ตั้ง Asia/Bangkok) ห้าม addHours(+7) ซ้ำ
//   ไม่งั้นบิลหลัง 17:00 ไปตกวันถัดไป
// - dedetemp.ordertemplog.orderdatetime เก็บนาฬิกา UTC ไว้ในคอลัมน์ DateTime (สั่ง 03:56 = จ่าย 11:11 ไทย)
//   ต้องอ่านเป็น UTC ก่อนแปลงเป็นไทย และช่วงเวลาที่กรองต้องเป็นนาฬิกา UTC แบบเดียวกัน
// - doc / productbarcode เป็น ReplacingMergeTree ต้อง FINAL, docdetail เป็น MergeTree ซ้ำได้ ต้อง DISTINCT
export const POS_TIME_ZONE = 'Asia/Bangkok';
export const BANGKOK_UTC_OFFSET_HOURS = 7;

export const escapeClickHouse = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "''");

export const posLocalTime = (column = 'd.docdatetime') => `toTimeZone(${column}, '${POS_TIME_ZONE}')`;
export const posSaleDate = (column = 'd.docdatetime') => `toDate(${posLocalTime(column)})`;
export const posSaleHour = (column = 'd.docdatetime') => `toHour(${posLocalTime(column)})`;
export const posSaleWeekday = (column = 'd.docdatetime') => `toDayOfWeek(${posLocalTime(column)})`;
export const posLocalText = (column = 'd.docdatetime') => `formatDateTime(${posLocalTime(column)}, '%F %T')`;
export const posUtcText = (column = 'd.docdatetime') => `formatDateTime(${column}, '%F %T', 'UTC')`;

// บางบิลมีแค่ guidbranch หรือ branchid อย่างใดอย่างหนึ่ง ใช้ลำดับเดียวกับหน้ายอดขายและ cashflow
export const posBranchExpr = (alias = 'd') =>
  `coalesce(nullIf(${alias}.guidbranch, ''), nullIf(${alias}.branchid, ''), '')`;
export const posBranchFilter = (clickhouseBranchId, alias = 'd') => {
  const id = String(clickhouseBranchId || '').trim();
  return id ? `AND ${posBranchExpr(alias)} = '${escapeClickHouse(id)}'` : '';
};

const salesDetailSource = (shopId) => `(SELECT DISTINCT
    shopid, docno, line_number, transflag, barcode, itemname, unitcode,
    qty, price, sumamount, discount, discountamount, ischoice, sumamountchoice
  FROM docdetail
  WHERE shopid = '${escapeClickHouse(shopId)}'
    AND transflag = 44)`;

// เงื่อนไขบิลขายจริงของวันไทย start..end (รวมทั้งสองวัน)
export const posBillWhere = ({ shopId, start, end = start, branchId = null }) => `
      WHERE d.shopid = '${escapeClickHouse(shopId)}'
        AND d.transflag = 44
        AND d.iscancel = 0
        AND ${posSaleDate()} BETWEEN toDate('${escapeClickHouse(start)}') AND toDate('${escapeClickHouse(end)}')
        ${posBranchFilter(branchId)}`;

// ยอดต่อวันต่อสาขา (ระดับหัวบิล ไม่ join รายการ จึงไม่ตกบิลที่ไม่มีรายการ)
export const buildPosDailyByBranchSql = ({ shopId, start, end = start, branchId = null }) => `
      SELECT ${posSaleDate()} AS sale_date,
             ${posBranchExpr()} AS clickhouse_branch_id,
             count() AS bill_count,
             round(sum(d.totalamount), 2) AS total_revenue
      FROM doc AS d FINAL
      ${posBillWhere({ shopId, start, end, branchId })}
      GROUP BY sale_date, clickhouse_branch_id
      ORDER BY sale_date ASC, clickhouse_branch_id ASC`;

export const buildPosBillCountSql = ({ shopId, date, branchId = null }) => `
      SELECT count() AS sales_count
      FROM doc AS d FINAL
      ${posBillWhere({ shopId, start: date, end: date, branchId })}`;

const BREAKDOWN_KEYS = { hourly: posSaleHour(), weekday: posSaleWeekday(), daily: posSaleDate() };
export const buildPosSalesBreakdownSql = ({ shopId, start, end = start, branchId = null, grain = 'daily' }) => `
      SELECT ${BREAKDOWN_KEYS[grain] || BREAKDOWN_KEYS.daily} AS sale_key,
             count() AS bill_count,
             round(sum(d.totalamount), 2) AS total_revenue
      FROM doc AS d FINAL
      ${posBillWhere({ shopId, start, end, branchId })}
      GROUP BY sale_key
      ORDER BY sale_key`;

// ยอดระดับรายการ (เมนู/บาร์โค้ด): ผู้เรียกกำหนด SELECT / GROUP BY / ORDER BY เอง
// ใช้ alias d = หัวบิล, dd = รายการขาย (ไม่ซ้ำ)
export const buildPosLineSalesSql = ({
  shopId, start, end = start, branchId = null, select, where = '', groupBy, orderBy = '', limit = null
}) => `
      SELECT ${select}
      FROM doc AS d FINAL
      JOIN ${salesDetailSource(shopId)} dd ON d.shopid = dd.shopid AND d.docno = dd.docno
      ${posBillWhere({ shopId, start, end, branchId })}
        ${where ? `AND ${where}` : ''}
      GROUP BY ${groupBy}
      ${orderBy ? `ORDER BY ${orderBy}` : ''}
      ${Number.isInteger(limit) && limit > 0 ? `LIMIT ${limit}` : ''}`;

// รายการขายต่อบิลสำหรับตัดสต็อกตามสูตร: เวลาไทยและเวลา UTC จริงของบิล
export const buildRecipeSaleLinesSql = ({ shopId, start, end = start, branchId = null }) => buildPosLineSalesSql({
  shopId,
  start,
  end,
  branchId,
  select: `${posSaleDate()} AS sale_date,
             ${posLocalText()} AS sale_datetime_local,
             ${posUtcText()} AS sale_datetime_utc,
             d.docno AS sale_doc_no,
             ${posBranchExpr()} AS clickhouse_branch_id,
             dd.barcode AS barcode,
             any(dd.itemname) AS menu_name,
             sum(dd.qty) AS total_qty`,
  groupBy: 'sale_date, sale_datetime_local, sale_datetime_utc, sale_doc_no, clickhouse_branch_id, dd.barcode'
});

// ── ordertemplog (ยอดขายรายพนักงานให้ HRMS) ──────────────────────────────
export const orderLogLocalTime = (column = 'orderdatetime') =>
  `toTimeZone(toDateTime(toString(${column}), 'UTC'), '${POS_TIME_ZONE}')`;
// ขอบเวลาจริง (ISO เช่น 2026-11-09T17:00:00.000Z) → นาฬิกา UTC แบบที่คอลัมน์เก็บ
export const orderLogBound = (isoText) =>
  `toDateTime(formatDateTime(parseDateTimeBestEffort('${escapeClickHouse(isoText)}'), '%F %T', 'UTC'))`;

export const buildEmployeeOrderSalesSql = ({ shopId, branchId, employeeCodes, from, to }) => {
  const codes = employeeCodes.map((code) => `'${escapeClickHouse(code)}'`).join(', ');
  const localTime = orderLogLocalTime();
  return `
      SELECT
        trimBoth(orderemployeecode) AS employee_code,
        argMax(trimBoth(orderemployeedetail), orderdatetime) AS employee_name,
        formatDateTime(toStartOfHour(${localTime}), '%Y-%m-%d %H:00:00') AS sale_hour,
        trimBoth(barcode) AS barcode,
        argMax(trimBoth(names), orderdatetime) AS product_name,
        trimBoth(unitcode) AS unit_code,
        argMax(trimBoth(unitname), orderdatetime) AS unit_name,
        sum(orderqty - cancelqty) AS net_qty,
        sum((orderqty - cancelqty) * price) AS net_sales_amount,
        countDistinct(docno) AS bill_count,
        count() AS line_count,
        formatDateTime(max(${localTime}), '%F %T') AS latest_order_at
      FROM dedetemp.ordertemplog
      WHERE shopid = '${escapeClickHouse(shopId)}'
        AND branch = '${escapeClickHouse(branchId)}'
        AND trimBoth(orderemployeecode) IN (${codes})
        AND orderdatetime >= ${orderLogBound(from)}
        AND orderdatetime < ${orderLogBound(to)}
        AND isordersuccess = 1
        AND ispaysuccess = 1
        AND orderqty - cancelqty != 0
      GROUP BY employee_code, sale_hour, barcode, unit_code
      HAVING net_qty != 0
      ORDER BY sale_hour, employee_code, product_name`;
};

// ── รหัสกันตัดสต็อกซ้ำ ─────────────────────────────────────────────────────
const digitsOfLocal = (text) => String(text || '').replace(/\D/g, '').slice(0, 14);
const docToken = (docNo) => String(docNo || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'na';

export const recipeSaleReferenceId = ({ saleDate, saleLocal, branchId, departmentId, productId, docNo }) =>
  `recipe-sale-bill:${saleDate}:${digitsOfLocal(saleLocal)}:branch${branchId}:dept${departmentId}:product${productId}:doc${docToken(docNo)}`;

// รหัสที่ระบบเดิม (ก่อน 10 พ.ย. 69) สร้างให้บิลเดียวกัน: วันที่และเวลาถูกบวก 7 ชม. ซ้ำ
// ต้องเช็คด้วย ไม่งั้นบิลที่ตัดไปแล้วจะถูกตัดซ้ำเมื่อ sync ช่วงวันเดิมอีกครั้ง
export const shiftLocalText = (text, hours) => {
  const ms = Date.parse(`${String(text || '').trim().replace(' ', 'T')}Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + hours * 3600000).toISOString().replace('T', ' ').slice(0, 19);
};
export const previousClockRecipeSaleReferenceId = ({ saleLocal, ...rest }) => {
  const shifted = shiftLocalText(saleLocal, BANGKOK_UTC_OFFSET_HOURS);
  return shifted ? recipeSaleReferenceId({ ...rest, saleDate: shifted.slice(0, 10), saleLocal: shifted }) : null;
};
