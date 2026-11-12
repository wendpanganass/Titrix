/**
 * États obligatoires (§8.3) : chaque état rend des feuilles (colonnes + lignes) exportables en Excel ou CSV.
 * Les montants de devises différentes ne sont jamais additionnés : chaque état est filtré sur une devise
 * ou porte la devise sur chaque ligne (totaux alors à lire par devise via le filtre automatique).
 */
import "server-only";
import { lire, lireUn } from "@/lib/db";
import type { Session } from "@/lib/session";
import type { Colonne, Ligne } from "@/lib/excel";
import { moisFr } from "@/lib/format";
import { analyser } from "./portefeuille";
import type { Photographie } from "./arretes";
import { ajouterMois, anneeDe, arrondi2, fluxProjetes, interetNet, joursEntre, LIBELLES_NIVEAU, LIBELLES_OPERATION, LIBELLES_STATUT_ECHEANCE, moisDe, type TypeOperation } from "@/moteur";

export const ETATS = {
  inventaire: "Inventaire détaillé du portefeuille",
  echeancier: "Échéancier par instrument et position",
  tombees: "Synthèse mensuelle et annuelle des tombées",
  tombees_isin: "Tombées de capital et d'intérêts par mois, par code ISIN",
  grevage: "Situation du grevage",
  encaissements: "État des encaissements et impayés",
  rapprochement: "Rapprochement par conservateur",
  anomalies: "Rapport d'anomalies",
  situation: "Situation à une date d'arrêté",
  historique: "Historique des opérations et validations",
} as const;
export type NomEtat = keyof typeof ETATS;

export interface Feuille {
  nom: string;
  contenu: string;
  colonnes: Colonne[];
  lignes: Ligne[];
}
export interface Etat {
  titre: string;
  date: string;
  devise: string;
  filtres: string;
  feuilles: Feuille[];
  etablissement: string;
}

const COLS_POSITION: Colonne[] = [
  { titre: "Code interne", cle: "code", largeur: 16 },
  { titre: "ISIN", cle: "isin", largeur: 15 },
  { titre: "Libellé", cle: "libelle", largeur: 34 },
  { titre: "Émetteur", cle: "emetteur" },
  { titre: "Pays", cle: "pays", largeur: 8 },
  { titre: "Type", cle: "type", largeur: 9 },
  { titre: "Portefeuille", cle: "portefeuille" },
  { titre: "Conservateur", cle: "conservateur" },
  { titre: "Compte", cle: "compte", largeur: 14 },
  { titre: "Classification", cle: "classification", largeur: 16 },
  { titre: "Échéance", cle: "echeance", format: "date", largeur: 12 },
  { titre: "Taux coupon", cle: "taux", format: "pourcent", largeur: 10 },
  { titre: "Nominal détenu", cle: "nominal", format: "montant", total: true },
  { titre: "Capital échu non remboursé", cle: "echu", format: "montant", total: true },
  { titre: "ICNE (coupon couru)", cle: "couru", format: "montant", total: true },
  { titre: "Nominal grevé", cle: "greve", format: "montant", total: true },
  { titre: "Nominal disponible", cle: "disponible", format: "montant", total: true },
  { titre: "Tranche de maturité", cle: "tranche", largeur: 16 },
  { titre: "Devise", cle: "devise", largeur: 8 },
];

/** Horizons proposés pour les états de tombées (en mois ; 0 = toutes les tombées jusqu'à l'échéance finale). */
export const HORIZONS_TOMBEES = [3, 6, 12, 24, 36, 60, 0] as const;

