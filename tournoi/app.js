"use strict";

/* =========================================================
   Clash Sonore : tournoi à élimination directe entre les
   titres les plus écoutés d'un artiste (données Deezer).
   ========================================================= */

const STORE_KEY = "clash-sonore-v1";
const app = document.getElementById("app");
const backBtn = document.getElementById("back");
const toastEl = document.getElementById("toast");

/* ---------- Utilitaires ---------- */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = (n) => new Intl.NumberFormat("fr-FR").format(n || 0);
const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.ceil(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (toastEl.hidden = true), 2600);
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
function save(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* stockage indisponible */ }
}
function clearSave() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* rien */ }
}

const ICONS = {
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  bigPlay: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  bigPause: '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
};

/* ---------- API Deezer (JSONP : l'API n'autorise pas les appels directs depuis le navigateur) ---------- */

let jsonpSeq = 0;
function deezer(path, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = `__dz${Date.now()}_${jsonpSeq++}`;
    const qs = new URLSearchParams({ ...params, output: "jsonp", callback: cb });
    const script = document.createElement("script");
    const timer = setTimeout(() => finish(new Error("Deezer ne répond pas. Réessaie dans un instant.")), 12000);
    function finish(err, data) {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
      if (err) reject(err);
      else if (data && data.error) reject(new Error(data.error.message || "Erreur Deezer"));
      else resolve(data);
    }
    window[cb] = (data) => finish(null, data);
    script.onerror = () => finish(new Error("Impossible de joindre Deezer. Vérifie ta connexion."));
    script.src = `https://api.deezer.com/${path}?${qs}`;
    document.head.appendChild(script);
  });
}

async function searchArtists(q) {
  const res = await deezer("search/artist", { q, limit: 8 });
  return (res.data || []).map((a) => ({ id: a.id, name: a.name, picture: a.picture_medium, fans: a.nb_fan, albums: a.nb_album }));
}

async function getArtist(id) {
  const a = await deezer(`artist/${id}`);
  return { id: a.id, name: a.name, picture: a.picture_big || a.picture_medium, fans: a.nb_fan };
}

/* Retire les remix, live, versions instrumentales… et les doublons (single + version album). */
const EXCLUDE = /\b(remix|rmx|live|en concert|instrumental|acapella|a cappella|karaok[eé]|slowed|sped up|reverb|radio edit|edit radio|version acoustique|acoustic version|extended|clean version|snippet|freestyle colors|a colors show|colors show)\b/i;
const GENERIC = new Set(["intro", "outro", "interlude", "skit", "prelude"]);

function normTitle(t) {
  return t
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, "")
    .replace(/\s+(feat|ft|featuring|avec)\.?\s.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function getTopTracks(artistId) {
  const res = await deezer(`artist/${artistId}/top`, { limit: 100 });
  const seen = new Set();
  const out = [];
  for (const t of res.data || []) {
    if (!t.readable && t.readable !== undefined) continue;
    const full = `${t.title} ${t.title_version || ""}`;
    if (EXCLUDE.test(full)) continue;
    let key = normTitle(t.title_short || t.title);
    if (!key) continue;
    if (GENERIC.has(key)) key += `|${t.album?.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contributors = (t.contributors && t.contributors.length ? t.contributors : [t.artist]).map((c) => c.name);
    out.push({
      id: t.id,
      title: t.title,
      artists: [...new Set(contributors)].join(", "),
      album: t.album?.title || "",
      cover: t.album?.cover_big || t.album?.cover_medium || "",
      coverSmall: t.album?.cover_medium || t.album?.cover_small || "",
      preview: t.preview || "",
      link: t.link || `https://www.deezer.com/track/${t.id}`,
      mainArtist: t.artist?.name || "",
    });
  }
  return out;
}

/* Playlists publiques Deezer : les playlists éditoriales (faites par Deezer) d'abord. */
async function searchPlaylists(q) {
  const res = await deezer("search/playlist", { q, limit: 40 });
  const list = (res.data || [])
    .filter((p) => p.nb_tracks >= 4)
    .map((p) => ({
      id: p.id,
      name: p.title,
      picture: p.picture_medium,
      total: p.nb_tracks,
      owner: p.user?.name || "",
      editorial: /deezer/i.test(p.user?.name || ""),
    }));
  list.sort((x, y) => (y.editorial - x.editorial) || ((y.total >= 16) - (x.total >= 16)));
  return list.slice(0, 15);
}

function toTrack(t) {
  const contributors = (t.contributors && t.contributors.length ? t.contributors : [t.artist]).map((c) => c.name);
  return {
    id: t.id,
    title: t.title,
    artists: [...new Set(contributors)].join(", "),
    album: t.album?.title || "",
    cover: t.album?.cover_big || t.album?.cover_medium || "",
    coverSmall: t.album?.cover_medium || t.album?.cover_small || "",
    preview: t.preview || "",
    link: t.link || `https://www.deezer.com/track/${t.id}`,
    mainArtist: t.artist?.name || "",
  };
}

