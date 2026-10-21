import { Link } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../contexts/AuthContext';
import { canOpenLegacyReceiving, LEGACY_RECEIVING_PRIMARY, NEW_RECEIVING_PATH } from './legacy-receiving';

export const LegacyReceivingMoved = () => (
  <Layout>
    <div className="max-w-lg mx-auto py-6">
      <Card className="p-5 sm:p-6 space-y-3" data-testid="legacy-receiving-moved">
        <h1 className="text-xl font-bold text-gray-900">เมนูนี้ย้ายไประบบรับสินค้าใหม่แล้ว</h1>
        <p className="text-sm text-gray-700">
          การรับสินค้าทำในระบบรับสินค้าใหม่ ถ่ายบิล ตรวจจำนวน และเซ็นรับได้ในที่เดียว
        </p>
        <p className="text-sm text-gray-700">
          วิธีเปิด: กดปุ่มด้านล่าง หรือเลือก &quot;รับสินค้า (ระบบใหม่)&quot; จากหน้าเลือกฟังก์ชั่น
          หรือเปิดแอป &quot;รับสินค้า&quot; บนมือถือ
        </p>
        <Link
          to={NEW_RECEIVING_PATH}
          className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
        >
          เปิดระบบรับสินค้าใหม่
        </Link>
      </Card>
    </div>
  </Layout>
);

// Wrap the old page: admins see it behind a warning banner, everyone else gets the "moved" page.
export const LegacyReceivingGate = ({ children }) => {
  const { user } = useAuth();
  if (!canOpenLegacyReceiving(user)) return <LegacyReceivingMoved />;
  if (LEGACY_RECEIVING_PRIMARY) return children;
  return (
    <>
      <div
        role="alert"
        data-testid="legacy-receiving-banner"
        className="sticky top-0 z-40 border-b-2 border-amber-400 bg-amber-100 px-4 py-2 text-sm text-amber-900"
      >
        <strong>คำเตือน:</strong> นี่คือเมนูรับสินค้าแบบเดิม (ใช้เพื่อกู้คืนฉุกเฉินเท่านั้น) ข้ามการนับแบบปิดตา ลายเซ็น และบันทึกปัญหา
        ใช้ <Link className="font-semibold underline" to={NEW_RECEIVING_PATH}>ระบบรับสินค้าใหม่</Link> ในงานปกติ
      </div>
      {children}
    </>
  );
};
