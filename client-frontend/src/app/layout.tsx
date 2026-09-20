import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Concerto" };
export const viewport = { themeColor: "#16110d", width: "device-width", initialScale: 1 };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&family=Source+Serif+4:opsz,wght@8..60,300;8..60,400&display=swap" />
    </head>
    <body>{children}</body>
  </html>;
}
