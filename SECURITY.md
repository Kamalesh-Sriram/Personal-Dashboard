# Security

## The model in one paragraph

The site is a set of static files, identical for every visitor. Your data lives in your own browser. If you turn on sync, it also lives in one row of your own Supabase database, which only a request signed in as you can read or write. The hosting provider never holds your data.

## What protects you

| Layer | What it does |
|---|---|
| Content-Security-Policy | Scripts run only from your own site. No inline scripts, no third-party scripts. The page may only contact your site and a Supabase project. Set in `netlify.toml`. |
| No inline event handlers | All interaction goes through one delegated listener, which is what allows the strict policy above. |
| Output escaping | Every piece of text you type is escaped before it is put on the page. Colours are checked against a strict pattern before they reach a style. |
| Row level security | Each database row belongs to one signed-in user. The rules are enforced by the database (`supabase/schema.sql`), not by the app. |
| Server-only secrets | The secret database key and the private push key exist only as Netlify environment variables. They are never in the repository and never sent to a browser. |
| Checked push registration | Only a signed-in user can register a device, the endpoint must belong to a real push service, and a notification is only sent to the devices of the person who queued it. |
| Other headers | HSTS, no framing, no MIME sniffing, no referrer, a locked-down permissions policy, and no indexing by search engines. |
| No dependencies | There are no packages to install, so there is no supply chain to compromise. |

## What it does not protect against

- Someone with access to your unlocked device and browser profile. Without sync there is no login, so the browser is the lock.
- A weak or reused sync password.
- Losing your only copy. Without sync, clearing the browser's site data deletes the dashboard. Export a backup under Settings > Data.
- The sync session is kept in the browser's local storage, as is usual for web apps. The strict script policy is what keeps other code from reading it.

## Keys

| Value | Public? | Where it belongs |
|---|---|---|
| Supabase project URL | Yes | Netlify variable `SUPABASE_URL` |
| Supabase publishable (anon) key | Yes | Netlify variable `SUPABASE_ANON_KEY` |
| VAPID public key | Yes | Netlify variable `VAPID_PUBLIC_KEY` |
| Supabase secret (service_role) key | **No** | Netlify variable `SUPABASE_SERVICE_ROLE_KEY` only |
| VAPID private key | **No** | Netlify variable `VAPID_PRIVATE_KEY` only |

If a private value leaks: replace it (a new secret key in Supabase, or rerun `node tools/generate-vapid.mjs`), update the Netlify variable, and redeploy. After replacing the push keys, tap the bell again on each device.

## Reporting a problem

Open an issue on the repository, or contact the maintainer privately if it is sensitive. Please do not include real keys or personal data in a report.
