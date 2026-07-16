// Stateless Worker front door (PLATFORM_SPEC §7): Clerk JWT verification (JWKS),
// room create/join routing via KV, WS upgrade forwarding, Clerk webhooks, static assets.
/// <reference types="@cloudflare/workers-types" />
import { Env } from "./do.js";
export { RoomDO } from "./do.js";
export { Room28DO } from "./do28.js"; // isolated 28 room class (separate DO namespace)

interface WorkerEnv extends Env {
  CLERK_JWKS_URL?: string; // https://<instance>.clerk.accounts.dev/.well-known/jwks.json
  CLERK_WEBHOOK_SECRET?: string;
  CLERK_AUTHORIZED_PARTY?: string; // optional: expected `azp` claim (your app origin), if Clerk sets it
  GUEST_SECRET?: string; // HMAC key for guest tokens — set via `wrangler secret put GUEST_SECRET`
  ASSETS?: Fetcher;
  ROOMS28?: DurableObjectNamespace; // 28 rooms (isolated from ROOMS)
}

// ---- Guest identity (PLATFORM_SPEC §1.1 amendment: hybrid — accounts OR ephemeral guests) ----
// Token: "guest.<id>.<hmac(id)>" — unforgeable with the secret, so a guest's seat can't be hijacked,
// but nothing is stored server-side and nothing persists beyond the browser that holds the token.
//
// GUEST_SECRET must be set in production (`wrangler secret put GUEST_SECRET`). There is no baked-in
// fallback: a known key would let anyone forge guest tokens. In dev (DEV_AUTH=1) a fixed key is used
// so local play works without secrets — this path is never reachable in prod (DEV_AUTH must be unset).
function guestSecret(env: WorkerEnv): string | null {
  if (env.GUEST_SECRET) return env.GUEST_SECRET;
  if (env.DEV_AUTH === "1") return "dev-guest-secret-DO-NOT-USE-IN-PROD";
  return null; // fail closed
}
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function mintGuest(env: WorkerEnv): Promise<{ token: string; accountId: string } | null> {
  const secret = guestSecret(env);
  if (!secret) return null; // GUEST_SECRET unset in prod — refuse to mint forgeable tokens
  const id = `guest_${crypto.randomUUID()}`;
  return { token: `guest.${id}.${await hmac(secret, id)}`, accountId: id };
}
async function verifyGuest(env: WorkerEnv, token: string): Promise<Identity | null> {
  const secret = guestSecret(env);
  if (!secret) return null;
  const [tag, id, sig] = token.split(".");
  if (tag !== "guest" || !id || !sig) return null;
  if (!timingSafeEqual(sig, await hmac(secret, id))) return null;
  return { accountId: id, displayName: "Guest" };
}

// Constant-time string comparison — avoids leaking HMAC/signature bytes via early-exit timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- Svix webhook verification (Clerk uses Svix) ---
// Reproduces the Svix scheme so forged/unsigned POSTs to /api/webhooks/clerk are rejected:
// signed content = `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with the base64 secret
// body (the part after the `whsec_` prefix), compared against any `v1,<sig>` entry in svix-signature.
async function verifySvix(req: Request, body: string, secret?: string): Promise<boolean> {
  if (!secret) return false; // no secret configured → reject (fail closed)
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigHeader = req.headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;

  // Reject stale/future timestamps (±5 min) to blunt replay.
  const tsSec = Number(ts);
  if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 300) return false;

  const rawKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes;
  try {
    keyBytes = Uint8Array.from(atob(rawKey), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new TextEncoder().encode(`${id}.${ts}.${body}`);
  const mac = await crypto.subtle.sign("HMAC", key, signed);
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // svix-signature is a space-separated list of `<version>,<base64sig>` — match any v1 entry.
  return sigHeader.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    return version === "v1" && value !== undefined && timingSafeEqual(value, expected);
  });
}

interface Identity { accountId: string; displayName: string }

// --- Clerk JWT verification via JWKS (RS256), cached ---
let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;

