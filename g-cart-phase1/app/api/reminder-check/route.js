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

// Sends one email and never throws — logs the failure and returns false
// instead, so one flaky send doesn't take down the whole scheduled run.
async function sendEmailSafe(to, subject, html) {
  try {
    const { error } = await resend.emails.send({
      from: process.env.NOTIFY_FROM_EMAIL,
      to,
      subject,
      html,
    });
    if (error) {
      console.error('resend send error', to, error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('resend send threw', to, err);
    return false;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.REMINDER_CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const sent30 = await processReminderTier(now, 30, 'reminder_sent');
    const sent10 = await processReminderTier(now, 10, 'reminder_10_sent');
    const bumpCount = await processNeededQueueBumps(now);
    return Response.json({
      tripsNotified30Min: sent30,
      tripsNotified10Min: sent10,
      neededQueueBumps: bumpCount,
    });
  } catch (err) {
    console.error('reminder-check crashed', err);
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}

// Handles one reminder tier (e.g. "30 minutes before" or "10 minutes
// before"). Each trip is CLAIMED — atomically flipping its flag from
// false to true — before any email is sent. If the claim doesn't
// succeed (already claimed by a previous or concurrent run), we skip
// it entirely. This guarantees a reminder can never be sent twice,
// even if the run is retried or overlaps with another run.
async function processReminderTier(now, minutesBefore, flagColumn) {
  const windowEnd = new Date(now.getTime() + minutesBefore * 60 * 1000);

  const { data: candidates, error } = await supabaseAdmin
    .from('trips')
    .select('id')
    .eq(flagColumn, false)
    .not('status', 'in', '("cancelled","departed")')
    .gt('departure_time', now.toISOString())
    .lte('departure_time', windowEnd.toISOString());

  if (error) {
    console.error('processReminderTier query error', flagColumn, error);
    return 0;
  }

  let sentCount = 0;

  for (const candidate of candidates) {
    try {
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('trips')
        .update({ [flagColumn]: true })
        .eq('id', candidate.id)
        .eq(flagColumn, false)
        .select(
          `id, departure_time,
           driver:profiles!trips_driver_id_fkey ( email ),
           destination_location:locations!trips_destination_location_id_fkey ( name ),
           destination_location_custom,
           reservations ( is_waitlisted, passenger:profiles!reservations_passenger_id_fkey ( email ) )`
        )
        .maybeSingle();

      // No row came back = someone else already claimed this trip for
      // this tier (or it briefly failed) — either way, don't send.
      if (claimError || !claimed) continue;

      const destination =
        claimed.destination_location?.name === 'Other'
          ? claimed.destination_location_custom
          : claimed.destination_location?.name;

      const recipients = [
        claimed.driver?.email,
        ...claimed.reservations.filter((r) => !r.is_waitlisted).map((r) => r.passenger?.email),
      ].filter(Boolean);

      const { subject, html } = buildEmail('departure_reminder', {
        departureTime: claimed.departure_time,
        destination,
        minutesBefore,
      });

      for (const to of new Set(recipients)) {
        await sendEmailSafe(to, subject, html);
      }

      sentCount++;
    } catch (err) {
      console.error('processReminderTier trip failed', candidate.id, err);
    }
  }

  return sentCount;
}

const BUMP_WINDOW_MINUTES = 5;

// For every car departing within the next 5 minutes that hasn't been
// checked yet, see if today's needed-queue has someone still waiting.
// If so, seat them — using an open seat if one exists, otherwise bumping
// the most-recently-joined non-priority confirmed passenger to make room.
async function processNeededQueueBumps(now) {
  const windowEnd = new Date(now.getTime() + BUMP_WINDOW_MINUTES * 60 * 1000);

  const { data: candidates, error } = await supabaseAdmin
    .from('trips')
    .select('id')
    .eq('needed_bump_processed', false)
    .not('status', 'in', '("cancelled","departed")')
    .gt('departure_time', now.toISOString())
    .lte('departure_time', windowEnd.toISOString());

  if (error || !candidates) {
    if (error) console.error('processNeededQueueBumps query error', error);
    return 0;
  }

  let bumped = 0;

  for (const candidate of candidates) {
    try {
      // Claim this trip for bump processing first — if the claim doesn't
      // land (already claimed by another run), skip it entirely.
      const { data: trip, error: claimError } = await supabaseAdmin
        .from('trips')
        .update({ needed_bump_processed: true })
        .eq('id', candidate.id)
        .eq('needed_bump_processed', false)
        .select(
          `id, departure_time, seats_total, held_seat_email,
           destination_location:locations!trips_destination_location_id_fkey ( name ),
           destination_location_custom,
           reservations ( id, is_waitlisted, is_priority, created_at, passenger_id,
             passenger:profiles!reservations_passenger_id_fkey ( email ) )`
        )
        .maybeSingle();

      if (claimError || !trip) continue;

      const queueDate = trip.departure_time.slice(0, 10); // YYYY-MM-DD

      const { data: queueRows } = await supabaseAdmin
        .from('needed_queue')
        .select('id, rower_id, profiles:profiles!needed_queue_rower_id_fkey ( email, full_name )')
        .eq('queue_date', queueDate)
        .order('created_at', { ascending: true })
        .limit(1);

      const nextInLine = queueRows?.[0];

      if (!nextInLine) {
        continue; // already claimed above — nothing further to do
      }

      const confirmed = trip.reservations.filter((r) => !r.is_waitlisted);
      const holdActive =
        trip.held_seat_email &&
        !confirmed.some((r) => r.passenger?.email === trip.held_seat_email);
      const hasOpenSeat = confirmed.length + (holdActive ? 1 : 0) < trip.seats_total;

      const destination =
        trip.destination_location?.name === 'Other'
          ? trip.destination_location_custom
          : trip.destination_location?.name;

      if (!hasOpenSeat) {
        // Need to bump someone: the most-recently-joined confirmed
        // passenger who is NOT the driver's flagged priority passenger.
        const bumpCandidates = confirmed
          .filter((r) => !r.is_priority)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (bumpCandidates.length === 0) {
          // Everyone confirmed is protected (e.g. a single-seat car whose
          // only passenger is the priority pick) — nothing we can do for
          // this trip. Leave the queue entry for another car to resolve.
          continue;
        }

        const bumpedReservation = bumpCandidates[0];
        await supabaseAdmin.from('reservations').delete().eq('id', bumpedReservation.id);

        if (bumpedReservation.passenger?.email) {
          const { subject, html } = buildEmail('bumped_for_needed', {
            departureTime: trip.departure_time,
            destination,
          });
          await sendEmailSafe(bumpedReservation.passenger.email, subject, html);
        }
      }

      await supabaseAdmin.from('reservations').insert({
        trip_id: trip.id,
        passenger_id: nextInLine.rower_id,
        is_waitlisted: false,
      });
      await supabaseAdmin.from('needed_queue').delete().eq('id', nextInLine.id);

      if (nextInLine.profiles?.email) {
        const { subject, html } = buildEmail('needed_queue_seated', {
          departureTime: trip.departure_time,
          destination,
        });
        await sendEmailSafe(nextInLine.profiles.email, subject, html);
      }

      bumped++;
    } catch (err) {
      console.error('processNeededQueueBumps trip failed', candidate.id, err);
    }
  }

  return bumped;
}
