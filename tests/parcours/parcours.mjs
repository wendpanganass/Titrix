/**
 * Parcours de bout en bout (Playwright) sur une base de TEST vide, avec des données fictives.
 * Lancer l'application (`npm run build && npm start` avec DATABASE_URL vers la base de test), puis :
 *   ADRESSE=http://localhost:3000 node tests/parcours/parcours.mjs
 * Captures d'écran déposées dans tests/parcours/captures/ (non versionnées).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import ExcelJS from "exceljs";

const ADRESSE = process.env.ADRESSE ?? "http://localhost:3000";
const CAPTURES = new URL("./captures/", import.meta.url).pathname;
fs.mkdirSync(CAPTURES, { recursive: true });
const MDP_ADMIN = "AdminDemo2026";
let ok = 0;
const verifier = (cond, libelle) => {
  if (!cond) throw new Error(`ÉCHEC : ${libelle}`);
  ok++;
  console.log(`✔ ${libelle}`);
};

const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--lang=fr-FR"] });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR", acceptDownloads: true });
const page = await contexte.newPage();
page.on("dialog", async (d) => {
  if (d.type() === "prompt") await d.accept("Motif de test");
  else await d.accept();
});
const erreursPage = [];
// En cas d'échec : capture de l'écran et messages visibles, pour comprendre.
process.on("unhandledRejection", async (e) => {
  console.error(String(e));
  try {
    await page.screenshot({ path: `${CAPTURES}echec.png`, fullPage: true });
    console.error("Messages :", await page.locator(".note").allInnerTexts());
  } catch {}
  process.exit(1);
});
page.on("pageerror", (e) => erreursPage.push(e.message));

async function aller(chemin) {
  await page.goto(ADRESSE + chemin);
  await page.waitForLoadState("networkidle");
}
async function message() {
  const n = page.locator(".note-bon, .note-erreur").last();
  await n.waitFor({ timeout: 15000 });
  return (await n.innerText()).trim();
}
async function connecter(email, mdp) {
  await contexte.clearCookies();
  await aller("/connexion");
  await page.fill("#email", email);
  await page.fill("#mdp", mdp);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 15000 }), page.click("button.btn")]);
}
async function changerMdp(ancien, nouveau) {
  await page.waitForURL(/\/compte/);
  await page.fill("input[name=actuel]", ancien);
  await page.fill("input[name=nouveau]", nouveau);
  await page.fill("input[name=confirmation]", nouveau);
  await page.click("form button[type=submit]");
  verifier((await message()).includes("modifié"), "mot de passe provisoire remplacé");
}
async function capture(nom) {
  await page.screenshot({ path: `${CAPTURES}${nom}.png`, fullPage: true });
  const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  verifier(debord <= 1, `${nom} : aucun débordement horizontal (${debord}px)`);
}
/** Clique sur un bouton d'action puis vérifie, après rechargement, qu'un texte apparaît (ou affiche l'erreur). */
async function agirPuisVoir(bouton, texte) {
  await page.locator("button", { hasText: bouton }).first().click();
  await page.waitForTimeout(1500);
  const alerte = page.locator("form [role=alert]");
  if (await alerte.count()) throw new Error(`ÉCHEC : ${await alerte.first().innerText()}`);
  await page.reload();
  await page.waitForSelector(`text=${texte}`, { timeout: 10000 });
}
/** Ouvre le dépliant « summary » qui contient le texte donné. */
async function deplier(texte) {
  await page.locator("summary", { hasText: texte }).first().click();
}

// 1. Installation ---------------------------------------------------------------
await aller("/");
verifier(page.url().includes("/installation"), "base vide : écran d'installation proposé");
await capture("00_installation");
await page.fill("#nom", "Admin Démo");
await page.fill("#email", "admin@banque-demo.test");
await page.fill("#mdp", MDP_ADMIN);
await page.fill("#conf", MDP_ADMIN);
await Promise.all([page.waitForURL(ADRESSE + "/"), page.click("button.btn")]);
verifier((await page.locator("h1").innerText()).includes("Tableau de bord"), "administrateur créé et connecté");

