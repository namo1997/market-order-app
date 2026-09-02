const GENERAL_CASHFLOW_SYNC = Object.freeze({
  API_URL: 'https://general-cashflow-production.up.railway.app/api/google-sheets/monthly-daily.csv?month=2026-07',
  TOKEN_PROPERTY: 'CASHFLOW_SHEETS_EXPORT_TOKEN',
  MONTH: '2026-07',
  HEADER_ROW: 4,
  DATA_START_ROW: 6,
  DAY_COUNT: 31,
  DAY_COLUMN: 1,
  STATUS_COLUMN: 2,
  SALES_COLUMN: 4,
  CASH_PLUS_CHANGE_COLUMNS: Object.freeze({
    KK: 14,
    SK: 5
  }),
  MORNING_CHANGE_COLUMNS: Object.freeze({
    KK: 15,
    SK: 6
  }),
  SCB_CREDIT_COLUMNS: Object.freeze({
    KK: 22
  }),
  QR_KPLUS_COLUMNS: Object.freeze({
    KK: 29,
    SK: 18
  }),
  QR_KRUNGSRI_COLUMNS: Object.freeze({
    KK: 30
  }),
  GRAB_COLUMNS: Object.freeze({
    KK: Object.freeze({ sales: 34, fee20: 35, adsPromotion: 36, bank: 37 }),
    SK: Object.freeze({ sales: 19, fee20: 20, adsPromotion: 21, bank: 22 })
  }),
  MISC_COLUMNS: Object.freeze({
    KK: Object.freeze({ foodStaff: 39, houseJum: 40, housePen: 41, grandma: 42, creditJumPen: 43, member: 44 }),
    SK: Object.freeze({ foodStaff: 24, houseJum: 26, housePen: 27, grandma: 28, creditJumPen: 29, member: 30 })
  }),
  MISC_HEADERS: Object.freeze({
    foodStaff: 'ค่าอาหารรถตู้/พนักงาน',
    houseJum: 'บ้านพี่จุ๋ม',
    housePen: 'บ้านพี่เพ็ญ',
    grandma: 'บ้านคุณย่า',
    creditJumPen: 'เครดิตพี่จุ๋ม/พี่เพ็ญ',
    member: 'สมาชิก'
  }),
  MISC_PROTECTION_RANGES: Object.freeze({
    KK: Object.freeze(['AM6:AR36']),
    SK: Object.freeze(['X6:X36', 'Z6:AD36'])
  }),
  DATA_SHEET: 'DATA_GC',
  LOG_SHEET: 'SYNC_LOG',
  BRANCH_SHEETS: Object.freeze({
    KK: 'คันคลอง 07.69',
    SK: 'บ้านเจ๊ 07.69'
  })
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('General Cashflow')
    .addItem('ดึงข้อมูลล่าสุด', 'syncGeneralCashflow')
    .addSeparator()
    .addItem('ติดตั้งการดึงข้อมูลทุก 15 นาที', 'installGeneralCashflowTrigger')
    .addToUi();
}

function syncGeneralCashflow() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error('มีการดึงข้อมูลรอบอื่นกำลังทำงานอยู่');

  try {
    const token = PropertiesService.getScriptProperties().getProperty(GENERAL_CASHFLOW_SYNC.TOKEN_PROPERTY);
    if (!token) throw new Error(`ยังไม่ได้ตั้ง Script Property: ${GENERAL_CASHFLOW_SYNC.TOKEN_PROPERTY}`);

    const response = UrlFetchApp.fetch(GENERAL_CASHFLOW_SYNC.API_URL, {
      method: 'get',
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new Error(`General Cashflow ตอบกลับ ${response.getResponseCode()}`);
    }

    const rows = Utilities.parseCsv(response.getContentText().replace(/^\uFEFF/, ''));
    const expectedHeaders = [
      'business_date',
      'day',
      'branch_code',
      'gross_sales_expected',
      'cash_plus_change',
      'morning_change',
      'scb_credit_amount',
      'qr_kplus_amount',
      'qr_krungsri_amount',
      'grab_sales_amount',
      'grab_fee_20_amount',
      'grab_ads_promotion_amount',
      'grab_bank_amount',
      'grab_source',
      'cashier_misc_total',
      'cashier_misc_note',
      'cashier_food_staff_amount',
      'cashier_food_staff_note',
      'cashier_house_jum_amount',
      'cashier_house_jum_note',
      'cashier_house_pen_amount',
      'cashier_house_pen_note',
      'cashier_grandma_amount',
      'cashier_grandma_note',
      'cashier_credit_jum_pen_amount',
      'cashier_credit_jum_pen_note',
      'cashier_member_amount',
      'cashier_member_note',
      'status',
      'status_label',
      'updated_at'
    ];
    if (rows.length !== 63 || expectedHeaders.some((header, index) => rows[0][index] !== header)) {
      throw new Error('โครงสร้างข้อมูลไม่ครบ 62 วัน-สาขา จึงคงค่าล่าสุดไว้');
    }

    const records = rows.slice(1).map((row) => ({
      businessDate: row[0],
      day: Number(row[1]),
      branchCode: row[2],
      grossSalesExpected: row[3] === '' ? '' : Number(row[3]),
      cashPlusChange: row[4] === '' ? '' : Number(row[4]),
      morningChange: row[5] === '' ? '' : Number(row[5]),
      scbCreditAmount: row[6] === '' ? '' : Number(row[6]),
      qrKplusAmount: row[7] === '' ? '' : Number(row[7]),
      qrKrungsriAmount: row[8] === '' ? '' : Number(row[8]),
      grabSalesAmount: row[9] === '' ? '' : Number(row[9]),
      grabFee20Amount: row[10] === '' ? '' : Number(row[10]),
      grabAdsPromotionAmount: row[11] === '' ? '' : Number(row[11]),
      grabBankAmount: row[12] === '' ? '' : Number(row[12]),
      grabSource: row[13],
      cashierMiscTotal: row[14] === '' ? '' : Number(row[14]),
      cashierMiscNote: row[15],
      misc: {
        foodStaff: { amount: row[16] === '' ? '' : Number(row[16]), note: row[17] },
        houseJum: { amount: row[18] === '' ? '' : Number(row[18]), note: row[19] },
        housePen: { amount: row[20] === '' ? '' : Number(row[20]), note: row[21] },
        grandma: { amount: row[22] === '' ? '' : Number(row[22]), note: row[23] },
        creditJumPen: { amount: row[24] === '' ? '' : Number(row[24]), note: row[25] },
        member: { amount: row[26] === '' ? '' : Number(row[26]), note: row[27] }
      },
      status: row[28],
      statusLabel: row[29],
      updatedAt: row[30]
    }));
    validateGeneralCashflowRecords_(records);

    const spreadsheet = SpreadsheetApp.getActive();
    const snapshots = snapshotSystemColumns_(spreadsheet);
    try {
      writeGeneralCashflowData_(spreadsheet, rows);
      Object.keys(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS).forEach((branchCode) => {
        const branchRows = records
          .filter((row) => row.branchCode === branchCode)
          .sort((left, right) => left.day - right.day);
        const sheet = spreadsheet.getSheetByName(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS[branchCode]);
        if (!sheet) throw new Error(`ไม่พบแท็บ ${GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS[branchCode]}`);
        sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, GENERAL_CASHFLOW_SYNC.DAY_COLUMN, 31, 1)
          .setValues(branchRows.map((row) => [row.day]));
        sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, GENERAL_CASHFLOW_SYNC.STATUS_COLUMN, 31, 1)
          .setValues(branchRows.map((row) => [row.statusLabel]));
        sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, GENERAL_CASHFLOW_SYNC.SALES_COLUMN, 31, 1)
          .setValues(branchRows.map((row) => [row.grossSalesExpected]));
        sheet.getRange(
          GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
          GENERAL_CASHFLOW_SYNC.CASH_PLUS_CHANGE_COLUMNS[branchCode],
          31,
          1
        ).setValues(branchRows.map((row) => [row.cashPlusChange]));
        sheet.getRange(
          GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
          GENERAL_CASHFLOW_SYNC.MORNING_CHANGE_COLUMNS[branchCode],
          31,
          1
        ).setValues(branchRows.map((row) => [row.morningChange]));
        const scbCreditColumn = GENERAL_CASHFLOW_SYNC.SCB_CREDIT_COLUMNS[branchCode];
        if (scbCreditColumn) {
          writeNonBlankSystemColumn_(sheet, scbCreditColumn, branchRows.map((row) => row.scbCreditAmount));
        }
        sheet.getRange(
          GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
          GENERAL_CASHFLOW_SYNC.QR_KPLUS_COLUMNS[branchCode],
          31,
          1
        ).setValues(branchRows.map((row) => [row.qrKplusAmount]));
        const qrKrungsriColumn = GENERAL_CASHFLOW_SYNC.QR_KRUNGSRI_COLUMNS[branchCode];
        if (qrKrungsriColumn) {
          writeNonBlankSystemColumn_(sheet, qrKrungsriColumn, branchRows.map((row) => row.qrKrungsriAmount));
        }
        const grabColumns = GENERAL_CASHFLOW_SYNC.GRAB_COLUMNS[branchCode];
        writeNonBlankSystemColumn_(sheet, grabColumns.sales, branchRows.map((row) => row.grabSalesAmount));
        writeNonBlankSystemColumn_(sheet, grabColumns.fee20, branchRows.map((row) => row.grabFee20Amount));
        writeNonBlankSystemColumn_(sheet, grabColumns.adsPromotion, branchRows.map((row) => row.grabAdsPromotionAmount));
        writeNonBlankSystemColumn_(sheet, grabColumns.bank, branchRows.map((row) => row.grabBankAmount));
        const miscColumns = GENERAL_CASHFLOW_SYNC.MISC_COLUMNS[branchCode];
        Object.keys(miscColumns).forEach((category) => {
          sheet.getRange(GENERAL_CASHFLOW_SYNC.HEADER_ROW, miscColumns[category])
            .setValue(GENERAL_CASHFLOW_SYNC.MISC_HEADERS[category]);
          writeNonBlankSystemColumnWithNotes_(
            sheet,
            miscColumns[category],
            branchRows.map((row) => row.misc[category].amount),
            branchRows.map((row) => row.misc[category].note)
          );
        });
      });
    } catch (writeError) {
      restoreSystemColumns_(spreadsheet, snapshots);
      throw writeError;
    }

    appendGeneralCashflowLog_('SUCCESS', `อัปเดต ${records.length} แถว`);
    SpreadsheetApp.flush();
  } catch (error) {
    appendGeneralCashflowLog_('ERROR', error.message || String(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function installGeneralCashflowTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'syncGeneralCashflow')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncGeneralCashflow').timeBased().everyMinutes(15).create();
  appendGeneralCashflowLog_('SETUP', 'ติดตั้ง trigger ทุก 15 นาทีแล้ว');
}

function configureGeneralCashflowSheet() {
  const spreadsheet = SpreadsheetApp.getActive();
  Object.values(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS).forEach((sheetName) => {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) throw new Error(`ไม่พบแท็บ ${sheetName}`);
    protectSystemRange_(sheet, 'A6:B36', `General Cashflow: วันที่และสถานะ (${sheetName})`);
    protectSystemRange_(sheet, 'D6:D36', `General Cashflow: ยอดขาย (${sheetName})`);
  });
  Object.entries(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS).forEach(([branchCode, sheetName]) => {
    const sheet = spreadsheet.getSheetByName(sheetName);
    const column = GENERAL_CASHFLOW_SYNC.CASH_PLUS_CHANGE_COLUMNS[branchCode];
    protectSystemRange_(
      sheet,
      `${columnToLetter_(column)}6:${columnToLetter_(column)}36`,
      `General Cashflow: เงินสด+เงินทอน (${sheetName})`
    );
    const morningChangeColumn = GENERAL_CASHFLOW_SYNC.MORNING_CHANGE_COLUMNS[branchCode];
    protectSystemRange_(
      sheet,
      `${columnToLetter_(morningChangeColumn)}6:${columnToLetter_(morningChangeColumn)}36`,
      `General Cashflow: เงินทอน (${sheetName})`
    );
    const scbCreditColumn = GENERAL_CASHFLOW_SYNC.SCB_CREDIT_COLUMNS[branchCode];
    if (scbCreditColumn) {
      protectSystemRange_(
        sheet,
        `${columnToLetter_(scbCreditColumn)}6:${columnToLetter_(scbCreditColumn)}36`,
        `General Cashflow: รูด เครดิต SCB (${sheetName})`
      );
    }
    const qrKplusColumn = GENERAL_CASHFLOW_SYNC.QR_KPLUS_COLUMNS[branchCode];
    protectSystemRange_(
      sheet,
      `${columnToLetter_(qrKplusColumn)}6:${columnToLetter_(qrKplusColumn)}36`,
      `General Cashflow: QR กสิกรไทย (${sheetName})`
    );
    const qrKrungsriColumn = GENERAL_CASHFLOW_SYNC.QR_KRUNGSRI_COLUMNS[branchCode];
    if (qrKrungsriColumn) {
      protectSystemRange_(
        sheet,
        `${columnToLetter_(qrKrungsriColumn)}6:${columnToLetter_(qrKrungsriColumn)}36`,
        `General Cashflow: QR กรุงศรี (${sheetName})`
      );
    }
    const grabColumns = GENERAL_CASHFLOW_SYNC.GRAB_COLUMNS[branchCode];
    protectSystemRange_(
      sheet,
      `${columnToLetter_(grabColumns.sales)}6:${columnToLetter_(grabColumns.bank)}36`,
      `General Cashflow: Grab (${sheetName})`
    );
    GENERAL_CASHFLOW_SYNC.MISC_PROTECTION_RANGES[branchCode].forEach((range) => {
      protectSystemRange_(
        sheet,
        range,
        `General Cashflow: รายการอื่น ๆ จากแคชเชียร์ ${range} (${sheetName})`
      );
    });
  });
  ensureHiddenSheet_(spreadsheet, GENERAL_CASHFLOW_SYNC.DATA_SHEET);
  ensureHiddenSheet_(spreadsheet, GENERAL_CASHFLOW_SYNC.LOG_SHEET);
  appendGeneralCashflowLog_('SETUP', 'ตั้งค่าชีตและการป้องกันคอลัมน์ระบบแล้ว');
}

