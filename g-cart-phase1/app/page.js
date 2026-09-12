'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);
  const [locations, setLocations] = useState([]);
  const [trips, setTrips] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  // Form state
  const [departureTime, setDepartureTime] = useState('');
  const [departureLocationId, setDepartureLocationId] = useState('');
  const [spotNumber, setSpotNumber] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [seatsTotal, setSeatsTotal] = useState(3);
  const [notes, setNotes] = useState('');
  const [holdEmail, setHoldEmail] = useState('');
  const [customDepartureText, setCustomDepartureText] = useState('');
  const [customDestinationText, setCustomDestinationText] = useState('');

  // Per-trip "edit held seat" input state, keyed by trip id
  const [holdEdits, setHoldEdits] = useState({});

  // Watch auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Load this user's profile once we have a session
  useEffect(() => {
    if (!session) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error) setErrorMsg(error.message);
        else setProfile(data);
      });
  }, [session]);

  // Load locations + trips once approved
  useEffect(() => {
    if (!profile?.is_approved) return;

    supabase
      .from('locations')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (error) setErrorMsg(error.message);
        else setLocations(data);
      });

    loadTrips();
  }, [profile]);

  function loadTrips() {
    supabase
      .from('trips')
      .select(
        `id, departure_time, departure_spot_number, seats_total, notes, status, held_seat_email, driver_id,
         departure_location_custom, destination_location_custom,
         driver:profiles!trips_driver_id_fkey ( full_name, email ),
         departure_location:locations!trips_departure_location_id_fkey ( name, needs_spot_number ),
         destination_location:locations!trips_destination_location_id_fkey ( name ),
         reservations ( id, is_waitlisted, waitlist_position, passenger_id,
           passenger:profiles!reservations_passenger_id_fkey ( full_name, email ) )`
      )
      .order('departure_time', { ascending: true })
      .then(({ data, error }) => {
        if (error) setErrorMsg(error.message);
        else setTrips(data);
      });
  }

  async function reserveSeat(tripId) {
    setErrorMsg('');
    const { error } = await supabase.rpc('reserve_seat', { p_trip_id: tripId });
    if (error) setErrorMsg(error.message);
    else loadTrips();
  }

  async function cancelSeat(tripId) {
    setErrorMsg('');
    const { error } = await supabase.rpc('cancel_seat', { p_trip_id: tripId });
    if (error) setErrorMsg(error.message);
    else loadTrips();
  }

  async function updateHeldSeat(tripId, email) {
    setErrorMsg('');
    const { error } = await supabase.rpc('set_held_seat', {
      p_trip_id: tripId,
      p_email: email,
    });
    if (error) setErrorMsg(error.message);
    else loadTrips();
  }

  async function signIn() {
    await supabase.auth.signInWithOAuth({ provider: 'google' });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  async function createTrip(e) {
    e.preventDefault();
    setErrorMsg('');
    const { error } = await supabase.from('trips').insert({
      driver_id: session.user.id,
      departure_time: departureTime,
      departure_location_id: departureLocationId,
      departure_spot_number: spotNumber || null,
      destination_location_id: destinationLocationId,
      seats_total: Number(seatsTotal),
      notes: notes || null,
      held_seat_email: holdEmail || null,
      departure_location_custom:
        selectedDepartureLocation?.name === 'Other' ? customDepartureText : null,
      destination_location_custom:
        selectedDestinationLocation?.name === 'Other' ? customDestinationText : null,
    });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setDepartureTime('');
      setDepartureLocationId('');
      setSpotNumber('');
      setDestinationLocationId('');
      setSeatsTotal(3);
      setNotes('');
      setHoldEmail('');
      setCustomDepartureText('');
      setCustomDestinationText('');
      loadTrips();
    }
  }

  const selectedDepartureLocation = locations.find((l) => l.id === departureLocationId);
  const selectedDestinationLocation = locations.find((l) => l.id === destinationLocationId);

  // ---- Render states ----

  if (session === undefined) {
    return <p>Loading...</p>;
  }

  if (!session) {
    return (
      <div>
        <h1>G-CART</h1>
        <p>Gonzaga Crew Athlete Routing &amp; Transit</p>
        <button onClick={signIn}>Sign in with Google</button>
      </div>
    );
  }

  if (!profile) {
    return <p>Loading your profile...</p>;
  }

  if (!profile.is_approved) {
    return (
      <div>
        <h1>G-CART</h1>
        <p>
          You're signed in as {profile.email}, but your account hasn't been approved yet.
          Let your team admin know so they can approve you.
        </p>
        <button onClick={signOut}>Sign out</button>
      </div>
    );
  }

  return (
    <div>
      <h1>G-CART</h1>
      <p>
        Signed in as {profile.full_name || profile.email}{' '}
        {profile.is_admin ? '(admin)' : ''} — <button onClick={signOut}>Sign out</button>
      </p>

      {errorMsg && <p style={{ color: 'red' }}>Error: {errorMsg}</p>}

      <h2>Departure Board (raw list — styling comes later)</h2>

      {trips.length === 0 && <p>No trips posted yet.</p>}

      {trips.map((t) => {
        const confirmed = t.reservations.filter((r) => !r.is_waitlisted);
        const waitlisted = [...t.reservations]
          .filter((r) => r.is_waitlisted)
          .sort((a, b) => a.waitlist_position - b.waitlist_position);

        const holdFulfilled =
          t.held_seat_email &&
          confirmed.some((r) => r.passenger?.email === t.held_seat_email);
        const holdActive = t.held_seat_email && !holdFulfilled;

        const seatsUsed = confirmed.length + (holdActive ? 1 : 0);
        const seatsOpen = Math.max(t.seats_total - seatsUsed, 0);

        const myReservation = t.reservations.find((r) => r.passenger_id === session.user.id);
        const isDriver = t.driver_id === session.user.id;

        return (
          <div key={t.id} style={{ border: '1px solid #999', padding: '10px', marginBottom: '12px' }}>
            <div>
              <strong>{new Date(t.departure_time).toLocaleString()}</strong> —{' '}
              {t.departure_location?.name === 'Other'
                ? t.departure_location_custom
                : t.departure_location?.name}
              {t.departure_spot_number ? ` (Spot ${t.departure_spot_number})` : ''} →{' '}
              {t.destination_location?.name === 'Other'
                ? t.destination_location_custom
                : t.destination_location?.name}
            </div>
            <div>
              Driver: {t.driver?.full_name || t.driver?.email} | Status: {t.status} | Seats
              open: {seatsOpen} / {t.seats_total}
            </div>
            {t.notes && <div>Notes: {t.notes}</div>}

            <div>
              Passengers:{' '}
              {confirmed.length === 0
                ? 'none yet'
                : confirmed.map((r) => r.passenger?.full_name || r.passenger?.email).join(', ')}
              {holdActive && ` (+1 seat held for ${t.held_seat_email})`}
            </div>

            {waitlisted.length > 0 && (
              <div>
                Waitlist:{' '}
                {waitlisted
                  .map((r) => `${r.passenger?.full_name || r.passenger?.email} (#${r.waitlist_position})`)
                  .join(', ')}
              </div>
            )}

            {/* Reserve / cancel controls for the signed-in user */}
            {!isDriver && !myReservation && t.status !== 'departed' && t.status !== 'cancelled' && (
              <button onClick={() => reserveSeat(t.id)}>
                {seatsOpen > 0 ? 'Reserve a seat' : 'Join waitlist'}
              </button>
            )}
            {!isDriver && myReservation && (
              <div>
                {myReservation.is_waitlisted
                  ? `You're #${myReservation.waitlist_position} on the waitlist. `
                  : "You have a seat. "}
                <button onClick={() => cancelSeat(t.id)}>Cancel my spot</button>
              </div>
            )}

            {/* Driver-only: manage the held seat */}
            {isDriver && (
              <div>
                <label>Hold one seat for (email): </label>
                <input
                  value={holdEdits[t.id] ?? t.held_seat_email ?? ''}
                  onChange={(e) =>
                    setHoldEdits((prev) => ({ ...prev, [t.id]: e.target.value }))
                  }
                />
                <button onClick={() => updateHeldSeat(t.id, holdEdits[t.id] ?? t.held_seat_email ?? '')}>
                  Save hold
                </button>
              </div>
            )}
          </div>
        );
      })}

      <h2>Post a trip</h2>
      <form onSubmit={createTrip}>
        <div>
          <label>Departure time: </label>
          <input
            type="datetime-local"
            value={departureTime}
            onChange={(e) => setDepartureTime(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Departure location: </label>
          <select
            value={departureLocationId}
            onChange={(e) => setDepartureLocationId(e.target.value)}
            required
          >
            <option value="">-- choose --</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        {selectedDepartureLocation?.needs_spot_number && (
          <div>
            <label>Spot #: </label>
            <input value={spotNumber} onChange={(e) => setSpotNumber(e.target.value)} />
          </div>
        )}
        {selectedDepartureLocation?.name === 'Other' && (
          <div>
            <label>Departure location (describe): </label>
            <input
              value={customDepartureText}
              onChange={(e) => setCustomDepartureText(e.target.value)}
              required
            />
          </div>
        )}
        <div>
          <label>Destination: </label>
          <select
            value={destinationLocationId}
            onChange={(e) => setDestinationLocationId(e.target.value)}
            required
          >
            <option value="">-- choose --</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        {selectedDestinationLocation?.name === 'Other' && (
          <div>
            <label>Destination (describe): </label>
            <input
              value={customDestinationText}
              onChange={(e) => setCustomDestinationText(e.target.value)}
              required
            />
          </div>
        )}
        <div>
          <label>Seats available: </label>
          <input
            type="number"
            min="1"
            value={seatsTotal}
            onChange={(e) => setSeatsTotal(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Notes: </label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div>
          <label>Hold one seat for (email, optional): </label>
          <input value={holdEmail} onChange={(e) => setHoldEmail(e.target.value)} />
        </div>
        <button type="submit">Post trip</button>
      </form>
    </div>
  );
}
