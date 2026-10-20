import { useEffect, useRef } from 'react';
import { issueResolutions } from './issue-labels.mjs';

export function IssueCloseConfirmation({form,busy,error,onConfirm,onCancel}) {
  const dialog=useRef(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const resolved=form.status==='resolved';
  return <dialog className="ri-close-dialog" ref={dialog} aria-labelledby="issue-close-title" onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}>
    <h2 id="issue-close-title">{resolved?'ยืนยันปิดเรื่อง':'ยืนยันยกเลิกเรื่อง'}</h2>
    <p>เมื่อบันทึกแล้ว จะกลับมาแก้ทางจบหรือเปิดเรื่องใหม่ไม่ได้ กรุณาตรวจข้อมูลก่อนยืนยัน</p>
    {resolved&&<p>ทางจบ: {issueResolutions[form.resolution]} · {form.resolution_amount} บาท</p>}
    {resolved&&['credit_note','new_bill'].includes(form.resolution)&&<p>{form.resolution_ref_pending?'ยังไม่มีเลขที่ใบลดหนี้ ต้องกลับมาใส่ภายหลัง':`เลขที่เอกสาร: ${form.resolution_ref}`}</p>}
    {resolved&&form.resolution==='returned'&&<p>{form.stock_return_quantity ? `ลดสต๊อก ${form.stock_return_quantity} หน่วยฐาน จากใบรับสินค้าที่อ้างอิง` : 'ไม่ลดสต๊อก: ใช้กับของที่ไม่เคยรับเข้าคลังเท่านั้น'}</p>}
    {resolved&&form.resolution==='credit_note'&&<p>ใบลดหนี้เปลี่ยนยอดเงิน ไม่เปลี่ยนสต๊อก</p>}
    {form.note&&<p>รายละเอียด / เหตุผล: {form.note}</p>}
    {error&&<p role="alert">{error}</p>}
    <div className="ri-dialog-actions"><button type="button" className="ri-secondary" autoFocus disabled={busy} onClick={onCancel}>กลับไปตรวจข้อมูล</button>
      <button type="button" disabled={busy} onClick={onConfirm}>{busy?'กำลังบันทึก…':resolved?'ยืนยันปิดเรื่อง':'ยืนยันยกเลิกเรื่อง'}</button></div>
  </dialog>;
}
