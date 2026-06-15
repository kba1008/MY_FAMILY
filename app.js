/* =====================================================================
 *  LOVE MY FAMILY - Frontend Logic (app.js)
 *  Backend: Google Apps Script Web App (Code.gs)
 *  ===================================================================== */

const API_URL = 'https://script.google.com/macros/s/AKfycbzWAN6iwOUm1Z9EUIwsLujtUoY_4CrSHwjXKvvdOKnDuY9xuZEPVVu_K0-xNYOk_6m8PQ/exec'; // <-- TAMPAL URL Web App Apps Script di sini

const POLL_INTERVAL = 2500;
// (Kata laluan admin disimpan di server sahaja — tidak didedahkan di UI)
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
let settings = { pmEnabled: false, theme: 'aurora' };
let pmTarget = null; // {userId, name, avatar} or null
let allUsers = [];
let usersLastFetch = 0;
let pmConversations = {}; // peerUserId -> [{m, mine}]
let pmActivePeer = null;  // peer being viewed in popup
let pmUnreadByPeer = {};  // peerId -> unread count (when popup closed / other peer open)
let notifPermAsked = false;

// ---- mic / voice recording ----
let mediaRecorder = null;
let recChunks = [];
let recStream = null;
let recStartedAt = 0;
let recTimerId = null;

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
  applySettings(settings); // default theme attribute
  // load global settings sebaik mungkin
  api('getSettings').then(r => { if (r && r.ok && r.settings) applySettings(r.settings); }).catch(()=>{});

  const saved = loadSession();
  if (saved && saved.userId && saved.name) {
    session = saved;
    saveSession(session);
    enterChat(true);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      try { reg.update(); } catch (_) {}
    }).catch(() => {});
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

  // New: users / settings / mic / pm
  $('btnUsers').onclick = openUsersModal;
  $('btnSettings').onclick = openSettingsModal;
  $('btnMic').onclick = toggleMicRecord;
  const oldPmClose = $('pmCloseBtn');
  if (oldPmClose) oldPmClose.onclick = closePM;
  $('usersClose').onclick = () => $('usersModal').classList.add('hidden');
  $('usersModal').querySelector('.admin-backdrop').onclick = () => $('usersModal').classList.add('hidden');

  // PM popup handlers
  $('pmModalClose').onclick = closePMPopup;
  $('pmModal').querySelector('.admin-backdrop').onclick = closePMPopup;
  $('pmSendBtn').onclick = sendPMFromPopup;
  $('pmInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendPMFromPopup(); });
  $('pmAttachBtn').onclick = () => $('pmFileInput').click();
  $('pmFileInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f && pmActivePeer) handlePMFile(f);
    e.target.value = '';
  };
  $('pmPopClose').onclick = (e) => { e.stopPropagation(); hidePMPop(); };
  $('pmPop').onclick = () => {
    const peerId = $('pmPop').dataset.peer;
    hidePMPop();
    if (peerId) {
      const u = allUsers.find(x => x.userId === peerId);
      openPMPopup(u || { userId: peerId, name: $('pmPopName').textContent, avatar: $('pmPopAvatar').textContent });
    }
  };

  // Image editor controls
  bindEditorUI();
}

// ===================== PASTE / DRAG-DROP SCREENSHOT =====================
function tryHandleClipboardEvent(e) {
  if (!session) return false;
  const cd = e.clipboardData || window.clipboardData;
  if (!cd) return false;
  // 1) cuba items
  const items = cd.items ? Array.from(cd.items) : [];
  for (const it of items) {
    const t = (it.type || '').toLowerCase();
    if (t.startsWith('image/')) {
      const f = (it.kind === 'file') ? it.getAsFile() : null;
      if (f) { e.preventDefault(); openImageEditor(f); return true; }
    }
  }
  // 2) cuba files (Safari / sesetengah Chromium)
  const files = cd.files ? Array.from(cd.files) : [];
  for (const f of files) {
    if ((f.type || '').startsWith('image/')) {
      e.preventDefault(); openImageEditor(f); return true;
    }
  }
  return false;
}

