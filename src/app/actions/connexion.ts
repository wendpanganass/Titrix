"use server";
/**
 * Connexion, déconnexion, installation (premier administrateur), changement de mot de passe.
 */
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { lire, lireUn, transaction } from "@/lib/db";
import { fermerSession, ouvrirSession, sessionCourante } from "@/lib/session";
import { lireTexte } from "@/lib/format";
import { journaliser } from "@/donnees/journal";
import { erreur, ok, type Retour } from "./commun";

const MESSAGE_NEUTRE = "E-mail ou mot de passe incorrect.";
const ESSAIS_MAX = 5;
const BLOCAGE_MINUTES = 15;
// Empreinte factice : même temps de réponse que le compte existe ou non.
const HASH_FACTICE = bcrypt.hashSync("titrix-compte-inexistant", 10);

/** Règle de mot de passe : 10 caractères minimum, avec lettres et chiffres. */
export async function verifierRegleMotDePasse(mdp: string): Promise<string | null> {
  if (mdp.length < 10) return "Le mot de passe doit contenir au moins 10 caractères.";
  if (!/[A-Za-z]/.test(mdp) || !/[0-9]/.test(mdp)) return "Le mot de passe doit contenir des lettres et des chiffres.";
  return null;
}

export async function connecter(_: Retour, f: FormData): Promise<Retour> {
  const email = lireTexte(f.get("email")).toLowerCase();
  const mdp = String(f.get("mot_de_passe") ?? "");
  let destination = "/";
  try {
    const u = await lireUn<{
      id: string;
      nom: string;
      mot_de_passe_hash: string;
      actif: boolean;
      bloque: boolean;
      tentatives_echouees: number;
      doit_changer_mdp: boolean;
    }>(
      `select id, nom, mot_de_passe_hash, actif, coalesce(bloque_jusqua > now(), false) as bloque, tentatives_echouees, doit_changer_mdp
         from utilisateurs where lower(email) = $1`,
      [email],
    );
    const valide = await bcrypt.compare(mdp, u?.mot_de_passe_hash ?? HASH_FACTICE);
    if (!u || !u.actif) return { ok: false, message: MESSAGE_NEUTRE };
    if (u.bloque)
      return { ok: false, message: `Trop d'essais infructueux : le compte est bloqué ${BLOCAGE_MINUTES} minutes.` };
    if (!valide) {
      await transaction(u.id, async (c) => {
        await c.query(
          `update utilisateurs set tentatives_echouees = tentatives_echouees + 1,
             bloque_jusqua = case when tentatives_echouees + 1 >= $2 then now() + make_interval(mins => $3) else bloque_jusqua end
           where id = $1`,
          [u.id, ESSAIS_MAX, BLOCAGE_MINUTES],
        );
        await journaliser(c, { u: { id: u.id, nom: u.nom } }, "Connexion refusée (mot de passe incorrect)", "utilisateur", u.id);
      });
      return { ok: false, message: MESSAGE_NEUTRE };
    }
    await transaction(u.id, async (c) => {
      await c.query("update utilisateurs set tentatives_echouees = 0, bloque_jusqua = null, derniere_connexion = now() where id = $1", [u.id]);
      await journaliser(c, { u: { id: u.id, nom: u.nom } }, "Connexion", "utilisateur", u.id);
    });
    await ouvrirSession(u.id);
    // Mot de passe provisoire : direction « Mon compte » pour le changer.
    if (u.doit_changer_mdp) destination = "/compte?changer=1";
  } catch (e) {
    return erreur(e);
  }
  redirect(destination);
}

export async function deconnecter(): Promise<void> {
  await fermerSession();
  redirect("/connexion");
}

/** Installation : création du premier administrateur, possible uniquement si aucun compte n'existe. */
export async function installer(_: Retour, f: FormData): Promise<Retour> {
  const nom = lireTexte(f.get("nom"));
  const email = lireTexte(f.get("email")).toLowerCase();
  const mdp = String(f.get("mot_de_passe") ?? "");
  const confirmation = String(f.get("confirmation") ?? "");
  try {
    if (!nom || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Nom et e-mail valides obligatoires." };
    const regle = await verifierRegleMotDePasse(mdp);
    if (regle) return { ok: false, message: regle };
    if (mdp !== confirmation) return { ok: false, message: "Les deux mots de passe ne sont pas identiques." };
    const hash = await bcrypt.hash(mdp, 12);
    const cree = await transaction(null, async (c) => {
      // Verrou : deux installations simultanées ne peuvent pas créer deux administrateurs.
      await c.query("lock table utilisateurs in exclusive mode");
      const n = await c.query<{ n: number }>("select count(*)::int as n from utilisateurs");
      if (n.rows[0].n > 0) return null;
      const r = await c.query<{ id: string }>(
        `insert into utilisateurs (email, nom, roles, mot_de_passe_hash, doit_changer_mdp)
         values ($1, $2, array['admin'], $3, false) returning id`,
        [email, nom, hash],
      );
      const id = r.rows[0].id;
      await c.query("select set_config('app.utilisateur_id', $1, true)", [id]);
      await journaliser(c, { u: { id, nom } }, "Installation : premier administrateur créé", "utilisateur", id);
      return id;
    });
    if (!cree) return { ok: false, message: "L'installation a déjà été faite : connectez-vous." };
    await ouvrirSession(cree);
  } catch (e) {
    return erreur(e);
  }
  redirect("/");
}

export async function installationPossible(): Promise<boolean> {
  try {
    const r = await lire<{ n: number }>("select count(*)::int as n from utilisateurs");
    return r[0].n === 0;
  } catch {
    return false;
  }
}

export async function changerMotDePasse(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await sessionCourante();
    if (!s) return { ok: false, message: "Session expirée." };
    const actuel = String(f.get("actuel") ?? "");
    const nouveau = String(f.get("nouveau") ?? "");
    if (nouveau !== String(f.get("confirmation") ?? "")) return { ok: false, message: "Les deux nouveaux mots de passe diffèrent." };
    const regle = await verifierRegleMotDePasse(nouveau);
    if (regle) return { ok: false, message: regle };
    const u = await lireUn<{ mot_de_passe_hash: string }>("select mot_de_passe_hash from utilisateurs where id = $1", [s.u.id]);
    if (!u || !(await bcrypt.compare(actuel, u.mot_de_passe_hash))) return { ok: false, message: "Mot de passe actuel incorrect." };
    if (await bcrypt.compare(nouveau, u.mot_de_passe_hash)) return { ok: false, message: "Choisissez un mot de passe différent de l'actuel." };
    const hash = await bcrypt.hash(nouveau, 12);
    await transaction(s.u.id, async (c) => {
      await c.query("update utilisateurs set mot_de_passe_hash = $2, doit_changer_mdp = false where id = $1", [s.u.id, hash]);
      await journaliser(c, s, "Mot de passe changé", "utilisateur", s.u.id);
    });
    return ok("Mot de passe modifié.");
  } catch (e) {
    return erreur(e);
  }
}
