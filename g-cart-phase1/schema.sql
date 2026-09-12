-- ============================================================
-- G-CART database schema — Phase 1
-- Paste this whole file into Supabase: SQL Editor > New Query > Run
-- ============================================================

-- 1. PROFILES
-- One row per person who has ever signed in with Google.
-- is_approved starts false — YOU (the admin) flip it to true
-- in the Table Editor once you recognize the teammate's name/email.
-- is_admin is just for you — set your own row's is_admin to true after your first login.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  is_approved boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs in for the first time
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. LOCATIONS
-- Shared dropdown list for both departure points and destinations.
-- needs_spot_number = true means the trip form should show a "Spot #" field
-- when this location is chosen as the departure point.
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  needs_spot_number boolean not null default false,
  created_at timestamptz not null default now()
);

insert into locations (name, needs_spot_number) values
  ('Boathouse', false),
  ('North Parking Lot', true),
  ('South Parking Lot', true)
on conflict (name) do nothing;

-- 3. TRIPS
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles(id) on delete cascade,
  departure_time timestamptz not null,
  departure_location_id uuid not null references locations(id),
  departure_spot_number text,
  destination_location_id uuid not null references locations(id),
  seats_total int not null check (seats_total > 0),
  notes text,
  status text not null default 'boarding'
    check (status in ('boarding', 'full', 'departed', 'cancelled')),
  created_at timestamptz not null default now()
);

-- 4. RESERVATIONS
-- One row per passenger seat claimed on a trip.
-- held_for_email is set by a driver reserving a seat for one specific
-- person before that person has claimed it themselves (Phase 2 feature —
-- table exists now so we don't need a migration later).
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  passenger_id uuid references profiles(id) on delete cascade,
  held_for_email text,
  is_waitlisted boolean not null default false,
  waitlist_position int,
  created_at timestamptz not null default now(),
  unique (trip_id, passenger_id)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table locations enable row level security;
alter table trips enable row level security;
alter table reservations enable row level security;

-- Profiles: anyone signed in can see everyone's name (needed to show
-- driver names and passenger lists); you can only edit your own row.
create policy "profiles are viewable by any signed-in user"
  on profiles for select
  using (auth.role() = 'authenticated');

create policy "users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- Locations: any approved user can view; only admins can manage the list.
create policy "approved users can view locations"
  on locations for select
  using (
    exists (select 1 from profiles where id = auth.uid() and is_approved = true)
  );

create policy "admins can manage locations"
  on locations for all
  using (
    exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );

-- Trips: any approved user can view all trips and create their own;
-- only the driver (or an admin) can edit/cancel a trip.
create policy "approved users can view trips"
  on trips for select
  using (
    exists (select 1 from profiles where id = auth.uid() and is_approved = true)
  );

create policy "approved users can create their own trips"
  on trips for insert
  with check (
    driver_id = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and is_approved = true)
  );

create policy "drivers and admins can update trips"
  on trips for update
  using (
    driver_id = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );

create policy "drivers and admins can delete trips"
  on trips for delete
  using (
    driver_id = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );

-- Reservations: any approved user can view (so passengers can see who's
-- in a car); a person can only reserve/cancel their own seat.
create policy "approved users can view reservations"
  on reservations for select
  using (
    exists (select 1 from profiles where id = auth.uid() and is_approved = true)
  );

create policy "users can reserve their own seat"
  on reservations for insert
  with check (passenger_id = auth.uid());

create policy "users can cancel their own seat"
  on reservations for delete
  using (passenger_id = auth.uid());
