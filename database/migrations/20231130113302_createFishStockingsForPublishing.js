exports.up = function (knex) {
  return knex.schema
    .raw('CREATE SCHEMA IF NOT EXISTS publishing')
    .withSchema('publishing')
    .createViewOrReplace('fishStockings', function (view) {
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
            s.location,
            fb.fishes,
            CASE
              WHEN NOW() < date_trunc('day', s.event_time + '00:00:00') THEN 'UPCOMING'
              ELSE 'ONGOING'
            END AS "status"
          FROM
            fish_stockings s
            LEFT JOIN fb ON fb.fish_stocking_id = s.id
          WHERE
            NOT EXISTS (
              SELECT
                1
              FROM
                fish_batches fb
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
};

exports.down = function (knex) {
  return knex.schema
    .withSchema('publishing')
    .dropViewIfExists('fishStockings')
    .raw('DROP SCHEMA IF EXISTS publishing');
};
