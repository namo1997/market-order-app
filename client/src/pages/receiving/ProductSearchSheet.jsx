import { ProductPicker } from './ProductPicker';
import { ReceivingDialog } from './ReceivingDialog';
import { PrimaryAction } from '../../design';
import { SupplierProductSuggestions, SUPPLIER_HISTORY_HELPER } from './SupplierProductSuggestions';

// Review 2026-10-24 "ตัวหนังสือต้องน้อยๆ": the sheet title already says what to search; no helper line under the field.
export const SEARCH_HELPER = '';

// Full-height add-product search: pinned input, vertical results, no sticky bar.
// Android Back closes it first (rc-back-dismiss + history entry in ReceivingDialog).
// `history` (useSupplierProducts) is optional: the bill-comparison step searches only.
// Owner 2026-10-24 (ข้อ 1): with `added`/`onRemove`/`onDone` the sheet stays open so several items are added in one go;
// the footer button closes it and moves to the first new count box.
export function ProductSearchSheet({ id, title, disabled, existingLines, history, onAdd, onExisting, onClose, branchId, departmentId, added, onRemove, onDone }) {
  const multi = Array.isArray(added);
  const hasHistory = Boolean(history?.available && history.items.length);
  return <ReceivingDialog title={title} className="ra-search-sheet rc-back-dismiss" backDismiss onClose={onClose}
    actions={multi && added.length > 0 ? <PrimaryAction icon="check" onClick={onDone}>{`เสร็จ · เพิ่ม ${added.length} รายการ`}</PrimaryAction> : undefined}>
    <ProductPicker variant="sheet" id={id} line={{}} disabled={disabled} branchId={branchId} departmentId={departmentId} existingLines={existingLines}
      helper={hasHistory ? SUPPLIER_HISTORY_HELPER : ''} historyIds={history?.items.map(item => item.id)}
      onExisting={onExisting} onChange={onAdd} addedIds={multi ? added : []} onRemove={multi ? onRemove : undefined}
      emptyState={history?.available ? <SupplierProductSuggestions source={history} doc={{ lines: existingLines }} disabled={disabled} onAdd={onAdd} addedIds={multi ? added : []} onRemove={multi ? onRemove : undefined} /> : null} />
  </ReceivingDialog>;
}
