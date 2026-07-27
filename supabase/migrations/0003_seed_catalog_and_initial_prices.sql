-- Seed catalog = union of CLAUDE.md §6's starter list and the real
-- customer-facing price list the admin pasted. Products with no price_item
-- below simply resolve to "unpriced" until the first real publish covers
-- them -- expected and safe per the §3.2 guard.

insert into public.products (name, unit_type, unit_label) values
  ('Alphonso Mango',   'weight', 'kg'),
  ('Kesar Mango',      'weight', 'kg'),
  ('Dasheri Mango',    'weight', 'kg'),
  ('Langra Mango',     'weight', 'kg'),
  ('Chausa Mango',     'weight', 'kg'),
  ('Safeda Mango',     'weight', 'kg'),
  ('Banana',           'count',  'dozen'),
  ('Papaya',           'weight', 'kg'),
  ('Kiwi',             'count',  'piece'),
  ('Afghan Cherry',    'count',  'Box'),
  ('Jumbo Blueberry',  'count',  'Box'),
  ('Red Globe Grapes', 'weight', 'kg'),
  ('Jamun',            'count',  'Box'),
  ('Afghan Apricot',   'count',  'Box'),
  ('Mariposa Plum',    'weight', 'kg'),
  ('Kashmiri Plums',   'weight', 'kg'),
  ('Apple (New Zealand)', 'weight', 'kg'),
  ('Pears',            'weight', 'kg'),
  ('Pomegranate',      'weight', 'kg'),
  ('Mandarin Orange',  'weight', 'kg'),
  ('Malta',            'weight', 'kg'),
  ('Avocado',          'count',  'Piece');

insert into public.product_aliases (product_id, alias)
select products.id, a.alias from (values
  ('Alphonso Mango', 'Hapus'),
  ('Langra Mango',   'Banarsi Langda Mango'),
  ('Langra Mango',   'Langda'),
  ('Afghan Apricot', 'Khurmani'),
  ('Apple (New Zealand)', 'Apple'),
  ('Pomegranate',    'Anaar')
) as a(product_name, alias)
join public.products on products.name = a.product_name;

-- Baseline seed version: an arbitrary-but-past effective_from. Any real
-- publish after this supersedes it per §3.2 resolution. published_by is
-- null (no human published this).
with seed_version as (
  insert into public.price_versions (effective_from, published_by, note)
  values ('2025-01-01T00:30:00+00', null, 'Seed: initial real price list (paste-publish flow baseline)')
  returning id
)
insert into public.price_items (version_id, product_id, price_per_unit)
select seed_version.id, products.id, p.price
from seed_version, (values
  ('Chausa Mango',        295.00),
  ('Langra Mango',        225.00),
  ('Afghan Cherry',       750.00),
  ('Jumbo Blueberry',     330.00),
  ('Red Globe Grapes',    520.00),
  ('Jamun',               350.00),
  ('Afghan Apricot',      680.00),
  ('Mariposa Plum',       420.00),
  ('Kashmiri Plums',      390.00),
  ('Apple (New Zealand)', 460.00),
  ('Pears',               370.00),
  ('Pomegranate',         450.00),
  ('Mandarin Orange',     300.00),
  ('Malta',               280.00),
  ('Avocado',             160.00),
  ('Papaya',              150.00)
) as p(product_name, price)
join public.products on products.name = p.product_name;
