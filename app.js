// Outils partagés par les écrans : appels au moteur local, en-tête, emblèmes de rang.
"use strict";

async function api(path, body) {
  if (window.ASCEND_PONT) return window.ASCEND_PONT(path, body);   // version mobile : moteur dans le téléphone
  const opt = body === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)};
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false)
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

function rankBadge(rank, size = 32) {
  return el("span", {class: `rkw ${rank}`, role: "img", "aria-label": `Rang ${rank}`},
    el("span", {class: "rk", style: `--s:${size}`}, rank));
}

const fmt = n => Math.round(n).toLocaleString("fr-FR");

function header(active, state) {
  const h = state && state.hero;
  const links = [["index.html", "Accueil"], ["heros.html", "Héros"], ["quetes.html", "Quêtes"], ["programmes.html", "Programmes"], ["defis.html", "Défis"], ["carnet.html", "Carnet"], ["saisie.html", "Saisie rapide"],
    ["minuteur.html", "Minuteur"], ["quiz.html", "Quiz"], ["force.html", "Régions"], ["carte.html", "Carte"],
    ["saisons.html", "Saisons"], ["bilan.html", "Bilan"], ["aide.html", "Aide"]];
  if (HERO_PAGES.some(([p]) => p === active)) active = "heros.html";
  const toggle = el("button", {class: "burger", type: "button", "aria-expanded": "false", "aria-controls": "nav-principale",
    onclick: e => { const h = e.currentTarget.closest("header"); const open = h.classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", String(open)); e.currentTarget.textContent = open ? "✕ Fermer" : "☰ Menu"; }}, "☰ Menu");
  return el("header", {class: "top"},
    el("div", {class: "logo"}, el("i", {class: "gem"}), "ASCEND"),
    toggle,
    el("nav", {id: "nav-principale", "aria-label": "Navigation principale"},
      links.map(([href, label]) => el("a", {class: "nv" + (href === active ? " on" : ""), href,
        "aria-current": href === active ? "page" : null}, label))),
    state && state.test_mode ? el("span", {class: "chip g", title: "Phase de test : changements de classe illimités"}, "Mode test") : null,
    state && state.integrity && !state.integrity.ok ? el("a", {class: "chip warn", href: "heros.html#integrite",
      title: "Le journal a été modifié en dehors de l'application, ou la date du PC a reculé"}, "⚠ Intégrité") : null,
    themePicker(),
    h ? el("div", {class: "me"}, el("span", {class: "av", "aria-hidden": "true"}, h.name[0].toUpperCase()),
      el("div", {}, el("b", {}, h.name), el("small", {}, `Niv. ${h.level} · Rang ${h.rank}`))) : null);
}

// Thèmes de couleur (préférence de ce PC, gardée dans le navigateur).
const THEMES = [["equilibre", "Équilibré"], ["sombre", "Sombre"]];
function currentTheme() {
  let t = "equilibre";
  try { t = localStorage.getItem("ascend-theme") || "equilibre"; } catch (e) { /* préférence indisponible */ }
  return THEMES.some(([v]) => v === t) ? t : "equilibre";   // un ancien choix « clair » revient à Équilibré
}
function themePicker() {
  const sel = el("select", {id: "theme-select", onchange: e => {
    document.documentElement.dataset.theme = e.target.value;
    try { localStorage.setItem("ascend-theme", e.target.value); } catch (err) { /* préférence non gardée */ }
  }}, THEMES.map(([v, l]) => el("option", {value: v}, l)));
  sel.value = currentTheme();
  return el("label", {class: "theme"}, "Thème", sel);
}

function mount(active, state) {
  const old = document.querySelector("header.top");
  const fresh = header(active, state);
  if (old) old.replaceWith(fresh); else document.querySelector(".scr").prepend(fresh);
}

// Sous-menu des pages du héros (fiche, profil, collection, calendrier, sauvegardes).
const HERO_PAGES = [["heros.html", "Fiche et épreuves"], ["profil.html", "Profil"], ["records.html", "Records"], ["histoire.html", "Histoire"], ["collection.html", "Collection"],
  ["calendrier.html", "Calendrier"], ["sauvegardes.html", "Sauvegardes"]];
// Onglets de l'écran Quiz, partagés par les pages Langues et Cartes.
function quizTabs(active) {
  return el("nav", {class: "tabs", "aria-label": "Type de quiz"},
    [["quiz.html#livres", "Livres"], ["quiz.html#matieres", "Matières (devoirs)"], ["langues.html", "Langues A1 → C2"], ["cartes.html", "Cartes de révision"]]
      .map(([href, label]) => el("a", {class: "tablink", href, "aria-current": href === active ? "page" : null}, label)));
}
function heroTabs(active) {
  return el("nav", {class: "subnav", "aria-label": "Pages du héros"},
    HERO_PAGES.map(([href, label]) => el("a", {href, class: href === active ? "on" : "",
      "aria-current": href === active ? "page" : null}, label)));
}

// Couleur d'une stat (repères visuels de la carte, du calendrier et de la collection).
const STAT_COLORS = {"Force": "#C9705A", "Endurance": "#D9A441", "Agilité": "#6FB58A", "Vitalité": "#5DB3C9",
  "Intelligence": "#7E8FD6", "Mental": "#A983C9", "Expédition": "#8FA65A"};

// Célébrations (rang, titre…) affichées dans une petite fenêtre.
function showCelebrations(list) {
  if (!list || !list.length) return;
  const box = el("div", {class: "celebrate", role: "dialog", "aria-modal": "true", onclick: e => { if (e.target === box) box.remove(); }},
    el("div", {class: "card2"}, el("h2", {}, "Bravo !"), list.map(c => el("p", {}, c.text)),
      el("button", {class: "btn sm", type: "button", style: "margin-top:12px", onclick: () => box.remove()}, "Continuer")));
  document.body.append(box);
  box.querySelector("button").focus();
}

function message(node, text, isError = false) {
  node.textContent = text;
  node.className = "msg" + (isError ? " err" : "");
}

// Une fenêtre restée ouverte après minuit se recharge : « aujourd'hui » doit rester juste partout.
const LOADED_DAY = new Date().toDateString();
function reloadIfNewDay() {
  if (new Date().toDateString() !== LOADED_DAY && !document.querySelector("form.qzform, #clock")) location.reload();
}
window.addEventListener("focus", reloadIfNewDay);
document.addEventListener("visibilitychange", () => { if (!document.hidden) reloadIfNewDay(); });
setInterval(reloadIfNewDay, 60000);
// ---------------------------------------------------------------- transfert entre appareils (PC ↔ téléphone)
function b64FromBytes(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function bytesFromB64(b64) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function saveFile(name, bytes) {
  if (window.ascendSaveFile) return window.ascendSaveFile(name, bytes);     // iPhone : feuille de partage
  const a = el("a", {href: URL.createObjectURL(new Blob([bytes])), download: name});
  document.body.append(a); a.click(); a.remove();
  return "téléchargé";
}

// withExport : false sur l'écran d'accueil d'un appareil neuf (rien à exporter encore).
function transferBox(withExport = true) {
  const msg = el("div", {class: "msg", role: "status"});
  const file = el("input", {type: "file", accept: ".ascbak,application/octet-stream", "aria-label": "Fichier de transfert"});
  const code = el("input", {type: "text", autocomplete: "off", autocapitalize: "characters", placeholder: "XXXX-XXXX-XXXX-XXXX-XXXX",
    "aria-label": "Code de récupération de l'appareil d'origine"});
  return el("div", {class: "pn pb"},
    el("div", {class: "ph", style: "margin-bottom:8px"}, "Transférer mon héros (PC ↔ téléphone)"),
    withExport ? el("div", {},
      el("p", {class: "tx2", style: "margin:0 0 8px"}, "1. Sur l'appareil d'origine : exporte ton héros. Le fichier est chiffré avec ton code de récupération."),
      el("button", {class: "btn sm", type: "button", onclick: async () => {
        try {
          const r = await api("/api/export");
          const how = await saveFile(r.name, bytesFromB64(r.data));
          message(msg, how === "annulé" ? "Export annulé." : `Fichier ${r.name} (${String(r.size_kb).replace(".", ",")} Ko) prêt : envoie-le sur l'autre appareil (AirDrop, iCloud Drive, câble…).`);
        } catch (e) { message(msg, e.message, true); }
      }}, "Exporter mon héros")) : null,
    el("p", {class: "tx2", style: "margin:12px 0 8px"}, (withExport ? "2. " : "") + "Sur l'appareil d'arrivée : choisis le fichier, puis tape le code de récupération de l'appareil d'origine. Le héros de cet appareil sera remplacé (une copie de sécurité est gardée)."),
    el("label", {class: "f"}, "Fichier .ascbak", file),
    el("label", {class: "f", style: "margin-top:8px"}, "Code de récupération", code),
    el("button", {class: "btn gh sm", type: "button", style: "margin-top:10px", onclick: async () => {
      if (!file.files.length) return message(msg, "Choisis d'abord le fichier.", true);
      if (!code.value.trim()) return message(msg, "Tape le code de récupération.", true);
      if (withExport && !confirm("Remplacer le héros de cet appareil par celui du fichier ?")) return;
      try {
        const bytes = new Uint8Array(await file.files[0].arrayBuffer());
        const r = await api("/api/import", {data: b64FromBytes(bytes), code: code.value.trim()});
        message(msg, r.message);
        setTimeout(() => { location.href = "index.html"; }, 1500);
      } catch (e) { message(msg, e.message, true); }
    }}, "Importer"),
    msg);
}
