/**
 * Utilisateurs : comptes, profils cumulables, périmètre de portefeuilles, matrice des droits.
 */
import { notFound } from "next/navigation";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Badge, Carte, Champ, Message } from "@/composants/ui";
import { basculerActif, creerUtilisateur, modifierUtilisateur, reinitialiserMotDePasse } from "@/app/actions/utilisateurs";
import { listesReferentiels } from "@/donnees/referentiels";
import { lire } from "@/lib/db";
import { LISTE_ROLES, matriceDroits, PERMISSIONS, ROLES, type Role } from "@/lib/droits";
import { exigerSession } from "@/lib/session";
import { dateHeureFr } from "@/lib/format";

function CasesRoles({ coches = [] }: { coches?: string[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: "0 12px" }}>
      {LISTE_ROLES.map((r) => (
        <label key={r} className="case"><input type="checkbox" name="roles" value={r} defaultChecked={coches.includes(r)} /> {ROLES[r]}</label>
      ))}
    </div>
  );
}

function CasesPortefeuilles({ liste, coches = [] }: { liste: { id: string; libelle: string }[]; coches?: string[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: "0 12px" }}>
      {liste.map((p) => (
        <label key={p.id} className="case"><input type="checkbox" name="portefeuilles" value={p.id} defaultChecked={coches.includes(p.id)} /> {p.libelle}</label>
      ))}
    </div>
  );
}

export default async function Utilisateurs() {
  const s = await exigerSession();
  if (!s.peut("gerer_utilisateurs")) notFound();
  const [comptes, r] = await Promise.all([
    lire<{ id: string; nom: string; email: string; roles: string[]; actif: boolean; derniere_connexion: string | null; doit_changer_mdp: boolean; bloque: boolean; portefeuilles: string[] }>(
      `select u.id, u.nom, u.email, u.roles, u.actif, u.derniere_connexion, u.doit_changer_mdp, coalesce(u.bloque_jusqua > now(), false) as bloque,
              coalesce(array(select portefeuille_id::text from utilisateurs_portefeuilles x where x.utilisateur_id = u.id), '{}') as portefeuilles
         from utilisateurs u order by u.actif desc, u.nom`,
    ),
    listesReferentiels(),
  ]);
  const matrice = matriceDroits();
  return (
    <>
      <EnTete titre="Utilisateurs" sousTitre="Un compte = une personne. Les profils se cumulent ; personne ne valide ce qu'il a initié." />
      <Contenu>
        <Carte titre={`${comptes.length} compte(s)`} flush>
          <div className="tab-wrap">
            <table className="tab">
              <thead><tr><th>Nom</th><th>Profils</th><th>Périmètre</th><th>Dernière connexion</th><th>État</th><th className="noprint">Actions</th></tr></thead>
              <tbody>
                {comptes.map((u) => {
                  const soi = u.id === s.u.id;
                  return (
                    <tr key={u.id}>
                      <td><b>{u.nom}</b>{soi && " (vous)"}<div className="petit mut">{u.email}</div></td>
                      <td className="petit">{u.roles.map((x) => ROLES[x as Role] ?? x).join(" · ")}</td>
                      <td className="petit">{u.portefeuilles.length ? r.portefeuilles.filter((p) => u.portefeuilles.includes(p.id)).map((p) => p.code).join(", ") : "Tous"}</td>
                      <td className="petit">{dateHeureFr(u.derniere_connexion)}</td>
                      <td>
                        {u.actif ? <Badge ton="bon">Actif</Badge> : <Badge ton="gris">Désactivé</Badge>}
                        {u.bloque && <> <Badge ton="erreur">Bloqué 15 min</Badge></>}
                        {u.doit_changer_mdp && <div className="petit mut">Mot de passe provisoire</div>}
                      </td>
                      <td className="noprint">
                        {!soi && (
                          <details className="depliant">
                            <summary>Gérer</summary>
                            <div style={{ minWidth: 480, paddingTop: 10 }}>
                              <Formulaire action={modifierUtilisateur}>
                                <input type="hidden" name="id" value={u.id} />
                                <Champ libelle="Nom"><input className="champ" name="nom" defaultValue={u.nom} /></Champ>
                                <p className="lib" style={{ marginTop: 10 }}>Profils</p>
                                <CasesRoles coches={u.roles} />
                                <p className="lib" style={{ marginTop: 10 }}>Portefeuilles autorisés (aucun coché = tous)</p>
                                <CasesPortefeuilles liste={r.portefeuilles} coches={u.portefeuilles} />
                              </Formulaire>
                              <div className="actions" style={{ marginTop: 12 }}>
                                <BoutonAction action={basculerActif} champs={{ id: u.id }} libelle={u.actif ? "Désactiver" : "Réactiver"} classe={u.actif ? "btn-danger btn-mini" : "btn-sec btn-mini"} confirmation={u.actif ? "Désactiver ce compte ? Ses sessions seront fermées." : "Réactiver ce compte ?"} />
                              </div>
                              <Formulaire action={reinitialiserMotDePasse} bouton="Nouveau mot de passe provisoire" boutonClasse="btn-sec btn-mini" confirmation="Générer un nouveau mot de passe provisoire ?">
                                <input type="hidden" name="id" value={u.id} />
                              </Formulaire>
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Carte>
        <Carte titre="Créer un compte" sousTitre="Le mot de passe provisoire est affiché une seule fois ; il devra être changé à la première connexion.">
          <Formulaire action={creerUtilisateur} bouton="Créer le compte" reinitialiser>
            <div className="form-grille">
              <Champ libelle="Nom et prénom" obligatoire><input className="champ" name="nom" required /></Champ>
              <Champ libelle="E-mail" obligatoire><input className="champ" type="email" name="email" required /></Champ>
            </div>
            <p className="lib" style={{ marginTop: 12 }}>Profils</p>
            <CasesRoles />
            <p className="lib" style={{ marginTop: 12 }}>Portefeuilles autorisés (aucun coché = tous)</p>
            <CasesPortefeuilles liste={r.portefeuilles} />
          </Formulaire>
        </Carte>
        <Carte titre="Matrice des droits" sousTitre="Ce que chaque profil peut faire en plus de la consultation" flush>
          <div className="tab-wrap">
            <table className="tab">
              <thead><tr><th>Droit</th>{matrice.map((m) => <th key={m.role} className="c" title={m.libelle}>{m.libelle.split(" ")[0]}</th>)}</tr></thead>
              <tbody>
                {Object.entries(PERMISSIONS).map(([p, l]) => (
                  <tr key={p}><td>{l}</td>{matrice.map((m) => <td key={m.role} className="c">{m.permissions.includes(p as never) ? "✔" : ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Carte>
        <Message ton="info">Contrôles complémentaires appliqués par la base : validation et annulation par une autre personne que l&apos;initiateur, un validateur au moins pour approuver, toujours un administrateur actif.</Message>
      </Contenu>
    </>
  );
}