function bindPasteAndDrop() {
  // Paste global (document)
  document.addEventListener('paste', tryHandleClipboardEvent);
  // Paste pada input (sesetengah browser hanya hantar event ke target focus)
  const inp = $('inputMsg');
  if (inp) inp.addEventListener('paste', tryHandleClipboardEvent);

  // Butang "paste screenshot" guna Clipboard API moden (fallback)
  const btnPaste = $('btnPasteShot');
  if (btnPaste) btnPaste.onclick = async () => {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      showToast('Browser ini tidak sokong Clipboard API. Sila gunakan Ctrl+V.', 3500);
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        for (const type of it.types) {
          if (type.startsWith('image/')) {
            const blob = await it.getType(type);
            openImageEditor(blob);
            return;
          }
        }
      }
      showToast('Tiada gambar dalam clipboard', 2500);
    } catch (err) {
      showToast('Tidak dapat baca clipboard: ' + (err.message || err), 3500);
    }
  };

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

// ===================== CALL (Jitsi - premium launcher) =====================
const JITSI_ROOM = 'LoveMyFamily-Room-2026';
function buildJitsiUrl(video) {
  const params = new URLSearchParams({
    'config.startWithVideoMuted': video ? 'false' : 'true',
    'config.prejoinPageEnabled': 'false',
    'userInfo.displayName': session ? session.name : 'Guest'
  });
  return 'https://meet.jit.si/' + encodeURIComponent(JITSI_ROOM) + '#' + params.toString();
}

function startCall(video) {
  if (!session) { showToast('Sila login dulu'); return; }
  const url = buildJitsiUrl(video);
  openCallModal(video, url);
}

function openCallModal(video, url) {
  const modal = $('callModal');
  if (!modal) {
    // fallback lama
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  $('callModalTitle').textContent = video ? '🎥 Video Call' : '📞 Panggilan Suara';
  $('callModalDesc').textContent  = video
    ? 'Mulakan panggilan video selamat melalui Jitsi Meet. Sila benarkan akses kamera & mikrofon apabila diminta.'
    : 'Mulakan panggilan suara selamat melalui Jitsi Meet. Sila benarkan akses mikrofon apabila diminta.';
  const join = $('callJoinLink');
  join.href = url;
  join.textContent = (video ? '🎥' : '📞') + ' Sertai Sekarang';
  $('callCopyLink').onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('🔗 Pautan disalin');
    } catch { showToast('Tidak dapat menyalin pautan', 2500); }
  };
  $('callShareChat').onclick = () => {
    api('send', {
      userId: session.userId, name: session.name, avatar: session.avatar,
      type: 'text',
      content: (video ? '🎥' : '📞') + ' ' + session.name + ' memulakan ' +
               (video ? 'VIDEO CALL' : 'panggilan suara') +
               ' — Sertai: ' + url
    }).catch(()=>{});
    showToast('📢 Dikongsi ke chat');
  };
  $('callClose').onclick = () => modal.classList.add('hidden');
  modal.classList.remove('hidden');
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
  requestNotifPerm();
}

// ===================== POLLING =====================
function startPolling() {
  stopPolling(); fetchNew(true);
  pollTimer = setInterval(fetchNew, POLL_INTERVAL);
  setStatus('🟢 Tersambung');
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

let unreadCount = 0;
const baseTitle = document.title;
window.addEventListener('focus', () => { unreadCount = 0; document.title = baseTitle; });

async function fetchNew(initial) {
  try {
    const q = { since: lastTs };
    if (session && session.userId) {
      q.userId = session.userId;
      q.name = session.name || '';
      q.avatar = session.avatar || '';
    }
    const res = await api('fetch', null, q);
    if (!res || !res.ok) return;
    if (res.settings) applySettings(res.settings);
    const msgs = res.messages || [];
    let newFromOther = 0;
    msgs.forEach(m => {
      if (seenIds.has(m.id)) return;
      seenIds.add(m.id);
      if (m.ts > lastTs) lastTs = m.ts;
      renderMessage(m, initial);
      if (!initial && session && !m.toUserId && m.userId !== session.userId) newFromOther++;
    });
    if (initial) scrollBottom();
    if (newFromOther > 0) {
      playBeep();
      if (document.hidden || !document.hasFocus()) {
        unreadCount += newFromOther;
        document.title = '(' + unreadCount + ') ' + baseTitle;
      }
      // Native notification for last new PUBLIC message from others
      const lastPub = msgs.filter(x => !x.toUserId && x.userId !== session.userId).pop();
      if (lastPub) {
        tryNativeNotification('💚 ' + lastPub.name + ' di LOVE MY FAMILY', previewOf(lastPub), lastPub.avatar);
      }
    }
    fetchUsersQuiet(initial);
    setStatus('🟢 Tersambung');
  } catch (e) {
    setStatus('🔴 Terputus');
  }
}

// Notifikasi bunyi pendek (WebAudio — tiada fail)
let _audioCtx = null;
function playBeep() {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.start(t); o.stop(t + 0.24);
  } catch(_) {}
}

