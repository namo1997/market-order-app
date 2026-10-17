import { Capacitor, registerPlugin } from '@capacitor/core';

const nativeAlerts = registerPlugin('ReceivingAlerts');
const failure = message => new Error(message);
export function createAlerts({ capacitor, plugin, nextId = () => (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) || 1 }) {
  let permissionRequest = null;
  const supported = () => capacitor.getPlatform() === 'android' && capacitor.isPluginAvailable('ReceivingAlerts');
  async function ensureAlertPermission() {
    if (!supported()) return false;
    if (!permissionRequest) permissionRequest = plugin.ensureAlertPermission().then(result => result.granted === true)
      .catch(() => false).finally(() => { permissionRequest = null; });
    return permissionRequest;
  }
  async function notifyUrgent({ title, body, data = {} } = {}) {
    let serialized;
    try { serialized = JSON.stringify(data); } catch { throw failure('ข้อมูลแจ้งเตือนไม่ถูกต้อง'); }
    if (typeof title !== 'string' || !title.trim() || title.length > 160 || typeof body !== 'string' ||
        !body.trim() || body.length > 1000 || !data || Array.isArray(data) || typeof data !== 'object' || !serialized || serialized.length > 4096) {
      throw failure('ข้อมูลแจ้งเตือนไม่ถูกต้อง');
    }
    if (!await ensureAlertPermission()) throw failure('กรุณาเปิดสิทธิ์แจ้งเตือนในการตั้งค่า Android แล้วลองใหม่');
    const id = nextId();
    try { await plugin.notifyUrgent({ id, title, body, data: serialized }); return id; }
    catch { throw failure('ส่งแจ้งเตือนไม่สำเร็จ กรุณาตรวจการตั้งค่าแจ้งเตือน Android'); }
  }
  async function cancelAlert(id) {
    if (!Number.isInteger(id) || id <= 0 || id > 0x7fffffff) throw failure('รหัสแจ้งเตือนไม่ถูกต้อง');
    if (!supported()) return;
    try { await plugin.cancelAlert({ id }); } catch { throw failure('หยุดแจ้งเตือนไม่สำเร็จ กรุณาแตะรับทราบที่แจ้งเตือน'); }
  }
  return { ensureAlertPermission, notifyUrgent, cancelAlert };
}
const alerts = createAlerts({ capacitor: Capacitor, plugin: nativeAlerts });
export const ensureAlertPermission = () => alerts.ensureAlertPermission();
export const notifyUrgent = options => alerts.notifyUrgent(options);
export const cancelAlert = id => alerts.cancelAlert(id);