async function getPlaylist(id) {
  const [info, res] = await Promise.all([deezer(`playlist/${id}`), deezer(`playlist/${id}/tracks`, { limit: 500 })]);
  const seen = new Set();
  const tracks = [];
  for (const t of res.data || []) {
    if (t.readable === false || seen.has(t.id)) continue;
    seen.add(t.id);
    tracks.push(toTrack(t));
  }
  return { id: info.id, name: info.title, picture: info.picture_big || info.picture_medium, owner: info.creator?.name || "", tracks };
}

/* ---------- Tournoi ---------- */

const ROUND_NAMES = { 64: "32es de finale", 32: "16es de finale", 16: "8es de finale", 8: "Quarts de finale", 4: "Demi-finales", 2: "Finale" };
const roundName = (players) => ROUND_NAMES[players] || `Tour à ${players}`;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Ordre classique des têtes de série : 1 contre 64, 32 contre 33… les favoris se croisent le plus tard possible. */
function seedOrder(n) {
  let order = [1];
  while (order.length < n) {
    const size = order.length * 2;
    order = order.flatMap((s) => [s, size + 1 - s]);
  }
  return order.map((s) => s - 1);
}

/* Crée le tableau. Si le nombre de titres n'est pas une puissance de 2 (ex. playlist de 50 titres),
   certains titres sont qualifiés d'office pour le tour suivant (« exempts »). */
function createTournament(source, allTracks, size, seeding, extra = {}) {
  const tracks = allTracks.slice(0, size);
  const n = tracks.length;
  let P = 2;
  while (P < n) P *= 2;
  const first = [];
  if (seeding === "classement") {
    const order = seedOrder(P);
    for (let i = 0; i < P; i += 2) {
      const a = order[i] < n ? order[i] : null;
      const b = order[i + 1] < n ? order[i + 1] : null;
      first.push(a === null ? { a: b, b: null } : { a, b });
    }
  } else {
    const idx = shuffle(tracks.map((_, i) => i));
    const real = n - P / 2; // nombre de vrais matchs au 1er tour
    for (let i = 0; i < real; i++) first.push({ a: idx[2 * i], b: idx[2 * i + 1] });
    for (let i = 2 * real; i < n; i++) first.push({ a: idx[i], b: null });
    first.splice(0, first.length, ...shuffle(first));
  }
  first.forEach((g) => { g.bye = g.b === null; g.w = g.bye ? g.a : null; });
  const st = { v: 2, artist: source, tracks, size: n, slots: P, seeding, rounds: [first], r: 0, m: 0, done: false, startedAt: Date.now(), ...extra };
  st.m = nextUnplayed(first, 0);
  return st;
}

function nextUnplayed(round, from) {
  for (let i = from; i < round.length; i++) if (round[i].w === null) return i;
  return -1;
}

const totalMatches = (st) => st.size - 1;
function playedMatches(st) {
  let n = 0;
  for (const round of st.rounds) for (const g of round) if (g.w !== null && !g.bye) n++;
  return n;
}
/* Numéro du match affiché dans le tour (les qualifiés d'office ne comptent pas). */
function matchNumber(st) {
  const round = st.rounds[st.r];
  const real = round.filter((g) => !g.bye);
  return { n: real.indexOf(round[st.m]) + 1, of: real.length };
}

function choose(st, side) {
  const round = st.rounds[st.r];
  const game = round[st.m];
  game.w = side === 0 ? game.a : game.b;
  const next = nextUnplayed(round, st.m + 1);
  if (next !== -1) {
    st.m = next;
  } else if (round.length === 1) {
    st.done = true;
    st.finishedAt = Date.now();
  } else {
    const nr = [];
    for (let i = 0; i < round.length; i += 2) nr.push({ a: round[i].w, b: round[i + 1].w, w: null });
    st.rounds.push(nr);
    st.r++;
    st.m = 0;
  }
}

function undo(st) {
  if (playedMatches(st) === 0) return false;
  if (st.done) {
    st.done = false;
  } else {
    let i = st.m - 1;
    while (i >= 0 && st.rounds[st.r][i].bye) i--;
    if (i >= 0) {
      st.m = i;
    } else {
      st.rounds.pop();
      st.r--;
      const round = st.rounds[st.r];
      let j = round.length - 1;
      while (round[j].bye) j--;
      st.m = j;
    }
  }
  st.rounds[st.r][st.m].w = null;
  return true;
}

/* ---------- Lecteur audio (un seul extrait à la fois) ---------- */

const audio = new Audio();
audio.preload = "none";
let playing = null; // id du titre en cours
let currentState = null;
const retried = new Set();