// ===================== SEND =====================
async function sendText() {
  const txt = $('inputMsg').value.trim();
  if (!txt) return;
  if (pmTarget || (pmActivePeer && !$('pmModal').classList.contains('hidden'))) {
    showToast('🔒 PM hanya boleh dihantar dalam popup PM. Klik nama pengguna untuk buka popup.', 4000);
    openPMPopup(pmTarget || allUsers.find(u => u.userId === pmActivePeer) || { userId: pmActivePeer, name: 'PM', avatar: '🙂' });
    return;
  }
  if (hasBanned(txt)) { showToast('Dilarang mencarut!'); $('inputMsg').value = ''; return; }
  $('inputMsg').value = '';
  $('emojiPicker').style.display = 'none';
  // Main composer always sends PUBLIC. PMs go through the PM popup.
  await api('send', {
    userId: session.userId, name: session.name, avatar: session.avatar,
    type: 'text', content: txt, toUserId: ''
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
    const playbackUrl = (type === 'audio') ? normalizeDriveAudioUrl(up.url || up.view) : (up.url || up.view);
    await api('send', {
      userId: session.userId, name: session.name, avatar: session.avatar,
      type, content: up.view || up.url, fileUrl: playbackUrl, fileName: file.name,
      toUserId: ''
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

// ===================== ADMIN CLEAR (premium modal) =====================
function doClearAll() {
  const modal = $('adminModal');
  if (!modal) return;
  const input = $('adminPwd');
  const errEl = $('adminErr');
  input.value = '';
  errEl.textContent = '';
  modal.classList.remove('hidden');
  setTimeout(() => input.focus(), 80);

  const close = () => modal.classList.add('hidden');
  $('adminCancel').onclick = close;
  modal.querySelector('.admin-backdrop').onclick = close;

  const submit = async () => {
    const p = input.value;
    if (!p) { errEl.textContent = 'Sila masukkan kata laluan.'; return; }
    $('adminConfirm').disabled = true;
    errEl.textContent = '';
    try {
      const res = await api('clear', { password: p });
      if (res.ok) {
        $('messages').innerHTML = ''; lastTs = 0; seenIds.clear();
        close();
        showToast('✅ Semua chat telah dipadam');
      } else {
        errEl.textContent = '❌ ' + (res.error || 'Kata laluan salah');
      }
    } catch (e) {
      errEl.textContent = '❌ Ralat rangkaian';
    } finally {
      $('adminConfirm').disabled = false;
    }
  };
  $('adminConfirm').onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); };
}

// ===================== RENDER =====================
function renderMessage(m, noAnim) {
  const mine = m.userId === session.userId;
  // PM: route to private popup instead of main feed
  if (m.toUserId) {
    const peerId = mine ? m.toUserId : m.userId;
    if (!pmConversations[peerId]) pmConversations[peerId] = [];
    if (pmConversations[peerId].some(x => x.m.id === m.id)) return;
    pmConversations[peerId].push({ m, mine });
    if (pmActivePeer === peerId && !$('pmModal').classList.contains('hidden')) {
      appendPMBubble(m, mine);
    } else if (!mine && !noAnim) {
      // Incoming PM, not currently viewing this peer -> notify
      pmUnreadByPeer[peerId] = (pmUnreadByPeer[peerId] || 0) + 1;
      updateUsersBadge();
      showPMPop(m);
      tryNativeNotification('🔒 PM dari ' + m.name, previewOf(m), m.avatar);
      playBeep();
    }
    return;
  }
  const row = document.createElement('div');
  row.className = 'msg-row ' + (mine ? 'mine' : 'other') + (noAnim ? ' no-anim' : '');
  const av = document.createElement('div'); av.className = 'msg-avatar'; av.textContent = m.avatar || '🙂';
  if (!mine && settings.pmEnabled) {
    av.classList.add('pm-clickable');
    av.title = 'Klik untuk PM ' + (m.name || 'pengguna ini');
    av.onclick = () => openPMPopup(userFromMessage(m));
  }
  const bub = document.createElement('div'); bub.className = 'bubble ' + (mine ? 'bubble-mine' : 'bubble-other');
  if (!mine) {
    const nm = document.createElement('div'); nm.className = 'sender-name'; nm.textContent = m.name;
    if (settings.pmEnabled) {
      nm.classList.add('pm-clickable-name');
      nm.title = 'Klik untuk PM ' + (m.name || 'pengguna ini');
      nm.onclick = (e) => { e.stopPropagation(); openPMPopup(userFromMessage(m)); };
    }
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
    body.appendChild(createVoicePlayer(m));
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

function normalizeDriveAudioUrl(url) {
  url = String(url || '');
  const idMatch = url.match(/[?&]id=([^&]+)/) || url.match(/\/d\/([^/]+)/);
  if (idMatch && /drive\.google\.com/.test(url)) {
    return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(idMatch[1]);
  }
  return url;
}
function extractDriveFileId(url) {
  url = String(url || '');
  const m = url.match(/[?&]id=([^&]+)/) || url.match(/\/d\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function base64ToBlob(base64, mime) {
  const bin = atob(base64);
  const chunks = [];
  for (let i = 0; i < bin.length; i += 8192) {
    const part = bin.slice(i, i + 8192);
    const arr = new Uint8Array(part.length);
    for (let j = 0; j < part.length; j++) arr[j] = part.charCodeAt(j);
    chunks.push(arr);
  }
  return new Blob(chunks, { type: mime || 'audio/webm' });
}

async function loadAudioViaBackend(url, audio, label) {
  const fileId = extractDriveFileId(url);
  if (!fileId) throw new Error('File ID audio tidak dijumpai');
  label.querySelector('span').textContent = 'Membuka audio melalui server…';
  const res = await api('file', { fileId: fileId });
  if (!res.ok) throw new Error(res.error || 'Gagal ambil audio');
  const blob = base64ToBlob(res.base64, res.mimeType);
  const blobUrl = URL.createObjectURL(blob);
  audio.src = blobUrl;
  audio.dataset.blobUrl = blobUrl;
  return blobUrl;
}

function createVoicePlayer(m) {
  const wrap = document.createElement('div');
  wrap.className = 'voice-player';
  const url = normalizeDriveAudioUrl(m.fileUrl || m.content);
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'voice-play';
  play.textContent = '▶️';
  const label = document.createElement('div');
  label.className = 'voice-label';
  label.innerHTML = '<b>Voice message</b><span>Tap untuk play</span>';
  const open = document.createElement('a');
  open.href = url;
  open.target = '_blank';
  open.rel = 'noopener';
  open.className = 'voice-open';
  open.textContent = '↗';
  open.title = 'Buka audio jika browser sekat playback';
  const audio = document.createElement('audio');
  audio.preload = 'none';
  audio.src = url;
  audio.controls = true;
  audio.style.display = 'none';
  play.onclick = async () => {
    try {
      audio.style.display = 'block';
      if (audio.paused) {
        await audio.play();
        play.textContent = '⏸️';
        label.querySelector('span').textContent = 'Sedang dimainkan';
      } else {
        audio.pause();
        play.textContent = '▶️';
        label.querySelector('span').textContent = 'Dijeda';
      }
    } catch (e) {
      try {
        if (!audio.dataset.blobUrl) await loadAudioViaBackend(url, audio, label);
        await audio.play();
        play.textContent = '⏸️';
        label.querySelector('span').textContent = 'Sedang dimainkan';
      } catch (e2) {
        label.querySelector('span').textContent = 'Gagal play — tap ↗ untuk buka/download';
        showToast('Audio tak boleh play: tekan ikon ↗. Ralat: ' + (e2.message || e2 || e.message || ''), 6500);
      }
    }
  };
  audio.onended = () => { play.textContent = '▶️'; label.querySelector('span').textContent = 'Selesai'; };
  audio.onerror = () => {
    label.querySelector('span').textContent = 'Gagal play — tap ↗ untuk buka/download';
  };
  wrap.appendChild(play); wrap.appendChild(label); wrap.appendChild(open); wrap.appendChild(audio);
  return wrap;
}
function scrollBottom() { const m = $('messages'); m.scrollTop = m.scrollHeight; }
function formatTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
function userFromMessage(m) {
  const saved = allUsers.find(u => u.userId === m.userId);
  return saved || { userId: m.userId, name: m.name, avatar: m.avatar };
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
    const txt = await r.text();
    try { return JSON.parse(txt); }
    catch (_) { return { ok: false, error: 'Response bukan JSON: ' + txt.slice(0, 260) }; }
  }
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...(body || {}) })
  });
  const txt = await r.text();
  try { return JSON.parse(txt); }
  catch (_) { return { ok: false, error: 'Response bukan JSON: ' + txt.slice(0, 260) }; }
}


// ===================== THEME / SETTINGS =====================
function applySettings(s) {
  const themeChanged = s.theme && s.theme !== settings.theme;
  settings = Object.assign({}, settings, s);
  document.body.setAttribute('data-theme', settings.theme || 'aurora');
  document.documentElement.setAttribute('data-theme', settings.theme || 'aurora');
  // PM controls visibility
  const btnU = $('btnUsers');
  if (btnU) btnU.style.display = settings.pmEnabled ? '' : 'none';
  if (!settings.pmEnabled && pmTarget) closePM();
  if (themeChanged) showToast('🎨 Tema ditukar: ' + (settings.theme || 'aurora'));
}

// ===================== PM (PERSONAL MESSAGE) =====================
function setPMTarget(u) {
  if (!settings.pmEnabled) { showToast('PM peribadi sedang dimatikan oleh admin'); return; }
  openPMPopup(u);
}
function closePM() {
  closePMPopup();
}

// ===================== PM POPUP =====================
function openPMPopup(u) {
  if (!u || !u.userId) return;
  if (!settings.pmEnabled) { showToast('PM peribadi sedang dimatikan oleh admin'); return; }
  pmActivePeer = u.userId;
  pmTarget = { userId: u.userId, name: u.name, avatar: u.avatar };
  pmUnreadByPeer[u.userId] = 0;
  updateUsersBadge();
  $('pmPeerAvatar').textContent = u.avatar || '🙂';
  $('pmPeerName').textContent = u.name || '—';
  const box = $('pmMessages');
  box.innerHTML = '';
  const conv = pmConversations[u.userId] || [];
  if (!conv.length) {
    box.innerHTML = '<div class="pm-empty">🔒 Tiada PM lagi. Mulakan perbualan peribadi anda.</div>';
  } else {
    conv.forEach(x => appendPMBubble(x.m, x.mine));
  }
  $('pmModal').classList.remove('hidden');
  setTimeout(() => $('pmInput').focus(), 80);
  hidePMPop();
}
function closePMPopup() {
  $('pmModal').classList.add('hidden');
  pmActivePeer = null;
  pmTarget = null;
}
function appendPMBubble(m, mine) {
  const box = $('pmMessages');
  const empty = box.querySelector('.pm-empty');
  if (empty) empty.remove();
  const b = document.createElement('div');
  b.className = 'pm-bubble ' + (mine ? 'mine' : 'other');
  if (m.type === 'image') {
    const img = document.createElement('img'); img.className = 'media';
    img.src = m.fileUrl || m.content;
    img.onclick = () => window.open(m.content || m.fileUrl, '_blank');
    b.appendChild(img);
  } else if (m.type === 'video') {
    const v = document.createElement('video'); v.className = 'media';
    v.src = m.fileUrl || m.content; v.controls = true; b.appendChild(v);
  } else if (m.type === 'audio') {
    b.appendChild(createVoicePlayer(m));
  } else if (m.type === 'file') {
    const a = document.createElement('a');
    a.href = m.content || m.fileUrl; a.target = '_blank'; a.rel = 'noopener';
    a.className = 'file-chip';
    a.innerHTML = '📎 <span>' + escapeHtml(m.fileName || 'Fail') + '</span>';
    b.appendChild(a);
  } else {
    const t = document.createElement('div');
    t.innerHTML = linkify(escapeHtml(m.content || ''));
    b.appendChild(t);
  }
  const time = document.createElement('div'); time.className = 'pmt'; time.textContent = formatTime(m.ts);
  b.appendChild(time);
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
}
async function sendPMFromPopup() {
  if (!pmActivePeer) return;
  const inp = $('pmInput');
  const txt = inp.value.trim();
  if (!txt) return;
  if (hasBanned(txt)) { showToast('Dilarang mencarut!'); inp.value = ''; return; }
  inp.value = '';
  const res = await api('sendPM', {
    userId: session.userId, name: session.name, avatar: session.avatar,
    type: 'text', content: txt, toUserId: pmActivePeer
  });
  if (!res || !res.ok) {
    showToast('PM tidak dihantar. Sila update Code.gs terbaru dan Deploy New version.', 6000);
    inp.value = txt;
    return;
  }
  fetchNew();
}
async function handlePMFile(file) {
  if (!file || !pmActivePeer) return;
  if (file.size > 25 * 1024 * 1024) { showToast('Maksimum saiz fail: 25MB'); return; }
  showToast('📤 Memuat naik PM...', 2000);
  const base64 = await fileToBase64(file);
  try {
    const up = await api('upload', { base64, mimeType: file.type, fileName: file.name });
    if (!up.ok) { showToast('Gagal upload: ' + (up.error || '')); return; }
    let type = 'file';
    if ((file.type || '').startsWith('image/')) type = 'image';
    else if ((file.type || '').startsWith('video/')) type = 'video';
    else if ((file.type || '').startsWith('audio/')) type = 'audio';
    const playbackUrl = (type === 'audio') ? normalizeDriveAudioUrl(up.url || up.view) : (up.url || up.view);
    const res = await api('sendPM', {
      userId: session.userId, name: session.name, avatar: session.avatar,
      type, content: up.view || up.url, fileUrl: playbackUrl, fileName: file.name,
      toUserId: pmActivePeer
    });
    if (!res || !res.ok) {
      showToast('PM fail tidak dihantar. Sila update Code.gs terbaru dan Deploy New version.', 6000);
      return;
    }
    fetchNew();
  } catch (err) { showToast('Ralat upload: ' + err.message); }
}

function previewOf(m) {
  if (m.type === 'image') return '📷 Gambar';
  if (m.type === 'video') return '🎬 Video';
  if (m.type === 'audio') return '🎤 Voice message';
  if (m.type === 'file')  return '📎 ' + (m.fileName || 'Fail');
  return String(m.content || '').slice(0, 90);
}

function showPMPop(m) {
  const pop = $('pmPop');
  $('pmPopAvatar').textContent = m.avatar || '🙂';
  $('pmPopName').textContent = '🔒 ' + (m.name || 'PM') + ' kirim PM';
  $('pmPopText').textContent = previewOf(m);
  pop.dataset.peer = m.userId;
  pop.classList.add('show');
  clearTimeout(pop._h);
  pop._h = setTimeout(hidePMPop, 6500);
}
function hidePMPop() { $('pmPop').classList.remove('show'); }

function updateUsersBadge() {
  const btn = $('btnUsers');
  if (!btn) return;
  const total = Object.values(pmUnreadByPeer).reduce((a, b) => a + b, 0);
  let badge = btn.querySelector('.badge-dot');
  if (total > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'badge-dot'; btn.appendChild(badge); }
    badge.textContent = total > 99 ? '99+' : String(total);
  } else if (badge) {
    badge.remove();
  }
}

// ===================== NOTIFICATIONS =====================
function requestNotifPerm() {
  if (notifPermAsked) return;
  notifPermAsked = true;
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(()=>{});
    }
  } catch(_) {}
}
function tryNativeNotification(title, body, iconEmoji) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (document.hasFocus && document.hasFocus() && !document.hidden) return;
    const n = new Notification(title, {
      body: body || '',
      tag: 'lmf-msg',
      icon: emojiToDataURL(iconEmoji || '💬'),
      badge: emojiToDataURL('💚')
    });
    n.onclick = () => { try { window.focus(); n.close(); } catch(_) {} };
  } catch(_) {}
}
function emojiToDataURL(emoji) {
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text y="50" font-size="52">${emoji}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  } catch(_) { return ''; }
}

