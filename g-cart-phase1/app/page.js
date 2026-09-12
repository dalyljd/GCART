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

    const interval = setInterval(loadTrips, 5000);
    return () => clearInterval(interval);
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

  const TEN_MINUTES_MS = 10 * 60 * 1000;

  function effectiveStatus(trip) {
    if (trip.status === 'cancelled') return 'cancelled';
    const departureMs = new Date(trip.departure_time).getTime();
    if (Date.now() >= departureMs) return 'departed';
    return trip.status; // 'boarding' or 'full'
  }

  function shouldShowOnBoard(trip) {
    if (trip.status === 'cancelled') return false;
    const departureMs = new Date(trip.departure_time).getTime();
    return Date.now() < departureMs + TEN_MINUTES_MS;
  }

  if (session === undefined) {
    return (
      <div className="page">
        <p className="section-label">Loading</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="page">
        <div className="masthead">
          <div>
            <h1>G-CART</h1>
            <p>Gonzaga Crew Athlete Routing &amp; Transit</p>
          </div>
        </div>
        <button onClick={signIn}>Sign in with Google</button>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="page">
        <p className="section-label">Loading your profile</p>
      </div>
    );
  }

  if (!profile.is_approved) {
    return (
      <div className="page">
        <div className="masthead">
          <div>
            <h1>G-CART</h1>
            <p>Gonzaga Crew Athlete Routing &amp; Transit</p>
          </div>
        </div>
        <p>
          You're signed in as {profile.email}, but your account hasn't been approved yet.
          Let your team admin know so they can approve you.
        </p>
        <button className="secondary" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  const visibleTrips = trips.filter(shouldShowOnBoard);

  return (
    <div className="page">
      <div className="masthead">
        <div>
          <h1>G-CART</h1>
          <p>Gonzaga Crew Athlete Routing &amp; Transit</p>
        </div>
        <div className="who">
          <div>
            {profile.full_name || profile.email}
            {profile.is_admin ? ' · admin' : ''}
          </div>
          <button className="secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      <p className="section-label">Departures</p>

      <div className="board">
        {visibleTrips.length === 0 && <div className="empty-state">No trips posted yet.</div>}

        {visibleTrips.map((t) => {
          const status = effectiveStatus(t);
          const confirmed = t.reservations.filter((r) => !r.is_waitlisted);
          const waitlisted = [...t.reservations]
            .filter((r) => r.is_waitlisted)
            .sort((a, b) => a.waitlist_position - b.waitlist_position);

          const holdFulfilled =
            t.held_seat_email && confirmed.some((r) => r.passenger?.email === t.held_seat_email);
          const holdActive = t.held_seat_email && !holdFulfilled;

          const seatsUsed = confirmed.length + (holdActive ? 1 : 0);
          const seatsOpen = Math.max(t.seats_total - seatsUsed, 0);

          const myReservation = t.reservations.find((r) => r.passenger_id === session.user.id);
          const isDriver = t.driver_id === session.user.id;

          const fromName =
            t.departure_location?.name === 'Other'
              ? t.departure_location_custom
              : t.departure_location?.name;
          const toName =
            t.destination_location?.name === 'Other'
              ? t.destination_location_custom
              : t.destination_location?.name;

          return (
            <div className={`row${status === 'departed' ? ' departed' : ''}`} key={t.id}>
              <div className="time">
                {new Date(t.departure_time).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              <div className="route">
                {fromName}
                {t.departure_spot_number ? ` (Spot ${t.departure_spot_number})` : ''}
                <span className="arrow">→</span>
                {toName}
              </div>
              <div className={`flap ${status}`}>{status}</div>

              <div className="meta-line">
                <span>
                  Driver: <strong>{t.driver?.full_name || t.driver?.email}</strong>
                </span>
                <span>
                  Seats: <strong>{seatsOpen}</strong> / {t.seats_total}
                </span>
                {t.notes && <span>Notes: {t.notes}</span>}
              </div>

              <div className="meta-line">
                <span>
                  Passengers:{' '}
                  {confirmed.length === 0
                    ? 'none yet'
                    : confirmed.map((r) => r.passenger?.full_name || r.passenger?.email).join(', ')}
                  {holdActive && ` (+1 held for ${t.held_seat_email})`}
                </span>
              </div>

              {waitlisted.length > 0 && (
                <div className="meta-line">
                  <span>
                    Waitlist:{' '}
                    {waitlisted
                      .map(
                        (r) => `${r.passenger?.full_name || r.passenger?.email} (#${r.waitlist_position})`
                      )
                      .join(', ')}
                  </span>
                </div>
              )}

              {!isDriver && !myReservation && status !== 'departed' && status !== 'cancelled' && (
                <div className="action-line">
                  <button onClick={() => reserveSeat(t.id)}>
                    {seatsOpen > 0 ? 'Reserve a seat' : 'Join waitlist'}
                  </button>
                </div>
              )}

              {!isDriver && myReservation && (
                <div className="action-line">
                  <span>
                    {myReservation.is_waitlisted
                      ? `You're #${myReservation.waitlist_position} on the waitlist`
                      : 'You have a seat'}
                  </span>
                  <button className="secondary" onClick={() => cancelSeat(t.id)}>
                    Cancel my spot
                  </button>
                </div>
              )}

              {isDriver && (
                <div className="hold-editor">
                  <label>Hold one seat for (email):</label>
                  <input
                    value={holdEdits[t.id] ?? t.held_seat_email ?? ''}
                    onChange={(e) => setHoldEdits((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  />
                  <button
                    className="secondary"
                    onClick={() => updateHeldSeat(t.id, holdEdits[t.id] ?? t.held_seat_email ?? '')}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="form-panel">
        <p className="section-label">Post a trip</p>
        <form onSubmit={createTrip}>
          <div className="form-grid">
            <div className="field">
              <label>Departure time</label>
              <input
                type="datetime-local"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Seats available</label>
              <input
                type="number"
                min="1"
                value={seatsTotal}
                onChange={(e) => setSeatsTotal(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label>Departure location</label>
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
            <div className="field">
              <label>Destination</label>
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

            {selectedDepartureLocation?.needs_spot_number && (
              <div className="field">
                <label>Spot #</label>
                <input value={spotNumber} onChange={(e) => setSpotNumber(e.target.value)} />
              </div>
            )}
            {selectedDepartureLocation?.name === 'Other' && (
              <div className="field">
                <label>Departure location (describe)</label>
                <input
                  value={customDepartureText}
                  onChange={(e) => setCustomDepartureText(e.target.value)}
                  required
                />
              </div>
            )}
            {selectedDestinationLocation?.name === 'Other' && (
              <div className="field">
                <label>Destination (describe)</label>
                <input
                  value={customDestinationText}
                  onChange={(e) => setCustomDestinationText(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="field">
              <label>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="field">
              <label>Hold one seat for (email, optional)</label>
              <input value={holdEmail} onChange={(e) => setHoldEmail(e.target.value)} />
            </div>
          </div>
          <button type="submit">Post trip</button>
        </form>
      </div>
    </div>
  );
}
