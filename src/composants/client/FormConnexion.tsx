"use client";
import { useActionState } from "react";
import { connecter, installer } from "@/app/actions/connexion";

export function FormConnexion() {
  const [etat, envoyer, enCours] = useActionState(connecter, { ok: false, message: "" });
  return (
    <form action={envoyer}>
      <label htmlFor="email">Adresse e-mail</label>
      <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      <label htmlFor="mdp">Mot de passe</label>
      <input id="mdp" name="mot_de_passe" type="password" autoComplete="current-password" required />
      {etat.message && (
        <div className="note note-erreur" style={{ marginTop: 14, marginBottom: 0 }} role="alert">
          {etat.message}
        </div>
      )}
      <button className="btn" disabled={enCours}>
        {enCours ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}

export function FormInstallation() {
  const [etat, envoyer, enCours] = useActionState(installer, { ok: false, message: "" });
  return (
    <form action={envoyer}>
      <label htmlFor="nom">Nom et prénom</label>
      <input id="nom" name="nom" type="text" required autoFocus />
      <label htmlFor="email">Adresse e-mail</label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="mdp">Mot de passe (10 caractères minimum, lettres et chiffres)</label>
      <input id="mdp" name="mot_de_passe" type="password" autoComplete="new-password" required minLength={10} />
      <label htmlFor="conf">Confirmation du mot de passe</label>
      <input id="conf" name="confirmation" type="password" autoComplete="new-password" required minLength={10} />
      {etat.message && (
        <div className="note note-erreur" style={{ marginTop: 14, marginBottom: 0 }} role="alert">
          {etat.message}
        </div>
      )}
      <button className="btn" disabled={enCours}>
        {enCours ? "Création…" : "Créer l'administrateur"}
      </button>
    </form>
  );
}