export async function construireEtat(
  s: Session,
  nom: NomEtat,
  p: { date?: string | null; devise?: string | null; arrete?: string | null; horizon?: string | null },
): Promise<Etat> {
  // Situation à un arrêté figé : on restitue la photographie telle qu'elle a été verrouillée.
  if (nom === "situation" && p.arrete) {
    const a = await lireUn<{ date_arrete: string; statut: string; resultat: Photographie }>("select date_arrete, statut, resultat from arretes where id = $1", [p.arrete]);
    if (a) {
      const etab = (await lireUn<{ valeur: string }>("select valeur from parametres where cle = 'nom_etablissement'"))?.valeur ?? "";
      return {
        titre: `${ETATS.situation} (arrêté ${a.statut})`,
        date: a.date_arrete,
        devise: "Toutes devises (colonne Devise)",
        filtres: `Photographie de l'arrêté (${a.resultat.versionMoteur})`,
        etablissement: etab,
        feuilles: [
          {
            nom: "Situation",
            contenu: `Situation figée au ${a.date_arrete}`,
            colonnes: COLS_POSITION,
            lignes: a.resultat.lignes.map((l) => ({ ...l, echeance: l.dateEcheance, taux: l.tauxCoupon, type: "" })),
          },
        ],
      };
    }
  }

  const a = await analyser(s, p.date ?? null);
  const devise = p.devise || "";
  const lignes = a.situation.lignes.filter((l) => !devise || l.instrument.devise === devise);
  const filtres = [devise && `Devise ${devise}`, s.u.portefeuilles.length && "Périmètre restreint à vos portefeuilles"].filter(Boolean).join(" · ");
  const base = { date: a.date, devise: devise || "Toutes devises (colonne Devise)", filtres, etablissement: a.parametres.nomEtablissement };
  const lignePosition = (l: (typeof lignes)[number]): Ligne => ({
    code: l.instrument.code,
    isin: l.instrument.isin,
    libelle: l.instrument.libelle,
    emetteur: l.instrument.emetteur,
    pays: l.instrument.pays,
    type: l.instrument.type,
    portefeuille: l.position.portefeuille,
    conservateur: l.position.conservateur,
    compte: l.position.compte,
    classification: l.position.classification || l.instrument.classification,
    echeance: l.instrument.dateEcheance,
    taux: l.instrument.precompte ? null : l.instrument.tauxCoupon,
    nominal: l.nominal,
    echu: l.capitalEchuNonRembourse,
    couru: l.couponCouru,
    greve: l.nominalGreve,
    disponible: l.nominalDisponible,
    tranche: l.tranche,
    devise: l.instrument.devise,
  });

  switch (nom) {
    case "inventaire":
    case "situation":
      return {
        ...base,
        titre: ETATS[nom],
        feuilles: [{ nom: "Inventaire", contenu: `${ETATS[nom]} au ${a.date}`, colonnes: COLS_POSITION, lignes: lignes.filter((l) => l.nominal !== 0).map(lignePosition) }],
      };
    case "echeancier": {
      const { flux } = fluxProjetes(lignes, a.date, 365 * 60);
      return {
        ...base,
        titre: ETATS.echeancier,
        feuilles: [
          {
            nom: "Échéancier",
            contenu: `Flux futurs projetés depuis l'encours au ${a.date}`,
            colonnes: [
              { titre: "Date contractuelle", cle: "date", format: "date", largeur: 12 },
              { titre: "Règlement prévu", cle: "reglement", format: "date", largeur: 12 },
              { titre: "Code", cle: "code", largeur: 16 },
              { titre: "Libellé", cle: "libelle", largeur: 32 },
              { titre: "Conservateur", cle: "conservateur" },
              { titre: "Portefeuille", cle: "portefeuille" },
              { titre: "Capital restant dû début", cle: "crd", format: "montant" },
              { titre: "Capital", cle: "capital", format: "montant", total: true },
              { titre: "Intérêts bruts", cle: "interet", format: "montant", total: true },
              { titre: "Retenue", cle: "retenue", format: "montant", total: true },
              { titre: "Net attendu", cle: "net", format: "montant", total: true },
              { titre: "Source", cle: "source", largeur: 10 },
              { titre: "Version moteur", cle: "version", largeur: 16 },
              { titre: "Devise", cle: "devise", largeur: 8 },
            ],
            lignes: flux.map((e) => ({
              date: e.dateContractuelle,
              reglement: e.dateReglementPrevue,
              code: e.ligne.instrument.code,
              libelle: e.ligne.instrument.libelle,
              conservateur: e.ligne.position.conservateur,
              portefeuille: e.ligne.position.portefeuille,
              crd: e.crdDebut,
              capital: e.capitalDu,
              interet: e.interetBrut,
              retenue: e.retenue,
              net: e.netAttendu,
              source: e.source === "officiel" ? "Officiel" : "Généré",
              version: e.versionMoteur,
              devise: e.ligne.instrument.devise,
            })),
          },
        ],
      };
    }
    case "tombees": {
      const { flux } = fluxProjetes(lignes, a.date, 365 * 60);
      const grouper = (cle: (d: string) => string) => {
        const m = new Map<string, Ligne & { capital: number; interet: number; net: number }>();
        for (const e of flux) {
          const k = `${cle(e.dateContractuelle)}|${e.ligne.instrument.devise}`;
          const g = m.get(k) ?? { periode: cle(e.dateContractuelle), devise: e.ligne.instrument.devise, capital: 0, interet: 0, net: 0 };
          g.capital += e.capitalDu;
          g.interet += e.interetBrut;
          g.net += e.netAttendu;
          m.set(k, g);
        }
        return [...m.values()];
      };
      const cols = (t: string): Colonne[] => [
        { titre: t, cle: "periode", largeur: 12 },
        { titre: "Capital", cle: "capital", format: "montant", total: true },
        { titre: "Intérêts bruts", cle: "interet", format: "montant", total: true },
        { titre: "Net attendu", cle: "net", format: "montant", total: true },
        { titre: "Devise", cle: "devise", largeur: 8 },
      ];
      return {
        ...base,
        titre: ETATS.tombees,
        feuilles: [
          { nom: "Mensuel", contenu: "Tombées par mois", colonnes: cols("Mois"), lignes: grouper(moisDe) },
          { nom: "Annuel", contenu: "Tombées par année", colonnes: cols("Année"), lignes: grouper(anneeDe) },
        ],
      };
    }
    case "tombees_isin": {
      // Horizon en mois depuis la date d'arrêté (0 = jusqu'à la dernière tombée).
      const h = Number(p.horizon ?? 12);
      const mois = (HORIZONS_TOMBEES as readonly number[]).includes(h) ? h : 12;
      const fin = mois ? ajouterMois(a.date, mois) : ajouterMois(a.date, 12 * 60);
      const { flux } = fluxProjetes(lignes, a.date, joursEntre(a.date, fin));
      const tri = [...flux]
        .filter((e) => e.dateContractuelle > a.date && Math.abs(e.capitalDu) + Math.abs(e.interetBrut) > 0.005)
        .sort(
          (x, y) =>
            moisDe(x.dateContractuelle).localeCompare(moisDe(y.dateContractuelle)) ||
            x.ligne.instrument.devise.localeCompare(y.ligne.instrument.devise) ||
            x.dateContractuelle.localeCompare(y.dateContractuelle) ||
            (x.ligne.instrument.isin || x.ligne.instrument.code).localeCompare(y.ligne.instrument.isin || y.ligne.instrument.code),
        );
      const libMois = (d: string) => {
        const l = moisFr(moisDe(d));
        return l.charAt(0).toUpperCase() + l.slice(1);
      };
      // Détail : une ligne par tombée, un sous-total par mois (et par devise si plusieurs).
      const detail: Ligne[] = [];
      type Cumul = { mois: string; devise: string; capital: number; interet: number; retenue: number; net: number; tombees: number; isin: Set<string> };
      const synthese: Cumul[] = [];
      let courant: Cumul | null = null;
      const cloturer = () => {
        if (!courant) return;
        detail.push({
          _sousTotal: 1,
          mois: `Total ${courant.mois}`,
          libelle: `${courant.tombees} tombée(s) · ${courant.isin.size} titre(s)`,
          capital: arrondi2(courant.capital),
          interet: arrondi2(courant.interet),
          retenue: arrondi2(courant.retenue),
          interet_net: arrondi2(courant.interet - courant.retenue),
          net: arrondi2(courant.net),
          devise: courant.devise,
        });
        synthese.push(courant);
      };
      for (const e of tri) {
        const m = libMois(e.dateContractuelle);
        const dev = e.ligne.instrument.devise;
        if (!courant || courant.mois !== m || courant.devise !== dev) {
          cloturer();
          courant = { mois: m, devise: dev, capital: 0, interet: 0, retenue: 0, net: 0, tombees: 0, isin: new Set() };
        }
        courant.capital += e.capitalDu;
        courant.interet += e.interetBrut;
        courant.retenue += e.retenue;
        courant.net += e.netAttendu;
        courant.tombees++;
        courant.isin.add(e.ligne.instrument.isin || e.ligne.instrument.code);
        detail.push({
          mois: m,
          date: e.dateContractuelle,
          reglement: e.dateReglementPrevue,
          isin: e.ligne.instrument.isin || "",
          code: e.ligne.instrument.code,
          libelle: e.ligne.instrument.libelle,
          emetteur: e.ligne.instrument.emetteur,
          conservateur: e.ligne.position.conservateur,
          portefeuille: e.ligne.position.portefeuille,
          capital: e.capitalDu,
          interet: e.interetBrut,
          retenue: e.retenue,
          interet_net: arrondi2(e.interetBrut - e.retenue),
          net: e.netAttendu,
          devise: dev,
        });
      }
      cloturer();
      const periode = mois ? `du ${a.date} au ${fin} (${mois} mois)` : `à partir du ${a.date}, jusqu'à la dernière tombée`;
      return {
        ...base,
        titre: ETATS.tombees_isin,
        filtres: [base.filtres, mois ? `Horizon ${mois} mois` : "Toutes les tombées"].filter(Boolean).join(" · "),
        feuilles: [
          {
            nom: "Tombées par mois",
            contenu: `Tombées de capital et d'intérêts ${periode}, par mois et par code ISIN`,
            colonnes: [
              { titre: "Mois", cle: "mois", largeur: 18 },
              { titre: "Date de tombée", cle: "date", format: "date", largeur: 12 },
              { titre: "Règlement prévu", cle: "reglement", format: "date", largeur: 12 },
              { titre: "Code ISIN", cle: "isin", largeur: 15 },
              { titre: "Code interne", cle: "code", largeur: 16 },
              { titre: "Libellé", cle: "libelle", largeur: 30 },
              { titre: "Émetteur", cle: "emetteur" },
              { titre: "Conservateur", cle: "conservateur" },
              { titre: "Portefeuille", cle: "portefeuille" },
              { titre: "Capital", cle: "capital", format: "montant", total: true },
              { titre: "Intérêts bruts", cle: "interet", format: "montant", total: true },
              { titre: "Retenue", cle: "retenue", format: "montant", total: true },
              { titre: "Intérêts nets", cle: "interet_net", format: "montant", total: true },
              { titre: "Total net (capital + intérêts nets)", cle: "net", format: "montant", total: true },
              { titre: "Devise", cle: "devise", largeur: 8 },
            ],
            lignes: detail,
          },
          {
            nom: "Synthèse mensuelle",
            contenu: `Totaux par mois ${periode}`,
            colonnes: [
              { titre: "Mois", cle: "mois", largeur: 18 },
              { titre: "Tombées", cle: "tombees", format: "entier", largeur: 10 },
              { titre: "Titres (ISIN)", cle: "titres", format: "entier", largeur: 12 },
              { titre: "Capital", cle: "capital", format: "montant", total: true },
              { titre: "Intérêts bruts", cle: "interet", format: "montant", total: true },
              { titre: "Retenue", cle: "retenue", format: "montant", total: true },
              { titre: "Intérêts nets", cle: "interet_net", format: "montant", total: true },
              { titre: "Total net", cle: "net", format: "montant", total: true },
              { titre: "Devise", cle: "devise", largeur: 8 },
            ],
            lignes: synthese.map((x) => ({
              mois: x.mois,
              tombees: x.tombees,
              titres: x.isin.size,
              capital: arrondi2(x.capital),
              interet: arrondi2(x.interet),
              retenue: arrondi2(x.retenue),
              interet_net: arrondi2(x.interet - x.retenue),
              net: arrondi2(x.net),
              devise: x.devise,
            })),
          },
        ],
      };
    }
    case "grevage": {
      const g = await lire<Ligne>(
        `select b.nom as beneficiaire, i.code_interne as code, i.libelle, c.nom as conservateur, f.libelle as portefeuille, g.statut,
                g.nominal_affecte as nominal, g.decote_pct as decote, g.valeur_retenue as valeur, g.financement_obtenu as financement,
                g.date_debut as debut, g.date_fin as fin, i.date_echeance as echeance, g.reference_convention as convention, i.devise_code as devise
           from grevages g join contreparties b on b.id = g.beneficiaire_id join positions p on p.id = g.position_id
           join instruments i on i.id = p.instrument_id join conservateurs c on c.id = p.conservateur_id join portefeuilles f on f.id = p.portefeuille_id
          where g.statut in ('actif','leve','soumis') and g.date_debut <= $1 and (cardinality($2::uuid[]) = 0 or p.portefeuille_id = any($2::uuid[]))
            and ($3 = '' or i.devise_code = $3) order by b.nom, i.code_interne`,
        [a.date, s.u.portefeuilles, devise],
      );
      return {
        ...base,
        titre: ETATS.grevage,
        feuilles: [
          {
            nom: "Grevages",
            contenu: `Affectations en garantie au ${a.date}`,
            colonnes: [
              { titre: "Bénéficiaire", cle: "beneficiaire" },
              { titre: "Code", cle: "code", largeur: 16 },
              { titre: "Libellé", cle: "libelle", largeur: 30 },
              { titre: "Conservateur", cle: "conservateur" },
              { titre: "Portefeuille", cle: "portefeuille" },
              { titre: "Statut", cle: "statut", largeur: 10 },
              { titre: "Nominal affecté", cle: "nominal", format: "montant", total: true },
              { titre: "Décote", cle: "decote", format: "pourcent", largeur: 9 },
              { titre: "Valeur retenue", cle: "valeur", format: "montant", total: true },
              { titre: "Financement obtenu", cle: "financement", format: "montant", total: true },
              { titre: "Début", cle: "debut", format: "date", largeur: 12 },
              { titre: "Fin", cle: "fin", format: "date", largeur: 12 },
              { titre: "Échéance du titre", cle: "echeance", format: "date", largeur: 12 },
              { titre: "Convention", cle: "convention" },
              { titre: "Devise", cle: "devise", largeur: 8 },
            ],
            lignes: g,
          },
          {
            nom: "Disponible",
            contenu: "Nominal détenu, grevé et disponible par position",
            colonnes: COLS_POSITION.filter((c) => ["code", "libelle", "portefeuille", "conservateur", "echeance", "nominal", "greve", "disponible", "devise"].includes(c.cle)),
            lignes: lignes.filter((l) => l.nominal !== 0).map(lignePosition),
          },
        ],
      };
    }
    case "encaissements": {
      const ech = a.situation.echeances.filter((e) => e.ligne && (!devise || e.ligne.instrument.devise === devise) && e.dateReglementPrevue <= a.date);
      const debutAnnee = `${a.date.slice(0, 4)}-01-01`;
      const recus = await lire<Ligne>(
        `select x.date_valeur as date, i.code_interne as code, i.libelle, c.nom as conservateur, e.date_contractuelle as echeance,
                x.montant_capital as capital, x.montant_interet as interet, x.montant as total, x.reference, i.devise_code as devise
           from encaissements x join positions p on p.id = x.position_id join instruments i on i.id = p.instrument_id
           join conservateurs c on c.id = p.conservateur_id left join echeances e on e.id = x.echeance_id
          where x.statut = 'actif' and x.date_valeur between $3 and $4
            and (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[])) and ($2 = '' or i.devise_code = $2)
          order by x.date_valeur, i.code_interne`,
        [s.u.portefeuilles, devise, debutAnnee, a.date],
      );
      return {
        ...base,
        titre: ETATS.encaissements,
        feuilles: [
          {
            nom: "Échéances échues",
            contenu: `Échéances échues au ${a.date} : attendu, reçu et reste dû, en capital et en intérêts nets`,
            colonnes: [
              { titre: "Règlement prévu", cle: "date", format: "date", largeur: 12 },
              { titre: "Code", cle: "code", largeur: 16 },
              { titre: "Libellé", cle: "libelle", largeur: 30 },
              { titre: "Conservateur", cle: "conservateur" },
              { titre: "Capital attendu", cle: "capital_attendu", format: "montant", total: true },
              { titre: "Capital reçu", cle: "capital_recu", format: "montant", total: true },
              { titre: "Reste en capital", cle: "reste_capital", format: "montant", total: true },
              { titre: "Intérêts nets attendus", cle: "interet_attendu", format: "montant", total: true },
              { titre: "Intérêts reçus", cle: "interet_recu", format: "montant", total: true },
              { titre: "Reste en intérêts", cle: "reste_interet", format: "montant", total: true },
              { titre: "Net attendu", cle: "attendu", format: "montant", total: true },
              { titre: "Reçu", cle: "recu", format: "montant", total: true },
              { titre: "Reste dû", cle: "reste", format: "montant", total: true },
              { titre: "Statut", cle: "statut", largeur: 18 },
              { titre: "Explication d'écart", cle: "explication", largeur: 30 },
              { titre: "Devise", cle: "devise", largeur: 8 },
            ],
            lignes: ech.map((e) => ({
              date: e.dateReglementPrevue,
              code: e.ligne?.instrument.code,
              libelle: e.ligne?.instrument.libelle,
              conservateur: e.ligne?.position.conservateur,
              capital_attendu: e.capitalDu,
              capital_recu: e.capitalRecu,
              reste_capital: e.resteCapital,
              interet_attendu: interetNet(e),
              interet_recu: e.interetRecu,
              reste_interet: e.resteInteret,
              attendu: e.netAttendu,
              recu: e.montantRecu,
              reste: e.reste,
              statut: LIBELLES_STATUT_ECHEANCE[e.statut],
              explication: e.explicationEcart,
              devise: e.ligne?.instrument.devise,
            })),
          },
          {
            nom: "Encaissements reçus",
            contenu: `Flux reçus du ${debutAnnee} au ${a.date}, ventilés entre capital et intérêts`,
            colonnes: [
              { titre: "Date de valeur", cle: "date", format: "date", largeur: 12 },
              { titre: "Code", cle: "code", largeur: 16 },
              { titre: "Libellé", cle: "libelle", largeur: 30 },
              { titre: "Conservateur", cle: "conservateur" },
              { titre: "Échéance", cle: "echeance", format: "date", largeur: 12 },
              { titre: "Capital", cle: "capital", format: "montant", total: true },
              { titre: "Intérêts", cle: "interet", format: "montant", total: true },
              { titre: "Total", cle: "total", format: "montant", total: true },
              { titre: "Référence", cle: "reference", largeur: 22 },
              { titre: "Devise", cle: "devise", largeur: 8 },
            ],
            lignes: recus,
          },
        ],
      };
    }
    case "rapprochement": {
      const pos = await lire<Ligne>(
        `select c.nom as conservateur, p.compte_conservation as compte, i.code_interne as code, i.libelle, f.libelle as portefeuille,
                p.nominal_actuel as titrix, p.nominal_releve as releve, p.date_releve as date_releve,
                case when p.nominal_releve is null then null else p.nominal_releve - p.nominal_actuel end as ecart, i.devise_code as devise
           from positions p join conservateurs c on c.id = p.conservateur_id join instruments i on i.id = p.instrument_id
           join portefeuilles f on f.id = p.portefeuille_id
          where (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[])) and ($2 = '' or i.devise_code = $2)
            and (p.nominal_actuel <> 0 or p.nominal_releve is not null)
          order by c.nom, i.code_interne`,
        [s.u.portefeuilles, devise],
      );
      return {
        ...base,
        titre: ETATS.rapprochement,
        feuilles: [
          {
            nom: "Rapprochement",
            contenu: "Nominal Titrix (opérations validées) et relevés des conservateurs",
            colonnes: [
              { titre: "Conservateur", cle: "conservateur" },
              { titre: "Compte", cle: "compte", largeur: 14 },
              { titre: "Code", cle: "code", largeur: 16 },
              { titre: "Libellé", cle: "libelle", largeur: 30 },
              { titre: "Portefeuille", cle: "portefeuille" },
              { titre: "Nominal Titrix", cle: "titrix", format: "montant", total: true },
              { titre: "Nominal relevé", cle: "releve", format: "montant", total: true },
              { titre: "Date du relevé", cle: "date_releve", format: "date", largeur: 12 },
              { titre: "Écart", cle: "ecart", format: "montant", total: true },
              { titre: "Devise", cle: "devise", largeur: 8 },
            ],
            lignes: pos,
          },
        ],
      };
    }
    case "anomalies": {
      const suivis = await lire<{ cle: string; statut: string; responsable: string | null; commentaire: string }>(
        "select s.cle, s.statut, u.nom as responsable, s.commentaire from suivi_controles s left join utilisateurs u on u.id = s.responsable_id",
      );
      const parCle = new Map(suivis.map((x) => [x.cle, x]));
      const q = await lire<Ligne>(
        "select i.nom_fichier as fichier, q.numero_ligne as ligne, q.motif, q.statut, q.commentaire from quarantaine q join imports i on i.id = q.import_id order by i.cree_le, q.numero_ligne",
      );
      return {
        ...base,
        titre: ETATS.anomalies,
        feuilles: [
          {
            nom: "Anomalies",
            contenu: "Contrôles automatiques et suivi de traitement",
            colonnes: [
              { titre: "Niveau", cle: "niveau", largeur: 11 },
              { titre: "Contrôle", cle: "famille", largeur: 34 },
              { titre: "Objet", cle: "objet", largeur: 30 },
              { titre: "Détail", cle: "detail", largeur: 60 },
              { titre: "Statut de suivi", cle: "suivi", largeur: 12 },
              { titre: "Responsable", cle: "responsable" },
              { titre: "Commentaire", cle: "commentaire", largeur: 30 },
            ],
            lignes: a.controles.map((c) => ({
              niveau: LIBELLES_NIVEAU[c.niveau],
              famille: c.famille,
              objet: c.libelle,
              detail: c.detail,
              suivi: parCle.get(c.cle)?.statut ?? "nouveau",
              responsable: parCle.get(c.cle)?.responsable,
              commentaire: parCle.get(c.cle)?.commentaire,
            })),
          },
          {
            nom: "Quarantaine",
            contenu: "Lignes d'import en quarantaine (registre de reprise)",
            colonnes: [
              { titre: "Fichier", cle: "fichier", largeur: 28 },
              { titre: "Ligne", cle: "ligne", format: "entier", largeur: 8 },
              { titre: "Motif", cle: "motif", largeur: 60 },
              { titre: "Statut", cle: "statut", largeur: 10 },
              { titre: "Commentaire", cle: "commentaire", largeur: 40 },
            ],
            lignes: q,
          },
        ],
      };
    }
    case "historique": {
      const ops = await lire<Ligne & { type: TypeOperation }>(
        `select o.numero, o.type, i.code_interne as code, c.nom as conservateur, o.date_effet, o.nominal, o.statut, ui.nom as initiateur,
                o.cree_le::date as saisie, uv.nom as validateur, o.valide_le::date as validation, o.motif_rejet, o.motif_annulation,
                o.reference, i.devise_code as devise
           from operations o join positions p on p.id = o.position_id join instruments i on i.id = p.instrument_id
           join conservateurs c on c.id = p.conservateur_id left join utilisateurs ui on ui.id = o.initiateur_id
           left join utilisateurs uv on uv.id = o.validateur_id
          where (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[])) and o.date_effet <= $2
          order by o.date_effet, o.numero`,
        [s.u.portefeuilles, a.date],
      );
      return {
        ...base,
        titre: ETATS.historique,
        feuilles: [
          {
            nom: "Opérations",
            contenu: "Opérations, initiateurs et validateurs",
            colonnes: [
              { titre: "N°", cle: "numero", format: "entier", largeur: 8 },
              { titre: "Type", cle: "type_libelle", largeur: 24 },
              { titre: "Code", cle: "code", largeur: 16 },
              { titre: "Conservateur", cle: "conservateur" },
              { titre: "Date d'effet", cle: "date_effet", format: "date", largeur: 12 },
              { titre: "Nominal", cle: "nominal", format: "montant" },
              { titre: "Statut", cle: "statut", largeur: 10 },
              { titre: "Initiateur", cle: "initiateur" },
              { titre: "Saisie le", cle: "saisie", format: "date", largeur: 12 },
              { titre: "Validateur", cle: "validateur" },
              { titre: "Validée le", cle: "validation", format: "date", largeur: 12 },
              { titre: "Motif de rejet", cle: "motif_rejet", largeur: 24 },
              { titre: "Motif d'annulation", cle: "motif_annulation", largeur: 24 },
              { titre: "Référence", cle: "reference" },
              { titre: "Devise", cle: "devise", largeur: 8 },
            ],
            lignes: ops.map((o) => ({ ...o, type_libelle: LIBELLES_OPERATION[o.type] })),
          },
        ],
      };
    }
  }
}