/* Volume : réglage global, mémorisé dans le navigateur (50 % par défaut). */
const VOL_KEY = "clash-sonore-volume";
const volInput = document.getElementById("volume");
const volVal = document.getElementById("vol-val");
const muteBtn = document.getElementById("mute");
let lastVolume = 50;
const VOL_ICON = (v) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/>${
  v === 0 ? '<path d="m16 9.5 5 5m0-5-5 5"/>' : `<path d="M15.5 9a4 4 0 0 1 0 6"/>${v > 50 ? '<path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>' : ""}`}</svg>`;

function setVolume(v, remember = true) {
  v = Math.max(0, Math.min(100, Math.round(v)));
  audio.volume = v / 100;
  volInput.value = v;
  volInput.style.setProperty("--p", `${v}%`);
  volVal.textContent = `${v}%`;
  muteBtn.innerHTML = VOL_ICON(v);
  muteBtn.setAttribute("aria-label", v === 0 ? "Remettre le son" : "Couper le son");
  if (v > 0) lastVolume = v;
  if (remember) { try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* rien */ } }
}
volInput.addEventListener("input", () => setVolume(Number(volInput.value)));
muteBtn.addEventListener("click", () => setVolume(audio.volume > 0 ? 0 : lastVolume || 50));
{
  let saved = 50;
  try { const s = localStorage.getItem(VOL_KEY); if (s !== null && !isNaN(s)) saved = Number(s); } catch { /* rien */ }
  setVolume(saved, false);
  if (saved === 0) lastVolume = 50;
}

function trackById(id) {
  return currentState?.tracks.find((t) => t.id === id);
}

async function togglePlay(id) {
  if (playing === id && !audio.paused) {
    audio.pause();
    return;
  }
  const t = trackById(id);
  if (!t) return;
  if (playing !== id) {
    if (!t.preview) {
      toast("Pas d'extrait disponible pour ce titre.");
      return;
    }
    playing = id;
    audio.src = t.preview;
    audio.currentTime = 0;
  }
  try {
    await audio.play();
  } catch (e) {
    if (e.name !== "AbortError") refreshPreview(id);
  }
  syncPlayers();
}

/* Les liens d'extraits Deezer expirent au bout de quelques heures : on en redemande un si besoin. */
async function refreshPreview(id) {
  if (retried.has(id)) {
    toast("Extrait indisponible pour le moment.");
    return;
  }
  retried.add(id);
  try {
    const fresh = await deezer(`track/${id}`);
    const t = trackById(id);
    if (t && fresh.preview) {
      t.preview = fresh.preview;
      save(currentState);
      if (playing === id) {
        audio.src = t.preview;
        await audio.play().catch(() => {});
      }
    }
  } catch {
    toast("Extrait indisponible pour le moment.");
  }
  syncPlayers();
}

function stopAudio() {
  audio.pause();
  playing = null;
  spPauseAll();
  syncPlayers();
}

/* ---------- Lecteur Spotify intégré (titres complets si on est connecté à Spotify) ---------- */

const MODE_KEY = "clash-sonore-mode";
function savedMode() {
  try { return localStorage.getItem(MODE_KEY) === "extrait" ? "extrait" : "spotify"; } catch { return "spotify"; }
}
let listenMode = savedMode();
const isPlaylist = (st) => st && st.kind === "playlist";
let spotifyBroken = false; // passe à true si la fonction serveur n'est pas configurée
let spControllers = [];
let spApiPromise = null;

function loadSpotifyApi() {
  if (!spApiPromise) {
    spApiPromise = new Promise((resolve) => {
      window.onSpotifyIframeApiReady = (api) => resolve(api);
      const s = document.createElement("script");
      s.src = "https://open.spotify.com/embed/iframe-api/v1";
      s.async = true;
      s.onerror = () => resolve(null);
      document.body.appendChild(s);
      setTimeout(() => resolve(null), 15000);
    });
  }
  return spApiPromise;
}

function spPauseAll(except) {
  spControllers.forEach((c) => { if (c && c !== except) { try { c.pause(); } catch { /* rien */ } } });
}
function spDestroyAll() {
  spControllers.forEach((c) => { try { c && c.destroy(); } catch { /* rien */ } });
  spControllers = [];
}

async function spotifyId(t, artistName) {
  if (t.sp !== undefined) return t.sp;
  const r = await fetch(`api/spotify?${new URLSearchParams({ title: t.title, artist: artistName })}`);
  const type = r.headers.get("content-type") || "";
  if (!type.includes("json") || r.status === 503 || r.status === 404) {
    spotifyBroken = true;
    throw new Error("unavailable");
  }
  if (!r.ok) throw new Error("spotify");
  const data = await r.json();
  t.sp = data.id || null;
  if (currentState) save(currentState);
  return t.sp;
}

/* Monte un lecteur Spotify dans chaque carte du match affiché. */
async function mountSpotify(token) {
  const st = currentState;
  const slots = [...app.querySelectorAll("[data-sp-slot]")];
  const api = await loadSpotifyApi();
  await Promise.all(slots.map(async (slot, i) => {
    const t = trackById(Number(slot.dataset.spSlot));
    let id = null;
    try { id = await spotifyId(t, t.mainArtist || st.artist.name); } catch { id = undefined; }
    if (token !== matchToken) return;
    if (spotifyBroken) return fallbackToExtract("Lecteur Spotify pas encore configuré : extraits de 30 s à la place.");
    if (!id || !api) {
      slot.innerHTML = `<p class="sp-miss">${id === null ? "Titre introuvable sur Spotify." : "Lecteur Spotify indisponible."} <button type="button" class="linkish" data-act="mode-extrait">Écouter l'extrait 30 s</button></p>`;
      return;
    }
    const el = document.createElement("div");
    slot.replaceChildren(el);
    api.createController(el, { uri: `spotify:track:${id}`, width: "100%", height: 80 }, (ctrl) => {
      if (token !== matchToken) { ctrl.destroy(); return; }
      spControllers[i] = ctrl;
      ctrl.addListener("playback_update", (e) => {
        if (e.data && !e.data.isPaused) {
          audio.pause();
          spPauseAll(ctrl);
        }
        const card = slot.closest(".song");
        if (card) card.classList.toggle("playing", !!(e.data && !e.data.isPaused && e.data.position > 0));
      });
    });
  }));
}