async function verifyClerkJwt(token: string, env: WorkerEnv): Promise<Identity | null> {
  const jwksUrl = env.CLERK_JWKS_URL;
  if (!jwksUrl) return null;
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const header = JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/")));
    if (jwksCache === null || Date.now() - jwksCache.fetchedAt > 3600_000) {
      const res = await fetch(jwksUrl);
      jwksCache = { keys: ((await res.json()) as { keys: JsonWebKey[] }).keys, fetchedAt: Date.now() };
    }
    const jwk = jwksCache.keys.find((k) => (k as { kid?: string }).kid === header.kid);
    if (!jwk) return null;
    // Only accept RS256 — never let an attacker-chosen `alg` (e.g. "none") through.
    if (header.alg !== "RS256") return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const data = new TextEncoder().encode(`${h}.${p}`);
    const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data))) return null;
    const claims = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));

    const now = Date.now();
    const SKEW = 60_000; // 60s clock-skew tolerance
    // Expiry: `exp` must be present and numeric. A missing exp used to pass (NaN < now === false).
    if (typeof claims.exp !== "number" || claims.exp * 1000 < now - SKEW) return null;
    // Not-before / issued-at: reject tokens presented too early.
    if (typeof claims.nbf === "number" && claims.nbf * 1000 > now + SKEW) return null;
    if (typeof claims.iat === "number" && claims.iat * 1000 > now + SKEW) return null;
    // Subject must be a non-empty string.
    if (typeof claims.sub !== "string" || !claims.sub) return null;
    // Issuer must match the Clerk instance we fetched keys from (derived from the JWKS URL origin),
    // so a validly-signed token from a *different* Clerk app can't authenticate here.
    if (claims.iss !== new URL(jwksUrl).origin) return null;
    // Optional authorized-party pinning (Clerk `azp` = the origin the token was minted for).
    if (env.CLERK_AUTHORIZED_PARTY && claims.azp !== env.CLERK_AUTHORIZED_PARTY) return null;

    return { accountId: claims.sub, displayName: claims.name ?? claims.username ?? "Player" };
  } catch {
    return null;
  }
}

async function authenticate(req: Request, env: WorkerEnv): Promise<Identity | null> {
  // Dev mode: DEV_AUTH=1 accepts ?devUser=<id> — local play without Clerk keys. NEVER set in prod.
  if (env.DEV_AUTH === "1") {
    const u = new URL(req.url).searchParams.get("devUser");
    if (u) return { accountId: `dev_${u}`, displayName: u };
  }
  const auth = req.headers.get("Authorization")?.replace(/^Bearer /, "")
    ?? new URL(req.url).searchParams.get("token"); // WS can't set headers from browsers
  if (!auth) return null;
  if (auth.startsWith("guest.")) return verifyGuest(env, auth);
  return verifyClerkJwt(auth, env);
}

function toDO(env: WorkerEnv, roomId: string, path: string, req: Request, id: Identity, nameOverride?: string, avatar?: string): Promise<Response> {
  const stub = env.ROOMS.get(env.ROOMS.idFromString(roomId));
  const headers = new Headers(req.headers);
  headers.set("x-account-id", id.accountId);
  // Display name / avatar: client-supplied (create/join only). Non-security data (PLATFORM_SPEC §1.1) —
  // accountId is the identity; name is length/control-char sanitized, avatar whitelist-validated in core.
  const name = (nameOverride ?? id.displayName).slice(0, 20).replace(/[\p{Cc}\p{Cf}]/gu, "") || "Player";
  headers.set("x-display-name", encodeURIComponent(name));
  if (avatar) headers.set("x-avatar", encodeURIComponent(avatar.slice(0, 8)));
  return stub.fetch(new Request(`https://do${path}`, { method: req.method, headers, body: req.body }));
}

