import { useId } from 'react';

/** Inline vector image inherits the self-hosted Thai font from .solao. */
export default function ReceiptExample() {
  const label = useId();
  return (<svg className="sg-demo-receipt" viewBox="0 0 360 460" role="img" aria-labelledby={label} lang="th">
  <title id={label}>บิลตัวอย่าง ร้านผักป้าดา เลขที่ 00128 วันที่ 15 ตุลาคม 2569 รวม 1,280 บาท ข้อมูลสมมติสำหรับตรวจหน้าตา</title>
  <rect width="360" height="460" rx="12" fill="#fff"/>
  <g fill="#182444" fontFamily="inherit" textAnchor="middle">
    <text x="180" y="48" fontSize="22" fontWeight="600">ร้านผักป้าดา</text>
    <text x="180" y="82" fontSize="16">บิล 00128</text>
    <text x="180" y="112" fontSize="16">15 ตุลาคม 2569</text>
    <path d="M24 140H336M24 310H336" stroke="#737d92" strokeDasharray="4 4"/>
    <g fontSize="16" textAnchor="start">
      <text x="24" y="180">มะเขือเทศ 12 กก.</text><text x="24" y="222">ผักรวม 8 รายการ</text>
      <text x="24" y="280">รวม 9 รายการ</text>
    </g>
    <text x="180" y="360" fontSize="28" fontWeight="600">1,280.00 บาท</text>
    <text x="180" y="420" fontSize="16">ข้อมูลสมมติสำหรับตรวจหน้าตา</text>
  </g>
</svg>);
}
