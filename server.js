const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_COOKIE = 'dairy_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const DATABASE_FILE = path.join(__dirname, 'dairy.sqlite');
const INDEX_FILE = path.join(__dirname, 'index.html');
const APP_FILE = path.join(__dirname, 'app.js');

const database = new DatabaseSync(DATABASE_FILE);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    author_json TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'Public',
    feeling TEXT NOT NULL DEFAULT '',
    place TEXT NOT NULL DEFAULT '',
    photo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    author_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const users = new Map();
const sessions = new Map();
let stories = [];

function loadData() {
  for (const user of database.prepare('SELECT id, email, name, password, created_at AS createdAt FROM users').all()) {
    users.set(user.email, user);
  }
  const commentRows = database.prepare('SELECT id, story_id, text, author_json, created_at AS createdAt FROM comments ORDER BY created_at').all();
  const commentsByStory = new Map();
  for (const comment of commentRows) {
    const list = commentsByStory.get(comment.story_id) || [];
    list.push({ id: comment.id, text: comment.text, author: JSON.parse(comment.author_json), createdAt: comment.createdAt });
    commentsByStory.set(comment.story_id, list);
  }
  stories = database.prepare('SELECT id, text, author_json, audience, feeling, place, photo, created_at AS createdAt, likes FROM stories ORDER BY created_at DESC').all().map((story) => {
    const commentList = commentsByStory.get(story.id) || [];
    const { author_json: authorJson, ...publicFields } = story;
    return { ...publicFields, author: JSON.parse(authorJson), comments: commentList.length, commentList };
  });
}

