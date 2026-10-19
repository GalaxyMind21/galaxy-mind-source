# Galaxy Mind

The source for [galaxymind.space](https://galaxymind.space): a directory of shops that take bitcoin, guides for spending and accepting it, live bitcoin data pages (treasuries, supply, hashprice), a browser arcade, and the hashrate desk.

It's a [Next.js](https://nextjs.org) App Router site written in TypeScript, deployed on Vercel.

This repository is a snapshot of the site's source, published as a single commit. Development happens in a separate repository, and some files were edited for publication: receive addresses are placeholders, no wallet or listing ids are included, the scheduled avatar-refresh and TestFlight upload workflows are left out, and the database migrations differ from the deployed ones (see "Database migrations in this copy" below).

## Run it locally

You'll need Node.js 22 and npm.

```bash
npm ci
cp .env.example .env.local   # optional: every variable can stay empty
npm run dev                  # http://127.0.0.1:3000
```

With no environment variables set, the site still runs. Storage runs in no-op mode, email and X login are off, and direct hashrate rentals stay closed (`RENTALS_MODE` defaults to `mrr_only`, which sends renters to the marketplace).

To build for production:

```bash
npm run build
```

## Checks

`npm run verify` runs the type check and the full validator and test suite (vendor data, page copy, SEO, arcade, rentals and security guards). The `verify` workflow in `.github/workflows/` runs it on pushes and pull requests whenever GitHub Actions is enabled for the repository. Two steps need extra tools: the iOS key test needs Python 3, and some iOS checks need Ruby.

The never-reveal guard (`scripts/check-never-reveal.ts`) checks the tree against keyed digests held in the `NEVER_REVEAL_KEY` and `NEVER_REVEAL_DIGESTS` Actions secrets. Without them it skips with a notice, so pull requests from forks still pass. Pushes to `main` require the secrets and fail closed when they're missing.

## Layout

| Path | What's there |
|---|---|
| `src/app` | Pages and API routes (`src/app/api/**`) |
| `src/lib` | Shared logic, including the vendor directory (`vendors.ts`) and the rentals code (`rentals/`) |
| `src/components` | Shared React components |
| `public` | Static assets, including the standalone arcade games (`chop/`, `bitcoin-kart/`, `six-deep/` and `super-saylor.html`) |
| `scripts` | Validators, tests and maintenance scripts used by `npm run verify` and the crons |
| `supabase/migrations` | Database migrations for the rentals backend. Not every file here has been applied to every database, so check before assuming. Never edit a migration once it has been applied; add a new one. |
| `ios-arcade` | The Capacitor wrapper for the iOS arcade app |

## Project conventions

- Numbers on a page come from the data module that owns them (for example `VENDORS` in `src/lib/vendors.ts`), never from hard-coded prose.
- Pages carry their own canonical URL, Open Graph data and JSON-LD; `scripts/check-*` enforce the rules.
- Customer copy is plain, warm and honest. `scripts/check-site-voice.ts` catches the common slips.
- Every cron in `vercel.json` needs an entry in `CRON_META` (`src/lib/cron-health.ts`) so the health dashboard can flag it when it stops.
- Direct rental payment routes must open with the `mrr_only` gate. `scripts/test-mrr-gate-coverage.ts` enforces this for every route under `src/app/api/rentals` and `src/app/api/hashrate`.

## Adding a shop

Shops are added through the form at [galaxymind.space/submit](https://galaxymind.space/submit), not by pull request. Every listing is checked by hand before it goes live.

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Fonts

The site face in this copy is Plus Jakarta Sans, under the SIL Open Font License 1.1 (see `src/app/fonts/OFL.txt` and [CREDITS.md](CREDITS.md)). The running site uses Satoshi by Indian Type Foundry, which is free to use but may not be redistributed, so it isn't included here. If you want it, download Satoshi from Fontshare (https://www.fontshare.com/fonts/satoshi) under its own licence and point `src/app/layout.tsx`, `src/lib/og-bench.tsx` and `scripts/check-og-fonts.ts` at your copies.

## Contributing

Pull requests are welcome. Changes to `.gitleaks.toml`, `scripts/check-never-reveal.ts`, `scripts/check-never-reveal-commits.ts`, `src/lib/never-reveal.ts` or the secret-scan workflow are reviewed by hand before they are merged, because a pull request runs its own copy of those checks. Expect extra questions on those paths.

## Database migrations in this copy

The files in `supabase/migrations` and `supabase/rollback` were rewritten for this public copy: receive addresses are placeholders, no mainnet wallet is pinned, and some role, policy and status names differ from the deployed database. They document the schema; they are not a deployable history. Never push them to any database (no `supabase db push`, no migration tool, no SQL editor). The private repository stays the only source of migrations for the running site.

## License

Third-party code, fonts, images and music keep their own licenses (see [CREDITS.md](CREDITS.md)); the shop images are not MIT-licensed. The license for the Galaxy Mind code itself, and the notice covering the Galaxy Mind name and logo, ship as `LICENSE` and `NOTICE` with the public release.
