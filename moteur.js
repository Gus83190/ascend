// Version mobile d'ASCEND : le moteur Python tourne dans le navigateur (Pyodide).
// Cette page « coquille » garde le moteur en mémoire ; les écrans s'affichent dans un cadre
// et lui envoient leurs demandes (window.ascendApi). La base SQLite est rangée dans le
// stockage du navigateur (IndexedDB), sur le téléphone uniquement.
"use strict";
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const DB = "/donnees/ascend.db";

function localISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function etat(texte, pct) {
  document.getElementById("etat").textContent = texte;
  if (pct !== undefined) document.getElementById("avance").style.width = pct + "%";
}

let py = null, mobile = null, minuterie = null;

// Enregistre la base dans le stockage du téléphone (regroupé : au plus une fois toutes les 300 ms).
function enregistrer(immediat) {
  if (!py) return;
  clearTimeout(minuterie);
  const go = () => py.FS.syncfs(false, err => { if (err) console.error("Sauvegarde locale impossible", err); });
  if (immediat) go(); else minuterie = setTimeout(go, 300);
}

const pret = (async () => {
  etat("Chargement du moteur…", 10);
  py = await loadPyodide({indexURL: PYODIDE_URL});
  etat("Chargement de la base de données…", 45);
  try { await py.loadPackage(["sqlite3", "hashlib"]); }
  catch (e) { await py.loadPackage(["sqlite3"]); }
  etat("Installation d'ASCEND…", 70);
  const zip = await (await fetch("ascend.zip")).arrayBuffer();
  py.unpackArchive(zip, "zip", {extractDir: "/app"});
  py.FS.mkdirTree("/donnees");
  py.FS.mount(py.FS.filesystems.IDBFS, {}, "/donnees");
  await new Promise((ok, ko) => py.FS.syncfs(true, e => (e ? ko(e) : ok())));
  etat("Réveil du héros…", 90);
  py.runPython("import sys; sys.path.insert(0, '/app')");
  mobile = py.pyimport("ascend.mobile");
  mobile.start(DB, localISO);
  enregistrer(true);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  etat("Prêt", 100);
})();

// Appelée par les écrans (pont.js) à la place d'une requête au serveur.
window.ascendApi = async (path, body) => {
  await pret;
  const out = JSON.parse(mobile.call(body === undefined ? "GET" : "POST", path,
    body === undefined ? null : JSON.stringify(body)));
  enregistrer(body !== undefined);      // une modification est enregistrée tout de suite
  if (out.status >= 400) throw new Error((out.payload && out.payload.error) || `Erreur ${out.status}`);
  return out.payload;
};

pret.then(() => {
  const page = new URLSearchParams(location.search).get("p") || "index.html";
  const vue = document.getElementById("vue");
  vue.src = /^[a-z0-9_-]+\.html([?#].*)?$/i.test(page) ? page : "index.html";
  vue.hidden = false;
  document.getElementById("boot").hidden = true;
}).catch(err => {
  console.error(err);
  etat("Le moteur n'a pas pu démarrer (" + err.message + "). Au premier lancement, il faut une connexion internet.");
});

// Le téléphone peut fermer l'appli à tout moment : on enregistre quand elle passe en arrière-plan.
document.addEventListener("visibilitychange", () => { if (document.hidden) enregistrer(true); });
window.addEventListener("pagehide", () => enregistrer(true));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
