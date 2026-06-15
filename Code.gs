/**
 * LOVE MY FAMILY - Backend (Google Apps Script)
 * Storage: Google Sheets + Google Drive
 *
 * SETUP:
 * 1. Buka https://script.google.com -> New Project
 * 2. Paste fail ini, simpan
 * 3. Deploy -> New Deployment -> Type: Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy URL Web App dan paste ke dalam app.js (API_URL)
 * 5. Pastikan akaun anda ada akses pada Sheet & Folder di bawah.
 */

const SHEET_ID  = '1ZVuobkfCX2AYM6aN6oPRFO8-gd95dQevYs7ngLkZsZY';
const FOLDER_ID = '1XHJqxu6G-5QzBguVutpKR8QU--w8uBSn';
const ADMIN_PASSWORD = '101010';

const SHEET_MESSAGES = 'Messages';
const SHEET_USERS    = 'Users';

// ===================== ENTRY POINTS =====================

function doGet(e) {
  return handle(e, (e.parameter && e.parameter.action) || 'fetch', e.parameter || {});
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (_) {}
  return handle(e, body.action || 'send', body);
}

function handle(e, action, data) {
  try {
    ensureSheets();
    let out;
    switch (action) {
      case 'fetch':    out = fetchMessages(Number(data.since) || 0); break;
      case 'send':     out = sendMessage(data); break;
      case 'upload':   out = uploadFile(data); break;
      case 'register': out = registerUser(data); break;
      case 'users':    out = listUsers(); break;
      case 'clear':    out = clearAll(data.password); break;
      case 'ping':     out = { ok: true, time: Date.now() }; break;
      default:         out = { ok: false, error: 'Unknown action: ' + action };
    }
    return json(out, e);
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, e);
  }
}

// ===================== HANDLERS =====================

function fetchMessages(since) {
  const sh = sheet(SHEET_MESSAGES);
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, messages: [], serverTime: Date.now() };
  const values = sh.getRange(2, 1, last - 1, 9).getValues();
  const msgs = values
    .map(r => ({
      id: r[0], ts: Number(r[1]) || 0, userId: r[2], name: r[3],
      avatar: r[4], type: r[5] || 'text', content: r[6] || '',
      fileUrl: r[7] || '', fileName: r[8] || ''
    }))
    .filter(m => m.ts > since);
  return { ok: true, messages: msgs, serverTime: Date.now() };
}

function sendMessage(data) {
  const sh = sheet(SHEET_MESSAGES);
  const ts = Date.now();
  const id = 'm_' + ts + '_' + Math.random().toString(36).slice(2, 8);
  sh.appendRow([
    id, ts, String(data.userId || ''), String(data.name || 'Anon'),
    String(data.avatar || '🙂'), String(data.type || 'text'),
    String(data.content || ''), String(data.fileUrl || ''), String(data.fileName || '')
  ]);
  touchUser(data.userId, data.name, data.avatar);
  return { ok: true, id: id, ts: ts };
}

function uploadFile(data) {
  if (!data.base64) return { ok: false, error: 'Tiada data fail' };
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const bytes = Utilities.base64Decode(data.base64);
  const blob = Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', data.fileName || 'file');
  const file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (_) {}
  const id = file.getId();
  const mime = file.getMimeType();
  const url = mime.indexOf('image/') === 0
    ? 'https://lh3.googleusercontent.com/d/' + id
    : 'https://drive.google.com/uc?export=view&id=' + id;
  const view = 'https://drive.google.com/file/d/' + id + '/view';
  return { ok: true, id: id, url: url, view: view, mimeType: mime, fileName: file.getName(), size: file.getSize() };
}

function registerUser(data) {
  touchUser(data.userId, data.name, data.avatar, true);
  return { ok: true };
}

function listUsers() {
  const sh = sheet(SHEET_USERS);
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, users: [] };
  const v = sh.getRange(2, 1, last - 1, 5).getValues();
  return { ok: true, users: v.map(r => ({ userId: r[0], name: r[1], avatar: r[2], joined: r[3], lastSeen: r[4] })) };
}

function clearAll(password) {
  if (String(password) !== ADMIN_PASSWORD) return { ok: false, error: 'Kata laluan admin salah' };
  const sh = sheet(SHEET_MESSAGES);
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
  return { ok: true, cleared: true };
}

// ===================== HELPERS =====================

function touchUser(userId, name, avatar, isNew) {
  if (!userId) return;
  const sh = sheet(SHEET_USERS);
  const last = sh.getLastRow();
  const now = Date.now();
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(userId)) {
        sh.getRange(i + 2, 2).setValue(name || '');
        sh.getRange(i + 2, 3).setValue(avatar || '');
        sh.getRange(i + 2, 5).setValue(now);
        return;
      }
    }
  }
  sh.appendRow([String(userId), String(name || ''), String(avatar || ''), now, now]);
}

function ensureSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let m = ss.getSheetByName(SHEET_MESSAGES);
  if (!m) {
    m = ss.insertSheet(SHEET_MESSAGES);
    m.appendRow(['id', 'timestamp', 'userId', 'name', 'avatar', 'type', 'content', 'fileUrl', 'fileName']);
    m.setFrozenRows(1);
  }
  let u = ss.getSheetByName(SHEET_USERS);
  if (!u) {
    u = ss.insertSheet(SHEET_USERS);
    u.appendRow(['userId', 'name', 'avatar', 'joined', 'lastSeen']);
    u.setFrozenRows(1);
  }
}

function sheet(name) { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name); }

function json(obj, e) {
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