function fallbackToExtract(msg) {
  if (listenMode !== "spotify") return;
  listenMode = "extrait";
  toast(msg);
  if (view === "match") renderMatch();
}

function setMode(mode) {
  listenMode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* rien */ }
  stopAudio();
  renderMatch();
}

audio.addEventListener("error", () => { if (playing) refreshPreview(playing); });
["play", "pause", "ended", "timeupdate", "loadedmetadata"].forEach((ev) => audio.addEventListener(ev, syncPlayers));

function syncPlayers() {
  document.querySelectorAll("[data-song]").forEach((el) => {
    const id = Number(el.dataset.song);
    const active = id === playing;
    const isPlaying = active && !audio.paused;
    el.classList.toggle("playing", isPlaying);
    const pp = el.querySelector(".pp");
    if (pp) {
      pp.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
      pp.setAttribute("aria-label", isPlaying ? "Pause" : "Écouter l'extrait");
    }
    const big = el.querySelector(".play-overlay span");
    if (big) big.innerHTML = isPlaying ? ICONS.bigPause : ICONS.bigPlay;
    const bar = el.querySelector(".bar i");
    const time = el.querySelector(".time");
    const dur = active && isFinite(audio.duration) ? audio.duration : 30;
    const cur = active ? audio.currentTime : 0;
    if (bar) bar.style.width = `${Math.min(100, (cur / dur) * 100)}%`;
    if (time) time.textContent = `-${fmtTime(dur - cur)}`;
  });
}

/* ---------- Écrans ---------- */

let view = "home";
function setView(name, showBack) {
  view = name;
  backBtn.hidden = !showBack;
  window.scrollTo({ top: 0 });
}

backBtn.addEventListener("click", () => {
  stopAudio();
  history.replaceState(null, "", location.pathname);
  renderHome();
});

/* Accueil : recherche d'artiste ou de playlist Spotify */
let homeTab = "artiste";
const PLAYLIST_IDEAS = ["Années 90", "Années 2000", "Années 80", "Rap français", "Rap US", "R&B", "Afro", "Été", "Soirée", "Disney"];

function parsePlaylistId(text) {
  const m = String(text).match(/deezer\.[a-z.]+\/(?:[a-z]{2}\/)?playlist\/(\d+)/i);
  return m ? m[1] : null;
}

function renderHome() {
  spDestroyAll();
  setView("home", false);
  currentState = null;
  const saved = load();
  const pl = homeTab === "playlist";
  app.innerHTML = `
    <section class="hero">
      <h1 class="display">Quel est <em>vraiment</em><br>le meilleur son ?</h1>
      <p>${pl
        ? "Choisis une playlist (années 90, rap FR…) : ses titres s'affrontent en duel jusqu'à ce qu'il n'en reste qu'un."
        : "Choisis un artiste : ses titres les plus écoutés s'affrontent en duel jusqu'à ce qu'il n'en reste qu'un."}</p>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-tab="artiste" aria-selected="${!pl}">🎤 Artiste</button>
        <button type="button" role="tab" data-tab="playlist" aria-selected="${pl}">🎧 Playlist</button>
      </div>
      <form class="search" id="search-form" role="search">
        ${ICONS.search}
        <input id="q" type="search" placeholder="${pl ? "Rechercher une playlist (ex. années 90, rap français…)" : "Rechercher un artiste (ex. Ninho, Aya Nakamura…)"}" autocomplete="off" aria-label="${pl ? "Playlist" : "Nom de l'artiste"}" autofocus>
      </form>
      ${pl ? `<div class="chips">${PLAYLIST_IDEAS.map((x) => `<button type="button" class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : ""}
      <div class="results" id="results"></div>
      ${saved && !saved.done ? `
        <div class="resume">
          <img src="${esc(saved.artist.picture)}" alt="">
          <div class="t"><b>Tournoi en cours : ${esc(saved.artist.name)}</b>
            <span>${isPlaylist(saved) ? "Playlist · " : ""}${roundName(saved.rounds[saved.r].length * 2)} · ${playedMatches(saved)} / ${totalMatches(saved)} matchs joués</span></div>
          <button class="btn orange sm" id="resume" type="button">Reprendre</button>
        </div>` : ""}
      <p class="hint">${pl
        ? "Toute la playlist s'affronte (64 titres max) · écoute en entier dans le lecteur Spotify"
        : "Titres classés selon leur popularité · remix et versions live retirés"}</p>
    </section>`;

  const input = document.getElementById("q");
  const results = document.getElementById("results");
  let seq = 0;
  let timer;

  async function run() {
    const q = input.value.trim();
    const my = ++seq;
    if (pl) {
      const id = parsePlaylistId(q);
      if (id) { openPlaylist(id); return; }
    }
    if (q.length < 2) { results.innerHTML = ""; return; }
    results.innerHTML = '<div class="loading"><div class="spin"></div>Recherche…</div>';
    try {
      if (pl) {
        const playlists = await searchPlaylists(q);
        if (my !== seq) return;
        results.innerHTML = playlists.length
          ? playlists.map((p) => `
            <button class="artist-row square" type="button" data-pl="${esc(p.id)}">
              <img src="${esc(p.picture)}" alt="" loading="lazy">
              <span><span class="n">${esc(p.name)}</span><br><span class="s">${p.total} titres · ${p.editorial ? "✓ playlist officielle" : `par ${esc(p.owner)}`}</span></span>
              <span class="go">Choisir →</span>
            </button>`).join("")
          : '<p class="hint">Aucune playlist trouvée.</p>';
      } else {
        const list = await searchArtists(q);
        if (my !== seq) return;
        results.innerHTML = list.length
          ? list.map((a) => `
            <button class="artist-row" type="button" data-id="${a.id}">
              <img src="${esc(a.picture)}" alt="" loading="lazy">
              <span><span class="n">${esc(a.name)}</span><br><span class="s">${fmtNum(a.fans)} fans</span></span>
              <span class="go">Choisir →</span>
            </button>`).join("")
          : '<p class="hint">Aucun artiste trouvé.</p>';
      }
    } catch (e) {
      if (my === seq) results.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  }

  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, pl && parsePlaylistId(input.value) ? 0 : 350); });
  document.getElementById("search-form").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); });
  app.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b && b.dataset.tab !== homeTab) { homeTab = b.dataset.tab; renderHome(); }
  });
  app.querySelector(".chips")?.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) { input.value = b.dataset.q; clearTimeout(timer); run(); }
  });
  results.addEventListener("click", (e) => {
    const row = e.target.closest(".artist-row");
    if (!row) return;
    if (row.dataset.pl) openPlaylist(row.dataset.pl);
    else openArtist(Number(row.dataset.id));
  });
  document.getElementById("resume")?.addEventListener("click", () => {
    currentState = saved;
    renderMatch();
  });
}

