/* =====================================================================
 *  LOVE MY FAMILY - Frontend Logic (app.js)
 *  Backend: Google Apps Script Web App (Code.gs)
 *  ===================================================================== */

const API_URL = 'https://script.google.com/macros/s/AKfycbxVGz059cuL-l7CEHABQ57UT46BMZz1CEy6tl27cCpXIMgwJlmmKVpWCj1124kQn9f15A/exec'; // <-- TAMPAL URL Web App Apps Script di sini

const POLL_INTERVAL = 2500;
const ADMIN_PASSWORD_HINT = '101010';
const STORAGE_KEY = 'lmf_session_v1';
const COOKIE_KEY  = 'lmf_session_v1';
const COOKIE_DAYS = 365;

// ---- Session persistence ----
function saveSession(obj) {
  const json = JSON.stringify(obj);
  try { localStorage.setItem(STORAGE_KEY, json); } catch(_){}
  try { sessionStorage.setItem(STORAGE_KEY, json); } catch(_){}
  try {
    const d = new Date(); d.setTime(d.getTime() + COOKIE_DAYS*864e5);
    document.cookie = COOKIE_KEY + '=' + encodeURIComponent(json)
      + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  } catch(_){}
}
function loadSession() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch(_){}
  if (!raw) { try { raw = sessionStorage.getItem(STORAGE_KEY); } catch(_){} }
  if (!raw) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_KEY + '=([^;]*)'));
    if (m) { try { raw = decodeURIComponent(m[1]); } catch(_){} }
  }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(_) { return null; }
}
function clearSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch(_){}
  try { sessionStorage.removeItem(STORAGE_KEY); } catch(_){}
  try { document.cookie = COOKIE_KEY + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; } catch(_){}
}

// ===================== STATE =====================
let session = null;
let lastTs = 0;
let pollTimer = null;
let seenIds = new Set();

// ===================== AVATAR & EMOJI =====================
const AVATARS = [
  "👦","👧","👱","👨‍🦱","👩‍🦰","🧔","🧕","👲","👮","🕵️","👷","🦸","🦹","🧙","🧚",
  "🧛","🧜","🧝","🧞","🧟","👽","🤖","🦁","🐯","🐻","🐨","🐼","🐸","🐙","🦄",
  "🐶","🐱","🐵","🐧","🦆","🦉","🐝","🦋","🐢","🐍","🦖","🐙","😀","😎","🥳",
  "😍","🤩","🤓","🧐","🥰","😇","🤠","🦊","🐢","🌸","🌻","🍔","🍕","🍣","🎮","⚽"
];
const EMOJIS = [
  "😀","😁","😂","🤣","😊","😍","🥰","😘","😎","🤩","😇","🙂","🙃","😉","😌","🤔",
  "🤨","😴","🥱","🤤","😋","🤤","🤗","🤫","🤭","🫢","🫡","🤝","👍","👎","👏","🙌",
  "🙏","💪","✌️","🤞","🤟","🤘","👌","👋","❤️","🧡","💛","💚","💙","💜","🖤","🤍",
  "💔","❣️","💕","💖","💘","🔥","✨","🌟","💫","⭐","🌈","☀️","🌙","⚡","🎉","🎊"
];

const BANNED = ["babi","bodoh","sial","anjir","fuck","shit","pukimak","lancau","kimak","butoh","pantat","asshole","bitch","gila","bongok","bahlul"];

const $ = (id) => document.getElementById(id);

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded', init);

