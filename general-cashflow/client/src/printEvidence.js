export const DETAIL_EVIDENCE_CHANNELS = [
  { code: 'CREDIT_CARD_SCB', label: 'บัตรเครดิต SCB' },
  { code: 'CREDIT_CARD_KTC', label: 'บัตรเครดิต KTC' },
  { code: 'QR_KPLUS', label: 'QR กสิกร' },
  { code: 'GRAB', label: 'GRAB food' },
  { code: 'QR_KRUNGSRI', label: 'QR กรุงศรี' }
];

export const CASHIER_EVIDENCE_GROUPS = [
  { type: 'cash_slip', label: 'สรุปยอดเงิน' },
  { type: 'cashier_summary', label: 'รูปสรุปรวมหน้าร้าน' },
  { type: 'statement', label: 'สรุปบัตรเครดิต' },
  { type: 'other', label: 'บิลจ่ายอื่นๆ' }
];

export const PRINT_LIMITS = Object.freeze({
  maxPagesPerFile: 30,
  maxPagesPerPacket: 60,
  maxRasterPixels: 80_000_000,
  maxRasterSide: 1800
});

export const createPrintBudget = (limits = PRINT_LIMITS) => ({ ...limits, pages: 0, rasterPixels: 0 });

export const addToPrintBudget = (budget, { pages = 0, rasterPixels = 0, fileName = 'ไฟล์' }) => {
  const fail = (message) => {
    const error = new Error(message);
    error.printFatal = true;
    throw error;
  };
  if (pages > budget.maxPagesPerFile) {
    fail(`${fileName} มี ${pages} หน้า เกินขีดจำกัด ${budget.maxPagesPerFile} หน้าต่อไฟล์`);
  }
  const nextPages = budget.pages + pages;
  const nextPixels = budget.rasterPixels + rasterPixels;
  if (nextPages > budget.maxPagesPerPacket) {
    fail(`ชุดเอกสารมี ${nextPages} หน้า เกินขีดจำกัด ${budget.maxPagesPerPacket} หน้า`);
  }
  if (nextPixels > budget.maxRasterPixels) {
    fail('ชุดเอกสารมีความละเอียดรวมเกิน 80 ล้านพิกเซล กรุณาลดจำนวนหน้าหรือขนาดไฟล์');
  }
  budget.pages = nextPages;
  budget.rasterPixels = nextPixels;
  return budget;
};

const lineHasActivity = (line = {}) => [
  line.cashier_amount,
  line.statement_amount,
  line.expected_gross_amount,
  line.fee_amount,
  line.expected_net_amount,
  line.matched_amount
].some((value) => Math.abs(Number(value || 0)) >= 0.01);

export const selectReceiptEvidenceEntries = (receipt = {}) => {
  const lines = receipt.lines || [];
  const attachments = receipt.attachments || [];
  const attachmentById = new Map(attachments.map((attachment) => [Number(attachment.id), attachment]));

  const channelEntries = DETAIL_EVIDENCE_CHANNELS.map((channel) => {
    const line = lines.find((item) => item.channel_code === channel.code);
    const attachment = line?.evidence_attachment_id
      ? attachmentById.get(Number(line.evidence_attachment_id)) || null
      : null;
    return {
      key: `channel-${channel.code}`,
      category: 'เอกสารอ้างอิงเงินเข้า',
      label: channel.label,
      channelCode: channel.code,
      line: line || null,
      attachment,
      status: !line ? 'not_applicable' : attachment ? 'ready' : lineHasActivity(line) ? 'missing' : 'no_activity'
    };
  });

  const cashierEntries = CASHIER_EVIDENCE_GROUPS.flatMap((group) => {
    const matches = attachments.filter((attachment) => (
      attachment.attachment_type === group.type && attachment.uploaded_by_role === 'cashier'
    ));
    if (matches.length === 0) {
      return [{
        key: `cashier-${group.type}-missing`,
        category: 'เอกสารชี้แจงจากหน้าร้าน',
        label: group.label,
        attachment: null,
        status: 'missing'
      }];
    }
    return matches.map((attachment, index) => ({
      key: `cashier-${group.type}-${attachment.id}-${index}`,
      category: 'เอกสารชี้แจงจากหน้าร้าน',
      label: group.label,
      attachment,
      status: 'ready'
    }));
  });

  return [...channelEntries, ...cashierEntries];
};