/* Préparation d'un tournoi playlist Spotify */
async function openPlaylist(id) {
  setView("setup", true);
  stopAudio();
  history.replaceState(null, "", `?playlist=${id}`);
  app.innerHTML = '<div class="loading"><div class="spin"></div>Récupération de la playlist…</div>';
  let pl;
  try {
    pl = await getPlaylist(id);
  } catch (e) {
    app.innerHTML = `<div class="frame"><p class="err">${esc(e.message)}</p><div class="setup-actions"><button class="btn ghost" type="button" id="retry">Réessayer</button><button class="btn ghost" type="button" id="home">Choisir une autre playlist</button></div></div>`;
    document.getElementById("retry").onclick = () => openPlaylist(id);
    document.getElementById("home").onclick = () => { homeTab = "playlist"; history.replaceState(null, "", location.pathname); renderHome(); };
    return;
  }
  if (view !== "setup") return;
  const source = { id: pl.id, name: pl.name, picture: pl.picture, owner: pl.owner };
  const all = pl.tracks;
  if (all.length < 3) {
    app.innerHTML = `<div class="frame"><p class="err">Cette playlist n'a pas assez de titres lisibles (${all.length}). Il en faut au moins 3.</p></div>`;
    return;
  }
  const maxN = Math.min(64, all.length);
  const sizes = [maxN, ...[32, 16, 8].filter((x) => x < maxN)];
  let size = maxN;
  let seeding = "hasard";
  let pickMode = "debut";

  const draw = () => {
    app.innerHTML = `
      <div class="frame">
        <div class="setup-head">
          <img class="sq" src="${esc(pl.picture)}" alt="">
          <div>
            <h2 class="display">${esc(pl.name)}</h2>
            <p>${all.length} titres${pl.owner ? ` · par ${esc(pl.owner)}` : ""}</p>
          </div>
        </div>
        <div class="opts">
          <div>
            <div class="opt-label">Nombre de titres</div>
            <div class="seg" id="size">
              ${sizes.map((n, i) => `<button type="button" data-v="${n}" aria-pressed="${n === size}">
                ${i === 0 && n === all.length ? "Toute la playlist" : `${n} titres`}<small>${n} titres · ${n - 1} matchs</small></button>`).join("")}
            </div>
          </div>
          ${size < all.length ? `
          <div>
            <div class="opt-label">Quels titres ?</div>
            <div class="seg" id="pick">
              <button type="button" data-v="debut" aria-pressed="${pickMode === "debut"}">Les premiers<small>dans l'ordre de la playlist</small></button>
              <button type="button" data-v="hasard" aria-pressed="${pickMode === "hasard"}">Au hasard<small>dans toute la playlist</small></button>
            </div>
          </div>` : ""}
          <div>
            <div class="opt-label">Tirage des matchs</div>
            <div class="seg" id="seeding">
              <button type="button" data-v="hasard" aria-pressed="${seeding === "hasard"}">Au hasard<small>Affiches surprises</small></button>
              <button type="button" data-v="classement" aria-pressed="${seeding === "classement"}">Ordre de la playlist<small>Le n°1 affronte le dernier</small></button>
            </div>
          </div>
          <div>
            <div class="opt-label">Titres de la playlist</div>
            <div class="tracklist">
              ${all.map((t, i) => `
                <div class="tl-item"><span class="num">${i + 1}</span><img src="${esc(t.coverSmall)}" alt="" loading="lazy"><span class="nm" title="${esc(t.title)} · ${esc(t.artists)}">${esc(t.title)}</span></div>`).join("")}
            </div>
          </div>
        </div>
        <div class="setup-actions">
          <button class="btn" id="start" type="button">Lancer le tournoi</button>
          <button class="btn ghost" id="share" type="button">Partager cette playlist</button>
        </div>
      </div>`;
    const seg = (sel, fn) => { const el = document.getElementById(sel); if (el) el.onclick = (e) => { const b = e.target.closest("button"); if (b) { fn(b.dataset.v); draw(); } }; };
    seg("size", (v) => { size = Number(v); });
    seg("pick", (v) => { pickMode = v; });
    seg("seeding", (v) => { seeding = v; });
    document.getElementById("start").onclick = () => {
      const old = load();
      if (old && !old.done && !confirm(`Un tournoi ${old.artist.name} est en cours. Le remplacer ?`)) return;
      const chosen = pickMode === "hasard" && size < all.length ? shuffle(all).slice(0, size) : all.slice(0, size);
      currentState = createTournament(source, chosen, size, seeding, { kind: "playlist" });
      save(currentState);
      renderMatch();
    };
    document.getElementById("share").onclick = () => share(
      `Fais le tournoi de la playlist « ${pl.name} » : à toi de trouver le meilleur son !`,
      `${location.origin}${location.pathname}?playlist=${pl.id}`,
    );
  };
  draw();
}

