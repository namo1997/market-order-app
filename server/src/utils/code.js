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
