import './globals.css';
export const metadata = { title: 'Estamparia | Produção', description: 'Visão e apontamento da produção' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
