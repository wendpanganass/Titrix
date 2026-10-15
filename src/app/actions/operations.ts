"use server";
/**
 * Opérations : circuit Brouillon → Soumis → Validé ou Rejeté → Réglé, annulation tracée
 * avec opération corrective, contrôle d'impact des opérations rétrodatées.
 * Les contrôles bloquants (initiateur ≠ validateur, nominal négatif, arrêté verrouillé,
 * données obligatoires) sont appliqués par la base : voir base/02_regles.sql.
 */
import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission, sessionCourante, type Session } from "@/lib/session";
import { aujourdhui, lireDate, lireNombre, lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { regenererEcheances } from "@/donnees/echeances";
import { LIBELLES_OPERATION, TYPES_OPERATION, type TypeOperation } from "@/moteur";
import { erreur, ok, type Retour } from "./commun";

async function sessionOuValidateur(): Promise<Session> {
  const s = await sessionCourante();
  if (!s) throw new ErreurMetier("Votre session a expiré : reconnectez-vous.");
  if (!s.peut("valider") && !s.peut("saisir_operation")) throw new ErreurMetier("Vous n'avez pas les droits nécessaires pour cette action.");
  return s;
}

function lireOperation(f: FormData) {
  const type = lireTexte(f.get("type")) as TypeOperation;
  if (!TYPES_OPERATION.includes(type)) throw new ErreurMetier("Type d'opération inconnu.");
  const nominal = lireNombre(f.get("nominal"));
  const dateEffet = lireDate(f.get("date_effet"));
  if (!nominal || nominal <= 0) throw new ErreurMetier("Le nominal doit être un montant positif.");
  if (!dateEffet) throw new ErreurMetier("La date d'effet est obligatoire.");
  return {
    type,
    position_id: lireTexte(f.get("position_id")),
    position_destination_id: type === "transfert" ? lireTexte(f.get("position_destination_id")) || null : null,
    date_effet: dateEffet,
    date_negociation: lireDate(f.get("date_negociation")),
    date_reglement: lireDate(f.get("date_reglement")),
    quantite: lireNombre(f.get("quantite")),
    nominal,
    prix: lireNombre(f.get("prix")),
    unite_cotation: lireTexte(f.get("unite_cotation")) === "montant" ? "montant" : "pourcentage",
    coupon_couru: lireNombre(f.get("coupon_couru")) ?? 0,
    frais: lireNombre(f.get("frais")) ?? 0,
    montant_regle: lireNombre(f.get("montant_regle")),
    contrepartie_id: lireTexte(f.get("contrepartie_id")) || null,
    echeance_id: lireTexte(f.get("echeance_id")) || null,
    // Opération corrective : lien vers l'opération annulée qu'elle remplace.
    operation_annulee_id: lireTexte(f.get("operation_annulee_id")) || null,
    reference: lireTexte(f.get("reference")),
    commentaire: lireTexte(f.get("commentaire")),
  };
}

async function verifierPerimetre(c: PoolClient, s: Session, positionIds: (string | null)[]) {
  if (!s.u.portefeuilles.length) return;
  const r = await c.query<{ portefeuille_id: string }>("select portefeuille_id from positions where id = any($1::uuid[])", [positionIds.filter(Boolean)]);
  if (r.rows.some((x) => !s.u.portefeuilles.includes(x.portefeuille_id)))
    throw new ErreurMetier("Cette position ne fait pas partie de votre périmètre de portefeuilles.");
}

/** Impact d'une opération rétrodatée : arrêtés, échéances et encaissements postérieurs à sa date d'effet. */
async function impactRetroactif(c: PoolClient, positionId: string, dateEffet: string): Promise<string | null> {
  if (dateEffet >= aujourdhui()) return null;
  const r = await c.query<{ arretes: number; echeances: number; encaissees: number }>(
    `select (select count(*)::int from arretes where date_arrete >= $2) as arretes,
            (select count(*)::int from echeances where position_id = $1 and date_contractuelle > $2 and date_contractuelle <= current_date) as echeances,
            (select count(*)::int from encaissements x join echeances e on e.id = x.echeance_id
              where e.position_id = $1 and e.date_contractuelle > $2 and x.statut = 'actif') as encaissees`,
    [positionId, dateEffet],
  );
  const x = r.rows[0];
  if (!x.arretes && !x.echeances) return `Opération rétrodatée au ${dateEffet} : aucun arrêté ni échéance passée concernés.`;
  return `Opération rétrodatée au ${dateEffet} : ${x.arretes} arrêté(s) postérieur(s), ${x.echeances} échéance(s) passée(s) recalculée(s) dont ${x.encaissees} déjà encaissée(s) — à rapprocher.`;
}

export async function creerOperation(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("saisir_operation");
    const v = lireOperation(f);
    const soumettre = lireTexte(f.get("soumettre")) === "1";
    const id = await transaction(s.u.id, async (c) => {
      await verifierPerimetre(c, s, [v.position_id, v.position_destination_id]);
      const cols = Object.keys(v);
      const impact = await impactRetroactif(c, v.position_id, v.date_effet);
      const r = await c.query<{ id: string; numero: number }>(
        `insert into operations (${cols.join(", ")}, statut, impact_retroactif) values (${cols.map((_, k) => `$${k + 1}`).join(", ")}, $${cols.length + 1}, $${cols.length + 2}) returning id, numero`,
        [...Object.values(v), soumettre ? "soumis" : "brouillon", impact],
      );
      await journaliser(c, s, soumettre ? "Opération créée et soumise" : "Opération créée (brouillon)", "operation", r.rows[0].id, {
        numero: r.rows[0].numero,
        type: v.type,
        nominal: v.nominal,
        date_effet: v.date_effet,
      });
      return r.rows[0];
    });
    revalidatePath("/operations");
    return ok(`Opération n° ${id.numero} (${LIBELLES_OPERATION[v.type]}) ${soumettre ? "soumise à validation" : "enregistrée en brouillon"}.`, { id: id.id });
  } catch (e) {
    return erreur(e);
  }
}

