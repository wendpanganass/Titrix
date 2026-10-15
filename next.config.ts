import type { NextConfig } from "next";

// Configuration Next.js de Titrix.
const configuration: NextConfig = {
  // pg et exceljs restent côté serveur (pas de mise en paquet pour le navigateur).
  serverExternalPackages: ["pg", "exceljs", "bcryptjs"],
  experimental: {
    // Les imports de fichiers Excel passent par des actions serveur : limite Vercel ≈ 4,5 Mo.
    serverActions: { bodySizeLimit: "4.4mb" },
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default configuration;
