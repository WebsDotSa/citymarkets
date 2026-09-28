import { NextResponse } from 'next/server';
import { setCsrfCookie } from '@/lib/csrf';

export async function GET() {
  const response = NextResponse.json({
    success: true,
    message: 'CSRF token refreshed',
  });
  
  // Set a new CSRF cookie
  setCsrfCookie(response);
  
  return response;
}
