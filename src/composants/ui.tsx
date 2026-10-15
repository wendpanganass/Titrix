/**
 * Bibliothèque de composants d'affichage (sans état, utilisables côté serveur).
 */
import type { ReactNode } from "react";
import { Icone, type NomIcone } from "./icones";

export function Carte({
  titre,
  sousTitre,
  action,
  flush,
  className = "",
  children,
}: {
  titre?: ReactNode;
  sousTitre?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`sec ${className}`}>
      {(titre || action) && (
        <div className="sec-h">
          <div>
            {titre && <h3>{titre}</h3>}
            {sousTitre && <p>{sousTitre}</p>}
          </div>
          {action && <div className="noprint actions">{action}</div>}
        </div>
      )}
      <div className={`sec-b ${flush ? "flush" : ""}`}>{children}</div>
    </section>
  );
}

export type Ton = "info" | "bon" | "alerte" | "erreur" | "gris";

const COULEURS_TON: Record<Ton, string> = {
  info: "var(--acc)",
  bon: "var(--grn)",
  alerte: "var(--amb)",
  erreur: "var(--red)",
  gris: "var(--mut)",
};

export function Indicateur({
  libelle,
  valeur,
  unite,
  detail,
  icone,
  ton = "info",
}: {
  libelle: string;
  valeur: ReactNode;
  unite?: string;
  detail?: ReactNode;
  icone: NomIcone;
  ton?: Ton;
}) {
  const c = COULEURS_TON[ton];
  return (
    <div className="kpi">
      <div className="k-tete">
        <span className="k-ico" style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>
          <Icone nom={icone} />
        </span>
        <span className="k-lib" title={libelle}>
          {libelle}
        </span>
      </div>
      <div className="k-val chiffre">
        {valeur}
        {unite && <small>{unite}</small>}
      </div>
      {detail && <div className="k-det">{detail}</div>}
    </div>
  );
}

export function TitreZone({ children, precision }: { children: ReactNode; precision?: ReactNode }) {
  return (
    <h2 className="zone">
      {children}
      {precision && <small>{precision}</small>}
    </h2>
  );
}

export function Badge({ ton = "info", children }: { ton?: Ton; children: ReactNode }) {
  return <span className={`pastille p-${ton}`}>{children}</span>;
}

export function Message({ ton = "info", children }: { ton?: Exclude<Ton, "gris">; children: ReactNode }) {
  return (
    <div className={`note note-${ton}`} role={ton === "erreur" ? "alert" : "status"}>
      <Icone nom={ton === "bon" ? "coche" : ton === "info" ? "info" : "alerte"} />
      <div>{children}</div>
    </div>
  );
}

export function Vide({ children }: { children: ReactNode }) {
  return <div className="vide">{children}</div>;
}

/** Barres horizontales dessinées en HTML (affichage immédiat, impression propre). */
export function Barres({
  lignes,
  format,
  couleur = "var(--viz-1)",
}: {
  lignes: { nom: string; valeur: number; detail?: string }[];
  format: (x: number) => string;
  couleur?: string;
}) {
  const max = Math.max(...lignes.map((l) => Math.abs(l.valeur)), 1e-9);
  return (
    <div className="barres">
      {lignes.map((l) => (
        <div className="barre" key={l.nom} title={l.detail ?? l.nom}>
          <span className="nom">{l.nom}</span>
          <span className="piste">
            <i style={{ width: `${(Math.abs(l.valeur) / max) * 100}%`, background: couleur }} />
          </span>
          <span className="val">{format(l.valeur)}</span>
        </div>
      ))}
    </div>
  );
}

export function EnTeteImpression({ titre, sousTitre }: { titre: string; sousTitre: string }) {
  return (
    <div className="printhdr">
      <b>{titre}</b>
      <span>{sousTitre}</span>
    </div>
  );
}

/** Champ de formulaire avec libellé (même hauteur partout). */
export function Champ({
  libelle,
  obligatoire,
  aide,
  className = "",
  children,
}: {
  libelle: string;
  obligatoire?: boolean;
  aide?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={className}>
      <span className="lib">
        {libelle}
        {obligatoire && <span className="obl">*</span>}
      </span>
      {children}
      {aide && <div className="aide">{aide}</div>}
    </label>
  );
}
