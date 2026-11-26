// Fonction serveur Vercel : retrouve l'identifiant Spotify d'un titre (titre + artiste).
// Les clés restent côté serveur, dans les variables d'environnement Vercel :
//   SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET
// Appel : /api/spotify?title=Jefe&artist=Ninho  ->  { "id": "...", "name": "...", "artists": "..." }

let cached = { token: null, exp: 0 };

async function getToken(force = false) {
  if (!force && cached.token && Date.now() < cached.exp) return cached.token;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw Object.assign(new Error(`token ${r.status}`), { status: r.status });
  const data = await r.json();
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

const norm = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/\s*[([].*?[)\]]/g, "")
  .replace(/\s+(feat|ft|featuring)\.?\s.*$/, "")
  .replace(/\s+-\s+.*$/, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

async function search(q) {
  const url = `https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: "track", limit: "10", market: "FR" })}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(attempt > 0);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401 && attempt === 0) continue;
    if (!r.ok) throw Object.assign(new Error(`search ${r.status}`), { status: r.status });
    const data = await r.json();
    return data.tracks?.items || [];
  }
  return [];
}

function best(items, title, artist) {
  const t = norm(title);
  const a = norm(artist);
  const score = (it) => {
    const name = norm(it.name);
    const artists = (it.artists || []).map((x) => norm(x.name));
    let s = 0;
    if (name === t) s += 4;
    else if (name.startsWith(t) || t.startsWith(name)) s += 2;
    if (artists.includes(a)) s += 3;
    else if (a && artists.some((x) => x.includes(a) || a.includes(x))) s += 2;
    return s;
  };
  const ranked = items.map((it) => ({ it, s: score(it) })).sort((x, y) => y.s - x.s);
  return ranked[0] && ranked[0].s >= 5 ? ranked[0].it : null; // titre exact ou proche + bon artiste
}

module.exports = async (req, res) => {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    return res.status(503).json({ error: "not_configured" });
  }
  const title = String(req.query.title || "").slice(0, 200);
  const artist = String(req.query.artist || "").slice(0, 200);
  if (!title) return res.status(400).json({ error: "missing_title" });

  const cleanTitle = title.replace(/\s*[([].*?[)\]]/g, "").replace(/\s+(feat|ft)\.?\s.*$/i, "").trim() || title;
  try {
    let found = best(await search(`track:${cleanTitle} artist:${artist}`), cleanTitle, artist);
    if (!found) found = best(await search(`${cleanTitle} ${artist}`), cleanTitle, artist);
    res.setHeader("Cache-Control", "public, s-maxage=2592000, stale-while-revalidate=86400");
    return res.status(200).json(found
      ? { id: found.id, name: found.name, artists: found.artists.map((x) => x.name).join(", ") }
      : { id: null });
  } catch (e) {
    return res.status(502).json({ error: "spotify_error", status: e.status || null });
  }
};
