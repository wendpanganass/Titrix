/**
 * Journal des actions (ajout seul) avec filtres combinables, et audit des données.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Carte, Champ, Vide } from "@/composants/ui";
import { lireJournal } from "@/donnees/journal";
import { lire } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateHeureFr } from "@/lib/format";

const FAMILLES = ["Connexion", "Opération", "Grevage", "Instrument", "Encaissement", "Arrêté", "Import", "Export", "Compte", "Référentiel", "Paramètres", "Pièce"];

export default async function Journal(props: PageProps<"/journal">) {
  const s = await exigerSession();
  if (!s.peut("voir_journal")) notFound();
  const q = await props.searchParams;
  const val = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const f = { utilisateur: val("utilisateur"), action: val("action"), du: val("du"), au: val("au"), recherche: val("q") };
  const [lignes, utilisateurs] = await Promise.all([lireJournal(f), lire<{ id: string; nom: string }>("select id, nom from utilisateurs order by nom")]);
  const actifs = Object.values(f).filter(Boolean).length;
  return (
    <>
      <EnTete titre="Journal et audit" sousTitre="Journal en ajout seul : il ne peut être ni modifié ni effacé, même depuis la base" />
      <Contenu>
        <Carte>
          <form method="get" className="form-grille quatre" style={{ alignItems: "end" }}>
            <Champ libelle="Utilisateur">
              <select className="champ" name="utilisateur" defaultValue={f.utilisateur}><option value="">Tous</option>{utilisateurs.map((u) => <option key={u.id} value={u.id}>{u.nom}</option>)}</select>
            </Champ>
            <Champ libelle="Type d'action">
              <select className="champ" name="action" defaultValue={f.action}><option value="">Toutes</option>{FAMILLES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            </Champ>
            <Champ libelle="Du"><input className="champ" type="date" name="du" defaultValue={f.du} /></Champ>
            <Champ libelle="Au"><input className="champ" type="date" name="au" defaultValue={f.au} /></Champ>
            <Champ libelle="Recherche" className="plein"><input className="champ" name="q" defaultValue={f.recherche} placeholder="Texte dans l'action, l'objet ou le détail" /></Champ>
            <div className="actions">
              <button className="btn">Filtrer</button>
              {actifs > 0 && <Link className="btn-sec" href="/journal">Effacer les filtres ({actifs})</Link>}
            </div>
          </form>
        </Carte>
        <Carte titre={`${lignes.length} action(s)`} sousTitre={lignes.length === 300 ? "300 dernières affichées : affinez les filtres" : undefined} flush>
          {lignes.length === 0 ? <Vide>Aucune action.</Vide> : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Détail</th></tr></thead>
                <tbody>
                  {lignes.map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap">{dateHeureFr(l.date)}</td>
                      <td>{l.utilisateur_nom}</td>
                      <td>{l.action}</td>
                      <td className="petit">{l.objet}{l.objet_id && <div className="mut">{l.objet_id.slice(0, 13)}</div>}</td>
                      <td className="petit" style={{ maxWidth: 420, overflowWrap: "anywhere" }}>{Object.keys(l.details).length ? JSON.stringify(l.details) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Carte>
      </Contenu>
    </>
  );
}
