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

## Test

```bash
npm test            # vitest unit tests for the finance + format logic
```

## Views

- **Dashboard** — Protected Capital, Opportunity Reserve (with deficit + progress),
  Monthly Surplus (income − expenses − investments), and the highest-priority unfunded item.
- **Priority Queue** — every non-wishlist item sorted by priority (highest first) then
  due date; create / edit / delete inline.
- **Timeline** — commitments, goals, and experiences in chronological order.
- **Wishlist** — discretionary wants with a cooling-period guard: "Mark purchased" stays
  disabled until `dateAdded + coolingPeriodDays` has passed.
- **Simulator** — enter a cost and see reserve before/after, % reduction, months to restore
  the reserve, per-goal delays, and a colour-coded **SAFE / CAUTION / WAIT** verdict.
- **Settings** — edit the financial profile (reserves, monthly figures).

## How the simulator works

A hypothetical purchase is deducted from the **Opportunity Reserve**. A month-by-month
projection allocates the monthly surplus — refilling the reserve to target first, then
funding queue items by priority — to estimate when each goal completes. Running that
projection before and after the purchase yields the goal-delay figures.

## Tech

Next.js (App Router) · TypeScript · Tailwind CSS · Prisma + SQLite · Zod · Vitest.
Currency is INR (₹). Single-user, no authentication (MVP).

## Docs

- Design spec: `docs/superpowers/specs/2026-06-07-financial-priority-planner-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-07-financial-priority-planner.md`
