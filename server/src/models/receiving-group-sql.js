// Fixed SQL shared by legacy receiving and the blind queue. Aliases: oi, p, b, d, wbm.
export const RECEIVING_GROUP_SQL = `COALESCE(
      oi.source_product_group_id,
      (
        SELECT pg_explicit.id
        FROM product_group_links pgl_explicit
        JOIN product_groups pg_explicit ON pg_explicit.id = pgl_explicit.product_group_id
        JOIN product_group_withdraw_sources pgws ON pgws.product_group_id = pg_explicit.id
        WHERE pgl_explicit.product_id = p.id
          AND pg_explicit.is_active = true
          AND pgws.source_department_id = wbm.source_department_id
        ORDER BY pgl_explicit.is_primary DESC, pg_explicit.id
        LIMIT 1
      ),
      (
        SELECT pg_scope.id
        FROM product_group_links pgl_scope
        JOIN product_groups pg_scope ON pg_scope.id = pgl_scope.product_group_id
        JOIN product_group_scopes pgs_scope ON pgs_scope.product_group_id = pg_scope.id
        WHERE pgl_scope.product_id = p.id
          AND pg_scope.is_active = true
          AND pgs_scope.branch_id = b.id
          AND pgs_scope.department_id = d.id
        ORDER BY pgl_scope.is_primary DESC, pg_scope.id
        LIMIT 1
      ),
      (
        SELECT pg_map.id
        FROM product_group_links pgl_map
        JOIN product_groups pg_map ON pg_map.id = pgl_map.product_group_id
        WHERE pgl_map.product_id = p.id
          AND pg_map.is_internal = true
          AND pg_map.linked_department_id = wbm.source_department_id
        ORDER BY pg_map.id
        LIMIT 1
      ),
      p.product_group_id
    )`;
