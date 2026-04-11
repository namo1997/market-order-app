import dotenv from 'dotenv';

dotenv.config();

const DISCORD_APPLICATION_ID = String(process.env.DISCORD_APPLICATION_ID || '').trim();
const DISCORD_BOT_TOKEN = String(process.env.DISCORD_BOT_TOKEN || '').trim();
const DISCORD_GUILD_ID_FROM_ENV = String(process.env.DISCORD_GUILD_ID || '').trim();
const DISCORD_GUILD_ID_FROM_ARG = String(process.argv[2] || '').trim();
const DISCORD_GUILD_ID = DISCORD_GUILD_ID_FROM_ARG || DISCORD_GUILD_ID_FROM_ENV;

if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN) {
  console.error('❌ Missing env: DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required');
  process.exit(1);
}

const commands = [
  {
    name: 'sales_daily',
    description: 'สรุปยอดขายรายวันจาก ClickHouse',
    options: [
      {
        type: 3, // STRING
        name: 'start',
        description: 'วันที่เริ่ม YYYY-MM-DD (ไม่กรอก = วันนี้)',
        required: false
      },
      {
        type: 3, // STRING
        name: 'end',
        description: 'วันที่สิ้นสุด YYYY-MM-DD (ไม่กรอก = start)',
        required: false
      },
      {
        type: 3, // STRING
        name: 'branch_id',
        description: 'ClickHouse Branch ID (ไม่กรอก = ทุกสาขา)',
        required: false
      }
    ]
  },
  {
    name: 'ask_sales',
    description: 'ถามคำถามยอดขายด้วย AI',
    options: [
      {
        type: 3, // STRING
        name: 'question',
        description: 'คำถามที่ต้องการถาม',
        required: true
      },
      {
        type: 3, // STRING
        name: 'start',
        description: 'วันที่เริ่ม YYYY-MM-DD (ไม่กรอก = วันนี้)',
        required: false
      },
      {
        type: 3, // STRING
        name: 'end',
        description: 'วันที่สิ้นสุด YYYY-MM-DD (ไม่กรอก = start)',
        required: false
      },
      {
        type: 3, // STRING
        name: 'branch_id',
        description: 'ClickHouse Branch ID (ไม่กรอก = ทุกสาขา)',
        required: false
      }
    ]
  }
];

const endpoint = DISCORD_GUILD_ID
  ? `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;

const run = async () => {
  console.log(
    DISCORD_GUILD_ID
      ? `⏳ Registering commands to guild ${DISCORD_GUILD_ID}...`
      : '⏳ Registering global commands...'
  );

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API error ${response.status}: ${body}`);
  }

  const payload = await response.json();
  const list = Array.isArray(payload) ? payload : [];

  console.log(`✅ Registered ${list.length} command(s)`);
  list.forEach((command, index) => {
    console.log(`${index + 1}. /${command.name} (id: ${command.id})`);
  });
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Failed to register commands:', error?.message || error);
    process.exit(1);
  });
