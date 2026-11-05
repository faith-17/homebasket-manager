# HomeBasket Stores bookkeeping

A mobile-first shared business ledger for HomeBasket Stores. The browser uses HTML, CSS, and vanilla JavaScript modules. Supabase Auth identifies family members; PostgreSQL RPC functions, constraints, audit triggers, and Row Level Security control business records. Amounts are stored as integer kobo.

## Project files

- `index.html` — accessible app screens, forms, and navigation.
- `css/styles.css` — responsive mobile-first theme.
- `js/config.js` — Supabase project URL, public browser key, locale, and currency.
- `js/supabase.js` — shared Supabase client.
- `js/app.js` — authentication, navigation, record forms, account display, live sync, and CSV downloads.
- `js/transactions.js` — transaction types, exact amount input, and database access helpers.
- `js/accounts.js` — database-derived account balances.
- `js/money.js` — exact Naira/kobo parsing and display formatting.
- `js/reports.js` — stock-adjusted estimated P&L calculations and export row shapes.
- `database/schema.sql` — PostgreSQL tables, constraints, indexes, audited server-side operations, and RLS.
- `tests/accounting.test.js` — isolated calculation and amount parsing tests; uses synthetic data only.
- `.gitignore` — excludes dependencies, local secrets, and machine-specific files.

## Values you must configure

1. Create your own Supabase project.
2. In `js/config.js`, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` using **Project URL** and the **publishable key** (or legacy `anon` key) from your Supabase project settings.
3. Keep `SUPABASE_ANON_KEY` public. Never use a `service_role`/secret key, database password, OAuth client secret, or other private credential in frontend files or GitHub.
4. Choose your local development URL and final hosting URL for Supabase Auth's allowed redirect list.
5. To use GitHub login, configure a GitHub OAuth app and enable its provider in Supabase as described below.

The app's records and sessions live in Supabase. It does not use browser local storage as the financial database. Without a configured project, the app shows a configuration notice instead of sample financial totals.

## Supabase setup

1. Create a Supabase project and keep its database password private.
2. Open **SQL Editor** in that project and run [`database/schema.sql`](./database/schema.sql) in a new project.
3. Confirm the schema executes without errors. It creates the HomeBasket Stores business, member and account tables, transaction table, audit log, constraints, indexes, RPC functions, policies, and realtime publication membership.
4. In **Authentication → URL Configuration**, set the Site URL to your production frontend origin and add development and production URLs to Redirect URLs. Example development URL: `http://127.0.0.1:5500/**`. For GitHub Pages, use the actual project page URL, such as `https://YOUR-ACCOUNT.github.io/YOUR-REPOSITORY/**`.
5. Copy the project URL and public publishable/anon key into `js/config.js`; do not commit private credentials.
6. Create the first account using email/password. If email confirmation is on, confirm the email first. The first signed-in user creates the business workspace and becomes the owner. The three financial accounts are created by the database.
7. Record an opening balance for each account and an opening stock valuation dated on the first day of your reporting period.
8. The owner creates a seven-day family invite. Each family member creates/signs into their own Supabase user account and redeems the code. Remove access in **Accounts & family** when needed.

### GitHub OAuth (optional)

GitHub repository access does not sign a user into this app. If you want GitHub OAuth:

1. In Supabase, open **Authentication → Providers → GitHub** and enable GitHub. Copy the exact Supabase callback URL shown on that settings page.
2. In GitHub, create an OAuth App. Set its authorization callback URL to the exact Supabase callback URL. Use your actual production frontend URL as the homepage.
3. Copy the GitHub OAuth client ID and client secret into the Supabase GitHub provider configuration only. Keep the client secret out of this project and GitHub.
4. In Supabase **Authentication → URL Configuration**, allow your local and deployed frontend redirect URLs.
5. Test sign-in and sign-out using the hosted URL. The app asks Supabase to return the browser to the current app URL.

## Run locally in VS Code

1. Open this folder in VS Code.
2. Configure Supabase first, or expect the app to show the setup notice.
3. Run a static HTTP server. For example, install/enable the VS Code **Live Server** extension and choose **Open with Live Server** on `index.html`. Supabase Auth redirect and clipboard features work best on `localhost` or HTTPS; do not use `file://`.
4. Visit the displayed local origin and sign in. Supabase project calls require an internet connection.

