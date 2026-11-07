import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clearLastLogin, readLastLogin, saveLastLogin } from '../src/utils/lastLogin.js';

// Owner 2026-11-07 "การล็อคอินสั่งของสามารถจำผู้ใช้งานได้เลยไหม" → chose "จำสาขา/แผนกล่าสุด":
// the login page offers the device's last department as one tap; the session itself still ends with the tab.
const memoryStorage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
};
const branches = [{ id: 3, name: 'สาขาผลิตสันกำแพง', code: 'PRODUCT2' }, { id: 7, name: 'สโตร์', code: 'BR001' }];

test('last login: remembers branch and department ids/names only, and only while the branch is still listed', () => {
  const storage = memoryStorage();
  assert.equal(readLastLogin(branches, storage), null, 'nothing saved yet');
  saveLastLogin(branches[0], { id: 12, name: 'แผนกครัว', token: 'x' }, storage);
  assert.deepEqual(JSON.parse(storage.getItem('lastLogin')), { branch: { id: 3, name: 'สาขาผลิตสันกำแพง', code: 'PRODUCT2' }, department: { id: 12, name: 'แผนกครัว' } });
  assert.deepEqual(readLastLogin(branches, storage), { branch: branches[0], department: { id: 12, name: 'แผนกครัว' } });
  assert.equal(readLastLogin([branches[1]], storage), null, 'a branch no longer offered is not shown');
  clearLastLogin(storage);
  assert.equal(readLastLogin(branches, storage), null);
  storage.setItem('lastLogin', '{broken');
  assert.equal(readLastLogin(branches, storage), null, 'a damaged entry is ignored');
  saveLastLogin(null, { id: 1 }, storage);
  assert.equal(storage.getItem('lastLogin'), '{broken', 'an incomplete pick is not saved');
  assert.doesNotThrow(() => saveLastLogin(branches[0], { id: 1 }, { setItem() { throw new Error('quota'); } }));
});

test('last login: the page saves after a successful login, keeps the store PIN, and forgets a department that fails', async () => {
  const page = await readFile(new URL('../src/pages/auth/Login.jsx', import.meta.url), 'utf8');
  assert.match(page, /if \(result\.success\) \{\s*saveLastLogin\(branch, dept\);/);
  assert.match(page, /handleBranchCardClick\(lastLogin\.branch, lastLogin\.department\)/, 'the shortcut goes through the store PIN check');
  assert.match(page, /if \(targetBranch && targetDepartment\) \{\s*await handleDepartmentSelect\(targetDepartment, targetBranch\);/);
  assert.match(page, /clearLastLogin\(\)/);
  const auth = await readFile(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(auth, /lastLogin/, 'logging out keeps the remembered department');
  assert.match(auth, /sessionStorage\.setItem\('token', token\)/, 'the session still lives only in the tab');
});
