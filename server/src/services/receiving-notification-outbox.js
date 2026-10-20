import { sendReceivingSavedNotification } from './receiving-notify.js';

export { ensureReceivingDocumentsTables as ensureReceivingNotificationTable } from '../models/receiving-documents-schema.js';

export async function enqueueReceivingNotification(connection, documentId, payload) {
  await connection.query(`INSERT INTO receiving_document_notifications (document_id, payload_json) VALUES (?, ?)`,
    [documentId, JSON.stringify(payload)]);
}

// At-most-once attempt: persist the claim BEFORE calling a provider, including
// ambiguous timeouts. Never retry a claimed row; LINE/Discord cannot atomically
// commit with MySQL. Pending rows survive a crash before dispatch and cron drains
// them. Payloads are frozen in the same transaction as the receipt.
export async function dispatchReceivingNotification(db, documentId, send = sendReceivingSavedNotification) {
  try {
    const [claim] = await db.query(`UPDATE receiving_document_notifications SET state = 'claimed', claimed_at = UTC_TIMESTAMP(3)
      WHERE document_id = ? AND state = 'pending'`, [documentId]);
    if (!claim.affectedRows) return;
    const [rows] = await db.query('SELECT payload_json FROM receiving_document_notifications WHERE document_id = ?', [documentId]);
    if (rows.length) await send({ payload: JSON.parse(rows[0].payload_json) });
  } catch { console.warn('[receiving-notify] dispatch deferred or attempted'); }
}

export async function dispatchPendingReceivingNotifications(db, send = sendReceivingSavedNotification) {
  const [rows] = await db.query("SELECT document_id FROM receiving_document_notifications WHERE state = 'pending' ORDER BY document_id LIMIT 50");
  for (const row of rows) await dispatchReceivingNotification(db, row.document_id, send);
}