async function openUsersModal() {
  if (!settings.pmEnabled) { showToast('PM peribadi sedang dimatikan oleh admin'); return; }
  const modal = $('usersModal');
  modal.classList.remove('hidden');
  const list = $('userList');
  list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:10px;">Memuat…</div>';
  try {
    const res = await api('users', null, session ? { userId: session.userId, name: session.name, avatar: session.avatar } : {});
    if (!res.ok) { list.innerHTML = '<div style="color:#dc2626;text-align:center;">Gagal memuat</div>'; return; }
    allUsers = res.users || [];
    usersLastFetch = Date.now();
    updateHeaderOnline();
    renderUserList();
  } catch (e) { list.innerHTML = '<div style="color:#dc2626;text-align:center;">Ralat rangkaian</div>'; }
}
async function fetchUsersQuiet(force) {
  if (!session) return;
  const now = Date.now();
  if (!force && now - usersLastFetch < 10000) return;
  usersLastFetch = now;
  try {
    const res = await api('users', null, { userId: session.userId, name: session.name, avatar: session.avatar });
    if (!res || !res.ok) return;
    allUsers = res.users || [];
    updateHeaderOnline();
    if (!$('usersModal').classList.contains('hidden')) renderUserList();
  } catch (_) {}
}
function getOnlineUsers() {
  const now = Date.now();
  return allUsers
    .filter(u => (now - (u.lastSeen || 0)) < 60000)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}
