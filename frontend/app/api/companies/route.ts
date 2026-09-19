import { NextResponse } from 'next/server';
import { Pool } from 'pg';

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
    // Only fetch companies that have been processed by Agent 2
    // We hide PENDING and API_ERROR, but allow APPROVED, UNREGISTERED, and DISSOLVED
    const result = await pool.query(`
      SELECT * FROM biochar_companies 
      WHERE verification_status IS NOT NULL 
      AND verification_status != 'PENDING'
      AND verification_status != 'API_ERROR'
      ORDER BY company_name ASC
    `);
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 });
  }
}
