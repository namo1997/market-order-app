import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('API: every endpoint uses existing client, exact method/body, envelope and protected binary', async () => {
  const calls = [];
  const context = vm.createContext({ encodeURIComponent });
  const client = Object.fromEntries(['get', 'post', 'put'].map((method) => [method, async (...args) => {
    calls.push({ method, args: JSON.parse(JSON.stringify(args)) });
    return { data: args.at(-1)?.responseType === 'blob' ? 'binary-image' : { success: true, data: 'document' } };
  }]));
  const dependency = new vm.SyntheticModule(['default'], function () { this.setExport('default', client); }, { context });
  const source = await readFile(new URL('../src/api/receiving-documents.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link((name) => { assert.equal(name, './client'); return dependency; });
  await module.evaluate();
  const api = module.namespace.receivingDocumentsAPI;
  assert.equal(await api.expected('2026-10-15'), 'document');
  await api.list({ date: '2026-10-15', status: 'draft' });
  await api.create({ client_uuid: 'same-request', kind: 'bill' });
  await api.get(3);
  await api.update(3, { lines: [{ id: 5 }], deleted_line_ids: [6] });
  await api.uploadImage(3, 2, 'synthetic-image');
  await api.ocr(3);
  await api.signature(3, 'receiver', 'synthetic-signature');
  await api.signature(3, 'courier', 'synthetic-signature', 'ผู้ส่งของ');
  await api.confirm(3);
  await api.confirm(3, true);
  await api.void(3, 'ส่งผิดสาขา');
  assert.equal(await api.image(3, 7), 'binary-image');
  assert.equal(await api.signatureImage('3/4', 'receiver/extra'), 'binary-image');
  assert.deepEqual(calls, [
    { method: 'get', args: ['/receiving-documents/expected', { params: { date: '2026-10-15' } }] },
    { method: 'get', args: ['/receiving-documents', { params: { date: '2026-10-15', status: 'draft' } }] },
    { method: 'post', args: ['/receiving-documents', { client_uuid: 'same-request', kind: 'bill' }] },
    { method: 'get', args: ['/receiving-documents/3'] },
    { method: 'put', args: ['/receiving-documents/3', { lines: [{ id: 5 }], deleted_line_ids: [6] }] },
    { method: 'post', args: ['/receiving-documents/3/images', { page_no: 2, image_data_url: 'synthetic-image' }] },
    { method: 'post', args: ['/receiving-documents/3/ocr', {}, { timeout: 70000 }] },
    { method: 'post', args: ['/receiving-documents/3/signatures', { role: 'receiver', image_data_url: 'synthetic-signature' }] },
    { method: 'post', args: ['/receiving-documents/3/signatures', { role: 'courier', image_data_url: 'synthetic-signature', name: 'ผู้ส่งของ' }] },
    { method: 'post', args: ['/receiving-documents/3/confirm', { unmatched_ok: false }] },
    { method: 'post', args: ['/receiving-documents/3/confirm', { unmatched_ok: true }] },
    { method: 'post', args: ['/receiving-documents/3/void', { reason: 'ส่งผิดสาขา' }] },
    { method: 'get', args: ['/receiving-documents/3/images/7', { responseType: 'blob' }] },
    { method: 'get', args: ['/receiving-documents/3%2F4/signatures/receiver%2Fextra', { responseType: 'blob' }] },
  ]);
});

test('API: rejected writes propagate without retry or hiding server status', async () => {
  const context = vm.createContext({ encodeURIComponent });
  let calls = 0;
  const failure = { response: { status: 409, data: { code: 'NOT_DRAFT' } } };
  const client = { post: async () => { calls++; throw failure; } };
  const dependency = new vm.SyntheticModule(['default'], function () { this.setExport('default', client); }, { context });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/api/receiving-documents.js', import.meta.url), 'utf8'), { context });
  await module.link(() => dependency); await module.evaluate();
  await assert.rejects(module.namespace.receivingDocumentsAPI.confirm(3), (error) => error === failure);
  assert.equal(calls, 1);
});

test('API: admin selection passes branch and department to expected/list/create unchanged', async () => {
  const calls = [];
  const context = vm.createContext({ encodeURIComponent });
  const client = Object.fromEntries(['get', 'post'].map((method) => [method, async (...args) => {
    calls.push(JSON.parse(JSON.stringify({ method, args })));
    return { data: { data: [] } };
  }]));
  const dependency = new vm.SyntheticModule(['default'], function () { this.setExport('default', client); }, { context });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/api/receiving-documents.js', import.meta.url), 'utf8'), { context });
  await module.link(() => dependency); await module.evaluate();
  const scope = { branch_id: 2, department_id: 3 };
  await module.namespace.receivingDocumentsAPI.expected('2026-10-15', scope);
  await module.namespace.receivingDocumentsAPI.list({ date: '2026-10-15', ...scope });
  await module.namespace.receivingDocumentsAPI.create({ client_uuid: 'fixed', ...scope });
  assert.deepEqual(calls[0].args[1].params, { date: '2026-10-15', ...scope });
  assert.deepEqual(calls[1].args[1].params, { date: '2026-10-15', ...scope });
  assert.deepEqual(calls[2].args[1], { client_uuid: 'fixed', ...scope });
});
