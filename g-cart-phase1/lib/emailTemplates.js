function formatTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Each builder returns { subject, html } for one notification type.
// `data` shapes are documented per event in app/api/notify/route.js.
export function buildEmail(type, data) {
  switch (type) {
    case 'seat_joined':
      return {
        subject: `${data.passengerName} joined your G-CART trip`,
        html: `<p>${data.passengerName} reserved a seat on your trip departing ${formatTime(
          data.departureTime
        )} to ${data.destination}.</p>`,
      };

    case 'car_full':
      return {
        subject: `Your G-CART trip is full`,
        html: `<p>Your trip departing ${formatTime(
          data.departureTime
        )} to ${data.destination} is now full. New passengers will join a waitlist.</p>`,
      };

    case 'waitlist_promoted':
      return {
        subject: `You're off the waitlist — you have a seat!`,
        html: `<p>A seat opened up and you've been automatically given it. Your trip departs ${formatTime(
          data.departureTime
        )} to ${data.destination}.</p>`,
      };

    case 'trip_cancelled':
      return {
        subject: `A G-CART trip you were on was cancelled`,
        html: `<p>${data.driverName} cancelled the trip departing ${formatTime(
          data.departureTime
        )} to ${data.destination}. Please find another ride.</p>`,
      };

    case 'departure_reminder':
      return {
        subject: `Reminder: your G-CART trip departs soon`,
        html: `<p>Your trip to ${data.destination} departs at ${formatTime(
          data.departureTime
        )} — ${data.minutesBefore} minutes from now.</p>`,
      };

    default:
      throw new Error(`Unknown notification type: ${type}`);
  }
}
