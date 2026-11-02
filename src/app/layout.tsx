import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "E-SmartSchool.lk", template: "%s | E-SmartSchool.lk" },
  description: "A focused, secure operating workspace for school teams.",
  applicationName: "E-SmartSchool.lk",
  icons: { icon: "/e-school-logo.png", apple: "/e-school-logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f8fc",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
