-- =============================================================================
-- seed.sql  -  Development seed data
-- =============================================================================
-- Run this after applying all migrations to populate the dev database with
-- representative data.
--
-- NOTE: auth.users rows cannot be created directly via SQL in Supabase
-- (they must be created through the Auth API or the dashboard).  Profile rows
-- are created automatically by the on_auth_user_created trigger.
--
-- PROMOTING A SUPER-ADMIN
-- -----------------------
-- After signing up in your local/staging app, find your user's UUID in the
-- Supabase dashboard (Authentication → Users) or via:
--
--   select id, email from auth.users limit 20;
--
-- Then run:
--
--   update public.profiles
--   set role = 'super_admin', tenant_id = null
--   where id = '<your-uid>';
--
-- Because the guard_profile_escalation trigger allows super_admin to change
-- roles freely, this first promotion must be executed by a Postgres superuser
-- (service-role key or direct psql access).  Subsequent role changes can be
-- made via the app once you are super_admin.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Sample tenants
-- ---------------------------------------------------------------------------
insert into public.tenants (slug, name, status)
values
  ('demo-bistro',  'Demo Bistro',  'active'),
  ('pasta-house',  'Pasta House',  'active')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Assigning staff to tenants
-- ---------------------------------------------------------------------------
-- After creating users via the Auth API / Supabase dashboard you can assign
-- them to a tenant like this (run as service-role / superuser):
--
--   -- Make a user a restaurant_owner of demo-bistro
--   update public.profiles
--   set role = 'restaurant_owner',
--       tenant_id = (select id from public.tenants where slug = 'demo-bistro')
--   where id = '<owner-uid>';
--
--   -- Make a user a staff member of pasta-house
--   update public.profiles
--   set role = 'restaurant_staff',
--       tenant_id = (select id from public.tenants where slug = 'pasta-house')
--   where id = '<staff-uid>';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Menu seed - dev data for demo-bistro and pasta-house
-- ---------------------------------------------------------------------------
-- Uses WHERE NOT EXISTS guards so re-running the seed is idempotent.
-- Categories and dishes are inserted only when no row with that name already
-- exists for the target tenant.
-- ---------------------------------------------------------------------------

-- ---- demo-bistro: category "Starters" ----------------------------------------
insert into public.menu_categories (tenant_id, name, description, sort_order, is_active)
select
  t.id,
  'Starters',
  'Small plates and appetisers to begin your meal.',
  10,
  true
from public.tenants t
where t.slug = 'demo-bistro'
  and not exists (
    select 1 from public.menu_categories mc
    where mc.tenant_id = t.id and mc.name = 'Starters'
  );

-- ---- demo-bistro: category "Mains" -------------------------------------------
insert into public.menu_categories (tenant_id, name, description, sort_order, is_active)
select
  t.id,
  'Mains',
  'Hearty main courses for every appetite.',
  20,
  true
from public.tenants t
where t.slug = 'demo-bistro'
  and not exists (
    select 1 from public.menu_categories mc
    where mc.tenant_id = t.id and mc.name = 'Mains'
  );

-- ---- demo-bistro dishes under "Starters" -------------------------------------
insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Soup of the Day',
  'Ask your server for today''s freshest soup, served with crusty bread.',
  695,
  array['gluten','dairy']::text[],
  true,
  10
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'demo-bistro' and cat.name = 'Starters'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Soup of the Day'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Bruschetta al Pomodoro',
  'Toasted sourdough topped with heirloom tomatoes, basil, and extra-virgin olive oil.',
  850,
  array['gluten']::text[],
  true,
  20
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'demo-bistro' and cat.name = 'Starters'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Bruschetta al Pomodoro'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Smoked Salmon Blini',
  'Scottish smoked salmon on buckwheat blinis with crème fraîche and capers.',
  1195,
  array['gluten','dairy','fish','eggs']::text[],
  true,
  30
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'demo-bistro' and cat.name = 'Starters'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Smoked Salmon Blini'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Burrata & Prosciutto',
  'Creamy burrata with San Daniele prosciutto, rocket, and aged balsamic.',
  1350,
  array['dairy']::text[],
  true,
  40
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'demo-bistro' and cat.name = 'Starters'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Burrata & Prosciutto'
  );

