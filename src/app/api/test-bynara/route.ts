// Temporary diagnostic: test Bynara grok-imagine from Vercel runtime.
// Returns timing and HTTP status without leaking key.
// To be removed after trace.
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const key = process.env.BYNARA_API_KEY;
  if (!key) return NextResponse.json({ ok: false, reason: "no BYNARA_API_KEY" }, { status: 500 });
  const prompt =
    "A realistic photograph of a young woman in a modest university student uniform with a hijab, wearing a fitted blouse. She stands in a quiet library aisle, reaching to select a book from a wooden bookshelf.";
  const body = {
    prompt: prompt + " Avoid: blur, low resolution, cartoon style",
    model: "grok-imagine",
    n: 1,
    size: "1024x1024",
    response_format: "b64_json",
  };
  const url = "https://api-images.bynara.id/v1/images/generations";
  const start = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 40000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsed = Date.now() - start;
    const text = await r.text();
    let keys: string[] = [];
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      keys = Object.keys(j);
    } catch {}
    return NextResponse.json(
      { ok: r.ok, status: r.status, elapsedMs: elapsed, keys, trunc: text.slice(0, 800) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const elapsed = Date.now() - start;
    return NextResponse.json(
      { ok: false, elapsedMs: elapsed, error: String(e) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(t);
  }
}