// 2. Paramètres et référentiels -------------------------------------------------------
await aller("/parametres");
await page.fill("input[name=nom_etablissement]", "Banque Démo SA");
await page.click("form button[type=submit]");
verifier((await message()).includes("enregistrés"), "paramètres enregistrés");
for (const [onglet, nom] of [["conservateurs", "SGI Démo A"], ["conservateurs", "SGI Démo B"], ["emetteurs", "État Démo"]]) {
  await aller(`/referentiels?onglet=${onglet}`);
  const f = page.locator("section", { hasText: "Ajouter" }).last();
  await f.locator("input[name=nom]").fill(nom);
  await f.locator("button[type=submit]").click();
  verifier((await message()).includes("créé"), `référentiel ${onglet} : ${nom}`);
}
await aller("/referentiels?onglet=contreparties");
{
  const f = page.locator("section", { hasText: "Ajouter" }).last();
  await f.locator("input[name=nom]").fill("Banque centrale Démo");
  await f.locator("button[type=submit]").click();
  verifier((await message()).includes("créé"), "contrepartie / bénéficiaire créée");
}

// 3. Comptes ----------------------------------------------------------------------------
const secrets = {};
for (const [nom, email, roles] of [
  ["Gestion Démo", "gestion@banque-demo.test", ["gestionnaire", "back_office"]],
  ["Validation Démo", "validation@banque-demo.test", ["validateur", "comptabilite"]],
]) {
  await aller("/utilisateurs");
  const f = page.locator("section", { hasText: "Créer un compte" });
  await f.locator("input[name=nom]").fill(nom);
  await f.locator("input[name=email]").fill(email);
  for (const r of roles) await f.locator(`input[name=roles][value=${r}]`).check();
  await f.locator("button[type=submit]").click();
  await message();
  secrets[email] = (await f.locator("code").innerText()).trim();
  verifier(secrets[email].length === 12, `compte ${nom} créé, mot de passe provisoire affiché une fois`);
}

// 4. Gestionnaire : instrument, position, opération ----------------------------------
await connecter("gestion@banque-demo.test", secrets["gestion@banque-demo.test"]);
await changerMdp(secrets["gestion@banque-demo.test"], "GestionDemo2026");
await aller("/instruments");
await deplier("Saisir un nouvel instrument");
await page.fill("input[name=libelle]", "OAT Démo 6,50 % 2024-2029");
await page.selectOption("select[name=emetteur_id]", { label: "État Démo" });
await page.selectOption("select[name=pays_code]", "BF");
await page.selectOption("select[name=type_code]", "OAT");
await page.fill("input[name=nominal_unitaire]", "10000");
await page.fill("input[name=date_emission]", "2024-03-15");
await page.fill("input[name=date_echeance]", "2029-03-15");
await page.fill("input[name=taux_coupon]", "6,5");
await page.selectOption("select[name=profil]", "constant");
await page.fill("input[name=differe_mois]", "24");
await page.click("form button[type=submit]");
{
  const m = await message();
  verifier(m.includes("OAT-BF-2029-001"), `instrument créé avec un code attribué automatiquement (${m})`);
}
await aller("/positions?instrument=x");
await page.selectOption("select[name=instrument_id]", { label: "OAT-BF-2029-001 — OAT Démo 6,50 % 2024-2029" });
await page.selectOption("select[name=conservateur_id]", { label: "SGI Démo A" });
await page.fill("input[name=compte_conservation]", "000123");
await page.click("form button[type=submit]");
verifier((await message()).includes("Position créée"), "position créée");
await aller("/positions");
await page.locator("a", { hasText: "OAT-BF-2029-001" }).first().click();
await page.waitForURL(/\/positions\/[0-9a-f-]{36}/);
const urlPosition = page.url();
const f = page.locator("section", { hasText: "Nouvelle opération" });
await f.locator("select[name=type]").selectOption("acquisition");
await f.locator("input[name=date_effet]").fill("2024-03-15");
await f.locator("input[name=nominal]").fill("1000000");
await f.locator("input[name=quantite]").fill("100");
await f.locator("input[name=date_negociation]").fill("2024-03-13");
await f.locator("input[name=date_reglement]").fill("2024-03-15");
await f.locator("input[name=prix]").fill("100");
await f.locator("select[name=contrepartie_id]").selectOption({ label: "Banque centrale Démo" });
await f.locator("button[type=submit]").click();
verifier((await message()).includes("soumise à validation"), "acquisition saisie et soumise");
await aller("/operations?statut=soumis");
await page.locator("tbody a").first().click();
await page.waitForURL(/\/operations\/[0-9a-f-]{36}/);
verifier((await page.locator("button", { hasText: "Valider" }).count()) === 0, "l'initiateur ne voit pas le bouton Valider");

