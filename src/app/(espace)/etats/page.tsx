/**
 * États et exports : les états obligatoires (et l'état des tombées par ISIN) en Excel ou CSV ; PDF par impression de l'écran correspondant.
 */
import Link from "next/link";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Carte, Champ, Message } from "@/composants/ui";
import { ETATS, HORIZONS_TOMBEES, type NomEtat } from "@/donnees/etats";
import { preparerFiltres } from "@/donnees/filtres";
import { analyser } from "@/donnees/portefeuille";
import { Filtres } from "@/composants/client/Filtres";
import { listesReferentiels, lireParametres } from "@/donnees/referentiels";
import { exigerSession } from "@/lib/session";
import { aujourdhui } from "@/lib/format";

const DESCRIPTIONS: Record<NomEtat, [string, string]> = {
  inventaire: ["Une ligne par position : nominal, échu, couru, grevé, disponible, maturité.", "/positions"],
  echeancier: ["Tous les flux futurs projetés depuis l'encours, avec la version du moteur.", "/echeancier?vue=detail"],
  tombees: ["Capital et intérêts par mois et par année.", "/echeancier"],
  tombees_isin: ["Chaque tombée avec son code ISIN et sa date, regroupée par mois (sous-totaux), plus une synthèse mensuelle.", "/echeancier?vue=detail"],
  grevage: ["Affectations par bénéficiaire et disponible par position.", "/grevages"],
  encaissements: ["Échéances échues : attendu, reçu, reste dû, statut.", "/encaissements?vue=toutes"],
  rapprochement: ["Nominal Titrix comparé aux relevés des conservateurs.", "/positions"],
  anomalies: ["Contrôles, suivi de traitement et registre de quarantaine.", "/controles"],
  situation: ["Situation reconstituée à la date choisie (ou photographie d'un arrêté).", "/arretes"],
  historique: ["Opérations, initiateurs, validateurs, motifs.", "/operations"],
};

export default async function Etats(props: PageProps<"/etats">) {
  const s = await exigerSession();
  if (!s.peut("exporter")) return null;
  const q = await props.searchParams;
  const [r, p, a] = await Promise.all([listesReferentiels(), lireParametres(), analyser(s, null)]);
  // Filtres communs à tous les exports (options calculées sur la situation du jour).
  const filtres = await preparerFiltres(q, a.date);
  const suffixe = new URLSearchParams(filtres.adresse).toString();
  const avecFiltres = (lien: string) => (suffixe ? `${lien}${lien.includes("?") ? "&" : "?"}${suffixe}` : lien);
  return (
    <>
      <EnTete titre="États et exports" sousTitre="Chaque état indique la date d'arrêté, les filtres, la devise, l'unité et la date de génération" />
      <Contenu>
        <Message ton="info">
          Choisissez la date d&apos;arrêté et la devise, puis téléchargez l&apos;état. Les montants de devises différentes ne sont jamais additionnés : sans devise choisie, chaque ligne porte sa devise. Pour un PDF, ouvrez l&apos;écran lié puis « Imprimer ». Chaque export est journalisé.
        </Message>
        {a.situation.lignes.length > 0 && (
          <>
            <p className="petit mut" style={{ margin: "0 0 6px" }}>
              <b>Filtres appliqués à tous les exports ci-dessous</b> (rappelés sur la couverture de chaque classeur) :
            </p>
            <Filtres filtres={filtres.listes(a.situation.lignes)} reinitialiser={filtres.actifs.length ? "/etats" : undefined} />
          </>
        )}
        {filtres.actifs.length > 0 && <Message ton="alerte">Exports filtrés — {filtres.resume}.</Message>}
        <Carte titre="Paramètres des exports" flush>
          {Object.entries(ETATS).map(([k, titre]) => (
            <form key={k} method="get" action={`/exports/${k}`} className="ligne-export" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) 150px 130px 130px auto", gap: 12, alignItems: "end", padding: "14px 20px", borderTop: "1px solid var(--line)" }}>
              {Object.entries(filtres.adresse).map(([n, v]) => <input key={n} type="hidden" name={n} value={v} />)}
              <div>
                <b>{titre}</b>
                <div className="petit mut">{DESCRIPTIONS[k as NomEtat][0]} <Link href={avecFiltres(DESCRIPTIONS[k as NomEtat][1])}>Voir à l&apos;écran</Link></div>
              </div>
              <Champ libelle="Date d'arrêté"><input className="champ" type="date" name="date" defaultValue={aujourdhui()} /></Champ>
              <Champ libelle="Devise">
                <select className="champ" name="devise" defaultValue={p.deviseReference}>
                  <option value="">Toutes</option>
                  {r.devises.map((d) => <option key={d.code} value={d.code}>{d.code}</option>)}
                </select>
              </Champ>
              {k === "tombees_isin" ? (
                <Champ libelle="Horizon">
                  <select className="champ" name="horizon" defaultValue="12">
                    {HORIZONS_TOMBEES.map((h) => <option key={h} value={h}>{h ? `${h} mois` : "Toutes"}</option>)}
                  </select>
                </Champ>
              ) : <div />}
              <div className="actions">
                <button className="btn btn-mini" name="format" value="xlsx">Excel</button>
                <button className="btn-sec btn-mini" name="format" value="csv">CSV</button>
              </div>
            </form>
          ))}
        </Carte>
      </Contenu>
    </>
  );
}
