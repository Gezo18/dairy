const storyForm = document.querySelector(".composer");
const storyInput = document.querySelector("#story");
const feedList = document.querySelector("#feed-list");
const authPanel = document.querySelector("#auth-panel");
const authForm = document.querySelector("#auth-form");
const authButton = document.querySelector("#auth-button");
const supabaseUrl = "https://cwjcljzraxkclowrcizx.supabase.co";
const supabaseClient = window.supabase?.createClient(
  supabaseUrl,
  "sb_publishable_0TY2UkTjVtyqvbHsO4-EqA_jrIE3XNc"
);
let currentUser = null;
let authMode = "signin";

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

const defaultSettings = {
  name: "You",
  bio: "",
  audience: "Public",
  theme: "system",
  fontSize: "standard",
  feedView: "cards",
  autoSaveDrafts: true,
  rememberComposerMeta: true,
  dmPrivacy: "everyone",
  commentPrivacy: "everyone",
  discoverable: true,
  notifyReplies: true,
  notifyLikes: true,
  notifyMessages: true,
  notifyFollows: true
};

const state = {
  stories: [],
  saved: Array.isArray(readStorage("dairy-saved", [])) ? readStorage("dairy-saved", []) : [],
  follows: Array.isArray(readStorage("dairy-follows", [])) ? readStorage("dairy-follows", []) : [],
  settings: { ...defaultSettings, ...readStorage("dairy-settings", {}) },
  profiles: new Map()
};

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else if (theme === "light") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }
}

function applyFontSize(size) {
  if (size === "compact" || size === "comfortable") {
    document.documentElement.setAttribute("data-font-size", size);
  } else {
    document.documentElement.removeAttribute("data-font-size");
  }
}

function applyFeedView(view) {
  if (view === "compact") {
    document.documentElement.setAttribute("data-feed-view", "compact");
  } else {
    document.documentElement.removeAttribute("data-feed-view");
  }
}

