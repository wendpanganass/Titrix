/**
 * Sessions de connexion (e-mail + mot de passe).
 *
 * Le navigateur reçoit un jeton aléatoire dans un cookie protégé (httpOnly, secure, sameSite=lax) ;
 * la base n'en garde que l'empreinte SHA-256 : une fuite de la base ne permet pas d'ouvrir de session.
 * `session.ts` ne sert qu'à savoir QUI est connecté ; ce que chacun peut faire est décidé par
 * `droits.ts` (affichage) et par les règles de la base (contrôle final).
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { lire, lireUn, transaction } from "./db";
import { peut, permissionsDe, type Permission } from "./droits";

export const COOKIE_SESSION = "titrix_session";

export interface Utilisateur {
  id: string;
  email: string;
  nom: string;
  roles: string[];
  doitChangerMdp: boolean;
  /** Portefeuilles autorisés (vide = tous). */
  portefeuilles: string[];
}

export interface Session {
  u: Utilisateur;
  permissions: Set<Permission>;
  peut: (p: Permission) => boolean;
}

const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");

export async function ouvrirSession(utilisateurId: string): Promise<void> {
  const jeton = randomBytes(32).toString("base64url");
  const param = await lireUn<{ valeur: string }>("select valeur from parametres where cle = 'duree_session_heures'");
  const heures = Math.min(24, Math.max(1, Number(param?.valeur) || 10));
  const h = await headers();
  await transaction(utilisateurId, async (c) => {
    await c.query(
      `insert into sessions (jeton_hash, utilisateur_id, expire_le, adresse_ip, navigateur)
       values ($1, $2, now() + make_interval(hours => $3), $4, $5)`,
      [empreinte(jeton), utilisateurId, heures, h.get("x-forwarded-for")?.split(",")[0] ?? "", (h.get("user-agent") ?? "").slice(0, 300)],
    );
    // Ménage : sessions expirées.
    await c.query("delete from sessions where expire_le < now()");
  });
  (await cookies()).set(COOKIE_SESSION, jeton, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: heures * 3600,
  });
}

export async function fermerSession(): Promise<void> {
  const jar = await cookies();
  const jeton = jar.get(COOKIE_SESSION)?.value;
  if (jeton) await lire("delete from sessions where jeton_hash = $1", [empreinte(jeton)]);
  jar.delete(COOKIE_SESSION);
}

/** Session courante (une seule lecture en base par requête). */
export const sessionCourante = cache(async (): Promise<Session | null> => {
  const jeton = (await cookies()).get(COOKIE_SESSION)?.value;
  if (!jeton) return null;
  const r = await lireUn<{ id: string; email: string; nom: string; roles: string[]; doit_changer_mdp: boolean; session_id: string; vu_il_y_a: number }>(
    `select u.id, u.email, u.nom, u.roles, u.doit_changer_mdp, s.id as session_id,
            extract(epoch from now() - s.vu_le)::int as vu_il_y_a
       from sessions s join utilisateurs u on u.id = s.utilisateur_id
      where s.jeton_hash = $1 and s.expire_le > now() and u.actif`,
    [empreinte(jeton)],
  );
  if (!r) return null;
  if (r.vu_il_y_a > 300) await lire("update sessions set vu_le = now() where id = $1", [r.session_id]);
  const pf = await lire<{ portefeuille_id: string }>(
    "select portefeuille_id from utilisateurs_portefeuilles where utilisateur_id = $1",
    [r.id],
  );
  const u: Utilisateur = {
    id: r.id,
    email: r.email,
    nom: r.nom,
    roles: r.roles,
    doitChangerMdp: r.doit_changer_mdp,
    portefeuilles: pf.map((x) => x.portefeuille_id),
  };
  return { u, permissions: permissionsDe(u.roles), peut: (p) => peut(u.roles, p) };
});

/** Exige une session ; sinon renvoie vers la page de connexion. */
export async function exigerSession(): Promise<Session> {
  const s = await sessionCourante();
  if (!s) redirect("/connexion");
  return s;
}

/** Erreur « métier » dont le message peut être montré tel quel à l'utilisateur. */
export class ErreurMetier extends Error {}

/** Exige une permission (dans une action serveur : lève une erreur lisible). */
export async function exigerPermission(p: Permission): Promise<Session> {
  const s = await sessionCourante();
  if (!s) throw new ErreurMetier("Votre session a expiré : reconnectez-vous.");
  if (!s.peut(p)) throw new ErreurMetier("Vous n'avez pas les droits nécessaires pour cette action.");
  return s;
}