function validateGeneralCashflowRecords_(records) {
  Object.keys(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS).forEach((branchCode) => {
    const rows = records.filter((row) => row.branchCode === branchCode);
    if (rows.length !== 31) throw new Error(`ข้อมูลสาขา ${branchCode} ไม่ครบ 31 วัน`);
    rows.forEach((row, index) => {
      if (row.businessDate !== `${GENERAL_CASHFLOW_SYNC.MONTH}-${String(index + 1).padStart(2, '0')}`) {
        throw new Error(`วันที่ของสาขา ${branchCode} ไม่ต่อเนื่อง`);
      }
      if (row.day !== index + 1 || !row.statusLabel) throw new Error(`ข้อมูลวันที่ ${index + 1} ของ ${branchCode} ไม่ถูกต้อง`);
      if (row.grossSalesExpected !== '' && !Number.isFinite(row.grossSalesExpected)) {
        throw new Error(`ยอดขายวันที่ ${index + 1} ของ ${branchCode} ไม่ใช่ตัวเลข`);
      }
      if (row.cashPlusChange !== '' && !Number.isFinite(row.cashPlusChange)) {
        throw new Error(`เงินสด+เงินทอนวันที่ ${index + 1} ของ ${branchCode} ไม่ใช่ตัวเลข`);
      }
      if (row.morningChange !== '' && !Number.isFinite(row.morningChange)) {
        throw new Error(`เงินทอนวันที่ ${index + 1} ของ ${branchCode} ไม่ใช่ตัวเลข`);
      }
      if (row.scbCreditAmount !== '' && !Number.isFinite(row.scbCreditAmount)) {
        throw new Error(`รูด เครดิต SCB วันที่ ${index + 1} ของ ${branchCode} ไม่ใช่ตัวเลข`);
      }
      if (row.qrKplusAmount !== '' && !Number.isFinite(row.qrKplusAmount)) {
        throw new Error(`QR กสิกรไทยวันที่ ${index + 1} ของ ${branchCode} ไม่ใช่ตัวเลข`);
      }
      if (row.qrKrungsriAmount !== '' && !Number.isFinite(row.qrKrungsriAmount)) {
        throw new Error(`QR กรุงศรีวันที่ ${index + 1} ของ ${branchCode} ไม่ใช่ตัวเลข`);
      }
      ['grabSalesAmount', 'grabFee20Amount', 'grabAdsPromotionAmount', 'grabBankAmount'].forEach((field) => {
        if (row[field] !== '' && !Number.isFinite(row[field])) {
          throw new Error(`Grab วันที่ ${index + 1} ของ ${branchCode} ไม่ใช่ตัวเลข`);
        }
      });
      if (!['', 'CASHIER', 'GRAB_REPORT', 'BANK_STATEMENT'].includes(row.grabSource)) {
        throw new Error(`แหล่งยอด Grab วันที่ ${index + 1} ของ ${branchCode} ไม่ถูกต้อง`);
      }
      if (row.cashierMiscTotal !== '' && !Number.isFinite(row.cashierMiscTotal)) {
        throw new Error(`รายการอื่น ๆ วันที่ ${index + 1} ของ ${branchCode} ไม่ใช่ตัวเลข`);
      }
      Object.entries(row.misc).forEach(([category, value]) => {
        if (value.amount !== '' && !Number.isFinite(value.amount)) {
          throw new Error(`หมวด ${category} วันที่ ${index + 1} ของ ${branchCode} ไม่ใช่ตัวเลข`);
        }
      });
    });
  });
}

