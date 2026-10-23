/**
 * Moteur financier — 07. Contrôles automatiques et alertes.
 *
 * Chaque contrôle porte une CLÉ stable : elle relie le point détecté à son suivi
 * (responsable, statut de traitement, commentaire) enregistré en base.
 * Niveaux : « bloquant » (empêche une validation), « erreur », « alerte », « info ».
 */
import { ajouterJours, joursEntre, type DateIso } from "./01_dates";
import { caracteristiquesManquantes } from "./02_echeancier";
import { TOLERANCE_MONTANT } from "./04_encaissements";
import type { Situation } from "./06_portefeuille";

export type Niveau = "bloquant" | "erreur" | "alerte" | "info";

export const LIBELLES_NIVEAU: Record<Niveau, string> = {
  bloquant: "Bloquant",
  erreur: "Erreur",
  alerte: "Alerte",
  info: "Information",
};

export interface Controle {
  cle: string;
  famille: string;
  niveau: Niveau;
  libelle: string;
  detail: string;
  lien: string;
  montant?: number;
  devise?: string;
}

export const FAMILLES_CONTROLE = {
  CARAC: "Caractéristique contractuelle manquante",
  NONVALIDE: "Instrument non validé",
  DIVERGENCE: "Divergence entre positions du même instrument",
  NEGATIF: "Position négative",
  GREVAGE: "Grevage dépassant le nominal disponible",
  GREVAGE_ECH: "Titre grevé proche de l'échéance",
  ECHU: "Titre échu avec capital restant à recouvrer",
  RETARD: "Encaissement non reçu après le délai de tolérance",
  ECART: "Écart d'encaissement non expliqué",
  ECHEANCE: "Échéance prochaine",
  RAPPROCHEMENT: "Écart avec le relevé du conservateur",
  CONCENTRATION: "Dépassement d'une limite de concentration",
  CALCUL: "Calcul impossible",
} as const;

export interface ParametresControles {
  aujourdhui: DateIso;
  /** Seuils d'alerte d'échéance en jours (ex. [30, 15, 7, 0]). */
  seuilsEcheance: number[];
  toleranceJours: number;
  /** Limite de concentration par émetteur, en fraction de l'encours (null = désactivée). */
  limiteConcentration: number | null;
}

