-- Gift packing as a packaging option at packing (admin, 2026-10-22),
-- alongside Big Box, Medium Box etc. (0018_order_packaging.sql). Its box cost
-- for COGS is added to packaging_cost_config once known.

alter table public.order_packages drop constraint if exists order_packages_packaging_type_check;
alter table public.order_packages add constraint order_packages_packaging_type_check
  check (packaging_type in (
    'big_box', 'medium_box', 'small_box', 'small_packet', 'big_packet', 'tiny_box', 'gift_packing'
  ));

alter table public.packaging_cost_config drop constraint if exists packaging_cost_config_packaging_type_check;
alter table public.packaging_cost_config add constraint packaging_cost_config_packaging_type_check
  check (packaging_type in (
    'big_box', 'medium_box', 'small_box', 'small_packet', 'big_packet', 'tiny_box', 'gift_packing'
  ));
