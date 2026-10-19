import { useAuth } from '../../../contexts/AuthContext';
import { ReceivingIssues } from '../../../receiving-app/ReceivingIssues';
import { canManageIssues } from '../../../receiving-app/issue-labels.mjs';
import { ReceivingAdminShell } from './ReceivingAdminShell';

export function AdminReceivingIssues() {
  const {user}=useAuth();
  return canManageIssues(user)
    ? <ReceivingAdminShell issues><ReceivingIssues /></ReceivingAdminShell>
    : <ReceivingIssues />;
}
