/**
 * Publishing views aggregated soft-deleted fish batches.
 *
 * Both `publishing.fishStockings` and `fishStockingsCompleted` build their batch
 * JSON in a CTE that selects from `public.fish_batches` without filtering
 * `deleted_at IS NULL`, while the surrounding WHERE clause does filter it.
 * Editing a stocking soft-deletes the old batch row and inserts a new one (see
 * `fishBatches.service.ts` — `deleteExistingBatches` + `createOrUpdateBatches`),
 * so every edit left another ghost row in the aggregate.
 *
 * Effect in production: fish stocking 4530 (Antakmenių ežeras) was published
 * with 10 identical "sterkai" entries while the database held a single batch,
 * which also broke the card layout on zuvys.biip.lt.
 *
 * Both aggregates are additionally coalesced to an empty array. A NULL was
 * already reachable for a stocking with no batch rows at all, and filtering the
 * ghosts out adds a second way in — a stocking whose batches were all deleted.
 * The consumer of `fishes` iterates it, and the consumer of `fish_batches`
 * would reduce over it if the view's EXISTS guard were ever relaxed.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.withSchema('publishing').createViewOrReplace('fishStockings', function (view) {
    view.as(
      knex.raw(`
          WITH fb AS (
            SELECT
              fb.fish_stocking_id,
              json_agg(
                json_build_object(
                  'fish_type',
                  json_build_object('id', ft.id, 'label', ft.label),
                  'fish_age',
                  json_build_object('id', fa.id, 'label', fa.label),
                  'count',
                  fb.amount,
                  'weight',
                  fb.weight
                )
              ) AS fishes
            FROM
              public.fish_batches fb
              LEFT JOIN public.fish_types ft ON ft.id = fb.fish_type_id
              LEFT JOIN public.fish_ages fa ON fa.id = fb.fish_age_id
            WHERE
              fb.deleted_at IS NULL
            GROUP BY
              fb.fish_stocking_id
          )
          SELECT
            s.id,
            s.event_time,
            s.geom,
            s.location::json,
            COALESCE(fb.fishes, '[]'::json) AS fishes,
            CASE
              WHEN NOW() < date_trunc('day', s.event_time + '00:00:00') THEN 'UPCOMING'
              ELSE 'ONGOING'
            END AS "status"
          FROM
            public.fish_stockings s
            LEFT JOIN fb ON fb.fish_stocking_id = s.id
          WHERE
            NOT EXISTS (
              SELECT
                1
              FROM
                public.fish_batches fb
              WHERE
                fb.fish_stocking_id = s.id
                AND fb.review_amount IS NOT NULL
                AND fb.deleted_at IS NULL
            )
            AND s.canceled_at IS NULL
            AND NOW() < date_trunc('day', s.event_time + '00:00:00') + INTERVAL '1 days'
`),
    );
  });

  // Separate builder: chaining `.withSchema()` twice would target the second
  // view at `publishing` as well.
  await knex.schema.createViewOrReplace('fishStockingsCompleted', function (view) {
    view.as(
      knex.raw(`
          WITH fb AS (
            SELECT
              fb.fish_stocking_id,
              json_agg(
                json_build_object(
                  'fish_type',
                  json_build_object('id', ft.id, 'label', ft.label),
                  'fish_age',
                  json_build_object('id', fa.id, 'label', fa.label),
                  'count',
                  fb.review_amount,
                  'weight',
                  fb.review_weight
                )
              ) AS fish_batches
            FROM
              public.fish_batches fb
              LEFT JOIN public.fish_types ft ON ft.id = fb.fish_type_id
              LEFT JOIN public.fish_ages fa ON fa.id = fb.fish_age_id
            WHERE
              fb.deleted_at IS NULL
            GROUP BY
              fb.fish_stocking_id
          )
          SELECT
            s.id,
            s.event_time,
            s.review_time,
            s.geom,
            s.location::json,
            COALESCE(fb.fish_batches, '[]'::json) AS fish_batches
          FROM
            public.fish_stockings s
            LEFT JOIN fb ON fb.fish_stocking_id = s.id
          WHERE
            EXISTS (
              SELECT
                1
              FROM
                public.fish_batches fb
              WHERE
                fb.fish_stocking_id = s.id
                AND fb.review_amount IS NOT NULL
                AND fb.deleted_at IS NULL
            )
            AND s.review_time IS NOT NULL
            AND s.deleted_at IS NULL
        `),
    );
  });
};

/**
 * Restores the previous definitions, ghost rows included.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.withSchema('publishing').createViewOrReplace('fishStockings', function (view) {
    view.as(
      knex.raw(`
          WITH fb AS (
            SELECT
              fb.fish_stocking_id,
              json_agg(
                json_build_object(
                  'fish_type',
                  json_build_object('id', ft.id, 'label', ft.label),
                  'fish_age',
                  json_build_object('id', fa.id, 'label', fa.label),
                  'count',
                  fb.amount,
                  'weight',
                  fb.weight
                )
              ) AS fishes
            FROM
              public.fish_batches fb
              LEFT JOIN public.fish_types ft ON ft.id = fb.fish_type_id
              LEFT JOIN public.fish_ages fa ON fa.id = fb.fish_age_id
            GROUP BY
              fb.fish_stocking_id
          )
          SELECT
            s.id,
            s.event_time,
            s.geom,
            s.location::json,
            fb.fishes,
            CASE
              WHEN NOW() < date_trunc('day', s.event_time + '00:00:00') THEN 'UPCOMING'
              ELSE 'ONGOING'
            END AS "status"
          FROM
            public.fish_stockings s
            LEFT JOIN fb ON fb.fish_stocking_id = s.id
          WHERE
            NOT EXISTS (
              SELECT
                1
              FROM
                public.fish_batches fb
              WHERE
                fb.fish_stocking_id = s.id
                AND fb.review_amount IS NOT NULL
                AND fb.deleted_at IS NULL
            )
            AND s.canceled_at IS NULL
            AND NOW() < date_trunc('day', s.event_time + '00:00:00') + INTERVAL '1 days'
`),
    );
  });

  await knex.schema.createViewOrReplace('fishStockingsCompleted', function (view) {
    view.as(
      knex.raw(`
          WITH fb AS (
            SELECT
              fb.fish_stocking_id,
              json_agg(
                json_build_object(
                  'fish_type',
                  json_build_object('id', ft.id, 'label', ft.label),
                  'fish_age',
                  json_build_object('id', fa.id, 'label', fa.label),
                  'count',
                  fb.review_amount,
                  'weight',
                  fb.review_weight
                )
              ) AS fish_batches
            FROM
              public.fish_batches fb
              LEFT JOIN public.fish_types ft ON ft.id = fb.fish_type_id
              LEFT JOIN public.fish_ages fa ON fa.id = fb.fish_age_id
            GROUP BY
              fb.fish_stocking_id
          )
          SELECT
            s.id,
            s.event_time,
            s.review_time,
            s.geom,
            s.location::json,
            fb.fish_batches
          FROM
            public.fish_stockings s
            LEFT JOIN fb ON fb.fish_stocking_id = s.id
          WHERE
            EXISTS (
              SELECT
                1
              FROM
                public.fish_batches fb
              WHERE
                fb.fish_stocking_id = s.id
                AND fb.review_amount IS NOT NULL
                AND fb.deleted_at IS NULL
            )
            AND s.review_time IS NOT NULL
            AND s.deleted_at IS NULL
        `),
    );
  });
};
