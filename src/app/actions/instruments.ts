"use server";
/**
 * Instruments (REF-01) : création, modification, validation à quatre yeux,
 * échéancier officiel, classifications et notations historisées.
 */
import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission } from "@/lib/session";
import { lireDate, lireNombre, lireTexte } from "@/lib/format";
import { isinValide, normaliserCode } from "@/lib/codes";
import { journaliser } from "@/donnees/journal";
import { regenererInstrument } from "@/donnees/echeances";
import { CONVENTIONS, FREQUENCES, PROFILS } from "@/moteur";
import { erreur, ok, type Retour } from "./commun";

async function lireInstrument(f: FormData) {
  const code = normaliserCode(lireTexte(f.get("code_interne")));
  const isin = normaliserCode(lireTexte(f.get("isin"))) || null;
  const libelle = lireTexte(f.get("libelle"));
  const devise = lireTexte(f.get("devise_code")).toUpperCase();
  if (!code) throw new ErreurMetier("Le code interne est obligatoire.");
  if (!libelle) throw new ErreurMetier("Le libellé est obligatoire.");
  if (!devise) throw new ErreurMetier("La devise est obligatoire.");
  if (isin && !isinValide(isin)) throw new ErreurMetier(`Le code ISIN « ${isin} » est invalide (format ou clé de contrôle).`);
  const convention = lireTexte(f.get("convention"));
  if (!CONVENTIONS.includes(convention as (typeof CONVENTIONS)[number])) throw new ErreurMetier("Convention de calcul inconnue.");
  const frequence = Number(lireTexte(f.get("frequence")));
  if (!FREQUENCES.includes(frequence as (typeof FREQUENCES)[number])) throw new ErreurMetier("Fréquence inconnue.");
  const profil = lireTexte(f.get("profil"));
  if (!PROFILS.includes(profil as (typeof PROFILS)[number])) throw new ErreurMetier("Profil d'amortissement inconnu.");
  const taux = lireNombre(f.get("taux_coupon"));
  const retenue = lireNombre(f.get("taux_retenue"));
  return {
    code_interne: code,
    isin,
    libelle,
    emetteur_id: lireTexte(f.get("emetteur_id")) || null,
    pays_code: lireTexte(f.get("pays_code")) || null,
    zone: lireTexte(f.get("zone")),
    type_code: lireTexte(f.get("type_code")) || null,
    devise_code: devise,
    nominal_unitaire: lireNombre(f.get("nominal_unitaire")),
    date_emission: lireDate(f.get("date_emission")),
    date_echeance: lireDate(f.get("date_echeance")),
    // Saisi en % (6,5) → stocké en fraction (0,065).
    taux_coupon: taux === null ? 0 : taux / 100,
    convention,
    frequence,
    profil,
    differe_mois: Math.max(0, Math.round(lireNombre(f.get("differe_mois")) ?? 0)),
    precompte: f.get("precompte") === "on",
    taux_retenue: retenue === null ? 0 : retenue / 100,
    conditions_remboursement: lireTexte(f.get("conditions_remboursement")),
  };
}

export async function creerInstrument(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_instruments");
    const v = await lireInstrument(f);
    const id = await transaction(s.u.id, async (c) => {
      const cols = Object.keys(v);
      const r = await c.query<{ id: string }>(
        `insert into instruments (${cols.join(", ")}) values (${cols.map((_, k) => `$${k + 1}`).join(", ")}) returning id`,
        Object.values(v),
      );
      await journaliser(c, s, "Instrument créé", "instrument", r.rows[0].id, { code: v.code_interne, isin: v.isin });
      return r.rows[0].id;
    });
    revalidatePath("/instruments");
    return ok(`Instrument ${v.code_interne} créé : il doit maintenant être validé par un validateur.`, { id });
  } catch (e) {
    return erreur(e);
  }
}

export async function modifierInstrument(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_instruments");
    const id = lireTexte(f.get("id"));
    const version = Number(lireTexte(f.get("version")));
    const v = await lireInstrument(f);
    await transaction(s.u.id, async (c) => {
      const cols = Object.keys(v);
      // Protection contre les modifications concurrentes : la version lue doit être la version en base.
      const r = await c.query(
        `update instruments set ${cols.map((k, i) => `${k} = $${i + 3}`).join(", ")} where id = $1 and version = $2`,
        [id, version, ...Object.values(v)],
      );
      if (!r.rowCount) throw new ErreurMetier("L'instrument a été modifié entre-temps par quelqu'un d'autre : rechargez la page.");
      await regenererInstrument(c, id);
      await journaliser(c, s, "Instrument modifié", "instrument", id, { code: v.code_interne });
    });
    revalidatePath(`/instruments/${id}`);
    return ok("Instrument modifié. Les échéanciers ont été recalculés ; une nouvelle validation est nécessaire.");
  } catch (e) {
    return erreur(e);
  }
}

