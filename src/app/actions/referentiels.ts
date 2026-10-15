"use server";
/**
 * Administration des référentiels et des paramètres (REF-02).
 * Une seule action générique, limitée à une liste blanche de tables et de colonnes.
 */
import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { exigerPermission, ErreurMetier } from "@/lib/session";
import { lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { regenererEcheances } from "@/donnees/echeances";
import { erreur, ok, type Retour } from "./commun";

type TypeColonne = "texte" | "entier" | "booleen" | "date" | "uuid" | "code";
interface Definition {
  libelle: string;
  cle: string; // colonne identifiant
  cleAuto: boolean; // identifiant généré par la base
  colonnes: Record<string, { type: TypeColonne; obligatoire?: boolean }>;
}

const TABLES: Record<string, Definition> = {
  emetteurs: { libelle: "Émetteur", cle: "id", cleAuto: true, colonnes: { nom: { type: "texte", obligatoire: true }, pays_code: { type: "code" }, secteur: { type: "texte" }, actif: { type: "booleen" } } },
  conservateurs: { libelle: "Conservateur", cle: "id", cleAuto: true, colonnes: { nom: { type: "texte", obligatoire: true }, code: { type: "texte" }, actif: { type: "booleen" } } },
  contreparties: { libelle: "Contrepartie / bénéficiaire", cle: "id", cleAuto: true, colonnes: { nom: { type: "texte", obligatoire: true }, role: { type: "texte", obligatoire: true }, actif: { type: "booleen" } } },
  entites: { libelle: "Entité", cle: "id", cleAuto: true, colonnes: { nom: { type: "texte", obligatoire: true } } },
  portefeuilles: { libelle: "Portefeuille", cle: "id", cleAuto: true, colonnes: { code: { type: "texte", obligatoire: true }, libelle: { type: "texte", obligatoire: true }, entite_id: { type: "uuid" }, actif: { type: "booleen" } } },
  pays: { libelle: "Pays", cle: "code", cleAuto: false, colonnes: { code: { type: "code", obligatoire: true }, nom: { type: "texte", obligatoire: true }, zone: { type: "texte" } } },
  devises: { libelle: "Devise", cle: "code", cleAuto: false, colonnes: { code: { type: "code", obligatoire: true }, libelle: { type: "texte", obligatoire: true }, decimales: { type: "entier" } } },
  types_instrument: { libelle: "Type d'instrument", cle: "code", cleAuto: false, colonnes: { code: { type: "code", obligatoire: true }, libelle: { type: "texte", obligatoire: true }, precompte: { type: "booleen" } } },
  tranches_maturite: { libelle: "Tranche de maturité", cle: "id", cleAuto: true, colonnes: { libelle: { type: "texte", obligatoire: true }, borne_min: { type: "entier", obligatoire: true }, borne_max: { type: "entier" }, ordre: { type: "entier" } } },
  jours_feries: { libelle: "Jour férié", cle: "date", cleAuto: false, colonnes: { date: { type: "date", obligatoire: true }, libelle: { type: "texte" } } },
};

function valeur(type: TypeColonne, brut: FormDataEntryValue | null, present: boolean): unknown {
  const t = lireTexte(brut);
  switch (type) {
    case "booleen":
      return present ? brut === "on" || brut === "true" : false;
    case "entier":
      return t === "" ? null : Number.isInteger(Number(t)) ? Number(t) : NaN;
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
    case "uuid":
      return t === "" ? null : t;
    case "code":
      return t === "" ? null : t.toUpperCase();
    default:
      return t;
  }
}

export async function enregistrerReferentiel(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_referentiels");
    const table = lireTexte(f.get("_table"));
    const def = TABLES[table];
    if (!def) throw new ErreurMetier("Référentiel inconnu.");
    const id = lireTexte(f.get("_id"));
    const cols = Object.keys(def.colonnes);
    const vals = cols.map((c) => {
      const v = valeur(def.colonnes[c].type, f.get(c), f.has(c) || def.colonnes[c].type === "booleen");
      if (def.colonnes[c].obligatoire && (v === null || v === "" || Number.isNaN(v)))
        throw new ErreurMetier(`Le champ « ${c.replace(/_/g, " ")} » est obligatoire et doit être valide.`);
      if (Number.isNaN(v)) throw new ErreurMetier(`Le champ « ${c.replace(/_/g, " ")} » doit être un nombre entier.`);
      return v;
    });
    // Champ booléen absent d'un formulaire de création : vrai par défaut pour « actif ».
    if (!id && cols.includes("actif") && !f.has("actif")) vals[cols.indexOf("actif")] = true;
    await transaction(s.u.id, async (c) => {
      if (id) {
        const set = cols.map((col, k) => `${col} = $${k + 2}`).join(", ");
        const r = await c.query(`update ${table} set ${set} where ${def.cle}::text = $1`, [id, ...vals]);
        if (!r.rowCount) throw new ErreurMetier("Élément introuvable.");
      } else {
        await c.query(`insert into ${table} (${cols.join(", ")}) values (${cols.map((_, k) => `$${k + 1}`).join(", ")})`, vals);
      }
      if (table === "jours_feries") {
        // Les dates de règlement ajustées dépendent des jours fériés.
        const p = await c.query<{ id: string }>("select id from positions");
        for (const x of p.rows) await regenererEcheances(c, x.id);
      }
      await journaliser(c, s, `Référentiel ${id ? "modifié" : "créé"} : ${def.libelle}`, table, id, Object.fromEntries(cols.map((k, i) => [k, vals[i]])));
    });
    revalidatePath("/referentiels");
    return ok(`${def.libelle} ${id ? "modifié" : "créé"}.`);
  } catch (e) {
    return erreur(e);
  }
}

