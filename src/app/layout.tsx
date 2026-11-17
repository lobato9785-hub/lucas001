import './globals.css';

export const metadata = {
  title: 'Estamparia | Produção',
  description: 'Visão e apontamento da produção',
  applicationName: 'Estamparia',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Estamparia',
    statusBarStyle: 'black-translucent'
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg'
  }
};

export const viewport = {
  themeColor: '#080d13',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
