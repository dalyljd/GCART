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
        `id, departure_time, departure_spot_number, seats_total, notes, status,
         driver:profiles!trips_driver_id_fkey ( full_name, email ),
         departure_location:locations!trips_departure_location_id_fkey ( name, needs_spot_number ),
         destination_location:locations!trips_destination_location_id_fkey ( name )`
      )
      .order('departure_time', { ascending: true })
      .then(({ data, error }) => {
        if (error) setErrorMsg(error.message);
        else setTrips(data);
      });
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
      loadTrips();
    }
  }

  const selectedDepartureLocation = locations.find((l) => l.id === departureLocationId);

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
      <table border="1" cellPadding="6">
        <thead>
          <tr>
            <th>Departs</th>
            <th>From</th>
            <th>To</th>
            <th>Driver</th>
            <th>Seats</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((t) => (
            <tr key={t.id}>
              <td>{new Date(t.departure_time).toLocaleString()}</td>
              <td>
                {t.departure_location?.name}
                {t.departure_spot_number ? ` (Spot ${t.departure_spot_number})` : ''}
              </td>
              <td>{t.destination_location?.name}</td>
              <td>{t.driver?.full_name || t.driver?.email}</td>
              <td>{t.seats_total}</td>
              <td>{t.status}</td>
              <td>{t.notes}</td>
            </tr>
          ))}
          {trips.length === 0 && (
            <tr>
              <td colSpan="7">No trips posted yet.</td>
            </tr>
          )}
        </tbody>
      </table>

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
        <button type="submit">Post trip</button>
      </form>
    </div>
  );
}
