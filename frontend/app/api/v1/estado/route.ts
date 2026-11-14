import { connection, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

export async function GET() {
  await connection();
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/estado`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // Backend FastAPI no iniciado; responder limpiamente sin traza ECONNRESET
  }

  return NextResponse.json({
    estado: "offline",
    proyecto: "SPHEREx Explorer",
  });
}