export async function supprimerReferentiel(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_referentiels");
    const table = lireTexte(f.get("table"));
    const def = TABLES[table];
    if (!def) throw new ErreurMetier("Référentiel inconnu.");
    const id = lireTexte(f.get("id"));
    await transaction(s.u.id, async (c) => {
      await c.query(`delete from ${table} where ${def.cle}::text = $1`, [id]);
      await journaliser(c, s, `Référentiel supprimé : ${def.libelle}`, table, id);
    });
    revalidatePath("/referentiels");
    return ok("Supprimé.");
  } catch (e) {
    return erreur(e);
  }
}

export async function enregistrerParametres(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("parametrer");
    const cles = ["devise_reference", "seuils_alerte_echeance", "tolerance_encaissement", "limite_concentration", "horizon_projection_mois", "convention_defaut", "duree_session_heures", "nom_etablissement"];
    // Les risques ne modifient que les seuils et limites ; l'administrateur modifie tout.
    const autorisees = s.peut("gerer_referentiels") ? cles : ["seuils_alerte_echeance", "tolerance_encaissement", "limite_concentration"];
    const seuils = lireTexte(f.get("seuils_alerte_echeance"));
    if (seuils && !/^\s*\d+(\s*[,;]\s*\d+)*\s*$/.test(seuils)) throw new ErreurMetier("Seuils d'alerte : nombres de jours séparés par des virgules (ex. 30,15,7,0).");
    for (const k of ["tolerance_encaissement", "horizon_projection_mois", "duree_session_heures"]) {
      const v = lireTexte(f.get(k));
      if (f.has(k) && !/^\d+$/.test(v)) throw new ErreurMetier(`« ${k.replace(/_/g, " ")} » doit être un nombre entier.`);
    }
    const limite = lireTexte(f.get("limite_concentration")).replace(",", ".");
    if (limite && !(Number(limite) > 0 && Number(limite) <= 100)) throw new ErreurMetier("La limite de concentration est un pourcentage entre 0 et 100 (vide = désactivée).");
    await transaction(s.u.id, async (c) => {
      for (const k of autorisees) {
        if (!f.has(k)) continue;
        const v = k === "limite_concentration" ? limite : lireTexte(f.get(k));
        await c.query("update parametres set valeur = $2, modifie_le = now(), modifie_par = $3 where cle = $1 and valeur is distinct from $2", [k, v, s.u.id]);
      }
      await journaliser(c, s, "Paramètres modifiés", "parametres", "", Object.fromEntries(autorisees.filter((k) => f.has(k)).map((k) => [k, lireTexte(f.get(k))])));
    });
    revalidatePath("/", "layout");
    return ok("Paramètres enregistrés.");
  } catch (e) {
    return erreur(e);
  }
}

/** Recalcul complet des échéances (après un changement de moteur ou de jours fériés). */
export async function recalculerTout(): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_referentiels");
    const n = await transaction(s.u.id, async (c) => {
      const p = await c.query<{ id: string }>("select id from positions");
      for (const x of p.rows) await regenererEcheances(c, x.id);
      await journaliser(c, s, "Échéances recalculées (toutes positions)", "positions", "", { positions: p.rows.length });
      return p.rows.length;
    });
    revalidatePath("/", "layout");
    return ok(`Échéances recalculées pour ${n} position(s).`);
  } catch (e) {
    return erreur(e);
  }
}
