import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../contexts/AuthContext';

const ShoppingIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 4h2l1.5 10h11L20 7H7.2" />
    <circle cx="10" cy="19" r="1.5" fill="currentColor" />
    <circle cx="17" cy="19" r="1.5" fill="currentColor" />
  </svg>
);

const ReceiveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 10l5 5 5-5M12 15V3" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </svg>
);

const StockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
    <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    <circle cx="13" cy="12" r="1.5" fill="currentColor" />
    <circle cx="17" cy="17" r="1.5" fill="currentColor" />
  </svg>
);

const PrintIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 9V4h10v5M7 14h10v6H7z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 10h14a2 2 0 012 2v4h-4" />
  </svg>
);

const TransformIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h7l2 3h7" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 17h-7l-2-3H4" />
    <circle cx="6" cy="7" r="1.3" fill="currentColor" />
    <circle cx="18" cy="17" r="1.3" fill="currentColor" />
  </svg>
);

const WithdrawIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v9" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 9l4 4 4-4" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 17h16" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 20h12" />
  </svg>
);

const TruckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M1 3h14v11H1zM15 7h4l4 4v5h-8V7z" />
    <circle cx="5.5" cy="18.5" r="2.5" strokeWidth={1.8} />
    <circle cx="18.5" cy="18.5" r="2.5" strokeWidth={1.8} />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M7.2 4.2a.75.75 0 011.06 0l5.25 5.25a.75.75 0 010 1.06l-5.25 5.25a.75.75 0 11-1.06-1.06L11.92 10 7.2 5.26a.75.75 0 010-1.06z" clipRule="evenodd" />
  </svg>
);

const BalanceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6">
    <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={1.8} />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h2m0 0v4m0-4V8m4 4h2m-2 0v2m0-2v-2" />
  </svg>
);

export const FunctionSelect = () => {
  const navigate = useNavigate();
  const { user, isProduction, canViewProductGroupOrders, canViewSupplierOrders, canUseStockCheck, canViewStockBalance, isAdmin } = useAuth();

  const isStoreBranch = /สโตร์|store/i.test(user?.branch || '');

  const actions = [];

  if (!isStoreBranch) {
    actions.push(
      {
        title: 'สั่งซื้อสินค้า',
        description: 'เพิ่มรายการและส่งคำสั่งซื้อ',
        path: '/order',
        group: 'daily',
        tone: 'border-blue-200 bg-blue-50/70 hover:border-blue-300',
        iconTone: 'bg-blue-100 text-blue-700',
        icon: ShoppingIcon
      },
      {
        title: 'รับสินค้า',
        description: 'ตรวจรับสินค้าที่สั่งซื้อไว้',
        path: '/order/receive',
        group: 'daily',
        tone: 'border-cyan-200 bg-cyan-50/70 hover:border-cyan-300',
        iconTone: 'bg-cyan-100 text-cyan-700',
        icon: ReceiveIcon
      }
    );
  }

  if (canUseStockCheck) {
    actions.push({
      title: 'เช็คสต็อก',
      description: 'บันทึกคงเหลือสินค้าประจำ',
      path: '/stock-check',
      group: 'daily',
      tone: 'border-emerald-200 bg-emerald-50/70 hover:border-emerald-300',
      iconTone: 'bg-emerald-100 text-emerald-700',
      icon: StockIcon
    });
  }

  if (canViewStockBalance) {
    actions.push({
      title: 'ดูยอดสต็อก',
      description: 'ตรวจสอบยอดคงเหลือสินค้าในแผนก',
      path: '/inventory/my-stock',
      group: 'daily',
      tone: 'border-green-200 bg-green-50/70 hover:border-green-300',
      iconTone: 'bg-green-100 text-green-700',
      icon: BalanceIcon
    });
  }

  if (canViewSupplierOrders) {
    actions.push({
      title: 'คำสั่งซื้อ',
      description: isProduction
        ? 'สำหรับฝ่ายผลิต (SUP003)'
        : 'ดูและพิมพ์คำสั่งซื้อของพื้นที่จัดเก็บสินค้า',
      path: '/production/print-orders',
      group: 'production',
      tone: 'border-indigo-200 bg-indigo-50/70 hover:border-indigo-300',
      iconTone: 'bg-indigo-100 text-indigo-700',
      icon: PrintIcon
    });
  }

  if (canViewProductGroupOrders || isProduction) {
    actions.push({
      title: 'เบิกสินค้า',
      description: 'เบิกไปให้แผนกอื่นโดยไม่ต้องกดรับสินค้า',
      path: '/withdraw',
      group: 'daily',
      tone: 'border-orange-200 bg-orange-50/70 hover:border-orange-300',
      iconTone: 'bg-orange-100 text-orange-700',
      icon: WithdrawIcon
    });
  }

  if (isProduction) {
    actions.push({
      title: 'แปรรูปสินค้า',
      description: 'นำวัตถุดิบมาแปรรูปเป็นสินค้า',
      path: '/production/transform',
      group: 'production',
      tone: 'border-amber-200 bg-amber-50/70 hover:border-amber-300',
      iconTone: 'bg-amber-100 text-amber-700',
      icon: TransformIcon
    });
  }

  if (isStoreBranch || isAdmin) {
    actions.push({
      title: 'สั่งซื้อจากซัพ',
      description: 'สร้างใบสั่งซื้อจากผู้จำหน่ายภายนอก',
      path: '/purchase-orders',
      group: 'daily',
      tone: 'border-purple-200 bg-purple-50/70 hover:border-purple-300',
      iconTone: 'bg-purple-100 text-purple-700',
      icon: TruckIcon
    });
  }

  const dailyActions = actions.filter((action) => action.group === 'daily');
  const productionActions = actions.filter((action) => action.group === 'production');

  const renderActionCard = (action) => {
    const Icon = action.icon;
    return (
      <Card
        key={action.path}
        onClick={() => navigate(action.path)}
        className={`group cursor-pointer border-2 ${action.tone} min-h-[128px] sm:min-h-[168px] rounded-xl sm:rounded-2xl shadow-sm p-3 sm:p-4`}
      >
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className={`h-9 w-9 sm:h-11 sm:w-11 rounded-lg sm:rounded-xl flex items-center justify-center ${action.iconTone}`}>
            <Icon />
          </div>
          <span className="hidden sm:inline-flex rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
            พร้อมใช้งาน
          </span>
        </div>

        <div className="mt-3 sm:mt-4">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 leading-tight">{action.title}</h2>
          <p className="text-xs sm:text-sm text-gray-600 mt-1 leading-snug">{action.description}</p>
        </div>

        <div className="mt-3 sm:mt-5 inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-gray-700 group-hover:text-gray-900">
          เข้าเมนู
          <ArrowIcon />
        </div>
      </Card>
    );
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <div className="rounded-2xl sm:rounded-3xl border border-slate-200 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-4 sm:p-7">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">เลือกฟังก์ชั่นการทำงาน</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">
            เลือกเมนูที่ต้องการเพื่อเริ่มทำงานได้ทันที
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white px-3 py-1 font-semibold text-gray-600 border border-slate-200">
              เมนูประจำวัน {dailyActions.length} รายการ
            </span>
            {productionActions.length > 0 && (
              <span className="rounded-full bg-white px-3 py-1 font-semibold text-gray-600 border border-slate-200">
                เมนูงานเฉพาะ {productionActions.length} รายการ
              </span>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
            งานประจำวัน
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {dailyActions.map((action) => renderActionCard(action))}
          </div>
        </div>

        {productionActions.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
              งานเฉพาะทาง
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {productionActions.map((action) => renderActionCard(action))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};
