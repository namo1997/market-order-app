import pool from '../config/database.js';

export const generateNextCode = async ({
  table,
  prefix,
  codeField = 'code',
  pad = 3
}) => {
  const startIndex = prefix.length + 1;
  const likePattern = `${prefix}%`;
  const [rows] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(${codeField}, ?) AS UNSIGNED)) AS max_num
     FROM ${table}
     WHERE ${codeField} LIKE ?`,
    [startIndex, likePattern]
  );
  const maxNum = Number(rows?.[0]?.max_num || 0);
  const next = maxNum + 1;
  return `${prefix}${String(next).padStart(pad, '0')}`;
};

// เลขเอกสารรูปแบบ PREFIX-YYYYMMDD-xxxxxx (6 หลักท้ายของ timestamp)
// ใช้ timestamp ที่เพิ่มขึ้นเสมอ กันเลขซ้ำเมื่อมีหลายเอกสารเข้ามาใน millisecond เดียวกัน
let lastDocumentTimestamp = 0;
export const generateTimestampDocumentNumber = (prefix) => {
  const timestamp = Math.max(Date.now(), lastDocumentTimestamp + 1);
  lastDocumentTimestamp = timestamp;
  const now = new Date(timestamp);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const time = timestamp.toString().slice(-6);
  return `${prefix}-${year}${month}${day}-${time}`;
};
