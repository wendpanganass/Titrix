"use client";
/**
 * Formulaire relié à une action serveur : affiche le message de retour (succès ou erreur),
 * désactive le bouton pendant l'envoi, montre une seule fois une valeur secrète (mot de passe provisoire).
 */
import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { Retour } from "@/app/actions/commun";

type Action = (etat: Retour, f: FormData) => Promise<Retour>;

export function BoutonEnvoi({
  children,
  className = "btn",
  confirmation,
  enCours,
}: {
  children: ReactNode;
  className?: string;
  confirmation?: string;
  enCours?: boolean;
}) {
  const statut = useFormStatus();
  const pending = enCours ?? statut.pending;
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirmation && !window.confirm(confirmation)) e.preventDefault();
      }}
    >
      {pending ? "Enregistrement…" : children}
    </button>
  );
}

export function Formulaire({
  action,
  children,
  bouton = "Enregistrer",
  boutonClasse = "btn",
  confirmation,
  reinitialiser = false,
  className = "",
  id,
}: {
  action: Action;
  children: ReactNode;
  bouton?: ReactNode;
  boutonClasse?: string;
  confirmation?: string;
  reinitialiser?: boolean;
  className?: string;
  id?: string;
}) {
  const [etat, envoyer, enCours] = useActionState(action, { ok: false, message: "" });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (etat.ok && reinitialiser) ref.current?.reset();
  }, [etat, reinitialiser]);
  // Envoi manuel : React viderait sinon le formulaire après chaque envoi, même en cas d'erreur
  // (la saisie serait perdue). On ne vide qu'en cas de succès, et seulement si demandé.
  const soumettre = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const donnees = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => envoyer(donnees));
  };
  return (
    <form action={envoyer} onSubmit={soumettre} ref={ref} className={className} id={id}>
      {children}
      {etat.message && (
        <div className={`note ${etat.ok ? "note-bon" : "note-erreur"}`} style={{ marginTop: 14, marginBottom: 0 }} role="status">
          <div>
            {etat.message}
            {etat.secret && (
              <div style={{ marginTop: 6 }}>
                Valeur à transmettre (affichée une seule fois) : <code style={{ fontWeight: 700, fontSize: 14 }}>{etat.secret}</code>
              </div>
            )}
          </div>
        </div>
      )}
      {bouton !== null && (
        <div className="actions" style={{ marginTop: 16 }}>
          <BoutonEnvoi className={boutonClasse} confirmation={confirmation} enCours={enCours}>
            {bouton}
          </BoutonEnvoi>
        </div>
      )}
    </form>
  );
}

/**
 * Bouton d'action en une ligne (valider, rejeter, lever…). Si `motif` est fourni, demande
 * un motif obligatoire avant l'envoi. Le message de retour s'affiche à côté du bouton.
 */
export function BoutonAction({
  action,
  champs,
  libelle,
  classe = "btn-sec btn-mini",
  confirmation,
  motif,
}: {
  action: Action;
  champs: Record<string, string>;
  libelle: string;
  classe?: string;
  confirmation?: string;
  motif?: string;
}) {
  const [etat, envoyer] = useActionState(action, { ok: false, message: "" });
  return (
    <form
      action={envoyer}
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
      onSubmit={(e) => {
        const f = e.currentTarget;
        if (motif) {
          const m = window.prompt(motif);
          if (!m || !m.trim()) {
            e.preventDefault();
            return;
          }
          (f.elements.namedItem("motif") as HTMLInputElement).value = m.trim();
        } else if (confirmation && !window.confirm(confirmation)) e.preventDefault();
      }}
    >
      {Object.entries(champs).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="motif" defaultValue="" />
      <BoutonEnvoi className={classe}>{libelle}</BoutonEnvoi>
      {etat.message && !etat.ok && (
        <span className="petit" style={{ color: "var(--red)", maxWidth: 360 }} role="alert">
          {etat.message}
        </span>
      )}
      {etat.message && etat.ok && (
        <span className="petit" style={{ color: "var(--grn)" }}>
          ✔ {etat.message}
        </span>
      )}
    </form>
  );
}

/** Case « tout cocher / tout décocher » pour les cases d'un même nom dans le formulaire. */
export function ToutCocher({ nom }: { nom: string }) {
  return (
    <input
      type="checkbox"
      title="Tout cocher / tout décocher"
      aria-label="Tout cocher"
      onChange={(e) => {
        const f = e.currentTarget.form;
        f?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${nom}"]`).forEach((c) => (c.checked = e.currentTarget.checked));
      }}
    />
  );
}