function updateHeaderOnline() {
  const text = $('headerOnlineText');
  const strip = $('headerOnlineStrip');
  if (!text || !strip) return;
  const online = getOnlineUsers();
  text.textContent = online.length ? (online.length + ' online') : 'Tiada online';
  strip.innerHTML = '';
  online.slice(0, 7).forEach(u => {
    const chip = document.createElement('button');
    const isMe = session && u.userId === session.userId;
    chip.type = 'button';
    chip.className = 'online-chip' + (isMe ? ' me' : '');
    chip.title = isMe ? 'Anda sedang online' : (settings.pmEnabled ? ('Klik untuk PM ' + (u.name || 'pengguna ini')) : (u.name || 'Pengguna') + ' sedang online');
    chip.innerHTML = '<span class="oa">' + (u.avatar || '🙂') + '</span><span class="on">' + escapeHtml(u.name || '—') + (isMe ? ' (Anda)' : '') + '</span>';
    if (!isMe && settings.pmEnabled) chip.onclick = () => openPMPopup(u);
    strip.appendChild(chip);
  });
}
function renderUserList() {
  const list = $('userList');
  list.innerHTML = '';
  const now = Date.now();
  // sort: most recent first
  const sorted = allUsers.slice().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  sorted.forEach(u => {
    const isMe = session && u.userId === session.userId;
    const online = (now - (u.lastSeen || 0)) < 60000;
    const d = document.createElement('div');
    d.className = 'user-item' + (isMe ? ' me' : '');
    d.innerHTML = '<div class="uav">' + (u.avatar || '🙂') + '</div>' +
                  '<div><div class="uname">' + escapeHtml(u.name || '—') + (isMe ? ' (Anda)' : '') + '</div></div>' +
                  '<div class="ustat">' + (online ? '🟢 Online' : '⚪ ' + timeAgo(u.lastSeen)) + '</div>';
    if (!isMe) d.onclick = () => { setPMTarget(u); $('usersModal').classList.add('hidden'); };
    list.appendChild(d);
  });
  if (!sorted.length) list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:10px;">Tiada pengguna lain</div>';
}
function timeAgo(ts) {
  if (!ts) return 'lama';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'baru';
  if (m < 60) return m + 'm lalu';
  const h = Math.floor(m / 60); if (h < 24) return h + 'j lalu';
  return Math.floor(h / 24) + 'h lalu';
}

