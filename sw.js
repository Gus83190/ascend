// Service worker : garde ASCEND et son moteur en mémoire pour fonctionner hors connexion.
const VERSION = "ascend-48521a13ae70";
const FICHIERS = ["aide.html", "app.css", "app.js", "ascend.css", "ascend.html", "ascend.zip", "bilan.html", "calendrier.html", "carnet.html", "carte.html", "collection.html", "defis.html", "force.html", "heros.html", "icone-180.png", "icone-192.png", "icone-512.png", "index.html", "manifest.webmanifest", "minuteur.html", "moteur.js", "pont.js", "profil.html", "programmes.html", "quetes.html", "quiz.html", "records.html", "saisie.html", "saisons.html", "sauvegardes.html", "theme.css"];

self.addEventListener("install", e => {
  // cache: "reload" : on ignore le cache du navigateur pour être sûr d'avoir la nouvelle version.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS.map(f => new Request(f, {cache: "reload"}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "pyodide").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const moteur = url.hostname === "cdn.jsdelivr.net";
  if (!moteur && url.origin !== self.location.origin) return;
  e.respondWith(caches.open(moteur ? "pyodide" : VERSION).then(async cache => {
    const deja = await cache.match(e.request, {ignoreSearch: !moteur});
    if (deja) return deja;
    const rep = await fetch(e.request);
    if (rep.ok) cache.put(e.request, rep.clone());
    return rep;
  }).catch(() => caches.match("ascend.html")));
});
