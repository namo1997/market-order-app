import { confirmedBankTransactionTotal } from './domain/receiptsOverview.js';

export const recalculateStatementAmount = async (connection, receiptLineId) => {
  const [rows] = await connection.query(
    `SELECT st.*, si.original_name AS import_name,
            COALESCE(st.receiving_account_id, si.receiving_account_id) AS account_id
     FROM statement_transactions st
     JOIN statement_imports si ON si.id = st.import_id
     WHERE st.receipt_line_id = ?`,
    [receiptLineId]
  );
  const amount = confirmedBankTransactionTotal(rows);
  await connection.query('UPDATE daily_receipt_lines SET statement_amount = ? WHERE id = ?', [amount, receiptLineId]);
  await connection.query('UPDATE receipt_line_reconciliations SET matched_amount = ? WHERE receipt_line_id = ?', [amount, receiptLineId]);
  return amount;
};
