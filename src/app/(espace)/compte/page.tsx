/**
 * Mon compte : identité, profils, changement de mot de passe (obligatoire après un mot de passe provisoire).
 */
import { Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Carte, Champ, Message } from "@/composants/ui";
import { changerMotDePasse } from "@/app/actions/connexion";
import { PERMISSIONS, ROLES, type Role } from "@/lib/droits";
import { exigerSession } from "@/lib/session";

export default async function Compte() {
  const s = await exigerSession();
  return (
    <>
      <EnTete titre="Mon compte" sousTitre={s.u.email} />
      <Contenu>
        {s.u.doitChangerMdp && <Message ton="alerte">Votre mot de passe est provisoire : choisissez-en un nouveau pour accéder à Titrix.</Message>}
        <div className="rangee deux">
          <Carte titre="Identité et droits">
            <dl className="liste-def">
              <dt>Nom</dt><dd>{s.u.nom}</dd>
              <dt>E-mail</dt><dd>{s.u.email}</dd>
              <dt>Profils</dt><dd>{s.u.roles.map((r) => ROLES[r as Role] ?? r).join(" · ")}</dd>
              <dt>Périmètre</dt><dd>{s.u.portefeuilles.length ? `${s.u.portefeuilles.length} portefeuille(s)` : "Tous les portefeuilles"}</dd>
              <dt>Droits</dt><dd>{[...s.permissions].map((p) => PERMISSIONS[p]).join(" · ") || "Consultation"}</dd>
            </dl>
          </Carte>
          <Carte titre="Changer de mot de passe" sousTitre="10 caractères minimum, avec lettres et chiffres">
            <Formulaire action={changerMotDePasse} bouton="Changer le mot de passe" reinitialiser>
              <div className="form-grille">
                <Champ libelle="Mot de passe actuel" obligatoire className="plein"><input className="champ" type="password" name="actuel" autoComplete="current-password" required /></Champ>
                <Champ libelle="Nouveau mot de passe" obligatoire><input className="champ" type="password" name="nouveau" autoComplete="new-password" minLength={10} required /></Champ>
                <Champ libelle="Confirmation" obligatoire><input className="champ" type="password" name="confirmation" autoComplete="new-password" minLength={10} required /></Champ>
              </div>
            </Formulaire>
          </Carte>
        </div>
      </Contenu>
    </>
  );
}
