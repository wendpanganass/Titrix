/**
 * Reprise des données : analyse (aperçu, doublons, divergences, quarantaine) et exécution de l'import.
 * L'analyse ne modifie rien ; l'exécution refait l'analyse dans la même transaction.
 */
import "server-only";
import type { PoolClient } from "pg";
import { normaliserCode } from "@/lib/codes";
import type { Brut } from "@/lib/lecture-fichier";
import {
  cleImport,
  divergences,
  interpreterLigneTitre,
  lireDateBrute,
  lireNombreBrut,
  type CaracteristiquesComparees,
  type LigneTitre,
  type NatureImport,
} from "@/lib/import-regles";

export interface ImportEnBase {
  id: string;
  nom_fichier: string;
  nature: NatureImport;
  correspondance: { colonnes: Record<string, number | null>; dateReprise?: string; portefeuille?: string; devise?: string };
  lignes: { entetes: string[]; lignes: Brut[][]; feuille: string; feuilles: string[] };
  statut: string;
}

export type ActionLigne = "importer" | "doublon" | "quarantaine";
export interface LigneRapport {
  numero: number;
  action: ActionLigne;
  motif: string;
  resume: string;
  notes: string[];
}
export interface Rapport {
  lignes: LigneRapport[];
  totaux: Record<ActionLigne, number>;
  nouveauxInstruments: number;
  nouvellesPositions: number;
  erreurGlobale?: string;
}

function caracteristiques(l: LigneTitre): CaracteristiquesComparees {
  return {
    dateEcheance: l.dateEcheance,
    taux: l.taux,
    frequence: l.frequence,
    profil: l.profil,
    nominalUnitaire: l.nominalUnitaire,
    dateEmission: l.dateEmission,
  };
}

/** Lignes interprétées de la base titres, avec leurs clés d'import. */
function lignesTitres(imp: ImportEnBase) {
  const corr = imp.correspondance.colonnes;
  const defauts = { devise: imp.correspondance.devise || "XOF", portefeuille: imp.correspondance.portefeuille || "PF-INV" };
  const dateReprise = imp.correspondance.dateReprise ?? "";
  // Numéro de ligne affiché = numéro dans le fichier (en-tête = ligne 1).
  return imp.lignes.lignes.map((brut, k) => {
    const l = interpreterLigneTitre(k + 2, brut, corr, defauts);
    const cle = cleImport("base_titres", [l.codeInterne, l.suffixe, l.conservateur, l.compte, l.portefeuille, l.nominal, dateReprise]);
    return { l, cle };
  });
}