export async function modifierOperation(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("saisir_operation");
    const id = lireTexte(f.get("id"));
    const version = Number(lireTexte(f.get("version")));
    const v = lireOperation(f);
    await transaction(s.u.id, async (c) => {
      await verifierPerimetre(c, s, [v.position_id, v.position_destination_id]);
      const cols = Object.keys(v);
      const r = await c.query(
        `update operations set ${cols.map((k, i) => `${k} = $${i + 3}`).join(", ")} where id = $1 and version = $2 and statut = 'brouillon'`,
        [id, version, ...Object.values(v)],
      );
      if (!r.rowCount) throw new ErreurMetier("Seul un brouillon à jour peut être modifié (l'opération a peut-être changé entre-temps).");
      await journaliser(c, s, "Opération modifiée (brouillon)", "operation", id);
    });
    revalidatePath(`/operations/${id}`);
    return ok("Brouillon modifié.");
  } catch (e) {
    return erreur(e);
  }
}

/** Changement de statut : soumettre, valider, rejeter, régler, annuler, reprendre en brouillon. */
export async function changerStatutOperation(_: Retour, f: FormData): Promise<Retour> {
  try {
    const id = lireTexte(f.get("id"));
    const cible = lireTexte(f.get("statut"));
    const motif = lireTexte(f.get("motif"));
    const permission = cible === "valide" || cible === "rejete" ? "valider" : cible === "regle" ? "regler" : "saisir_operation";
    // L'annulation est ouverte aux validateurs (opération validée) comme aux initiateurs (brouillon).
    const s = cible === "annule" ? await sessionOuValidateur() : await exigerPermission(permission);
    const message = await transaction(s.u.id, async (c) => {
      const o = await c.query<{ position_id: string; position_destination_id: string | null; date_effet: string; numero: number; statut: string }>(
        "select position_id, position_destination_id, date_effet, numero, statut from operations where id = $1 for update",
        [id],
      );
      if (!o.rows[0]) throw new ErreurMetier("Opération introuvable.");
      const op = o.rows[0];
      await verifierPerimetre(c, s, [op.position_id, op.position_destination_id]);
      const champs: Record<string, unknown> = { statut: cible };
      if (cible === "rejete") champs.motif_rejet = motif;
      if (cible === "annule") champs.motif_annulation = motif;
      if (cible === "regle") {
        champs.date_reglement = lireDate(f.get("date_reglement")) ?? undefined;
        const m = lireNombre(f.get("montant_regle"));
        if (m !== null) champs.montant_regle = m;
      }
      if (cible === "soumis") champs.impact_retroactif = await impactRetroactif(c, op.position_id, op.date_effet);
      const cles = Object.keys(champs).filter((k) => champs[k] !== undefined);
      await c.query(`update operations set ${cles.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [id, ...cles.map((k) => champs[k])]);
      // Validation ou annulation d'une opération effective : recalcul des échéances.
      if (cible === "valide" || (cible === "annule" && (op.statut === "valide" || op.statut === "regle"))) {
        await regenererEcheances(c, op.position_id);
        if (op.position_destination_id) await regenererEcheances(c, op.position_destination_id);
      }
      const libelles: Record<string, string> = {
        soumis: "soumise à validation",
        valide: "validée",
        rejete: "rejetée",
        regle: "constatée réglée",
        annule: "annulée",
        brouillon: "reprise en brouillon",
      };
      await journaliser(c, s, `Opération ${libelles[cible] ?? cible}`, "operation", id, { numero: op.numero, motif });
      return `Opération n° ${op.numero} ${libelles[cible] ?? cible}.`;
    });
    revalidatePath("/operations");
    revalidatePath(`/operations/${id}`);
    revalidatePath("/", "layout");
    return ok(message);
  } catch (e) {
    return erreur(e);
  }
}

/** Validation groupée (reprise de données : positions d'ouverture importées). */
export async function validerSelection(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("valider");
    const ids = f.getAll("ids").map(String).filter(Boolean);
    if (!ids.length) throw new ErreurMetier("Cochez au moins une opération.");
    const n = await transaction(s.u.id, async (c) => {
      const positions = new Set<string>();
      for (const id of ids) {
        const r = await c.query<{ position_id: string; position_destination_id: string | null }>(
          "update operations set statut = 'valide' where id = $1 and statut = 'soumis' returning position_id, position_destination_id",
          [id],
        );
        for (const x of r.rows) {
          positions.add(x.position_id);
          if (x.position_destination_id) positions.add(x.position_destination_id);
        }
      }
      for (const p of positions) await regenererEcheances(c, p);
      await journaliser(c, s, "Opérations validées (sélection)", "operation", "", { nombre: ids.length });
      return ids.length;
    });
    revalidatePath("/operations");
    revalidatePath("/", "layout");
    return ok(`${n} opération(s) validée(s).`);
  } catch (e) {
    return erreur(e);
  }
}

export async function supprimerBrouillon(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("saisir_operation");
    const id = lireTexte(f.get("id"));
    await transaction(s.u.id, async (c) => {
      const r = await c.query("delete from operations where id = $1 and statut = 'brouillon' and initiateur_id = $2", [id, s.u.id]);
      if (!r.rowCount) throw new ErreurMetier("Seul l'initiateur peut supprimer son brouillon.");
      await journaliser(c, s, "Brouillon d'opération supprimé", "operation", id);
    });
    revalidatePath("/operations");
    return ok("Brouillon supprimé.");
  } catch (e) {
    return erreur(e);
  }
}
