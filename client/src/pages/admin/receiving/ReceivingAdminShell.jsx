import { Link } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import './receiving-admin.css';

export function ReceivingAdminShell({ children, issues = false, suppliers = false }) {
  return <Layout mainClassName="ra-layout"><div className={issues ? 'solao receiving-admin ri-issues-workspace' : 'solao receiving-admin'}>
    <nav className="ra-section-tabs" aria-label="งานรับสินค้า">
      <Link to="/admin/receiving" aria-current={!issues && !suppliers ? 'page' : undefined}>ใบรับสินค้า</Link>
      <Link to="/admin/receiving/issues" aria-current={issues ? 'page' : undefined}>ปัญหารับของ</Link>
      <Link to="/admin/receiving/suppliers" aria-current={suppliers ? 'page' : undefined}>ร้านค้าและชื่อย่อ</Link>
    </nav>
    {children}
  </div></Layout>;
}
