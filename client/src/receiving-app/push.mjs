import { Capacitor, registerPlugin } from '@capacitor/core';
const plugin = registerPlugin('ReceivingPush');
export function createPushBridge({ capacitor, native }) {
  const supported = () => capacitor.getPlatform() === 'android' && capacitor.isPluginAvailable('ReceivingPush');
  return {
    async sync() { if (supported()) await native.sync(); },
    async stop() { if (supported()) await native.stop(); },
    async consumeTap() {
      if (!supported()) return null;
      const result = await native.consumeTap();
      return /^[1-9]\d{0,8}$/.test(String(result?.followup_id)) ? String(result.followup_id) : null;
    },
  };
}
export const push = createPushBridge({ capacitor: Capacitor, native: plugin });