function snapshotSystemColumns_(spreadsheet) {
  return Object.values(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS).map((sheetName) => {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) throw new Error(`ไม่พบแท็บ ${sheetName}`);
    const branchCode = Object.keys(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS)
      .find((code) => GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS[code] === sheetName);
    const miscColumns = GENERAL_CASHFLOW_SYNC.MISC_COLUMNS[branchCode];
    return {
      sheetName,
      days: sheet.getRange('A6:A36').getValues(),
      statuses: sheet.getRange('B6:B36').getValues(),
      sales: sheet.getRange('D6:D36').getValues(),
      cashPlusChange: sheet.getRange(
        GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
        GENERAL_CASHFLOW_SYNC.CASH_PLUS_CHANGE_COLUMNS[
          Object.keys(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS)
            .find((branchCode) => GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS[branchCode] === sheetName)
        ],
        31,
        1
      ).getValues(),
      morningChange: sheet.getRange(
        GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
        GENERAL_CASHFLOW_SYNC.MORNING_CHANGE_COLUMNS[
          Object.keys(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS)
            .find((branchCode) => GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS[branchCode] === sheetName)
        ],
        31,
        1
      ).getValues(),
      scbCreditAmount: (() => {
        const column = GENERAL_CASHFLOW_SYNC.SCB_CREDIT_COLUMNS[branchCode];
        return column
          ? sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, column, 31, 1).getValues()
          : null;
      })(),
      qrKplusAmount: sheet.getRange(
        GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
        GENERAL_CASHFLOW_SYNC.QR_KPLUS_COLUMNS[
          Object.keys(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS)
            .find((branchCode) => GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS[branchCode] === sheetName)
        ],
        31,
        1
      ).getValues(),
      qrKrungsriAmount: (() => {
        const column = GENERAL_CASHFLOW_SYNC.QR_KRUNGSRI_COLUMNS[branchCode];
        return column
          ? sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, column, 31, 1).getValues()
          : null;
      })(),
      miscValues: Object.fromEntries(Object.entries(miscColumns).map(([category, column]) => [
        category,
        sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, column, 31, 1).getValues()
      ])),
      miscNotes: Object.fromEntries(Object.entries(miscColumns).map(([category, column]) => [
        category,
        sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, column, 31, 1).getNotes()
      ])),
      grab: sheet.getRange(
        GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
        GENERAL_CASHFLOW_SYNC.GRAB_COLUMNS[branchCode].sales,
        31,
        4
      ).getValues()
    };
  });
}

