import { NextResponse } from 'next/server';
import { Pool } from 'pg';

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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY ?? '';
const CLAUDE_MODEL  = "claude-sonnet-4-5";  // Verified working model identifier

// Relevance threshold — below this score, the RAG context is considered too weak
const RAG_CONFIDENCE_THRESHOLD = 0.35;

function cosineSimilarity(vec1: number[], vec2: number[]): number {
  let dot = 0, mag1 = 0, mag2 = 0;
  for (let i = 0; i < vec1.length; i++) {
    dot  += vec1[i] * vec2[i];
    mag1 += vec1[i] * vec1[i];
    mag2 += vec2[i] * vec2[i];
  }
  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);
  if (mag1 === 0 || mag2 === 0) return 0;
  return dot / (mag1 * mag2);
}

export async function POST(request: Request) {
  try {
    const { question } = await request.json();
    if (!question || typeof question !== 'string') {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    // 1. Generate embedding for the user's question using Gemini
    const embeddingResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-2',
          content: { parts: [{ text: question }] },
        }),
      }
    );
    if (!embeddingResponse.ok) {
      return NextResponse.json({ error: 'Failed to generate query embedding' }, { status: 502 });
    }
    const embeddingData = await embeddingResponse.json();
    const queryEmbedding: number[] = embeddingData.embedding.values;

    // 2. Fetch all stored news chunks from PostgreSQL
    const result = await pool.query('SELECT chunk_text, url, embedding, title FROM biochar_news');
    const rows = result.rows;

    // 3. Cosine similarity ranking — find the most relevant stored passages
    const scored: { score: number; text: string; url: string; title: string }[] = [];
    for (const row of rows) {
      const dbEmbedding: number[] = JSON.parse(row.embedding);
      const score = cosineSimilarity(queryEmbedding, dbEmbedding);
      scored.push({ score, text: row.chunk_text, url: row.url, title: row.title });
    }
    scored.sort((a, b) => b.score - a.score);

    // Source diversity fix: keep only the BEST chunk per unique URL,
    // then rank those winners. This prevents all top-3 slots coming from one site.
    const bestPerSource = new Map<string, { score: number; text: string; url: string; title: string }>();
    for (const item of scored) {
      if (!bestPerSource.has(item.url)) {
        bestPerSource.set(item.url, item);  // First occurrence = highest score for that URL
      }
    }
    // Re-rank the per-source winners by their best score
    const diverseTop = Array.from(bestPerSource.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);  // Take top 5 diverse sources for richer context

    const topScore = diverseTop.length > 0 ? diverseTop[0].score : 0;

    // 4. Decide whether the RAG context is strong enough to be useful
    const hasStrongContext = topScore >= RAG_CONFIDENCE_THRESHOLD && rows.length > 0;

    let contextText = '';
    const sources = new Set<string>();

    if (hasStrongContext) {
      for (let i = 0; i < diverseTop.length; i++) {
        const { score, text, url, title } = diverseTop[i];
        contextText += `\n--- Source ${i + 1} (Relevance: ${score.toFixed(4)}): ${title} ---\n${text}\n`;
        sources.add(url);
      }
    }

    // 5. Build system prompt — changes based on whether we have good RAG context
    let systemPrompt: string;

    if (hasStrongContext) {
      systemPrompt =
        'You are an expert biochar industry analyst with deep knowledge of carbon sequestration, ' +
        'pyrolysis, soil science, and UK environmental policy. ' +
        'You have been given verified news context from the Biochar Directory database. ' +
        'INSTRUCTIONS:\n' +
        '1. Start by answering from the provided context sources — cite them clearly.\n' +
        '2. After the sourced answer, you MAY add 1-2 additional bullet points from your own ' +
        '   general expert knowledge if they are directly relevant and helpful to the user.\n' +
        '3. Clearly label general knowledge bullets with: "(General Knowledge)"\n' +
        '4. Format your response as clear bullet points.\n' +
        '5. Never fabricate specific statistics, company names, or news events.';
    } else {
      systemPrompt =
        'You are an expert biochar industry analyst with deep knowledge of carbon sequestration, ' +
        'pyrolysis, soil science, UK environmental policy, and the global biochar market. ' +
        'The user has asked a question. There is no specific news context available in the database for this query. ' +
        'INSTRUCTIONS:\n' +
        '1. Answer the question fully using your expert general knowledge.\n' +
        '2. Format your response as clear, informative bullet points.\n' +
        '3. If the question is completely unrelated to biochar, carbon, or environmental topics, ' +
        '   politely explain that this is a biochar industry assistant.\n' +
        '4. Never fabricate specific recent statistics or breaking news events.';
    }

    // 6. Build user message
    const userMessage = hasStrongContext
      ? `Verified News Context:\n${contextText}\n\nUser Question: ${question}`
      : `User Question: ${question}`;

    // 7. Call Claude (replaces Groq/Llama)
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.3,  // Slightly creative for general questions, still grounded
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error('Claude API error:', errText);
      return NextResponse.json({ error: 'Claude API failed' }, { status: 502 });
    }

    const claudeData = await claudeResponse.json();
    const answer = claudeData.content[0].text;

    return NextResponse.json({
      answer,
      sources: Array.from(sources),
      topScore,
      mode: hasStrongContext ? 'rag' : 'general',  // Tells the UI which mode was used
    });

  } catch (error) {
    console.error('RAG Query Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
