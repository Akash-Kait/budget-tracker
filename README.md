# Personal Financial Priority Planner

Decide whether to spend money today by seeing all future claims on it — commitments,
goals, experiences, and wishes — in one place. This is **not** a budgeting or
expense-tracking app; it answers a single question: *"Given my priorities, future
obligations, and available reserves, should I buy this today?"*

## Setup

```bash
npm install
npm run db:push     # create the SQLite schema
npm run db:seed     # load demo data
npm run dev         # http://localhost:3000
```

### Troubleshooting: `prisma db push` fails to download engines

On a corporate network you may see this during `npm run db:push`:

```
Error: request to https://binaries.prisma.sh/.../libquery_engine.dylib.node.sha256
failed, reason: unable to get local issuer certificate
```

This is a TLS issue, not an app bug: a corporate proxy is intercepting HTTPS with a
root CA that Node doesn't trust, so Prisma can't download its query engine. The engine
only needs to download successfully **once** (it's then cached in `node_modules`). Fix
it one of two ways:

**Recommended — trust your corporate CA (secure).** Export the root certs from the
macOS keychain into a PEM bundle and point Node at it:

```bash
security find-certificate -a -p /Library/Keychains/System.keychain > ~/corp-ca.pem
security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain >> ~/corp-ca.pem
# if still empty, also try the login keychain:
# security find-certificate -a -p ~/Library/Keychains/login.keychain-db >> ~/corp-ca.pem

export NODE_EXTRA_CA_CERTS=~/corp-ca.pem   # add to ~/.zshrc to make permanent
npm run db:push
```

**Quick unblock — disable TLS verification for one command (insecure).** Use only to
get going; prefer the option above:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run db:push
```

> The `package.json#prisma is deprecated` line is a harmless Prisma 6→7 migration
> warning, not an error.

### Troubleshooting: wrong-platform esbuild / `tsx` seed fails

`npm run db:seed` runs through `tsx`, which uses a native esbuild binary. If you see
`You installed esbuild for another platform...` (e.g. a Linux binary on macOS), your
`node_modules` was built on a different OS. Do a platform-clean install:

```bash
rm -rf node_modules package-lock.json
npm install
```

Never share or sync a `node_modules` directory between platforms (Docker volumes,
network drives, devcontainer mounts) — only source + `package.json`/`package-lock.json`
should travel between machines.

### Troubleshooting: `next.config.ts is not supported` / very old Next.js

If `npm run dev` errors with `Configuring Next.js via 'next.config.ts' is not supported`
or logs `[ wait ] starting the development server`, an ancient Next.js got installed.
Check `grep '"next"' package.json` — it must be `16.2.7`. **Do not run
`npm audit fix --force`**: it can rewrite `next` to a years-old version to "fix" a vuln,
which breaks the App Router. If the pin drifted, restore it to `16.2.7`, then:

```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
npx prisma generate     # regenerate the Prisma client after a fresh install
```

## Test

```bash
npm test            # vitest unit tests for the finance + format logic
```

## Views

- **Dashboard** — Protected Capital, Opportunity Reserve (deficit, progress, and **recovery
  time** = deficit ÷ monthly surplus), Monthly Surplus (income − expenses − investments),
  the highest-priority unfunded item, and a **Total Future Liability** card summing the
  remaining funding needed across all active commitments, goals, and experiences.
- **Priority Queue** — active items sorted by priority (highest first), then manual rank,
  then due date. Each row shows funding progress, **remaining amount**, and a **projected
  completion date** with an "on track / ⚠ behind by N months" flag. Inline **Edit**,
  **Complete**, **Delete**, and an **Add Funding** panel with transaction history.
- **Ranking** — drag-and-drop the active items to set their order **within** a priority
  level. This rank feeds the queue and the simulator's projections.
- **Timeline** — active commitments, goals, and experiences in chronological order.
- **Wishlist** — discretionary wants with a cooling-period guard ("Mark purchased" stays
  disabled until `dateAdded + coolingPeriodDays` has passed), an **"Added: N days ago"**
  age, and a **Convert to Goal** action (turns the wish into a Goal in place, keeping its
  funding history).
- **History** — completed items and purchased wishlist items, kept as a record.
- **Simulator** — enter a cost and see reserve before/after, % reduction, months to restore
  the reserve, per-goal delays, and a colour-coded **SAFE / CAUTION / WAIT** verdict.
- **Settings** — edit the financial profile (reserves, monthly figures).

## Funding model

Funding is tracked as **transactions**, not a single editable number. Each "Add Funding"
entry (amount + optional note + date) is stored, and an item's funded amount is the **sum of
its transactions** — giving an auditable history (`Jul 2026 +₹25,000 — July Salary`). Items
are created at ₹0 funded; you add funding over time.

## How the simulator works

A hypothetical purchase is deducted from the **Opportunity Reserve**. A month-by-month
projection allocates the monthly surplus — refilling the reserve to target first, then
funding queue items by priority — to estimate when each goal completes. Running that
projection before and after the purchase yields the goal-delay figures.

## Tech

Next.js (App Router) · TypeScript · Tailwind CSS · Prisma + SQLite · Zod · Vitest.
Currency is INR (₹). Single-user, no authentication (MVP).

## Docs

- Design spec (MVP): `docs/superpowers/specs/2026-06-07-financial-priority-planner-design.md`
- Implementation plan (MVP): `docs/superpowers/plans/2026-06-07-financial-priority-planner.md`
- Design spec (iteration 2, P0+P1): `docs/superpowers/specs/2026-06-07-planner-iteration-2-design.md`
- Implementation plan (iteration 2): `docs/superpowers/plans/2026-06-07-planner-iteration-2.md`
- Design spec (iteration 3, P2): `docs/superpowers/specs/2026-06-07-planner-iteration-3-design.md`
- Implementation plan (iteration 3): `docs/superpowers/plans/2026-06-07-planner-iteration-3.md`
