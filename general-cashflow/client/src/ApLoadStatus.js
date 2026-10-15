import { createElement as h } from 'react';

export default function ApLoadStatus({ state, onRetry }) {
  if (!state) return null;
  return h('div', { className: `ap-notice ap-load-${state}`, role: state === 'error' ? 'alert' : 'status' },
    h('span', null, state === 'empty' ? 'ไม่มีข้อมูลเดือนนี้' : 'โหลดไม่สำเร็จ'),
    state === 'error' && h('button', { type: 'button', onClick: onRetry }, 'ลองใหม่'));
}