/* Préparation : aperçu des titres + options */
async function openArtist(id) {
  setView("setup", true);
  stopAudio();
  history.replaceState(null, "", `?artiste=${id}`);
  app.innerHTML = '<div class="loading"><div class="spin"></div>Récupération des titres les plus écoutés…</div>';
  let artist, tracks;
  try {
    [artist, tracks] = await Promise.all([getArtist(id), getTopTracks(id)]);
  } catch (e) {
    app.innerHTML = `<p class="err">${esc(e.message)}</p><div class="setup-actions"><button class="btn ghost" type="button" id="retry">Réessayer</button></div>`;
    document.getElementById("retry").onclick = () => openArtist(id);
    return;
  }
  if (view !== "setup") return;

  const sizes = [64, 32, 16, 8];
  let size = sizes.find((s) => s <= tracks.length);
  let seeding = "hasard";

  if (!size) {
    app.innerHTML = `<div class="frame"><p class="err">${esc(artist.name)} n'a pas assez de titres sur Deezer pour un tournoi (${tracks.length} trouvés, 8 minimum).</p></div>`;
    return;
  }

  const draw = () => {
    app.innerHTML = `
      <div class="frame">
        <div class="setup-head">
          <img src="${esc(artist.picture)}" alt="">
          <div>
            <h2 class="display">${esc(artist.name)}</h2>
            <p>${tracks.length} titres trouvés · ${fmtNum(artist.fans)} fans sur Deezer</p>
          </div>
        </div>
        <div class="opts">
          <div>
            <div class="opt-label">Nombre de titres</div>
            <div class="seg" id="size">
              ${sizes.map((s) => `<button type="button" data-v="${s}" aria-pressed="${s === size}" ${s > tracks.length ? "disabled" : ""}>
                ${s} titres<small>${s - 1} matchs</small></button>`).join("")}
            </div>
          </div>
          <div>
            <div class="opt-label">Tirage des matchs</div>
            <div class="seg" id="seeding">
              <button type="button" data-v="hasard" aria-pressed="${seeding === "hasard"}">Au hasard<small>Affiches surprises</small></button>
              <button type="button" data-v="classement" aria-pressed="${seeding === "classement"}">Têtes de série<small>Le n°1 affronte le n°${size}</small></button>
            </div>
          </div>
          <div>
            <div class="opt-label">Les ${size} titres en lice (du plus au moins écouté)</div>
            <div class="tracklist">
              ${tracks.slice(0, size).map((t, i) => `
                <div class="tl-item"><span class="num">${i + 1}</span><img src="${esc(t.coverSmall)}" alt="" loading="lazy"><span class="nm" title="${esc(t.title)}">${esc(t.title)}</span></div>`).join("")}
            </div>
          </div>
        </div>
        <div class="setup-actions">
          <button class="btn" id="start" type="button">Lancer le tournoi</button>
          <button class="btn ghost" id="share" type="button">Partager cet artiste</button>
        </div>
      </div>`;
    document.getElementById("size").onclick = (e) => {
      const b = e.target.closest("button");
      if (b && !b.disabled) { size = Number(b.dataset.v); draw(); }
    };
    document.getElementById("seeding").onclick = (e) => {
      const b = e.target.closest("button");
      if (b) { seeding = b.dataset.v; draw(); }
    };
    document.getElementById("start").onclick = () => {
      const old = load();
      if (old && !old.done && !confirm(`Un tournoi ${old.artist.name} est en cours. Le remplacer ?`)) return;
      currentState = createTournament(artist, tracks, size, seeding);
      retried.clear();
      save(currentState);
      renderMatch();
    };
    document.getElementById("share").onclick = () => share(
      `Fais le tournoi ${artist.name} : ses ${size} meilleurs sons s'affrontent !`,
      `${location.origin}${location.pathname}?artiste=${artist.id}`,
    );
  };
  draw();
}

