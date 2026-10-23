/**
 * Jeu de démonstration FICTIF : « Banque Démo », émetteurs, conservateurs et titres inventés.
 *
 * Tout passe par les mêmes règles que l'utilisation réelle : chaque élément est saisi par
 * « Gestionnaire Démo » et validé par « Validateur Démo » (deux comptes distincts), les échéances
 * sont calculées par le moteur, les encaissements rapprochés des échéances.
 * Les chiffres tiennent ensemble : encours, amortissements constatés, grevages ≤ disponible,
 * et quelques anomalies volontaires pour montrer les alertes (retard, écart, titre échu…).
 */
import "server-only";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { ajouterJours, interetNet, ventilerEncaissement } from "@/moteur";
import { regenererEcheances } from "./echeances";
import { journaliser } from "./journal";

const GESTION = "gestionnaire.demo@titrix.demo";
const VALIDATION = "validateur.demo@titrix.demo";

function motDePasse(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let m = "Demo" + String(randomInt(10, 99));
  for (let i = 0; i < 8; i++) m += a[randomInt(a.length)];
  return m;
}

async function agir(c: PoolClient, utilisateurId: string) {
  await c.query("select set_config('app.utilisateur_id', $1, true)", [utilisateurId]);
}

async function id(c: PoolClient, sql: string, params: unknown[]): Promise<string> {
  const r = await c.query<{ id: string }>(sql, params);
  return r.rows[0].id;
}

export interface ResultatDemo {
  instruments: number;
  positions: number;
  operations: number;
  encaissements: number;
  comptes: { email: string; motDePasse: string }[];
}

