Run the built-in Node test runner through the SOLAO SSD workspace tool, using the google-apps-script directory as the snapshot source. These tests use mocked Apps Script services and never contact Gmail or Cashflow.

`CashflowMailRuntime.gs` is deployed to the existing standalone importer project, not the monthly Sheet project recorded by `.clasp.json`.
