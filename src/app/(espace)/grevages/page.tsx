/**
 * Grevages : situation par position et par bénéficiaire, création, file de validation.
 * Nominal disponible = nominal résiduel détenu − nominal grevé actif (le financement n'est jamais soustrait).
 */
import Link from "next/link";
import { Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { StatutGrevage } from "@/composants/Statuts";
import { Barres, Carte, Champ, Message, Vide } from "@/composants/ui";
import { creerGrevage } from "@/app/actions/grevages";
import { lire } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { compact, dateFr, montant } from "@/lib/format";

export default async function Grevages(props: PageProps<"/grevages">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const val = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const [lignes, positions, beneficiaires] = await Promise.all([
    lire<{
      id: string; statut: string; nominal_affecte: number; valeur_retenue: number | null; financement_obtenu: number | null; date_debut: string;
      date_fin: string | null; beneficiaire: string; code: string; conservateur: string; devise: string; position_id: string; date_echeance: string | null;
      initiateur: string | null; initiateur_id: string;
    }>(
      `select g.id, g.statut, g.nominal_affecte, g.valeur_retenue, g.financement_obtenu, g.date_debut, g.date_fin, b.nom as beneficiaire,
              i.code_interne as code, c.nom as conservateur, i.devise_code as devise, g.position_id, i.date_echeance, u.nom as initiateur, g.initiateur_id
         from grevages g join contreparties b on b.id = g.beneficiaire_id join positions p on p.id = g.position_id
         join instruments i on i.id = p.instrument_id join conservateurs c on c.id = p.conservateur_id
         left join utilisateurs u on u.id = g.initiateur_id
        where (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[]))
          and ($2 = '' or g.statut = $2) and ($3 = '' or g.position_id::text = $3)
        order by case g.statut when 'soumis' then 0 when 'actif' then 1 when 'brouillon' then 2 else 3 end, g.date_debut desc`,
      [s.u.portefeuilles, val("statut"), val("position")],
    ),
    lire<{ id: string; libelle: string; disponible: number; devise: string }>(
      `select p.id, i.code_interne || ' · ' || c.nom || ' · ' || f.libelle as libelle,
              p.nominal_actuel - nominal_greve_actif(p.id) as disponible, i.devise_code as devise
         from positions p join instruments i on i.id = p.instrument_id join conservateurs c on c.id = p.conservateur_id
         join portefeuilles f on f.id = p.portefeuille_id
        where p.nominal_actuel > 0 and (cardinality($1::uuid[]) = 0 or p.portefeuille_id = any($1::uuid[])) order by 2`,
      [s.u.portefeuilles],
    ),
    lire<{ id: string; nom: string }>("select id, nom from contreparties where actif and role in ('beneficiaire','les_deux') order by nom"),
  ]);
  const actifs = lignes.filter((g) => g.statut === "actif" && (!g.date_fin || g.date_fin > new Date().toISOString().slice(0, 10)));
  const parBeneficiaire = new Map<string, number>();
  for (const g of actifs) parBeneficiaire.set(`${g.beneficiaire} (${g.devise})`, (parBeneficiaire.get(`${g.beneficiaire} (${g.devise})`) ?? 0) + g.nominal_affecte);

  return (
    <>
      <EnTete titre="Grevages" sousTitre="Titres affectés en garantie, par bénéficiaire, avec contrôle du disponible avant validation" />
      <Contenu>
        <nav className="stknav noprint">
          <Link href="/grevages" className={!val("statut") ? "on" : ""}>Tous</Link>
          <Link href="/grevages?statut=soumis" className={val("statut") === "soumis" ? "on" : ""}>À valider</Link>
          <Link href="/grevages?statut=actif" className={val("statut") === "actif" ? "on" : ""}>Actifs</Link>
          <Link href="/grevages?statut=leve" className={val("statut") === "leve" ? "on" : ""}>Levés</Link>
          <Link href="/grevages?statut=brouillon" className={val("statut") === "brouillon" ? "on" : ""}>Brouillons</Link>
        </nav>
        <div className="rangee deux-un">
          <Carte titre={`${lignes.length} grevage(s)`} flush>
            {lignes.length === 0 ? <Vide>Aucun grevage.</Vide> : (
              <div className="tab-wrap">
                <table className="tab">
                  <thead><tr><th>Bénéficiaire</th><th>Position</th><th className="d">Nominal affecté</th><th className="d">Valeur retenue</th><th className="d">Financement</th><th>Période</th><th>Statut</th></tr></thead>
                  <tbody>
                    {lignes.map((g) => (
                      <tr key={g.id}>
                        <td><Link href={`/grevages/${g.id}`}><b>{g.beneficiaire}</b></Link></td>
                        <td><Link href={`/positions/${g.position_id}`}>{g.code}</Link><div className="petit mut">{g.conservateur} · échéance {dateFr(g.date_echeance)}</div></td>
                        <td className="d">{montant(g.nominal_affecte)} <span className="petit mut">{g.devise}</span></td>
                        <td className="d">{montant(g.valeur_retenue)}</td>
                        <td className="d">{montant(g.financement_obtenu)}</td>
                        <td className="nowrap petit">{dateFr(g.date_debut)} → {g.date_fin ? dateFr(g.date_fin) : "…"}</td>
                        <td><StatutGrevage s={g.statut} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Carte>
          <Carte titre="Nominal grevé actif par bénéficiaire">
            {parBeneficiaire.size === 0 ? <Vide>Aucun grevage actif.</Vide> : (
              <Barres lignes={[...parBeneficiaire.entries()].sort((a, b) => b[1] - a[1]).map(([nom, v]) => ({ nom, valeur: v }))} format={compact} couleur="var(--viz-4)" />
            )}
          </Carte>
        </div>
        {s.peut("grever") && (
          <Carte titre="Nouveau grevage" sousTitre="Le contrôle du disponible est refait par la base au moment de la validation.">
            {beneficiaires.length === 0 && <Message ton="alerte">Créez d&apos;abord un bénéficiaire dans <Link href="/referentiels?onglet=contreparties">Référentiels → Contreparties</Link>.</Message>}
            <Formulaire action={creerGrevage} bouton="Enregistrer" reinitialiser>
              <div className="form-grille quatre">
                <Champ libelle="Position" obligatoire className="plein">
                  <select className="champ" name="position_id" required defaultValue={val("position")}>
                    <option value="">—</option>
                    {positions.map((p) => <option key={p.id} value={p.id}>{p.libelle} — disponible {montant(p.disponible)} {p.devise}</option>)}
                  </select>
                </Champ>
                <Champ libelle="Bénéficiaire" obligatoire>
                  <select className="champ" name="beneficiaire_id" required>
                    <option value="">—</option>
                    {beneficiaires.map((b) => <option key={b.id} value={b.id}>{b.nom}</option>)}
                  </select>
                </Champ>
                <Champ libelle="Nominal affecté" obligatoire aide="Même mesure que le nominal détenu"><input className="champ" name="nominal_affecte" inputMode="decimal" required /></Champ>
                <Champ libelle="Décote (%)" aide="Valeur retenue proposée = nominal × (1 − décote)"><input className="champ" name="decote_pct" inputMode="decimal" /></Champ>
                <Champ libelle="Valeur retenue en garantie"><input className="champ" name="valeur_retenue" inputMode="decimal" /></Champ>
                <Champ libelle="Financement obtenu" aide="Information : jamais soustrait du nominal"><input className="champ" name="financement_obtenu" inputMode="decimal" /></Champ>
                <Champ libelle="Date de début" obligatoire><input className="champ" type="date" name="date_debut" required /></Champ>
                <Champ libelle="Date de fin prévue"><input className="champ" type="date" name="date_fin" /></Champ>
                <Champ libelle="Référence de la convention"><input className="champ" name="reference_convention" /></Champ>
                <Champ libelle="Commentaire" className="plein"><input className="champ" name="commentaire" /></Champ>
              </div>
              <label className="case" style={{ marginTop: 10 }}><input type="checkbox" name="soumettre" value="1" defaultChecked /> Soumettre directement à validation</label>
            </Formulaire>
          </Carte>
        )}
      </Contenu>
    </>
  );
}
