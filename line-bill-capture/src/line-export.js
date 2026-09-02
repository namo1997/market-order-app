import crypto from 'node:crypto';

const DEFAULT_SENDERS = [
  '💖Saa.💵Roongthip🎋🔮',
  'นะโม นะครับ',
  'nungning🌦️',
  'pen pen',
  'JPuN',
  'Jum',
  'J.'
];

const stableId = (prefix, value) => `${prefix}-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)}`;

export const parseLineChatExport = (rawText, { start = '', end = '', senders = DEFAULT_SENDERS } = {}) => {
  const lines = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  // LINE's text export has no explicit sender delimiter. Media/system markers are
  // reliable anchors, so use them to discover members that are absent from the
  // legacy allow-list before parsing the surrounding text messages.
  const discoveredSenders = lines.flatMap((line) => {
    const match = line.match(/^\d{2}:\d{2}\s+(.+?)\s+(?:รูป|สติกเกอร์|ยกเลิกข้อความ)$/);
    return match ? [match[1].trim()] : [];
  });
  const knownSenders = [...new Set([...senders, ...discoveredSenders]
    .map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const messages = [];
  let currentDate = '';
  let current = null;

  const finish = () => {
    if (!current) return;
    current.text = current.text.trim();
    messages.push(current);
    current = null;
  };

  for (const line of lines) {
    const dateMatch = line.match(/^(\d{4})\.(\d{2})\.(\d{2})(?:\s|$)/);
    if (dateMatch) {
      finish();
      currentDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
      continue;
    }

    const timeMatch = line.match(/^(\d{2}):(\d{2})\s+(.+)$/);
    if (timeMatch && currentDate) {
      const rest = timeMatch[3];
      const sender = knownSenders.find((name) => rest === name || rest.startsWith(`${name} `));
      if (sender) {
        finish();
        current = {
          date: currentDate,
          time: `${timeMatch[1]}:${timeMatch[2]}`,
          sender,
          text: rest.slice(sender.length).trim()
        };
        continue;
      }
    }

    if (current) current.text += `\n${line}`;
  }
  finish();

  return messages
    .filter((message) => (!start || message.date >= start) && (!end || message.date <= end))
    .map((message, index) => {
      const timestamp = new Date(`${message.date}T${message.time}:00+07:00`).getTime();
      const identity = `${message.date}|${message.time}|${index}|${message.sender}|${message.text}`;
      return {
        ...message,
        sequence: index,
        timestamp,
        messageType: message.text === 'รูป' ? 'image' : message.text === 'สติกเกอร์' ? 'sticker' : 'text',
        senderUserId: stableId('line-export-user', message.sender),
        lineMessageId: stableId('line-export-message', identity),
        webhookEventId: stableId('line-export-event', identity)
      };
    });
};
