import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jibon AI | Family life, together",
  description: "One Family. One Dashboard. A Smarter Everyday Life.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
