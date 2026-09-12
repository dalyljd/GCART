-- ============================================================
-- G-CART database migration — Phase 2
-- Paste this into Supabase: SQL Editor > New Query > Run
-- (Run this AFTER schema.sql from Phase 1 — it adds to what's already there.)
-- ============================================================

-- Drop the unused held_for_email column from reservations —
-- holds now live on the trip itself (held_seat_email below), since a
-- hold is something the driver sets on the trip, not a reservation row.
alter table reservations drop column if exists held_for_email;

-- A driver can set aside exactly one seat for a specific person by email.
-- Null means no seat is being held.
alter table trips add column if not exists held_seat_email text;

-- ------------------------------------------------------------
-- FUNCTION: reserve_seat
-- Called by a passenger to claim a seat (or join the waitlist if full).
-- Runs as one atomic transaction so two people can't grab the same
-- last seat at the same time.
-- ------------------------------------------------------------
create or replace function reserve_seat(p_trip_id uuid)
returns void as $$
declare
  v_trip trips%rowtype;
  v_user_email text;
  v_confirmed_count int;
  v_hold_unfulfilled boolean;
  v_effective_used int;
  v_will_be_waitlisted boolean;
  v_next_waitlist_pos int;
begin
  -- Lock the trip row so concurrent reservations queue up safely
  select * into v_trip from trips where id = p_trip_id for update;

  if v_trip.id is null then
    raise exception 'Trip not found';
  end if;

  if v_trip.status in ('cancelled', 'departed') then
    raise exception 'This trip is no longer accepting passengers';
  end if;

  if v_trip.driver_id = auth.uid() then
    raise exception 'Drivers cannot reserve a seat in their own car';
  end if;

  if exists (select 1 from reservations where trip_id = p_trip_id and passenger_id = auth.uid()) then
    raise exception 'You already have a seat or waitlist spot on this trip';
  end if;

  select email into v_user_email from profiles where id = auth.uid();

  select count(*) into v_confirmed_count
    from reservations
    where trip_id = p_trip_id and is_waitlisted = false;

  v_hold_unfulfilled := v_trip.held_seat_email is not null
    and not exists (
      select 1 from reservations r
      join profiles p on p.id = r.passenger_id
      where r.trip_id = p_trip_id and r.is_waitlisted = false and p.email = v_trip.held_seat_email
    )
    and v_trip.held_seat_email <> coalesce(v_user_email, '');

  v_effective_used := v_confirmed_count + (case when v_hold_unfulfilled then 1 else 0 end);
  v_will_be_waitlisted := v_effective_used >= v_trip.seats_total;

  if v_will_be_waitlisted then
    select coalesce(max(waitlist_position), 0) + 1 into v_next_waitlist_pos
      from reservations where trip_id = p_trip_id and is_waitlisted = true;

    insert into reservations (trip_id, passenger_id, is_waitlisted, waitlist_position)
      values (p_trip_id, auth.uid(), true, v_next_waitlist_pos);
  else
    insert into reservations (trip_id, passenger_id, is_waitlisted, waitlist_position)
      values (p_trip_id, auth.uid(), false, null);

    -- Re-check if the car is now full and update status
    if v_effective_used + 1 >= v_trip.seats_total then
      update trips set status = 'full' where id = p_trip_id and status = 'boarding';
    end if;
  end if;

  -- Same-day auto-release: if this person was being held a seat elsewhere
  -- on the same day, that hold is no longer needed — clear it.
  update trips
    set held_seat_email = null
    where held_seat_email = v_user_email
      and id <> p_trip_id
      and departure_time::date = v_trip.departure_time::date;
end;
$$ language plpgsql security definer;

-- ------------------------------------------------------------
-- FUNCTION: cancel_seat
-- Called by a passenger to give up their seat or waitlist spot.
-- If they held a confirmed seat, the first waitlisted person (if any)
-- is automatically promoted into it.
-- ------------------------------------------------------------
create or replace function cancel_seat(p_trip_id uuid)
returns void as $$
declare
  v_trip trips%rowtype;
  v_reservation reservations%rowtype;
  v_promoted reservations%rowtype;
begin
  select * into v_trip from trips where id = p_trip_id for update;

  select * into v_reservation from reservations
    where trip_id = p_trip_id and passenger_id = auth.uid();

  if v_reservation.id is null then
    raise exception 'You do not have a reservation on this trip';
  end if;

  delete from reservations where id = v_reservation.id;

  if v_reservation.is_waitlisted then
    -- Close the gap in waitlist ordering
    update reservations
      set waitlist_position = waitlist_position - 1
      where trip_id = p_trip_id
        and is_waitlisted = true
        and waitlist_position > v_reservation.waitlist_position;
  else
    -- A confirmed seat opened up — promote the first waitlisted person, if any
    select * into v_promoted from reservations
      where trip_id = p_trip_id and is_waitlisted = true
      order by waitlist_position asc
      limit 1;

    if v_promoted.id is not null then
      update reservations
        set is_waitlisted = false, waitlist_position = null
        where id = v_promoted.id;

      update reservations
        set waitlist_position = waitlist_position - 1
        where trip_id = p_trip_id
          and is_waitlisted = true
          and waitlist_position > v_promoted.waitlist_position;
    else
      -- No one to promote — the car has an open seat again
      update trips set status = 'boarding' where id = p_trip_id and status = 'full';
    end if;
  end if;
end;
$$ language plpgsql security definer;

-- ------------------------------------------------------------
-- FUNCTION: set_held_seat
-- Called by a trip's driver to hold (or clear) one seat for a specific
-- person's email. Only the driver of that trip may call this.
-- ------------------------------------------------------------
create or replace function set_held_seat(p_trip_id uuid, p_email text)
returns void as $$
declare
  v_trip trips%rowtype;
begin
  select * into v_trip from trips where id = p_trip_id;

  if v_trip.id is null then
    raise exception 'Trip not found';
  end if;

  if v_trip.driver_id <> auth.uid() then
    raise exception 'Only the driver can set a held seat for this trip';
  end if;

  update trips
    set held_seat_email = nullif(trim(p_email), '')
    where id = p_trip_id;
end;
$$ language plpgsql security definer;
