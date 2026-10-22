// ---- 1. Paste your Supabase keys (Project Settings > API) ----
// The anon key is safe to expose because the database rules in schema.sql protect your data.
// NEVER paste the service_role key here.
const SUPABASE_URL = "https://fmsklxzisejfwcybpsss.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtc2tseHppc2VqZndjeWJwc3NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDQ2OTgsImV4cCI6MjEwODA4MDY5OH0.cVQjwcShCugWkHBRLwJW_FQTQRd1g5k8kwSfJDlueXI";

// ---- 1b. Spotify (full songs). Client ID from developer.spotify.com/dashboard ----
// The Client ID is public and safe here. NEVER paste the Client Secret anywhere in this site.
const SPOTIFY_CLIENT_ID = "9fd52c0851e6429cabe538fc6d4682d2";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const palette = ["#8a9a5b", "#e9dcc0", "#b89468", "#a9b87a", "#d8b98a"];
const colorFor = name => palette[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];
const fmtDate = d => new Date(d).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const configured = !SUPABASE_URL.includes("YOUR-PROJECT");
let sb = null;
let setupError = "";
if (configured) {
  try {
    // Keep only https://xxxx.supabase.co, even if extra path bits were pasted
    const origin = new URL(SUPABASE_URL.trim()).origin;
    if (/supabase\.com$/i.test(new URL(origin).hostname)) throw new Error("that's the dashboard link, not the Project URL");
    sb = supabase.createClient(origin, SUPABASE_ANON_KEY.trim());
  }
  catch (e) { setupError = "Supabase couldn't start: " + e.message + ". Check the URL and anon key at the top of script.js, and that you're online."; }
}

let user = null;
let editingBio = false, bioDraft = null;
let data = { events: [], rsvps: [], notes: [], profiles: [] };
const usernameOf = u => u?.user_metadata?.username || "friend";

// ---- Data ----
async function loadData() {
  if (!sb) return;
  const [ev, rs, nt, pr] = await Promise.all([
    sb.from("events").select("*").order("starts_at"),
    sb.from("rsvps").select("event_id, user_id, profiles(username)"),
    sb.from("notes").select("id, body, created_at, user_id, media_url, media_type, media_path, profiles(username)").order("created_at", { ascending: false }).limit(12),
    sb.from("profiles").select("id, username, bio").order("created_at"),
  ]);
  const failed = [ev, rs, nt, pr].find(r => r.error);
  if (failed && /jwt expired|invalid jwt/i.test(failed.error.message) && !loadData.retried) {
    // Stale saved login: drop it locally and reload as a logged-out visitor
    loadData.retried = true;
    await sb.auth.signOut({ scope: "local" });
    user = null;
    await loadData();
    loadData.retried = false;
    return;
  }
  if (failed) { $("events").innerHTML = `<p class="setup-msg">Couldn't load data: ${esc(failed.error.message)}. Did you run schema.sql?</p>`; return; }
  data = { events: ev.data, rsvps: rs.data, notes: nt.data, profiles: pr.data };
  render();
}

