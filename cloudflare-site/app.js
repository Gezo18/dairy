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
  const avatarUrl = profileData?.avatar_url || state.settings?.avatarUrl || "";
  if (headerAvatar) {
    if (avatarUrl) {
      headerAvatar.innerHTML = `<img src="${escapeAttr(avatarUrl)}" alt="">`;
      headerAvatar.classList.add("has-image");
    } else {
      headerAvatar.textContent = currentUser?.user_metadata?.display_name?.slice(0, 2).toUpperCase() || state.settings.name?.slice(0, 2).toUpperCase() || "AM";
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
let currentChatPartner = null;
let activeInboxTab = "chats";
let cachedConversations = [];
let cachedProfiles = [];

function formatMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now - date;
  if (diffMs < 60000) return "Just now";
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return timeStr;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${timeStr}`;
  }
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${timeStr}`;
}

function getLocalConversationsStore() {
  try {
    return JSON.parse(localStorage.getItem("dairy-conversations-store") || "{}");
  } catch {
    return {};
  }
}

function saveLocalConversationsStore(store) {
  try {
    localStorage.setItem("dairy-conversations-store", JSON.stringify(store));
  } catch (e) {
    console.warn("Failed to persist conversation store:", e);
  }
}

function getPairKey(userA, userB) {
  return [String(userA), String(userB)].sort().join("::");
}

function switchInboxTab(tabName) {
  activeInboxTab = tabName;
  const chatsTabBtn = document.querySelector("#inbox-tab-chats");
  const peopleTabBtn = document.querySelector("#inbox-tab-people");
  const threadsList = document.querySelector("#conversation-threads-list");
  const userList = document.querySelector("#user-list");
  const searchInput = document.querySelector("#inbox-search");

  if (tabName === "chats") {
    chatsTabBtn?.classList.add("active");
    chatsTabBtn?.setAttribute("aria-selected", "true");
    peopleTabBtn?.classList.remove("active");
    peopleTabBtn?.setAttribute("aria-selected", "false");
    if (threadsList) threadsList.hidden = false;
    if (userList) userList.hidden = true;
    if (searchInput) searchInput.placeholder = "Search conversations...";
    loadConversations();
  } else {
    peopleTabBtn?.classList.add("active");
    peopleTabBtn?.setAttribute("aria-selected", "true");
    chatsTabBtn?.classList.remove("active");
    chatsTabBtn?.setAttribute("aria-selected", "false");
    if (threadsList) threadsList.hidden = true;
    if (userList) userList.hidden = false;
    if (searchInput) searchInput.placeholder = "Search community writers...";
    loadUsers();
  }
}

async function loadConversations() {
  const list = document.querySelector("#conversation-threads-list");
  const countBadge = document.querySelector("#inbox-chats-count");
  if (!list) return;

  if (!currentUser) {
    if (countBadge) countBadge.textContent = "0";
    list.innerHTML = `
      <div class="inbox-guest-card">
        <div class="inbox-placeholder-icon">✉</div>
        <strong style="font-size:1rem;color:var(--ink);">Sign in to your Inbox</strong>
        <p style="font-size:.8rem;color:var(--muted);margin:0;">Connect and chat with writers across Dairy.</p>
        <button class="button" id="inbox-guest-login-btn" type="button" style="margin-top:4px;">Sign in / Register</button>
      </div>
    `;
    list.querySelector("#inbox-guest-login-btn")?.addEventListener("click", () => openAuth());
    return;
  }

  const store = getLocalConversationsStore();
  const localThreads = Object.values(store.conversations || {}).filter(c => 
    c.participants && (c.participants.includes(currentUser.id) || !c.participants.length)
  );

  let remoteThreads = [];

  if (supabaseClient) {
    try {
      const { data: participations, error: partErr } = await supabaseClient
        .from("conversation_participants")
        .select("conversation_id, last_read_at")
        .eq("user_id", currentUser.id);

      if (!partErr && participations && participations.length) {
        const convIds = participations.map(p => p.conversation_id);
        const { data: messages } = await supabaseClient
          .from("messages")
          .select("id, conversation_id, sender_id, body, created_at")
          .in("conversation_id", convIds)
          .order("created_at", { ascending: false });

        const otherUserIds = new Set();
        (messages || []).forEach(m => {
          if (m.sender_id !== currentUser.id) otherUserIds.add(m.sender_id);
        });
        convIds.forEach(id => {
          const partnerId = store.partnerMap?.[id];
          if (partnerId && partnerId !== currentUser.id) otherUserIds.add(partnerId);
        });

        let profilesMap = new Map();
        if (otherUserIds.size > 0) {
          const { data: profiles } = await supabaseClient
            .from("profiles")
            .select("id, display_name, avatar_url, bio")
            .in("id", [...otherUserIds]);
          (profiles || []).forEach(p => profilesMap.set(p.id, p));
        }

        participations.forEach(part => {
          const convMsgs = (messages || []).filter(m => m.conversation_id === part.conversation_id);
          const lastMsg = convMsgs[0] || null;
          let partnerId = store.partnerMap?.[part.conversation_id] || null;
          if (!partnerId && lastMsg) {
            partnerId = lastMsg.sender_id !== currentUser.id ? lastMsg.sender_id : null;
          }
          const partner = partnerId ? profilesMap.get(partnerId) : null;
          remoteThreads.push({
            id: part.conversation_id,
            partnerId: partnerId,
            partner: partner || { id: partnerId || "writer", display_name: "Dairy Writer", avatar_url: "", bio: "" },
            lastMessage: lastMsg ? lastMsg.body : "Conversation started",
            lastMessageTime: lastMsg ? lastMsg.created_at : null,
            lastSenderId: lastMsg ? lastMsg.sender_id : null,
            hasUnread: Boolean(lastMsg && lastMsg.sender_id !== currentUser.id && (!part.last_read_at || new Date(lastMsg.created_at) > new Date(part.last_read_at)))
          });
        });
      }
    } catch (err) {
      console.warn("Could not query remote conversations:", err);
    }
  }

  const threadMap = new Map();
  localThreads.forEach(t => threadMap.set(t.id, t));
  remoteThreads.forEach(t => threadMap.set(t.id, t));

  const threads = [...threadMap.values()].sort((a, b) => {
    const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
    const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
    return timeB - timeA;
  });

  cachedConversations = threads;
  if (countBadge) countBadge.textContent = String(threads.length);

  if (!threads.length) {
    list.innerHTML = `
      <div style="padding:32px 16px;text-align:center;color:var(--muted);font-size:.84rem;display:flex;flex-direction:column;align-items:center;gap:10px;">
        <span style="font-size:1.6rem;">💬</span>
        <strong>No active conversations yet</strong>
        <p style="margin:0;font-size:.78rem;line-height:1.4;">Meet writers in the Community tab to start your first message thread.</p>
        <button class="button secondary compact" id="inbox-switch-to-community-btn" type="button">Find writers</button>
      </div>
    `;
    list.querySelector("#inbox-switch-to-community-btn")?.addEventListener("click", () => switchInboxTab("people"));
    return;
  }

  list.replaceChildren();
  for (const thread of threads) {
    const item = document.createElement("button");
    item.className = "conversation-item" + (thread.hasUnread ? " has-unread" : "");
    item.type = "button";
    item.dataset.conversationId = thread.id;
    if (thread.partner?.id) item.dataset.userId = thread.partner.id;
    if (currentConversationId === thread.id) item.classList.add("active");

    const partnerName = thread.partner?.display_name || "Community Member";
    const initials = partnerName.slice(0, 2).toUpperCase();
    const avatarHtml = thread.partner?.avatar_url ? `<img src="${escapeAttr(thread.partner.avatar_url)}" alt="">` : initials;
    const isMine = thread.lastSenderId === currentUser.id;
    const prefix = isMine ? "You: " : "";
    const preview = prefix + (thread.lastMessage || "Conversation started");
    const formattedTime = formatMessageTime(thread.lastMessageTime);

    item.innerHTML = `
      <div class="avatar" style="${thread.partner?.avatar_url ? "background:transparent;" : ""}">
        ${avatarHtml}
        <span class="status-dot"></span>
      </div>
      <div class="conversation-meta">
        <div class="conversation-meta-top">
          <strong>${escapeHtml(partnerName)}</strong>
          ${formattedTime ? `<time>${escapeHtml(formattedTime)}</time>` : ""}
        </div>
        <span>${escapeHtml(preview)}</span>
      </div>
      ${thread.hasUnread ? '<span class="unread-dot"></span>' : ""}
    `;

    item.addEventListener("click", () => {
      openConversation(thread.id, thread.partner);
    });

    list.append(item);
  }
}

async function loadUsers() {
  const list = document.querySelector("#user-list");
  if (!list) return;

  if (!currentUser) {
    list.innerHTML = `
      <div class="inbox-guest-card">
        <strong style="font-size:1rem;color:var(--ink);">Find Writers</strong>
        <p style="font-size:.8rem;color:var(--muted);margin:0;">Sign in to discover community writers and start private conversations.</p>
        <button class="button" id="inbox-users-guest-btn" type="button" style="margin-top:4px;">Sign in / Register</button>
      </div>
    `;
    list.querySelector("#inbox-users-guest-btn")?.addEventListener("click", () => openAuth());
    return;
  }

  let profiles = [];
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, display_name, avatar_url, bio")
        .neq("id", currentUser.id)
        .order("display_name");
      if (!error && data?.length) profiles = data;
    } catch (e) {
      console.warn("Could not load profiles from Supabase:", e);
    }
  }

  if (!profiles.length) {
    profiles = [
      { id: "writer-maya", display_name: "Maya Lin", avatar_url: "", bio: "Architecture, coffee, and quiet reflections." },
      { id: "writer-liam", display_name: "Liam Vance", avatar_url: "", bio: "Documenting city strolls and evening thoughts." },
      { id: "writer-elena", display_name: "Elena Rostova", avatar_url: "", bio: "Poetry in motion. Sharing life in watercolors." }
    ];
  }

  cachedProfiles = profiles;
  list.replaceChildren();

  for (const profile of profiles) {
    const item = document.createElement("button");
    item.className = "conversation-item";
    item.type = "button";
    item.dataset.userId = profile.id;
    if (currentChatPartner?.id === profile.id) item.classList.add("active");

    const initials = (profile.display_name || "?").slice(0, 2).toUpperCase();
    const avatarHtml = profile.avatar_url ? `<img src="${escapeAttr(profile.avatar_url)}" alt="">` : initials;

    item.innerHTML = `
      <div class="avatar" style="${profile.avatar_url ? "background:transparent;" : ""}">
        ${avatarHtml}
      </div>
      <div class="conversation-meta">
        <strong>${escapeHtml(profile.display_name)}</strong>
        <span>${escapeHtml(profile.bio || "Dairy Writer")}</span>
      </div>
    `;

    item.addEventListener("click", () => startConversation(profile.id, profile));
    list.append(item);
  }
}

