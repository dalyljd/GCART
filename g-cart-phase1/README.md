# G-CART — Phase 1 Setup

This is the bare-bones skeleton: Google sign-in (gated by admin approval) and a plain,
unstyled list of trips you can view and create. No reservations, no styling yet —
those come in later phases.

## 1. Run the database schema

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Open `schema.sql` from this project, copy all of it, paste it in, and click **Run**.
3. This creates the `profiles`, `locations`, `trips`, and `reservations` tables, plus
   the security rules that control who can see/edit what.

## 2. Get the code onto GitHub

The easiest way, since you don't have a coding tool set up:

1. Download and install **GitHub Desktop** (desktop.github.com), sign in with your GitHub account.
2. On github.com, create a new repository called `g-cart` (keep it private if you'd like — doesn't need to be public).
3. In GitHub Desktop: File → Clone Repository → choose `g-cart` → pick a folder on your computer.
4. Copy every file from this project into that cloned folder (keep the folder structure — `app/`, `lib/`, etc.).
5. Back in GitHub Desktop, you'll see all the new files listed. Write a summary like "Phase 1: auth + raw trip list" and click **Commit to main**, then **Push origin**.

## 3. Deploy to Vercel

1. Go to vercel.com → **Add New... → Project**.
2. Import the `g-cart` repository from GitHub.
3. Before clicking Deploy, expand **Environment Variables** and add:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://hhuchfykmhiqqdlbhwhe.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (your anon public key from Supabase → Settings → API)
4. Click **Deploy**. After a minute or two you'll get a live URL like `g-cart.vercel.app`.

## 4. Register that URL with Google and Supabase

Once you have your live Vercel URL:

1. Supabase → Authentication → URL Configuration → set **Site URL** to your Vercel URL.
2. Google Cloud Console → your OAuth client → add your Vercel URL under **Authorized JavaScript origins**.

## 5. Approve yourself as the first user

1. Visit your live site and click **Sign in with Google**.
2. You'll see "not approved yet" — that's expected, everyone starts unapproved.
3. In Supabase → **Table Editor** → `profiles`, find your row, and manually set
   `is_approved` to `true` and `is_admin` to `true`.
4. Refresh the site — you should now see the trip list and the "Post a trip" form.

From here on, approving a new teammate means: they sign in once, then you flip
`is_approved` to `true` for their row in that same table. (A friendlier admin
screen for this comes in Phase 5 — for now, the Table Editor works fine.)

## What to test

- Sign-in works and shows the "not approved" message on first login
- After you approve yourself, you can post a trip and see it appear in the list
- The Spot # field only appears when you pick a location with `needs_spot_number = true` (North or South Parking Lot)

Once this all works, let me know and we'll move to Phase 2: real reservation logic
(claiming seats, waitlist, held seats).