function render() {
  // Gatherings
  $("events").innerHTML = "";
  if (!data.events.length) $("events").innerHTML = `<p class="setup-msg">No gatherings yet. Add one in Supabase: Table Editor > events.</p>`;
  data.events.forEach(ev => {
    const going = data.rsvps.filter(r => r.event_id === ev.id);
    const isIn = user && going.some(r => r.user_id === user.id);
    const card = document.createElement("article");
    card.className = "event";
    card.innerHTML = `
      <h3>${esc(ev.title)}</h3>
      <p class="meta">${esc(fmtDate(ev.starts_at))}<br>${esc(ev.place)}</p>
      <p class="host">Hosted by ${esc(ev.host || "someone mysterious")}</p>
      <p class="count">${going.length} going${going.length ? ": " + going.map(r => esc(r.profiles?.username)).join(", ") : ""}</p>
      <div class="actions">
        <button class="btn rsvp ${isIn ? "in" : ""}" aria-pressed="${!!isIn}">${isIn ? "You're in" : user ? "I'm in" : "Log in to join"}</button>
        ${user && ev.created_by === user.id ? `<button class="link-btn del" type="button">Delete</button>` : ""}
      </div>`;
    const del = card.querySelector(".del");
    if (del) del.addEventListener("click", async () => {
      if (!confirm(`Delete "${ev.title}"?`)) return;
      const { error } = await sb.from("events").delete().eq("id", ev.id);
      if (error) alert("Couldn't delete: " + error.message);
      loadData();
    });
    card.querySelector(".rsvp").addEventListener("click", async e => {
      if (!user) return openAuth();
      e.target.disabled = true;
      const q = isIn
        ? sb.from("rsvps").delete().match({ event_id: ev.id, user_id: user.id })
        : sb.from("rsvps").insert({ event_id: ev.id, user_id: user.id });
      await q;
      loadData();
    });
    $("events").appendChild(card);
  });

  // Crew
  $("crewList").innerHTML = data.profiles.map(p => {
    const mine = user && p.id === user.id;
    let body;
    if (mine && editingBio) {
      body = `<textarea id="bioInput" rows="3" maxlength="140" placeholder="Tell the table about yourself">${esc(bioDraft ?? p.bio ?? "")}</textarea>
        <div class="bio-actions">
          <button class="btn tiny" id="bioSave" type="button">Save</button>
          <button class="link-btn" id="bioCancel" type="button">Cancel</button>
        </div>`;
    } else {
      body = `<p class="bio ${p.bio ? "" : "empty"}">${esc(p.bio || (mine ? "No description yet." : "Mysterious."))}</p>
        ${mine ? `<button class="link-btn" id="bioEdit" type="button">Edit description</button>` : ""}`;
    }
    return `
    <div class="member">
      <div class="avatar" style="background:${colorFor(p.username)}">${esc(p.username[0].toUpperCase())}</div>
      ${esc(p.username)}
      ${body}
    </div>`;
  }).join("");
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
  on("bioEdit", () => { editingBio = true; bioDraft = null; render(); $("bioInput")?.focus(); });
  on("bioCancel", () => { editingBio = false; bioDraft = null; render(); });
  on("bioSave", async e => {
    e.target.disabled = true;
    const bio = $("bioInput").value.trim();
    const { error } = await sb.from("profiles").update({ bio }).eq("id", user.id);
    if (error) { alert("Couldn't save: " + error.message); e.target.disabled = false; return; }
    editingBio = false; bioDraft = null;
    loadData();
  });
  const bi = $("bioInput");
  if (bi) bi.addEventListener("input", () => { bioDraft = bi.value; });

  // Wall
  $("notes").innerHTML = data.notes.map(n => {
    const mine = user && n.user_id === user.id;
    const delBtn = mine ? `<button class="note-del" type="button" data-id="${esc(n.id)}">Delete</button>` : "";
    if (n.media_url) {
      const media = n.media_type === "video"
        ? `<video src="${esc(n.media_url)}" controls muted playsinline preload="metadata"></video>`
        : `<img src="${esc(n.media_url)}" alt="${esc(n.body || "Photo on the wall")}" loading="lazy">`;
      return `<div class="note polaroid">
        <div class="frame">${media}</div>
        <div class="caption">${esc(n.body)}<b class="who">${esc(n.profiles?.username)}</b></div>
        ${delBtn}
      </div>`;
    }
    return `<div class="note">${delBtn}${esc(n.body)}<b>${esc(n.profiles?.username)}</b></div>`;
  }).join("");
  document.querySelectorAll(".note-del").forEach(b => b.addEventListener("click", async () => {
    const n = data.notes.find(x => String(x.id) === b.dataset.id);
    if (!n || !confirm("Delete this from the wall?")) return;
    b.disabled = true;
    const { error } = await sb.from("notes").delete().eq("id", n.id);
    if (error) { alert("Couldn't delete: " + error.message); b.disabled = false; return; }
    if (n.media_path) await sb.storage.from("wall").remove([n.media_path]);
    loadData();
  }));

  // Header
  $("authBtn").textContent = user ? "Log out" : "Log in";
  $("hello").hidden = !user;
  $("hello").textContent = user ? `Hi, ${usernameOf(user)}` : "";
  $("noteForm").hidden = !user;
  $("wallGate").hidden = !!user;
  $("eventForm").hidden = !user;
  $("eventGate").hidden = !!user;
  if (user && !$("evHost").value) $("evHost").value = usernameOf(user);
}

