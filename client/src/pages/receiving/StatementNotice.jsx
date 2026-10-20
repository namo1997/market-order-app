import { Toast } from '../../design';
import { reviewWarnings } from './receiving-review';
import { WARNING_TEXT } from './receiving-utils';

// The server flags a photo of a billing statement / period summary (not a delivery note)
// with BILL_IS_STATEMENT and creates no bill lines. Counting stays untouched.
export const isStatementDocument = doc => reviewWarnings(doc).some(warning => warning.code === 'BILL_IS_STATEMENT');

export function StatementNotice({ disabled, onRetake, onNoBill }) {
  return <div className="ra-statement-notice rc-stack" role="alert">
    <Toast status="review">{WARNING_TEXT.BILL_IS_STATEMENT}</Toast>
    <button type="button" className="ra-statement-action" disabled={disabled} onClick={onRetake}>ถ่าย / เพิ่มรูปใบส่งของ</button>
    <button type="button" className="ra-statement-action" disabled={disabled} onClick={onNoBill}>รับแบบไม่มีบิล</button>
  </div>;
}
