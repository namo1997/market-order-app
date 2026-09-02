# AR-P8-SD-A Release Manifest

- Scope: `AR-P8-SD-A`
- Approval: `อนุมัติ User Gate 8.1: Deploy เฉพาะ General Cashflow source API`
- Release unit: six read-only `GET /accounting-export/*` routes and their source tests
- Pre-push branch: `codex/สำหรับรวมระบบ`
- Pre-push HEAD: `bf7514ee345ad08d270139f7461fc9ce4e42f0c9`
- Remote: `origin` (`https://github.com/namo1997/market-order-app.git`)
- Railway project: `market-order-system` (`a7a9dbdd-f560-476f-98f4-119330c90e57`)
- Railway environment: `production` (`8dd3216f-43c5-406c-8cac-c13519a42361`)
- Railway service: `general-cashflow` (`76c12906-b046-4b99-a3fc-bf08f559ce73`)
- Railway root: `general-cashflow`
- Railway domain: `general-cashflow-production.up.railway.app`
- Railway watch path: `general-cashflow/**`
- Release commit: recorded in the handoff after commit creation
- Deployment ID/status: recorded in the handoff after terminal Railway status

## Exact release file checksums

| Path | SHA-256 |
| --- | --- |
| `general-cashflow/server/src/accountingExportReceivables.js` | `9692da813280fd62f005b2c6f412bffaf37ec406170a19cd446ffd5080b8b551` |
| `general-cashflow/server/src/db.js` | `620d7be5b268f4ff102cd974e832cfd89c1c4a25f04d5e98f3842daa6d5f4b92` |
| `general-cashflow/server/src/server.js` | `b459f669ab85ad78a82ae608af09fd25e1999835a6a17b9e68214ff99239f3b5` |
| `general-cashflow/server/test/accountingExportFixtureServer.test.js` | `0f3fb48faf68ad55e046c4d07e105d02eaf93b62ab4d1e7e3da1ad030e4d99be` |
| `general-cashflow/server/test/accountingExportReceivables.contract.test.js` | `c55d1d82d0fde001b4bb88290ccfd8eb0b6bcab137c17563bceb2343b2ab06ef` |
| `general-cashflow/server/test/accountingExportReceivables.phase4.test.js` | `2e19698576230fc62674614d61badb511f11fbf9b9e30b508eb99734d7b12e38` |
| `general-cashflow/server/test/accountingExportReceivables.unit.test.js` | `c75b36f72ff4ec046944433162cc4a20d4909dd8096fe2e65ced3b4f122f39f3` |
| `general-cashflow/server/test/helpers/accountingExportFixtureServer.js` | `4805bf46d52202728edba5e4403dd16f32bc2a555a1c9c27266bfa26e3117015` |

## Verification

- `git diff --check`: PASS
- Focused source tests: `32/32 PASS`
- Full `general-cashflow/server` test suite: `182/182 PASS`
- Staging policy: only the exact source/test allowlist plus this manifest
- Deployment policy: only `general-cashflow`; no Management Accounting deploy, Preview, Apply, Lock, rollback, or source write