// ---- Auth popup ----
const dialog = $("authDialog");
let mode = "login";

function setMode(m) {
  mode = m;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.mode === m));
  $("authSubmit").textContent = m === "login" ? "Log in" : "Create account";
  $("userLabel").hidden = m === "login";
  $("authUser").required = m === "signup";
  $("authPass").autocomplete = m === "login" ? "current-password" : "new-password";
  $("authError").textContent = "";
}
function openAuth(m = "login") {
  if (dialog.open) return;
  setMode(m); $("authForm").reset(); dialog.showModal(); $("authEmail").focus();
}

document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setMode(t.dataset.mode)));
$("authCancel").addEventListener("click", () => dialog.close());
$("authBtn").addEventListener("click", async () => {
  if (user) await sb.auth.signOut(); else openAuth();
});

$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("authError");
  if (!sb) { err.textContent = setupError || "Add your Supabase keys in script.js first."; return; }
  const email = $("authEmail").value.trim();
  const password = $("authPass").value;
  $("authSubmit").disabled = true;
  err.textContent = "";

  if (mode === "signup") {
    const username = $("authUser").value.trim();
    const { data: res, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
    if (error) {
      err.textContent = /database error/i.test(error.message)
        ? "That username is taken or invalid (2 to 16 characters)." : error.message;
    } else if (!res.session) {
      err.textContent = "Almost there. Check your email to confirm, then log in.";
    } else dialog.close();
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) err.textContent = error.message; else dialog.close();
  }
  $("authSubmit").disabled = false;
});

// ---- New gathering ----
$("eventForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("evError");
  if (!user) return openAuth();
  const starts = new Date($("evDate").value);
  if (isNaN(starts)) { err.textContent = "Pick a valid date and time."; return; }
  err.textContent = "";
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  const { error } = await sb.from("events").insert({
    title: $("evTitle").value.trim(),
    starts_at: starts.toISOString(),
    place: $("evPlace").value.trim(),
    host: $("evHost").value.trim(),
    created_by: user.id,
  });
  btn.disabled = false;
  if (error) { err.textContent = "Couldn't add it: " + error.message; return; }
  e.target.reset();
  $("evHost").value = usernameOf(user);
  loadData();
});

// ---- Notes ----
const MAX_MEDIA_MB = 25;
$("noteFile").addEventListener("change", () => {
  $("noteFileName").textContent = $("noteFile").files[0]?.name || "+ Photo or video";
});
$("noteForm").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("noteError");
  const body = $("noteText").value.trim();
  const file = $("noteFile").files[0];
  if (!user) return;
  if (!body && !file) { err.textContent = "Write something or add a photo or video."; return; }
  let media = {};
  if (file) {
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && !file.type.startsWith("image/")) { err.textContent = "Only photos and videos, please."; return; }
    if (file.size > MAX_MEDIA_MB * 1024 * 1024) { err.textContent = `That file is over ${MAX_MEDIA_MB} MB.`; return; }
  }
  err.textContent = "";
  $("noteSubmit").disabled = true;
  if (file) {
    const isVideo = file.type.startsWith("video/");
    const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    $("noteSubmit").textContent = "Uploading...";
    const up = await sb.storage.from("wall").upload(path, file, { contentType: file.type });
    if (up.error) {
      err.textContent = "Upload failed: " + up.error.message;
      $("noteSubmit").disabled = false; $("noteSubmit").textContent = "Pin it";
      return;
    }
    media = {
      media_url: sb.storage.from("wall").getPublicUrl(path).data.publicUrl,
      media_type: isVideo ? "video" : "image",
      media_path: path,
    };
  }
  const { error } = await sb.from("notes").insert({ body, ...media });
  $("noteSubmit").disabled = false; $("noteSubmit").textContent = "Pin it";
  if (error) {
    if (media.media_path) await sb.storage.from("wall").remove([media.media_path]);
    err.textContent = "Couldn't pin it: " + error.message;
    return;
  }
  e.target.reset();
  $("noteFileName").textContent = "+ Photo or video";
  loadData();
});

