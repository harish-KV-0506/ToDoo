# ToDoo

ToDoo is a collaborative task board built with React, TypeScript, Vite, and
Supabase. Signed-in teammates can create boards, invite each other with
email-bound one-time links, assign tasks, set due dates and priorities, and see
task and membership changes arrive live through Supabase Realtime. It also
includes a professional network where members can share work, discover
professionals, and send or accept connection requests.

## Set up Supabase

1. Create a Supabase project.
2. Open the SQL Editor and run
   [`supabase/migrations/20261031000000_todoo_collaboration.sql`](./supabase/migrations/20261031000000_todoo_collaboration.sql).
   Run [`supabase/migrations/20261031080000_professional_network.sql`](./supabase/migrations/20261031080000_professional_network.sql)
   after the collaboration migration to add the professional network.
3. Run [`supabase/migrations/20261031090000_social_feed_features.sql`](./supabase/migrations/20261031090000_social_feed_features.sql)
   to add member-only profile photos and post images, comments, and “Useful” marks.
4. Sign in to the Supabase CLI, then deploy the link-preview function. Run the
   migration first so the frontend and function are used only after their
   database fields and storage bucket exist:

   ```sh
   npx supabase login
   npx supabase functions deploy link-preview --project-ref pkushkxrhrydsnsavper --use-api
   ```
5. In Authentication settings, add the development URL and production GitHub
   Pages URL to the allowed site URLs / redirect URLs. Configure email
   confirmation and production SMTP before inviting real users.
6. Copy `.env.example` to `.env.local` and add your Supabase project URL and
   **publishable** key. Never put a `service_role` key in this frontend.

```sh
npm install
npm run dev
```

Workspace and task access is protected by Postgres row-level security. Invite
links are random, stored as SHA-256 hashes, bound to the invited email address,
and expire after seven days. The browser builds the invite URL, so the invited
teammate must receive the link separately.

## Professional network

The signed-in home page is the professional feed. Members can publish work
updates with an optional single image and project link, use profile photos,
comment on posts, and mark posts “Useful” without public like counts. Link
previews are requested from the ToDoo Supabase Edge Function; only HTTPS links
are previewed, and the function rejects private/local destinations and
redirects. The function fetches metadata from the linked site itself, not a
third-party preview provider. Members can also discover professionals and send
or accept connection requests. Profiles and posts are visible to signed-in
members; uploaded images are stored in a private Supabase Storage bucket and
served to signed-in members. Feed, comment, useful-mark, and connection updates
use Supabase Realtime. Recommendations rank connected members and profiles
with matching professional interests first, then recent activity.

## GitHub Pages

The workflow in [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
publishes the project from a separate repository at
`https://<owner>.github.io/<repository>/`. Add these Actions **repository
variables** before enabling deployment:

- `SUPABASE_URL` — the project URL.
- `SUPABASE_PUBLISHABLE_KEY` — the browser-safe publishable key.

The repository name supplies Vite's Pages base path automatically.
`ymira.in/todoo` is not a direct URL for a separate GitHub Pages project: it
requires the existing `ymira.in` site to route that path to this build. A
custom domain such as `todo.ymira.in` also needs its DNS and Pages domain
settings configured.

## Build and checks

```sh
npm run build
npm run lint
```

ToDoo requires a configured Supabase project to create accounts or sync shared
tasks. It does not contain demo task data or a fake “live” mode.
