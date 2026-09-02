# Statement Training Fixtures

These files are synthetic training samples. They contain no real customer names, account numbers, transaction references, merchant details, or bank logos.

| Fixture | Source pattern | Use in General Cashflow |
|---|---|---|
| `kasikorn-recent-transaction.csv` | K PLUS recent transaction export with metadata before the actual header | Confirm Thai QR/K SHOP/MYQR classification and exclude unrelated transfers |
| `scb-incoming-transaction.csv` | SCB incoming transaction report in CSV form | Confirm `Credit Amount` parsing and PromptPay classification |
| `grab-settlement-evidence.json` | Grab merchant transaction/transfer/settlement report | Practice manual gross, fee, and net settlement entry before matching a bank deposit |
| `card-settlement-evidence.json` | Merchant card settlement report | Practice matching the net payout after merchant discount fees |
| `ktc-settlement-evidence.json` | KTC merchant daily sales / payout report | Practice KTC MDR plus VAT on MDR before matching the net payout |

Public form references used only to define the categories and export formats:

- K PLUS supports requesting detailed account statements and transaction history: https://www.kasikornbank.com/th/kplus/instruction/statement
- SCB Business Net supports statement downloads in TXT, CSV, XLS, and PDF: https://www.scb.co.th/en/corporate-banking/business-cash-management/scb-business-e-channel/scb-business-net.html
- SCB Incoming Transaction Statement Report consolidates incoming payments from several channels for reconciliation: https://www.scb.co.th/th/sme-banking/services/cash-management/business-collection/scb-incoming-transaction-statement-report
- GrabMerchant Finance reports include transactions, transfers, settlements, and refunds: https://merchant.grab.com/en-ph/blog/why-the-grabmerchant-portal-is-your-best-business-partner
- KTC Merchant publishes daily sales, bank-credit reports, and e-tax documents; its KTC merchant example shows MDR and VAT on MDR being deducted before payout: https://www.ktc.co.th/merchant?lang=en_US
