import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'HostOps AI',
  description: 'Operação de imóveis de hospedagem: reservas, limpeza, atendimento e manutenção.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#4f46e5' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
