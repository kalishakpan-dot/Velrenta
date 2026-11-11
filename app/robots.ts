// app/robots.ts  → /robots.txt
import type { MetadataRoute } from 'next';
import { SITE_URL } from './lib/market';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/prices', '/insights'], disallow: ['/supplier', '/pos', '/rfqs', '/api'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