/* Match */
function songCard(t, side) {
  const spotify = t.sp ? `https://open.spotify.com/track/${t.sp}` : `https://open.spotify.com/search/${encodeURIComponent(`${t.title.replace(/\s*\(.*?\)/g, "")} ${t.artists.split(",")[0]}`)}`;
  return `
    <article class="song" data-song="${t.id}" data-side="${side}">
      <button class="cover" type="button" data-act="play" aria-label="Écouter ${esc(t.title)}">
        <img src="${esc(t.cover)}" alt="">
        <span class="play-overlay"><span>${ICONS.bigPlay}</span></span>
      </button>
      <h3>${esc(t.title)}</h3>
      <div class="artists">${esc(t.artists)}</div>
      <div class="album">${esc(t.album)}</div>
      <div class="grow"></div>
      ${listenMode === "spotify" ? `
      <div class="sp-slot" data-sp-slot="${t.id}"><div class="sp-wait">Chargement du lecteur Spotify…</div></div>` : `
      <div class="player">
        <button class="pp" type="button" data-act="play" aria-label="Écouter l'extrait">${ICONS.play}</button>
        <div class="bar" data-act="seek"><i></i></div>
        <span class="time">-0:30</span>
        <span class="ext">
          <a href="${esc(spotify)}" target="_blank" rel="noopener" title="Écouter en entier sur Spotify">SP</a>
          <a href="${esc(t.link)}" target="_blank" rel="noopener" title="Écouter en entier sur Deezer">DZ</a>
        </span>
      </div>`}
      <button class="btn pick" type="button" data-act="pick">Je choisis</button>
    </article>`;
}

let picking = false;
let matchToken = 0;
function renderMatch() {
  const st = currentState;
  spDestroyAll();
  const token = ++matchToken;
  if (st.done) return renderEnd();
  listenMode = spotifyBroken ? "extrait" : savedMode();
  setView("match", true);
  picking = false;
  const round = st.rounds[st.r];
  const game = round[st.m];
  const A = st.tracks[game.a];
  const B = st.tracks[game.b];
  const played = playedMatches(st);
  const pct = (played / totalMatches(st)) * 100;

  app.innerHTML = `
    <div class="frame">
      <div class="match-head">
        <div class="round display">${roundName(round.length * 2)}</div>
        <div class="count">Match ${matchNumber(st).n} / ${matchNumber(st).of}</div>
        <div class="who"><img src="${esc(st.artist.picture)}" alt="">${esc(st.artist.name)}</div>
      </div>
      <div class="progress" title="${played} / ${totalMatches(st)} matchs joués"><i style="width:${pct}%"></i></div>
      <div class="duel">
        ${songCard(A, 0)}
        <div class="vs" aria-hidden="true">VS</div>
        ${songCard(B, 1)}
      </div>
      <div class="match-foot">
        <div class="seg mode" id="mode" role="group" aria-label="Mode d'écoute">
          <button type="button" data-v="spotify" aria-pressed="${listenMode === "spotify"}" ${spotifyBroken ? "disabled" : ""}>Spotify<small>titre complet</small></button>
          <button type="button" data-v="extrait" aria-pressed="${listenMode === "extrait"}">Extrait 30 s<small>volume réglable</small></button>
        </div>
        <button class="btn ghost sm" id="undo" type="button" ${played ? "" : "disabled"}>↶ Annuler le dernier choix</button>
        <span class="keys"><kbd>←</kbd> / <kbd>→</kbd> pour choisir · <kbd>A</kbd> / <kbd>Z</kbd> pour écouter</span>
      </div>
    </div>`;

  app.querySelectorAll(".song").forEach((card) => {
    card.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      const id = Number(card.dataset.song);
      if (act === "mode-extrait") setMode("extrait");
      else if (act === "play" && listenMode === "spotify") spToggle(Number(card.dataset.side));
      else if (act === "play") togglePlay(id);
      else if (act === "pick") pick(Number(card.dataset.side));
      else if (act === "seek" && playing === id && isFinite(audio.duration)) {
        const r = e.target.closest(".bar").getBoundingClientRect();
        audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
      }
    });
  });
  document.getElementById("undo").onclick = () => {
    stopAudio();
    if (undo(st)) { save(st); renderMatch(); }
  };
  document.getElementById("mode").onclick = (e) => {
    const b = e.target.closest("button");
    if (b && !b.disabled && b.dataset.v !== listenMode) setMode(b.dataset.v);
  };
  if (listenMode === "spotify") mountSpotify(token);
  syncPlayers();
}

function spToggle(side) {
  const c = spControllers[side];
  if (!c) return;
  spPauseAll(c);
  audio.pause();
  c.togglePlay();
}

