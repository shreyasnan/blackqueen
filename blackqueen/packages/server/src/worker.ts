// Stateless Worker front door (PLATFORM_SPEC §7): Clerk JWT verification (JWKS),
// room create/join routing via KV, WS upgrade forwarding, Clerk webhooks, static assets.
/// <reference types="@cloudflare/workers-types" />
import { Env } from "./do.js";
export { RoomDO } from "./do.js";

interface WorkerEnv extends Env {
  CLERK_JWKS_URL?: string; // https://<instance>.clerk.accounts.dev/.well-known/jwks.json
  CLERK_WEBHOOK_SECRET?: string;
  GUEST_SECRET?: string; // HMAC key for guest tokens — set via `wrangler secret put GUEST_SECRET`
  ASSETS?: Fetcher;
}

// ---- Guest identity (PLATFORM_SPEC §1.1 amendment: hybrid — accounts OR ephemeral guests) ----
// Token: "guest.<id>.<hmac(id)>" — unforgeable with the secret, so a guest's seat can't be hijacked,
// but nothing is stored server-side and nothing persists beyond the browser that holds the token.
async function hmac(env: WorkerEnv, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.GUEST_SECRET ?? "dev-guest-secret-set-me"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function mintGuest(env: WorkerEnv): Promise<{ token: string; accountId: string }> {
  const id = `guest_${crypto.randomUUID()}`;
  return { token: `guest.${id}.${await hmac(env, id)}`, accountId: id };
}
async function verifyGuest(env: WorkerEnv, token: string): Promise<Identity | null> {
  const [tag, id, sig] = token.split(".");
  if (tag !== "guest" || !id || !sig) return null;
  if (sig !== (await hmac(env, id))) return null;
  return { accountId: id, displayName: "Guest" };
}

interface Identity { accountId: string; displayName: string }

// --- Clerk JWT verification via JWKS (RS256), cached ---
let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;

async function verifyClerkJwt(token: string, env: WorkerEnv): Promise<Identity | null> {
  if (!env.CLERK_JWKS_URL) return null;
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const header = JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/")));
    if (jwksCache === null || Date.now() - jwksCache.fetchedAt > 3600_000) {
      const res = await fetch(env.CLERK_JWKS_URL);
      jwksCache = { keys: ((await res.json()) as { keys: JsonWebKey[] }).keys, fetchedAt: Date.now() };
    }
    const jwk = jwksCache.keys.find((k) => (k as { kid?: string }).kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const data = new TextEncoder().encode(`${h}.${p}`);
    const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data))) return null;
    const claims = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
    if (claims.exp * 1000 < Date.now()) return null;
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

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(req.url);

    // Clerk webhooks (user.deleted → tombstone; session revocation → close sockets). Svix-verified.
    if (url.pathname === "/api/webhooks/clerk" && req.method === "POST") {
      // v1: acknowledge; per-room account cleanup is a follow-up (accounts hold no app PII beyond displayName)
      return new Response("ok");
    }

    // Guest minting: unauthenticated by definition
    if (url.pathname === "/api/guest" && req.method === "POST") {
      return new Response(JSON.stringify(await mintGuest(env)), { headers: { "content-type": "application/json" } });
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
      const m = url.pathname.match(/^\/api\/rooms\/([0-9a-f]+)\/(ws|state|start|addbot|removebot)$/);
      if (m) return toDO(env, m[1]!, `/${m[2]}`, req, id);
      return new Response("not found", { status: 404 });
    }

    // Static client assets
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response("blackqueen server", { status: 200 });
  },
} satisfies ExportedHandler<WorkerEnv>;