// 5. Validateur ---------------------------------------------------------------------------
await connecter("validation@banque-demo.test", secrets["validation@banque-demo.test"]);
await changerMdp(secrets["validation@banque-demo.test"], "ValidationDemo2026");
await aller("/instruments?statut=a_valider");
await page.locator("tbody a").first().click();
await agirPuisVoir("Valider les caractéristiques", "Validation Démo, le");
verifier(true, "caractéristiques validées par une autre personne");
await aller("/operations?vue=a_valider");
await page.locator("tbody a").first().click();
await agirPuisVoir(/^Valider$/, "Validé");
await aller(urlPosition.replace(ADRESSE, ""));
const nominal = await page.locator(".kpi").first().innerText();
verifier(nominal.includes("1,0 M"), "position à 1 000 000 après validation");
verifier((await page.locator("table.tab").nth(1).locator("tbody tr").count()) === 5, "échéancier de 5 échéances (différé de 2 ans puis 3 amortissements)");
await capture("01_position");

// 6. Grevage (gestionnaire) puis validation ---------------------------------------------------------
await connecter("gestion@banque-demo.test", "GestionDemo2026");
await aller("/grevages");
{
  const g = page.locator("section", { hasText: "Nouveau grevage" });
  await g.locator("select[name=position_id]").selectOption({ index: 1 });
  await g.locator("select[name=beneficiaire_id]").selectOption({ label: "Banque centrale Démo" });
  await g.locator("input[name=nominal_affecte]").fill("1200000");
  await g.locator("input[name=date_debut]").fill("2025-01-15");
  await g.locator("button[type=submit]").click();
  verifier((await message()).includes("supérieur au nominal disponible"), "grevage excessif refusé dès la saisie");
  await g.locator("input[name=nominal_affecte]").fill("400000");
  await g.locator("input[name=financement_obtenu]").fill("350000");
  await g.locator("button[type=submit]").click();
  await page.waitForSelector("text=Grevage soumis", { timeout: 10000 }).catch(async (e) => {
    console.error("Messages :", await page.locator(".note").allInnerTexts());
    throw e;
  });
  verifier(true, "grevage de 400 000 soumis");
}
// Encaissement de la première échéance (back-office).
await aller("/encaissements?vue=toutes");
await page.locator("tbody a").first().click();
await page.waitForURL(/echeance=/);
await page.fill("input[name=montant]", "40000");
await page.locator("section", { hasText: "Échéance du" }).locator("button[type=submit]").first().click();
verifier((await message()).includes("Encaissement"), "encaissement partiel enregistré");
await page.waitForSelector("text=Partiellement encaissée");
verifier(true, "statut « Partiellement encaissée » avec solde restant dû");
await capture("02_encaissement");

await connecter("validation@banque-demo.test", "ValidationDemo2026");
await aller("/grevages?statut=soumis");
await page.locator("tbody a").first().click();
await agirPuisVoir(/^Valider$/, "Actif");
verifier(true, "grevage validé (disponible contrôlé par la base)");