// ---- Record player: interactive vinyl + Spotify ----
const vinyl = $("vinyl"), disc = $("disc"), arm = $("arm"), toggle = $("spinToggle");
const labelEl = $("label"), hero = $("home"), statusEl = $("songStatus");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEFAULT_TINT = "#8a9a5b";

let controller = null, apiReady = null, playing = false, hasRecord = false, pendingPlay = false;
let angle = 0, speed = 0;            // degrees, degrees per second
let dragging = false, moved = 0, lastPointerAngle = 0, lastT = 0, flick = 0;

const say = msg => { statusEl.textContent = msg; };

function setPlaying(p) {
  playing = p;
  arm.classList.toggle("up", !p);
  vinyl.setAttribute("aria-pressed", String(p));
  toggle.setAttribute("aria-pressed", String(p));
  toggle.textContent = !hasRecord ? "Pick a record" : p ? "Pause the record" : "Play the record";
}

// Spin loop: 33 rpm while playing, coasts to a stop when paused, follows your hand while dragging
const RPM33 = 200;
(function tick(t) {
  const dt = Math.min((t - (tick.last || t)) / 1000, .05);
  tick.last = t;
  if (!dragging) {
    const target = playing && !reduceMotion ? RPM33 : 0;
    speed += (target - speed) * Math.min(1, dt * (target ? 2.2 : 1.6));
    if (Math.abs(speed) < .5 && !target) speed = 0;
    angle = (angle + speed * dt) % 360;
  }
  disc.style.transform = `rotate(${angle}deg)`;
  requestAnimationFrame(tick);
})(performance.now());

// Drag to scratch, click to play/pause
const pointerAngle = e => {
  const r = vinyl.getBoundingClientRect();
  return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
};
vinyl.addEventListener("pointerdown", e => {
  dragging = true; moved = 0; flick = 0;
  lastPointerAngle = pointerAngle(e); lastT = performance.now();
  vinyl.setPointerCapture(e.pointerId);
  vinyl.classList.add("grabbing");
});
vinyl.addEventListener("pointermove", e => {
  if (!dragging) return;
  const a = pointerAngle(e), now = performance.now();
  let d = a - lastPointerAngle;
  if (d > 180) d -= 360; else if (d < -180) d += 360;
  angle = (angle + d) % 360;
  moved += Math.abs(d);
  const dt = Math.max((now - lastT) / 1000, .001);
  flick = flick * .6 + (d / dt) * .4;      // smoothed angular velocity for the throw
  lastPointerAngle = a; lastT = now;
});
const release = e => {
  if (!dragging) return;
  dragging = false;
  vinyl.classList.remove("grabbing");
  if (moved < 6) { togglePlayback(); speed = playing ? speed : 0; }
  else speed = Math.max(-900, Math.min(900, flick));   // let go and it keeps spinning, then settles
};
vinyl.addEventListener("pointerup", release);
vinyl.addEventListener("pointercancel", release);
vinyl.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePlayback(); }
});

function togglePlayback() {
  if (!hasRecord) { say("Paste a Spotify link first."); $("songUrl").focus(); return; }
  if (sdk.active && sdk.ready) {
    sdk.player.activateElement();                 // lets mobile browsers allow audio
    if (sdk.started) sdk.player.togglePlay(); else sdkPlay(sdk.current);
    return;
  }
  if (sdk.active) { say("Warming up the player..."); return; }
  if (!controller) { pendingPlay = true; say("Warming up the player..."); return; }
  controller.togglePlay();
}
toggle.addEventListener("click", togglePlayback);

