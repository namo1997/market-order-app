import { createElement as h } from 'react';
import { apOpeningState } from './apOpeningUi.js';
import { formatApDate } from './apLedgerUi.js';

export default function ApOpeningStatus({ report }) {
  const status = apOpeningState(report);
  const dates = [...new Set(report.controls?.byBranch?.map(b => b.openingDate).filter(Boolean))];
  return h('aside', { className: `ap-opening ap-opening-${status.state}`, 'aria-label': 'สถานะยอดยกมา' },
    h('strong', { role: 'status' }, status.label),
    h('details', null, h('summary', null, 'วิธีกรอก CSV และขอบเขตยอด'),
      h('p', null, 'ขอแม่แบบ CSV จากผู้ดูแล กรอกเฉพาะยอดยกมา (บาท) และหมายเหตุ คงสาขา รหัส และชื่อผู้ขายตามแม่แบบ'),
      h('p', null, `ใช้ยอดหนี้ก่อนเดือนบัญชี${dates.length ? ` ณ ${dates.map(formatApDate).join(', ')}` : ''} ใส่ 0 เมื่อยืนยันว่าไม่มีหนี้ เว้นว่างเมื่อยังไม่ทราบ ตัวเลขไม่มีจุลภาคและทศนิยมไม่เกิน 2 ตำแหน่ง แล้วส่งไฟล์ CSV UTF-8 ให้ผู้ดูแลนำเข้า`),
      h('p', null, 'วันที่ในไฟล์ใช้รูปแบบปี ค.ศ. ตามแม่แบบ การนำเข้าแต่ละครั้งแทนข้อมูลทั้งเดือนทุกสาขา'),
      h('p', null, 'ยอดคงค้างคำนวณจากยอดยกมาและรายการที่มี ใบรับของและรายการจ่ายยังต้องตรวจความครบ อายุยอดยกมาเริ่มจากวันยกมา เป็นค่าประมาณ ไม่ใช่อายุเกินกำหนดของบิลเดิม'),
      status.missing > 0 && h('p', null, `ยังขาด ${status.missing} รายการผู้ขายแยกสาขา`),
      status.missing > 0 && h('ul', null, report.controls?.missingSuppliers?.map(s =>
        h('li', { key: s.key }, `${s.name} — ${report.branches?.find(b => b.code === s.branch)?.name || s.branch}`)))));
}
