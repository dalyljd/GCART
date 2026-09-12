import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { buildEmail } from '../../../lib/emailTemplates';

const resend = new Resend(process.env.RESEND_API_KEY);

// Service-role client: bypasses RLS, needed because this runs with no
// signed-in user (it's triggered by an external scheduler, not a person).
// This key is extremely sensitive — it must NEVER be prefixed NEXT_PUBLIC_
// and must never be sent to the browser.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REMINDER_MINUTES_BEFORE = 30;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.REMINDER_CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_MINUTES_BEFORE * 60 * 1000);

  const { data: trips, error } = await supabaseAdmin
    .from('trips')
    .select(
      `id, departure_time, reminder_sent, status,
       driver:profiles!trips_driver_id_fkey ( email ),
       destination_location:locations!trips_destination_location_id_fkey ( name ),
       destination_location_custom,
       reservations ( is_waitlisted, passenger:profiles!reservations_passenger_id_fkey ( email ) )`
    )
    .eq('reminder_sent', false)
    .not('status', 'in', '("cancelled","departed")')
    .gt('departure_time', now.toISOString())
    .lte('departure_time', windowEnd.toISOString());

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  let sentCount = 0;

  for (const trip of trips) {
    const destination =
      trip.destination_location?.name === 'Other'
        ? trip.destination_location_custom
        : trip.destination_location?.name;

    const recipients = [
      trip.driver?.email,
      ...trip.reservations.filter((r) => !r.is_waitlisted).map((r) => r.passenger?.email),
    ].filter(Boolean);

    const { subject, html } = buildEmail('departure_reminder', {
      departureTime: trip.departure_time,
      destination,
      minutesBefore: REMINDER_MINUTES_BEFORE,
    });

    await Promise.all(
      [...new Set(recipients)].map((to) =>
        resend.emails.send({ from: process.env.NOTIFY_FROM_EMAIL, to, subject, html })
      )
    );

    await supabaseAdmin.from('trips').update({ reminder_sent: true }).eq('id', trip.id);
    sentCount++;
  }

  return Response.json({ tripsNotified: sentCount });
}
