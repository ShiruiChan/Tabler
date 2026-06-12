# Supabase

This directory mirrors the structure expected by the Supabase CLI.

## migrations/

SQL migration files go here. Name them with a timestamp prefix:

    <timestamp>_<description>.sql

Example:
    20240101000000_create_tenants.sql

Migrations are applied via:
    supabase db push        # against linked project
    supabase db reset       # local Docker (resets and replays all)

## Linking a project

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

## Local development

```bash
supabase start   # starts local Postgres + Auth + Storage via Docker
supabase stop    # stops containers
```

Copy `.env.example` → `.env.local` and fill in the values printed by `supabase start`.
