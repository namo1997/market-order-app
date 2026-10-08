# Desktop expense review design

This is a Thai bill review workspace: inspect one bill and its slip, prepare expense facts, and explicitly save a draft or a reviewed profile. Review remains separate from payment, receipt, inventory, and accounting posting.

The existing light canvas, coloured section icons, document viewer, fixed actions, and provenance are retained. The current weakness is competing boxed suggestions and side-by-side sections with uneven heights. Use a calm operational form, drawing only restrained borders and progressive disclosure from the Notion reference in tasteful-ui. Avoid decorative dashboards and oversized cards.

Arrange one reading path: (1) purpose, transaction nature and expense category; (2) branch and period; (3) supplier and actual payee. Within each section use two columns on desktop and full-width purpose. Keep 13–14px readable controls, 11–12px secondary text, 36–40px input targets, light dividers, and compact coloured headings. Main fields should be visible within approximately one desktop viewport at 1280x900; at 1280x720 scrolling should remain modest.

Empty fields show an inline suggestion with an explicit use button. Hide explanations and provenance behind a disclosure; alternate suggestions for populated fields remain collapsed. Never auto-adopt suggestions or save. Default month, manual clearing, stale revisions, locks, pair membership, and required-field rules remain unchanged. Preserve fact values when changing transaction nature. Required hidden fields must open automatically.

Keep OCR products last and collapsed. Keep main save controls fixed. Make the optional review note a disclosure. Real warnings stay visible, and errors retain drafts and focus the affected field. Keyboard order follows the form; text remains literal, labelled, and wrappable. Narrow screens retain existing compatible flow; mobile redesign is outside this desktop request.

Verify actual browser layouts at desktop widths, open/closed suggestions, purpose/category adoption, manual edits, nonexpense category exclusion, optional note, OCR-last, and no overlap/overflow. Run existing UI logic tests on verified SSD snapshots. Production deployment is outside this change.