// 7. Arrêté, verrouillage, opération rétrodatée bloquée ---------------------------------------------------
await aller("/arretes");
await page.fill("input[name=date_arrete]", "2025-12-31");
await page.click("form button[type=submit]");
verifier((await message()).includes("calculé"), "arrêté du 31/12/2025 calculé");
await page.locator("tbody a").first().click();
await agirPuisVoir("Verrouiller", "Verrouillé");
verifier(true, "arrêté verrouillé");
await capture("03_arrete");
await connecter("gestion@banque-demo.test", "GestionDemo2026");
await aller(urlPosition.replace(ADRESSE, ""));
{
  const o = page.locator("section", { hasText: "Nouvelle opération" });
  await o.locator("select[name=type]").selectOption("remboursement_anticipe");
  await o.locator("input[name=date_effet]").fill("2025-06-30");
  await o.locator("input[name=nominal]").fill("100000");
  await o.locator("button[type=submit]").click();
  verifier((await message()).includes("soumise"), "opération rétrodatée saisie");
}
await connecter("validation@banque-demo.test", "ValidationDemo2026");
await aller("/operations?vue=a_valider");
await page.locator("tbody a").first().click();
verifier((await page.locator(".note-alerte").first().innerText()).includes("rétrodatée"), "impact de l'opération rétrodatée affiché");
await page.locator("button", { hasText: /^Valider$/ }).click();
await page.waitForSelector("form [role=alert]");
const refus = await page.locator("form [role=alert]").first().innerText();
verifier(refus.includes("verrouillé"), "validation refusée : arrêté verrouillé protégé");

// 8. Écrans de restitution et exports ---------------------------------------------------------------
for (const [chemin, nom] of [["/", "10_tableau_de_bord"], ["/analyses?axe=maturite", "11_analyses"], ["/echeancier", "12_echeancier"], ["/controles", "13_controles"], ["/etats", "14_etats"], ["/journal", "15_journal"]]) {
  if (chemin === "/journal") await connecter("admin@banque-demo.test", MDP_ADMIN);
  await aller(chemin);
  await capture(nom);
}
for (const etat of ["inventaire", "echeancier", "tombees", "grevage", "encaissements", "rapprochement", "anomalies", "situation", "historique"]) {
  const r = await page.request.get(`${ADRESSE}/exports/${etat}?date=2026-01-31&devise=XOF&format=xlsx`);
  verifier(r.status() === 200 && r.headers()["content-type"].includes("spreadsheetml"), `export Excel « ${etat} »`);
  fs.writeFileSync(`${CAPTURES}${etat}.xlsx`, await r.body());
}
const csv = await page.request.get(`${ADRESSE}/exports/inventaire?format=csv`);
verifier(csv.status() === 200 && (await csv.text()).includes("Nominal détenu"), "export CSV inventaire");


