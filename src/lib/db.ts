/**
 * Connexion à la base PostgreSQL (Neon en production, PostgreSQL local pour les essais).
 *
 * Seuls les fichiers de `src/donnees/` utilisent ce module : ils sont le SEUL point d'accès à la base.
 * Toute écriture passe par `transaction(utilisateurId, …)`, qui indique à la base qui agit
 * (`app.utilisateur_id`) : les règles de 02_regles.sql s'en servent pour l'audit et les contrôles
 * (validation par une autre personne que l'initiateur, droits, etc.).
 */
import "server-only";
import { Pool, type PoolClient, type QueryResultRow, types } from "pg";

// Les colonnes numeric arrivent en texte : on les convertit en nombre (montants ≤ 15 chiffres significatifs).
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Les dates (sans heure) restent des chaînes « AAAA-MM-JJ » : aucun décalage de fuseau horaire.
types.setTypeParser(1082, (v) => v);
// Les entiers 64 bits (identifiants, compteurs) en nombre.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

declare global {
  var __titrixPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__titrixPool) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error("La variable DATABASE_URL n'est pas définie (Vercel → Settings → Environment Variables).");
    globalThis.__titrixPool = new Pool({
      connectionString: url,
      // Fonctions serverless : peu de connexions par instance, Neon gère le regroupement.
      max: 5,
      idleTimeoutMillis: 10_000,
      ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: true } : undefined,
    });
  }
  return globalThis.__titrixPool;
}

export type Executeur = {
  query: <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
};

/** Lecture simple (sans identité d'utilisateur). */
export async function lire<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool().query<T>(sql, params);
  return r.rows;
}

export async function lireUn<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await lire<T>(sql, params);
  return r[0] ?? null;
}

/**
 * Transaction au nom d'un utilisateur : tout réussit ou rien n'est enregistré.
 * Une règle bloquante de la base annule toute la transaction et son message est renvoyé à l'écran.
 */
export async function transaction<T>(utilisateurId: string | null, travail: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    if (utilisateurId) await client.query("select set_config('app.utilisateur_id', $1, true)", [utilisateurId]);
    const resultat = await travail(client);
    await client.query("commit");
    return resultat;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Traduit une erreur PostgreSQL en message français compréhensible. */
export function messageErreurBase(e: unknown): string {
  const err = e as { code?: string; message?: string; detail?: string; constraint?: string };
  if (!err || typeof err !== "object") return "Erreur inattendue.";
  switch (err.code) {
    case "P0001": // règle de gestion (raise exception) : message déjà rédigé en français
      return err.message ?? "Règle de gestion non respectée.";
    case "23505":
      return `Cet élément existe déjà (doublon${err.constraint ? ` : ${err.constraint}` : ""}).`;
    case "23503":
      return "Cet élément est encore rattaché à d'autres données : il ne peut pas être supprimé ou modifié ainsi.";
    case "23514":
      return `Valeur refusée par un contrôle de cohérence${err.constraint ? ` (${err.constraint})` : ""}.`;
    case "23502":
      return "Une donnée obligatoire est manquante.";
    case "22P02":
    case "22007":
    case "22008":
      return "Format de donnée invalide (nombre ou date).";
    case "42703":
    case "42P01":
      return "La base n'est pas à jour : exécutez à nouveau les scripts du dossier base/ dans Neon (01, 02 puis 03).";
    case "40001":
    case "40P01":
      return "Modification simultanée détectée : rechargez la page et recommencez.";
    default:
      return err.message?.startsWith("La variable DATABASE_URL") ? err.message : "Erreur d'accès à la base de données.";
  }
}