## Deploy and version with GitHub

1. This folder has a local Git repository on branch `main`, but no GitHub remote or commit has been created. Create a GitHub repository (private if you do not want the source public), then add its URL: `git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git`.
2. Use VS Code Source Control to review files, create your first commit, and push `main`. Check the commit contents before pushing: no `.env` files, passwords, database credentials, OAuth secrets, or Supabase service-role key should be present. The public Supabase publishable key is intended for browser use and depends on RLS for security.
3. GitHub Pages can host this static app: select the repository's deployment branch/folder in **Settings → Pages**, wait for the deployment, then add the exact Pages origin/path to Supabase Auth Redirect URLs.
4. Re-test sign-in, invite redemption, data loading, writes, realtime updates, and exports at the deployed URL.
5. A custom domain or another HTTPS static host can be used instead; update Supabase's Site URL and allow-list accordingly.

`.gitignore` is included, but it cannot recognize secrets pasted into arbitrary source files. Review changes and repository history before publishing.

## Transaction and account rules

| Record | Account balance effect | Profit/report treatment |
|---|---|---|
| Daily sales | Adds money to selected account | Sales |
| Stock purchase / restock | Subtracts money from selected account | Included in stock available for estimated COGS |
| Operating expense | Subtracts money from selected account | Operating expense |
| Household goods / stock loss | No cash movement; entered at estimated stock value | Separately deducted from estimated net profit |
| Owner withdrawal | Subtracts money from selected account | Separate owner movement, not an operating expense |
| Family contribution | Adds money to selected account | Separate contribution, not sales |
| Account transfer | Subtracts source and adds destination atomically | Excluded from income and expenses |
| Opening account balance | Adds or subtracts selected account | Not income or expense |
| Opening / closing stock valuation | No cash movement | Inventory snapshots used for the estimate |

Account balances are calculated by a PostgreSQL view from the transaction ledger; no separate balance is incremented by the browser. Transaction writes are atomic RPCs. A request UUID makes safe retries idempotent, and reuse with different data is rejected. Owner edits and deletes are audited in the same database transaction. Deletes are soft deletes: they disappear from normal member queries and account totals, while their idempotency key and audit history remain so a delayed retry cannot recreate their financial effect. Direct browser-role inserts, updates, and deletes on financial tables are not granted.

## Profit and loss report

For the selected date range:

- **Estimated COGS** = opening stock + stock purchases/restocks − closing stock − household goods taken − recorded stock losses.
- **Estimated gross profit** = sales − estimated COGS.
- **Estimated net profit/loss** = estimated gross profit − household goods taken − stock losses − operating expenses.
- Contributions, withdrawals, and internal transfers are displayed separately and are not business sales or operating costs.

Stock values must be entered as on the report start and end dates for the app to call a report complete. If valuations are missing, stale, or produce negative COGS, the report marks the estimate incomplete or needing review. This is a simple inventory-value estimate, not item-level costing, audited accounts, or tax advice. Confirm valuation methods with your accountant.

## Tests and verification

With Node.js installed, run:

```text
npm test
node --check js/app.js
node --check js/transactions.js
node --check js/accounts.js
node --check js/money.js
node --check js/reports.js
```

Tests use synthetic records only. They check integer-kobo parsing/formatting and report calculations; they do not connect to Supabase. Before real business use, verify in a test Supabase project that:

- two different authorized accounts see the same saved ledger on separate devices;
- an unrelated account cannot read records or balances;
- members can add records but owner-only edit, delete, audit, and access-management RPCs reject members;
- transfers preserve the combined account balance and do not enter income or expenses;
- add/edit/delete all update balances and reports once, with audit events;
- invitation expiry/revocation needs and GitHub OAuth redirects match your security expectations;
- database backups, recovery, email delivery, and hosting headers are configured.

These live permission, OAuth, synchronization, deployment, and financial acceptance tests have **not** been run from this workspace. Do not treat the app as ready for real financial data until those checks and an independent security/accounting review are complete.
