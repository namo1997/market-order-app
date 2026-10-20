// หน้า /apps ต้องมี manifest และไอคอนของตัวเองตั้งแต่ HTML แรก
// เพื่อให้ "เพิ่มไปยังหน้าจอโฮม" จำ start_url เป็น /apps แทน / (ซึ่งเด้งไป login)
export const APP_LAUNCHER_PATHS = new Set(['/apps', '/apps/']);

const replacements = [
  [/<link\s+rel="manifest"[^>]*>/i, '<link rel="manifest" href="/apps.webmanifest" />'],
  [/<link\s+rel="apple-touch-icon"[^>]*>/i, '<link rel="apple-touch-icon" href="/apps-icons/apple-touch-icon.png" />'],
  [/<link\s+rel="icon"[^>]*>/i, '<link rel="icon" type="image/png" href="/apps-icons/favicon-64.png" />'],
  [/<meta\s+name="theme-color"[^>]*>/i, '<meta name="theme-color" content="#1F6B47" />'],
  [/<meta\s+name="apple-mobile-web-app-title"[^>]*>/i, '<meta name="apple-mobile-web-app-title" content="ทางลัด" />'],
  [/<title>[^<]*<\/title>/i, '<title>SOLAO ทางลัด</title>']
];

export const toAppLauncherShell = (html) =>
  replacements.reduce((result, [pattern, tag]) => result.replace(pattern, tag), html);
