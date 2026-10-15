/**
 * Référentiels et paramètres (lecture). Les écritures passent par les actions serveur.
 */
import "server-only";
import { lire } from "@/lib/db";

export interface Parametres {
  deviseReference: string;
  seuilsAlerte: number[];
  toleranceEncaissement: number;
  limiteConcentration: number | null;
  horizonMois: number;
  conventionDefaut: string;
  nomEtablissement: string;
  brut: Record<string, { valeur: string; description: string }>;
}

export async function lireParametres(): Promise<Parametres> {
  const lignes = await lire<{ cle: string; valeur: string; description: string }>("select cle, valeur, description from parametres");
  const brut = Object.fromEntries(lignes.map((l) => [l.cle, { valeur: l.valeur, description: l.description }]));
  const v = (k: string) => brut[k]?.valeur ?? "";
  const seuils = v("seuils_alerte_echeance")
    .split(/[,;\s]+/)
    .map(Number)
    .filter((x) => Number.isFinite(x) && x >= 0);
  const limite = Number(v("limite_concentration").replace(",", "."));
  return {
    deviseReference: v("devise_reference") || "XOF",
    seuilsAlerte: seuils.length ? seuils : [30, 15, 7, 0],
    toleranceEncaissement: Number(v("tolerance_encaissement")) || 5,
    limiteConcentration: v("limite_concentration") && limite > 0 ? limite / 100 : null,
    horizonMois: Number(v("horizon_projection_mois")) || 60,
    conventionDefaut: v("convention_defaut") || "ACT/365",
    nomEtablissement: v("nom_etablissement") || "Établissement",
    brut,
  };
}

export type Option = { valeur: string; libelle: string };

export async function listesReferentiels() {
  const [pays, devises, types, emetteurs, conservateurs, contreparties, portefeuilles, entites] = await Promise.all([
    lire<{ code: string; nom: string; zone: string }>("select code, nom, zone from pays order by nom"),
    lire<{ code: string; libelle: string; decimales: number }>("select code, libelle, decimales from devises order by code"),
    lire<{ code: string; libelle: string; precompte: boolean }>("select code, libelle, precompte from types_instrument order by code"),
    lire<{ id: string; nom: string; pays_code: string | null; secteur: string; actif: boolean }>(
      "select id, nom, pays_code, secteur, actif from emetteurs order by nom",
    ),
    lire<{ id: string; nom: string; code: string; actif: boolean }>("select id, nom, code, actif from conservateurs order by nom"),
    lire<{ id: string; nom: string; role: string; actif: boolean }>("select id, nom, role, actif from contreparties order by nom"),
    lire<{ id: string; code: string; libelle: string; entite_id: string | null; entite: string | null; actif: boolean }>(
      "select f.id, f.code, f.libelle, f.entite_id, e.nom as entite, f.actif from portefeuilles f left join entites e on e.id = f.entite_id order by f.code",
    ),
    lire<{ id: string; nom: string }>("select id, nom from entites order by nom"),
  ]);
  return { pays, devises, types, emetteurs, conservateurs, contreparties, portefeuilles, entites };
}
export type Referentiels = Awaited<ReturnType<typeof listesReferentiels>>;

export async function lireTranchesBrutes() {
  return lire<{ id: string; libelle: string; borne_min: number; borne_max: number | null; ordre: number }>(
    "select id, libelle, borne_min, borne_max, ordre from tranches_maturite order by ordre, borne_min",
  );
}

export async function lireFeries() {
  return lire<{ date: string; libelle: string }>("select date, libelle from jours_feries order by date");
}
