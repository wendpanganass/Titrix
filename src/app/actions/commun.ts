/**
 * Outils communs aux actions serveur : type de retour et traduction des erreurs.
 * Modèle : try { const s = await exigerPermission(…); … journaliser(…); revalidatePath(…); return ok(…) }
 *          catch (e) { return erreur(e) }
 */
import "server-only";
import { messageErreurBase } from "@/lib/db";
import { ErreurMetier } from "@/lib/session";

export interface Retour {
  ok: boolean;
  message: string;
  /** Valeur montrée une seule fois (mot de passe provisoire). */
  secret?: string;
  id?: string;
  donnees?: unknown;
}

export const RETOUR_VIDE: Retour = { ok: false, message: "" };

export function ok(message: string, extra: Partial<Retour> = {}): Retour {
  return { ok: true, message, ...extra };
}

export function erreur(e: unknown): Retour {
  if (e instanceof ErreurMetier) return { ok: false, message: e.message };
  // Les redirections de Next.js doivent continuer leur chemin.
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
  if (!(e && typeof e === "object" && "code" in e)) console.error(e);
  return { ok: false, message: messageErreurBase(e) };
}
