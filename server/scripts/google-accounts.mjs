import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';
import { createGoogleAccountsStore } from '../src/models/google-accounts.model.js';

export async function runGoogleAccounts(args, env = process.env, connect = mysql.createConnection) {
  // Deliberately no dotenv or shared database import: this tool is local-only.
  if (env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || '')) {
    throw new Error('Local only: explicitly set DB_HOST to localhost/127.0.0.1/::1');
  }
  const [command, email, userId, creatorId, departmentId] = args;
  if (!['list', 'add', 'disable'].includes(command) ||
      (command === 'add' && (!email || !userId || !creatorId)) || (command === 'disable' && !email)) {
    throw new Error('Usage: list | add EMAIL USER_ID ADMIN_ID [DEPARTMENT_ID] | disable EMAIL');
  }
  const db = await connect({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 5000 });
  try {
    const store = createGoogleAccountsStore(db);
    if (command === 'list') return await store.list();
    if (command === 'disable') return await store.disable(email);
    const [admins] = await db.query("SELECT id FROM users WHERE id = ? AND is_active = TRUE AND role IN ('admin', 'super_admin')", [Number(creatorId)]);
    if (!admins.length) throw new Error('ADMIN_ID must identify an active local admin');
    return await store.add({ email, user_id: userId, created_by: creatorId,
      ...(departmentId === undefined ? {} : { department_id: departmentId }) });
  } finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGoogleAccounts(process.argv.slice(2)).then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n'))
    .catch(() => { process.stderr.write('จัดการบัญชีไม่สำเร็จ: ตรวจคำสั่ง ฐาน local และข้อมูลผู้ใช้ (ไม่แสดงรายละเอียดฐานข้อมูล)\n'); process.exitCode = 1; });
}
