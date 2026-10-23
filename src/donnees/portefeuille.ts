/**
 * Chargement des données du portefeuille pour le moteur (lecture seule).
 * Les droits par portefeuille sont appliqués ICI : un compte limité ne charge que ses portefeuilles.
 */
import "server-only";
import { lire } from "@/lib/db";
import type { Session } from "@/lib/session";
import {
  calculerSituation,
  controlerSituation,
  type Controle,
  type Convention,
  type DonneesPortefeuille,
  type InstrumentDonnees,
  type OperationCalc,
  type Profil,
  type Situation,
  type Tranche,
  type TypeOperation,
} from "@/moteur";
import { lireParametres, type Parametres } from "./referentiels";
import { aujourdhui } from "@/lib/format";

/** Paramètre SQL « portefeuilles autorisés » : tableau vide = tous. */
export const pfAutorises = (s: Session) => s.u.portefeuilles;

interface LigneInstrument {
  id: string;
  code_interne: string;
  isin: string | null;
  libelle: string;
  emetteur: string | null;
  pays_code: string | null;
  zone: string;
  type_code: string | null;
  devise_code: string;
  nominal_unitaire: number | null;
  date_emission: string | null;
  date_echeance: string | null;
  taux_coupon: number;
  convention: Convention;
  frequence: number;
  profil: Profil;
  differe_mois: number;
  precompte: boolean;
  taux_retenue: number;
  statut: string;
  echeancier_officiel_valide: boolean;
}

export function versInstrumentDonnees(
  i: LigneInstrument,
  officiel: { date: string; partCapital: number }[] | null,
  classification = "",
  notation = "",
): InstrumentDonnees {
  return {
    id: i.id,
    code: i.code_interne,
    isin: i.isin,
    libelle: i.libelle,
    emetteur: i.emetteur ?? "",
    pays: i.pays_code ?? "",
    zone: i.zone,
    type: i.type_code ?? "",
    devise: i.devise_code,
    statut: i.statut,
    classification,
    notation,
    officiel: i.echeancier_officiel_valide && officiel && officiel.length ? officiel : null,
    dateEmission: i.date_emission,
    dateEcheance: i.date_echeance,
    tauxCoupon: i.taux_coupon,
    convention: i.convention,
    frequence: i.frequence,
    profil: i.profil,
    differeMois: i.differe_mois,
    precompte: i.precompte,
    tauxRetenue: i.taux_retenue,
    nominalUnitaire: i.nominal_unitaire ?? 0,
  };
}

export const SQL_INSTRUMENTS = `
  select i.id, i.code_interne, i.isin, i.libelle, e.nom as emetteur, i.pays_code, i.zone, i.type_code, i.devise_code,
         i.nominal_unitaire, i.date_emission, i.date_echeance, i.taux_coupon, i.convention, i.frequence, i.profil,
         i.differe_mois, i.precompte, i.taux_retenue, i.statut, i.echeancier_officiel_valide
    from instruments i left join emetteurs e on e.id = i.emetteur_id`;

/** Valeur de classification applicable à une date (dernière date d'effet ≤ date). */
function classificationA(
  liste: { instrument_id: string; position_id: string | null; referentiel: string; valeur: string; date_effet: string }[],
  referentiel: string,
  date: string,
  instrumentId: string,
  positionId: string | null,
): string {
  const candidats = liste
    .filter((c) => c.referentiel === referentiel && c.instrument_id === instrumentId && c.date_effet <= date)
    .filter((c) => c.position_id === null || c.position_id === positionId)
    .sort((a, b) => (a.position_id ? 1 : 0) - (b.position_id ? 1 : 0) || a.date_effet.localeCompare(b.date_effet));
  return candidats.length ? candidats[candidats.length - 1].valeur : "";
}

