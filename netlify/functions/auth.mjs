import { getStore } from "@netlify/blobs";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

const store = getStore("dairy-users");
const secret = process.env.AUTH_SECRET;
const SESSION_COOKIE = "dairy_session";

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
    body: JSON.stringify(body)
  };
}

function cookieHeader(token, maxAge = 60 * 60 * 24 * 30) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("=")));
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function requestPath(request) {
  return (request.path || request.rawUrl || "")
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?", 1)[0]
    .replace(/^\/\.netlify\/functions\/auth/, "/api/auth");
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, storedPassword) {
  try {
    const [salt, storedHash] = storedPassword.split(":");
    const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
    const expected = Buffer.from(storedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function userIdFromToken(request) {
  const value = request.headers?.authorization || "";
  const cookies = parseCookies(request.headers?.cookie);
  const token = value.startsWith("Bearer ") ? value.slice(7).trim() : cookies[SESSION_COOKIE] || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data.sub : null;
  } catch {
    return null;
  }
}

function validate(body) {
  if (typeof body.name !== "string" || body.name.trim().length < 2) return "Name must contain at least 2 characters";
  if (typeof body.email !== "string" || !/^\S+@\S+\.\S+$/.test(body.email)) return "A valid email is required";
  if (typeof body.password !== "string" || body.password.length < 8) return "Password must contain at least 8 characters";
  return null;
}

export default async function handler(request) {
  if (!secret) return json(500, { error: "AUTH_SECRET is not configured" });
  const path = requestPath(request);
  const action = path.split("/").filter(Boolean).pop();
  const users = (await store.get("all", { type: "json" })) || [];

  if (request.httpMethod === "GET" && action === "me") {
    const user = users.find((item) => item.id === userIdFromToken(request));
    return user ? json(200, { user: publicUser(user) }) : json(401, { error: "Not signed in" });
  }
  if (request.httpMethod === "POST" && action === "logout") return json(200, { ok: true }, { "Set-Cookie": cookieHeader("", 0) });
  if (request.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(request.body || "{}"); } catch { return json(400, { error: "Request body must be valid JSON" }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (action === "register") {
    const error = validate(body);
    if (error) return json(400, { error });
    if (users.some((user) => user.email === email)) return json(409, { error: "An account with that email already exists" });
    const user = { id: randomUUID(), name: body.name.trim(), email, password: hashPassword(body.password), createdAt: new Date().toISOString() };
    await store.setJSON("all", [...users, user]);
    return json(201, { user: publicUser(user) }, { "Set-Cookie": cookieHeader(tokenFor(user)) });
  }

  if (action === "login") {
    const user = users.find((item) => item.email === email);
    if (!user || typeof body.password !== "string" || !passwordMatches(body.password, user.password)) return json(401, { error: "Email or password is incorrect" });
    return json(200, { user: publicUser(user) }, { "Set-Cookie": cookieHeader(tokenFor(user)) });
  }

  return json(404, { error: "Route not found" });
}