export async function analyserImport(c: PoolClient, imp: ImportEnBase): Promise<Rapport> {
  const totaux: Record<ActionLigne, number> = { importer: 0, doublon: 0, quarantaine: 0 };
  const sortie: LigneRapport[] = [];
  const corr = imp.correspondance.colonnes;
  if (!imp.correspondance.dateReprise && imp.nature === "base_titres")
    return { lignes: [], totaux, nouveauxInstruments: 0, nouvellesPositions: 0, erreurGlobale: "Indiquez la date de reprise (date de la position d'ouverture)." };

  if (imp.nature === "encaissements") {
    for (const [k, brut] of imp.lignes.lignes.entries()) {
      const v = (cle: string) => (corr[cle] === null || corr[cle] === undefined ? null : (brut[corr[cle]!] ?? null));
      const code = normaliserCode(String(v("code") ?? ""));
      const conservateur = String(v("conservateur") ?? "").trim();
      const compte = String(v("compte") ?? "").trim();
      const date = lireDateBrute(v("date_valeur"));
      const montant = lireNombreBrut(v("montant"));
      const reference = String(v("reference") ?? "").trim();
      const numero = k + 2;
      const cle = cleImport("encaissements", [code, conservateur, compte, date, montant, reference]);
      const resume = `${code} · ${conservateur} · ${date ?? "?"} · ${montant ?? "?"}`;
      if (!code || !conservateur || !date || !montant || montant <= 0) {
        sortie.push({ numero, action: "quarantaine", motif: "Code, conservateur, date de valeur ou montant manquant / illisible", resume, notes: [] });
        totaux.quarantaine++;
        continue;
      }
      if ((await c.query("select 1 from encaissements where cle_import = $1", [cle])).rowCount || sortie.some((x) => x.resume === resume && x.action === "importer")) {
        sortie.push({ numero, action: "doublon", motif: "Déjà importé", resume, notes: [] });
        totaux.doublon++;
        continue;
      }
      const e = await c.query<{ id: string }>(
        `select e.id from echeances e join positions p on p.id = e.position_id join instruments i on i.id = p.instrument_id
           join conservateurs cs on cs.id = p.conservateur_id
          where (i.code_interne = $1 or i.isin = $1) and lower(cs.nom) = lower($2) and ($3 = '' or p.compte_conservation = $3)
            and abs(e.date_reglement_prevue - $4::date) <= 31 and e.statut_manuel is null
            and e.net_attendu - coalesce((select sum(montant) from encaissements x where x.echeance_id = e.id and x.statut = 'actif'), 0) > 0.005
          order by abs(e.date_reglement_prevue - $4::date) limit 1`,
        [code, conservateur, compte, date],
      );
      if (!e.rows[0]) {
        sortie.push({ numero, action: "quarantaine", motif: "Aucune échéance rapprochable (position introuvable ou pas d'échéance à ±31 jours)", resume, notes: [] });
        totaux.quarantaine++;
      } else {
        sortie.push({ numero, action: "importer", motif: "", resume, notes: [`Rapproché de l'échéance ${e.rows[0].id.slice(0, 8)}`] });
        totaux.importer++;
      }
    }
    return { lignes: sortie, totaux, nouveauxInstruments: 0, nouvellesPositions: 0 };
  }

  // Base titres.
  const lignes = lignesTitres(imp);
  const existants = await c.query<{ code_interne: string; isin: string | null; date_echeance: string | null; taux_coupon: number; frequence: number; profil: string; nominal_unitaire: number | null; date_emission: string | null }>(
    "select code_interne, isin, date_echeance, taux_coupon, frequence, profil, nominal_unitaire, date_emission from instruments",
  );
  const parCode = new Map<string, CaracteristiquesComparees>();
  for (const i of existants.rows) {
    const car = { dateEcheance: i.date_echeance, taux: i.taux_coupon, frequence: i.frequence, profil: i.profil, nominalUnitaire: i.nominal_unitaire, dateEmission: i.date_emission };
    parCode.set(i.code_interne, car);
    if (i.isin) parCode.set(i.isin, car);
  }
  const clesExistantes = new Set(
    (await c.query<{ cle_import: string }>("select cle_import from operations where cle_import = any($1)", [lignes.map((x) => x.cle)])).rows.map((r) => r.cle_import),
  );
  const premiereDuFichier = new Map<string, LigneTitre>();
  const clesVues = new Set<string>();
  const nouveaux = new Set<string>();
  const positions = new Set<string>();
  for (const { l, cle } of lignes) {
    const resume = `${l.codeInterne}${l.suffixe ? ` (${l.suffixe})` : ""} · ${l.conservateur || "?"} · ${l.nominal ?? "?"}`;
    const notes: string[] = [];
    if (l.erreurs.length) {
      sortie.push({ numero: l.numero, action: "quarantaine", motif: l.erreurs.join(" ; "), resume, notes });
      totaux.quarantaine++;
      continue;
    }
    if (clesExistantes.has(cle) || clesVues.has(cle)) {
      sortie.push({ numero: l.numero, action: "doublon", motif: clesVues.has(cle) ? "Ligne identique plus haut dans le fichier" : "Déjà importée (même position d'ouverture)", resume, notes });
      totaux.doublon++;
      continue;
    }
    // Divergences : avec le référentiel, sinon avec la première ligne du même code dans le fichier.
    const reference = parCode.get(l.codeInterne) ?? (premiereDuFichier.get(l.codeInterne) && caracteristiques(premiereDuFichier.get(l.codeInterne)!));
    const div = reference ? divergences(caracteristiques(l), reference) : [];
    if (div.length) {
      sortie.push({
        numero: l.numero,
        action: "quarantaine",
        motif: `Divergence de caractéristiques avec ${parCode.has(l.codeInterne) ? "le référentiel" : `la ligne ${premiereDuFichier.get(l.codeInterne)?.numero}`} (${div.join(" ; ")}) — aucune fusion automatique`,
        resume,
        notes,
      });
      totaux.quarantaine++;
      continue;
    }
    if (!premiereDuFichier.has(l.codeInterne)) premiereDuFichier.set(l.codeInterne, l);
    if (!parCode.has(l.codeInterne)) {
      nouveaux.add(l.codeInterne);
      notes.push("Nouvel instrument (à valider)");
      if (l.frequence === null) notes.push("Fréquence absente : annuelle par défaut, à vérifier");
      if (!l.convention) notes.push("Convention absente : paramètre général appliqué, à vérifier");
    }
    if (l.suffixe) notes.push(`Suffixe « ${l.suffixe} » conservé comme identifiant de position`);
    if (l.nominalGreve && l.beneficiaire) notes.push(`Grevage de ${l.nominalGreve} au profit de ${l.beneficiaire} (soumis)`);
    if (l.nominal === 0) notes.push("Encours nul : position créée sans opération");
    positions.add(`${l.codeInterne}|${l.conservateur}|${l.compte}|${l.portefeuille}`);
    clesVues.add(cle);
    sortie.push({ numero: l.numero, action: "importer", motif: "", resume, notes });
    totaux.importer++;
  }
  return { lignes: sortie, totaux, nouveauxInstruments: nouveaux.size, nouvellesPositions: positions.size };
}

