# SOLAO market workspace rules

Follow `AGENTS.md`, `docs/REPOSITORY_HYGIENE.md` and `/Users/surachart/.solao-tools/SSD_POLICY.md` for this repository and its services. These rules are the user's instruction dated 2026-10-04.

Search current source/tests/config with `rg` honoring `.ignore`. Do not broadly scan hidden/ignored artifacts or historical archive. For history, open `archive/README.md` explicitly and select the relevant file. Read the service's AGENTS.md before its changes; preserve other chats' dirty source and current patches.

New generated data, backups, test/build outputs and temporary work belong only on verified SSD. Stop when SSD verification fails. Keep old evidence/backups and canonical release workflows; search-ignore rules do not authorize deletion or deployment.

After reorganizing source or changing ignore rules, run the read-only `node scripts/check-repository-hygiene.mjs`. Maintain the archive index and affected links/imports. Save any generated verification report on SSD.
