import { Banknote, ChevronLeft, LogOut } from 'lucide-react';
import './mobileAdmin.css';

export const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
export const mobileStartView = (user) => user?.role === 'admin' && isPhone() ? 'mobile-receipts' : 'dashboard';
const titles = { 'mobile-receipts': 'รับเงิน', 'mobile-review': 'ตรวจเงินสด', dashboard: 'ตรวจรับเงิน', overview: 'ภาพรวมรับเงิน', pnl: 'กำไรขาดทุน', report: 'รายงาน', brief: 'งานค้าง', inbox: 'ไฟล์อีเมล', settings: 'ตั้งค่า' };
export function MobileAdminNav({ user, view, onNavigate, onLogout }) {
  return <header className="ma-header">{['dashboard', 'mobile-review'].includes(view) ? <button className="ma-header-back" aria-label="กลับไปเลือกวัน" onClick={() => onNavigate('mobile-receipts')}><ChevronLeft size={22}/></button> : <div className="ma-logo"><Banknote size={22}/></div>}<div><h1>{titles[view] || 'รับเงิน'}</h1></div><button className="ma-user" aria-label="ออกจากระบบ" onClick={onLogout}>{user.full_name || user.username}<LogOut size={16}/></button></header>;
}
