import { createElement as h } from 'react';

export default function ApLoadStatus({ state, onRetry }) {
  if (!state) return null;
  const messages = {
    empty: 'ไม่มีข้อมูลเดือนนี้',
    offline: 'ออฟไลน์ ตรวจการเชื่อมต่อแล้วลองใหม่',
    auth: 'โหลดไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่แล้วลองใหม่',
    forbidden: 'โหลดไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์ดูรายงาน ติดต่อผู้ดูแลสิทธิ์แล้วลองใหม่',
    server: 'โหลดไม่สำเร็จ ระบบขัดข้อง กรุณารอสักครู่แล้วลองใหม่',
    network: 'โหลดไม่สำเร็จ ติดต่อระบบไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่',
    error: 'โหลดไม่สำเร็จ กรุณาลองใหม่ หากยังไม่ได้ให้ติดต่อผู้ดูแล'
  };
  return h('div', { className: `ap-notice ap-load-${state === 'empty' ? 'empty' : 'error'} ap-state-${state}`, role: state === 'empty' || state === 'offline' ? 'status' : 'alert' },
    h('span', null, messages[state] || messages.error),
    state !== 'empty' && h('button', { type: 'button', onClick: onRetry }, 'ลองใหม่'));
}
