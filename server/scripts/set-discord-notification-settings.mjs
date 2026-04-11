import * as settingsModel from '../src/models/settings.model.js';

const orderWebhook = String(process.argv[2] || '').trim();
const receivingWebhook = String(process.argv[3] || '').trim();

if (!orderWebhook || !receivingWebhook) {
  console.error('Usage: node scripts/set-discord-notification-settings.mjs <order_webhook> <receiving_webhook>');
  process.exit(1);
}

const run = async () => {
  await settingsModel.setSetting('notification_provider', 'discord');
  await settingsModel.setSetting('line_notifications_enabled', 'true');
  await settingsModel.setSetting('discord_webhook_url', orderWebhook);
  await settingsModel.setSetting('discord_receiving_webhook_url', receivingWebhook);
  await settingsModel.setSetting(
    'discord_notification_groups',
    JSON.stringify([
      {
        id: '',
        name: 'คำสั่งซื้อ',
        enabled: true,
        fields: ['date', 'branch', 'department', 'count', 'items'],
        accessTokens: [{ name: 'คำสั่งซื้อ', token: orderWebhook }],
        quotaMode: 'manual'
      }
    ])
  );

  console.log('✅ Updated system_settings for Discord notifications');
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Failed to update Discord notification settings:', error?.message || error);
    process.exit(1);
  });