-- ---- demo-bistro dishes under "Mains" ----------------------------------------
insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Grilled Sea Bass',
  'Line-caught sea bass, grilled with lemon butter, capers, and seasonal vegetables.',
  2400,
  array['fish','dairy']::text[],
  true,
  10
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'demo-bistro' and cat.name = 'Mains'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Grilled Sea Bass'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  '8oz Bavette Steak',
  'Dry-aged bavette steak, hand-cut chips, watercress, and béarnaise sauce.',
  2895,
  array['dairy','eggs','mustard']::text[],
  true,
  20
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'demo-bistro' and cat.name = 'Mains'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = '8oz Bavette Steak'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Wild Mushroom Risotto',
  'Arborio rice with porcini, shiitake, and chestnut mushrooms, finished with parmesan.',
  1895,
  array['dairy']::text[],
  true,
  30
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'demo-bistro' and cat.name = 'Mains'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Wild Mushroom Risotto'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Roast Chicken Supreme',
  'Free-range chicken supreme, truffle mash, wilted spinach, and jus gras.',
  2150,
  array['dairy','gluten']::text[],
  true,
  40
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'demo-bistro' and cat.name = 'Mains'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Roast Chicken Supreme'
  );

-- ============================================================================
-- pasta-house
-- ============================================================================

-- ---- pasta-house: category "Antipasti" ---------------------------------------
insert into public.menu_categories (tenant_id, name, description, sort_order, is_active)
select
  t.id,
  'Antipasti',
  'Traditional Italian starters.',
  10,
  true
from public.tenants t
where t.slug = 'pasta-house'
  and not exists (
    select 1 from public.menu_categories mc
    where mc.tenant_id = t.id and mc.name = 'Antipasti'
  );

-- ---- pasta-house: category "Paste" ------------------------------------------
insert into public.menu_categories (tenant_id, name, description, sort_order, is_active)
select
  t.id,
  'Paste',
  'Fresh and dried pasta dishes made in-house daily.',
  20,
  true
from public.tenants t
where t.slug = 'pasta-house'
  and not exists (
    select 1 from public.menu_categories mc
    where mc.tenant_id = t.id and mc.name = 'Paste'
  );

-- ---- pasta-house dishes under "Antipasti" ------------------------------------
insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Carpaccio di Manzo',
  'Thinly sliced raw beef fillet with rocket, parmesan shavings, and truffle oil.',
  1250,
  array['dairy','mustard']::text[],
  true,
  10
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'pasta-house' and cat.name = 'Antipasti'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Carpaccio di Manzo'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Frittura di Calamari',
  'Lightly battered squid rings, fried golden and served with aioli.',
  1100,
  array['gluten','eggs','shellfish']::text[],
  true,
  20
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'pasta-house' and cat.name = 'Antipasti'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Frittura di Calamari'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Focaccia della Casa',
  'Rosemary and sea-salt focaccia baked fresh daily, with extra-virgin olive oil.',
  695,
  array['gluten']::text[],
  true,
  30
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'pasta-house' and cat.name = 'Antipasti'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Focaccia della Casa'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Mozzarella di Bufala',
  'Campania DOP buffalo mozzarella, heritage tomatoes, fresh basil, and Sicilian olive oil.',
  1050,
  array['dairy']::text[],
  true,
  40
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'pasta-house' and cat.name = 'Antipasti'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Mozzarella di Bufala'
  );

-- ---- pasta-house dishes under "Paste" ----------------------------------------
insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Spaghetti alla Carbonara',
  'Spaghetti with guanciale, Pecorino Romano, egg yolk, and black pepper - no cream.',
  1650,
  array['gluten','eggs','dairy']::text[],
  true,
  10
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'pasta-house' and cat.name = 'Paste'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Spaghetti alla Carbonara'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Pappardelle al Ragù',
  'Hand-rolled pappardelle with slow-braised beef and pork ragù, topped with grana padano.',
  1850,
  array['gluten','dairy','eggs']::text[],
  true,
  20
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'pasta-house' and cat.name = 'Paste'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Pappardelle al Ragù'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Rigatoni all''Amatriciana',
  'Rigatoni with tomato sauce, guanciale, chilli flakes, and aged Pecorino.',
  1595,
  array['gluten','dairy']::text[],
  true,
  30
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'pasta-house' and cat.name = 'Paste'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Rigatoni all''Amatriciana'
  );

insert into public.dishes (tenant_id, category_id, name, description, price_cents, allergens, is_available, sort_order)
select
  cat.tenant_id,
  cat.id,
  'Gnocchi al Pesto',
  'Pillowy potato gnocchi tossed in Ligurian basil pesto with green beans and potato.',
  1550,
  array['gluten','dairy','tree_nuts']::text[],
  true,
  40
from public.menu_categories cat
join public.tenants t on t.id = cat.tenant_id
where t.slug = 'pasta-house' and cat.name = 'Paste'
  and not exists (
    select 1 from public.dishes d
    where d.category_id = cat.id and d.name = 'Gnocchi al Pesto'
  );
