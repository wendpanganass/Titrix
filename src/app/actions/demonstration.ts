"use server";
/**
 * Chargement du jeu de démonstration fictif (administrateur, base sans instrument uniquement).
 */
import { revalidatePath } from "next/cache";
import { lireUn, transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission } from "@/lib/session";
import { aujourdhui } from "@/lib/format";
import { chargerJeuDemonstration } from "@/donnees/demonstration";
import { photographie } from "@/donnees/arretes";
import { analyser } from "@/donnees/portefeuille";
import { journaliser } from "@/donnees/journal";
import { VERSION_MOTEUR } from "@/moteur";
import { erreur, ok, type Retour } from "./commun";

export async function chargerDemonstration(): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_referentiels");
    const jour = aujourdhui();
    const r = await transaction(s.u.id, (c) => chargerJeuDemonstration(c, s.u, jour)).catch((e) => {
      if (e instanceof Error && e.message === "DEMO_BASE_NON_VIDE")
        throw new ErreurMetier("La base contient déjà des instruments : la démonstration ne se charge que sur une base vide.");
      throw e;
    });
    // Arrêté de fin de semestre calculé puis verrouillé par le validateur fictif.
    const validateur = await lireUn<{ id: string; nom: string }>("select id, nom from utilisateurs where email = 'validateur.demo@titrix.demo'");
    const dateArrete = `${Number(jour.slice(0, 4)) - (jour.slice(5) < "07-01" ? 1 : 0)}-${jour.slice(5) < "07-01" ? "12-31" : "06-30"}`;
    const a = await analyser({ ...s, u: { ...s.u, portefeuilles: [] } }, dateArrete);
    if (validateur)
      await transaction(validateur.id, async (c) => {
        const ar = await c.query<{ id: string }>("insert into arretes (date_arrete, resultat, version_moteur) values ($1,$2,$3) on conflict (date_arrete) do nothing returning id", [
          dateArrete,
          JSON.stringify(photographie(a)),
          VERSION_MOTEUR,
        ]);
        if (ar.rows[0]) {
          await c.query("update arretes set statut = 'verrouille' where id = $1", [ar.rows[0].id]);
          await journaliser(c, { u: validateur }, "Arrêté verrouillé (démonstration)", "arrete", ar.rows[0].id, { date: dateArrete });
        }
      });
    revalidatePath("/", "layout");
    return ok(
      `Démonstration chargée : ${r.instruments} instruments, ${r.positions} positions, ${r.operations} opérations, ${r.encaissements} encaissements, 3 grevages, arrêté du ${dateArrete} verrouillé.` +
        (r.comptes.length ? " Comptes fictifs créés (mots de passe provisoires ci-dessous, affichés une seule fois) :" : ""),
      { secret: r.comptes.map((x) => `${x.email} / ${x.motDePasse}`).join("   ·   ") || undefined },
    );
  } catch (e) {
    return erreur(e);
  }
}
