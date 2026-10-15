/**
 * Opérations : liste filtrable, file de validation, validation groupée.
 */
import Link from "next/link";
import { Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { StatutOperation } from "@/composants/Statuts";
import { Carte, Message, Vide } from "@/composants/ui";
import { validerSelection } from "@/app/actions/operations";
import { lire } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateFr, montant } from "@/lib/format";
import { LIBELLES_OPERATION, TYPES_OPERATION, type TypeOperation } from "@/moteur";

export default async function Operations(props: PageProps<"/operations">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const val = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const vue = val("vue"); // "a_valider" : file du validateur
  const lignes = await lire<{
    id: string; numero: number; type: TypeOperation; date_effet: string; nominal: number; statut: string; code: string; libelle: string;
    conservateur: string; portefeuille: string; destination: string | null; initiateur: string | null; initiateur_id: string; devise: string;
    impact_retroactif: string | null; position_id: string; cree_le: string;
  }>(
    `select o.id, o.numero, o.type, o.date_effet, o.nominal, o.statut, i.code_interne as code, i.libelle, c.nom as conservateur,
            f.libelle as portefeuille, cd.nom as destination, u.nom as initiateur, o.initiateur_id, i.devise_code as devise,
            o.impact_retroactif, o.position_id, o.cree_le
       from operations o join positions p on p.id = o.position_id join instruments i on i.id = p.instrument_id
       join conservateurs c on c.id = p.conservateur_id join portefeuilles f on f.id = p.portefeuille_id
       left join positions pd on pd.id = o.position_destination_id left join conservateurs cd on cd.id = pd.conservateur_id
       left join utilisateurs u on u.id = o.initiateur_id
      where (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[]))
        and ($2 = '' or o.statut = $2) and ($3 = '' or o.type = $3) and ($4 = '' or o.position_id::text = $4 or o.position_destination_id::text = $4)
        and ($5 = '' or i.code_interne ilike '%'||$5||'%' or i.libelle ilike '%'||$5||'%' or o.reference ilike '%'||$5||'%' or o.numero::text = $5)
        and ($6 <> 'a_valider' or (o.statut = 'soumis' and o.initiateur_id <> $7))
      order by o.date_effet desc, o.numero desc limit 500`,
    [s.u.portefeuilles, val("statut"), val("type"), val("position"), val("q"), vue, s.u.id],
  );
  const filtre = val("statut") || val("type") || val("position") || val("q") || vue;
  const aValider = s.peut("valider") && vue === "a_valider";

  const tableau = (
    <div className="tab-wrap">
      <table className="tab">
        <thead>
          <tr>
            {aValider && <th className="noprint"></th>}
            <th>N°</th><th>Type</th><th>Instrument</th><th>Conservateur · portefeuille</th><th>Date d&apos;effet</th><th className="d">Nominal</th><th>Initiateur</th><th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((o) => (
            <tr key={o.id} className={o.statut === "annule" ? "annule" : ""}>
              {aValider && <td className="noprint"><input type="checkbox" name="ids" value={o.id} aria-label={`Sélectionner l'opération ${o.numero}`} /></td>}
              <td><Link href={`/operations/${o.id}`}><b>{o.numero}</b></Link></td>
              <td>{LIBELLES_OPERATION[o.type]}{o.impact_retroactif && <div className="petit" style={{ color: "var(--amb)" }}>Rétrodatée</div>}</td>
              <td><Link href={`/positions/${o.position_id}`}>{o.code}</Link><div className="petit mut">{o.libelle}</div></td>
              <td>{o.conservateur}{o.destination && <> → {o.destination}</>}<div className="petit mut">{o.portefeuille}</div></td>
              <td className="nowrap">{dateFr(o.date_effet)}</td>
              <td className="d">{montant(o.nominal)} <span className="petit mut">{o.devise}</span></td>
              <td>{o.initiateur ?? "—"}</td>
              <td><StatutOperation s={o.statut} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <EnTete titre="Opérations" sousTitre="Circuit : Brouillon → Soumis → Validé ou Rejeté → Réglé. Une opération n'est jamais validée par son initiateur." />
      <Contenu>
        <nav className="stknav noprint">
          <Link href="/operations" className={!vue && !val("statut") ? "on" : ""}>Toutes</Link>
          {s.peut("valider") && <Link href="/operations?vue=a_valider" className={vue === "a_valider" ? "on" : ""}>À valider par moi</Link>}
          <Link href="/operations?statut=brouillon" className={val("statut") === "brouillon" ? "on" : ""}>Brouillons</Link>
          <Link href="/operations?statut=soumis" className={val("statut") === "soumis" && !vue ? "on" : ""}>Soumises</Link>
          <Link href="/operations?statut=valide" className={val("statut") === "valide" ? "on" : ""}>Validées non réglées</Link>
          <Link href="/operations?statut=rejete" className={val("statut") === "rejete" ? "on" : ""}>Rejetées</Link>
          <Link href="/operations?statut=annule" className={val("statut") === "annule" ? "on" : ""}>Annulées</Link>
        </nav>
        <form className="barre-filtres noprint" method="get">
          {vue && <input type="hidden" name="vue" value={vue} />}
          {val("statut") && <input type="hidden" name="statut" value={val("statut")} />}
          <input className="champ" name="q" defaultValue={val("q")} placeholder="N°, code, libellé, référence…" />
          <select className="champ" name="type" defaultValue={val("type")}>
            <option value="">Tous les types</option>
            {TYPES_OPERATION.map((t) => <option key={t} value={t}>{LIBELLES_OPERATION[t]}</option>)}
          </select>
          <button className="btn-sec">Filtrer</button>
          {filtre && <Link className="btn-sec" href="/operations">Réinitialiser</Link>}
        </form>
        {s.peut("saisir_operation") && (
          <Message ton="info">Pour saisir une opération, ouvrez la <Link href="/positions">position</Link> concernée (ou créez-la), puis utilisez « Nouvelle opération ».</Message>
        )}
        <Carte titre={`${lignes.length} opération(s)`} sousTitre={lignes.length === 500 ? "500 dernières affichées : affinez les filtres" : undefined} flush>
          {lignes.length === 0 ? (
            <Vide>Aucune opération{filtre ? " pour ces filtres" : ""}.</Vide>
          ) : aValider ? (
            <Formulaire action={validerSelection} bouton="Valider les opérations cochées" confirmation="Valider les opérations cochées ? Vérifiez chaque pièce justificative au préalable.">
              {tableau}
            </Formulaire>
          ) : (
            tableau
          )}
        </Carte>
      </Contenu>
    </>
  );
}
