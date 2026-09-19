import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { NewsItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        user: process.env.POSTGRES_USER ?? 'postgres',
        password: process.env.POSTGRES_PASSWORD,
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: parseInt(process.env.POSTGRES_PORT ?? '5432'),
        database: process.env.POSTGRES_DB ?? 'biochar_db',
      }
);

export async function GET() {
  try {
    // Fetch a larger batch so we can group overlapping chunks belonging to the same article
    const result = await pool.query('SELECT id, title, chunk_text, url, publish_date FROM biochar_news ORDER BY publish_date DESC LIMIT 100');
    
    // Group chunks by URL so we have the full text context for each article
    const articles = new Map<string, { id: string, title: string, date: string, url: string, text: string }>();

    // Blocked domains — filter out any rows that slipped into the DB before the Python blocklist was added
    const BLOCKED_DOMAINS = [
      'yahoo.com', 'fool.com', 'dmagazine.com', 'weeklytimesnow.com.au',
      'thehindubusinessline.com', 'seekingalpha.com', 'businesswire.com',
      'prnewswire.com', 'globenewswire.com', 'accesswire.com',
    ];

    // Junk phrases that should disqualify a chunk entirely
    const JUNK_PHRASES = [
      'vercel security checkpoint', 'enable javascript', 'access to this resource on the server is denied',
      'log out from all devices', 'institutional subscriber', 'remove at least one device',
      'forward-looking statements', "i'll now turn the call over", 'personal fin',
      'cookie policy', 'subscribe to continue reading', 'sign in to read',
      'create a free account', 'this content is for subscribers', 'please log in',
      'we have migrated to a new commenting platform', '403 forbidden', '404 not found',
      'terms & conditions', 'all rights reserved', 'privacy policy', 'log in to comment',
      // Paywall / bot-check messages
      'if you still need to be unlocked', 'accessissues@', 'manages crawler bot traffic',
      'please e-mail us', 'ip address and reference number', 'you have been blocked',
      'your access to this site has been limited', 'human verification', 'are you a robot',
      'ddos protection', 'cloudflare', 'ray id:', 'security check', 'checking your browser',
    ];
    
    for (const row of result.rows) {
      // Skip rows from blocked domains entirely
      if (BLOCKED_DOMAINS.some(domain => row.url.includes(domain))) {
        continue;
      }
      const lower = row.chunk_text.toLowerCase();
      // Skip chunk if it contains any junk phrase
      if (JUNK_PHRASES.some(phrase => lower.includes(phrase))) {
        continue;
      }
      
      if (!articles.has(row.url)) {
        articles.set(row.url, { id: String(row.id), title: row.title, date: row.publish_date, url: row.url, text: '' });
      }
      articles.get(row.url)!.text += " " + row.chunk_text;
    }

    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    
    const newsItems: NewsItem[] = Array.from(articles.values()).map(article => {
      // Find all complete, valid sentences in the combined text of the article
      const segments = Array.from(segmenter.segment(article.text))
        .map(s => s.segment.trim())
        .filter(s => {
          if (s.length < 60) return false; // Ensure substantial sentences (raised from 40)
          if (!/^[A-Z0-9"']/.test(s)) return false;
          if (!/[.!?]["']?$/.test(s)) return false;
          // Reject sentences that still contain junk even after chunk filtering
          const lower = s.toLowerCase();
          if (JUNK_PHRASES.some(phrase => lower.includes(phrase))) return false;
          return true;
        });

      // Deduplicate identical sentences (since scraper chunks overlap by 150 chars)
      const uniqueSegments = Array.from(new Set(segments));

      const bullets = [];
      for (let i = 0; i < 3; i++) {
        if (uniqueSegments[i]) {
          bullets.push(uniqueSegments[i]);
        } else {
          bullets.push(bullets.length > 0 ? "..." : "No detailed summary available.");
        }
      }

      return {
        id: article.id,
        publishedAt: article.date,
        bullets: bullets as [string, string, string],
        sourceName: article.title || 'Industry News',
        sourceUrl: article.url
      };
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()) // Most recent first
    .filter(item => item.bullets[0] !== "No detailed summary available.")
    .slice(0, 15);

    return NextResponse.json(newsItems);
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 });
  }
}