function init() {
  if (!API_URL) showToast('⚠️ API_URL belum di-set dalam app.js', 5000);

  buildAvatarPicker();
  buildEmojiPicker();
  bindUI();
  bindPasteAndDrop();

  const saved = loadSession();
  if (saved && saved.userId && saved.name) {
    session = saved;
    saveSession(session);
    enterChat(true);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ===================== UI BUILDERS =====================
function buildAvatarPicker() {
  const wrap = $('avatarGrid'); wrap.innerHTML = '';
  AVATARS.forEach((em, i) => {
    const d = document.createElement('div');
    d.className = 'avatar-pick' + (i === 0 ? ' selected' : '');
    d.textContent = em; d.dataset.emoji = em;
    d.onclick = () => {
      wrap.querySelectorAll('.avatar-pick').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
    };
    wrap.appendChild(d);
  });
}
function buildEmojiPicker() {
  const wrap = $('emojiPicker'); wrap.innerHTML = '';
  EMOJIS.forEach((em) => {
    const s = document.createElement('span');
    s.className = 'emoji-item'; s.textContent = em;
    s.onclick = () => { const inp = $('inputMsg'); inp.value += em; inp.focus(); };
    wrap.appendChild(s);
  });
}

function bindUI() {
  $('btnEnter').onclick = doLogin;
  $('inputName').addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });
  $('btnSend').onclick = sendText;
  $('inputMsg').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendText(); });
  $('btnEmoji').onclick = () => {
    const p = $('emojiPicker');
    p.style.display = (p.style.display === 'grid') ? 'none' : 'grid';
  };
  $('btnAttach').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f && f.type && f.type.startsWith('image/')) openImageEditor(f);
    else handleFile(f);
    e.target.value = '';
  };
  $('btnLogout').onclick = doLogout;
  $('btnClear').onclick = doClearAll;

  // Call buttons — buka tab baru (lebih reliable berbanding iframe)
  $('btnAudioCall').onclick = () => startCall(false);
  $('btnVideoCall').onclick = () => startCall(true);

  // Image editor controls
  bindEditorUI();
}

// ===================== PASTE / DRAG-DROP SCREENSHOT =====================
function bindPasteAndDrop() {
  // Paste image from clipboard (Ctrl/Cmd+V atau Print Screen → paste)
  document.addEventListener('paste', (e) => {
    if (!session) return;
    const items = (e.clipboardData || window.clipboardData)?.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); openImageEditor(f); return; }
      }
    }
  });

  // Drag & drop image ke chat
  const drop = $('chatScreen');
  if (!drop) return;
  ['dragenter','dragover'].forEach(ev =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag-over'); })
  );
  ['dragleave','drop'].forEach(ev =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag-over'); })
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.type.startsWith('image/')) openImageEditor(f);
    else handleFile(f);
  });
}

// ===================== IMAGE EDITOR =====================
let edState = {
  img: null, canvas: null, ctx: null,
  tool: 'pen',          // 'pen' | 'text' | 'arrow' | 'rect' | 'erase'
  color: '#ff3b30',
  size: 6,
  font: 'Inter',
  fontSize: 28,
  drawing: false,
  startX: 0, startY: 0,
  snapshot: null,       // before-shape snapshot for rect/arrow
  history: []           // for undo
};