async function trouverOuCreer(c: PoolClient, table: string, nom: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await c.query<{ id: string }>(`select id from ${table} where lower(nom) = lower($1)`, [nom]);
  if (r.rows[0]) return r.rows[0].id;
  const cols = ["nom", ...Object.keys(extra)];
  const ins = await c.query<{ id: string }>(
    `insert into ${table} (${cols.join(", ")}) values (${cols.map((_, k) => `$${k + 1}`).join(", ")}) returning id`,
    [nom, ...Object.values(extra)],
  );
  return ins.rows[0].id;
}

/** Exécute l'import (dans une transaction ouverte au nom de l'utilisateur). */
export async function executerImport(c: PoolClient, imp: ImportEnBase, utilisateurId: string, conventionDefaut: string): Promise<Rapport> {
  const rapport = await analyserImport(c, imp);
  if (rapport.erreurGlobale) return rapport;
  const actions = new Map(rapport.lignes.map((l) => [l.numero, l]));
  const corr = imp.correspondance.colonnes;
  const quarantaine = async (numero: number, motif: string) => {
    const brut = imp.lignes.lignes[numero - 2] ?? [];
    const donnees = Object.fromEntries(imp.lignes.entetes.map((e, i) => [e, brut[i] ?? null]));
    await c.query("insert into quarantaine (import_id, numero_ligne, donnees, motif) values ($1,$2,$3,$4)", [imp.id, numero, JSON.stringify(donnees), motif]);
  };

  if (imp.nature === "encaissements") {
    for (const [k, brut] of imp.lignes.lignes.entries()) {
      const numero = k + 2;
      const a = actions.get(numero);
      if (!a) continue;
      if (a.action === "quarantaine") await quarantaine(numero, a.motif);
      if (a.action !== "importer") continue;
      const v = (cle: string) => (corr[cle] === null || corr[cle] === undefined ? null : (brut[corr[cle]!] ?? null));
      const code = normaliserCode(String(v("code") ?? ""));
      const conservateur = String(v("conservateur") ?? "").trim();
      const compte = String(v("compte") ?? "").trim();
      const date = lireDateBrute(v("date_valeur"))!;
      const montant = lireNombreBrut(v("montant"))!;
      const reference = String(v("reference") ?? "").trim();
      const e = await c.query<{ id: string; position_id: string }>(
        `select e.id, e.position_id from echeances e join positions p on p.id = e.position_id join instruments i on i.id = p.instrument_id
           join conservateurs cs on cs.id = p.conservateur_id
          where (i.code_interne = $1 or i.isin = $1) and lower(cs.nom) = lower($2) and ($3 = '' or p.compte_conservation = $3)
            and abs(e.date_reglement_prevue - $4::date) <= 31 and e.statut_manuel is null
            and e.net_attendu - coalesce((select sum(montant) from encaissements x where x.echeance_id = e.id and x.statut = 'actif'), 0) > 0.005
          order by abs(e.date_reglement_prevue - $4::date) limit 1`,
        [code, conservateur, compte, date],
      );
      await c.query(
        "insert into encaissements (position_id, echeance_id, date_valeur, montant, reference, commentaire, cle_import, import_id) values ($1,$2,$3,$4,$5,$6,$7,$8)",
        [e.rows[0].position_id, e.rows[0].id, date, montant, reference, `Import ${imp.nom_fichier} ligne ${numero}`, cleImport("encaissements", [code, conservateur, compte, date, montant, reference]), imp.id],
      );
    }
  } else {
    const dateReprise = imp.correspondance.dateReprise!;
    for (const { l, cle } of lignesTitres(imp)) {
      const a = actions.get(l.numero);
      if (!a) continue;
      if (a.action === "quarantaine") await quarantaine(l.numero, a.motif);
      if (a.action !== "importer") continue;
      // Référentiels : retrouvés par leur nom, créés au besoin (traçés par l'audit).
      const conservateurId = await trouverOuCreer(c, "conservateurs", l.conservateur);
      let pf = await c.query<{ id: string }>("select id from portefeuilles where lower(code) = lower($1) or lower(libelle) = lower($1)", [l.portefeuille]);
      if (!pf.rows[0]) pf = await c.query<{ id: string }>("insert into portefeuilles (code, libelle) values ($1, $2) returning id", [normaliserCode(l.portefeuille).slice(0, 20) || "PF", l.portefeuille]);
      const pays = l.pays
        ? (await c.query<{ code: string }>("select code from pays where upper(code) = upper($1) or lower(nom) = lower($1)", [l.pays])).rows[0]?.code ?? null
        : null;
      const emetteurId = l.emetteur ? await trouverOuCreer(c, "emetteurs", l.emetteur, { pays_code: pays }) : null;
      let typeCode: string | null = null;
      if (l.type) {
        const t = await c.query<{ code: string }>("select code from types_instrument where upper(code) = upper($1) or lower(libelle) = lower($1)", [l.type]);
        typeCode = t.rows[0]?.code ?? null;
        if (!typeCode) {
          typeCode = normaliserCode(l.type).slice(0, 12) || "AUTRE";
          await c.query("insert into types_instrument (code, libelle, precompte) values ($1,$2,$3) on conflict (code) do nothing", [typeCode, l.type, /\b(bon|bons|bat|btr|bill)/i.test(l.type)]);
        }
      }
      await c.query("insert into devises (code, libelle) values ($1, $1) on conflict (code) do nothing", [l.devise]);
      let inst = await c.query<{ id: string }>("select id from instruments where code_interne = $1 or isin = $1", [l.codeInterne]);
      if (!inst.rows[0]) {
        const precompte = typeCode ? (await c.query<{ precompte: boolean }>("select precompte from types_instrument where code = $1", [typeCode])).rows[0]?.precompte ?? false : false;
        inst = await c.query<{ id: string }>(
          `insert into instruments (code_interne, isin, libelle, emetteur_id, pays_code, zone, type_code, devise_code, nominal_unitaire, date_emission,
                                    date_echeance, taux_coupon, convention, frequence, profil, differe_mois, precompte, conditions_remboursement)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
          [l.codeInterne, l.isin, l.libelle, emetteurId, pays, l.zone, typeCode, l.devise, l.nominalUnitaire, l.dateEmission, l.dateEcheance,
            precompte ? 0 : (l.taux ?? 0), l.convention ?? conventionDefaut, precompte ? 0 : (l.frequence ?? 1), l.profil ?? "in_fine", l.differeMois, precompte,
            `Repris du fichier ${imp.nom_fichier}`],
        );
      }
      const instrumentId = inst.rows[0].id;
      let pos = await c.query<{ id: string }>(
        "select id from positions where portefeuille_id = $1 and instrument_id = $2 and conservateur_id = $3 and compte_conservation = $4",
        [pf.rows[0].id, instrumentId, conservateurId, l.compte],
      );
      if (!pos.rows[0])
        pos = await c.query<{ id: string }>(
          "insert into positions (portefeuille_id, instrument_id, conservateur_id, compte_conservation, identifiant_position, cree_par) values ($1,$2,$3,$4,$5,$6) returning id",
          [pf.rows[0].id, instrumentId, conservateurId, l.compte, String(l.brut.code ?? ""), utilisateurId],
        );
      const positionId = pos.rows[0].id;
      if (l.nominal && l.nominal > 0)
        await c.query(
          `insert into operations (type, position_id, date_effet, nominal, quantite, reference, commentaire, statut, cle_import, import_id)
           values ('position_ouverture',$1,$2,$3,$4,$5,'Position d''ouverture : historique antérieur non reconstitué','soumis',$6,$7)`,
          [positionId, dateReprise, l.nominal, l.quantite, `Reprise ${imp.nom_fichier} ligne ${l.numero}`, cle, imp.id],
        );
      if (l.classification)
        await c.query(
          "insert into classifications (instrument_id, position_id, referentiel, valeur, date_effet, source, saisi_par) values ($1,$2,'comptable',$3,$4,$5,$6)",
          [instrumentId, positionId, l.classification, dateReprise, `Import ${imp.nom_fichier}`, utilisateurId],
        );
      if (l.beneficiaire && l.nominalGreve && l.nominalGreve > 0) {
        const benef = await trouverOuCreer(c, "contreparties", l.beneficiaire, { role: "beneficiaire" });
        const g = await c.query<{ id: string }>(
          "insert into grevages (position_id, beneficiaire_id, nominal_affecte, date_debut, reference_convention, commentaire, statut) values ($1,$2,$3,$4,$5,$6,'soumis') returning id",
          [positionId, benef, l.nominalGreve, dateReprise, "Reprise", `Import ${imp.nom_fichier} ligne ${l.numero} — à valider après la position d'ouverture`],
        );
        await c.query("insert into mouvements_grevage (grevage_id, type, nominal_avant, nominal_apres, date, motif, auteur_id) values ($1,'creation',0,$2,$3,'Reprise',$4)", [
          g.rows[0].id, l.nominalGreve, dateReprise, utilisateurId,
        ]);
      }
    }
  }
  await c.query(
    "update imports set statut = 'importe', rapport = $2, nb_lignes = $3, nb_importees = $4, nb_doublons = $5, nb_quarantaine = $6, importe_le = now() where id = $1",
    [imp.id, JSON.stringify(rapport), rapport.lignes.length, rapport.totaux.importer, rapport.totaux.doublon, rapport.totaux.quarantaine],
  );
  return rapport;
}