export async function chargerDonnees(s: Session, date: string): Promise<DonneesPortefeuille> {
  const pf = pfAutorises(s);
  const [instruments, officiels, classes, positions, operations, echeances, grevages, feries] = await Promise.all([
    lire<LigneInstrument>(SQL_INSTRUMENTS),
    lire<{ instrument_id: string; date_echeance: string; part_capital: number }>(
      "select instrument_id, date_echeance, part_capital from echeancier_officiel order by date_echeance",
    ),
    lire<{ instrument_id: string; position_id: string | null; referentiel: string; valeur: string; date_effet: string }>(
      "select instrument_id, position_id, referentiel, valeur, date_effet from classifications",
    ),
    lire<{
      id: string;
      instrument_id: string;
      portefeuille_id: string;
      portefeuille: string;
      conservateur: string;
      compte_conservation: string;
      statut: string;
      nominal_releve: number | null;
      date_releve: string | null;
    }>(
      `select p.id, p.instrument_id, p.portefeuille_id, f.libelle as portefeuille, c.nom as conservateur,
              p.compte_conservation, p.statut, p.nominal_releve, p.date_releve
         from positions p join portefeuilles f on f.id = p.portefeuille_id join conservateurs c on c.id = p.conservateur_id
        where (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[]))`,
      [pf],
    ),
    lire<{
      id: string;
      type: TypeOperation;
      statut: string;
      date_effet: string;
      nominal: number;
      quantite: number | null;
      position_id: string;
      position_destination_id: string | null;
    }>(
      "select id, type, statut, date_effet, nominal, quantite, position_id, position_destination_id from operations where statut in ('valide','regle')",
    ),
    lire<{
      id: string;
      position_id: string;
      date_contractuelle: string;
      date_reglement_prevue: string;
      capital_du: number;
      interet_brut: number;
      retenue: number;
      net_attendu: number;
      statut_manuel: "litige" | "annulee" | "remplacee" | null;
      explication_ecart: string | null;
      recu: number;
      capital_recu: number;
      interet_recu: number;
    }>(
      // Seuls les encaissements reçus au plus tard à la date d'arrêté sont comptés (situation historique exacte).
      `select e.id, e.position_id, e.date_contractuelle, e.date_reglement_prevue, e.capital_du, e.interet_brut, e.retenue,
              e.net_attendu, e.statut_manuel, e.explication_ecart,
              coalesce(x.recu, 0) as recu, coalesce(x.capital, 0) as capital_recu, coalesce(x.interet, 0) as interet_recu
         from echeances e join positions p on p.id = e.position_id
         left join (select echeance_id, sum(montant) as recu, sum(montant_capital) as capital, sum(montant_interet) as interet
                      from encaissements where statut = 'actif' and date_valeur <= $2 group by echeance_id) x on x.echeance_id = e.id
        where (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[]))`,
      [pf, date],
    ),
    lire<{
      id: string;
      position_id: string;
      beneficiaire: string;
      nominal_affecte: number;
      valeur_retenue: number | null;
      financement_obtenu: number | null;
      date_debut: string;
      date_fin: string | null;
      statut: string;
    }>(
      `select g.id, g.position_id, b.nom as beneficiaire, g.nominal_affecte, g.valeur_retenue, g.financement_obtenu,
              g.date_debut, g.date_fin, g.statut
         from grevages g join contreparties b on b.id = g.beneficiaire_id`,
    ),
    lire<{ date: string }>("select date from jours_feries"),
  ]);

  const officielParInstrument = new Map<string, { date: string; partCapital: number }[]>();
  for (const o of officiels) {
    const l = officielParInstrument.get(o.instrument_id) ?? [];
    l.push({ date: o.date_echeance, partCapital: o.part_capital });
    officielParInstrument.set(o.instrument_id, l);
  }

  return {
    instruments: instruments.map((i) =>
      versInstrumentDonnees(
        i,
        officielParInstrument.get(i.id) ?? null,
        classificationA(classes, "comptable", date, i.id, null),
        classificationA(classes, "notation", date, i.id, null),
      ),
    ),
    positions: positions.map((p) => ({
      id: p.id,
      instrumentId: p.instrument_id,
      portefeuille: p.portefeuille,
      portefeuilleId: p.portefeuille_id,
      conservateur: p.conservateur,
      compte: p.compte_conservation,
      statut: p.statut,
      classification: classificationA(classes, "comptable", date, p.instrument_id, p.id),
      nominalReleve: p.nominal_releve,
      dateReleve: p.date_releve,
    })),
    operations: operations.map(
      (o): OperationCalc => ({
        id: o.id,
        type: o.type,
        statut: o.statut,
        dateEffet: o.date_effet,
        nominal: o.nominal,
        quantite: o.quantite,
        positionId: o.position_id,
        positionDestinationId: o.position_destination_id,
      }),
    ),
    echeances: echeances.map((e) => ({
      id: e.id,
      positionId: e.position_id,
      dateContractuelle: e.date_contractuelle,
      dateReglementPrevue: e.date_reglement_prevue,
      capitalDu: e.capital_du,
      interetBrut: e.interet_brut,
      retenue: e.retenue,
      netAttendu: e.net_attendu,
      statutManuel: e.statut_manuel,
      explicationEcart: e.explication_ecart,
      montantRecu: e.recu,
      capitalRecu: e.capital_recu,
      interetRecu: e.interet_recu,
    })),
    grevages: grevages.map((g) => ({
      id: g.id,
      positionId: g.position_id,
      beneficiaire: g.beneficiaire,
      nominalAffecte: g.nominal_affecte,
      valeurRetenue: g.valeur_retenue,
      financementObtenu: g.financement_obtenu,
      dateDebut: g.date_debut,
      dateFin: g.date_fin,
      statut: g.statut,
    })),
    feries: new Set(feries.map((f) => f.date)),
  };
}

