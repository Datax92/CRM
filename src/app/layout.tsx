import type { Metadata } from "next";
import { Poppins, Plus_Jakarta_Sans, Manrope } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { DemoBanner } from "@/components/DemoBanner";
import { GlobalLayout } from "@/components/GlobalLayout";

// Poppins is the typeface the approved teal design is drawn in. The CSS
// variable keeps its old name so every existing `--font-jakarta` reference
// in globals.css resolves without a sweep through the stylesheet.
const jakarta = Poppins({
  variable: "--font-jakarta",
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

// The Day End Dashboard design file specifies Plus Jakarta Sans, while the
// Leads design file specifies Poppins. Both are authoritative for their own
// screens, so this is exposed as a second variable and applied only by the
// dashboard rather than replacing the app-wide face.
const dashboardFont = Plus_Jakarta_Sans({
  variable: "--font-dashboard",
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

// Both Employee Directory design files specify Manrope, with a global
// `letter-spacing:-0.01em`. Third variable for the same reason as the second:
// each design file is authoritative for its own screens, and swapping the
// app-wide face to satisfy one of them would silently restyle the others.
const directoryFont = Manrope({
  variable: "--font-directory",
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CRM System",
  description: "Lead Management & CRM Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${dashboardFont.variable} ${directoryFont.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground" suppressHydrationWarning>
        <DemoBanner />
        <AuthProvider>
          <GlobalLayout>{children}</GlobalLayout>
        </AuthProvider>
      </body>
    </html>
  );
}