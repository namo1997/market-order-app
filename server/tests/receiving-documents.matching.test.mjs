import test from 'node:test';
import assert from 'node:assert/strict';
import * as ocrService from '../src/services/receiving-ocr.service.js';

test("Short product names do not falsely match longer catalog prefixes", async () => {
  assert.ok(ocrService.computeTextSimilarity('หมู', 'หมูบด') < 0.7);
  assert.ok(ocrService.computeTextSimilarity('น้ำ', 'น้ำแข็ง') < 0.7);
});

test("Catalog matching converts alias units and never reuses an order_item_id", async () => {
  const ocrLines = [
    {
      line_no: 1,
      bill_text: 'นมข้นหวาน คาร์เนชั่น',
      quantity_billed: 1,
      unit_text: 'ลัง',
      unit_price: 600,
      amount: 600,
      confidence: 0.95
    },
    {
      line_no: 2,
      bill_text: 'นมข้นหวาน คาร์เนชั่น',
      quantity_billed: 1,
      unit_text: 'ลัง',
      unit_price: 600,
      amount: 600,
      confidence: 0.95
    },
    {
      line_no: 3,
      bill_text: 'น้ำ',
      quantity_billed: 2,
      unit_text: 'ถุง',
      unit_price: 20,
      amount: 40,
      confidence: 0.9
    }
  ];

  const aliases = [
    {
      supplier_key: 'pg:3',
      bill_text: 'นมข้นหวาน คาร์เนชั่น',
      normalized_bill_text: ocrService.normalizeMatchText('นมข้นหวาน คาร์เนชั่น'),
      unit_text: 'ลัง',
      normalized_unit_text: ocrService.normalizeMatchText('ลัง'),
      product_id: 101,
      product_name: 'นมข้นหวาน (กระป๋อง)',
      unit_id: 10,
      unit_multiplier: 12
    }
  ];

  const expectedItems = [
    {
      order_item_id: 501,
      product_id: 101,
      product_name: 'นมข้นหวาน (กระป๋อง)',
      unit_id: 10,
      unit_name: 'กระป๋อง',
      quantity_ordered: 12
    },
    {
      order_item_id: 502,
      product_id: 202,
      product_name: 'น้ำแข็งหลอด',
      unit_id: 20,
      unit_name: 'ถุง',
      quantity_ordered: 2
    }
  ];

  const matched = ocrService.matchOcrLinesToCatalog({
    ocrLines,
    aliases,
    expectedItems,
    supplierKey: 'pg:3'
  });

  assert.equal(matched[0].product_id, 101);
  assert.equal(matched[0].order_item_id, 501);
  assert.equal(matched[0].quantity_received, 12);
  assert.equal(matched[0].unit_price, 600);
  assert.equal(matched[0].base_unit_price, 50);

  assert.equal(matched[1].product_id, 101);
  assert.equal(matched[1].order_item_id, null);

  assert.equal(matched[2].product_id, null);
  assert.equal(matched[2].match.source, 'none');
});

test("Price comparison uses the base unit price", async () => {
  const noPriceWarning = ocrService.computeDocumentWarnings({
    document: { subtotal: 600, total: 600, ocr_confidence: 0.95 },
    lines: [
      {
        line_no: 1,
        product_id: 101,
        order_item_id: 501,
        unit_multiplier: 12,
        quantity_billed: 1,
        quantity_received: 12,
        unit_price: 600,
        base_unit_price: 50,
        amount: 600,
        match_confidence: 0.95
      }
    ],
    expectedItemsById: new Map([[501, { order_item_id: 501, quantity_ordered: 12 }]]),
    latestPricesByProductId: new Map([[101, 50]]),
    isDuplicateBill: false
  });
  assert.equal(noPriceWarning.warningCodes.includes('PRICE_CHANGE'), false);
});

test("Warning calculation includes all seven original warning codes", async () => {
  const allWarnings = ocrService.computeDocumentWarnings({
    document: { subtotal: 2000, total: 2500, ocr_confidence: 0.65 },
    lines: [
      {
        line_no: 1,
        product_id: 101,
        order_item_id: 501,
        quantity_billed: 8,
        quantity_received: 8,
        unit_price: 130,
        base_unit_price: 130,
        amount: 1040,
        match_confidence: 0.95
      },
      {
        line_no: 2,
        product_id: 202,
        order_item_id: 502,
        quantity_billed: 6,
        quantity_received: 6,
        unit_price: 200,
        base_unit_price: 200,
        amount: 1200,
        match_confidence: 0.55
      },
      {
        line_no: 3,
        product_id: null,
        order_item_id: null,
        quantity_billed: 1,
        quantity_received: 1,
        unit_price: 50,
        amount: 50,
        match_confidence: null
      }
    ],
    expectedItemsById: new Map([
      [501, { order_item_id: 501, quantity_ordered: 10 }],
      [502, { order_item_id: 502, quantity_ordered: 5 }]
    ]),
    latestPricesByProductId: new Map([
      [101, 100],
      [202, 200]
    ]),
    isDuplicateBill: true
  });

  for (const code of [
    'SUM_MISMATCH',
    'PRICE_CHANGE',
    'QTY_SHORT',
    'QTY_OVER',
    'UNMATCHED_LINE',
    'DUPLICATE_BILL',
    'LOW_CONFIDENCE'
  ]) {
    assert.ok(allWarnings.warningCodes.includes(code), `Missing warning code: ${code}`);
  }
});
