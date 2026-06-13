# Tabler - White-Label Restaurant SaaS - Master Plan

Orchestrator: FABLE · Executor: Sonnet · Verifier: Opus
Legend: [ ] pending · [→] in progress · [✓] done · [✗] blocked

## Phase 0 - Foundation
- [✓] TASK-001: Next.js 14 scaffold (App Router, TS, Tailwind, Supabase clients, env template)
- [✓] TASK-002: Core multi-tenant schema - `tenants`, `profiles`, roles + RLS
- [✓] TASK-003: Tenant resolution middleware (subdomain + custom domain → tenant context)
- [✓] TASK-004: Auth flows (Supabase Auth, role-based routing: super-admin / restaurant / visitor)

## Phase 1 - Super-Admin (tenant management)
- [✓] TASK-005: Schema - `modules`, `tenant_modules` (flags + pricing overrides) + RLS + column grants
- [✓] TASK-006: Super-admin API - tenants CRUD, feature flag toggles, pricing overrides
- [✓] TASK-007: Super-admin UI - tenant list, usage stats, flags & pricing panels

## Phase 2 - Site Design (B2B white-label)
- [✓] TASK-008: Schema - `site_settings` (logo, colors, fonts, hero, domain) + storage buckets
- [✓] TASK-009: Theming engine - per-tenant CSS variables, server-side theme load
- [✓] TASK-010: B2B design settings UI (logo upload, palette, font picker, domain binding)

## Phase 3 - Menu
- [✓] TASK-011: Schema - `menu_categories`, `dishes`, allergens + RLS (merged with TASK-012)
- [✓] TASK-012: Menu API (CRUD, photo upload to storage) - merged into TASK-011 pass
- [✓] TASK-013: B2B menu management UI (merged with TASK-014)
- [✓] TASK-014: B2C public menu page (themed, per-tenant) - merged into TASK-013 pass

## Phase 4 - Floor Plan
- [✓] TASK-015: Schema - `floor_plans`, `floor_tables` (zone polygons/coords, capacity) + RLS
- [✓] TASK-016: B2B floor plan editor (photo upload + clickable zone overlay)
- [✓] TASK-017: B2C seat/table picker component

## Phase 5 - Reservations
- [✓] TASK-018: Schema - `reservations` + availability rules + RLS
- [✓] TASK-019: Reservation API (availability check, create/cancel, table lock)
- [✓] TASK-020: B2C booking flow (date, time, party size, seat from floor plan)
- [✓] TASK-021: B2B reservations dashboard (calendar/list, status management)

## Phase 6 - Events
- [✓] TASK-022: Schema - `events`, `event_tickets` (capacity, price) + RLS
- [✓] TASK-023: Events API (CRUD, ticket purchase with capacity enforcement)
- [✓] TASK-024: B2B events UI (create/edit, sales overview)
- [✓] TASK-025: B2C events listing + ticket checkout

## Phase 7 - Delivery & Ordering
- [✓] TASK-026: Schema - `delivery_zones`, `delivery_settings` + RLS
- [✓] TASK-027: Schema - `orders`, `order_items` (in-session, delivery, banquet pre-order) + RLS
- [✓] TASK-028: B2B delivery config UI (zones, min order, fee, schedule)
- [✓] TASK-029: B2C ordering flow (cart, in-session order, delivery checkout)

## Phase 8 - Payments & Billing
- [→] TASK-030: Stripe integration (checkout sessions, webhook handler, payment records; MUST include cron/periodic invocation of expireStaleReservedTickets - lazy-only sweep gap from TASK-023)
- [ ] TASK-031: Banquet pre-order with deposit flow
- [ ] TASK-032: Platform billing - per-module subscription charges to tenants

