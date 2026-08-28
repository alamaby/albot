// TEMPORARY diagnostic endpoint to debug SUPABASE_SECRET_KEY configuration on
// Vercel. Reveals env-var metadata only (length, prefix/suffix) without
// leaking the actual key value. To be REMOVED after the deployment issue is
// resolved. Not protected by a secret so the user can hit it from a browser.

import { NextResponse } from "next/server";
import { resolveAppEnv } from "@/env";

export const runtime = "nodejs";

function fingerprint(value: string | undefined): {
  length: number;
  prefix8: string | null;
  suffix8: string | null;
  looksLikeSbSecret: boolean;
  looksLikeJwt: boolean;
} {
  if (!value) {
    return {
      length: 0,
      prefix8: null,
      suffix8: null,
      looksLikeSbSecret: false,
      looksLikeJwt: false,
    };
  }
  return {
    length: value.length,
    prefix8: value.length >= 8 ? value.slice(0, 8) : value,
    suffix8: value.length >= 8 ? value.slice(-8) : value,
    looksLikeSbSecret: /^sb_secret_/.test(value),
    looksLikeJwt: /^eyJ/.test(value),
  };
}

export async function GET(): Promise<NextResponse> {
  const url = process.env.SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const environment = resolveAppEnv(process.env);

  // URL fingerprint without leaking full host (still reveals project ref).
  const urlMatch = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  const projectRef = urlMatch ? urlMatch[1] : null;

  return NextResponse.json(
    {
      ok: true,
      environment,
      projectRef,
      urlLength: url.length,
      hasSecretKey: !!secretKey,
      hasServiceRoleKey: !!serviceRoleKey,
      secretKey: fingerprint(secretKey),
      serviceRoleKey: fingerprint(serviceRoleKey),
      note: "Temporary diagnostic. Reveals only length + first/last 8 chars; never the full value.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
