import "@/styles/globals.css";
import { generateBasicMetadata, generateWebSiteSchema } from "@/lib/metadata";

export const metadata = generateBasicMetadata();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const webSiteSchema = generateWebSiteSchema();

  return (
    <html lang="ja">
      <head>
        {/* JSON-LD構造化データ */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteSchema) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