async function startConversation(userId, profile) {
  if (!currentUser) return openAuth();
  if (userId === currentUser.id) {
    showToast("You cannot message yourself");
    return;
  }

  const pairKey = getPairKey(currentUser.id, userId);
  const store = getLocalConversationsStore();
  if (!store.pairs) store.pairs = {};
  if (!store.conversations) store.conversations = {};
  if (!store.partnerMap) store.partnerMap = {};

  let convId = store.pairs[pairKey];

  if (!convId && supabaseClient) {
    try {
      const { data: existing } = await supabaseClient
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", currentUser.id);

      const myConvIds = new Set((existing || []).map((p) => p.conversation_id));
      const { data: otherParticipants } = await supabaseClient
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", userId);

      const shared = (otherParticipants || []).filter((p) => myConvIds.has(p.conversation_id));
      if (shared.length) {
        convId = shared[0].conversation_id;
      }
    } catch (e) {
      console.warn("Error looking up existing conversation:", e);
    }
  }

  if (!convId) {
    if (supabaseClient) {
      try {
        const { data: newConv, error: convErr } = await supabaseClient
          .from("conversations")
          .insert({})
          .select("id")
          .single();

        if (!convErr && newConv) {
          convId = newConv.id;
          await supabaseClient.from("conversation_participants").insert({
            conversation_id: convId,
            user_id: currentUser.id
          });
          try {
            await supabaseClient.from("conversation_participants").insert({
              conversation_id: convId,
              user_id: userId
            });
          } catch (pe) {}
        }
      } catch (e) {
        console.warn("Supabase conversation creation failed:", e);
      }
    }

    if (!convId) {
      convId = "conv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    }
  }

  store.pairs[pairKey] = convId;
  store.partnerMap[convId] = userId;
  if (!store.conversations[convId]) {
    store.conversations[convId] = {
      id: convId,
      partnerId: userId,
      partner: profile || { id: userId, display_name: "Dairy Writer", avatar_url: "", bio: "" },
      participants: [currentUser.id, userId],
      lastMessage: "Conversation started",
      lastMessageTime: new Date().toISOString(),
      lastSenderId: currentUser.id
    };
  }
  saveLocalConversationsStore(store);

  location.hash = "inbox";
  setTimeout(() => openConversation(convId, profile), 40);
}

async function openConversation(conversationId, partner) {
  if (!conversationId) return;
  currentConversationId = conversationId;
  currentChatPartner = partner || null;

  const container = document.querySelector("#inbox-container");
  const placeholder = document.querySelector("#inbox-placeholder");
  const header = document.querySelector("#inbox-chat-header");
  const messagesEl = document.querySelector("#inbox-messages");
  const composer = document.querySelector("#inbox-composer");

  if (container) container.classList.add("chat-open");
  if (placeholder) placeholder.hidden = true;
  if (header) header.hidden = false;
  if (messagesEl) messagesEl.hidden = false;
  if (composer) composer.hidden = false;

  if (!partner || !partner.display_name) {
    const store = getLocalConversationsStore();
    const thread = store.conversations?.[conversationId];
    if (thread?.partner) {
      partner = thread.partner;
      currentChatPartner = partner;
    }
  }

  const partnerName = partner?.display_name || "Community Member";
  const initials = partnerName.slice(0, 2).toUpperCase();
  const avatarEl = document.querySelector("#inbox-header-avatar");
  if (avatarEl) {
    avatarEl.innerHTML = partner?.avatar_url ? `<img src="${escapeAttr(partner.avatar_url)}" alt="">` : initials;
    avatarEl.style.background = partner?.avatar_url ? "transparent" : "";
  }
  const nameEl = document.querySelector("#inbox-header-name");
  if (nameEl) nameEl.textContent = partnerName;
  const statusEl = document.querySelector("#inbox-header-status");
  if (statusEl) statusEl.textContent = partner?.bio || "Active on Dairy";

  const profileBtn = document.querySelector("#inbox-view-profile-btn");
  if (profileBtn) {
    profileBtn.onclick = () => {
      location.hash = partner?.id ? `profile-${partner.id}` : "discover";
    };
  }

  document.querySelectorAll(".conversation-item").forEach((item) => {
    const matches = item.dataset.conversationId === conversationId || 
                    (partner?.id && item.dataset.userId === partner.id);
    item.classList.toggle("active", Boolean(matches));
    if (matches) item.classList.remove("has-unread");
  });

  if (currentUser && supabaseClient && !conversationId.startsWith("conv_")) {
    supabaseClient.from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", currentUser.id)
      .then(() => {});
  }

  await loadMessages(conversationId);
  document.querySelector("#inbox-input")?.focus();
}

async function loadMessages(conversationId) {
  const container = document.querySelector("#inbox-messages");
  if (!container) return;

  let localMessages = [];
  try {
    localMessages = JSON.parse(localStorage.getItem(`dairy-msgs-${conversationId}`) || "[]");
  } catch {}

  let remoteMessages = [];
  if (supabaseClient && currentUser && !conversationId.startsWith("conv_")) {
    try {
      const { data, error } = await supabaseClient
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (!error && data) {
        remoteMessages = data;
      }
    } catch (err) {
      console.warn("Could not fetch remote messages:", err);
    }
  }

  const msgMap = new Map();
  localMessages.forEach(m => msgMap.set(String(m.id), m));
  remoteMessages.forEach(m => msgMap.set(String(m.id), m));
  const messages = [...msgMap.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  try {
    localStorage.setItem(`dairy-msgs-${conversationId}`, JSON.stringify(messages));
  } catch {}

  container.replaceChildren();

  if (!messages.length) {
    const partnerName = currentChatPartner?.display_name || "this writer";
    const emptyState = document.createElement("div");
    emptyState.className = "inbox-placeholder";
    emptyState.style.margin = "auto";
    emptyState.style.padding = "24px 16px";
    emptyState.innerHTML = `
      <div style="font-size:1.8rem;margin-bottom:6px;">👋</div>
      <h3 style="font-size:1.05rem;color:var(--ink);margin:0 0 4px;">Say hello to ${escapeHtml(partnerName)}</h3>
      <p style="font-size:.82rem;color:var(--muted);margin:0 0 16px;">Break the ice with a quick greeting!</p>
      <div class="inbox-icebreakers">
        <button class="icebreaker-chip" type="button">👋 Hi there!</button>
        <button class="icebreaker-chip" type="button">Loved your stories!</button>
        <button class="icebreaker-chip" type="button">How's your writing going today?</button>
      </div>
    `;
    emptyState.querySelectorAll(".icebreaker-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        sendMessage(chip.textContent.trim());
      });
    });
    container.append(emptyState);
    return;
  }

  for (const message of messages) {
    const isMine = message.sender_id === currentUser?.id;
    const item = document.createElement("div");
    item.className = "inbox-message" + (isMine ? " mine" : "");
    item.dataset.messageId = message.id;

    const senderName = isMine ? "You" : (currentChatPartner?.display_name || "Writer");
    const timeStr = formatMessageTime(message.created_at);
    const checkmarks = isMine ? `<span style="font-size:.72rem;color:var(--green);" title="Delivered">✓✓</span>` : "";

    item.innerHTML = `
      <strong>${escapeHtml(senderName)}</strong>
      <p>${escapeHtml(message.body)}</p>
      <time>${escapeHtml(timeStr)} ${checkmarks}</time>
    `;
    container.append(item);
  }

  container.scrollTop = container.scrollHeight;
}