export async function lireTranches(): Promise<Tranche[]> {
  const t = await lire<{ libelle: string; borne_min: number; borne_max: number | null }>(
    "select libelle, borne_min, borne_max from tranches_maturite order by ordre, borne_min",
  );
  return t.map((x) => ({ libelle: x.libelle, min: x.borne_min, max: x.borne_max }));
}

export interface Analyse {
  situation: Situation;
  controles: Controle[];
  parametres: Parametres;
  date: string;
  aujourdhui: string;
}

/** Situation et contrôles à une date : point d'entrée unique des écrans de restitution. */
export async function analyser(s: Session, date?: string | null): Promise<Analyse> {
  const jour = aujourdhui();
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : jour;
  const [donnees, parametres, tranches] = await Promise.all([chargerDonnees(s, d), lireParametres(), lireTranches()]);
  const situation = calculerSituation(donnees, d, {
    tranches,
    toleranceJours: parametres.toleranceEncaissement,
    aujourdhui: d < jour ? d : jour,
  });
  const controles = controlerSituation(situation, {
    aujourdhui: d < jour ? d : jour,
    seuilsEcheance: parametres.seuilsAlerte,
    toleranceJours: parametres.toleranceEncaissement,
    limiteConcentration: parametres.limiteConcentration,
  });
  return { situation, controles, parametres, date: d, aujourdhui: jour };
}

export interface FluxEncaisses {
  devise: string;
  capital: number;
  interet: number;
  nombre: number;
}

/** Capital et intérêts effectivement encaissés entre deux dates (incluses), par devise. */
export async function fluxEncaisses(s: Session, du: string, au: string): Promise<FluxEncaisses[]> {
  return lire<FluxEncaisses>(
    `select i.devise_code as devise, coalesce(sum(x.montant_capital), 0) as capital, coalesce(sum(x.montant_interet), 0) as interet,
            count(*)::int as nombre
       from encaissements x join positions p on p.id = x.position_id join instruments i on i.id = p.instrument_id
      where x.statut = 'actif' and x.date_valeur between $2 and $3
        and (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[]))
      group by i.devise_code`,
    [pfAutorises(s), du, au],
  );
}
