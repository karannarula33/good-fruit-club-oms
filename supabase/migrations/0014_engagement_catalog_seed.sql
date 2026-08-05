-- Catalog prep for the engagement engine's historical order import
-- (CLAUDE_engagement_engine_FINAL.md §12.2 prerequisite 1). Adds the
-- fruits from the historical price sheet that have no existing catalog
-- product, plus aliases for sheet spellings of fruits that already exist,
-- so the historical import (and the live parser, going forward) resolves
-- them cleanly. No price_items here -- same as 0003_seed_catalog_and_
-- initial_prices.sql, a product with no price_item simply resolves
-- "unpriced" until the admin publishes it through the normal Prices flow.

-- The one pre-existing product this touches: was created earlier via an
-- ad-hoc price paste and picked up the pasted quantity/note text into its
-- name by mistake. Confirmed unreferenced by any order_lines/price_items/
-- aliases, so renaming in place is safe (no orphaned references).
update public.products
  set name = 'Turkish Cherry'
  where name = 'Turkish Cherry: 2 Boxes (Updated)';

insert into public.products (name, unit_type, unit_label) values
  ('Premium Litchi',   'weight', 'kg'),
  ('Madhu Kharbuja',   'weight', 'kg'),
  ('Dragon Fruit',     'count',  'Piece'),
  ('Red Dragon Fruit', 'count',  'Piece'),
  ('Normal Blueberry', 'count',  'Box'),
  ('Shimla Cherry',    'count',  'Box'),
  ('Dinga Mango',      'weight', 'kg'),
  ('Sun Melon',        'weight', 'kg'),
  ('Watermelon',       'weight', 'kg'),
  ('Muscat Grapes',    'count',  'Box'),
  ('Green Kiwi',       'count',  'Box'),
  ('Golden Kiwi',      'count',  'Box'),
  -- Naming history per user: 'Indian Plum' -> renamed to 'Plum' -> split
  -- into 'Kashmir Plum' (already an existing product, Kashmiri Plums) and
  -- 'Shimla Plum' once the two varieties were differentiated. Both old
  -- sheet labels alias to this new product below.
  ('Shimla Plum',      'weight', 'kg')
on conflict (name) do nothing;

insert into public.product_aliases (product_id, alias)
select products.id, a.alias from (values
  ('Apple (New Zealand)', 'New Zealand Apple'),
  ('Malta',               'Malta Orange'),
  ('Pears',                'Pear'),
  ('Avocado',              'Hass Avocado'),
  ('Jamun',                'Jamun (400gm box)'),
  ('Jumbo Blueberry',      'Jumbo Blueberry (125gm)'),
  ('Langra Mango',         'Banarsi Langda'),
  ('Afghan Apricot',       'Afghan Khurmani (Apricot)'),
  ('Kashmiri Plums',       'Kashmir Plum'),
  ('Dasheri Mango',        'Dasheri 1'),
  ('Dasheri Mango',        'Dasheri 2'),
  ('Shimla Plum',          'Indian Plum'),
  ('Shimla Plum',          'Plum'),
  ('Banana',               'Bananas')
) as a(product_name, alias)
join public.products on products.name = a.product_name
on conflict (alias) do nothing;
