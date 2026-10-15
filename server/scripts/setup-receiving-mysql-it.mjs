import { openHarness } from '../tests/integration/receiving-mysql-harness.mjs';

const harness = await openHarness();
try {
  await harness.setup();
  await harness.setup();
  console.info(JSON.stringify({
    identity: harness.identity,
    schema: 'minimal legacy fixture from repository models; schema.sql/migrations absent',
    receivingTables: 'real ensureReceivingDocumentsTables executed twice'
  }, null, 2));
} finally { await harness.close(); }