function showToast(message) { const toast = document.createElement("div"); toast.className = "toast"; toast.textContent = message; document.body.append(toast); setTimeout(() => toast.remove(), 2400); }
function formatDate(value) { return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Today"; }
function audienceValue(value) { return { Public: "public", Friends: "friends", "Only me": "private" }[value] || "public"; }
function audienceLabel(value) { return { public: "Public", friends: "Friends", private: "Only me" }[value] || "Public"; }
function mapPost(post) {
  return { id: post.id, text: post.body, author: { id: post.author_id, name: post.profiles?.display_name || "Anonymous", avatar: post.profiles?.avatar_url || "" }, audience: audienceLabel(post.audience), feeling: "", place: post.location || "", photo: post.media?.[0]?.url || "", media: Array.isArray(post.media) ? post.media : [], createdAt: post.created_at, likes: post.reaction_count || 0, comments: post.comment_count || 0 };
}

async function mapPosts(posts) {
  const authorIds = [...new Set(posts.map((post) => post.author_id).filter(Boolean))];
  if (!authorIds.length) return posts.map(mapPost);
  const { data: profiles, error } = await supabaseClient.from("profiles").select("id, display_name, avatar_url").in("id", authorIds);
  if (error) throw error;
  const names = new Map((profiles || []).map((profile) => [profile.id, { display_name: profile.display_name, avatar_url: profile.avatar_url || "" }]));
  for (const profile of profiles || []) state.profiles.set(profile.id, profile);
  return posts.map((post) => mapPost({ ...post, profiles: names.get(post.author_id) || { display_name: "Anonymous", avatar_url: "" } }));
}
async function loadSuggestions() {
  const list = document.querySelector("#suggestions-list");
  if (!list || !supabaseClient) return;
  const { data: profiles, error } = await supabaseClient.from("profiles").select("id, display_name, avatar_url").neq("id", currentUser?.id || "00000000-0000-0000-0000-000000000000").limit(5);
  if (error || !profiles?.length) { list.innerHTML = ""; return; }
  list.replaceChildren();
  for (const profile of profiles) {
    const item = document.createElement("div");
    item.className = "person";
    const initials = (profile.display_name || "U").slice(0, 2).toUpperCase();
    const avatarHtml = profile.avatar_url ? `<img src="${escapeAttr(profile.avatar_url)}" alt="">` : initials;
    item.innerHTML = `<div><span class="avatar" style="width:32px;height:32px;font-size:.75rem;${profile.avatar_url ? "background:transparent;" : ""}">${avatarHtml}</span><div class="person-details"><strong>${escapeHtml(profile.display_name)}</strong><small>On Dairy</small></div></div><button class="follow" type="button">Follow</button>`;
    list.append(item);
  }
}

function openAuth(mode = "signin") {
  authMode = mode;
  const titleEl = document.querySelector("#auth-title");
  if (titleEl) titleEl.textContent = mode === "signin" ? "Sign in to Dairy" : "Create your Dairy account";
  const copyEl = document.querySelector("#auth-copy");
  if (copyEl) copyEl.textContent = mode === "signin" ? "Use your account to share and see protected stories." : "Create an account to join the community.";
  const nameEl = document.querySelector("#auth-name");
  if (nameEl) {
    nameEl.hidden = mode === "signin";
    nameEl.required = mode === "signup";
  }
  const passEl = document.querySelector("#auth-password");
  if (passEl) passEl.autocomplete = mode === "signin" ? "current-password" : "new-password";
  const submitEl = document.querySelector("#auth-submit");
  if (submitEl) submitEl.textContent = mode === "signin" ? "Sign in" : "Create account";
  const switchEl = document.querySelector("#auth-switch");
  if (switchEl) switchEl.textContent = mode === "signin" ? "Create an account" : "Already have an account?";
  const errEl = document.querySelector("#auth-error");
  if (errEl) errEl.textContent = "";
  const panel = document.querySelector("#auth-panel") || authPanel;
  panel?.classList.add("open");
  document.querySelector("#auth-email")?.focus();
}

function closeAuth() {
  const panel = document.querySelector("#auth-panel") || authPanel;
  panel?.classList.remove("open");
  const form = document.querySelector("#auth-form") || authForm;
  form?.reset();
}
function updateAuthUi() {
  const btn = document.querySelector("#auth-button") || authButton;
  if (btn) btn.textContent = currentUser ? "Sign out" : "Sign in";
  const headerAvatar = document.querySelector(".avatar");
  const profileData = currentUser ? state.profiles.get(currentUser.id) : null;
  const avatarUrl = profileData?.avatar_url || "";
  if (headerAvatar) {
    if (avatarUrl) {
      headerAvatar.innerHTML = `<img src="${escapeAttr(avatarUrl)}" alt="">`;
      headerAvatar.classList.add("has-image");
    } else {
      headerAvatar.textContent = currentUser?.user_metadata?.display_name?.slice(0, 2).toUpperCase() || "AM";
      headerAvatar.classList.remove("has-image");
    }
  }
  const emailInput = document.querySelector("#setting-email");
  if (emailInput) emailInput.value = currentUser?.email || "";
  if (currentUser?.user_metadata?.display_name) {
    state.settings.name = currentUser.user_metadata.display_name;
    const nameInput = document.querySelector("#setting-name");
    if (nameInput) nameInput.value = state.settings.name;
  }
}

function renderStory(story, target = feedList) {
  const post = document.createElement("article");
  post.className = "post";
  const author = typeof story.author === "string" ? story.author : (story.author?.name || "Anonymous");
  const authorId = typeof story.author === "object" ? story.author?.id : null;
  const avatarUrl = typeof story.author === "object" ? story.author?.avatar : "";
  const avatarHtml = avatarUrl ? `<img src="${escapeAttr(avatarUrl)}" alt="">` : author.slice(0, 2).toUpperCase();
  const likes = Number(story.likes) || 0;
  const comments = Number(story.comments) || 0;
  const saved = state.saved.includes(story.id);
  const media = (story.media || []).map((item) => item.type === "video" ? `<video class="post-image" src="${escapeAttr(item.url)}" controls preload="metadata"></video>` : `<img class="post-image" src="${escapeAttr(item.url)}" alt="Shared photo" loading="lazy">`).join("");
  const photo = media ? `<div class="post-media">${media}</div>` : (story.feeling ? `<div class="post-image green"><span>${escapeHtml(story.feeling)}</span></div>` : "");
  const isAuthor = currentUser && story.author?.id === currentUser.id;
  post.innerHTML = `
    <div class="post-header">
      <div class="person">
        <span class="avatar ${avatarUrl ? "has-image" : ""}" ${authorId && authorId !== currentUser?.id ? `data-author-id="${escapeAttr(authorId)}" style="cursor:pointer"` : ""}>${avatarHtml}</span>
        <div class="person-details"><strong ${authorId && authorId !== currentUser?.id ? `data-author-id="${escapeAttr(authorId)}" style="cursor:pointer;text-decoration:underline"` : ""}>${escapeHtml(author)}</strong><small>${formatDate(story.createdAt)} · ${escapeHtml(story.audience || "Public")}${story.place ? ` · ${escapeHtml(story.place)}` : ""}</small></div>
      </div>
      ${isAuthor ? `<button class="post-delete" type="button">Delete</button>` : ""}
    </div>
    <p class="post-copy" data-story-id="${escapeAttr(story.id)}">${escapeHtml(story.text)}</p>${photo}
    <div class="post-meta"><span>♡ ${likes} people like this</span><span>${comments} comments</span></div>
    <div class="post-actions"><button class="post-action like-story" type="button">♡ Like</button><button class="post-action comment-story" type="button">◯ Comment</button><button class="post-action save-story ${saved ? "active" : ""}" type="button">${saved ? "♥ Saved" : "♡ Save"}</button><button class="post-action share-story" type="button">↗ Share</button></div>`;
  post.querySelectorAll("[data-author-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-author-id");
      if (id && id !== currentUser?.id) {
        location.hash = `profile-${id}`;
      }
    });
  });
  if (story.photo) {
    try {
      const photoUrl = new URL(story.photo, location.origin);
      if (photoUrl.protocol === "https:" && post.querySelector(".story-photo")) {
        post.querySelector(".story-photo").style.backgroundImage = `url(${JSON.stringify(photoUrl.href)})`;
        post.querySelector(".story-photo").style.backgroundSize = "cover";
        post.querySelector(".story-photo").style.backgroundPosition = "center";
      }
    } catch {
      post.querySelector(".story-photo")?.remove();
    }
  }
  post.querySelector(".like-story").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (!currentUser) return openAuth();
      const { error } = await supabaseClient.from("reactions").upsert({ post_id: story.id, user_id: currentUser.id, reaction: "like" });
      if (error) throw error;
      story.likes = (Number(story.likes) || 0) + 1;
      post.querySelector(".post-meta span").textContent = `♡ ${story.likes} people like this`;
    } catch (error) {
      showToast(error.message || "Could not like this story");
    } finally {
      button.disabled = false;
    }
  });
  post.querySelector(".comment-story").addEventListener("click", () => openCommentsPanel(story.id));
  post.querySelector(".save-story").addEventListener("click", () => toggleSaved(story, post));
  post.querySelector(".share-story").addEventListener("click", async () => { try { await navigator.clipboard.writeText(`${location.origin}/#${story.id}`); showToast("Story link copied"); } catch { showToast("Story ready to share"); } });
  post.querySelector(".post-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete this story?")) return;
    const button = post.querySelector(".post-delete");
    button.disabled = true;
    try {
      if (!currentUser) return openAuth();
      const { error } = await supabaseClient.from("posts").delete().eq("id", story.id);
      if (error) throw error;
      state.stories = state.stories.filter((item) => item.id !== story.id);
      post.remove();
      renderViews();
      showToast("Story deleted");
    } catch (error) {
      showToast(error.message || "Could not delete story");
    } finally {
      button.disabled = false;
    }
  });
  target.append(post);
}
let currentCommentsStoryId = null;
async function openCommentsPanel(storyId) {
  currentCommentsStoryId = storyId;
  const post = [...document.querySelectorAll(".post")].find((el) => el.querySelector(".post-copy")?.dataset?.storyId === String(storyId));
  if (!post) return;
  let section = post.querySelector(".comments-section");
  if (!section) {
    section = document.createElement("div");
    section.className = "comments-section";
    section.innerHTML = '<h4>Comments</h4><div class="comments-list"><div class="empty-state">Loading...</div></div><form class="comment-composer"><input type="text" maxlength="2000" placeholder="Add a comment..." autocomplete="off"><button class="button" type="button">Post</button></form>';
    post.after(section);
  }
  section.hidden = false;
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const list = section.querySelector(".comments-list");
  list.replaceChildren();
  list.innerHTML = '<div class="empty-state">Loading...</div>';
  try {
    const { data: comments, error } = await supabaseClient.from("comments").select("id, body, created_at, author_id").eq("post_id", storyId).order("created_at", { ascending: true });
    if (error) throw error;
    const authorIds = [...new Set((comments || []).map((c) => c.author_id).filter(Boolean))];
    const authors = new Map();
    if (authorIds.length) {
      const { data: profiles } = await supabaseClient.from("profiles").select("id, display_name").in("id", authorIds);
      for (const p of profiles || []) authors.set(p.id, p.display_name);
    }
    list.replaceChildren();
    if (!comments?.length) { list.innerHTML = '<div class="empty-state">No comments yet. Be the first.</div>'; return; }
    for (const comment of comments) {
      const item = document.createElement("div");
      item.className = "comment-item";
      const name = authors.get(comment.author_id) || "Unknown";
      const initials = name.slice(0, 2).toUpperCase();
      item.innerHTML = `<span class="comment-avatar">${initials}</span><div class="comment-body"><strong>${escapeHtml(name)}</strong><p>${escapeHtml(comment.body)}</p><time>${formatDate(comment.created_at)}</time></div>`;
      list.append(item);
    }
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
  const composer = section.querySelector(".comment-composer");
  composer.replaceWith(composer.cloneNode(true));
  section.querySelector(".comment-composer").addEventListener("click", async (event) => {
    if (event.target.tagName !== "BUTTON") return;
    const input = section.querySelector(".comment-composer input");
    const text = input.value.trim();
    if (!text) return;
    await addComment(storyId, text);
    input.value = "";
  });
}
async function addComment(storyId, body) {
  if (!currentUser || !supabaseClient) return openAuth();
  const text = body.trim();
  if (!text) return;
  const { error } = await supabaseClient.from("comments").insert({ post_id: storyId, author_id: currentUser.id, body: text });
  if (error) { showToast(error.message); return; }
  showToast("Reply added");
  const story = state.stories.find((s) => String(s.id) === String(storyId));
  if (story) { story.comments = (Number(story.comments) || 0) + 1; }
  const post = [...document.querySelectorAll(".post")].find((el) => el.querySelector(".post-copy")?.dataset?.storyId === String(storyId));
  if (post) { post.querySelector(".post-meta span:last-child").textContent = `${story?.comments || 1} comments`; }
  openCommentsPanel(storyId);
}

let currentConversationId = null;
async function loadUsers() {
  const list = document.querySelector("#user-list");
  if (!list || !currentUser || !supabaseClient) { list.replaceChildren(); return; }
  const { data: profiles, error } = await supabaseClient.from("profiles").select("id, display_name, avatar_url, bio").neq("id", currentUser.id).order("display_name");
  if (error || !profiles?.length) { list.replaceChildren(); list.innerHTML = '<div class="empty-state">No users found.</div>'; return; }
  list.replaceChildren();
  for (const profile of profiles) {
    const item = document.createElement("button");
    item.className = "conversation-item";
    item.type = "button";
    const initials = (profile.display_name || "?").slice(0, 2).toUpperCase();
    const avatarHtml = profile.avatar_url ? `<img src="${escapeAttr(profile.avatar_url)}" alt="">` : initials;
    item.innerHTML = `<span class="avatar" style="width:36px;height:36px;font-size:.8rem;${profile.avatar_url ? "background:transparent;" : ""}">${avatarHtml}</span><div class="conversation-meta"><strong>${escapeHtml(profile.display_name)}</strong><span>${escapeHtml(profile.bio || "No bio")}</span></div>`;
    item.addEventListener("click", () => startConversation(profile.id));
    list.append(item);
  }
}
async function loadOtherParticipant(conversationId) {
  if (!currentUser || !supabaseClient) return null;
  const { data } = await supabaseClient.from("conversation_participants").select("user_id").neq("user_id", currentUser.id).eq("conversation_id", conversationId).limit(1);
  return data?.[0]?.user_id || null;
}
async function openConversation(conversationId, name) {
  currentConversationId = conversationId;
  document.querySelectorAll(".conversation-item").forEach((item) => item.classList.toggle("active", item.textContent.includes(name)));
  document.querySelector("#inbox-placeholder").hidden = true;
  document.querySelector("#inbox-messages").hidden = false;
  document.querySelector("#inbox-composer").hidden = false;
  await loadMessages(conversationId);
}
async function loadMessages(conversationId) {
  const container = document.querySelector("#inbox-messages");
  if (!container || !supabaseClient) return;
  const { data, error } = await supabaseClient.from("messages").select("id, sender_id, body, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true });
  if (error) { showToast(error.message); return; }
  container.replaceChildren();
  const senderIds = [...new Set((data || []).map((m) => m.sender_id))];
  const { data: profiles } = await supabaseClient.from("profiles").select("id, display_name").in("id", senderIds);
  const nameMap = new Map((profiles || []).map((p) => [p.id, p.display_name]));
  for (const message of data || []) {
    const item = document.createElement("div");
    item.className = "inbox-message" + (message.sender_id === currentUser?.id ? " mine" : "");
    const senderName = nameMap.get(message.sender_id) || "Unknown";
    item.innerHTML = `<strong>${escapeHtml(senderName)}</strong><p>${escapeHtml(message.body)}</p><time>${formatDate(message.created_at)}</time>`;
    container.append(item);
  }
  container.scrollTop = container.scrollHeight;
}
async function sendMessage(body) {
  if (!currentConversationId || !currentUser || !supabaseClient) return;
  const text = body.trim();
  if (!text) return;
  const { error } = await supabaseClient.from("messages").insert({ conversation_id: currentConversationId, sender_id: currentUser.id, body: text });
  if (error) { showToast(error.message); return; }
  await supabaseClient.from("conversation_participants").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", currentConversationId).eq("user_id", currentUser.id);
  await supabaseClient.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", currentConversationId);
  await loadMessages(currentConversationId);
  loadUsers();
}
async function startConversation(userId) {
  if (!currentUser || !supabaseClient) return openAuth();
  if (userId === currentUser.id) { showToast("You cannot message yourself"); return; }
  const { data: existing } = await supabaseClient.from("conversation_participants").select("conversation_id").eq("user_id", currentUser.id);
  const participantConversationIds = new Set((existing || []).map((p) => p.conversation_id));
  const { data: otherParticipants } = await supabaseClient.from("conversation_participants").select("conversation_id").eq("user_id", userId);
  const shared = (otherParticipants || []).filter((p) => participantConversationIds.has(p.conversation_id));
  if (shared.length) { location.hash = "inbox"; setTimeout(() => openConversation(shared[0].conversation_id, ""), 50); return; }
  const { data: conversation, error } = await supabaseClient.from("conversations").insert({}).select("id").single();
  if (error) { showToast(error.message); return; }
  await supabaseClient.from("conversation_participants").insert([{ conversation_id: conversation.id, user_id: currentUser.id }, { conversation_id: conversation.id, user_id: userId }]);
  location.hash = "inbox";
  setTimeout(() => openConversation(conversation.id, ""), 50);
}
async function loadStoriesRow() {
  const list = document.querySelector("#stories-list");
  if (!list || !supabaseClient) return;
  const { data: stories, error } = await supabaseClient.from("stories").select("id, user_id, media_url, media_type, text, created_at").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false });
  if (error || !stories?.length) { list.replaceChildren(); return; }
  const userIds = [...new Set(stories.map((s) => s.user_id))];
  const { data: profiles } = await supabaseClient.from("profiles").select("id, display_name, avatar_url").in("id", userIds);
  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  list.replaceChildren();
  for (const story of stories) {
    const profile = profileMap.get(story.user_id);
    const name = profile?.display_name || "Story";
    const initials = (name || "?").slice(0, 2).toUpperCase();
    const avatarHtml = profile?.avatar_url ? `<img src="${escapeAttr(profile.avatar_url)}" alt="">` : initials;
    const item = document.createElement("div");
    item.className = "story";
    item.innerHTML = `<div class="story-ring"><div class="story-avatar" style="${profile?.avatar_url ? "background:transparent;" : ""}">${avatarHtml}</div></div><span class="story-name">${escapeHtml(name)}</span>`;
    item.addEventListener("click", () => openStoryViewer(story, profile));
    list.append(item);
  }
}
async function uploadStoryMedia(file) {
  if (!file || !currentUser) return;
  const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "bin";
  const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabaseClient.storage.from("stories").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = supabaseClient.storage.from("stories").getPublicUrl(path);
  return { url: data.publicUrl, type: file.type.startsWith("video/") ? "video" : "image" };
}
async function createStory() {
  if (!currentUser || !supabaseClient) return openAuth();
  const fileInput = document.querySelector("#story-file");
  const textInput = document.querySelector("#story-text-input");
  const file = fileInput?.files?.[0];
  if (!file) { showToast("Choose a photo or video"); return; }
  try {
    const media = await uploadStoryMedia(file);
    const { error } = await supabaseClient.from("stories").insert({ user_id: currentUser.id, media_url: media.url, media_type: media.type, text: textInput.value.trim() || "" });
    if (error) throw error;
    fileInput.value = "";
    textInput.value = "";
    document.querySelector("#story-modal").classList.remove("open");
    showToast("Story shared");
    loadStoriesRow();
  } catch (error) {
    showToast(error.message || "Could not create story");
  }
}
let currentStoryIndex = 0;
let currentStoryList = [];
let storyTimer = null;
function openStoryViewer(story, profile) {
  currentStoryList = [story];
  currentStoryIndex = 0;
  const viewer = document.querySelector("#story-viewer");
  viewer.classList.add("open");
  renderStoryItem(story);
}
function renderStoryItem(story) {
  const container = document.querySelector("#story-media");
  const textEl = document.querySelector("#story-text");
  const progressContainer = document.querySelector("#story-progress");
  progressContainer.replaceChildren();
  textEl.textContent = story.text || "";
  if (story.media_type === "video") {
    container.innerHTML = `<video src="${escapeAttr(story.media_url)}" autoplay playsinline muted></video>`;
  } else {
    container.innerHTML = `<img src="${escapeAttr(story.media_url)}" alt="Story">`;
  }
  const bar = document.createElement("div");
  bar.className = "story-progress-bar";
  const fill = document.createElement("div");
  fill.className = "story-progress-fill active";
  bar.append(fill);
  progressContainer.append(bar);
  storyTimer = setTimeout(() => closeStoryViewer(), 5000);
}
function closeStoryViewer() {
  clearTimeout(storyTimer);
  document.querySelector("#story-viewer").classList.remove("open");
  document.querySelector("#story-media").replaceChildren();
  document.querySelector("#story-progress").replaceChildren();
}
function toggleSaved(story, post) {
  state.saved = state.saved.includes(story.id) ? state.saved.filter((id) => id !== story.id) : [...state.saved, story.id];
  localStorage.setItem("dairy-saved", JSON.stringify(state.saved));
  const button = post.querySelector(".save-story");
  const active = state.saved.includes(story.id);
  button.classList.toggle("active", active);
  button.textContent = active ? "♥ Saved" : "♡ Save";
  if (!active && post.parentElement?.id === "saved-list") post.remove();
  showToast(active ? "Saved for later" : "Removed from saved");
}
function renderCollection(id, stories) {
  const target = document.querySelector(`#${id}`);
  target.replaceChildren();
  if (!stories.length) { target.innerHTML = '<div class="empty-state">Nothing here yet. Stories will appear as you explore.</div>'; return; }
  stories.forEach((story) => renderStory(story, target));
}
function renderProfile() {
  const nameEl = document.querySelector("#profile-name");
  const emailEl = document.querySelector("#profile-email");
  const avatarEl = document.querySelector("#profile-avatar");
  const storiesEl = document.querySelector("#profile-stories");
  const likesEl = document.querySelector("#profile-likes");
  const joinedEl = document.querySelector("#profile-joined");
  const bioEl = document.querySelector("#profile-bio");
  const gridEl = document.querySelector("#profile-grid");
  if (!nameEl) return;
  const profileId = location.hash.includes("profile-") ? location.hash.split("profile-")[1] : (currentUser?.id || null);
  if (!profileId) {
    nameEl.textContent = "Sign in to view your profile";
    emailEl.textContent = "";
    avatarEl.textContent = "?";
    storiesEl.textContent = "0";
    likesEl.textContent = "0";
    joinedEl.textContent = "-";
    if (bioEl) bioEl.textContent = "";
    gridEl.replaceChildren();
    gridEl.innerHTML = '<div class="empty-state">Sign in to see your stories.</div>';
    return;
  }
  const profileData = state.profiles.get(profileId) || {};
  const isMe = profileId === currentUser?.id;
  const initials = (profileData.display_name || "?").slice(0, 2).toUpperCase();
  const avatarUrl = profileData.avatar_url || "";
  avatarEl.className = "avatar profile-avatar" + (avatarUrl ? " has-image" : "");
  avatarEl.innerHTML = avatarUrl ? `<img src="${escapeAttr(avatarUrl)}" alt="">` : initials;
  nameEl.textContent = profileData.display_name || "User";
  emailEl.textContent = profileData.email || "";
  if (bioEl) bioEl.textContent = profileData.bio || "";
  const userStories = state.stories.filter((story) => story.author?.id === profileId);
  storiesEl.textContent = userStories.length;
  likesEl.textContent = userStories.reduce((sum, story) => sum + (Number(story.likes) || 0), 0);
  joinedEl.textContent = profileData.created_at ? new Date(profileData.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "-";
  renderProfileGrid("profile-grid", userStories);
}
function renderProfileGrid(id, stories) {
  const target = document.querySelector(`#${id}`);
  target.replaceChildren();
  if (!stories.length) { target.innerHTML = '<div class="empty-state">Nothing here yet.</div>'; return; }
  for (const story of stories) {
    const item = document.createElement("div");
    item.className = "post";
    const media = (story.media || []).map((m) => m.type === "video" ? `<video class="post-image" src="${escapeAttr(m.url)}" controls preload="metadata"></video>` : `<img class="post-image" src="${escapeAttr(m.url)}" alt="" loading="lazy">`).join("");
    const feeling = story.feeling ? `<div class="post-image green"><span>${escapeHtml(story.feeling)}</span></div>` : "";
    item.innerHTML = media || feeling;
    item.addEventListener("click", () => {
      location.hash = `feed`;
      setTimeout(() => {
        const post = [...feedList.querySelectorAll(".post")].find((el) => el.querySelector(".post-copy")?.textContent === story.text);
        post?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    });
    target.append(item);
  }
}
function renderViews() {
  const query = document.querySelector("#discover-search")?.value.toLowerCase().trim() || "";
  const discoverStories = query ? state.stories.filter((story) => `${story.text} ${story.author?.name || ""} ${story.place || ""}`.toLowerCase().includes(query)) : state.stories;
  renderCollection("my-dairy-list", state.stories.filter((story) => (story.author?.id === currentUser?.id) || (story.author?.name || story.author) === state.settings.name));
  renderCollection("following-list", state.stories.filter((story) => state.follows.includes(story.author?.name || story.author)));
  renderCollection("saved-list", state.stories.filter((story) => state.saved.includes(story.id)));
  renderCollection("discover-list", discoverStories);
}
function navigate() { const requestedHash = location.hash.replace("#", "") || "feed"; const hash = document.querySelector(`#${CSS.escape(requestedHash)}.view`) ? requestedHash : "feed"; document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === hash)); document.querySelectorAll(".side-menu a").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${hash}`)); if (hash === "my-dairy" || hash === "saved" || hash === "discover" || hash === "profile" || hash === "following") renderViews(); if (hash === "profile" || hash.startsWith("profile-")) renderProfile(); if (hash === "inbox") loadUsers(); if (hash === "feed") loadStoriesRow(); }

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}
function escapeAttr(value) {
  return String(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadStories() {
  if (!supabaseClient) throw new Error("Supabase client failed to load");
  const { data, error } = await supabaseClient.from("posts").select("id, body, author_id, audience, media, location, created_at").order("created_at", { ascending: false });
  if (error) throw error;
  state.stories = await mapPosts(data || []);
  feedList.replaceChildren();
  state.stories.forEach((story) => renderStory(story));
  renderViews();
  updateAuthUi();
}

async function uploadMedia(files) {
  const uploaded = [];
  for (const file of files) {
    if (!/^image\/(jpeg|png|gif|webp)$|^video\/(mp4|webm|quicktime)$/.test(file.type)) throw new Error("Use JPG, PNG, GIF, WEBP, MP4, or WEBM files");
    if (file.size > 50 * 1024 * 1024) throw new Error("Each media file must be 50 MB or smaller");
    const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "bin";
    const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabaseClient.storage.from("post-media").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    const { data } = supabaseClient.storage.from("post-media").getPublicUrl(path);
    uploaded.push({ type: file.type.startsWith("video/") ? "video" : "image", url: data.publicUrl });
  }
  return uploaded;
}

storyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = storyInput.value.trim();
  if (!text) return;
  if (!currentUser) return openAuth();

  const button = storyForm.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Sharing...";
  try {
    const audience = audienceValue(document.querySelector("#audience").value);
    const photo = document.querySelector("#photo-url").value.trim();
    if (photo && !/^https:\/\//i.test(photo)) throw new Error("Photo URL must use HTTPS");
    const files = [...document.querySelector("#media-files").files];
    const uploadedMedia = await uploadMedia(files);
    if (photo) uploadedMedia.unshift({ type: "image", url: photo });
    const { data, error } = await supabaseClient.from("posts").insert({ author_id: currentUser.id, body: text, audience, location: document.querySelector("#place").value.trim(), media: uploadedMedia }).select("id, body, author_id, audience, media, location, created_at").single();
    if (error) throw error;
    const story = (await mapPosts([data]))[0];
    state.stories.unshift(story);
    renderStory(story);
    renderViews();
    storyInput.value = "";
    localStorage.removeItem("dairy-composer-draft");
    if (state.settings.rememberComposerMeta) {
      const feelingVal = document.querySelector("#feeling")?.value;
      const placeVal = document.querySelector("#place")?.value;
      if (feelingVal) localStorage.setItem("dairy-composer-feeling", feelingVal);
      if (placeVal) localStorage.setItem("dairy-composer-place", placeVal);
    }
    document.querySelector("#media-files").value = "";
    document.querySelector("#media-preview").replaceChildren();
  } catch (error) {
    showToast(error.message || "Could not publish story");
  } finally {
    button.disabled = false;
    button.textContent = "Share story";
  }
});

storyInput?.addEventListener("input", () => {
  if (state.settings.autoSaveDrafts) {
    localStorage.setItem("dairy-composer-draft", storyInput.value);
  }
});

document.querySelector(".composer-toggle")?.addEventListener("click", () => document.querySelector("#composer-options")?.classList.toggle("open"));
document.querySelector("#media-files")?.addEventListener("change", (event) => {
  const preview = document.querySelector("#media-preview");
  preview.replaceChildren();
  [...event.target.files].forEach((file) => {
    const element = document.createElement(file.type.startsWith("video/") ? "video" : "img");
    element.src = URL.createObjectURL(file);
    element.setAttribute("aria-label", file.name);
    if (element.tagName === "VIDEO") element.controls = true;
    preview.append(element);
  });
});
document.querySelector(".story[href='#your-story']")?.addEventListener("click", (event) => {
  event.preventDefault();
  location.hash = "feed";
  storyInput.focus();
  showToast(currentUser ? "Write your story below" : "Sign in to share your story");
  if (!currentUser) openAuth();
});
document.querySelector("#search")?.addEventListener("input", (event) => {
  const query = event.target.value.toLowerCase().trim();
  document.querySelectorAll("#feed-list .post").forEach((post) => {
    post.hidden = Boolean(query && !post.textContent.toLowerCase().includes(query));
  });
});
document.querySelector("#discover-search")?.addEventListener("input", renderViews);
document.querySelectorAll(".follow").forEach((button) => button.addEventListener("click", () => { const name = button.closest(".person").querySelector("strong").textContent; state.follows = state.follows.includes(name) ? state.follows.filter((item) => item !== name) : [...state.follows, name]; localStorage.setItem("dairy-follows", JSON.stringify(state.follows)); button.textContent = state.follows.includes(name) ? "Following" : "Follow"; }));
document.addEventListener("click", (event) => {
  const button = event.target.closest(".follow");
  if (!button) return;
  const name = button.closest(".person").querySelector("strong").textContent;
  state.follows = state.follows.includes(name) ? state.follows.filter((item) => item !== name) : [...state.follows, name];
  localStorage.setItem("dairy-follows", JSON.stringify(state.follows));
  button.textContent = state.follows.includes(name) ? "Following" : "Follow";
});
document.querySelector("#inbox-search")?.addEventListener("input", async (event) => {
  const query = event.target.value.toLowerCase().trim();
  const items = document.querySelectorAll("#user-list .conversation-item");
  items.forEach((item) => {
    const text = item.textContent.toLowerCase();
    item.hidden = Boolean(query && !text.includes(query));
  });
});
document.querySelector("#inbox-composer")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#inbox-input");
  await sendMessage(input.value);
  input.value = "";
});
document.querySelectorAll(".profile-actions .button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.textContent.trim().toLowerCase() === "edit profile") {
      location.hash = "settings";
    } else if (button.textContent.trim().toLowerCase() === "share profile") {
      navigator.clipboard.writeText(location.href).then(() => showToast("Profile link copied")).catch(() => showToast("Profile ready to share"));
    }
  });
});
async function uploadAvatar(file) {
  if (!file || !currentUser) return;
  if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) throw new Error("Use JPG, PNG, GIF, or WEBP");
  if (file.size > 2 * 1024 * 1024) throw new Error("Avatar must be 2 MB or smaller");
  const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "bin";
  const path = `${currentUser.id}/avatar.${extension}`;
  const { error } = await supabaseClient.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  const { data } = supabaseClient.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = data.publicUrl;
  const { error: updateError } = await supabaseClient.from("profiles").update({ avatar_url: avatarUrl }).eq("id", currentUser.id);
  if (updateError) throw updateError;
  state.profiles.set(currentUser.id, { ...state.profiles.get(currentUser.id), avatar_url: avatarUrl });
  return avatarUrl;
}
function loadSettingsUi() {
  const s = state.settings;
  const setVal = (id, val) => { const el = document.querySelector(id); if (el && val !== undefined) el.value = val; };
  const setCheck = (id, val) => { const el = document.querySelector(id); if (el && val !== undefined) el.checked = Boolean(val); };

  setVal("#setting-name", s.name || "");
  setVal("#setting-email", currentUser?.email || "");
  setVal("#setting-bio", s.bio || "");
  setVal("#setting-audience", s.audience || "Public");
  setVal("#setting-theme", s.theme || "system");
  setVal("#setting-fontsize", s.fontSize || "standard");
  setVal("#setting-feedview", s.feedView || "cards");
  setCheck("#setting-autosave", s.autoSaveDrafts !== false);
  setCheck("#setting-remembermeta", s.rememberComposerMeta !== false);
  setVal("#setting-dmprivacy", s.dmPrivacy || "everyone");
  setVal("#setting-commentprivacy", s.commentPrivacy || "everyone");
  setCheck("#setting-discoverable", s.discoverable !== false);
  setCheck("#setting-notify-replies", s.notifyReplies !== false);
  setCheck("#setting-notify-likes", s.notifyLikes !== false);
  setCheck("#setting-notify-messages", s.notifyMessages !== false);
  setCheck("#setting-notify-follows", s.notifyFollows !== false);

  applyTheme(s.theme || "system");
  applyFontSize(s.fontSize || "standard");
  applyFeedView(s.feedView || "cards");
}

// Live preview when changing appearance dropdowns
document.querySelector("#setting-theme")?.addEventListener("change", (e) => {
  applyTheme(e.target.value);
});
document.querySelector("#setting-fontsize")?.addEventListener("change", (e) => {
  applyFontSize(e.target.value);
});
document.querySelector("#setting-feedview")?.addEventListener("change", (e) => {
  applyFeedView(e.target.value);
});

// Settings form submission
document.querySelector("#settings-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fileInput = document.querySelector("#setting-avatar");
  const button = document.querySelector("#settings-save-btn");
  const statusEl = document.querySelector("#settings-status");
  if (button) button.disabled = true;
  if (statusEl) statusEl.textContent = "Saving preferences...";

  try {
    if (fileInput?.files?.[0]) {
      await uploadAvatar(fileInput.files[0]);
      showToast("Profile picture updated");
    }

    const name = document.querySelector("#setting-name")?.value.trim() || "You";
    const bio = document.querySelector("#setting-bio")?.value.trim() || "";
    const audience = document.querySelector("#setting-audience")?.value || "Public";
    const theme = document.querySelector("#setting-theme")?.value || "system";
    const fontSize = document.querySelector("#setting-fontsize")?.value || "standard";
    const feedView = document.querySelector("#setting-feedview")?.value || "cards";
    const autoSaveDrafts = Boolean(document.querySelector("#setting-autosave")?.checked);
    const rememberComposerMeta = Boolean(document.querySelector("#setting-remembermeta")?.checked);
    const dmPrivacy = document.querySelector("#setting-dmprivacy")?.value || "everyone";
    const commentPrivacy = document.querySelector("#setting-commentprivacy")?.value || "everyone";
    const discoverable = Boolean(document.querySelector("#setting-discoverable")?.checked);
    const notifyReplies = Boolean(document.querySelector("#setting-notify-replies")?.checked);
    const notifyLikes = Boolean(document.querySelector("#setting-notify-likes")?.checked);
    const notifyMessages = Boolean(document.querySelector("#setting-notify-messages")?.checked);
    const notifyFollows = Boolean(document.querySelector("#setting-notify-follows")?.checked);

    state.settings = {
      name,
      bio,
      audience,
      theme,
      fontSize,
      feedView,
      autoSaveDrafts,
      rememberComposerMeta,
      dmPrivacy,
      commentPrivacy,
      discoverable,
      notifyReplies,
      notifyLikes,
      notifyMessages,
      notifyFollows
    };
    localStorage.setItem("dairy-settings", JSON.stringify(state.settings));

    applyTheme(theme);
    applyFontSize(fontSize);
    applyFeedView(feedView);

    if (currentUser) {
      const updates = { display_name: name, bio };
      const { error: profileError } = await supabaseClient.from("profiles").update(updates).eq("id", currentUser.id);
      if (profileError) console.warn("Supabase profile update warning:", profileError);
    }

    showToast("Settings saved successfully");
    if (statusEl) {
      statusEl.textContent = "Saved";
      setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);
    }
    renderViews();
    renderProfile();
  } catch (error) {
    showToast(error.message || "Could not update settings");
    if (statusEl) statusEl.textContent = "";
  } finally {
    if (button) button.disabled = false;
  }
});

// Export stories
function exportDiary(format = "json") {
  const myStories = state.stories.filter(
    (story) => (story.author?.id === currentUser?.id) || ((story.author?.name || story.author) === state.settings.name)
  );
  const storiesToExport = myStories.length ? myStories : state.stories;

  if (!storiesToExport.length) {
    showToast("No stories to export yet. Write a story first!");
    return;
  }

  const nowStr = new Date().toISOString().slice(0, 10);
  let blob, filename;

  if (format === "json") {
    const data = {
      generator: "Dairy (https://github.com/Gezo18/dairy)",
      exportedAt: new Date().toISOString(),
      author: {
        name: state.settings.name,
        email: currentUser?.email || "anonymous",
        bio: state.settings.bio || ""
      },
      storyCount: storiesToExport.length,
      stories: storiesToExport.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        text: s.text,
        feeling: s.feeling || "",
        place: s.place || "",
        audience: s.audience,
        likes: s.likes || 0,
        comments: s.comments || 0,
        media: s.media || []
      }))
    };
    blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    filename = `dairy-stories-${nowStr}.json`;
  } else {
    let md = `# Dairy Journal - ${state.settings.name}\n\n`;
    md += `*Exported on ${new Date().toLocaleDateString()} (${storiesToExport.length} stories)*\n\n`;
    if (state.settings.bio) md += `> ${state.settings.bio}\n\n`;
    md += `---\n\n`;

    storiesToExport.forEach((s, idx) => {
      md += `## ${idx + 1}. ${formatDate(s.createdAt)}\n\n`;
      const meta = [s.feeling ? `Feeling: ${s.feeling}` : "", s.place ? `Location: ${s.place}` : "", `Audience: ${s.audience}`].filter(Boolean);
      if (meta.length) md += `*${meta.join(" · ")}*\n\n`;
      md += `${s.text}\n\n`;
      if (s.media && s.media.length) {
        s.media.forEach((m) => {
          if (m.type === "video") {
            md += `[Video Link](${m.url})\n\n`;
          } else {
            md += `![Image](${m.url})\n\n`;
          }
        });
      }
      md += `❤️ ${s.likes || 0} likes · 💬 ${s.comments || 0} comments\n\n---\n\n`;
    });

    blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    filename = `dairy-journal-${nowStr}.md`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`Exported ${storiesToExport.length} stories as ${format.toUpperCase()}`);
}