// ---- Spotify full-song playback: Web Playback SDK (listener needs Premium) ----
const connectBtn = $("spotifyConnect");
const spotifyConfigured = () => !SPOTIFY_CLIENT_ID.startsWith("PASTE");
const SPOTIFY_REDIRECT = location.origin + location.pathname;   // must match a Redirect URI in your Spotify app exactly
const SPOTIFY_SCOPES = "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state";
const TOK_KEY = "fb-spotify-tok";
const tok = {
  get() { try { return JSON.parse(localStorage.getItem(TOK_KEY)); } catch { return null; } },
  set(v) { try { localStorage.setItem(TOK_KEY, JSON.stringify(v)); } catch {} },
  clear() { try { localStorage.removeItem(TOK_KEY); } catch {} },
};
const spotifyConnected = () => spotifyConfigured() && !!tok.get()?.refresh;
const sdk = { player: null, device: null, ready: false, active: false, started: false, current: null, loading: null, art: "" };
let sdkNote = "";

function paintConnect() {
  connectBtn.textContent = spotifyConnected() ? "Spotify connected. Disconnect" : "Connect Spotify for full songs";
}
const randomString = n => {
  const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map(x => abc[x % abc.length]).join("");
};
async function pkceChallenge(verifier) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function spotifyLogin() {
  if (!spotifyConfigured()) {
    console.log("Spotify Redirect URI to register:", SPOTIFY_REDIRECT);
    say("Paste your Spotify Client ID at the top of script.js first. Redirect URI to register: " + SPOTIFY_REDIRECT);
    return;
  }
  const verifier = randomString(64), state = randomString(16);
  try { localStorage.setItem("fb-pkce", JSON.stringify({ verifier, state })); } catch {}
  const q = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: SPOTIFY_REDIRECT,
    scope: SPOTIFY_SCOPES, code_challenge_method: "S256", code_challenge: await pkceChallenge(verifier), state,
  });
  location.href = "https://accounts.spotify.com/authorize?" + q;
}
async function tokenRequest(params) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || "token request failed");
  tok.set({ access: j.access_token, refresh: j.refresh_token || tok.get()?.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 });
}
async function spotifyToken() {
  let t = tok.get();
  if (!t) return null;
  if (Date.now() >= t.exp) {
    try { await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh }); }
    catch { tok.clear(); paintConnect(); return null; }
    t = tok.get();
  }
  return t.access;
}
// Spotify sends the person back here with ?code=...&state=...
const spotifyCallback = (async () => {
  const q = new URLSearchParams(location.search);
  if (!q.has("state") || !(q.has("code") || q.has("error"))) return;
  history.replaceState({}, "", location.pathname + location.hash);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("fb-pkce")); localStorage.removeItem("fb-pkce"); } catch {}
  if (!saved || saved.state !== q.get("state")) return;
  if (q.has("error")) { say("Spotify connection was cancelled."); return; }
  try {
    await tokenRequest({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: SPOTIFY_REDIRECT, code_verifier: saved.verifier });
    say("Spotify connected. Full songs unlocked. Paste a link and spin it.");
  } catch (e) { say("Couldn't connect Spotify: " + e.message); }
})();
connectBtn.addEventListener("click", () => {
  if (!spotifyConnected()) return spotifyLogin();
  tok.clear(); try { sdk.player?.disconnect(); } catch {}
  location.reload();
});

