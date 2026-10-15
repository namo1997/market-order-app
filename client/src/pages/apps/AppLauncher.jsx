import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

// หน้ารวมทางลัดเข้าระบบต่างๆ ของ SOLAO โดยใช้ market-order-app เป็นจุดเข้าหลัก
// ลิงก์ภายในเปิดในแอปนี้ ลิงก์ระบบอื่นเปิดแท็บใหม่ (แต่ละระบบ login แยกกัน)

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap';

const Icon = ({ children, className = 'h-6 w-6' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

const icons = {
  cart: (
    <>
      <path d="M3 4h2l2 11h11l2-8H6.4" />
      <circle cx="9" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </>
  ),
  receive: (
    <>
      <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  basket: (
    <>
      <path d="M4 10h16l-1.6 9a2 2 0 01-2 1.6H7.6a2 2 0 01-2-1.6z" />
      <path d="M8.5 10L11 4M15.5 10L13 4M9 14v3M15 14v3M12 14v3" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  external: <path d="M8 16L16 8M9 8h7v7" />,
  link: (
    <>
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />
};

const QUICK_LINKS = [
  { title: 'สั่งซื้อ', to: '/order', icon: 'cart', tone: 'bg-[#E3F0E7] text-[#1F6B47]' },
  { title: 'รับสินค้า / อ่านบิล', to: '/receiving', icon: 'receive', tone: 'bg-[#E2EEF3] text-[#21627A]' },
  { title: 'เดินซื้อของ', to: '/admin/purchase-walk', icon: 'basket', tone: 'bg-[#FBEBD3] text-[#A8631A]', admin: true },
  { title: 'PR / PO', to: '/general-purchase/hub', icon: 'receipt', tone: 'bg-[#F1E6F4] text-[#7A3F8A]' },
  { title: 'ยอดขาย', to: '/sales-dashboard', icon: 'chart', tone: 'bg-[#FBE3DC] text-[#B4462C]' },
  { title: 'ตั้งค่า', to: '/admin/settings', icon: 'gear', tone: 'bg-[#ECEAE4] text-[#4B4A44]', admin: true }
];

const OTHER_SYSTEMS = [
  {
    group: 'การเงินและบิล',
    items: [
      {
        title: 'General Cashflow',
        description: 'รายรับรายจ่าย ปิดยอดขายรายเดือน',
        href: 'https://general-cashflow-production.up.railway.app/',
        mark: 'CF',
        tone: 'bg-[#E8A33D]'
      },
      {
        title: 'Cashflow แคชเชียร์',
        description: 'เลือกชื่อแคชเชียร์แล้วใส่ PIN',
        href: 'https://general-cashflow-production.up.railway.app/?cashier=1',
        mark: 'แค',
        tone: 'bg-[#C98A2B]'
      },
      {
        title: 'Bill Capture',
        description: 'บิลและสลิปจากกลุ่ม LINE (แอดมิน)',
        href: 'https://line-bill-capture-production.up.railway.app/admin',
        mark: 'BC',
        tone: 'bg-[#2F9E62]'
      },
      {
        title: 'Bill Capture มือถือ',
        description: 'ตรวจบิลบนมือถือ',
        href: 'https://line-bill-capture-production.up.railway.app/m3/',
        mark: 'M3',
        tone: 'bg-[#257F50]'
      }
    ]
  },
  {
    group: 'บุคคลและพนักงาน',
    items: [
      {
        title: 'HRMS ระบบพนักงาน',
        description: 'ลางาน เวลาเข้างาน ข้อมูลพนักงาน',
        href: 'https://hrms-frontend-production-d58d.up.railway.app/',
        mark: 'HR',
        tone: 'bg-[#2E4A8C]'
      },
      {
        title: 'ระบบ KPI',
        description: 'ประเมินผลการทำงาน',
        href: 'https://kpi-frontend-production-e67e.up.railway.app/',
        mark: 'KPI',
        tone: 'bg-[#B4462C]'
      }
    ]
  }
];

const getGreeting = (hour) => {
  if (hour < 5) return 'ดึกแล้ว พักบ้างนะ';
  if (hour < 11) return 'อรุณสวัสดิ์';
  if (hour < 13) return 'สวัสดีตอนเที่ยง';
  if (hour < 17) return 'สวัสดีตอนบ่าย';
  return 'สวัสดีตอนเย็น';
};

// บางเบราว์เซอร์ (เช่นเปิดจากในแอป LINE) ไม่ให้สิทธิ์ Clipboard API จึงสำรองด้วย execCommand
const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    textarea.remove();
    return copied;
  }
};

const useLauncherFont = () => {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);
};

// server ส่ง head ของ /apps มาให้แล้วเมื่อเปิดลิงก์ตรง ส่วนนี้รองรับกรณีกดมาจากในแอป (SPA)
// เพื่อให้ "เพิ่มไปยังหน้าจอโฮม" ได้ไอคอนทางลัดและเปิด /apps เสมอ แล้วคืนค่าเดิมเมื่อออกจากหน้า
const HOME_SCREEN_META = [
  ['link[rel="manifest"]', 'href', '/apps.webmanifest'],
  ['link[rel="apple-touch-icon"]', 'href', '/apps-icons/apple-touch-icon.png'],
  ['link[rel="icon"]', 'href', '/apps-icons/favicon-64.png'],
  ['meta[name="theme-color"]', 'content', '#1F6B47'],
  ['meta[name="apple-mobile-web-app-title"]', 'content', 'ทางลัด']
];

const useHomeScreenMeta = () => {
  useEffect(() => {
    const previousTitle = document.title;
    const restored = HOME_SCREEN_META.map(([selector, attribute, value]) => {
      const element = document.head.querySelector(selector);
      if (!element) return null;
      const previous = element.getAttribute(attribute);
      element.setAttribute(attribute, value);
      return () => element.setAttribute(attribute, previous);
    });
    const icon = document.head.querySelector('link[rel="icon"]');
    const previousIconType = icon?.getAttribute('type');
    icon?.setAttribute('type', 'image/png');
    document.title = 'SOLAO ทางลัด';
    return () => {
      restored.forEach((restore) => restore?.());
      if (icon && previousIconType) icon.setAttribute('type', previousIconType);
      document.title = previousTitle;
    };
  }, []);
};

export const AppLauncher = () => {
  useLauncherFont();
  useHomeScreenMeta();
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const now = new Date();
  const dateLabel = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const copyLink = async (url, label) => {
    if (!(await copyText(url))) {
      window.prompt('คัดลอกลิงก์นี้', url);
      return;
    }
    setToast(`คัดลอกลิงก์ ${label} แล้ว`);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  };

  return (
    <div
      className="min-h-[100dvh] bg-[#F6F2EA] text-[#1C2B22]"
      style={{ fontFamily: '"IBM Plex Sans Thai", system-ui, sans-serif' }}
    >
      <div className="mx-auto max-w-lg px-4 pb-16 pt-6">
        {/* หัวหน้า: แบรนด์ + วันที่ + ทักทาย */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1F6B47] text-sm font-bold text-[#F6F2EA]">
              S
            </span>
            <span className="text-sm font-semibold tracking-[0.2em]">SOLAO</span>
          </div>
          <button
            type="button"
            onClick={() => copyLink(window.location.href, 'หน้านี้')}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#1C2B22]/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-[#1C2B22]/70 hover:bg-white"
          >
            <Icon className="h-3.5 w-3.5">{icons.link}</Icon>
            แชร์หน้านี้
          </button>
        </header>

        <section className="mt-8">
          <p className="text-sm text-[#1C2B22]/55">{dateLabel}</p>
          <h1 className="mt-1 text-[2rem] font-bold leading-tight">
            {getGreeting(now.getHours())}
            <span className="text-[#E8A33D]">.</span>
          </h1>
          <p className="mt-1 text-[15px] text-[#1C2B22]/65">วันนี้จะเริ่มงานจากระบบไหน</p>
        </section>

        {/* การ์ดหลักแบบตั๋ว: ระบบสั่งของตลาดสด */}
        <Link
          to="/"
          className="group relative mt-6 block overflow-hidden rounded-[28px] bg-[#1F6B47] text-[#F6F2EA] shadow-[0_18px_40px_-20px_rgba(31,107,71,0.8)] transition active:scale-[0.99]"
        >
          <svg
            viewBox="0 0 200 200"
            className="pointer-events-none absolute -right-10 -top-8 h-48 w-48 text-white/10"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            aria-hidden="true"
          >
            <circle cx="100" cy="100" r="60" />
            <circle cx="100" cy="100" r="90" />
          </svg>
          <div className="relative p-5 pb-6">
            <span className="inline-flex rounded-full bg-[#E8A33D] px-2.5 py-0.5 text-[11px] font-semibold text-[#1C2B22]">
              ระบบหลัก
            </span>
            <h2 className="mt-3 text-2xl font-bold">ระบบสั่งของตลาดสด</h2>
            <p className="mt-1 text-sm text-[#F6F2EA]/75">สั่งของ รับของ เช็คสต็อก ตามสิทธิ์ของคุณ</p>
          </div>
          {/* รอยปรุตั๋ว */}
          <div className="relative flex items-center" aria-hidden="true">
            <span className="absolute -left-3 h-6 w-6 rounded-full bg-[#F6F2EA]" />
            <span className="mx-5 w-full border-t-2 border-dashed border-[#F6F2EA]/25" />
            <span className="absolute -right-3 h-6 w-6 rounded-full bg-[#F6F2EA]" />
          </div>
          <div className="relative flex items-center justify-between px-5 py-4">
            <span className="text-sm font-medium text-[#F6F2EA]/80">ทุกสาขา · ทุกแผนก</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#F6F2EA] px-4 py-2 text-sm font-semibold text-[#1F6B47] transition group-hover:gap-3">
              เข้าใช้งาน
              <Icon className="h-4 w-4">{icons.arrow}</Icon>
            </span>
          </div>
        </Link>

        {/* ทางลัดในระบบตลาดสด */}
        <section className="mt-9" aria-labelledby="quick-links">
          <h2 id="quick-links" className="text-[13px] font-semibold uppercase tracking-wider text-[#1C2B22]/50">
            ไปที่เมนูโดยตรง
          </h2>
          <ul className="mt-3 grid grid-cols-3 gap-3">
            {QUICK_LINKS.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="relative flex h-full flex-col items-center gap-2 rounded-2xl bg-white px-2 pb-3 pt-4 text-center shadow-[0_1px_0_rgba(28,43,34,0.06)] ring-1 ring-[#1C2B22]/5 transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
                >
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${item.tone}`}>
                    <Icon>{icons[item.icon]}</Icon>
                  </span>
                  <span className="text-[13px] font-semibold leading-tight">{item.title}</span>
                  {item.admin && (
                    <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#E8A33D]" title="สำหรับแอดมิน" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#1C2B22]/45">
            <span className="h-1.5 w-1.5 rounded-full bg-[#E8A33D]" aria-hidden="true" />
            สำหรับแอดมิน
          </p>
        </section>

        {/* ระบบอื่นในเครือ */}
        <section className="mt-9" aria-labelledby="other-systems">
          <h2 id="other-systems" className="text-[13px] font-semibold uppercase tracking-wider text-[#1C2B22]/50">
            ระบบอื่นในเครือ
          </h2>
          <div className="mt-3 space-y-5">
            {OTHER_SYSTEMS.map((section) => (
              <div key={section.group}>
                <p className="mb-2 text-sm font-semibold">{section.group}</p>
                <ul className="divide-y divide-[#1C2B22]/[0.06] overflow-hidden rounded-2xl bg-white ring-1 ring-[#1C2B22]/5">
                  {section.items.map((item) => (
                    <li key={item.href} className="flex items-center">
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 pr-1 hover:bg-[#F6F2EA]/60"
                      >
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white ${item.tone}`}
                        >
                          {item.mark}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 font-semibold leading-tight">
                            {item.title}
                            <Icon className="h-3.5 w-3.5 text-[#1C2B22]/35 transition group-hover:text-[#1C2B22]">
                              {icons.external}
                            </Icon>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-[#1C2B22]/55">{item.description}</span>
                        </span>
                      </a>
                      <button
                        type="button"
                        onClick={() => copyLink(item.href, item.title)}
                        className="mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#1C2B22]/40 hover:bg-[#F6F2EA] hover:text-[#1C2B22]"
                        aria-label={`คัดลอกลิงก์ ${item.title}`}
                        title="คัดลอกลิงก์"
                      >
                        <Icon className="h-4 w-4">{icons.link}</Icon>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-10 rounded-2xl border border-dashed border-[#1C2B22]/15 px-4 py-3 text-center text-xs leading-relaxed text-[#1C2B22]/55">
          เคล็ดลับ: กด <span className="font-semibold text-[#1C2B22]/75">แชร์</span> แล้วเลือก{' '}
          <span className="font-semibold text-[#1C2B22]/75">เพิ่มไปยังหน้าจอโฮม</span> เพื่อเปิดหน้านี้ได้เหมือนแอป
          <br />
          ถ้าเคยเพิ่มไว้แล้วแต่เปิดไปหน้าเข้าสู่ระบบ ให้ลบไอคอนเดิมแล้วเพิ่มใหม่
          <br />
          ระบบในเครือเปิดแท็บใหม่และเข้าสู่ระบบแยกกัน
        </footer>
      </div>

      {/* แจ้งเตือนคัดลอกลิงก์ */}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 bottom-6 flex justify-center px-4 transition duration-200 ${
          toast ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        }`}
      >
        <span className="inline-flex items-center gap-2 rounded-full bg-[#1C2B22] px-4 py-2.5 text-sm text-[#F6F2EA] shadow-lg">
          <Icon className="h-4 w-4 text-[#E8A33D]">{icons.check}</Icon>
          {toast || 'คัดลอกแล้ว'}
        </span>
      </div>
    </div>
  );
};
