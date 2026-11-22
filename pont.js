// Version mobile : chaque écran envoie ses demandes au moteur gardé par la page coquille.
"use strict";
if (window.top === window) {
  // Écran ouvert seul (sans la coquille) : on repasse par la coquille qui démarre le moteur.
  const page = location.pathname.split("/").pop() || "index.html";
  location.replace("ascend.html?p=" + encodeURIComponent(page + location.search + location.hash));
}
window.ASCEND_MOBILE = true;
window.ASCEND_PONT = (path, body) => window.parent.ascendApi(path, body);

// Téléchargement d'un fichier (export) : feuille de partage de l'iPhone si possible
// (Enregistrer dans Fichiers, AirDrop…), sinon téléchargement classique.
window.ascendSaveFile = async (name, bytes) => {
  const file = new File([bytes], name, {type: "application/octet-stream"});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    try { await navigator.share({files: [file], title: name}); return "partagé"; }
    catch (e) { if (e.name === "AbortError") return "annulé"; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "téléchargé";
};
