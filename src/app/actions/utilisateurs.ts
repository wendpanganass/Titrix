"use server";
/**
 * Comptes : création (mot de passe provisoire montré une seule fois), profils, périmètre de portefeuilles,
 * activation, réinitialisation. Un administrateur ne modifie pas son propre compte ici.
 */
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { transaction } from "@/lib/db";
import { ErreurMetier, exigerPermission } from "@/lib/session";
import { lireTexte } from "@/lib/format";
import { LISTE_ROLES } from "@/lib/droits";
import { journaliser } from "@/donnees/journal";
import { erreur, ok, type Retour } from "./commun";

/** Mot de passe provisoire lisible (sans caractères ambigus), 12 caractères. */
function motDePasseProvisoire(): string {
  const lettres = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const chiffres = "23456789";
  const tous = lettres + chiffres;
  let mdp = lettres[randomInt(lettres.length)] + chiffres[randomInt(chiffres.length)];
  for (let i = 0; i < 10; i++) mdp += tous[randomInt(tous.length)];
  return mdp
    .split("")
    .sort(() => randomInt(3) - 1)
    .join("");
}

function lireRoles(f: FormData): string[] {
  const roles = f.getAll("roles").map(String).filter((r) => LISTE_ROLES.includes(r as never));
  if (!roles.length) throw new ErreurMetier("Choisissez au moins un profil.");
  return roles;
}

export async function creerUtilisateur(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_utilisateurs");
    const nom = lireTexte(f.get("nom"));
    const email = lireTexte(f.get("email")).toLowerCase();
    if (!nom || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErreurMetier("Nom et e-mail valides obligatoires.");
    const roles = lireRoles(f);
    const portefeuilles = f.getAll("portefeuilles").map(String).filter(Boolean);
    const mdp = motDePasseProvisoire();
    const hash = await bcrypt.hash(mdp, 12);
    await transaction(s.u.id, async (c) => {
      const r = await c.query<{ id: string }>(
        "insert into utilisateurs (email, nom, roles, mot_de_passe_hash, doit_changer_mdp) values ($1,$2,$3,$4,true) returning id",
        [email, nom, roles, hash],
      );
      for (const p of portefeuilles) await c.query("insert into utilisateurs_portefeuilles values ($1,$2)", [r.rows[0].id, p]);
      await journaliser(c, s, "Compte créé", "utilisateur", r.rows[0].id, { email, roles, portefeuilles: portefeuilles.length });
    });
    revalidatePath("/utilisateurs");
    return ok(`Compte de ${nom} créé. Transmettez-lui son mot de passe provisoire : il devra le changer à la première connexion.`, { secret: mdp });
  } catch (e) {
    return erreur(e);
  }
}

export async function modifierUtilisateur(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_utilisateurs");
    const id = lireTexte(f.get("id"));
    if (id === s.u.id) throw new ErreurMetier("Vous ne pouvez pas modifier votre propre compte : demandez à un autre administrateur.");
    const roles = lireRoles(f);
    const portefeuilles = f.getAll("portefeuilles").map(String).filter(Boolean);
    const nom = lireTexte(f.get("nom"));
    await transaction(s.u.id, async (c) => {
      await c.query("update utilisateurs set roles = $2, nom = coalesce(nullif($3,''), nom) where id = $1", [id, roles, nom]);
      await c.query("delete from utilisateurs_portefeuilles where utilisateur_id = $1", [id]);
      for (const p of portefeuilles) await c.query("insert into utilisateurs_portefeuilles values ($1,$2)", [id, p]);
      await journaliser(c, s, "Compte modifié (profils / périmètre)", "utilisateur", id, { roles, portefeuilles: portefeuilles.length });
    });
    revalidatePath("/utilisateurs");
    return ok("Compte modifié. Les droits s'appliquent dès la prochaine page affichée.");
  } catch (e) {
    return erreur(e);
  }
}

export async function basculerActif(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_utilisateurs");
    const id = lireTexte(f.get("id"));
    if (id === s.u.id) throw new ErreurMetier("Vous ne pouvez pas désactiver votre propre compte.");
    const actif = await transaction(s.u.id, async (c) => {
      const r = await c.query<{ actif: boolean }>("update utilisateurs set actif = not actif where id = $1 returning actif", [id]);
      if (!r.rows[0]?.actif) await c.query("delete from sessions where utilisateur_id = $1", [id]);
      await journaliser(c, s, r.rows[0]?.actif ? "Compte réactivé" : "Compte désactivé", "utilisateur", id);
      return r.rows[0]?.actif;
    });
    revalidatePath("/utilisateurs");
    return ok(actif ? "Compte réactivé." : "Compte désactivé (sessions fermées).");
  } catch (e) {
    return erreur(e);
  }
}

export async function reinitialiserMotDePasse(_: Retour, f: FormData): Promise<Retour> {
  try {
    const s = await exigerPermission("gerer_utilisateurs");
    const id = lireTexte(f.get("id"));
    if (id === s.u.id) throw new ErreurMetier("Changez votre propre mot de passe depuis « Mon compte ».");
    const mdp = motDePasseProvisoire();
    const hash = await bcrypt.hash(mdp, 12);
    await transaction(s.u.id, async (c) => {
      await c.query("update utilisateurs set mot_de_passe_hash = $2, doit_changer_mdp = true, tentatives_echouees = 0, bloque_jusqua = null where id = $1", [id, hash]);
      await c.query("delete from sessions where utilisateur_id = $1", [id]);
      await journaliser(c, s, "Mot de passe réinitialisé", "utilisateur", id);
    });
    revalidatePath("/utilisateurs");
    return ok("Nouveau mot de passe provisoire :", { secret: mdp });
  } catch (e) {
    return erreur(e);
  }
}