/** Same forwarding, but to the isolated 28 room namespace. */
function toDO28(env: WorkerEnv, roomId: string, path: string, req: Request, id: Identity, nameOverride?: string, avatar?: string): Promise<Response> {
  const stub = env.ROOMS28!.get(env.ROOMS28!.idFromString(roomId));
  const headers = new Headers(req.headers);
  headers.set("x-account-id", id.accountId);
  const name = (nameOverride ?? id.displayName).slice(0, 20).replace(/[\p{Cc}\p{Cf}]/gu, "") || "Player";
  headers.set("x-display-name", encodeURIComponent(name));
  if (avatar) headers.set("x-avatar", encodeURIComponent(avatar.slice(0, 8)));
  return stub.fetch(new Request(`https://do${path}`, { method: req.method, headers, body: req.body }));
}

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(req.url);

    // Clerk webhooks (user.deleted → tombstone; session revocation → close sockets). Svix-verified.
    if (url.pathname === "/api/webhooks/clerk" && req.method === "POST") {
      const body = await req.text();
      const ok = await verifySvix(req, body, env.CLERK_WEBHOOK_SECRET);
      if (!ok) return new Response("invalid signature", { status: 401 });
      // Signature verified. v1: acknowledge only; per-room account cleanup / socket revocation is a
      // tracked follow-up (needs DO-level session invalidation — accounts hold no app PII beyond displayName).
      return new Response("ok");
    }

    // Guest minting: unauthenticated by definition
    if (url.pathname === "/api/guest" && req.method === "POST") {
      const guest = await mintGuest(env);
      if (!guest) return new Response(JSON.stringify({ error: "guest play unavailable" }), { status: 503 });
      return new Response(JSON.stringify(guest), { headers: { "content-type": "application/json" } });
    }

    if (url.pathname.startsWith("/api/")) {
      const id = await authenticate(req, env);
      if (!id) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 });

      if (url.pathname === "/api/rooms" && req.method === "POST") {
        const body = await req.clone().json().catch(() => null) as { displayName?: string; avatar?: string } | null;
        const roomId = env.ROOMS.newUniqueId().toString();
        return toDO(env, roomId, "/create", req, id, body?.displayName, body?.avatar);
      }
      if (url.pathname === "/api/rooms/join" && req.method === "POST") {
        const body = await req.clone().json().catch(() => null) as { code?: string; displayName?: string; avatar?: string } | null;
        const code = body?.code?.toUpperCase();
        const roomId = code ? await env.CODES.get(`code:${code}`) : null;
        if (!roomId) return new Response(JSON.stringify({ error: "invalid or expired code" }), { status: 404 }); // uniform
        return toDO(env, roomId, "/join", req, id, body?.displayName, body?.avatar);
      }
      const m = url.pathname.match(/^\/api\/rooms\/([0-9a-f]+)\/(ws|state|start|addbot|removebot|leave|config)$/);
      if (m) return toDO(env, m[1]!, `/${m[2]}`, req, id);

      // ---- isolated 28 routes (separate DO namespace; Black Queen routing above is untouched) ----
      if (env.ROOMS28) {
        if (url.pathname === "/api/28/rooms" && req.method === "POST") {
          const body = await req.clone().json().catch(() => null) as { displayName?: string; avatar?: string } | null;
          const roomId = env.ROOMS28.newUniqueId().toString();
          return toDO28(env, roomId, "/create", req, id, body?.displayName, body?.avatar);
        }
        if (url.pathname === "/api/28/rooms/join" && req.method === "POST") {
          const body = await req.clone().json().catch(() => null) as { code?: string; displayName?: string; avatar?: string } | null;
          const code = body?.code?.toUpperCase();
          const roomId = code ? await env.CODES.get(`c28:${code}`) : null;
          if (!roomId) return new Response(JSON.stringify({ error: "invalid or expired code" }), { status: 404 });
          return toDO28(env, roomId, "/join", req, id, body?.displayName, body?.avatar);
        }
        const m28 = url.pathname.match(/^\/api\/28\/rooms\/([0-9a-f]+)\/(ws|state|start|addbot|removebot|leave|config)$/);
        if (m28) return toDO28(env, m28[1]!, `/${m28[2]}`, req, id);
      }
      return new Response("not found", { status: 404 });
    }

    // Static client assets. index.html must never be cached (it names the hashed bundle —
    // a stale copy pins users to an old build); the hashed assets themselves are immutable.
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(req);
      const isHtml = url.pathname === "/" || url.pathname.endsWith(".html");
      if (!isHtml) return res;
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", "no-cache");
      return out;
    }
    return new Response("blackqueen server", { status: 200 });
  },
} satisfies ExportedHandler<WorkerEnv>;