function saveData() {
  database.exec('BEGIN');
  try {
    database.exec('DELETE FROM comments; DELETE FROM stories; DELETE FROM users;');
    const insertUser = database.prepare('INSERT INTO users (id, email, name, password, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const user of users.values()) insertUser.run(user.id, user.email, user.name, user.password, user.createdAt);
    const insertStory = database.prepare('INSERT INTO stories (id, text, author_json, audience, feeling, place, photo, created_at, likes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertComment = database.prepare('INSERT INTO comments (id, story_id, text, author_json, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const story of stories) {
      insertStory.run(story.id, story.text, JSON.stringify(story.author), story.audience || 'Public', story.feeling || '', story.place || '', story.photo || '', story.createdAt, Number(story.likes) || 0);
      for (const comment of story.commentList || []) insertComment.run(comment.id, story.id, comment.text, JSON.stringify(comment.author), comment.createdAt);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 1_000_000) {
        tooLarge = true;
        reject(new Error('Request body is too large'));
        request.resume();
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Request body must be valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function passwordMatches(password, storedPassword) {
  try {
    const [salt, storedHash] = storedPassword.split(':');
    if (!salt || !storedHash) return false;
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const expected = Buffer.from(storedHash, 'hex');
    const actual = Buffer.from(hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function getAuthenticatedUser(request) {
  const header = request.headers.authorization || '';
  const cookies = parseCookies(request.headers.cookie || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : cookies[SESSION_COOKIE];
  const session = sessions.get(token);
  if (session && session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const email = session?.email;
  return email ? users.get(email) : null;
}

function createSession(email) {
  const token = createToken();
  sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function parseCookies(header) {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=')));
}

function sessionCookie(token, maxAge = SESSION_TTL_MS / 1000) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function clearSessionCookie() {
  return sessionCookie('', 0);
}

function getBearerToken(request) {
  const header = request.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function publicStory(story) {
  const { commentList, ...safeStory } = story;
  return { ...safeStory, comments: commentList ? commentList.length : (Number(story.comments) || 0) };
}

function findStory(id) {
  return stories.find((story) => story.id === id);
}

function validateCredentials(body) {
  if (typeof body.name !== 'string' || body.name.trim().length < 2) return 'Name must contain at least 2 characters';
  if (typeof body.email !== 'string' || !/^\S+@\S+\.\S+$/.test(body.email)) return 'A valid email is required';
  if (typeof body.password !== 'string' || body.password.length < 8) return 'Password must contain at least 8 characters';
  return null;
}

function validateStory(body) {
  if (!body || typeof body.text !== 'string' || !body.text.trim()) return 'Story text is required';
  if (body.text.trim().length > 5000) return 'Story must be 5000 characters or fewer';
  if (body.photo && (typeof body.photo !== 'string' || !/^https:\/\//i.test(body.photo))) return 'Photo URL must use HTTPS';
  return null;
}

function serveIndex(response) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' https: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(fs.readFileSync(INDEX_FILE));
}

function serveApp(response) {
  response.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(fs.readFileSync(APP_FILE));
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const method = request.method || 'GET';

  if (request.headers['x-forwarded-proto'] === 'http') {
    response.writeHead(301, { Location: `https://${request.headers.host}${request.url}` });
    return response.end();
  }

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveIndex(response);
  if (method === 'GET' && url.pathname === '/app.js') return serveApp(response);
  if (method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { ok: true, service: 'dairy-api' });

  if (method === 'POST' && url.pathname === '/api/auth/register') {
    let body;
    try { body = await readJson(request); } catch (error) { return sendError(response, 400, error.message); }
    const validationError = validateCredentials(body);
    if (validationError) return sendError(response, 400, validationError);
    const email = body.email.trim().toLowerCase();
    if (users.has(email)) return sendError(response, 409, 'An account with that email already exists');
    const user = { id: crypto.randomUUID(), name: body.name.trim(), email, password: hashPassword(body.password), createdAt: new Date().toISOString() };
    users.set(email, user);
    const token = createSession(email);
    saveData();
    return sendJson(response, 201, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (method === 'POST' && url.pathname === '/api/auth/login') {
    let body;
    try { body = await readJson(request); } catch (error) { return sendError(response, 400, error.message); }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const user = users.get(email);
    if (!user || typeof body.password !== 'string' || !passwordMatches(body.password, user.password)) return sendError(response, 401, 'Email or password is incorrect');
    const token = createSession(email);
    return sendJson(response, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (method === 'GET' && url.pathname === '/api/auth/me') {
    const user = getAuthenticatedUser(request);
    return user ? sendJson(response, 200, { user: publicUser(user) }) : sendError(response, 401, 'Not signed in');
  }

  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = getBearerToken(request);
    if (token) sessions.delete(token);
    const cookieToken = parseCookies(request.headers.cookie || '')[SESSION_COOKIE];
    if (cookieToken) sessions.delete(cookieToken);
    return sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  if (method === 'GET' && url.pathname === '/api/stories') {
    const query = (url.searchParams.get('q') || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);
    const user = getAuthenticatedUser(request);
    const visibleStories = stories.filter((story) => story.audience === 'Public' || (user && story.author?.id === user.id));
    const matchingStories = query
      ? visibleStories.filter((story) => `${story.text} ${story.author?.name || story.author || ''}`.toLowerCase().includes(query))
      : visibleStories;
    return sendJson(response, 200, { stories: matchingStories.slice(0, limit).map(publicStory) });
  }

  if (method === 'POST' && url.pathname === '/api/stories') {
    const user = getAuthenticatedUser(request);
    let body;
    try { body = await readJson(request); } catch (error) { return sendError(response, 400, error.message); }
    const validationError = validateStory(body);
    if (validationError) return sendError(response, 400, validationError);
    if (body.audience !== 'Public' && !user) return sendError(response, 401, 'Sign in to share a private story');
    const author = user ? publicUser(user) : {
      id: 'anonymous',
      name: typeof body.author === 'string' && body.author.trim() ? body.author.trim().slice(0, 80) : 'Anonymous'
    };
    const story = { id: crypto.randomUUID(), text: body.text.trim(), author, audience: ['Public', 'Friends', 'Only me'].includes(body.audience) ? body.audience : 'Public', feeling: typeof body.feeling === 'string' ? body.feeling.trim().slice(0, 40) : '', place: typeof body.place === 'string' ? body.place.trim().slice(0, 80) : '', photo: typeof body.photo === 'string' ? body.photo.trim().slice(0, 1000) : '', createdAt: new Date().toISOString(), likes: 0, comments: 0, commentList: [] };
    stories.unshift(story);
    stories = stories.slice(0, 100);
    saveData();
    return sendJson(response, 201, { story: publicStory(story) });
  }

  if (method === 'DELETE' && /^\/api\/stories\/[^/]+$/.test(url.pathname)) {
    const story = findStory(url.pathname.split('/').pop());
    if (!story) return sendError(response, 404, 'Story not found');
    const user = getAuthenticatedUser(request);
    if (!user || story.author?.id !== user.id) return sendError(response, 403, 'Only the author can delete this story');
    stories = stories.filter((item) => item.id !== story.id);
    saveData();
    return sendJson(response, 200, { ok: true });
  }

  const likeMatch = url.pathname.match(/^\/api\/stories\/([^/]+)\/like$/);
  if (method === 'POST' && likeMatch) {
    const story = findStory(likeMatch[1]);
    if (!story) return sendError(response, 404, 'Story not found');
    const user = getAuthenticatedUser(request);
    if (story.audience !== 'Public' && (!user || story.author?.id !== user.id)) return sendError(response, 404, 'Story not found');
    story.likes = Number(story.likes) || 0;
    story.likes += 1;
    saveData();
    return sendJson(response, 200, { story: publicStory(story) });
  }

  const commentsMatch = url.pathname.match(/^\/api\/stories\/([^/]+)\/comments$/);
  if (commentsMatch) {
    const story = findStory(commentsMatch[1]);
    if (!story) return sendError(response, 404, 'Story not found');
    const user = getAuthenticatedUser(request);
    if (story.audience !== 'Public' && (!user || story.author?.id !== user.id)) return sendError(response, 404, 'Story not found');
    story.commentList ||= [];
    if (method === 'GET') return sendJson(response, 200, { comments: story.commentList });
    if (method !== 'POST') return sendError(response, 405, 'Method not allowed');
    let body;
    try { body = await readJson(request); } catch (error) { return sendError(response, 400, error.message); }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return sendError(response, 400, 'Comment text is required');
    if (text.length > 1000) return sendError(response, 400, 'Comment must be 1000 characters or fewer');
    const commenter = getAuthenticatedUser(request);
    const comment = {
      id: crypto.randomUUID(),
      text,
      author: commenter ? publicUser(commenter) : { id: 'anonymous', name: 'Anonymous' },
      createdAt: new Date().toISOString()
    };
    story.commentList.push(comment);
    story.comments = story.commentList.length;
    saveData();
    return sendJson(response, 201, { comment });
  }

  sendError(response, 404, 'Route not found');
}

loadData();
const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(error);
    sendError(response, 500, 'Internal server error');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Dairy backend running at http://${HOST}:${PORT}`);
});
