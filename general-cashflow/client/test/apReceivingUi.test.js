import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
// Compile the actual React component in memory: no generated files outside the SSD.
const path = new URL('../src/ApReceiving.jsx', import.meta.url);
const source = await readFile(path, 'utf8');
const compiled = (await transform(source.replace("'./apLedgerUi.js'", JSON.stringify(new URL('../src/apLedgerUi.js', import.meta.url).href)), {loader:'jsx',format:'esm',jsx:'automatic'})).code;
// Resolve React imports from the SSD-installed dependencies.
const resolved = compiled.replaceAll('"react"', JSON.stringify(import.meta.resolve('react'))).replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')));
const { default:ApReceiving, ReceivingRows, RECEIVING_LABELS } = await import(`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`);
const fixture = matchStatus => ({documentId:123,source:'ใบรับของ',supplierName:'ผู้ขายสมมติ',branch:'SK',docRef:'INV-SYNTHETIC',docDate:'2026-09-04',receiptDate:'2026-10-20',dueDate:'2026-11-05',periodStatus:'รอตรวจเดือนบัญชีกับสมุดรับจ่าย',amountSatang:null,billTotalSatang:955500,matchStatus,reason:'หลักฐานยังต้องตรวจ',sourceUrl:'https://example.invalid/admin/receiving/documents/123',linkedSourceKey:matchStatus==='LINKED'?'lbc:bill:7':null});
test('receipt evidence renders Thai match/void/reference states with unknown price and safe source links',()=>{
  for(const status of Object.keys(RECEIVING_LABELS)) {
    const html=renderToStaticMarkup(createElement(ReceivingRows,{documents:[fixture(status)]}));
    assert.ok(html.includes(RECEIVING_LABELS[status]));assert.match(html,/ยังไม่ทราบ/);assert.match(html,/9,555\.00/);assert.match(html,/รอตรวจเดือนบัญชี/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/ใบรับของ #123/);
    assert.equal(html.includes('บิลไลน์ #7'),status==='LINKED');
  }
  assert.match(renderToStaticMarkup(createElement(ReceivingRows)),/ยังไม่มีใบรับของ/);
});
test('sync is disabled before configuration loads and in previews; loading and errors stay separate',()=>{
  const html=renderToStaticMarkup(createElement(ApReceiving,{month:'2026-10',branch:''}));
  assert.match(html,/disabled=""/);assert.match(html,/ดึงใบรับของ/);assert.match(html,/aria-live="polite"/);assert.match(html,/ไม่สร้างยอดจ่ายเงิน/);
  assert.match(source,/if \(preview\)/);assert.match(source,/!data\?\.configured/);assert.match(source,/!data\?\.schemaReady/);assert.match(source,/current = false/);assert.match(source,/\/ap\/receiving\/sync/);
});
test('receipt controls retain established theme tokens and mobile targets at least 48px',async()=>{
  const css=await readFile(new URL('../src/apLedger.css',import.meta.url),'utf8');
  assert.match(css,/\.ap-receiving-sync,\.ap-receiving-link\s*\{[^}]*min-height:48px/);
  assert.match(css,/\.ap-receiving-list summary\s*\{[^}]*min-height:48px/);
  assert.match(css,/\.ap-receiving-sync[^}]*var\(--ap-line\)/);
});
