import { createElement as h } from 'react';
import { CheckCheck, CircleHelp, TriangleAlert } from 'lucide-react';
import { apBalanceStatus } from './apLedgerUi.js';

export default function ApBalanceStatus({ balance }) {
  const { state, label } = apBalanceStatus(balance);
  const Icon = state === 'balanced' ? CheckCheck : state === 'error' ? TriangleAlert : CircleHelp;
  return h('div', { className: `ap-balance ap-balance-${state}`, role: state === 'error' ? 'alert' : 'status' },
    h('span', null, h(Icon, { size: 16, 'aria-hidden': true }), label),
    h('small', null, 'ดุลรายการบัญชีเท่านั้น'));
}
