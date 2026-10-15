import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Titrix", template: "%s · Titrix" },
  description: "Gestion des titres financiers : référentiel, positions, échéanciers, encaissements, grevage et arrêtés.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};

// Applique le mode sombre mémorisé AVANT l'affichage (pas de clignotement).
const scriptTheme = `try{var t=localStorage.getItem('titrix_theme');if(t==='sombre'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: scriptTheme }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
