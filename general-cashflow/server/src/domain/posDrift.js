import { roundMoney } from './money.js';

const dateKey = (value) => String(value || '').slice(0, 10);

// Compare each receipt's POS snapshot with the latest ClickHouse totals. A day
// missing from ClickHouse is a real zero day once the receipt was synced.
export function findPosDrift(receipts = [], currentRows = []) {
  const current = new Map(currentRows.map((row) => [`${row.businessDate}|${row.branchCode}`, row]));
  return receipts.filter((receipt) => receipt.clickhouse_synced_at).map((receipt) => {
    const latest = current.get(`${dateKey(receipt.receipt_date)}|${receipt.branch_code}`);
    const latestGross = roundMoney(latest?.grossSalesExpected || 0);
    const latestBills = Number(latest?.billCount || 0);
    const stored = roundMoney(receipt.gross_sales_expected || 0);
    const drift = roundMoney(latestGross - stored);
    return {
      receipt_id: receipt.id,
      receipt_date: dateKey(receipt.receipt_date),
      branch_id: receipt.branch_id,
      branch_code: receipt.branch_code,
      status: receipt.status,
      stored_gross: stored,
      latest_gross: latestGross,
      stored_bill_count: Number(receipt.bill_count || 0),
      latest_bill_count: latestBills,
      drift,
      changed: Math.abs(drift) >= 0.01 || latestBills !== Number(receipt.bill_count || 0)
    };
  });
}

export const posDriftReason = (status, drift) => {
  const amount = `${drift > 0 ? '+' : ''}${drift.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return status === 'CLOSED'
    ? `ยอด POS ใน ClickHouse เปลี่ยนหลังปิดเอกสาร ต่าง ${amount} บาท ต้องปรับปรุงหลังปิด`
    : `ยอด POS ใน ClickHouse เปลี่ยนหลังดึงข้อมูล ต่าง ${amount} บาท ขาด/เกินที่แสดงยังไม่ใช่ยอดจริง`;
};
