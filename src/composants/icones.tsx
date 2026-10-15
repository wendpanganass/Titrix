/**
 * Icônes (tracés au trait, 24×24) dessinées sur place : aucune bibliothèque externe.
 */
import type { SVGProps } from "react";

const TRACES = {
  tableau: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  instruments: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5",
  positions: "M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4",
  operations: "M7 7h13l-4-4M17 17H4l4 4",
  echeancier: "M4 5h16v15H4zM4 9h16M9 3v4M15 3v4M8 13h2M12 13h2M8 17h2",
  encaissements: "M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 10v4M18 10v4",
  grevage: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5zM12 15v2",
  analyses: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  arretes: "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4zM9 12l2 2 4-4",
  controles: "M12 3l9 16H3L12 3zM12 10v4M12 17h.01",
  import: "M12 3v12M7 10l5 5 5-5M4 21h16",
  etats: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h7M9 17h7",
  referentiels: "M4 6h16M4 12h16M4 18h10",
  utilisateurs: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  journal: "M4 4h12l4 4v12H4zM8 10h8M8 14h8M8 18h5",
  parametres: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
  validation: "M20 6L9 17l-5-5",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  lune: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  soleil: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  imprimer: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  replier: "M15 18l-6-6 6-6",
  deplier: "M9 18l6-6-6-6",
  coche: "M20 6L9 17l-5-5",
  monnaie: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  horloge: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  alerte: "M12 3l9 16H3L12 3zM12 10v4M12 17h.01",
  telecharger: "M12 3v12M7 10l5 5 5-5M4 21h16",
} as const;
export type NomIcone = keyof typeof TRACES;

export function Icone({ nom, ...p }: { nom: NomIcone } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <path d={TRACES[nom]} />
    </svg>
  );
}

/** Symbole Titrix : trois titres empilés et un liseré or. */
export function Symbole({ taille = 34, clair = false }: { taille?: number; clair?: boolean }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="10" fill={clair ? "#ffffff" : "#1f4e8c"} />
      <rect x="10" y="10" width="20" height="4.5" rx="2" fill={clair ? "#1f4e8c" : "#ffffff"} />
      <rect x="17.75" y="14" width="4.5" height="17" rx="2" fill={clair ? "#1f4e8c" : "#ffffff"} />
      <rect x="10" y="26.5" width="7" height="4.5" rx="2" fill="#d4a017" />
      <rect x="23" y="26.5" width="7" height="4.5" rx="2" fill="#d4a017" />
    </svg>
  );
}