async function sendMessage(body) {
  if (!currentConversationId || !currentUser) {
    if (!currentUser) openAuth();
    return;
  }
  const text = String(body || "").trim();
  if (!text) return;

  const input = document.querySelector("#inbox-input");
  const sendBtn = document.querySelector("#inbox-send-btn");
  if (input) input.value = "";
  if (sendBtn) sendBtn.disabled = true;

  const tempId = "temp_" + Date.now();
  const container = document.querySelector("#inbox-messages");
  const tempMsg = {
    id: tempId,
    conversation_id: currentConversationId,
    sender_id: currentUser.id,
    body: text,
    created_at: new Date().toISOString()
  };

  if (container?.querySelector(".inbox-placeholder")) {
    container.replaceChildren();
  }

  if (container) {
    const item = document.createElement("div");
    item.className = "inbox-message mine";
    item.dataset.messageId = tempId;
    item.innerHTML = `
      <p>${escapeHtml(text)}</p>
      <time>${formatMessageTime(tempMsg.created_at)} <span style="font-size:.72rem;color:var(--muted);">✓</span></time>
    `;
    container.append(item);
    container.scrollTop = container.scrollHeight;
  }

  try {
    const local = JSON.parse(localStorage.getItem(`dairy-msgs-${currentConversationId}`) || "[]");
    local.push(tempMsg);
    localStorage.setItem(`dairy-msgs-${currentConversationId}`, JSON.stringify(local));
  } catch {}

  const store = getLocalConversationsStore();
  if (!store.conversations) store.conversations = {};
  store.conversations[currentConversationId] = {
    ...(store.conversations[currentConversationId] || {}),
    id: currentConversationId,
    partnerId: currentChatPartner?.id,
    partner: currentChatPartner,
    participants: [currentUser.id, currentChatPartner?.id].filter(Boolean),
    lastMessage: text,
    lastMessageTime: tempMsg.created_at,
    lastSenderId: currentUser.id
  };
  saveLocalConversationsStore(store);

  if (supabaseClient && !currentConversationId.startsWith("conv_")) {
    try {
      const { data, error } = await supabaseClient
        .from("messages")
        .insert({
          conversation_id: currentConversationId,
          sender_id: currentUser.id,
          body: text
        })
        .select("id, created_at")
        .single();

      if (!error && data) {
        const tempEl = container?.querySelector(`[data-message-id="${tempId}"]`);
        if (tempEl) {
          tempEl.dataset.messageId = data.id;
          const timeEl = tempEl.querySelector("time");
          if (timeEl) timeEl.innerHTML = `${formatMessageTime(data.created_at)} <span style="font-size:.72rem;color:var(--green);">✓✓</span>`;
        }
      }

      supabaseClient.from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", currentConversationId)
        .eq("user_id", currentUser.id)
        .then(() => {});

      supabaseClient.from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", currentConversationId)
        .then(() => {});
    } catch (e) {
      console.warn("Send remote message failed, kept local:", e);
    }
  }

  if (sendBtn) sendBtn.disabled = false;
  loadConversations();
  if (input) input.focus();
}