document.querySelector("#setting-export-json")?.addEventListener("click", () => exportDiary("json"));
document.querySelector("#setting-export-md")?.addEventListener("click", () => exportDiary("markdown"));

// Password Change
document.querySelector("#settings-password-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) {
    showToast("Please sign in first to change password");
    openAuth();
    return;
  }
  const newPass = document.querySelector("#setting-newpassword")?.value;
  const confirmPass = document.querySelector("#setting-confirmpassword")?.value;
  const btn = document.querySelector("#setting-password-btn");

  if (!newPass || newPass.length < 8) {
    showToast("Password must be at least 8 characters");
    return;
  }
  if (newPass !== confirmPass) {
    showToast("Passwords do not match");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Updating...";
  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPass });
    if (error) throw error;
    showToast("Password updated successfully!");
    document.querySelector("#settings-password-form")?.reset();
  } catch (err) {
    showToast(err.message || "Failed to update password");
  } finally {
    btn.disabled = false;
    btn.textContent = "Update Password";
  }
});

// Sign out buttons
document.querySelector("#settings-signout")?.addEventListener("click", async () => {
  if (currentUser) {
    await supabaseClient.auth.signOut();
    showToast("Signed out successfully");
  } else {
    showToast("You are already signed out");
  }
});

document.querySelector("#settings-signout-all")?.addEventListener("click", async () => {
  if (!currentUser) {
    showToast("You are already signed out");
    return;
  }
  try {
    await supabaseClient.auth.signOut({ scope: "global" });
    showToast("Logged out of all sessions across all devices");
  } catch (err) {
    showToast(err.message || "Could not log out of all sessions");
  }
});

