import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aetheria — Eco del Reino Caído | Action RPG 3D",
  description:
    "Action RPG 3D de fantasía oscura: purifica tres santuarios corruptos, crece en poder y derrota a Bel'Zaroth, el Caballero Caído. Combate con combos, esquivas, jefe con fases y modo infinito.",
  keywords: ["action RPG", "3D", "juego", "fantasía oscura", "Three.js"],
  authors: [{ name: "Aetheria Studio" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#05060a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="antialiased bg-[#05060a] text-stone-200 overflow-hidden overscroll-none">
        {children}
      </body>
    </html>
  );
}
