# Ladybug, Ladybug

Landing page for *Ladybug, Ladybug: Keeping It Classy in a Buggy World* (Fast Camel Press).

Static site. Deployed to Vercel at https://ladybug.karikounkel.com.

## Edit the launch date

`index.html` line ~398:

```js
const LAUNCH_DATE = "2026-05-31T09:00:00";
```

## What still needs to be wired before launch

- `Get the Book` button (hero) — point at the buy/pre-order URL
- `Download the Garden Kit` button — drop `ladybug-garden-kit.pdf` at the repo root
- `Read the series` button — Substack URL
- `The 13th Room` and `Everything Under the Sun` links — Substack + podcast URLs
- Garden submission form — wire to Supabase `ladybug_gardens` table (insert-only RLS)