export async function validerInstrument(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("valider");
    const id = lireTexte(f.get("id"));
    const decision = lireTexte(f.get("decision")) === "rejete" ? "rejete" : "valide";
    const motif = lireTexte(f.get("motif"));
    await transaction(s.u.id, async (c) => {
      await c.query("update instruments set statut = $2, motif_rejet = $3 where id = $1", [id, decision, decision === "rejete" ? motif : null]);
      await regenererInstrument(c, id);
      await journaliser(c, s, decision === "valide" ? "Instrument validé" : "Instrument rejeté", "instrument", id, { motif });
    });
    revalidatePath(`/instruments/${id}`);
    revalidatePath("/instruments");
    return ok(decision === "valide" ? "Caractéristiques validées." : "Instrument rejeté.");
  } catch (e) {
    return erreur(e);
  }
}

/**
 * Échéancier officiel : une ligne par échéance « date ; part du capital en % »
 * (ex. « 2027-03-15;20 »). La somme doit faire 100 %. Il devra être validé par une autre personne.
 */
export async function enregistrerEcheancierOfficiel(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_instruments");
    const id = lireTexte(f.get("id"));
    const source = lireTexte(f.get("source"));
    const lignes = lireTexte(f.get("lignes"))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const valeurs = lignes.map((l, k) => {
      const [d, p] = l.split(/[;\t]/).map((x) => x.trim());
      const date = /^\d{2}\/\d{2}\/\d{4}$/.test(d) ? `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : d;
      const part = lireNombre(p);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || part === null || part < 0 || part > 100)
        throw new ErreurMetier(`Ligne ${k + 1} illisible : « ${l} » (attendu : date;part en %).`);
      return { date, part: part / 100 };
    });
    const somme = valeurs.reduce((t, v) => t + v.part, 0);
    if (valeurs.length && Math.abs(somme - 1) > 1e-6)
      throw new ErreurMetier(`La somme des parts vaut ${(somme * 100).toFixed(4)} % : elle doit être égale à 100 %.`);
    await transaction(s.u.id, async (c) => {
      await c.query("delete from echeancier_officiel where instrument_id = $1", [id]);
      for (const v of valeurs)
        await c.query("insert into echeancier_officiel (instrument_id, date_echeance, part_capital, source, importe_par) values ($1,$2,$3,$4,$5)", [
          id,
          v.date,
          v.part,
          source,
          s.u.id,
        ]);
      await regenererInstrument(c, id);
      await journaliser(c, s, valeurs.length ? "Échéancier officiel enregistré" : "Échéancier officiel retiré", "instrument", id, { lignes: valeurs.length, source });
    });
    revalidatePath(`/instruments/${id}`);
    return ok(valeurs.length ? `${valeurs.length} échéance(s) enregistrée(s). Elles feront foi après validation par une autre personne.` : "Échéancier officiel retiré.");
  } catch (e) {
    return erreur(e);
  }
}

export async function validerEcheancierOfficiel(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("valider");
    const id = lireTexte(f.get("id"));
    await transaction(s.u.id, async (c: PoolClient) => {
      await c.query("update instruments set echeancier_officiel_valide = true where id = $1", [id]);
      await regenererInstrument(c, id);
      await journaliser(c, s, "Échéancier officiel validé", "instrument", id);
    });
    revalidatePath(`/instruments/${id}`);
    return ok("Échéancier officiel validé : il fait désormais foi pour les projections.");
  } catch (e) {
    return erreur(e);
  }
}

export async function ajouterClassification(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_instruments");
    const id = lireTexte(f.get("id"));
    const referentiel = lireTexte(f.get("referentiel"));
    const valeur = lireTexte(f.get("valeur"));
    const date = lireDate(f.get("date_effet"));
    if (!valeur || !date) throw new ErreurMetier("Valeur et date d'effet obligatoires.");
    await transaction(s.u.id, async (c) => {
      await c.query(
        "insert into classifications (instrument_id, position_id, referentiel, valeur, date_effet, source, saisi_par) values ($1,$2,$3,$4,$5,$6,$7)",
        [id, lireTexte(f.get("position_id")) || null, referentiel, valeur, date, lireTexte(f.get("source")), s.u.id],
      );
      await journaliser(c, s, "Classification ajoutée", "instrument", id, { referentiel, valeur, date });
    });
    revalidatePath(`/instruments/${id}`);
    return ok("Classification enregistrée (historique conservé).");
  } catch (e) {
    return erreur(e);
  }
}
