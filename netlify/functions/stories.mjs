import { getStore } from "@netlify/blobs";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const store = getStore("dairy-stories");
const secret = process.env.AUTH_SECRET;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function publicStory(story) {
  const { commentList, ...safeStory } = story;
  return { ...safeStory, comments: commentList ? commentList.length : (Number(story.comments) || 0) };
}

function userIdFromToken(request) {
  const header = request.headers?.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : (request.headers?.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("dairy_session="))?.slice("dairy_session=".length) || "";
  const [payload, signature] = token.split(".");
  if (!secret || !payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data.sub : null;
  } catch {
    return null;
  }
}

function getStoryId(path) {
  const rawPath = typeof path === "string" ? path : "";
  const normalizedPath = rawPath.replace(/^https?:\/\/[^/]+/, "").split("?", 1)[0].replace(/^\/\.netlify\/functions\/stories/, "/api/stories");
  const match = normalizedPath.match(/^\/api\/stories\/([^/]+)(?:\/([^/]+))?$/);
  return match ? { id: match[1], action: match[2] } : null;
}

export default async function handler(request) {
  const route = getStoryId(request.path || request.rawUrl || "");
  const stories = (await store.get("all", { type: "json" })) || [];
  const userId = userIdFromToken(request);
  const visibleStories = stories.filter((story) => story.audience === "Public" || (userId && story.author?.id === userId));

  if (route?.action === "like" && request.httpMethod === "POST") {
    const story = visibleStories.find((item) => item.id === route.id);
    if (!story) return json(404, { error: "Story not found" });
    story.likes = (Number(story.likes) || 0) + 1;
    await store.setJSON("all", stories);
    return json(200, { story: publicStory(story) });
  }

  if (route?.action === "comments") {
    const story = visibleStories.find((item) => item.id === route.id);
    if (!story) return json(404, { error: "Story not found" });
    story.commentList ||= [];
    if (request.httpMethod === "GET") return json(200, { comments: story.commentList });
    if (request.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
    let body;
    try { body = JSON.parse(request.body || "{}"); } catch { return json(400, { error: "Request body must be valid JSON" }); }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json(400, { error: "Comment text is required" });
    if (text.length > 1000) return json(400, { error: "Comment must be 1000 characters or fewer" });
    const comment = { id: randomUUID(), text, author: { id: "anonymous", name: "Anonymous" }, createdAt: new Date().toISOString() };
    story.commentList.push(comment);
    story.comments = story.commentList.length;
    await store.setJSON("all", stories);
    return json(201, { comment });
  }

  if (request.httpMethod === "GET") {
    const queryParams = request.queryStringParameters || {};
    const query = (queryParams.q || "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(queryParams.limit) || 50, 1), 100);
    const result = query
      ? visibleStories.filter((story) => `${story.text} ${story.author?.name || story.author || ""}`.toLowerCase().includes(query))
      : visibleStories;
    return json(200, { stories: result.slice(0, limit).map(publicStory) });
  }

  if (request.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(request.body || "{}");
  } catch {
    return json(400, { error: "Request body must be valid JSON" });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const author = typeof body.author === "string" ? body.author.trim().slice(0, 80) : "Anonymous";

  if (!text) return json(400, { error: "Story text is required" });
  if (text.length > 5000) return json(400, { error: "Story must be 5000 characters or fewer" });
  if (body.photo && (typeof body.photo !== "string" || !/^https:\/\//i.test(body.photo))) return json(400, { error: "Photo URL must use HTTPS" });
  if (body.audience !== "Public" && !userId) return json(401, { error: "Sign in to share a private story" });

  const story = {
    id: randomUUID(),
    text,
    author: { id: "anonymous", name: author || "Anonymous" },
    audience: ["Public", "Friends", "Only me"].includes(body.audience) ? body.audience : "Public",
    feeling: typeof body.feeling === "string" ? body.feeling.trim().slice(0, 40) : "",
    place: typeof body.place === "string" ? body.place.trim().slice(0, 80) : "",
    photo: typeof body.photo === "string" ? body.photo.trim().slice(0, 1000) : "",
    createdAt: new Date().toISOString(),
    likes: 0,
    comments: 0,
    commentList: []
  };

  await store.setJSON("all", [story, ...stories].slice(0, 100));
  return json(201, { story: publicStory(story) });
}
