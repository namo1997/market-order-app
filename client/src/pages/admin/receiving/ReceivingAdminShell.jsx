import { Link } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import './receiving-admin.css';

export function ReceivingAdminShell({ children, issues = false }) {
  return <Layout mainClassName="ra-layout"><div className="receiving-admin">
    <nav className="ra-section-tabs" aria-label="งานรับสินค้า">
      <Link to="/admin/receiving" aria-current={!issues ? 'page' : undefined}>ใบรับสินค้า</Link>
      <Link to="/admin/receiving/issues" aria-current={issues ? 'page' : undefined}>ปัญหารับของ</Link>
    </nav>
    {children}
  </div></Layout>;
}
