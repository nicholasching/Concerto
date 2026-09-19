import type { ReactNode } from "react";
import "./globals.css";
export const metadata = { title: "Audience Orchestra · Join" };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
