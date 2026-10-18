import { useCallback, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { createImageCapture } from './camera.mjs';
import { SignaturePad } from '../pages/receiving/SignaturePad';
import { compressImage } from '../pages/receiving/image-utils';
const capture=createImageCapture({isNative:()=>Capacitor.isNativePlatform(),camera:Camera});
export function ReturnEvidenceForm({issue,api,onSaved,onDirtyChange}) {
  const [photo,setPhoto]=useState(''); const [signature,setSignature]=useState('');
  const [ink,setInk]=useState(false);
  const [name,setName]=useState(''); const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  const dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
  const inkChanged=useCallback(value=>{setInk(value);if(value){setSignature('');setSuccess('');dirtyCallback.current?.(true);}},[]);
  const key=useRef(crypto.randomUUID());const lock=useRef(false);
  const dirty=()=>{setSuccess('');onDirtyChange?.(true);};
  async function load(file) {
    if(!file || lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try { const prepared=await compressImage(file);setPhoto(prepared.dataUrl);dirty(); }
    catch {setError('เตรียมรูปไม่ได้ กรุณาเลือกรูปใหม่ ขนาดไม่เกิน 25 MB');}
    finally {lock.current=false;setBusy(false);}
  }
  async function takePhoto() {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {const file=await capture();if(file){const prepared=await compressImage(file);setPhoto(prepared.dataUrl);dirty();}}
    catch {setError('เปิดกล้องไม่ได้ กรุณาเลือกไฟล์ภาพ');}
    finally {lock.current=false;setBusy(false);}
  }
  async function save(event) {
    event.preventDefault();if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try {
      await api.attach(issue.id,{client_uuid:key.current,image_data_url:photo,collector_name:name.trim()||null,signature_data_url:signature||null,note});
      key.current=crypto.randomUUID();setPhoto('');setSignature('');setName('');setNote('');onDirtyChange?.(false);
      setSuccess('บันทึกหลักฐานแล้ว บัญชีจะตรวจและปิดเรื่อง');await onSaved();
    } catch {setError('บันทึกไม่สำเร็จ ข้อมูลยังอยู่ ลองส่งซ้ำได้โดยไม่สร้างหลักฐานซ้ำ');}
    finally {lock.current=false;setBusy(false);}
  }
  return <form className="ri-evidence-form" onSubmit={save}>
    <h3>{issue.type==='return'?'บันทึกการคืนของ':'แนบหลักฐาน'}</h3>
    <p>ถ่ายรูปของและเอกสารคืน (ถ้ามี) ระบุชื่อคนมารับคืน และให้ลงลายเซ็นได้ในกรอบ</p>
    <fieldset disabled={busy}>
      {Capacitor.isNativePlatform() && <button type="button" onClick={takePhoto}>ถ่ายรูปของคืน</button>}
      <label>รูปหลักฐาน<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{load(event.target.files?.[0]);event.target.value='';}} /></label>
      {photo && <img className="ri-proof-preview" src={photo} alt="รูปหลักฐานก่อนบันทึก" />}
      <label>ชื่อคนมารับคืน{issue.type==='return'?' (จำเป็น)':''}<input value={name} maxLength={255} required={issue.type==='return'} onChange={event=>{setName(event.target.value);dirty();}} /></label>
      <SignaturePad key={key.current} label="ลายเซ็นคนมารับคืน (ถ้ามี)" inline saved={!!signature} savedImage={signature}
        disabled={busy} onInkChange={inkChanged} onSave={async value=>{setSignature(value);dirty();return true;}} />
      <label>หมายเหตุ<textarea value={note} maxLength={1000} onChange={event=>{setNote(event.target.value);dirty();}} /></label>
      {ink&&!signature&&<p role="status">กรุณากดบันทึกเซ็นก่อนบันทึกหลักฐาน</p>}
      <button disabled={busy||!photo||(ink&&!signature)||(issue.type==='return'&&!name.trim())}>{busy?'กำลังบันทึก…':'บันทึกหลักฐาน'}</button>
    </fieldset>
    {error&&<p role="alert">{error}</p>}{success&&<p role="status">{success}</p>}
  </form>;
}
