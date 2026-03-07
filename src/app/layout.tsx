import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pronghorn — AI Enterprise App Generator",
  description:
    "AI-powered enterprise application generator built with GitHub Copilot SDK. Generates production-ready projects with automated repo provisioning and security governance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
