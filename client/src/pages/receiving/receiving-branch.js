// Legacy branch receiving is available to every authenticated ordering user.
export const canReceiveBranch = user => Number.isSafeInteger(Number(user?.id)) && Number(user.id) > 0 &&
  (['admin', 'super_admin'].includes(user.role) || Number(user.branch_id) > 0);
export const branchOrderIds = items => items.filter(item => !item.is_received).flatMap(item => item.order_item_ids || [item.order_item_id]);
