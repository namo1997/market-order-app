import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../../tests/receiving-harness.mjs';

const open = props => harness('PilotLogin', { online: true, busy: false, onLogin() {}, ...props }, {}, {}, {}, {}, null, '../src/receiving-app/PilotLogin.jsx');
const submit = h => h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });

test('PilotLogin: displays branch buttons in a 2-column grid with touch targets and aria-pressed states', async () => {
  const branches = [{ id: 1, name: 'สาขาทองหล่อ' }, { id: 2, name: 'สาขาเอกมัย' }];
  const departments = [{ id: 10, name: 'ครัวร้อน' }, { id: 20, name: 'ครัวเย็น' }];
  const h = await open({ api: {
    branches: async () => branches,
    departments: async () => departments,
    login: async () => ({ id: 9 }),
  } });

  // Grid container and buttons exist
  const branchGrid = h.all().find(node => node.props?.className === 'apk-choice-grid' && node.props['aria-label'] === 'สาขา');
  assert.ok(branchGrid, 'Branch choice grid must exist');

  const btnA = h.find(node => node.type === 'button' && h.text(node) === 'สาขาทองหล่อ');
  const btnB = h.find(node => node.type === 'button' && h.text(node) === 'สาขาเอกมัย');
  assert.ok(btnA.props.className.includes('apk-choice-btn'));
  assert.equal(btnA.props['aria-pressed'], false);
  assert.equal(btnB.props['aria-pressed'], false);

  // Departments not shown yet before selecting a branch
  assert.equal(h.all().some(node => node.props?.className === 'apk-choice-grid' && node.props['aria-label'] === 'แผนก'), false);

  // Submit button is disabled
  const submitBtn = h.find(node => node.type === 'button' && h.text(node) === 'เข้าใช้งาน');
  assert.equal(submitBtn.props.disabled, true);

  // Tap branch A: becomes selected, departments are loaded and displayed as buttons
  await h.click('สาขาทองหล่อ');
  const selectedA = h.find(node => node.type === 'button' && h.text(node) === 'สาขาทองหล่อ');
  assert.equal(selectedA.props['aria-pressed'], true);
  assert.ok(selectedA.props.className.includes('selected'));

  const deptGrid = h.all().find(node => node.props?.className === 'apk-choice-grid' && node.props['aria-label'] === 'แผนก');
  assert.ok(deptGrid, 'Department choice grid must appear after branch is selected');

  const deptHot = h.find(node => node.type === 'button' && h.text(node) === 'ครัวร้อน');
  const deptCold = h.find(node => node.type === 'button' && h.text(node) === 'ครัวเย็น');
  assert.equal(deptHot.props['aria-pressed'], false);
  assert.equal(deptCold.props['aria-pressed'], false);

  // Submit button still disabled until department is chosen
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'เข้าใช้งาน').props.disabled, true);

  // Tap department: becomes selected and enables submit
  await h.click('ครัวร้อน');
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'ครัวร้อน').props['aria-pressed'], true);
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'เข้าใช้งาน').props.disabled, false);
});

test('PilotLogin: automatically selects single branch and single department', async () => {
  const logged = [];
  const h = await open({
    api: {
      branches: async () => [{ id: 5, name: 'สาขาเดียว' }],
      departments: async branchId => {
        assert.equal(branchId, '5');
        return [{ id: 50, name: 'แผนกเดียว' }];
      },
      login: async deptId => {
        logged.push(deptId);
        return { id: 1, department_id: deptId };
      },
    },
  });

  // Single branch auto-selected
  const branchBtn = h.find(node => node.type === 'button' && h.text(node) === 'สาขาเดียว');
  assert.equal(branchBtn.props['aria-pressed'], true);

  // Single department auto-selected
  const deptBtn = h.find(node => node.type === 'button' && h.text(node) === 'แผนกเดียว');
  assert.equal(deptBtn.props['aria-pressed'], true);

  // Submit button enabled immediately
  const submitBtn = h.find(node => node.type === 'button' && h.text(node) === 'เข้าใช้งาน');
  assert.equal(submitBtn.props.disabled, false);

  await submit(h);
  assert.deepEqual(logged, [50]);
});

