/**
 * Positions : détention par portefeuille et conservateur, situation à la date d'arrêté.
 */
import Link from "next/link";
import { SelecteurDate } from "@/composants/client/Coquille";
import { Formulaire } from "@/composants/client/Formulaire";
import { AvisPerimetre } from "@/composants/AvisPerimetre";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Badge, Carte, Champ, EnTeteImpression, Message, Vide } from "@/composants/ui";
import { creerPosition } from "@/app/actions/positions";
import { analyser } from "@/donnees/portefeuille";
import { listesReferentiels } from "@/donnees/referentiels";
import { lire } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateFr, montant } from "@/lib/format";

export default async function Positions(props: PageProps<"/positions">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const val = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const [a, r, instruments, sansMouvement] = await Promise.all([
    analyser(s, val("date") || null),
    listesReferentiels(),
    lire<{ id: string; code_interne: string; libelle: string }>("select id, code_interne, libelle from instruments where statut <> 'rejete' order by code_interne"),
    lire<{ id: string; code: string; libelle: string; portefeuille: string; conservateur: string; compte: string }>(
      `select p.id, i.code_interne as code, i.libelle, f.libelle as portefeuille, c.nom as conservateur, p.compte_conservation as compte
         from positions p join instruments i on i.id = p.instrument_id join portefeuilles f on f.id = p.portefeuille_id
         join conservateurs c on c.id = p.conservateur_id
        where not exists (select 1 from operations o where (o.position_id = p.id or o.position_destination_id = p.id) and o.statut in ('valide','regle'))
          and (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[]))`,
      [s.u.portefeuilles],
    ),
  ]);
  const texte = val("q").toLowerCase();
  const lignes = a.situation.lignes
    .filter((l) => !val("portefeuille") || l.position.portefeuilleId === val("portefeuille"))
    .filter((l) => !val("conservateur") || l.position.conservateur === val("conservateur"))
    .filter((l) => !val("instrument") || l.instrument.id === val("instrument"))
    .filter((l) => val("soldees") === "1" || l.nominal !== 0)
    .filter((l) => !texte || `${l.instrument.code} ${l.instrument.isin ?? ""} ${l.instrument.libelle} ${l.instrument.emetteur} ${l.position.compte}`.toLowerCase().includes(texte))
    .sort((x, y) => x.instrument.code.localeCompare(y.instrument.code) || x.position.conservateur.localeCompare(y.position.conservateur));
  const filtre = val("q") || val("portefeuille") || val("conservateur") || val("instrument") || val("soldees");
  const devises = [...new Set(lignes.map((l) => l.instrument.devise))];
  const pfAutorises = r.portefeuilles.filter((p) => p.actif && (!s.u.portefeuilles.length || s.u.portefeuilles.includes(p.id)));

  return (
    <>
      <EnTete titre="Positions" sousTitre={`Détention par portefeuille et conservateur au ${dateFr(a.date)}`} droite={<SelecteurDate date={a.date} />} />
      <Contenu>
        <EnTeteImpression titre={`Positions au ${dateFr(a.date)}`} sousTitre={a.parametres.nomEtablissement} />
        <AvisPerimetre s={s} date={a.date} />
        <form className="barre-filtres noprint" method="get">
          <input type="hidden" name="date" value={a.date} />
          <input className="champ" name="q" defaultValue={val("q")} placeholder="Code, ISIN, libellé, émetteur, compte…" style={{ minWidth: 240 }} />
          <select className="champ" name="portefeuille" defaultValue={val("portefeuille")}>
            <option value="">Tous les portefeuilles</option>
            {r.portefeuilles.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
          </select>
          <select className="champ" name="conservateur" defaultValue={val("conservateur")}>
            <option value="">Tous les conservateurs</option>
            {r.conservateurs.map((c) => <option key={c.id} value={c.nom}>{c.nom}</option>)}
          </select>
          <label className="case"><input type="checkbox" name="soldees" value="1" defaultChecked={val("soldees") === "1"} /> Inclure les soldées</label>
          <button className="btn-sec">Filtrer</button>
          {filtre && <Link className="btn-sec" href={`/positions?date=${a.date}`}>Réinitialiser</Link>}
        </form>
        {sansMouvement.length > 0 && (
          <Message ton="alerte">
            {sansMouvement.length} position(s) sans opération validée :{" "}
            {sansMouvement.slice(0, 5).map((p, k) => (
              <span key={p.id}>{k > 0 && ", "}<Link href={`/positions/${p.id}`}>{p.code} · {p.conservateur}</Link></span>
            ))}
            {sansMouvement.length > 5 && "…"} — saisissez leur acquisition ou leur position d&apos;ouverture.
          </Message>
        )}
        <Carte titre={`${lignes.length} position(s)`} sousTitre={devises.length > 1 ? "Plusieurs devises : les totaux sont donnés par devise" : "Nominal disponible = nominal détenu − nominal grevé actif"} flush>
          {lignes.length === 0 ? (
            <Vide>Aucune position à cette date.</Vide>
          ) : (
            <div className="tab-wrap">
              <table className="tab">
                <thead>
                  <tr><th>Instrument</th><th>Portefeuille</th><th>Conservateur · compte</th><th>Échéance</th><th className="d">Nominal détenu</th><th className="d">Grevé</th><th className="d">Disponible</th><th className="d" title="Intérêts courus non échus">ICNE</th><th>Maturité</th><th>Devise</th></tr>
                </thead>
                <tbody>
                  {lignes.map((l) => (
                    <tr key={l.position.id}>
                      <td><Link href={`/positions/${l.position.id}`}><b>{l.instrument.code}</b></Link><div className="petit mut">{l.instrument.libelle}</div></td>
                      <td>{l.position.portefeuille}</td>
                      <td>{l.position.conservateur}{l.position.compte && <div className="petit mut">{l.position.compte}</div>}</td>
                      <td className="nowrap">{dateFr(l.instrument.dateEcheance)}</td>
                      <td className="d"><b>{montant(l.nominal)}</b>{l.capitalEchuNonRembourse > 0 && <div className="petit neg">dont échu {montant(l.capitalEchuNonRembourse)}</div>}</td>
                      <td className="d">{montant(l.nominalGreve)}</td>
                      <td className={`d ${l.nominalDisponible < 0 ? "neg" : ""}`}>{montant(l.nominalDisponible)}</td>
                      <td className="d">{montant(l.couponCouru)}</td>
                      <td><Badge ton={l.tranche === "Échu" ? "erreur" : "gris"}>{l.tranche}</Badge></td>
                      <td>{l.instrument.devise}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {devises.map((d) => {
                    const ls = lignes.filter((l) => l.instrument.devise === d);
                    const t = (f: (l: (typeof ls)[number]) => number) => ls.reduce((x, l) => x + f(l), 0);
                    return (
                      <tr key={d}>
                        <td colSpan={4}>Total {d}</td>
                        <td className="d">{montant(t((l) => l.nominal))}</td>
                        <td className="d">{montant(t((l) => l.nominalGreve))}</td>
                        <td className="d">{montant(t((l) => l.nominalDisponible))}</td>
                        <td className="d">{montant(t((l) => l.couponCouru))}</td>
                        <td colSpan={2}>{d}</td>
                      </tr>
                    );
                  })}
                </tfoot>
              </table>
            </div>
          )}
        </Carte>
        {s.peut("saisir_operation") && (
          <Carte titre="Ouvrir une position" sousTitre="Une position = un instrument détenu dans un portefeuille, chez un conservateur, sur un compte. Son nominal résultera des opérations validées.">
            <details className="depliant" open={Boolean(val("instrument"))}>
              <summary>Nouvelle position</summary>
              <Formulaire action={creerPosition} bouton="Créer la position" reinitialiser>
                <div className="form-grille quatre" style={{ marginTop: 12 }}>
                  <Champ libelle="Instrument" obligatoire>
                    <select className="champ" name="instrument_id" required defaultValue={val("instrument")}>
                      <option value="">—</option>
                      {instruments.map((i) => <option key={i.id} value={i.id}>{i.code_interne} — {i.libelle}</option>)}
                    </select>
                  </Champ>
                  <Champ libelle="Portefeuille" obligatoire>
                    <select className="champ" name="portefeuille_id" required>
                      {pfAutorises.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
                    </select>
                  </Champ>
                  <Champ libelle="Conservateur" obligatoire>
                    <select className="champ" name="conservateur_id" required>
                      <option value="">—</option>
                      {r.conservateurs.filter((c) => c.actif).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </Champ>
                  <Champ libelle="Compte de conservation"><input className="champ" name="compte_conservation" /></Champ>
                  <Champ libelle="Identifiant d'origine" aide="Ex. code avec suffixe du classeur" className="plein"><input className="champ" name="identifiant_position" /></Champ>
                </div>
              </Formulaire>
              {r.conservateurs.length === 0 && <Message ton="alerte">Aucun conservateur : créez-en dans <Link href="/referentiels?onglet=conservateurs">Référentiels</Link>.</Message>}
            </details>
          </Carte>
        )}
      </Contenu>
    </>
  );
}
