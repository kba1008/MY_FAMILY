/* =====================================================================
 *  LOVE MY FAMILY - Frontend Logic (app.js)
 *  Backend: Google Apps Script Web App (Code.gs)
 *  =====================================================================
 *  STEP PENTING:
 *    1. Deploy Code.gs sebagai Web App (Anyone access).
 *    2. Tampal URL Web App tersebut ke pemboleh ubah API_URL di bawah.
 * ===================================================================== */

const API_URL = 'https://script.google.com/macros/s/AKfycbxVGz059cuL-l7CEHABQ57UT46BMZz1CEy6tl27cCpXIMgwJlmmKVpWCj1124kQn9f15A/exec'; // <-- TAMPAL URL Web App Apps Script di sini (https://script.google.com/macros/s/.../exec)

const POLL_INTERVAL = 2500;        // ms - poll mesej baru
const ADMIN_PASSWORD_HINT = '101010';
const STORAGE_KEY = 'lmf_session_v1';

// ===================== STATE =====================
let session = null;                // {userId, name, avatar}
let lastTs = 0;                    // timestamp mesej terakhir diterima
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

// ===================== DOM SHORTCUTS =====================
const $ = (id) => document.getElementById(id);

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded', init);

function init() {
  if (!API_URL) {
    showToast('⚠️ API_URL belum di-set dalam app.js', 5000);
  }

  buildAvatarPicker();
  buildEmojiPicker();
  bindUI();

  // Auto-resume jika sudah login
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      session = JSON.parse(saved);
      enterChat(true);
    } catch (_) { localStorage.removeItem(STORAGE_KEY); }
  }

  // Daftar service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ===================== UI BUILDERS =====================
function buildAvatarPicker() {
  const wrap = $('avatarGrid');
  wrap.innerHTML = '';
  AVATARS.forEach((em, i) => {
    const d = document.createElement('div');
    d.className = 'avatar-pick' + (i === 0 ? ' selected' : '');
    d.textContent = em;
    d.dataset.emoji = em;
    d.onclick = () => {
      wrap.querySelectorAll('.avatar-pick').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
    };
    wrap.appendChild(d);
  });
}

function buildEmojiPicker() {
  const wrap = $('emojiPicker');
  wrap.innerHTML = '';
  EMOJIS.forEach((em) => {
    const s = document.createElement('span');
    s.className = 'emoji-item';
    s.textContent = em;
    s.onclick = () => {
      const inp = $('inputMsg');
      inp.value += em;
      inp.focus();
    };
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
  $('fileInput').onchange = (e) => handleFile(e.target.files[0]);

  $('btnLogout').onclick = doLogout;
  $('btnClear').onclick = doClearAll;
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));

  api('register', session).catch(() => {});
  enterChat(false);
}

function doLogout() {
  if (!confirm('Log keluar dari chat?')) return;
  localStorage.removeItem(STORAGE_KEY);
  stopPolling();
  session = null;
  lastTs = 0;
  seenIds.clear();
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
  stopPolling();
  fetchNew(true);
  pollTimer = setInterval(fetchNew, POLL_INTERVAL);
  setStatus('🟢 Tersambung');
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

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
    const up = await api('upload', {
      base64, mimeType: file.type, fileName: file.name
    });
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
  } catch (err) {
    showToast('Ralat upload: ' + err.message);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result;
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ===================== ADMIN CLEAR =====================
async function doClearAll() {
  const p = prompt('Masukkan kata laluan ADMIN (hint: ' + ADMIN_PASSWORD_HINT + ') untuk padam SEMUA chat:');
  if (p === null) return;
  const res = await api('clear', { password: p });
  if (res.ok) {
    $('messages').innerHTML = '';
    lastTs = 0;
    seenIds.clear();
    showToast('✅ Semua chat dipadam!');
  } else {
    showToast('❌ ' + (res.error || 'Gagal'));
  }
}

// ===================== RENDER =====================
function renderMessage(m, noAnim) {
  const mine = m.userId === session.userId;
  const row = document.createElement('div');
  row.className = 'msg-row ' + (mine ? 'mine' : 'other') + (noAnim ? ' no-anim' : '');

  const av = document.createElement('div');
  av.className = 'msg-avatar';
  av.textContent = m.avatar || '🙂';

  const bub = document.createElement('div');
  bub.className = 'bubble ' + (mine ? 'bubble-mine' : 'bubble-other');

  if (!mine) {
    const nm = document.createElement('div');
    nm.className = 'sender-name';
    nm.textContent = m.name;
    bub.appendChild(nm);
  }

  const body = document.createElement('div');
  body.className = 'bubble-body';

  if (m.type === 'image') {
    const img = document.createElement('img');
    img.className = 'media';
    img.src = m.fileUrl || m.content;
    img.alt = m.fileName || 'image';
    img.onclick = () => window.open(m.content || m.fileUrl, '_blank');
    body.appendChild(img);
  } else if (m.type === 'video') {
    const v = document.createElement('video');
    v.className = 'media';
    v.src = m.fileUrl || m.content;
    v.controls = true;
    body.appendChild(v);
  } else if (m.type === 'audio') {
    const a = document.createElement('audio');
    a.src = m.fileUrl || m.content;
    a.controls = true;
    body.appendChild(a);
  } else if (m.type === 'file') {
    const a = document.createElement('a');
    a.href = m.content || m.fileUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'file-chip';
    a.innerHTML = '📎 <span>' + escapeHtml(m.fileName || 'Fail') + '</span>';
    body.appendChild(a);
  } else {
    body.innerHTML = linkify(escapeHtml(m.content || ''));
  }

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = formatTime(m.ts);

  bub.appendChild(body);
  bub.appendChild(time);
  row.appendChild(av);
  row.appendChild(bub);

  $('messages').appendChild(row);
  scrollBottom();
}

function scrollBottom() {
  const m = $('messages');
  m.scrollTop = m.scrollHeight;
}

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

// ===================== UTIL =====================
function setStatus(t) { $('headerStatus').textContent = t; }

function showToast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms || 2500);
}

function hasBanned(text) {
  const t = (text || '').toLowerCase();
  return BANNED.some(w => t.includes(w));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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
  // GET untuk fetch (lebih ringan); POST untuk yang lain
  if (action === 'fetch' || action === 'users' || action === 'ping') {
    const q = new URLSearchParams({ action, ...(queryExtra || {}) }).toString();
    const r = await fetch(API_URL + '?' + q, { method: 'GET' });
    return r.json();
  }
  const r = await fetch(API_URL, {
    method: 'POST',
    // text/plain elak CORS preflight pada Apps Script
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...(body || {}) })
  });
  return r.json();
}
