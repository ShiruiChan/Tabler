-- =============================================================================
-- 0003_site_settings.sql
-- Per-tenant site design settings and Supabase Storage bucket policies
--
-- Storage path convention:
--   {tenant_id}/{filename}   e.g. a1b2c3d4-.../logo.png
--
-- Bucket:  tenant-assets  (public=true so images are world-readable via CDN)
-- Policies restrict WRITE operations to the owning restaurant_owner only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. site_settings table (1:1 with public.tenants via PK = FK)
-- ---------------------------------------------------------------------------
create table public.site_settings (
  -- 1:1 with tenants; cascades on tenant delete
  tenant_id         uuid         primary key
                      references public.tenants(id) on delete cascade,

  -- Asset URLs (written by the owner; null until set)
  logo_url          text,
  hero_image_url    text,

  -- Brand colours - CSS hex notation, enforced by constraint
  primary_color     text         not null default '#1a1a1a'
                      constraint site_settings_primary_color_hex
                      check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color   text         not null default '#f5f5f5'
                      constraint site_settings_secondary_color_hex
                      check (secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  accent_color      text         not null default '#e11d48'
                      constraint site_settings_accent_color_hex
                      check (accent_color ~ '^#[0-9a-fA-F]{6}$'),

  -- Typography - restricted to supported web-font families
  font_heading      text         not null default 'Inter'
                      constraint site_settings_font_heading_allowlist
                      check (font_heading in (
                        'Inter', 'Lora', 'Playfair Display',
                        'Roboto', 'Open Sans', 'Montserrat', 'Merriweather'
                      )),
  font_body         text         not null default 'Inter'
                      constraint site_settings_font_body_allowlist
                      check (font_body in (
                        'Inter', 'Lora', 'Playfair Display',
                        'Roboto', 'Open Sans', 'Montserrat', 'Merriweather'
                      )),

  -- Free-text fields with length caps
  tagline           text
                      constraint site_settings_tagline_length
                      check (char_length(tagline) <= 200),
  about             text
                      constraint site_settings_about_length
                      check (char_length(about) <= 2000),

  -- Social links stored as a JSON object: { "instagram": "...", ... }
  social            jsonb        not null default '{}'::jsonb
                      constraint site_settings_social_object
                      check (jsonb_typeof(social) = 'object'),

  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

create trigger site_settings_set_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Trigger: auto-create a default site_settings row when a tenant is added
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_tenant_site_settings()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.site_settings (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

create trigger on_tenant_created_site_settings
  after insert on public.tenants
  for each row execute function public.handle_new_tenant_site_settings();

-- ---------------------------------------------------------------------------
-- 3. Backfill: ensure every existing tenant already has a site_settings row
-- ---------------------------------------------------------------------------
insert into public.site_settings (tenant_id)
  select id from public.tenants
on conflict (tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Enable Row Level Security
-- ---------------------------------------------------------------------------
alter table public.site_settings enable row level security;

-- ---------------------------------------------------------------------------
-- 5. RLS policies - site_settings
--
-- Policy summary:
--   anon + authenticated  | SELECT | active-tenant rows only (public branding)
--   owner / staff         | SELECT | own tenant, regardless of status
--   restaurant_owner only | UPDATE | own row (staff may not write settings)
--   super_admin           | ALL    | unrestricted
--   (no INSERT/DELETE for non-super-admin - rows managed by trigger/cascade)
-- ---------------------------------------------------------------------------

-- Public read: anyone can see settings for active tenants (needed for public
-- restaurant microsites - CSS variables, logo URL, etc.).
create policy "site_settings: public read active tenant"
  on public.site_settings
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.tenants
      where id = site_settings.tenant_id
        and status = 'active'
    )
  );

-- Owner/staff read: can read their own row regardless of tenant status.
create policy "site_settings: tenant role read own"
  on public.site_settings
  for select
  to authenticated
  using (public.has_tenant_role(tenant_id));

-- Owner-only update: restaurant_owner may update their own row.
-- restaurant_staff cannot (mirrors the 0001 pattern for tenants owner update).
create policy "site_settings: owner update own"
  on public.site_settings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'restaurant_owner'
        and tenant_id = site_settings.tenant_id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'restaurant_owner'
        and tenant_id = site_settings.tenant_id
    )
  );

-- super_admin has unrestricted access to all rows and all operations.
create policy "site_settings: super_admin all"
  on public.site_settings
  for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 6. Storage - tenant-assets bucket
--
-- Bucket is public so the Supabase CDN serves images without auth tokens.
-- All WRITE operations are still gated by storage RLS policies below.
--
-- Path convention: {tenant_id}/{filename}
--   e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890/logo.png
--        a1b2c3d4-e5f6-7890-abcd-ef1234567890/hero.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('tenant-assets', 'tenant-assets', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Storage RLS policies - storage.objects
-- ---------------------------------------------------------------------------

-- Public read: anyone may read objects in the tenant-assets bucket
-- (bucket is already public, but an explicit policy is best practice).
create policy "tenant-assets: public read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'tenant-assets');

-- Owner INSERT: restaurant_owner may upload objects into their own folder.
-- Path[1] must equal their tenant_id (cast to text).
create policy "tenant-assets: owner insert own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'tenant-assets'
    and (
      public.is_super_admin()
      or (
        (storage.foldername(name))[1] = (select public.user_tenant_id()::text)
        and exists (
          select 1
          from public.profiles
          where id = auth.uid()
            and role = 'restaurant_owner'
        )
      )
    )
  );

-- Owner UPDATE: restaurant_owner may replace objects in their own folder.
create policy "tenant-assets: owner update own folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'tenant-assets'
    and (
      public.is_super_admin()
      or (
        (storage.foldername(name))[1] = (select public.user_tenant_id()::text)
        and exists (
          select 1
          from public.profiles
          where id = auth.uid()
            and role = 'restaurant_owner'
        )
      )
    )
  )
  with check (
    bucket_id = 'tenant-assets'
    and (
      public.is_super_admin()
      or (
        (storage.foldername(name))[1] = (select public.user_tenant_id()::text)
        and exists (
          select 1
          from public.profiles
          where id = auth.uid()
            and role = 'restaurant_owner'
        )
      )
    )
  );

-- Owner DELETE: restaurant_owner may delete objects in their own folder.
create policy "tenant-assets: owner delete own folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'tenant-assets'
    and (
      public.is_super_admin()
      or (
        (storage.foldername(name))[1] = (select public.user_tenant_id()::text)
        and exists (
          select 1
          from public.profiles
          where id = auth.uid()
            and role = 'restaurant_owner'
        )
      )
    )
  );
