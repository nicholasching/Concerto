import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Concerto · Operator" };
export const viewport = { themeColor: "#0a0908", width: "device-width", initialScale: 1 };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,300&display=swap" />
    </head>
    <body>{children}</body>
  </html>;
}
