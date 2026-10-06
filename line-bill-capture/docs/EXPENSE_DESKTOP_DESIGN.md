# Expense document facts — desktop design brief

## Product and requested outcome
Thai operators review real bills/slips, identify purchase purpose, supplier and actual recipient, and save sourced facts without accidental matching or financial changes. This iteration completes the existing phase1 document profile workflow and Other classification options with tested buttons/input/error states. Desktop only is the design target: 1280×800, 1440×900 and 1920×1080. It does not activate downstream accounting exports or invent unresolved company/party integration decisions.

## Existing UI and chosen direction
The existing admin is a quiet light backoffice instrument with IBM Plex Sans Thai, tabular amounts, neutral borders and restrained action colors. Preserve these tokens, native dialog accessibility, original document facts, and explicit OCR proposal adoption. The old 620px tall form makes document comparison and saving require repeated scrolling; old history lists revisions without readable correction values.

Taste readout: clarity and evidence comparison matter more than decorative styling. Use a wide document-review workspace, stable header/footer and a distinct primary reviewed-save action. An alternative fullscreen dashboard adds unrelated chrome; a narrow wizard hides useful context. Both are less suitable than a two-pane workspace.

Reference routing: stay closest to current product style, using tasteful-ui production implementation mode. The Notion family supplies low-weight dividers, neutral reading surfaces and subordinate annotations only. Do not copy branding, editorial hero typography, marketing spacing, or dark cockpit decoration.

## Layout and visual rules
Native dialog roughly1180px wide within viewport, bounded height. Header shows document ID, review state and close control. Left pane holds the actual current document preview, metadata and explicit open-image action; right pane scrolls through four logical field groups, with related short fields in two columns. Long purpose/notes span their group. Footer keeps save controls available while scrolling. All controls remain visible/reachable by keyboard and no amount is editable here.

Use existing paper/ink/line tokens, primary button style, 14–16px readable Thai text, 8/12/16/24px spacing, understated borders/radii and a clear focus ring. No filler metrics/cards, invented evidence, mobile redesign, or animation. Long names, multiline chat and correction values wrap. Smaller widths may retain the existing safe fallback; no mobile deliverable is claimed.

## State and input behavior
Drafts are keyed by item, preserved on close/in-page navigation and protected against late loads/polls. Saved drafts persist across reload. Dirty indication updates while typing. Draft save permits missing purchase fields; reviewed-save requires transaction type, purchase supplier/purpose or explained exception, and supplier/payee relation when names differ. Validation explains the first missing field in Thai and focuses it. Full account input is rejected; masked input matches server validation. Reason is required with focus feedback.

No background confirmation, automatic proposal adoption, financial write, AI call or learning. Buttons show loading/disabled while request is pending, visible success only after actual API success, and retain edits on failed/conflicting save. Reload explicitly confirms replacing a dirty draft; cancellation retains it. Close/Escape restores focus to entry. Enter inside multiline inputs does not submit unexpectedly. Error paths allow retry. History shows actor/time/reason plus changed old/new values and their provenance. Historical evidence remains labelled as a snapshot.

Other classification preserves presets/custom reason, separately opt-in AI analysis and teaching, invalidates analysis when reason changes, and supports manual save with AI disabled. Test actual browser controls with mock AI only.

## Completion evidence
Maintain a requirement-by-requirement matrix and a reproducible CLI browser workflow using fictional documents/chat/images on verified SSD. Cover draft save/reload, every field/select/proposal/evidence action, reviewed validation, nonpurchase/unknown, masked account, revisions/history, conflict and reload accept/cancel, failed GET/PUT retry, delayed responses/double-click, scope navigation, keyboard, image handling and Other options. Browser actions must use real rendered UI, not direct API writes as substitutes. Independently test API invariants, all relevant regressions, build/smoke and source hashes. Screenshot desktop layouts and inspect actual image loading, scroll/footer positions and overflow.

Generated artifacts and logs go only to verified SSD. Canonical source is /Users/surachart/ระบบสั่งของตลาดสด/line-bill-capture; no unrelated dirty changes are staged or deployed.
