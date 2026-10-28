import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tutrago KDS - Terminal de Barra',
  description: 'Sistema de Visualización de Cocina/Barra (KDS) en tiempo real para Boliches - Tutrago Incubatio',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="bg-[#09090B] text-zinc-100 min-h-screen antialiased flex flex-col">
        {children}
      </body>
    </html>
  );
}
