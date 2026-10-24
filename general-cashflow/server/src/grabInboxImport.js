import crypto from 'node:crypto';

// The existing schema has a unique provider/message key. An attachment-scoped
// value fits that column without a migration. Legacy rows remain unchanged and
// are still found by their archive checksum, including forwards/repeated mail.
export const grabAttachmentMessageId = (messageId, checksum) =>
  `grab:${crypto.createHash('sha256').update(`${messageId}:${checksum}`).digest('hex')}`;

/** Serialize duplicate checks and financial writes on the same DB connection. */
export const withGrabInboxImport = async ({ pool, messageId, checksum }, importReport) => {
  const connection = await pool.getConnection();
  const lockName = `grab:${checksum.slice(0, 59)}`;
  let locked = false;
  let transactionStarted = false;
  let returnConnection = true;
  try {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 5) AS acquired', [lockName]);
    locked = Number(lockRows[0]?.acquired) === 1;
    if (!locked) {
      const error = new Error('รายงาน Grab นี้กำลังนำเข้า โปรดลองใหม่');
      error.statusCode = 503;
      throw error;
    }
    const [rows] = await connection.query(
      `SELECT id, status, transaction_count, total_amount FROM bank_inbox_imports
       WHERE provider = 'GRAB_DAILY' AND archive_checksum = ? LIMIT 1`,
      [checksum]
    );
    if (rows[0]) {
      if (rows[0].status === 'FAILED') {
        const error = new Error('รายงาน Grab เดิมมีสถานะล้มเหลว ต้องตรวจสอบก่อนนำเข้าใหม่');
        error.statusCode = 409;
        throw error;
      }
      return { duplicate: true, data: rows[0] };
    }
    await connection.beginTransaction();
    transactionStarted = true;
    const data = await importReport(connection, grabAttachmentMessageId(messageId, checksum));
    await connection.commit();
    transactionStarted = false;
    return { duplicate: false, data };
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch { returnConnection = false; }
    }
    throw error;
  } finally {
    if (locked && returnConnection) {
      // Never return a connection with a retained advisory lock to the pool.
      try {
        const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
        if (Number(rows[0]?.released) !== 1) throw new Error('Lock release failed');
      } catch {
        returnConnection = false;
      }
    }
    if (returnConnection) connection.release();
    else connection.destroy();
  }
};
