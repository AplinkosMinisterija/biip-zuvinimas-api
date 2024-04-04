exports.up = function (knex) {
  return knex.schema.createViewOrReplace('fish_stockings_completed', function (view) {
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

exports.down = function (knex) {
  return knex.schema.dropViewIfExists('fish_stockings_completed');
};