function openImageEditor(fileOrBlob) {
  const url = URL.createObjectURL(fileOrBlob);
  const img = new Image();
  img.onload = () => {
    const modal = $('editorModal');
    modal.classList.remove('hidden');
    const cnv = $('editCanvas');
    // Skala supaya muat skrin tapi kekal kualiti
    const maxW = Math.min(1280, window.innerWidth - 40);
    const maxH = Math.min(800, window.innerHeight - 200);
    let w = img.width, h = img.height;
    const scale = Math.min(1, maxW / w, maxH / h);
    w = Math.round(w * scale); h = Math.round(h * scale);
    cnv.width = w; cnv.height = h;
    const ctx = cnv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    edState.img = img; edState.canvas = cnv; edState.ctx = ctx;
    edState.history = [ctx.getImageData(0,0,w,h)];
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function bindEditorUI() {
  // Tools
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.tool-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      edState.tool = b.dataset.tool;
      $('textOptions').style.display = (edState.tool === 'text') ? 'flex' : 'none';
    };
  });
  // Color
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.onclick = () => {
      document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      edState.color = s.dataset.color;
    };
  });
  $('customColor').oninput = (e) => { edState.color = e.target.value; };
  // Size
  $('brushSize').oninput = (e) => {
    edState.size = parseInt(e.target.value, 10);
    $('brushSizeLabel').textContent = edState.size + 'px';
  };
  // Font
  $('fontFamily').onchange = (e) => { edState.font = e.target.value; };
  $('fontSize').oninput = (e) => {
    edState.fontSize = parseInt(e.target.value, 10);
    $('fontSizeLabel').textContent = edState.fontSize + 'px';
  };

  // Canvas drawing
  const cnv = $('editCanvas');
  const getPos = (e) => {
    const r = cnv.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - r.left) * (cnv.width / r.width),
      y: (t.clientY - r.top) * (cnv.height / r.height)
    };
  };

  const start = (e) => {
    if (!edState.ctx) return;
    e.preventDefault();
    const p = getPos(e);
    edState.startX = p.x; edState.startY = p.y;
    if (edState.tool === 'text') {
      const txt = prompt('Masukkan teks:');
      if (txt) {
        const ctx = edState.ctx;
        ctx.fillStyle = edState.color;
        ctx.font = `bold ${edState.fontSize}px ${edState.font}, sans-serif`;
        ctx.textBaseline = 'top';
        // Stroke putih supaya nampak atas background gelap
        ctx.lineWidth = Math.max(2, edState.fontSize / 12);
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.strokeText(txt, p.x, p.y);
        ctx.fillText(txt, p.x, p.y);
        pushHistory();
      }
      return;
    }
    edState.drawing = true;
    edState.snapshot = edState.ctx.getImageData(0,0,cnv.width,cnv.height);
    if (edState.tool === 'pen' || edState.tool === 'erase') {
      edState.ctx.beginPath();
      edState.ctx.moveTo(p.x, p.y);
    }
  };
  const move = (e) => {
    if (!edState.drawing) return;
    e.preventDefault();
    const p = getPos(e);
    const ctx = edState.ctx;
    if (edState.tool === 'pen') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = edState.color;
      ctx.lineWidth = edState.size;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineTo(p.x, p.y); ctx.stroke();
    } else if (edState.tool === 'erase') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = edState.size * 2;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineTo(p.x, p.y); ctx.stroke();
    } else if (edState.tool === 'rect') {
      ctx.putImageData(edState.snapshot, 0, 0);
      ctx.strokeStyle = edState.color;
      ctx.lineWidth = edState.size;
      ctx.strokeRect(edState.startX, edState.startY, p.x - edState.startX, p.y - edState.startY);
    } else if (edState.tool === 'arrow') {
      ctx.putImageData(edState.snapshot, 0, 0);
      drawArrow(ctx, edState.startX, edState.startY, p.x, p.y, edState.color, edState.size);
    }
  };
  const end = () => {
    if (!edState.drawing) return;
    edState.drawing = false;
    pushHistory();
  };

  cnv.addEventListener('mousedown', start);
  cnv.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  cnv.addEventListener('touchstart', start, { passive: false });
  cnv.addEventListener('touchmove', move, { passive: false });
  cnv.addEventListener('touchend', end);

  $('btnEdUndo').onclick = undoEdit;
  $('btnEdReset').onclick = () => {
    if (!edState.img) return;
    const c = edState.canvas, ctx = edState.ctx;
    ctx.clearRect(0,0,c.width,c.height);
    ctx.drawImage(edState.img, 0, 0, c.width, c.height);
    edState.history = [ctx.getImageData(0,0,c.width,c.height)];
  };
  $('btnEdCancel').onclick = () => {
    $('editorModal').classList.add('hidden');
    edState.img = null;
  };
  $('btnEdSend').onclick = () => {
    edState.canvas.toBlob((blob) => {
      const f = new File([blob], 'screenshot-' + Date.now() + '.png', { type: 'image/png' });
      $('editorModal').classList.add('hidden');
      handleFile(f);
    }, 'image/png', 0.92);
  };
}

function drawArrow(ctx, x1, y1, x2, y2, color, size) {
  const head = Math.max(12, size * 3);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = size; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - Math.PI/6), y2 - head * Math.sin(ang - Math.PI/6));
  ctx.lineTo(x2 - head * Math.cos(ang + Math.PI/6), y2 - head * Math.sin(ang + Math.PI/6));
  ctx.closePath(); ctx.fill();
}
function pushHistory() {
  const c = edState.canvas;
  edState.history.push(edState.ctx.getImageData(0,0,c.width,c.height));
  if (edState.history.length > 30) edState.history.shift();
}
function undoEdit() {
  if (edState.history.length <= 1) return;
  edState.history.pop();
  edState.ctx.putImageData(edState.history[edState.history.length - 1], 0, 0);
}