test('PilotLogin: changing branch clears department selection and list', async () => {
  const deptRequests = [];
  const h = await open({
    api: {
      branches: async () => [{ id: 1, name: 'สาขา 1' }, { id: 2, name: 'สาขา 2' }],
      departments: async branchId => {
        deptRequests.push(branchId);
        if (branchId === '1') return [{ id: 10, name: 'ครัว 1' }];
        return [{ id: 21, name: 'ครัว 2A' }, { id: 22, name: 'ครัว 2B' }];
      },
      login: async () => ({ id: 1 }),
    },
  });

  await h.click('สาขา 1');
  assert.ok(h.all().some(node => node.type === 'button' && h.text(node) === 'ครัว 1'));
  // Single dept auto-selected
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'ครัว 1').props['aria-pressed'], true);

  // Switch to branch 2
  await h.click('สาขา 2');
  // Kitchen 1 is gone
  assert.ok(!h.all().some(node => node.type === 'button' && h.text(node) === 'ครัว 1'));
  // Branch 2 has 2 departments, none auto-selected
  const btn2A = h.find(node => node.type === 'button' && h.text(node) === 'ครัว 2A');
  const btn2B = h.find(node => node.type === 'button' && h.text(node) === 'ครัว 2B');
  assert.equal(btn2A.props['aria-pressed'], false);
  assert.equal(btn2B.props['aria-pressed'], false);
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'เข้าใช้งาน').props.disabled, true);
});

test('PilotLogin: the remembered branch and department are chosen again; a login saves the new choice', async () => {
  const saved = [];
  const h = await open({
    memory: { load: async () => ({ branch: '2', department: '22' }), save: async choice => { saved.push({ ...choice }); } }, // copy out of the harness realm
    api: {
      branches: async () => [{ id: 1, name: 'สาขา 1' }, { id: 2, name: 'สาขา 2' }],
      departments: async branchId => branchId === '1' ? [{ id: 10, name: 'ครัว 1' }, { id: 11, name: 'ครัว 1B' }]
        : [{ id: 21, name: 'ครัว 2A' }, { id: 22, name: 'ครัว 2B' }],
      login: async () => ({ id: 1 }),
    },
  });
  const pressed = name => h.find(node => node.type === 'button' && h.text(node) === name).props['aria-pressed'];
  assert.equal(pressed('สาขา 2'), true);
  assert.equal(pressed('ครัว 2B'), true);
  assert.equal(h.find(node => node.type === 'button' && h.text(node) === 'เข้าใช้งาน').props.disabled, false);

  // Picking another branch by hand drops the remembered department.
  await h.click('สาขา 1'); await h.click('สาขา 2');
  assert.equal(pressed('ครัว 2B'), false);
  await h.click('ครัว 2A');
  await submit(h);
  assert.deepEqual(saved, [{ branch: '2', department: '21' }]);
});

test('PilotLogin: a remembered choice that is gone or unreadable falls back; a failed login saves nothing', async () => {
  const saved = [];
  const api = {
    branches: async () => [{ id: 1, name: 'สาขา 1' }, { id: 2, name: 'สาขา 2' }],
    departments: async () => [{ id: 10, name: 'ครัว 1' }, { id: 11, name: 'ครัว 1B' }],
    login: async () => { throw Error('denied'); },
  };
  const h = await open({ api, memory: { load: async () => ({ branch: '1', department: '99' }), save: async choice => { saved.push(choice); } } });
  const pressed = name => h.find(node => node.type === 'button' && h.text(node) === name).props['aria-pressed'];
  assert.equal(pressed('สาขา 1'), true);
  assert.equal(pressed('ครัว 1'), false); assert.equal(pressed('ครัว 1B'), false);
  await h.click('ครัว 1'); await submit(h);
  assert.deepEqual(saved, []);

  const broken = await open({ api, memory: { load: async () => { throw Error('storage'); }, save: async () => {} } });
  assert.equal(broken.find(node => node.type === 'button' && broken.text(node) === 'สาขา 1').props['aria-pressed'], false);
  assert.equal(broken.all().some(node => node.props?.role === 'alert'), false);
});