// ===================== ADMIN SETTINGS MODAL =====================
let pendingTheme = null;
let pendingPM = null;
function openSettingsModal() {
  const modal = $('settingsModal');
  pendingTheme = settings.theme || 'aurora';
  pendingPM = !!settings.pmEnabled;
  // mark theme
  document.querySelectorAll('#themeGrid .theme-pick').forEach(p => {
    p.classList.toggle('selected', p.dataset.theme === pendingTheme);
    p.onclick = () => {
      pendingTheme = p.dataset.theme;
      document.querySelectorAll('#themeGrid .theme-pick').forEach(x => x.classList.remove('selected'));
      p.classList.add('selected');
    };
  });
  const sw = $('pmSwitch');
  sw.classList.toggle('on', pendingPM);
  sw.onclick = () => { pendingPM = !pendingPM; sw.classList.toggle('on', pendingPM); };
  $('settingsPwd').value = '';
  $('settingsErr').textContent = '';
  modal.classList.remove('hidden');
  $('settingsCancel').onclick = () => modal.classList.add('hidden');
  modal.querySelector('.admin-backdrop').onclick = () => modal.classList.add('hidden');
  const testBtn = $('settingsTest');
  if (testBtn) testBtn.onclick = runSettingsDebugTest;
  $('settingsSave').onclick = async () => {
    const p = $('settingsPwd').value;
    if (!p) { $('settingsErr').textContent = 'Sila masukkan kata laluan admin.'; return; }
    $('settingsSave').disabled = true;
    try {
      const res = await api('setSettings', { password: p, theme: pendingTheme, pmEnabled: pendingPM });
      if (res.ok) {
        applySettings(res.settings || { theme: pendingTheme, pmEnabled: pendingPM });
        modal.classList.add('hidden');
        showToast('✅ Tetapan disimpan');
      } else if (res.error && /Unknown action/i.test(res.error)) {
        $('settingsErr').innerHTML = '⚠️ Apps Script anda masih versi lama.<br>Sila buka script.google.com → <b>Deploy</b> → <b>Manage deployments</b> → ✏️ Edit → Version: <b>New version</b> → Deploy. Kemudian cuba semula.';
      } else {
        $('settingsErr').textContent = '❌ ' + (res.error || 'Gagal');
      }
    } catch (e) { $('settingsErr').textContent = '❌ Ralat rangkaian: ' + (e.message || e); }
    finally { $('settingsSave').disabled = false; }
  };
}

