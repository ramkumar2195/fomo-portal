import type { Metadata } from "next";
import { AppProviders } from "@/contexts/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "FOMO Staff Portal",
  description: "Sales and Admin operations portal for FOMO Training",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-900 antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