function restoreSystemColumns_(spreadsheet, snapshots) {
  snapshots.forEach((snapshot) => {
    const sheet = spreadsheet.getSheetByName(snapshot.sheetName);
    sheet.getRange('A6:A36').setValues(snapshot.days);
    sheet.getRange('B6:B36').setValues(snapshot.statuses);
    sheet.getRange('D6:D36').setValues(snapshot.sales);
    const branchCode = Object.keys(GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS)
      .find((code) => GENERAL_CASHFLOW_SYNC.BRANCH_SHEETS[code] === snapshot.sheetName);
    sheet.getRange(
      GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
      GENERAL_CASHFLOW_SYNC.CASH_PLUS_CHANGE_COLUMNS[branchCode],
      31,
      1
    ).setValues(snapshot.cashPlusChange);
    sheet.getRange(
      GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
      GENERAL_CASHFLOW_SYNC.MORNING_CHANGE_COLUMNS[branchCode],
      31,
      1
    ).setValues(snapshot.morningChange);
    if (snapshot.scbCreditAmount) {
      sheet.getRange(
        GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
        GENERAL_CASHFLOW_SYNC.SCB_CREDIT_COLUMNS[branchCode],
        31,
        1
      ).setValues(snapshot.scbCreditAmount);
    }
    sheet.getRange(
      GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
      GENERAL_CASHFLOW_SYNC.QR_KPLUS_COLUMNS[branchCode],
      31,
      1
    ).setValues(snapshot.qrKplusAmount);
    if (snapshot.qrKrungsriAmount) {
      sheet.getRange(
        GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
        GENERAL_CASHFLOW_SYNC.QR_KRUNGSRI_COLUMNS[branchCode],
        31,
        1
      ).setValues(snapshot.qrKrungsriAmount);
    }
    Object.entries(GENERAL_CASHFLOW_SYNC.MISC_COLUMNS[branchCode]).forEach(([category, column]) => {
      const miscRange = sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, column, 31, 1);
      miscRange.setValues(snapshot.miscValues[category]);
      miscRange.setNotes(snapshot.miscNotes[category]);
    });
    sheet.getRange(
      GENERAL_CASHFLOW_SYNC.DATA_START_ROW,
      GENERAL_CASHFLOW_SYNC.GRAB_COLUMNS[branchCode].sales,
      31,
      4
    ).setValues(snapshot.grab);
  });
}

