import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pilates Studio OS | Akıllı Stüdyo Yönetim Sistemi',
  description: 'Randevu, seans kredisi, eğitmen ve üye yönetim platformu',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
