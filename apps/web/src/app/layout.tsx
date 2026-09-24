import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Platform | Akıllı Randevu ve Üyelik Yönetim Sistemi',
  description: 'Randevu, üyelik kredisi, personel ve müşteri yönetim platformu',
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