function writeGeneralCashflowData_(spreadsheet, rows) {
  const sheet = ensureHiddenSheet_(spreadsheet, GENERAL_CASHFLOW_SYNC.DATA_SHEET);
  sheet.clearContents();
  if (sheet.getMaxColumns() < rows[0].length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), rows[0].length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.hideSheet();
}

function writeNonBlankSystemColumn_(sheet, column, values) {
  const range = sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, column, values.length, 1);
  const current = range.getValues();
  range.setValues(values.map((value, index) => [value === '' ? current[index][0] : value]));
}

function writeNonBlankSystemColumnWithNotes_(sheet, column, values, notes) {
  const range = sheet.getRange(GENERAL_CASHFLOW_SYNC.DATA_START_ROW, column, values.length, 1);
  const currentValues = range.getValues();
  const currentNotes = range.getNotes();
  range.setValues(values.map((value, index) => [value === '' ? currentValues[index][0] : value]));
  range.setNotes(notes.map((note, index) => [values[index] === '' ? currentNotes[index][0] : note]));
}

function appendGeneralCashflowLog_(status, message) {
  const sheet = ensureHiddenSheet_(SpreadsheetApp.getActive(), GENERAL_CASHFLOW_SYNC.LOG_SHEET);
  if (sheet.getLastRow() === 0) sheet.appendRow(['timestamp', 'status', 'message']);
  sheet.appendRow([new Date(), status, message]);
  sheet.hideSheet();
}

function ensureHiddenSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  sheet.hideSheet();
  return sheet;
}

function protectSystemRange_(sheet, a1Notation, description) {
  const range = sheet.getRange(a1Notation);
  const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .find((protection) => protection.getDescription() === description);
  const protection = existing || range.protect().setDescription(description);
  protection.setRange(range).setWarningOnly(false);
  const owner = Session.getEffectiveUser();
  protection.addEditor(owner);
  protection.getEditors()
    .filter((editor) => editor.getEmail() !== owner.getEmail())
    .forEach((editor) => protection.removeEditor(editor));
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

function columnToLetter_(column) {
  let value = Number(column);
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}