## Verification log
| Task | Executor pass | Verifier verdict | Notes |
|------|---------------|------------------|-------|
| TASK-001 | 1 | APPROVE | Nit: placeholder env fallbacks mask misconfig (documented); add runtime assertion in TASK-003 |
| TASK-002 | 2 | REJECT → APPROVE | Pass 1: suspended owner could un-suspend own tenant (RLS gap). Fixed via guard_tenant_status BEFORE UPDATE trigger. Note: service-role status flips without super_admin JWT will be rejected by the trigger - by design |
| TASK-003 | 2 | REJECT → APPROVE | Pass 1: x-tenant-slug set on response not request (blocker); session refresh ran after rewrite (major). Fixed: canonical @supabase/ssr ordering + request-header injection. Open nit: 404 responses drop refreshed cookies (fold into TASK-004) |
| TASK-004 | 1 | APPROVE | Clean pass. 404-cookie nit from TASK-003 fixed. Minor: page-level requireRole can't preserve `next` (middleware covers the common path) |
| TASK-005 | 1 | APPROVE | Clean pass. Pricing column-privacy via column grants + rpc by design (plain selects of price_override_cents denied even to super_admin - reads go through get_tenant_module_pricing) |
| TASK-006 | 1 | APPROVE | Clean pass. Upsert payloads verified non-clobbering (enabled vs price_override_cents isolated); 23505 constraint-name mapping accurate |
| TASK-007 | 1 | APPROVE | Clean pass; 9 files (2 justified client-form splits). Cosmetic nits: defaultValue inputs don't resync after router.refresh |
| TASK-008 | 1 | APPROVE | Clean pass. Storage policies correctly bucket-scoped outside the OR; auto-create trigger + backfill verified |
| TASK-009 | 1 | APPROVE | Minor security notes: hero_image_url → CSS url() and social hrefs lack https-scheme validation (owner-scoped risk). Required fix folded into TASK-010 |
| TASK-010 | 1 | APPROVE | TASK-009 findings closed (https-only social, storage-prefix-locked asset URLs). Minor: saveAssetUrl ownership check uses raw-string includes vs parsed pathname (defense-in-depth suggestion) |
| TASK-011/012 | 1 | APPROVE | Clean pass. Nits: public dish SELECT doesn't require active category (JS layer filters); is_available coercion fragility |
| TASK-013/014 | 1 | APPROVE | Clean pass. Checkbox hidden-field pattern verified correct in all four states; subdomain illusion preserved (relative hrefs) |
| TASK-015 | 2 | REJECT → APPROVE | Pass 1: zone bounds not validated vs plan width/height (blocker); 23505 on plan_label_unique not mapped (major). Fixed: canvas-bounds check gates both insert/update; friendly duplicate-label message. Tracked nit: floor_plans.tenant_id mutable without child re-validation (pre-existing pattern, also in 0004 menu_categories) |
| TASK-016 | 1 | APPROVE | Clean pass; build + lint + tsc green. FormData↔zod field agreement verified; coord math correct under scaling; client can't spoof tenant. Minors: TableForm doesn't auto-close on clean first success (null→null state); no onPointerCancel (touch); uploader helper text over-promises MIME check |
| TASK-017 | 2 | REJECT → APPROVE | Pass 1: invisible keyboard focus on focusable SVG shapes (blocker, WCAG 2.4.7); accent label text unreadable over photos (major). Fixed: sibling focus-ring shape (dashed accent + white glow) for rect/circle; paintOrder=stroke text halo in all states. Selection contract (controlled/uncontrolled, onSelect(null)) verified intact. Phase 4 complete |
| TASK-018 | 1 | APPROVE | Clean pass. Exclusion constraint semantics verified ('[)' bounds → back-to-back OK; cancel frees slot; re-checked on UPDATE); trigger order favorable; RLS complete, no PII leak. Major (folded into TASK-019): guard_visitor_reservation_update treats service role (NULL auth) as visitor - blocks service-role non-cancel updates; fix = service_role exemption in guard |
| TASK-019 | 2 | REJECT → APPROVE | Pass 1: availability overlap query ran under RLS - anon sees 0 reservations, availability over-reported, slot re-check defeated (blocker). Fixed: overlap query via admin client (PII-free columns only); inactive-plan tables excluded (!inner join); guest_email .email() zod; nullif GUC guard. TASK-018 major closed (service_role exemption). Accepted: cancelMyReservation 0-row silent success; no module gate in createReservation (billing toggle, not security boundary). UTC-only availability times - per-tenant timezone deferred |
| TASK-020 | 2 | REJECT → APPROVE | Pass 1: success detection via useFormState null→null never fired on first clean submit - confirmation panel unreachable on happy path (blocker; recurrence of TASK-016 pattern). Fixed: dropped useFormState, direct awaited action call in startTransition + success snapshot (confirmedSlot/Table). FormData contract, relative hrefs, module gating, UTC labels all verified. Nits: isValidDate accepts roll-over dates (2026-02-30); slot deselect keeps table selected (intentional) |
| TASK-021 | 1 | APPROVE | Clean pass; tsc/lint/build green. Zod↔DB CHECK parity verified; Monday-of-week math correct incl. Sunday; day range half-open in SQL. Minors: searchParams typed as Promise (Next 15 convention on Next 14 - harmless, inconsistent with siblings); week grouping startsWith assumes UTC timestamptz format; shared isPending blanks sibling buttons. Phase 5 complete |
| TASK-022 | 1 | APPROVE | Clean pass. Capacity trigger concurrency-correct (FOR UPDATE before sum, id<>new.id, status-transition paths sound under READ COMMITTED); guard immutability list complete incl. payment_ref; RLS gates published+active, no PII anon path. Tracked risk → TASK-023: visitor can INSERT 'reserved' ticket with arbitrary unit_price_cents (RLS can't read price) - zero-price capacity squatting; TASK-023 must re-verify price server-side + consider expiry of unpaid holds |
| TASK-023 | 1 | APPROVE | Clean pass; tsc/lint/build green. TASK-022 carry-over CLOSED: price snapshotted server-side (no client price field), unpaid holds expire at 30min (payment_ref IS NULL), residual direct-insert squat accepted (no payment_ref → never paid revenue, swept in window). Availability sums via admin client PII-free (TASK-019 pattern); P0001 capacity raise mapped; DB trigger authoritative over advisory JS check; free-event reserved→paid flip capacity no-op, service-role bypasses guard. Major→TASK-030: expiry sweep lazy-only, needs cron for traffic-starved events |
| TASK-024 | 1 | APPROVE | Clean pass; tsc/lint/build green. Success-detection (direct action call in startTransition, no useFormState), FormData↔zod parity, datetime UTC round-trip, checkbox 4-state hidden-field, tenant-scoped uploader & PII placement all verified against approved patterns; module-gating omission confirmed correct vs siblings. 2 cosmetic minors (stale comment in ticket-status-actions; price input named price_cents holds major units pre-conversion) |
| TASK-025 | 1 | APPROVE | Clean pass; tsc/lint/build green. Success-detection, FormData↔zod parity, module gating ("events" key, mirrors reserve), UTC labels, theming, relative hrefs all verified; no server-only leak into client bundle (HOLD_MINUTES copy hardcoded, type-only imports). Minor fixed post-verdict by orchestrator: getMyTickets filtered by tenant.id (own-data white-label bleed). Minors noted: confirmation panel reads live props for title/price (only qty snapshotted); phone input lacks minLength=5. Phase 6 complete |
| TASK-026 | 1 | APPROVE | Clean pass; tsc/lint clean. delivery_zones + delivery_settings RLS correct & secure (no cross-tenant leak; tenant_id rebind blocked by WITH CHECK - improvement over tracked 0004/0005 nit); polygon trigger matches 0005 post-TASK-015 rigor; module 'delivery' pre-seeded in 0002 confirmed. Minors: doc comments claim "mirrors 0003/0006 exactly" while using standalone PK (justified deviation); "table-level GRANTs" wording inaccurate (0006/0007 have no grants - outcome correct). 23505 map key: delivery_zones_tenant_id_name_key |
| TASK-027 | 1 | APPROVE | Clean pass; tsc/lint clean. Adversarial checklist 9/9 blocked (cross-order item injection, money-column UPDATE, cross-tenant FK re-pointing on UPDATE, suspended-tenant insert - TASK-002 class gap closed, PII paths, confirmed-order self-cancel, default-deny DELETE); guard_visitor_order_update immutability list complete (16 cols); total=subtotal+fee DB-enforced, deposit excluded by design; Currency type refactor semantics-preserving. Minors: customer_email lacks DB '@' check (deferred to zod - divergence from 0007 noted); out_for_delivery type-coherence at API layer. API-layer obligations → TASK-029: price re-verification vs live dishes, fee resolution, status graph, table/reservation presence per type |
| TASK-028 | 1 | APPROVE | Clean pass; tsc/lint/build green. Checkbox 4-state, schedule day-key 0=Sunday (DISPLAY_ORDER visual-only, no off-by-one), all 6 polygon P0001 substrings verbatim-matched, 23505 constraint-name mapping, upsert cross-tenant safe (tenant_id from profile only), money NaN-safe. Minors: upsert INSERT branch dead (no staff INSERT RLS policy - harmless, page short-circuits missing row); raw zod msg on adversarial sort_order |
| TASK-029 | 1 | APPROVE | Clean pass; tsc/lint/build green. All 6 TASK-027 obligations verified: prices server-side only (no client money fields anywhere), fee resolution w/ overrides+free-over+min-order, pending→cancelled only, type↔field presence (is_bookable real), admin-client for both guest+auth inserts (compensation-safe - avoids session-DELETE RLS trap), currency from delivery_settings. Module 'ordering' exists+seeded; adversarial: dup dish_ids double-count harmlessly, cross-tenant/unavailable dishes rejected. Major (doc-only, fixed post-verdict by orchestrator): false delivery-module-gate comment corrected; midnight-window fails-closed limitation documented. Phase 7 complete |
