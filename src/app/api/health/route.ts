import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  services: {
    database: {
      status: 'up' | 'down';
      latency?: number;
      error?: string;
    };
  };
}

export async function GET() {
  const startTime = Date.now();
  const services: HealthStatus['services'] = {
    database: { status: 'down' },
  };

  // Check database connection
  try {
    const dbStart = Date.now();
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    services.database = {
      status: 'up',
      latency: Date.now() - dbStart,
    };
  } catch (error) {
    services.database = {
      status: 'down',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const overallStatus: 'healthy' | 'degraded' | 'unhealthy' =
    services.database.status === 'up' ? 'healthy' : 'unhealthy';

  const response: HealthStatus = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    services,
  };

  const statusCode = overallStatus === 'healthy' ? 200 : 503;

  return NextResponse.json(response, { status: statusCode });
}