function startSdk() {
  if (sdk.loading) return sdk.loading;
  sdk.loading = new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new Spotify.Player({ name: "Fuck Buddies", getOAuthToken: async cb => cb(await spotifyToken()), volume: .8 });
      player.addListener("ready", ({ device_id }) => { sdk.player = player; sdk.device = device_id; sdk.ready = true; resolve(); });
      player.addListener("not_ready", () => { sdk.ready = false; });
      player.addListener("initialization_error", () => reject(new Error("This browser can't play Spotify in the page.")));
      player.addListener("authentication_error", () => reject(new Error("Spotify login expired. Reconnect.")));
      player.addListener("account_error", () => reject(new Error("Full songs need Spotify Premium.")));
      player.addListener("playback_error", e => say("Playback error: " + e.message));
      player.addListener("autoplay_failed", () => say("Your browser blocked autoplay. Click the record."));
      player.addListener("player_state_changed", st => {
        if (!st) return;
        const p = !st.paused, t = st.track_window.current_track;
        if (t) {
          currentTitle = `${t.name} by ${t.artists.map(a => a.name).join(", ")}`;
          const art = t.album?.images?.[0]?.url || "";
          if (art && art !== sdk.art) {
            sdk.art = art;
            labelEl.style.backgroundImage = `url("${art}")`; labelEl.classList.add("has-art");
            artColor(art).then(c => c && hero.style.setProperty("--tint", c));
          }
        }
        if (p !== playing) setPlaying(p);
        say(p ? `Now spinning: ${currentTitle}` : "Paused. Click the record to play, drag it to scratch.");
      });
      player.connect().then(ok => { if (!ok) reject(new Error("Couldn't reach Spotify.")); });
    };
    const el = document.createElement("script");
    el.src = "https://sdk.scdn.co/spotify-player.js";
    el.onerror = () => reject(new Error("Couldn't load the Spotify player."));
    document.head.appendChild(el);
  });
  sdk.loading.catch(() => {});
  return sdk.loading;
}
async function sdkPlay(spot) {
  const token = await spotifyToken();
  if (!token) { say("Spotify login expired. Reconnect."); paintConnect(); return; }
  const body = spot.type === "track" || spot.type === "episode" ? { uris: [spot.uri] } : { context_uri: spot.uri };
  const r = await fetch("https://api.spotify.com/v1/me/player/play?device_id=" + sdk.device, {
    method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (r.ok || r.status === 204) { sdk.started = true; return; }
  const j = await r.json().catch(() => ({}));
  say(r.status === 403 ? "Spotify says no: full songs need Premium, and your account must be added in the app's User Management."
    : "Couldn't start the record: " + (j.error?.message || r.status));
}

// Spotify link -> URI
function parseSpotify(input) {
  const s = input.trim();
  let m = s.match(/^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]+)$/);
  if (!m) m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
  return m ? { type: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}`, url: `https://open.spotify.com/${m[1]}/${m[2]}` } : null;
}

