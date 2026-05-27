// Vercel serverless function: fetches the karikounkel.substack.com RSS feed
// at request time and returns the "Things I Didn't Tell You" 13-part series
// posts in JSON, keyed by day-of-month so the landing page can swap
// scheduled placeholders for real links the moment each post publishes.
//
// CDN-cached for 10 min so we're not hammering Substack on every page view.

export default async function handler(req, res) {
  try {
    const r = await fetch("https://karikounkel.substack.com/feed", {
      headers: { "User-Agent": "ladybug.karikounkel.com/1.0" },
    });
    if (!r.ok) throw new Error(`feed returned ${r.status}`);
    const xml = await r.text();

    // The series window — posts published May 18–30, 2026 (Parts 1–13).
    const start = new Date("2026-05-18T00:00:00Z").getTime();
    const end = new Date("2026-05-31T00:00:00Z").getTime();

    const items = xml.match(/<item\b[\s\S]*?<\/item>/g) || [];
    const posts = items
      .map((it) => {
        const link = (it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
        const title =
          (it.match(/<title>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/) ||
            it.match(/<title>([\s\S]*?)<\/title>/) ||
            [])[1] || "";
        const pubStr = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
        const pub = new Date(pubStr);
        return { url: link.trim(), title: title.trim(), ts: pub.getTime(), iso: pub.toISOString() };
      })
      .filter((p) => p.url && Number.isFinite(p.ts) && p.ts >= start && p.ts < end)
      .map((p) => {
        // Use Central Time for day-of-month since that's how the cards are labeled.
        const d = new Date(p.ts);
        const day = parseInt(
          new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "America/Chicago" }).format(d),
          10
        );
        return { day, url: p.url, title: p.title, iso: p.iso };
      })
      .sort((a, b) => a.day - b.day);

    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify({ posts }));
  } catch (err) {
    res.setHeader("Cache-Control", "public, s-maxage=60");
    res.status(200).send(JSON.stringify({ posts: [], error: String(err && err.message) }));
  }
}