async function runSettingsDebugTest() {
  const p = $('settingsPwd').value;
  const box = $('settingsDebug');
  if (!p) { $('settingsErr').textContent = 'Masukkan kata laluan admin dahulu untuk run test.'; return; }
  $('settingsErr').textContent = '';
  box.classList.remove('hidden');
  box.textContent = '⏳ Menjalankan test backend...';
  try {
    const res = await api('debug', { password: p });
    box.textContent = JSON.stringify(res, null, 2);
    if (!res.ok && res.error && /Unknown action/i.test(res.error)) {
      $('settingsErr').innerHTML = '⚠️ Backend masih versi lama. Tampal Code.gs terbaru, Save, kemudian Deploy → Manage deployments → ✏️ → Version: <b>New version</b> → Deploy.';
    }
  } catch (e) {
    box.textContent = '❌ ' + (e.message || e);
  }
}

// ===================== VOICE MESSAGE (mic) =====================
async function toggleMicRecord() {
  // Gesture-safe: panggil getUserMedia terus tanpa await sebelumnya
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording(true);
    return;
  }
  if (!window.isSecureContext) {
    showToast('Mic perlukan HTTPS. Buka tapak ini melalui https://', 4000); return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Browser tidak sokong rakaman audio. Cuba Chrome/Safari terkini.', 4000); return;
  }
  if (!window.MediaRecorder) {
    showToast('MediaRecorder tidak disokong di browser ini.', 4000); return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const name = e && e.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      showToast('🎤 Akses mic ditolak. Benarkan mic dalam tetapan browser.', 4500);
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      showToast('🎤 Tiada mikrofon dijumpai pada peranti ini.', 4500);
    } else if (name === 'NotReadableError') {
      showToast('🎤 Mic sedang digunakan oleh app lain.', 4500);
    } else {
      showToast('🎤 Ralat mic: ' + (e.message || name || e), 4500);
    }
    return;
  }
  recStream = stream;
  recChunks = [];
  const mimeOpts = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg',''];
  let chosenMime = '';
  for (const m of mimeOpts) {
    try { if (!m || MediaRecorder.isTypeSupported(m)) { chosenMime = m; break; } } catch(_) {}
  }
  try {
    mediaRecorder = chosenMime ? new MediaRecorder(recStream, { mimeType: chosenMime }) : new MediaRecorder(recStream);
  } catch (e) { showToast('Tidak boleh mula merakam: ' + e.message, 3500); cleanupRec(); return; }
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  mediaRecorder.onstop = onRecStop;
  mediaRecorder.onerror = (e) => { showToast('Ralat rakaman: ' + (e.error && e.error.message || ''), 3500); cleanupRec(); };
  try { mediaRecorder.start(250); } catch(_) { mediaRecorder.start(); }
  recStartedAt = Date.now();
  $('btnMic').classList.add('recording');
  $('recOverlay').classList.add('show');
  $('recStop').onclick = () => stopRecording(true);
  $('recCancel').onclick = () => stopRecording(false);
  recTimerId = setInterval(() => {
    const s = Math.floor((Date.now() - recStartedAt) / 1000);
    $('recTimer').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    if (s >= 120) stopRecording(true); // max 2 min
  }, 250);
}
let _recSend = true;
function stopRecording(send) {
  _recSend = send;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch(_) {}
  }
}
async function onRecStop() {
  const send = _recSend;
  const mime = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
  const blob = new Blob(recChunks, { type: mime });
  cleanupRec();
  if (!send || blob.size < 500) { showToast('Rakaman dibatalkan'); return; }
  const ext = mime.indexOf('mp4') >= 0 ? 'm4a' : mime.indexOf('ogg') >= 0 ? 'ogg' : 'webm';
  const f = new File([blob], 'voice-' + Date.now() + '.' + ext, { type: mime });
  handleFile(f);
}
function cleanupRec() {
  $('btnMic').classList.remove('recording');
  $('recOverlay').classList.remove('show');
  if (recTimerId) { clearInterval(recTimerId); recTimerId = null; }
  if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
  mediaRecorder = null; recChunks = [];
}