async function pick(side) {
  if (picking || view !== "match") return;
  picking = true;
  stopAudio();
  const cards = app.querySelectorAll(".song");
  cards.forEach((c) => c.classList.add(Number(c.dataset.side) === side ? "win" : "lose"));
  choose(currentState, side);
  save(currentState);
  await sleep(420);
  renderMatch();
}

document.addEventListener("keydown", (e) => {
  if (view !== "match" || e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  const ids = [...app.querySelectorAll(".song")].map((c) => Number(c.dataset.song));
  if (e.key === "ArrowLeft") { e.preventDefault(); pick(0); }
  else if (e.key === "ArrowRight") { e.preventDefault(); pick(1); }
  else if (e.key.toLowerCase() === "a" && ids[0]) listenMode === "spotify" ? spToggle(0) : togglePlay(ids[0]);
  else if (e.key.toLowerCase() === "z" && ids[1]) listenMode === "spotify" ? spToggle(1) : togglePlay(ids[1]);
});

/* Fin : champion + tableau complet */
function renderEnd() {
  const st = currentState;
  spDestroyAll();
  setView("end", true);
  const final = st.rounds[st.rounds.length - 1][0];
  const champ = st.tracks[final.w];
  const finalist = st.tracks[final.w === final.a ? final.b : final.a];
  const semis = st.rounds.length >= 2
    ? st.rounds[st.rounds.length - 2].filter((g) => !g.bye).map((g) => st.tracks[g.w === g.a ? g.b : g.a])
    : [];
  const pl = isPlaylist(st);
  const link = `${location.origin}${location.pathname}?${pl ? "playlist" : "artiste"}=${st.artist.id}`;

  app.innerHTML = `
    <div class="frame">
      <div class="champ">
        <div class="crown" aria-hidden="true">👑</div>
        <div class="lbl">Grand vainqueur</div>
        <img src="${esc(champ.cover)}" alt="">
        <h2 class="display">${esc(champ.title)}</h2>
        <p>${esc(champ.artists)} · vainqueur parmi ${st.size} titres</p>
        <div class="setup-actions">
          <button class="btn" id="share" type="button">Partager mon résultat</button>
          <button class="btn ghost" id="again" type="button">Rejouer ${esc(st.artist.name)}</button>
          <button class="btn ghost" id="undo" type="button">↶ Revenir sur la finale</button>
        </div>
      </div>
      <div class="podium">
        <div class="pod"><img src="${esc(finalist.coverSmall)}" alt=""><div style="min-width:0"><div class="r">Finaliste</div><div class="nm">${esc(finalist.title)}</div></div></div>
        ${semis.map((t) => `<div class="pod"><img src="${esc(t.coverSmall)}" alt=""><div style="min-width:0"><div class="r">Demi-finaliste</div><div class="nm">${esc(t.title)}</div></div></div>`).join("")}
      </div>
      <div class="bracket">
        ${st.rounds.slice().reverse().map((round) => `
          <h3>${roundName(round.length * 2)}</h3>
          <div class="games">
            ${round.filter((g) => !g.bye).map((g) => `<div class="game">
              <div class="${g.w === g.a ? "w" : ""}">${esc(st.tracks[g.a].title)}</div>
              <div class="${g.w === g.b ? "w" : ""}">${esc(st.tracks[g.b].title)}</div>
            </div>`).join("")}
          </div>`).join("")}
      </div>
    </div>`;

  document.getElementById("share").onclick = () => {
    const lines = [
      pl ? `🏆 Mon son préféré de la playlist « ${st.artist.name} » : « ${champ.title} » (${champ.artists})` : `🏆 Mon son préféré de ${st.artist.name} : « ${champ.title} »`,
      `🥈 Finale contre « ${finalist.title} »`,
      semis.length ? `🥉 Demi-finalistes : ${semis.map((t) => `« ${t.title} »`).join(", ")}` : "",
      `Tournoi à ${st.size} titres sur Clash Sonore. À ton tour :`,
    ].filter(Boolean);
    share(lines.join("\n"), link);
  };
  document.getElementById("again").onclick = () => (pl ? openPlaylist(st.artist.id) : openArtist(st.artist.id));
  document.getElementById("undo").onclick = () => { undo(st); save(st); renderMatch(); };

  if (!st.celebrated) {
    st.celebrated = true;
    save(st);
    confetti();
  }
}

function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div");
  box.className = "confetti";
  const colors = ["#22e36b", "#ff6a2b", "#ffd23f", "#ffffff", "#4dd0ff"];
  for (let i = 0; i < 120; i++) {
    const p = document.createElement("i");
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = `${2.2 + Math.random() * 2.2}s`;
    p.style.animationDelay = `${Math.random() * .8}s`;
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 5500);
}

async function share(text, url) {
  if (navigator.share) {
    try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("Copié ! Colle-le à tes potes.");
  } catch {
    prompt("Copie ce texte :", `${text}\n${url}`);
  }
}

/* ---------- Démarrage ---------- */

const params = new URLSearchParams(location.search);
const startId = Number(params.get("artiste"));
const startPl = params.get("playlist");
if (startPl && /^\d+$/.test(startPl)) { homeTab = "playlist"; openPlaylist(startPl); }
else if (startId) openArtist(startId);
else renderHome();