// Pull a colour out of the cover art; falls back to a colour picked from the title
function titleColor(str) {
  let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 38% 46%)`;
}
function artColor(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 24;
        const x = c.getContext("2d"); x.drawImage(img, 0, 0, 24, 24);
        const px = x.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < px.length; i += 4) {
          const mx = Math.max(px[i], px[i + 1], px[i + 2]), mn = Math.min(px[i], px[i + 1], px[i + 2]);
          const wt = (mx - mn) / 255 + .05;                 // favour vivid pixels over greys
          if (mx < 25 || mn > 235) continue;                // skip near black / white
          r += px[i] * wt; g += px[i + 1] * wt; b += px[i + 2] * wt; w += wt;
        }
        resolve(w ? `rgb(${Math.round(r / w)} ${Math.round(g / w)} ${Math.round(b / w)})` : null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
async function dressRecord(spot) {
  let title = "", thumb = "";
  try {
    const res = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(spot.url));
    if (res.ok) { const j = await res.json(); title = j.title || ""; thumb = j.thumbnail_url || ""; }
  } catch {}
  if (thumb) {
    labelEl.style.backgroundImage = `url("${thumb}")`;
    labelEl.classList.add("has-art");
  } else {
    labelEl.style.backgroundImage = "";
    labelEl.classList.remove("has-art");
  }
  const tint = (thumb && await artColor(thumb)) || (title ? titleColor(title) : DEFAULT_TINT);
  hero.style.setProperty("--tint", tint);
  return title;
}

// Spotify iFrame API (loaded async at the bottom of the page)
apiReady = new Promise(resolve => { window.onSpotifyIframeApiReady = resolve; });
let loadToken = 0;
async function loadRecord(input, { autoplay = true } = {}) {
  const spot = parseSpotify(input);
  if (!spot) { say("That doesn't look like a Spotify song, album or playlist link."); return false; }
  const token = ++loadToken;
  hasRecord = true;
  setPlaying(false);
  say("Dropping the needle...");

  // Full songs through the Web Playback SDK when Spotify is connected
  let useSdk = spotifyConnected();
  if (useSdk) {
    try { await startSdk(); sdkNote = ""; }
    catch (e) { useSdk = false; sdkNote = " (" + e.message + " Using the 30-second preview player.)"; }
  }
  if (token !== loadToken) return true;
  if (useSdk) {
    sdk.active = true;
    $("embedWrap").hidden = true;
    const title = await dressRecord(spot);
    if (token !== loadToken) return true;
    currentTitle = title; sdk.current = spot; sdk.started = false; sdk.art = "";
    try { localStorage.setItem("fb-record", spot.url); } catch {}
    if (autoplay) { say(title ? `Loaded: ${title}` : "Loaded."); await sdkPlay(spot); }
    else say(title ? `Loaded: ${title}. Click the record to play.` : "Loaded. Click the record to play.");
    return true;
  }

  sdk.active = false;
  $("embedWrap").hidden = false;
  const [IFrameAPI, title] = await Promise.all([apiReady, dressRecord(spot)]);
  if (token !== loadToken) return true;
  if (!controller) {
    IFrameAPI.createController($("spotifyEmbed"), { uri: spot.uri, width: "100%", height: spot.type === "track" ? 152 : 232 }, c => {
      controller = c;
      c.addListener("playback_update", e => {
        const p = !e.data.isPaused;
        if (p !== playing) {
          setPlaying(p);
          if (p) say(`Now spinning${currentTitle ? ": " + currentTitle : ""}`);
          else say("Paused. Click the record to play, drag it to scratch.");
        }
      });
      c.addListener("ready", () => { if (autoplay || pendingPlay) { pendingPlay = false; c.play(); } });
    });
  } else {
    controller.loadUri(spot.uri);
    if (autoplay) controller.play();
  }
  currentTitle = title;
  say((title ? `Loaded: ${title}. Press play on the player if it doesn't start.` : "Loaded. Press play on the player if it doesn't start.") + sdkNote);
  try { localStorage.setItem("fb-record", spot.url); } catch {}
  return true;
}
let currentTitle = "";

$("songForm").addEventListener("submit", async e => {
  e.preventDefault();
  try { sdk.player?.activateElement(); } catch {}
  const ok = await loadRecord($("songUrl").value);
  if (ok) $("songUrl").blur();
});

setPlaying(false);
// Bring back the last record (loaded but not auto-played)
spotifyCallback.then(() => {
  paintConnect();
  try {
    const saved = localStorage.getItem("fb-record");
    if (saved) { $("songUrl").value = saved; loadRecord(saved, { autoplay: false }); }
  } catch {}
});

// ---- Start ----
async function init() {
  render();
  if (!sb) {
    $("events").innerHTML = `<p class="setup-msg">${esc(setupError || "Almost ready. Paste your Supabase URL and anon key at the top of script.js, then run schema.sql.")}</p>`;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user ?? null;
  await loadData();

  sb.auth.onAuthStateChange((_evt, s) => { user = s?.user ?? null; render(); loadData(); });
  ["events", "rsvps", "notes", "profiles"].forEach(t =>
    sb.channel("fb-" + t).on("postgres_changes", { event: "*", schema: "public", table: t }, loadData).subscribe());

  // Welcome popup once per visit for logged-out people
  let seen = false;
  try { seen = sessionStorage.getItem("fb-welcomed"); sessionStorage.setItem("fb-welcomed", "1"); } catch {}
  if (!user && !seen) setTimeout(() => openAuth(), 900);
}
init();