// Delete account
document.querySelector("#settings-delete-account")?.addEventListener("click", async () => {
  if (!currentUser) {
    showToast("You must be signed in to delete your account");
    return;
  }
  const confirmed = confirm("Are you sure you want to permanently delete your account and all your stories? This action cannot be undone.");
  if (!confirmed) return;

  try {
    showToast("Deleting account data...");
    await supabaseClient.from("posts").delete().eq("author_id", currentUser.id);
    await supabaseClient.from("profiles").delete().eq("id", currentUser.id);
    await supabaseClient.auth.signOut();
    localStorage.removeItem("dairy-settings");
    localStorage.removeItem("dairy-composer-draft");
    showToast("Account deleted successfully");
    location.hash = "feed";
    location.reload();
  } catch (err) {
    showToast(err.message || "Could not delete account");
  }
});
document.querySelectorAll(".profile-tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".profile-tab").forEach((t) => { t.classList.toggle("active", t === tab); t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
  const grid = document.querySelector("#profile-grid");
  grid.replaceChildren();
  if (tab.dataset.tab === "posts") {
    const myStories = state.stories.filter((story) => story.author?.id === currentUser?.id);
    renderProfileGrid("profile-grid", myStories);
  } else if (tab.dataset.tab === "saved") {
    const saved = state.stories.filter((story) => state.saved.includes(story.id));
    renderProfileGrid("profile-grid", saved);
  } else if (tab.dataset.tab === "tagged") {
    grid.innerHTML = '<div class="empty-state">Stories tagged by others will appear here.</div>';
  }
}));
window.addEventListener("hashchange", navigate);
navigate();

