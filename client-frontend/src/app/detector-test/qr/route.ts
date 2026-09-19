import QRCode from "qrcode";
import { headers } from "next/headers";

export async function GET(request: Request) {
  const incoming = await headers();
  const forwardedHost = incoming.get("x-forwarded-host")?.split(",")[0].trim();
  const forwardedProtocol = incoming.get("x-forwarded-proto")?.split(",")[0].trim();
  const origin = forwardedHost
    ? `${forwardedProtocol === "http" ? "http" : "https"}://${forwardedHost}`
    : new URL(request.url).origin;
  const url = new URL("/detector-test", origin).toString();
  const svg = await QRCode.toString(url, { type: "svg", width: 280, margin: 2, errorCorrectionLevel: "M" });
  return new Response(svg, { headers: {
    "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "X-Detector-Test-Url": url,
  } });
}
