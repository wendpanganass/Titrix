/**
 * Instruments : liste, recherche et création (REF-01).
 */
import Link from "next/link";
import { Formulaire, ToutCocher } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { ChampsInstrument } from "@/composants/FormInstrument";
import { StatutInstrument } from "@/composants/Statuts";
import { Badge, Carte, Message, Vide } from "@/composants/ui";
import { creerInstrument, validerInstrumentsSelection } from "@/app/actions/instruments";
import { lire } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateFr, montant, pourcent } from "@/lib/format";
import { listesReferentiels, lireParametres } from "@/donnees/referentiels";
import { LIBELLES_FREQUENCE } from "@/moteur";

export default async function Instruments(props: PageProps<"/instruments">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const texte = typeof q.q === "string" ? q.q.trim() : "";
  const statut = typeof q.statut === "string" ? q.statut : "";
  const type = typeof q.type === "string" ? q.type : "";
  const [lignes, r, p] = await Promise.all([
    lire<{
      id: string; code_interne: string; isin: string | null; libelle: string; emetteur: string | null; pays_code: string | null;
      type_code: string | null; devise_code: string; date_echeance: string | null; taux_coupon: number; frequence: number;
      profil: string; precompte: boolean; statut: string; positions: number; nominal: number; officiel: boolean; auteur_id: string | null;
    }>(
      `select i.id, i.code_interne, i.isin, i.libelle, e.nom as emetteur, i.pays_code, i.type_code, i.devise_code, i.date_echeance,
              i.taux_coupon, i.frequence, i.profil, i.precompte, i.statut, i.echeancier_officiel_valide as officiel,
              coalesce(i.modifie_par, i.cree_par)::text as auteur_id,
              (select count(*)::int from positions p where p.instrument_id = i.id) as positions,
              (select coalesce(sum(nominal_actuel),0) from positions p where p.instrument_id = i.id) as nominal
         from instruments i left join emetteurs e on e.id = i.emetteur_id
        where ($1 = '' or i.code_interne ilike '%'||$1||'%' or i.isin ilike '%'||$1||'%' or i.libelle ilike '%'||$1||'%' or e.nom ilike '%'||$1||'%')
          and ($2 = '' or i.statut = $2) and ($3 = '' or i.type_code = $3)
        order by i.date_echeance nulls last, i.code_interne limit 1000`,
      [texte, statut, type],
    ),
    listesReferentiels(),
    lireParametres(),
  ]);
  const filtre = texte || statut || type;
  // Validation groupée : réservée au validateur, sur la vue « À valider », hors instruments qu'il a lui-même saisis.
  const groupe = s.peut("valider") && statut === "a_valider";
  return (
    <>
      <EnTete titre="Instruments" sousTitre="Référentiel des titres : caractéristiques communes, indépendantes des positions détenues" />
      <Contenu>
        <form className="barre-filtres noprint" method="get">
          <input className="champ" name="q" defaultValue={texte} placeholder="Code, ISIN, libellé, émetteur…" style={{ minWidth: 260 }} />
          <select className="champ" name="statut" defaultValue={statut}>
            <option value="">Tous les statuts</option>
            <option value="a_valider">À valider</option>
            <option value="valide">Validés</option>
            <option value="rejete">Rejetés</option>
          </select>
          <select className="champ" name="type" defaultValue={type}>
            <option value="">Tous les types</option>
            {r.types.map((t) => <option key={t.code} value={t.code}>{t.libelle}</option>)}
          </select>
          <button className="btn-sec">Filtrer</button>
          {filtre && <Link className="btn-sec" href="/instruments">Réinitialiser</Link>}
        </form>
        {s.peut("valider") && !groupe && lignes.some((i) => i.statut === "a_valider") && (
          <Message ton="alerte">
            {lignes.filter((i) => i.statut === "a_valider").length} instrument(s) attendent la validation de leurs caractéristiques.{" "}
            <Link href="/instruments?statut=a_valider"><b>Les valider en groupe →</b></Link>
          </Message>
        )}
        {groupe && <Message ton="info">Cochez les instruments contrôlés (ou la case d&apos;en-tête pour tout cocher), puis « Valider les caractéristiques cochées » en bas du tableau. Les instruments que vous avez vous-même saisis ou modifiés ne peuvent pas être validés par vous (—).</Message>}
        <Carte titre={`${lignes.length} instrument(s)`} sousTitre="Nominal détenu = somme des positions validées, tous portefeuilles" flush>
          {groupe ? (
            // Le formulaire reste affiché même vide, pour garder visible le message de résultat.
            <Formulaire action={validerInstrumentsSelection} bouton={lignes.length ? "Valider les caractéristiques cochées" : null} className="form-validation"
              confirmation="Valider les caractéristiques des instruments cochés ? Elles serviront au calcul des échéanciers.">
            {lignes.length === 0 ? (
            <Vide>Aucun instrument{filtre ? " ne correspond aux filtres" : " pour l'instant"}.</Vide>
          ) : (
            <div className="tab-wrap">
              <table className="tab">
                <thead>
                  <tr>{groupe && <th className="noprint"><ToutCocher nom="ids" /></th>}<th>Code</th><th>Libellé</th><th>Émetteur</th><th>Type</th><th>Échéance</th><th className="d">Coupon</th><th>Fréquence</th><th className="d">Positions</th><th className="d">Nominal détenu</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {lignes.map((i) => (
                    <tr key={i.id}>
                      {groupe && (
                        <td className="noprint">
                          {i.auteur_id === s.u.id ? <span className="petit mut" title="Vous en êtes l'auteur">—</span> : <input type="checkbox" name="ids" value={i.id} aria-label={`Sélectionner ${i.code_interne}`} />}
                        </td>
                      )}
                      <td className="nowrap"><Link href={`/instruments/${i.id}`}><b>{i.code_interne}</b></Link>{i.isin && i.isin !== i.code_interne && <div className="petit mut">{i.isin}</div>}</td>
                      <td>{i.libelle}{i.officiel && <> <Badge ton="info">Échéancier officiel</Badge></>}</td>
                      <td>{i.emetteur ?? "—"}{i.pays_code && <span className="mut"> · {i.pays_code}</span>}</td>
                      <td>{i.type_code ?? "—"}</td>
                      <td className="nowrap">{dateFr(i.date_echeance)}</td>
                      <td className="d">{i.precompte ? "Précompté" : pourcent(i.taux_coupon, 3)}</td>
                      <td>{LIBELLES_FREQUENCE[i.frequence]}</td>
                      <td className="d">{i.positions}</td>
                      <td className="d">{montant(i.nominal)} <span className="mut petit">{i.devise_code}</span></td>
                      <td><StatutInstrument s={i.statut} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
            </Formulaire>
          ) : (
            <>
          {lignes.length === 0 ? (
            <Vide>Aucun instrument{filtre ? " ne correspond aux filtres" : " pour l'instant"}.</Vide>
          ) : (
            <div className="tab-wrap">
              <table className="tab">
                <thead>
                  <tr>{groupe && <th className="noprint"><ToutCocher nom="ids" /></th>}<th>Code</th><th>Libellé</th><th>Émetteur</th><th>Type</th><th>Échéance</th><th className="d">Coupon</th><th>Fréquence</th><th className="d">Positions</th><th className="d">Nominal détenu</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {lignes.map((i) => (
                    <tr key={i.id}>
                      {groupe && (
                        <td className="noprint">
                          {i.auteur_id === s.u.id ? <span className="petit mut" title="Vous en êtes l'auteur">—</span> : <input type="checkbox" name="ids" value={i.id} aria-label={`Sélectionner ${i.code_interne}`} />}
                        </td>
                      )}
                      <td className="nowrap"><Link href={`/instruments/${i.id}`}><b>{i.code_interne}</b></Link>{i.isin && i.isin !== i.code_interne && <div className="petit mut">{i.isin}</div>}</td>
                      <td>{i.libelle}{i.officiel && <> <Badge ton="info">Échéancier officiel</Badge></>}</td>
                      <td>{i.emetteur ?? "—"}{i.pays_code && <span className="mut"> · {i.pays_code}</span>}</td>
                      <td>{i.type_code ?? "—"}</td>
                      <td className="nowrap">{dateFr(i.date_echeance)}</td>
                      <td className="d">{i.precompte ? "Précompté" : pourcent(i.taux_coupon, 3)}</td>
                      <td>{LIBELLES_FREQUENCE[i.frequence]}</td>
                      <td className="d">{i.positions}</td>
                      <td className="d">{montant(i.nominal)} <span className="mut petit">{i.devise_code}</span></td>
                      <td><StatutInstrument s={i.statut} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
            </>
          )}
        </Carte>
        {s.peut("gerer_instruments") ? (
          <Carte titre="Créer un instrument" sousTitre="L'instrument sera « à valider » : un validateur (autre que vous) devra approuver ses caractéristiques.">
            <details className="depliant">
              <summary>Saisir un nouvel instrument</summary>
              <div style={{ paddingTop: 14 }}>
                <Formulaire action={creerInstrument} bouton="Créer l'instrument" reinitialiser>
                  <ChampsInstrument r={r} conventionDefaut={p.conventionDefaut} deviseDefaut={p.deviseReference} />
                </Formulaire>
              </div>
            </details>
          </Carte>
        ) : (
          <Message ton="info">Consultation seule : la création d&apos;instruments est réservée aux gestionnaires et au back-office.</Message>
        )}
      </Contenu>
    </>
  );
}
