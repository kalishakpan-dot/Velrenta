// app/sitemap.ts  → /sitemap.xml
import type { MetadataRoute } from 'next';
import { getAllSummaries, SITE_URL } from './lib/market';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const prices = await getAllSummaries();
  return [
    { url: `${SITE_URL}/prices`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/insights`, changeFrequency: 'daily', priority: 0.8 },
    ...prices.map((p) => ({
      url: `${SITE_URL}/prices/${p.slug}`,
      lastModified: new Date(p.updatedAt),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
  ];
}
