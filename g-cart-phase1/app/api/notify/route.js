import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { buildEmail } from '../../../lib/emailTemplates';

const resend = new Resend(process.env.RESEND_API_KEY);

// A lightweight Supabase client just for verifying the caller's access
// token — it does NOT use the service role key, so it can't do anything
// beyond confirming "yes, this is a real signed-in user."
const supabaseAuthCheck = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return Response.json({ error: 'Missing auth token' }, { status: 401 });
    }

    const { data: userData, error: authError } = await supabaseAuthCheck.auth.getUser(token);
    if (authError || !userData?.user) {
      return Response.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await request.json();
    const { type, recipients, data } = body;

    if (!type || !Array.isArray(recipients) || recipients.length === 0) {
      return Response.json({ error: 'Missing type or recipients' }, { status: 400 });
    }

    const { subject, html } = buildEmail(type, data);
    const uniqueRecipients = [...new Set(recipients.filter(Boolean))];

    const results = await Promise.all(
      uniqueRecipients.map((to) =>
        resend.emails.send({
          from: process.env.NOTIFY_FROM_EMAIL,
          to,
          subject,
          html,
        })
      )
    );

    return Response.json({ sent: uniqueRecipients.length, results });
  } catch (err) {
    console.error('notify error', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