// ===================== CALL (Jitsi via tab baru) =====================
const JITSI_ROOM = 'LoveMyFamily-Room-2026';
function startCall(video) {
  if (!session) { showToast('Sila login dulu'); return; }
  const params = new URLSearchParams({
    'config.startWithVideoMuted': video ? 'false' : 'true',
    'config.prejoinPageEnabled': 'false',
    'userInfo.displayName': session.name
  });
  const url = 'https://meet.jit.si/' + encodeURIComponent(JITSI_ROOM) + '#' + params.toString();

  // Buka tab/window baru — paling reliable. Iframe selalu disekat permission camera/mic.
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (!w) {
    showToast('Sila benarkan popup untuk mulakan call', 4000);
  } else {
    showToast((video ? '🎥 Video' : '📞 Audio') + ' call dibuka di tab baru', 2500);
  }

  // Hantar link ke chat
  api('send', {
    userId: session.userId, name: session.name, avatar: session.avatar,
    type: 'text',
    content: (video ? '🎥' : '📞') + ' ' + session.name + ' memulakan ' +
             (video ? 'VIDEO CALL' : 'panggilan suara') +
             ' — Sertai: ' + url
  }).catch(()=>{});
}

// ===================== LOGIN / SESSION =====================
function doLogin() {
  const name = $('inputName').value.trim();
  if (!name) { showToast('Sila masukkan nama'); return; }
  if (hasBanned(name)) { showToast('Nama tidak sopan'); return; }
  const selected = document.querySelector('.avatar-pick.selected');
  const avatar = selected ? selected.dataset.emoji : '🙂';
  const userId = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  session = { userId, name, avatar };
  saveSession(session);
  api('register', session).catch(() => {});
  enterChat(false);
}
function doLogout() {
  if (!confirm('Log keluar dari chat?')) return;
  clearSession(); stopPolling();
  session = null; lastTs = 0; seenIds.clear();
  $('messages').innerHTML = '';
  $('loginScreen').classList.remove('hidden');
  $('chatScreen').classList.add('hidden');
}
function enterChat(resumed) {
  $('loginScreen').classList.add('hidden');
  $('chatScreen').classList.remove('hidden');
  $('headerName').textContent = session.name;
  $('headerAvatar').textContent = session.avatar;
  if (resumed) showToast('Selamat kembali, ' + session.name + ' 👋', 2000);
  startPolling();
}

// ===================== POLLING =====================
function startPolling() {
  stopPolling(); fetchNew(true);
  pollTimer = setInterval(fetchNew, POLL_INTERVAL);
  setStatus('🟢 Tersambung');
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

async function fetchNew(initial) {
  try {
    const res = await api('fetch', null, { since: lastTs });
    if (!res || !res.ok) return;
    const msgs = res.messages || [];
    msgs.forEach(m => {
      if (seenIds.has(m.id)) return;
      seenIds.add(m.id);
      if (m.ts > lastTs) lastTs = m.ts;
      renderMessage(m, initial);
    });
    if (initial) scrollBottom();
  } catch (e) {
    setStatus('🔴 Terputus');
  }
}

// ===================== SEND =====================
async function sendText() {
  const txt = $('inputMsg').value.trim();
  if (!txt) return;
  if (hasBanned(txt)) { showToast('Dilarang mencarut!'); $('inputMsg').value = ''; return; }
  $('inputMsg').value = '';
  $('emojiPicker').style.display = 'none';
  await api('send', {
    userId: session.userId, name: session.name, avatar: session.avatar,
    type: 'text', content: txt
  });
  fetchNew();
}

async function handleFile(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { showToast('Maksimum saiz fail: 25MB'); return; }
  showToast('📤 Memuat naik ' + file.name + '...', 2000);
  const base64 = await fileToBase64(file);
  try {
    const up = await api('upload', { base64, mimeType: file.type, fileName: file.name });
    if (!up.ok) { showToast('Gagal upload: ' + (up.error || '')); return; }
    let type = 'file';
    if ((file.type || '').startsWith('image/')) type = 'image';
    else if ((file.type || '').startsWith('video/')) type = 'video';
    else if ((file.type || '').startsWith('audio/')) type = 'audio';
    await api('send', {
      userId: session.userId, name: session.name, avatar: session.avatar,
      type, content: up.view || up.url, fileUrl: up.url, fileName: file.name
    });
    fetchNew();
  } catch (err) { showToast('Ralat upload: ' + err.message); }
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = r.result; const i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : s); };
    r.onerror = reject; r.readAsDataURL(file);
  });
}