authButton?.addEventListener("click", async () => {
  if (!currentUser) return openAuth();
  await supabaseClient.auth.signOut();
});
document.querySelector("#auth-close")?.addEventListener("click", closeAuth);
document.querySelector("#auth-switch")?.addEventListener("click", () => openAuth(authMode === "signin" ? "signup" : "signin"));
authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorTarget = document.querySelector("#auth-error");
  const submitButton = document.querySelector("#auth-submit");
  errorTarget.textContent = "";
  const email = document.querySelector("#auth-email").value.trim();
  const password = document.querySelector("#auth-password").value;
  const name = document.querySelector("#auth-name").value.trim();
  submitButton.disabled = true;
  submitButton.textContent = authMode === "signin" ? "Signing in..." : "Creating account...";
  try {
    const result = authMode === "signin"
      ? await supabaseClient.auth.signInWithPassword({ email, password })
      : await supabaseClient.auth.signUp({ email, password, options: { data: { display_name: name } } });
    if (result.error) {
      const message = result.error.message.toLowerCase();
      errorTarget.textContent = message.includes("rate limit") || message.includes("email rate")
        ? "Email limit reached. Wait up to an hour, then use the newest confirmation email. If you already confirmed, switch to Sign in."
        : result.error.message;
      return;
    }
    closeAuth();
    if (authMode === "signup" && !result.data.session) showToast("Confirmation sent. Check Gmail, then sign in here.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = authMode === "signin" ? "Sign in" : "Create account";
  }
});
document.querySelector("#theme-toggle")?.addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const newTheme = isDark ? "light" : "dark";
  state.settings.theme = newTheme;
  applyTheme(newTheme);
  const themeSelect = document.querySelector("#setting-theme");
  if (themeSelect) themeSelect.value = newTheme;
  localStorage.setItem("dairy-settings", JSON.stringify(state.settings));
});

