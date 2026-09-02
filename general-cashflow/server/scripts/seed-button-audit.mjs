import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.CASHFLOW_DB_HOST || '127.0.0.1',
  port: Number(process.env.CASHFLOW_DB_PORT || 3317),
  user: process.env.CASHFLOW_DB_USER || 'cashflow_preview',
  password: process.env.CASHFLOW_DB_PASSWORD || 'cashflow-preview',
  database: process.env.CASHFLOW_DB_NAME || 'general_cashflow_preview'
});

const statuses = [
  ['2026-08-14', 'DRAFT'],
  ['2026-08-15', 'SUBMITTED'],
  ['2026-08-16', 'CHECKED_OK'],
  ['2026-08-17', 'CHECKED_VARIANCE'],
  ['2026-08-18', 'NEEDS_CORRECTION'],
  ['2026-08-19', 'CLOSED']
];

await connection.beginTransaction();
try {
  const [[existingBranch]] = await connection.query('SELECT id FROM branches WHERE code = ?', ['BUTTON_AUDIT']);
  if (existingBranch) {
    await connection.query('DELETE FROM daily_receipts WHERE branch_id = ?', [existingBranch.id]);
    await connection.query('DELETE FROM receiving_accounts WHERE branch_id = ?', [existingBranch.id]);
    await connection.query('DELETE FROM branches WHERE id = ?', [existingBranch.id]);
  }
  const [branchResult] = await connection.query(
    'INSERT INTO branches (code, name, clickhouse_branch_id) VALUES (?, ?, NULL)',
    ['BUTTON_AUDIT', 'สาขาทดสอบปุ่ม (ข้อมูลจำลอง)']
  );
  const branchId = Number(branchResult.insertId);
  const [channels] = await connection.query(
    "SELECT id, code FROM payment_channels WHERE code IN ('CASH','QR_KPLUS','GRAB') ORDER BY sort_order"
  );
  if (channels.length !== 3) throw new Error('Expected CASH, QR_KPLUS, and GRAB channels');

  const [accountResult] = await connection.query(
    `INSERT INTO receiving_accounts (branch_id, label, bank_name, account_number)
     VALUES (?, ?, ?, ?)`,
    [branchId, 'บัญชีรับเงินทดสอบ', 'ธนาคารทดสอบ', 'BUTTON-AUDIT-0001']
  );
  const accountId = Number(accountResult.insertId);
  for (const channel of channels.filter((row) => row.code !== 'CASH')) {
    await connection.query(
      'INSERT INTO receiving_account_channels (receiving_account_id, payment_channel_id) VALUES (?, ?)',
      [accountId, channel.id]
    );
    await connection.query(
      `INSERT INTO receiving_account_channel_branches
       (receiving_account_id, payment_channel_id, branch_id) VALUES (?, ?, ?)`,
      [accountId, channel.id, branchId]
    );
  }

  const created = [];
  for (let index = 0; index < statuses.length; index += 1) {
    const [receiptDate, status] = statuses[index];
    const cash = 5000 + index * 100;
    const qr = 3200 + index * 100;
    const grab = 1800 + index * 100;
    const gross = cash + qr + grab;
    const cashierVariance = status === 'CHECKED_VARIANCE' ? 25 : 0;
    const [receiptResult] = await connection.query(
      `INSERT INTO daily_receipts
       (receipt_date, branch_id, status, gross_sales_expected, cash_expected,
        non_cash_expected, bill_count, submitted_at, checked_at, closed_at,
        table_check_acknowledged_at, table_check_status, open_table_count,
        cashier_variance_acknowledged_at, cashier_variance_acknowledged_amount,
        correction_note)
       VALUES (?, ?, ?, ?, ?, ?, ?,
         IF(? IN ('SUBMITTED','CHECKED_OK','CHECKED_VARIANCE','NEEDS_CORRECTION','CLOSED'), NOW(), NULL),
         IF(? IN ('CHECKED_OK','CHECKED_VARIANCE','NEEDS_CORRECTION','CLOSED'), NOW(), NULL),
         IF(? = 'CLOSED', NOW(), NULL), NOW(), 'NO_OPEN_TABLES', 0,
         IF(? = 'CHECKED_VARIANCE', NOW(), NULL), ?,
         IF(? = 'NEEDS_CORRECTION', 'ข้อมูลจำลองสำหรับทดสอบส่งกลับแก้ไข', NULL))`,
      [receiptDate, branchId, status, gross, cash, qr + grab, 42 + index,
        status, status, status, status, cashierVariance, status]
    );
    const receiptId = Number(receiptResult.insertId);
    for (const channel of channels) {
      const expected = channel.code === 'CASH' ? cash : channel.code === 'QR_KPLUS' ? qr : grab;
      const entered = expected + (channel.code === 'QR_KPLUS' ? cashierVariance : 0);
      const statement = channel.code === 'CASH' ? 0 : entered;
      const [lineResult] = await connection.query(
        `INSERT INTO daily_receipt_lines
         (receipt_id, payment_channel_id, expected_amount, cashier_amount,
          statement_amount, variance_amount, variance_reason, source_description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [receiptId, channel.id, expected, entered, statement, entered - expected,
          cashierVariance && channel.code === 'QR_KPLUS' ? 'ส่วนต่างจำลองเพื่อทดสอบ' : null,
          `BUTTON_AUDIT ${channel.code}`]
      );
      const lineId = Number(lineResult.insertId);
      await connection.query(
        `INSERT INTO receipt_line_reconciliations
         (receipt_line_id, receiving_account_id, expected_gross_amount, fee_amount,
          expected_net_amount, matched_amount, settlement_date, settlement_status,
          settlement_source, cashier_reference_variance_amount,
          settlement_variance_amount, manual_checked_without_reference,
          manual_checked_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [lineId, channel.code === 'CASH' ? null : accountId, entered, entered, statement,
          channel.code === 'CASH' ? null : receiptDate,
          channel.code === 'CASH' ? 'READY_FOR_STATEMENT' : 'MATCHED_AUTO',
          channel.code === 'CASH' ? 'NONE' : 'BANK_STATEMENT',
          channel.code === 'CASH' ? 0 : 0,
          channel.code === 'CASH' ? 0 : 1,
          channel.code === 'CASH' ? null : new Date()]
      );
    }
    created.push({ id: receiptId, date: receiptDate, status });
  }
  await connection.commit();
  console.log(JSON.stringify({ branchId, created }, null, 2));
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
