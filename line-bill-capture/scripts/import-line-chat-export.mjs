import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  getDbPath,
  getImagesDir,
  initDatabase,
  markDownloaded,
  recordLineEvent,
  upsertReceivedImage,
  upsertSenderProfile
} from '../src/db.js';
import { parseLineChatExport } from '../src/line-export.js';

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => (
  arg.startsWith('--') ? [arg.slice(2), all[index + 1]?.startsWith('--') ? '1' : all[index + 1]] : null
)).filter(Boolean));
const file = path.resolve(String(args.file || ''));
const imagesDir = args.images ? path.resolve(String(args.images)) : '';
const sourceId = String(args['source-id'] || '').trim();
const sourceType = String(args['source-type'] || 'group').trim() || 'group';
const start = String(args.start || '').trim();
const end = String(args.end || '').trim();
const senderAliases = (() => {
  const raw = String(process.env.LINE_EXPORT_SENDER_ALIASES || '').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
})();
let imageImportQuality = 'expired_line_desktop_thumbnail';

if (!file || !sourceId || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
  throw new Error('Usage: node scripts/import-line-chat-export.mjs --file FILE --images DIR --source-id ID --start YYYY-MM-DD --end YYYY-MM-DD');
}

await fs.access(file);
if (imagesDir) await fs.access(imagesDir);
if (imagesDir) {
  try {
    const recoveryManifest = JSON.parse(await fs.readFile(path.join(imagesDir, 'recovery-manifest.json'), 'utf8'));
    if (Array.isArray(recoveryManifest) && recoveryManifest.length) {
      imageImportQuality = 'expired_line_desktop_thumbnail_upscaled';
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
await fs.mkdir(path.dirname(getDbPath()), { recursive: true });
try {
  await fs.access(getDbPath());
  const backupDir = path.join(path.dirname(getDbPath()), 'backups');
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `before-line-export-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  const backupDb = new DatabaseSync(getDbPath());
  backupDb.exec(`PRAGMA wal_checkpoint(FULL); VACUUM INTO '${backupPath.replaceAll("'", "''")}';`);
  backupDb.close();
  console.log(`Backup: ${backupPath}`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const messages = parseLineChatExport(await fs.readFile(file, 'utf8'), { start, end });
const imageMessages = messages.filter((message) => message.messageType === 'image');
if (imagesDir) {
  const files = (await fs.readdir(imagesDir)).filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name)).sort();
  if (files.length !== imageMessages.length) {
    throw new Error(`Image count mismatch: export=${imageMessages.length}, files=${files.length}`);
  }
  imageMessages.forEach((message, index) => { message.imageFile = path.join(imagesDir, files[index]); });
}

await initDatabase();
let importedImages = 0;
let importedMessages = 0;
let imageIndex = 0;
for (const message of messages) {
  const rawEvent = {
    type: 'message',
    webhookEventId: message.webhookEventId,
    timestamp: message.timestamp,
    source: { type: sourceType, groupId: sourceId, userId: message.senderUserId },
    message: {
      id: message.lineMessageId,
      type: message.messageType,
      ...(message.messageType === 'text' ? { text: message.text } : {})
    },
    import: {
      format: 'line_chat_text_export',
      sender_name: message.sender,
      source_file: path.basename(file),
      image_quality: message.imageFile ? imageImportQuality : null
    }
  };

  await recordLineEvent(rawEvent);
  await upsertSenderProfile({
    sourceType,
    sourceId,
    userId: message.senderUserId,
    displayName: message.sender,
    canonicalUserId: senderAliases[message.sender],
    profileStatus: 'imported'
  });
  importedMessages += 1;

  if (message.messageType !== 'image') continue;
  imageIndex += 1;
  await upsertReceivedImage({
    event: rawEvent,
    source: { sourceType, sourceId, senderUserId: message.senderUserId }
  });
  if (!message.imageFile) continue;

  const bytes = await fs.readFile(message.imageFile);
  const extension = path.extname(message.imageFile).slice(1).toLowerCase() || 'jpg';
  const relativePath = path.join('historical', message.date, sourceId, `${message.lineMessageId}.${extension}`);
  const storagePath = path.join(getImagesDir(), relativePath);
  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await fs.writeFile(storagePath, bytes);
  const result = await markDownloaded({
    lineMessageId: message.lineMessageId,
    contentType: extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg',
    fileExtension: extension,
    fileSizeBytes: bytes.length,
    fileSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    storagePath,
    storageRelativePath: relativePath
  });
  if (result.duplicate) await fs.unlink(storagePath).catch(() => {});
  else importedImages += 1;
}

console.log(JSON.stringify({ source_id: sourceId, start, end, messages: importedMessages, image_markers: imageIndex, images_saved: importedImages }, null, 2));