export function controlerSituation(s: Situation, p: ParametresControles): Controle[] {
  const sortie: Controle[] = [];
  const fmt = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

  // Instruments utilisés : caractéristiques manquantes, validation.
  const instruments = new Map(s.lignes.map((l) => [l.instrument.id, l.instrument]));
  for (const i of instruments.values()) {
    const manque = caracteristiquesManquantes(i);
    if (manque.length)
      sortie.push({
        cle: `CARAC:${i.id}`,
        famille: FAMILLES_CONTROLE.CARAC,
        niveau: "erreur",
        libelle: `${i.code} — ${i.libelle}`,
        detail: `À compléter : ${manque.join(", ")}. Aucun échéancier ne peut être calculé.`,
        lien: `/instruments/${i.id}`,
      });
    if (i.statut !== "valide")
      sortie.push({
        cle: `NONVALIDE:${i.id}`,
        famille: FAMILLES_CONTROLE.NONVALIDE,
        niveau: "alerte",
        libelle: `${i.code} — ${i.libelle}`,
        detail: "Les caractéristiques n'ont pas été approuvées par un validateur : les projections sont provisoires.",
        lien: `/instruments/${i.id}`,
      });
  }

  // Concentration par émetteur (par devise, pour ne pas additionner des devises différentes).
  if (p.limiteConcentration !== null && p.limiteConcentration > 0) {
    const parDevise = new Map<string, { total: number; emetteurs: Map<string, number> }>();
    for (const l of s.lignes) {
      const d = parDevise.get(l.instrument.devise) ?? { total: 0, emetteurs: new Map() };
      d.total += l.nominal;
      d.emetteurs.set(l.instrument.emetteur, (d.emetteurs.get(l.instrument.emetteur) ?? 0) + l.nominal);
      parDevise.set(l.instrument.devise, d);
    }
    for (const [devise, d] of parDevise)
      for (const [em, n] of d.emetteurs)
        if (d.total > 0 && n / d.total > p.limiteConcentration)
          sortie.push({
            cle: `CONCENTRATION:${devise}:${em}`,
            famille: FAMILLES_CONTROLE.CONCENTRATION,
            niveau: "alerte",
            libelle: `${em} (${devise})`,
            detail: `${((n / d.total) * 100).toFixed(1)} % de l'encours, au-delà de la limite de ${(p.limiteConcentration * 100).toFixed(1)} %.`,
            lien: `/analyses?axe=emetteur`,
            montant: n,
            devise,
          });
  }

  for (const l of s.lignes) {
    const nom = `${l.instrument.code} · ${l.position.conservateur} · ${l.position.portefeuille}`;
    const lien = `/positions/${l.position.id}`;
    const dev = l.instrument.devise;
    if (l.erreurs.length)
      sortie.push({
        cle: `CALCUL:${l.position.id}`,
        famille: FAMILLES_CONTROLE.CALCUL,
        niveau: "erreur",
        libelle: nom,
        detail: l.erreurs.join(" "),
        lien,
      });
    if (l.nominal < -TOLERANCE_MONTANT)
      sortie.push({
        cle: `NEGATIF:${l.position.id}`,
        famille: FAMILLES_CONTROLE.NEGATIF,
        niveau: "bloquant",
        libelle: nom,
        detail: `Nominal détenu négatif : ${fmt(l.nominal)} ${dev}.`,
        lien,
        montant: l.nominal,
        devise: dev,
      });
    if (l.nominalDisponible < -TOLERANCE_MONTANT)
      sortie.push({
        cle: `GREVAGE:${l.position.id}`,
        famille: FAMILLES_CONTROLE.GREVAGE,
        niveau: "bloquant",
        libelle: nom,
        detail: `Nominal grevé ${fmt(l.nominalGreve)} pour un nominal détenu de ${fmt(l.nominal)} : disponible ${fmt(l.nominalDisponible)} ${dev}.`,
        lien,
        montant: l.nominalDisponible,
        devise: dev,
      });
    if (l.nominalGreve > 0 && l.joursRestants !== null && l.joursRestants >= 0 && l.joursRestants <= Math.max(...p.seuilsEcheance, 30))
      sortie.push({
        cle: `GREVAGE_ECH:${l.position.id}:${l.instrument.dateEcheance}`,
        famille: FAMILLES_CONTROLE.GREVAGE_ECH,
        niveau: "alerte",
        libelle: nom,
        detail: `${fmt(l.nominalGreve)} ${dev} grevés, échéance dans ${l.joursRestants} jour(s) : prévoir la mainlevée ou la substitution.`,
        lien,
        montant: l.nominalGreve,
        devise: dev,
      });
    if (l.capitalEchuNonRembourse > TOLERANCE_MONTANT && l.joursRestants !== null && l.joursRestants <= 0)
      sortie.push({
        cle: `ECHU:${l.position.id}`,
        famille: FAMILLES_CONTROLE.ECHU,
        niveau: "erreur",
        libelle: nom,
        detail: `Titre échu le ${l.instrument.dateEcheance} : ${fmt(l.capitalEchuNonRembourse)} ${dev} de capital restent à recouvrer (aucun remboursement constaté).`,
        lien,
        montant: l.capitalEchuNonRembourse,
        devise: dev,
      });
    if (l.position.nominalReleve !== null && Math.abs(l.position.nominalReleve - l.nominal) > TOLERANCE_MONTANT)
      sortie.push({
        cle: `RAPPROCHEMENT:${l.position.id}:${l.position.dateReleve ?? ""}`,
        famille: FAMILLES_CONTROLE.RAPPROCHEMENT,
        niveau: "alerte",
        libelle: nom,
        detail: `Relevé du conservateur ${fmt(l.position.nominalReleve)} au ${l.position.dateReleve ?? "?"}, encours Titrix ${fmt(l.nominal)} : écart ${fmt(l.position.nominalReleve - l.nominal)} ${dev}.`,
        lien,
        montant: l.position.nominalReleve - l.nominal,
        devise: dev,
      });
  }

  // Divergences : même instrument, relevés de conservateurs différents → traité à l'import (quarantaine).

  // Échéances : retards, écarts, échéances prochaines.
  const seuils = [...p.seuilsEcheance].sort((a, b) => b - a);
  for (const e of s.echeances) {
    if (!e.ligne) continue;
    const nom = `${e.ligne.instrument.code} · ${e.ligne.position.conservateur}`;
    const lien = `/encaissements?echeance=${e.id}`;
    const dev = e.ligne.instrument.devise;
    if (e.statut === "en_retard" || (e.statut === "partielle" && e.dateReglementPrevue < ajouterJours(p.aujourdhui, -p.toleranceJours)))
      sortie.push({
        cle: `RETARD:${e.id}`,
        famille: FAMILLES_CONTROLE.RETARD,
        niveau: "erreur",
        libelle: nom,
        detail: `Échéance du ${e.dateReglementPrevue} : ${fmt(e.reste)} ${dev} restent dus — capital ${fmt(Math.max(0, e.resteCapital))}, intérêts ${fmt(Math.max(0, e.resteInteret))} (${joursEntre(e.dateReglementPrevue, p.aujourdhui)} jours de retard).`,
        lien,
        montant: e.reste,
        devise: dev,
      });
    if (e.statut === "encaissee" && Math.abs(e.reste) > TOLERANCE_MONTANT && !e.explicationEcart)
      sortie.push({
        cle: `ECART:${e.id}`,
        famille: FAMILLES_CONTROLE.ECART,
        niveau: "alerte",
        libelle: nom,
        detail: `Échéance du ${e.dateReglementPrevue} : attendu ${fmt(e.netAttendu)}, reçu ${fmt(e.montantRecu)} (écart ${fmt(-e.reste)} ${dev}) sans explication.`,
        lien,
        montant: -e.reste,
        devise: dev,
      });
    if (e.statut === "prevue" || e.statut === "a_encaisser") {
      const j = joursEntre(p.aujourdhui, e.dateReglementPrevue);
      const seuil = seuils.filter((x) => j <= x).pop();
      if (seuil !== undefined && j >= 0)
        sortie.push({
          cle: `ECHEANCE:${e.id}:J-${seuil}`,
          famille: FAMILLES_CONTROLE.ECHEANCE,
          niveau: seuil <= 7 ? "alerte" : "info",
          libelle: nom,
          detail: j === 0 ? `Échéance aujourd'hui : ${fmt(e.netAttendu)} ${dev} attendus.` : `Échéance dans ${j} jour(s) (seuil J-${seuil}) : ${fmt(e.netAttendu)} ${dev} attendus le ${e.dateReglementPrevue}.`,
          lien,
          montant: e.netAttendu,
          devise: dev,
        });
    }
  }
  const ordre: Record<Niveau, number> = { bloquant: 0, erreur: 1, alerte: 2, info: 3 };
  return sortie.sort((a, b) => ordre[a.niveau] - ordre[b.niveau] || a.famille.localeCompare(b.famille));
}
