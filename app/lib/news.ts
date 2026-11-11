// app/lib/news.ts
// Pulls construction headlines from Google News RSS. We show headline, source and date,
// and link out to the publisher. We never copy article text.

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string; // ISO
}

export const TOPICS = [
  { key: 'all', label: 'All news', query: 'Nigeria construction OR "building materials" OR cement price' },
  { key: 'materials', label: 'Materials & prices', query: 'Nigeria cement OR "iron rod" OR "building materials" price' },
  { key: 'projects', label: 'Projects & roads', query: 'Nigeria construction project OR road OR bridge contract' },
  { key: 'property', label: 'Real estate', query: 'Nigeria real estate OR housing development' },
  { key: 'policy', label: 'Policy & regulation', query: 'Nigeria building regulation OR construction policy OR housing policy' },
] as const;

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();

const pick = (block: string, tag: string) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : '';
};

export async function getNews(topicKey: string, limit = 18): Promise<NewsItem[]> {
  const topic = TOPICS.find((t) => t.key === topicKey) || TOPICS[0];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    topic.query + ' when:14d'
  )}&hl=en-NG&gl=NG&ceid=NG:en`;

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const block = m[1];
      const source = pick(block, 'source');
      let title = pick(block, 'title');
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const date = new Date(pick(block, 'pubDate'));
      return {
        title,
        link: pick(block, 'link'),
        source: source || 'News',
        publishedAt: isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
      };
    });

    const seen = new Set<string>();
    return items
      .filter((i) => i.title && i.link && !seen.has(i.title) && seen.add(i.title))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit);
  } catch (err) {
    console.error('News fetch error:', err);
    return [];
  }
}

export function timeAgo(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}
