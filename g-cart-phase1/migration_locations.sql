-- ============================================================
-- G-CART database migration — Locations update
-- Paste into Supabase: SQL Editor > New Query > Run
-- (Run this after schema.sql and migration_phase2.sql)
-- ============================================================

-- Remove the placeholder lots from Phase 1, but only if no trip
-- already references them (keeps this safe to re-run).
delete from locations
  where name in ('North Parking Lot', 'South Parking Lot')
    and not exists (
      select 1 from trips
      where trips.departure_location_id = locations.id
         or trips.destination_location_id = locations.id
    );

-- The real default list
insert into locations (name, needs_spot_number) values
  ('Gonzaga Parking', true),
  ('Gonzaga Circle', false),
  ('Boathouse', false),
  ('Other', false)
on conflict (name) do nothing;

-- "Other" needs a free-text field to capture what the person actually typed,
-- since it isn't a real fixed location. One column for departure, one for destination.
alter table trips add column if not exists departure_location_custom text;
alter table trips add column if not exists destination_location_custom text;
