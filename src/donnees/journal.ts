/**
 * Journal des actions (ajout seul) : qui a fait quoi, quand, sur quel objet.
 * L'audit détaillé (ancienne / nouvelle valeur) est rempli automatiquement par la base.
 */
import "server-only";
import type { PoolClient } from "pg";
import { lire } from "@/lib/db";
import type { Session } from "@/lib/session";

export async function journaliser(
  c: PoolClient,
  s: Session | { u: { id: string; nom: string } },
  action: string,
  objet = "",
  objetId = "",
  details: Record<string, unknown> = {},
) {
  await c.query(
    "insert into journal (utilisateur_id, utilisateur_nom, action, objet, objet_id, details) values ($1,$2,$3,$4,$5,$6)",
    [s.u.id, s.u.nom, action, objet, objetId, JSON.stringify(details)],
  );
}

export interface FiltresJournal {
  utilisateur?: string;
  action?: string;
  du?: string;
  au?: string;
  recherche?: string;
}

export async function lireJournal(f: FiltresJournal, limite = 300) {
  return lire<{ id: number; date: string; utilisateur_nom: string; action: string; objet: string; objet_id: string; details: Record<string, unknown> }>(
    `select id, date, utilisateur_nom, action, objet, objet_id, details from journal
      where ($1 = '' or utilisateur_id::text = $1)
        and ($2 = '' or action ilike $2 || '%')
        and ($3 = '' or date >= $3::date)
        and ($4 = '' or date < $4::date + 1)
        and ($5 = '' or action ilike '%' || $5 || '%' or objet ilike '%' || $5 || '%' or details::text ilike '%' || $5 || '%')
      order by date desc limit $6`,
    [f.utilisateur ?? "", f.action ?? "", f.du ?? "", f.au ?? "", f.recherche ?? "", limite],
  );
}

export async function lireAudit(table: string, ligneId: string) {
  return lire<{ id: number; date: string; utilisateur: string | null; operation: string; ancien: Record<string, unknown> | null; nouveau: Record<string, unknown> | null }>(
    `select a.id, a.date, u.nom as utilisateur, a.operation, a.ancien, a.nouveau
       from audit a left join utilisateurs u on u.id = a.utilisateur_id
      where a.table_nom = $1 and a.ligne_id = $2 order by a.date desc, a.id desc limit 200`,
    [table, ligneId],
  );
}