/** Charge le jeu de démonstration (dans une transaction ouverte par l'appelant). */
export async function chargerJeuDemonstration(c: PoolClient, admin: { id: string; nom: string }, aujourdhui: string): Promise<ResultatDemo> {
  const existe = await c.query<{ n: number }>("select count(*)::int as n from instruments");
  if (existe.rows[0].n > 0) throw new Error("DEMO_BASE_NON_VIDE");

  // 1. Deux comptes fictifs pour la validation à quatre yeux (mots de passe provisoires).
  const comptes: { email: string; motDePasse: string }[] = [];
  const creerCompte = async (email: string, nom: string, roles: string[]) => {
    const deja = await c.query<{ id: string; actif: boolean }>("select id, actif from utilisateurs where lower(email) = $1", [email]);
    if (deja.rows[0]?.actif) return deja.rows[0].id;
    const mdp = motDePasse();
    comptes.push({ email, motDePasse: mdp });
    if (deja.rows[0]) {
      // Compte fictif désactivé par un nettoyage précédent : réactivé avec un nouveau mot de passe provisoire.
      await c.query("update utilisateurs set actif = true, roles = $2, mot_de_passe_hash = $3, doit_changer_mdp = true where id = $1", [
        deja.rows[0].id,
        roles,
        await bcrypt.hash(mdp, 10),
      ]);
      return deja.rows[0].id;
    }
    return id(c, "insert into utilisateurs (email, nom, roles, mot_de_passe_hash, doit_changer_mdp) values ($1,$2,$3,$4,true) returning id", [
      email,
      nom,
      roles,
      await bcrypt.hash(mdp, 10),
    ]);
  };
  const g = await creerCompte(GESTION, "Gestionnaire Démo", ["gestionnaire", "back_office"]);
  const v = await creerCompte(VALIDATION, "Validateur Démo", ["validateur", "comptabilite", "risques"]);

  // 2. Référentiels fictifs.
  await agir(c, admin.id);
  await c.query("update parametres set valeur = 'Banque Démo SA' where cle = 'nom_etablissement' and valeur in ('', 'Établissement')");
  const conservateur = async (nom: string, code: string) =>
    id(c, "insert into conservateurs (nom, code) values ($1,$2) on conflict (nom) do update set code = excluded.code returning id", [nom, code]);
  const ouaga = await conservateur("SGI Démo Ouaga", "SGI-OUA");
  const abidjan = await conservateur("SGI Démo Abidjan", "SGI-ABJ");
  const central = await conservateur("Dépositaire central Démo", "DC-DEMO");
  const emetteur = async (nom: string, pays: string, secteur: string) =>
    id(c, "insert into emetteurs (nom, pays_code, secteur) values ($1,$2,$3) on conflict (nom) do update set pays_code = excluded.pays_code returning id", [nom, pays, secteur]);
  const eBF = await emetteur("État Démo Burkina", "BF", "Souverain");
  const eCI = await emetteur("État Démo Côte d'Ivoire", "CI", "Souverain");
  const eSN = await emetteur("État Démo Sénégal", "SN", "Souverain");
  const eML = await emetteur("État Démo Mali", "ML", "Souverain");
  const eEN = await emetteur("Société Démo Énergie", "BF", "Énergie");
  const contrepartie = async (nom: string, role: string) =>
    id(c, "insert into contreparties (nom, role) values ($1,$2) on conflict (nom) do update set role = excluded.role returning id", [nom, role]);
  const bc = await contrepartie("Banque centrale (démo)", "beneficiaire");
  const partenaire = await contrepartie("Banque Partenaire Démo", "les_deux");
  const courtier = await contrepartie("Courtier Démo", "contrepartie");
  const pfInv = await id(
    c,
    "insert into portefeuilles (code, libelle) values ('PF-INV', 'Portefeuille d''investissement') on conflict (code) do update set libelle = excluded.libelle returning id",
    [],
  );
  const pfLiq = await id(c, "insert into portefeuilles (code, libelle) values ('PF-LIQ', 'Portefeuille de liquidité') on conflict (code) do update set libelle = excluded.libelle returning id", []);
  for (const [d, l] of [
    ["2026-01-01", "Jour de l'an"],
    ["2026-03-08", "Journée internationale de la femme"],
    ["2026-05-01", "Fête du travail"],
    ["2026-08-05", "Fête de l'indépendance"],
    ["2026-11-01", "Toussaint"],
    ["2026-12-11", "Fête nationale"],
    ["2026-12-25", "Noël"],
  ])
    await c.query("insert into jours_feries (date, libelle) values ($1,$2) on conflict (date) do nothing", [d, l]);

  // 3. Instruments saisis par le gestionnaire, validés par le validateur.
  await agir(c, g);
  const echBATCI = ajouterJours(aujourdhui, 20); // échéance proche : alerte J-30 et titre grevé proche de l'échéance
  const instrument = async (o: {
    code: string; libelle: string; emetteur: string; pays: string; type: string; nominal: number; emission: string; echeance: string;
    taux: number; frequence: number; profil: string; differe?: number; precompte?: boolean; retenue?: number; convention?: string;
  }) =>
    id(
      c,
      `insert into instruments (code_interne, libelle, emetteur_id, pays_code, zone, type_code, devise_code, nominal_unitaire, date_emission,
         date_echeance, taux_coupon, convention, frequence, profil, differe_mois, precompte, taux_retenue, conditions_remboursement)
       values ($1,$2,$3,$4,'UEMOA',$5,'XOF',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Données fictives de démonstration') returning id`,
      [o.code, o.libelle, o.emetteur, o.pays, o.type, o.nominal, o.emission, o.echeance, o.taux, o.convention ?? "ACT/365", o.frequence, o.profil,
        o.differe ?? 0, o.precompte ?? false, o.retenue ?? 0],
    );
  const iBF29 = await instrument({ code: "DEMO-OAT-BF-2029", libelle: "OAT Démo Burkina 6,50 % 2024-2029", emetteur: eBF, pays: "BF", type: "OAT", nominal: 10000, emission: "2024-03-15", echeance: "2029-03-15", taux: 0.065, frequence: 1, profil: "constant", differe: 24 });
  const iCI31 = await instrument({ code: "DEMO-OAT-CI-2031", libelle: "OAT Démo Côte d'Ivoire 5,90 % 2021-2031", emetteur: eCI, pays: "CI", type: "OAT", nominal: 10000, emission: "2021-06-01", echeance: "2031-06-01", taux: 0.059, frequence: 2, profil: "in_fine", convention: "ACT/ACT" });
  const iSN28 = await instrument({ code: "DEMO-OAT-SN-2028", libelle: "OAT Démo Sénégal 6,25 % 2023-2028", emetteur: eSN, pays: "SN", type: "OAT", nominal: 10000, emission: "2023-05-20", echeance: "2028-05-20", taux: 0.0625, frequence: 1, profil: "constant", differe: 12 });
  const iML27 = await instrument({ code: "DEMO-OAT-ML-2027", libelle: "OAT Démo Mali 6,20 % 2022-2027", emetteur: eML, pays: "ML", type: "OAT", nominal: 10000, emission: "2022-02-10", echeance: "2027-02-10", taux: 0.062, frequence: 1, profil: "in_fine" });
  const iBF26 = await instrument({ code: "DEMO-OAT-BF-2026", libelle: "OAT Démo Burkina 6,00 % 2019-2026", emetteur: eBF, pays: "BF", type: "OAT", nominal: 10000, emission: "2019-07-01", echeance: "2026-07-01", taux: 0.06, frequence: 1, profil: "in_fine" });
  const iBATBF = await instrument({ code: "DEMO-BAT-BF-2027", libelle: "Bon Démo Burkina 364 jours 2026-2027", emetteur: eBF, pays: "BF", type: "BAT", nominal: 1000000, emission: "2026-04-02", echeance: "2027-04-01", taux: 0, frequence: 0, profil: "in_fine", precompte: true });
  const iBATCI = await instrument({ code: "DEMO-BAT-CI-COURT", libelle: "Bon Démo Côte d'Ivoire 364 jours", emetteur: eCI, pays: "CI", type: "BAT", nominal: 1000000, emission: ajouterJours(echBATCI, -364), echeance: echBATCI, taux: 0, frequence: 0, profil: "in_fine", precompte: true });
  const iENR = await instrument({ code: "DEMO-OBS-ENR-2030", libelle: "Obligation Démo Énergie 7,00 % 2025-2030", emetteur: eEN, pays: "BF", type: "OBS", nominal: 10000, emission: "2025-01-15", echeance: "2030-01-15", taux: 0.07, frequence: 2, profil: "constant", differe: 12, retenue: 0.06 });
  const instruments = [iBF29, iCI31, iSN28, iML27, iBF26, iBATBF, iBATCI, iENR];
  await agir(c, v);
  for (const i of instruments) await c.query("update instruments set statut = 'valide' where id = $1", [i]);
  await agir(c, g);
  for (const [i, valeur] of [[iBF29, "Coût amorti"], [iCI31, "Coût amorti"], [iSN28, "Coût amorti"], [iBF26, "Coût amorti"], [iENR, "Coût amorti"], [iML27, "Juste valeur par capitaux propres"], [iBATBF, "Juste valeur par capitaux propres"], [iBATCI, "Juste valeur par capitaux propres"]])
    await c.query("insert into classifications (instrument_id, referentiel, valeur, date_effet, source, saisi_par) values ($1,'comptable',$2,'2025-01-01','Démonstration',$3)", [i, valeur, g]);
  for (const [i, valeur] of [[iBF29, "B"], [iCI31, "BB-"], [iSN28, "B+"], [iML27, "CCC+"], [iENR, "BB"]])
    await c.query("insert into classifications (instrument_id, referentiel, valeur, date_effet, source, saisi_par) values ($1,'notation',$2,'2025-06-30','Agence fictive',$3)", [i, valeur, g]);

  // 4. Positions (un même titre chez deux conservateurs) et opérations.
  const position = async (pf: string, i: string, cons: string, compte: string) =>
    id(c, "insert into positions (portefeuille_id, instrument_id, conservateur_id, compte_conservation, cree_par) values ($1,$2,$3,$4,$5) returning id", [pf, i, cons, compte, g]);
  const pBF29 = await position(pfInv, iBF29, ouaga, "OUA-000117");
  const pBF29b = await position(pfInv, iBF29, central, "DC-552301");
  const pCI31 = await position(pfInv, iCI31, abidjan, "ABJ-004410");
  const pCI31b = await position(pfInv, iCI31, central, "DC-552301");
  const pSN28 = await position(pfInv, iSN28, abidjan, "ABJ-004410");
  const pML27 = await position(pfLiq, iML27, ouaga, "OUA-000118");
  const pBF26 = await position(pfInv, iBF26, ouaga, "OUA-000117");
  const pBATBF = await position(pfLiq, iBATBF, central, "DC-552302");
  const pBATCI = await position(pfLiq, iBATCI, abidjan, "ABJ-004411");
  const pENR = await position(pfInv, iENR, ouaga, "OUA-000117");
  const positions = [pBF29, pBF29b, pCI31, pCI31b, pSN28, pML27, pBF26, pBATBF, pBATCI, pENR];

  let nbOps = 0;
  const operation = async (o: {
    type: string; position: string; date: string; nominal: number; quantite?: number; prix?: number; contrepartie?: string;
    destination?: string; echeance?: string; reference: string; statut?: string; dateNegociation?: string;
  }) => {
    nbOps++;
    const achatVente = o.type === "acquisition" || o.type === "cession";
    return id(
      c,
      `insert into operations (type, position_id, position_destination_id, date_effet, date_negociation, date_reglement, quantite, nominal, prix,
         contrepartie_id, echeance_id, montant_regle, reference, commentaire, statut)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Démonstration',$14) returning id`,
      [o.type, o.position, o.destination ?? null, o.date, achatVente ? (o.dateNegociation ?? ajouterJours(o.date, -2)) : null, achatVente ? o.date : null,
        o.quantite ?? null, o.nominal, o.prix ?? null, o.contrepartie ?? null, o.echeance ?? null,
        achatVente && o.prix ? Math.round((o.nominal * o.prix) / 100) : null, o.reference, o.statut ?? "soumis"],
    );
  };
  const aValider: string[] = [];
  aValider.push(await operation({ type: "acquisition", position: pBF29, date: "2024-03-15", nominal: 5_000_000_000, quantite: 500_000, prix: 100, contrepartie: partenaire, reference: "AVIS-2024-031" }));
  aValider.push(await operation({ type: "transfert", position: pBF29, destination: pBF29b, date: "2025-06-30", nominal: 1_000_000_000, quantite: 100_000, reference: "TRF-2025-014" }));
  aValider.push(await operation({ type: "acquisition", position: pCI31, date: "2023-09-12", nominal: 3_000_000_000, quantite: 300_000, prix: 98.75, contrepartie: courtier, reference: "AVIS-2023-088" }));
  aValider.push(await operation({ type: "position_ouverture", position: pCI31b, date: "2025-12-31", nominal: 1_500_000_000, quantite: 150_000, reference: "Reprise classeur 31/12/2025" }));
  aValider.push(await operation({ type: "acquisition", position: pSN28, date: "2023-05-20", nominal: 2_000_000_000, quantite: 200_000, prix: 100, contrepartie: partenaire, reference: "AVIS-2023-041" }));
  aValider.push(await operation({ type: "acquisition", position: pML27, date: "2022-03-01", nominal: 1_500_000_000, quantite: 150_000, prix: 99.1, contrepartie: courtier, reference: "AVIS-2022-019" }));
  aValider.push(await operation({ type: "cession", position: pML27, date: "2025-10-15", nominal: 500_000_000, quantite: 50_000, prix: 100.4, contrepartie: partenaire, reference: "AVIS-2025-102" }));
  aValider.push(await operation({ type: "position_ouverture", position: pBF26, date: "2025-12-31", nominal: 700_000_000, quantite: 70_000, reference: "Reprise classeur 31/12/2025" }));
  aValider.push(await operation({ type: "acquisition", position: pBATBF, date: "2026-04-02", nominal: 2_000_000_000, quantite: 2_000, prix: 94.2, contrepartie: bc, reference: "ADJ-BAT-2026-07" }));
  aValider.push(await operation({ type: "acquisition", position: pBATCI, date: ajouterJours(echBATCI, -364), nominal: 1_000_000_000, quantite: 1_000, prix: 95.1, contrepartie: bc, reference: "ADJ-BAT-CI" }));
  aValider.push(await operation({ type: "acquisition", position: pENR, date: "2025-01-15", nominal: 800_000_000, quantite: 80_000, prix: 100, contrepartie: courtier, reference: "AVIS-2025-006" }));
  await agir(c, v);
  for (const o of aValider) await c.query("update operations set statut = 'valide' where id = $1", [o]);
  for (const p of positions) await regenererEcheances(c, p);

  // 5. Amortissements constatés (Sénégal 2025 et 2026, Énergie) : liés à leur échéance.
  await agir(c, g);
  const amortissements: string[] = [];
  const ech = await c.query<{ id: string; position_id: string; date_contractuelle: string; capital_du: number }>(
    "select id, position_id, date_contractuelle, capital_du from echeances where position_id = any($1) and capital_du > 0 and date_contractuelle <= $2 order by date_contractuelle",
    [[pSN28, pENR], aujourdhui],
  );
  for (const e of ech.rows)
    amortissements.push(
      await operation({ type: "amortissement", position: e.position_id, date: e.date_contractuelle, nominal: e.capital_du, echeance: e.id, reference: `AMORT-${e.date_contractuelle}` }),
    );
  await agir(c, v);
  for (const o of amortissements) await c.query("update operations set statut = 'valide' where id = $1", [o]);
  for (const p of [pSN28, pENR]) await regenererEcheances(c, p);

  // 6. Encaissements des échéances passées, avec trois anomalies volontaires.
  await agir(c, g);
  const passees = await c.query<{ id: string; position_id: string; date_contractuelle: string; date_reglement_prevue: string; net_attendu: number; interet_brut: number; retenue: number }>(
    "select id, position_id, date_contractuelle, date_reglement_prevue, net_attendu, interet_brut, retenue from echeances where date_reglement_prevue <= $1 order by date_reglement_prevue",
    [aujourdhui],
  );
  let nbEnc = 0;
  for (const e of passees.rows) {
    // Ventilation par défaut : intérêts nets en premier, le solde en capital.
    let { capital, interet } = ventilerEncaissement(e.net_attendu, interetNet({ interetBrut: e.interet_brut, retenue: e.retenue }));
    let reference = `AVIS-CREDIT-${e.date_reglement_prevue}`;
    if (e.position_id === pML27 && e.date_contractuelle === "2026-02-10") continue; // coupon non reçu : en retard
    if (e.position_id === pBF26 && e.date_contractuelle === "2026-07-01") {
      capital = 0; // coupon reçu, capital non remboursé : titre échu à recouvrer
      reference = "AVIS-CREDIT-COUPON-SEUL";
    }
    if (e.position_id === pSN28 && e.date_contractuelle === "2026-05-20") interet = Math.max(0, interet - 150_000); // intérêts incomplets : écart non expliqué
    const montant = Math.round((capital + interet) * 100) / 100;
    if (montant <= 0) continue;
    await c.query(
      `insert into encaissements (position_id, echeance_id, date_valeur, montant, montant_capital, montant_interet, nature, reference, commentaire)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'Démonstration')`,
      [e.position_id, e.id, e.date_reglement_prevue, montant, capital, interet, capital > 0 && interet > 0 ? "mixte" : capital > 0 ? "capital" : "interet", reference],
    );
    nbEnc++;
  }

  // 7. Grevages : deux actifs (dont un sur un titre proche de l'échéance), un en attente de validation.
  const grevage = async (pos: string, nominal: number, debut: string, o: { decote?: number; financement?: number; convention: string }) => {
    const gid = await id(
      c,
      `insert into grevages (position_id, beneficiaire_id, nominal_affecte, decote_pct, valeur_retenue, financement_obtenu, date_debut, reference_convention, commentaire, statut)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'Démonstration','soumis') returning id`,
      [pos, bc, nominal, o.decote ?? null, o.decote ? Math.round(nominal * (1 - o.decote)) : null, o.financement ?? null, debut, o.convention],
    );
    await c.query("insert into mouvements_grevage (grevage_id, type, nominal_avant, nominal_apres, date, motif, auteur_id) values ($1,'creation',0,$2,$3,'Démonstration',$4)", [gid, nominal, debut, g]);
    return gid;
  };
  const g1 = await grevage(pBF29, 2_500_000_000, "2026-01-15", { decote: 0.1, financement: 2_000_000_000, convention: "PENSION-BC-2026-01" });
  const g2 = await grevage(pBATCI, 800_000_000, ajouterJours(echBATCI, -120), { decote: 0.05, financement: 700_000_000, convention: "PENSION-BC-COURT" });
  await grevage(pCI31, 1_000_000_000, ajouterJours(aujourdhui, -2), { decote: 0.1, financement: 850_000_000, convention: "PENSION-BC-EN-COURS" });
  await agir(c, v);
  for (const x of [g1, g2]) await c.query("update grevages set statut = 'actif' where id = $1", [x]);

  // 8. Opérations en attente (file de validation) et relevés des conservateurs (un écart).
  await agir(c, g);
  await operation({ type: "acquisition", position: pCI31, date: ajouterJours(aujourdhui, -3), nominal: 500_000_000, quantite: 50_000, prix: 101.2, contrepartie: courtier, reference: "AVIS-EN-ATTENTE" });
  await operation({ type: "cession", position: pBATBF, date: ajouterJours(aujourdhui, 2), nominal: 500_000_000, quantite: 500, prix: 97.6, contrepartie: partenaire, reference: "PROJET-CESSION", statut: "brouillon" });
  await c.query("update positions set nominal_releve = 3000000000, date_releve = $2 where id = $1", [pCI31, ajouterJours(aujourdhui, -10)]);
  await c.query("update positions set nominal_releve = 4000000000, date_releve = $2 where id = $1", [pBF29, ajouterJours(aujourdhui, -10)]);
  await c.query("update positions set nominal_releve = 1050000000, date_releve = $2 where id = $1", [pBF29b, ajouterJours(aujourdhui, -10)]);

  await agir(c, admin.id);
  await journaliser(c, { u: admin }, "Données de démonstration chargées", "demonstration", "", { instruments: instruments.length, positions: positions.length });
  return { instruments: instruments.length, positions: positions.length, operations: nbOps, encaissements: nbEnc, comptes };
}
