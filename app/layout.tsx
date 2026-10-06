import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { PwaSetup } from "@/components/pwa/install";
import { SITE } from "@/lib/site";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: { default: "SonoCBT", template: "%s · SonoCBT" },
  description: SITE.description,
  applicationName: "SonoCBT",
  keywords: ["CBT software for schools in Nigeria", "computer based test software", "school result software", "report card software Nigeria", "broadsheet and positions", "WAEC style grading", "exam software for secondary schools"],
  openGraph: { type: "website", siteName: "SonoCBT", locale: "en_NG", title: "SonoCBT · CBT and results for Nigerian secondary schools", description: SITE.description },
  twitter: { card: "summary_large_image" },
  // Installed on iPhone/iPad: opens full screen with its own name under the icon.
  appleWebApp: { capable: true, title: "SonoCBT", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#14213D",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NG" className={`${jakarta.variable} ${atkinson.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <PwaSetup />
      </body>
    </html>
  );
}