// 10. Import d'un classeur fictif reprenant les défauts du fichier d'origine -----------------------------
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BASE");
  ws.addRow(["Notice : base titres (fictive)"]);
  ws.addRow(["Code titre", "Libellé", "Emetteur", "Pays", "Type", "Devise", "Valeur nominale", "Date émission", "Date échéance", "Taux", "Périodicité", "Mode de remboursement", "Différé", "Conservateur", "Compte", "Encours nominal", "Bénéficiaire", "Montant utilisé"]);
  ws.addRow(["IMP-OAT-2030-A", "OAT Import 6 % 2030", "État Import", "SN", "OAT", "XOF", 10000, "01/06/2023", "01/06/2030", "6,00 %", "Annuelle", "In fine", 0, "SGI Import 1", "C1", 500000000, "", ""]);
  ws.addRow(["IMP-OAT-2030-B", "OAT Import 6 % 2030", "État Import", "SN", "OAT", "XOF", 10000, "01/06/2023", "01/06/2030", "6,00 %", "Annuelle", "In fine", 0, "SGI Import 2", "C2", 250000000, "Banque centrale Démo", 100000000]);
  ws.addRow(["IMP-OAT-2030-C", "OAT Import 6 % 2030", "État Import", "SN", "OAT", "XOF", 10000, "01/06/2023", "01/06/2031", "6,50 %", "Annuelle", "In fine", 0, "SGI Import 3", "C3", 100000000, "", ""]);
  ws.addRow(["IMP-BAT-2026", "Bon Import 2026", "État Import", "SN", "BAT", "XOF", 1000000, "01/03/2026", "01/03/2027", "", "", "", 0, "SGI Import 1", "C1", 300000000, "", ""]);
  ws.addRow(["IMP-OBL-ERR", "Obligation avec erreur", "Émetteur Import", "CI", "OBL", "XOF", 10000, "01/01/2022", "01/01/2028", 0.07, "Semestrielle", "Amortissement constant", 2, "SGI Import 1", "C1", { formula: "1/0", result: { error: "#DIV/0!" } }, "", ""]);
  ws.addRow(["IMP-OBL-NEG", "Obligation grevage excessif", "Émetteur Import", "CI", "OBL", "XOF", 10000, "01/01/2022", "01/01/2028", 0.07, "Semestrielle", "Amortissement constant", 2, "SGI Import 2", "C2", 50000000, "Banque centrale Démo", 80000000]);
  const chemin = `${CAPTURES}base_titres_fictive.xlsx`;
  await wb.xlsx.writeFile(chemin);
  for (const passage of [1, 2]) {
    await aller("/import");
    await page.setInputFiles("input[name=fichier]", chemin);
    await Promise.all([page.waitForURL(/\/import\/[0-9a-f-]{36}/), page.click("form button[type=submit]")]);
    await page.fill("input[name=date_reprise]", "2026-09-30");
    await page.locator("button", { hasText: "Enregistrer et calculer l'aperçu" }).click();
    const apercu = await message();
    if (passage === 1) {
      verifier(apercu.includes("3 ligne(s) à importer") && apercu.includes("3 en quarantaine"), `aperçu : 3 à importer, 3 en quarantaine (${apercu})`);
      verifier((await page.locator("text=Divergence de caractéristiques").count()) === 1, "divergence de caractéristiques détectée sans fusion");
      verifier((await page.locator("text=Erreur de formule").count()) === 1, "erreur de formule #DIV/0! signalée");
      verifier((await page.locator("text=disponible négatif").count()) === 1, "disponible négatif signalé");
      await agirPuisVoir("Importer", "Import terminé");
      verifier(true, "import exécuté");
    } else {
      verifier(apercu.includes("0 ligne(s) à importer") && apercu.includes("3 doublon(s)"), `import répété : aucun doublon créé (${apercu})`);
    }
  }
  await aller("/operations?statut=soumis");
  verifier((await page.locator("tbody tr").count()) >= 3, "positions d'ouverture soumises à validation");
  await aller("/controles");
  verifier((await page.locator("text=Quarantaine des imports").count()) === 1 && (await page.locator("td", { hasText: "Divergence" }).count()) >= 1, "lignes en quarantaine visibles dans les anomalies");
  await capture("16_controles_apres_import");
  // Annulation de l'import puis réimport du même fichier (remplacement).
  await aller("/import");
  await page.locator("tbody a", { hasText: "base_titres_fictive.xlsx" }).last().click();
  await page.waitForURL(/\/import\/[0-9a-f-]{36}/);
  await page.locator("button", { hasText: "Annuler cet import" }).click();
  await page.waitForSelector("text=Import annulé", { timeout: 15000 });
  verifier((await page.locator("text=Import annulé").first().innerText()).length > 0, "import annulé");
  await aller("/instruments?q=IMP-");
  verifier((await page.locator("tbody tr").count()) === 0, "instruments créés par l'import supprimés");
  await aller("/import");
  await page.setInputFiles("input[name=fichier]", chemin);
  await Promise.all([page.waitForURL(/\/import\/[0-9a-f-]{36}/), page.click("form button[type=submit]")]);
  await page.fill("input[name=date_reprise]", "2026-09-30");
  await page.locator("button", { hasText: "Enregistrer et calculer l'aperçu" }).click();
  const reprise = await message();
  verifier(reprise.includes("3 ligne(s) à importer"), `après annulation, le fichier peut être réimporté (${reprise})`);
}

// 9. Téléphone ------------------------------------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
for (const [chemin, nom] of [["/", "20_mobile_tableau_de_bord"], ["/positions", "21_mobile_positions"]]) {
  await aller(chemin);
  await capture(nom);
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => document.documentElement.classList.add("dark"));
await aller("/");
await page.evaluate(() => document.documentElement.classList.add("dark"));
await capture("30_sombre_tableau_de_bord");

verifier(erreursPage.length === 0, `aucune erreur JavaScript dans les pages (${erreursPage.join(" | ")})`);
await navigateur.close();
console.log(`\nPARCOURS RÉUSSI : ${ok} vérifications passées.`);
