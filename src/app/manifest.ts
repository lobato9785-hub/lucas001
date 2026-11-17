import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Estamparia | Chão de Fábrica',
    short_name: 'Estamparia',
    description: 'Visão e apontamento da produção da Estamparia',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#080d13',
    theme_color: '#080d13',
    lang: 'pt-BR',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
    ]
  };
}