// ===================== ADMIN CLEAR =====================
async function doClearAll() {
  const p = prompt('Masukkan kata laluan ADMIN (hint: ' + ADMIN_PASSWORD_HINT + ') untuk padam SEMUA chat:');
  if (p === null) return;
  const res = await api('clear', { password: p });
  if (res.ok) {
    $('messages').innerHTML = ''; lastTs = 0; seenIds.clear();
    showToast('✅ Semua chat dipadam!');
  } else { showToast('❌ ' + (res.error || 'Gagal')); }
}

// ===================== RENDER =====================
function renderMessage(m, noAnim) {
  const mine = m.userId === session.userId;
  const row = document.createElement('div');
  row.className = 'msg-row ' + (mine ? 'mine' : 'other') + (noAnim ? ' no-anim' : '');
  const av = document.createElement('div'); av.className = 'msg-avatar'; av.textContent = m.avatar || '🙂';
  const bub = document.createElement('div'); bub.className = 'bubble ' + (mine ? 'bubble-mine' : 'bubble-other');
  if (!mine) {
    const nm = document.createElement('div'); nm.className = 'sender-name'; nm.textContent = m.name;
    bub.appendChild(nm);
  }
  const body = document.createElement('div'); body.className = 'bubble-body';
  if (m.type === 'image') {
    const img = document.createElement('img'); img.className = 'media';
    img.src = m.fileUrl || m.content; img.alt = m.fileName || 'image';
    img.onclick = () => window.open(m.content || m.fileUrl, '_blank');
    body.appendChild(img);
  } else if (m.type === 'video') {
    const v = document.createElement('video'); v.className = 'media';
    v.src = m.fileUrl || m.content; v.controls = true; body.appendChild(v);
  } else if (m.type === 'audio') {
    const a = document.createElement('audio'); a.src = m.fileUrl || m.content; a.controls = true; body.appendChild(a);
  } else if (m.type === 'file') {
    const a = document.createElement('a');
    a.href = m.content || m.fileUrl; a.target = '_blank'; a.rel = 'noopener';
    a.className = 'file-chip';
    a.innerHTML = '📎 <span>' + escapeHtml(m.fileName || 'Fail') + '</span>';
    body.appendChild(a);
  } else {
    body.innerHTML = linkify(escapeHtml(m.content || ''));
  }
  const time = document.createElement('div'); time.className = 'msg-time'; time.textContent = formatTime(m.ts);
  bub.appendChild(body); bub.appendChild(time);
  row.appendChild(av); row.appendChild(bub);
  $('messages').appendChild(row);
  scrollBottom();
}
function scrollBottom() { const m = $('messages'); m.scrollTop = m.scrollHeight; }
function formatTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

// ===================== UTIL =====================
function setStatus(t) { $('headerStatus').textContent = t; }
function showToast(msg, ms) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 2500);
}
function hasBanned(text) { const t = (text || '').toLowerCase(); return BANNED.some(w => t.includes(w)); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function linkify(text) {
  const re = /(https?:\/\/[^\s<]+)/g;
  return text.replace(re, (url) =>
    `<a href="${url}" target="_blank" rel="noopener" class="chat-link">${url}</a>`
  ).replace(/\n/g, '<br>');
}

// ===================== API =====================
async function api(action, body, queryExtra) {
  if (!API_URL) throw new Error('API_URL belum di-set');
  if (action === 'fetch' || action === 'users' || action === 'ping') {
    const q = new URLSearchParams({ action, ...(queryExtra || {}) }).toString();
    const r = await fetch(API_URL + '?' + q, { method: 'GET' });
    return r.json();
  }
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...(body || {}) })
  });
  return r.json();
}
