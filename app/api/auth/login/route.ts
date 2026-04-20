import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    // Get credentials from environment variables
    const correctUsername = process.env.AUTH_USERNAME || "gopersonal";
    const correctPassword = process.env.AUTH_PASSWORD || "gopersonal-2025";

    // Validate credentials
    if (username === correctUsername && password === correctPassword) {
      // Create a secure session token (simple implementation)
      // In production, you might want to use JWT or a session store
      const sessionToken = Buffer.from(`${username}:${Date.now()}`).toString('base64');
      
      // Set httpOnly cookie for security
      const cookieStore = await cookies();
      cookieStore.set('auth_session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      });

      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { success: false, error: "Usuario o contraseña incorrectos" },
        { status: 401 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Error en el servidor" },
      { status: 500 }
    );
  }
}
