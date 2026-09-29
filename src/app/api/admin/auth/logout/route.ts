import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/identity';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', { maxAge: 0, path: '/' });
  return response;
}