function handleIncomingMessage(newMsg) {
  if (!newMsg) return;
  if (newMsg.conversation_id === currentConversationId) {
    const container = document.querySelector("#inbox-messages");
    if (!container?.querySelector(`[data-message-id="${newMsg.id}"]`)) {
      loadMessages(currentConversationId);
    }
  } else if (newMsg.sender_id !== currentUser?.id) {
    showToast("New message received in Inbox");
  }
  loadConversations();
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

function fileToOptimizedDataUrl(file, maxWidth = 400, maxHeight = 400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(reader.result);
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          let { width, height } = img;
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          canvas.width = Math.max(width, 1);
          canvas.height = Math.max(height, 1);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch {
          resolve(reader.result);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadToServer(file) {
  if (!file) return "";
  const response = await fetch("/api/upload", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name || "media.bin")
    },
    body: file
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Server upload failed: ${errorText}`);
  }
  const result = await response.json();
  return result.url;
}

async function uploadStoryMedia(file) {
  if (!file) return;
  const isVideo = file.type.startsWith("video/");
  let mediaUrl = "";

  if (currentUser && supabaseClient) {
    try {
      const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "bin";
      const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
      const { data: uploadData, error } = await supabaseClient.storage.from("stories").upload(path, file, { contentType: file.type, upsert: false });
      if (!error && uploadData) {
        const { data } = supabaseClient.storage.from("stories").getPublicUrl(path);
        if (data?.publicUrl) mediaUrl = data.publicUrl;
      }
    } catch (e) {
      console.warn("Supabase stories storage unavailable, falling back:", e);
    }
  }

  if (!mediaUrl) {
    try {
      mediaUrl = await uploadToServer(file);
    } catch (e) {
      console.warn("Server upload fallback failed:", e);
    }
  }

  if (!mediaUrl && !isVideo && file.size < 5 * 1024 * 1024) {
    mediaUrl = await fileToOptimizedDataUrl(file, 1080, 1920, 0.85);
  }

  if (!mediaUrl) throw new Error("Could not upload story media");
  return { url: mediaUrl, type: isVideo ? "video" : "image" };
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
  const initials = (profileData.display_name || state.settings.name || "?").slice(0, 2).toUpperCase();
  const avatarUrl = profileData.avatar_url || (isMe ? state.settings?.avatarUrl : "") || "";
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
function navigate() { const requestedHash = location.hash.replace("#", "") || "feed"; const hash = document.querySelector(`#${CSS.escape(requestedHash)}.view`) ? requestedHash : "feed"; document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === hash)); document.querySelectorAll(".side-menu a").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${hash}`)); if (hash === "my-dairy" || hash === "saved" || hash === "discover" || hash === "profile" || hash === "following") renderViews(); if (hash === "profile" || hash.startsWith("profile-")) renderProfile(); if (hash === "inbox") { loadConversations(); loadUsers(); } if (hash === "feed") loadStoriesRow(); }

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
    const isVideo = file.type.startsWith("video/");
    let mediaUrl = "";

    if (currentUser && supabaseClient) {
      try {
        const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "bin";
        const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
        const { data: uploadData, error } = await supabaseClient.storage.from("post-media").upload(path, file, { contentType: file.type, upsert: false });
        if (!error && uploadData) {
          const { data } = supabaseClient.storage.from("post-media").getPublicUrl(path);
          if (data?.publicUrl) mediaUrl = data.publicUrl;
        }
      } catch (e) {
        console.warn("Supabase post-media storage unavailable, falling back:", e);
      }
    }

    if (!mediaUrl) {
      try {
        mediaUrl = await uploadToServer(file);
      } catch (e) {
        console.warn("Server upload fallback failed:", e);
      }
    }

    if (!mediaUrl && !isVideo && file.size < 5 * 1024 * 1024) {
      mediaUrl = await fileToOptimizedDataUrl(file, 1200, 1200, 0.85);
    }

    if (!mediaUrl) throw new Error("Could not process uploaded media file");
    uploaded.push({ type: isVideo ? "video" : "image", url: mediaUrl });
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
document.querySelector("#inbox-tab-chats")?.addEventListener("click", () => switchInboxTab("chats"));
document.querySelector("#inbox-tab-people")?.addEventListener("click", () => switchInboxTab("people"));
document.querySelector("#inbox-back-btn")?.addEventListener("click", () => {
  document.querySelector("#inbox-container")?.classList.remove("chat-open");
});
document.querySelector("#inbox-search")?.addEventListener("input", (event) => {
  const query = event.target.value.toLowerCase().trim();
  if (activeInboxTab === "chats") {
    const items = document.querySelectorAll("#conversation-threads-list .conversation-item");
    items.forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.hidden = Boolean(query && !text.includes(query));
    });
  } else {
    const items = document.querySelectorAll("#user-list .conversation-item");
    items.forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.hidden = Boolean(query && !text.includes(query));
    });
  }
});
document.querySelector("#inbox-composer")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#inbox-input");
  if (input) {
    const text = input.value;
    input.value = "";
    await sendMessage(text);
  }
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
  if (!file) return "";
  if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) throw new Error("Use JPG, PNG, GIF, or WEBP");
  if (file.size > 5 * 1024 * 1024) throw new Error("Avatar must be 5 MB or smaller");

  let avatarUrl = "";

  // 1. Try Supabase storage bucket 'avatars' if user and client exist
  if (currentUser && supabaseClient) {
    try {
      const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "jpg";
      const path = `${currentUser.id}/avatar.${extension}`;
      const { data: uploadData, error } = await supabaseClient.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: true });
      if (!error && uploadData) {
        const { data } = supabaseClient.storage.from("avatars").getPublicUrl(path);
        if (data?.publicUrl) avatarUrl = data.publicUrl;
      }
    } catch (storageErr) {
      console.warn("Supabase avatars storage unavailable, falling back:", storageErr);
    }
  }

  // 2. Fallback to server local upload
  if (!avatarUrl) {
    try {
      avatarUrl = await uploadToServer(file);
    } catch (serverErr) {
      console.warn("Server upload fallback failed, using optimized data URL:", serverErr);
    }
  }

  // 3. Fallback to optimized client-side Data URL
  if (!avatarUrl) {
    avatarUrl = await fileToOptimizedDataUrl(file, 256, 256, 0.85);
  }

  if (!avatarUrl) throw new Error("Could not process avatar image");

  // Save to profile in Supabase if logged in
  if (currentUser && supabaseClient) {
    try {
      const { error: updateError } = await supabaseClient.from("profiles").update({ avatar_url: avatarUrl }).eq("id", currentUser.id);
      if (updateError) console.warn("Supabase profile avatar update warning:", updateError);
    } catch (err) {
      console.warn("Profile update error:", err);
    }
    const existing = state.profiles.get(currentUser.id) || {};
    state.profiles.set(currentUser.id, { ...existing, avatar_url: avatarUrl });
  }

  // Persist locally for instant rendering
  state.settings.avatarUrl = avatarUrl;
  localStorage.setItem("dairy-settings", JSON.stringify(state.settings));

  // Update preview in UI
  const previewEl = document.querySelector("#setting-avatar-preview");
  if (previewEl) {
    previewEl.innerHTML = `<img src="${escapeAttr(avatarUrl)}" alt="">`;
    previewEl.classList.add("has-image");
  }
  updateAuthUi();
  renderProfile();

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

  const currentAvatarUrl = (currentUser ? state.profiles.get(currentUser.id)?.avatar_url : null) || state.settings?.avatarUrl || "";
  const previewEl = document.querySelector("#setting-avatar-preview");
  if (previewEl) {
    if (currentAvatarUrl) {
      previewEl.innerHTML = `<img src="${escapeAttr(currentAvatarUrl)}" alt="">`;
      previewEl.classList.add("has-image");
    } else {
      const initials = (s.name || "AM").slice(0, 2).toUpperCase();
      previewEl.textContent = initials;
      previewEl.classList.remove("has-image");
    }
  }

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

// Live preview when selecting an avatar file
document.querySelector("#setting-avatar")?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) {
    const previewEl = document.querySelector("#setting-avatar-preview");
    if (previewEl) {
      const objUrl = URL.createObjectURL(file);
      previewEl.innerHTML = `<img src="${objUrl}" alt="">`;
      previewEl.classList.add("has-image");
    }
  }
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
      try {
        await uploadAvatar(fileInput.files[0]);
        fileInput.value = "";
        showToast("Profile picture updated");
      } catch (avatarErr) {
        console.warn("Avatar processing notice:", avatarErr);
        showToast(avatarErr.message || "Could not update profile picture");
      }
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
  loadConversations();
  loadUsers();
  loadStoriesRow();
  supabaseClient.channel("inbox").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
    handleIncomingMessage(payload.new);
  }).subscribe();
});
supabaseClient?.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  updateAuthUi();
  loadStories().catch(() => {});
  loadSuggestions();
  loadConversations();
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