// Restore drafts and composer memory if enabled
if (state.settings.autoSaveDrafts) {
  const savedDraft = localStorage.getItem("dairy-composer-draft");
  if (savedDraft && storyInput && !storyInput.value) {
    storyInput.value = savedDraft;
  }
}
if (state.settings.rememberComposerMeta) {
  const savedFeeling = localStorage.getItem("dairy-composer-feeling");
  const savedPlace = localStorage.getItem("dairy-composer-place");
  const feelingInput = document.querySelector("#feeling");
  const placeInput = document.querySelector("#place");
  if (savedFeeling && feelingInput) feelingInput.value = savedFeeling;
  if (savedPlace && placeInput) placeInput.value = savedPlace;
}
loadSettingsUi();
supabaseClient?.auth.getSession().then(({ data }) => {
  currentUser = data.session?.user || null;
  updateAuthUi();
  loadStories().catch((error) => { feedList.innerHTML = `<div class="empty-state">${escapeHtml(currentUser ? error.message : "Sign in to load the community feed")}</div>`; });
  loadSuggestions();
  loadUsers();
  loadStoriesRow();
  supabaseClient.channel("inbox").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
    if (payload.new.conversation_id === currentConversationId) loadMessages(currentConversationId);
    loadConversations();
  }).subscribe();
});
supabaseClient?.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  updateAuthUi();
  loadStories().catch(() => {});
  loadSuggestions();
  loadUsers();
  loadStoriesRow();
});
document.querySelector("#your-story")?.addEventListener("click", () => {
  if (!currentUser) return openAuth();
  document.querySelector("#story-modal")?.classList.add("open");
});
document.querySelector("#story-cancel")?.addEventListener("click", () => document.querySelector("#story-modal")?.classList.remove("open"));
document.querySelector("#story-share")?.addEventListener("click", createStory);
document.querySelector("#story-close")?.addEventListener("click", closeStoryViewer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeStoryViewer();
});
setInterval(async () => {
  if (!supabaseClient) return;
  await supabaseClient.from("stories").delete().lt("expires_at", new Date().toISOString());
}, 60 * 60 * 1000);
