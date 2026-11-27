// Catch-all product groups ("ซัพอื่น…") hold items from several real suppliers. In the
// receiving queue these groups are split into one shop per real supplier (products.supplier_master_id),
// so staff scan one bill per shop that actually delivered (owner 2026-11-27: "ไก่บ้าน คือของ เบทาโก").
// Items without a supplier master stay under the group's own name. Ordering is unchanged.
//
//   12 ซัพอื่นๆ (ครัวสันกำแพง) · 15 ซัพอื่น(ครัวคันคลอง) · 16 ซัพอื่น(ผลิตคันคลอง)
//   17 ซัพอื่น(ผลิตสันกำแพง)  · 18 ซัพอื่นๆกาแฟ
//
// Deliberately a code constant (reviewed change), like config/legacy-receiving.js.
export const RECEIVING_SPLIT_BY_SUPPLIER_GROUP_IDS = new Set([12, 15, 16, 17, 18]);
