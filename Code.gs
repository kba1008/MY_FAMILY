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
 *
 * Versi: v5 (debug test, setting admin, audio playback fix)
 */

const SHEET_ID  = '1ZVuobkfCX2AYM6aN6oPRFO8-gd95dQevYs7ngLkZsZY';
const FOLDER_ID = '1XHJqxu6G-5QzBguVutpKR8QU--w8uBSn';
const ADMIN_PASSWORD = '101010';
const APP_VERSION = 'LMF-v5-debug-settings-audio';

const SHEET_MESSAGES = 'Messages';
const SHEET_USERS    = 'Users';
const SHEET_SETTINGS = 'Settings';

// ===================== RUN TEST DI APPS SCRIPT =====================
// Cara guna: pilih function ini di dropdown Apps Script, tekan Run, kemudian buka Execution log.
function RUN_TEST_BACKEND() {
  return runAndLog_('RUN_TEST_BACKEND', function () {
    ensureSheets();
    return debugBackend(ADMIN_PASSWORD);
  });
}

function RUN_TEST_SAVE_SETTINGS_ON() {
  return runAndLog_('RUN_TEST_SAVE_SETTINGS_ON', function () {
    ensureSheets();
    return setSettings({ password: ADMIN_PASSWORD, pmEnabled: true, theme: 'emerald' });
  });
}

function RUN_TEST_SAVE_SETTINGS_OFF() {
  return runAndLog_('RUN_TEST_SAVE_SETTINGS_OFF', function () {
    ensureSheets();
    return setSettings({ password: ADMIN_PASSWORD, pmEnabled: false, theme: 'aurora' });
  });
}

function runAndLog_(label, fn) {
  try {
    const out = fn();
    Logger.log(label + ' ✅ SUCCESS');
    Logger.log(JSON.stringify(out, null, 2));
    return out;
  } catch (err) {
    const out = {
      ok: false,
      test: label,
      error: String(err && err.message || err),
      stack: String(err && err.stack || '')
    };
    Logger.log(label + ' ❌ ERROR');
    Logger.log(JSON.stringify(out, null, 2));
    return out;
  }
}

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
      case 'fetch':       out = fetchMessages(Number(data.since) || 0, String(data.userId || '')); break;
      case 'send':        out = sendMessage(data); break;
      case 'upload':      out = uploadFile(data); break;
      case 'file':        out = getFileData(data); break;
      case 'register':    out = registerUser(data); break;
      case 'users':       out = listUsers(); break;
      case 'clear':       out = clearAll(data.password); break;
      case 'getSettings': out = { ok: true, settings: getSettings() }; break;
      case 'setSettings': out = setSettings(data); break;
      case 'debug':       out = debugBackend(data.password); break;
      case 'ping':        out = { ok: true, time: Date.now() }; break;
      default:            out = { ok: false, error: 'Unknown action: ' + action, version: APP_VERSION };
    }
    return json(out, e);
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err), action: action, version: APP_VERSION }, e);
  }
}

// ===================== HANDLERS =====================

function fetchMessages(since, viewerId) {
  const sh = sheet(SHEET_MESSAGES);
  const last = sh.getLastRow();
  const settings = getSettings();
  if (last < 2) return { ok: true, messages: [], serverTime: Date.now(), settings: settings };
  const values = sh.getRange(2, 1, last - 1, 10).getValues();
  const msgs = values
    .map(r => ({
      id: r[0], ts: Number(r[1]) || 0, userId: r[2], name: r[3],
      avatar: r[4], type: r[5] || 'text', content: r[6] || '',
      fileUrl: r[7] || '', fileName: r[8] || '',
      toUserId: r[9] || ''
    }))
    .filter(m => {
      if (m.ts <= since) return false;
      if (!m.toUserId) return true; // public
      // PM: hanya pengirim atau penerima boleh nampak
      return viewerId && (m.userId === viewerId || m.toUserId === viewerId);
    });
  return { ok: true, messages: msgs, serverTime: Date.now(), settings: settings };
}

function sendMessage(data) {
  const sh = sheet(SHEET_MESSAGES);
  const ts = Date.now();
  const id = 'm_' + ts + '_' + Math.random().toString(36).slice(2, 8);
  const toUserId = String(data.toUserId || '');
  // Jika PM dihantar tetapi feature PM dimatikan, tolak
  if (toUserId) {
    const s = getSettings();
    if (!s.pmEnabled) return { ok: false, error: 'PM peribadi sedang dimatikan oleh admin.' };
  }
  sh.appendRow([
    id, ts, String(data.userId || ''), String(data.name || 'Anon'),
    String(data.avatar || '🙂'), String(data.type || 'text'),
    String(data.content || ''), String(data.fileUrl || ''), String(data.fileName || ''),
    toUserId
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

function getFileData(data) {
  data = data || {};
  const id = String(data.fileId || extractDriveId_(data.url || '') || '');
  if (!id) return { ok: false, error: 'File ID tidak dijumpai' };
  const file = DriveApp.getFileById(id);
  const blob = file.getBlob();
  return {
    ok: true,
    id: id,
    fileName: file.getName(),
    mimeType: blob.getContentType() || file.getMimeType() || 'application/octet-stream',
    base64: Utilities.base64Encode(blob.getBytes()),
    version: APP_VERSION
  };
}

function extractDriveId_(url) {
  url = String(url || '');
  let m = url.match(/[?&]id=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  m = url.match(/\/d\/([^/]+)/);
  if (m) return decodeURIComponent(m[1]);
  return '';
}

function debugBackend(password) {
  if (String(password) !== ADMIN_PASSWORD) return { ok: false, error: 'Kata laluan admin salah' };
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const names = ss.getSheets().map(s => s.getName());
  const settingsBefore = getSettings();
  const saved = setSettings({ password: ADMIN_PASSWORD, pmEnabled: settingsBefore.pmEnabled, theme: settingsBefore.theme });
  return {
    ok: true,
    version: APP_VERSION,
    time: new Date().toISOString(),
    spreadsheetName: ss.getName(),
    folderName: folder.getName(),
    sheets: names,
    messagesColumns: sheet(SHEET_MESSAGES).getLastColumn(),
    settingsBefore: settingsBefore,
    saveSettingsTest: saved,
    availableActions: ['fetch','send','upload','file','register','users','clear','getSettings','setSettings','debug','ping'],
    note: 'Jika test ini berjaya tetapi app masih Unknown action, Web App belum redeploy New version.'
  };
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

// ===================== SETTINGS =====================

function getSettings() {
  const sh = sheet(SHEET_SETTINGS);
  const last = sh.getLastRow();
  const out = { pmEnabled: false, theme: 'aurora' };
  if (last >= 2) {
    const v = sh.getRange(2, 1, last - 1, 2).getValues();
    v.forEach(r => {
      const k = String(r[0] || '').trim();
      const val = String(r[1] || '');
      if (k === 'pmEnabled') out.pmEnabled = (val === 'true' || val === '1');
      else if (k === 'theme') out.theme = val || 'aurora';
    });
  }
  return out;
}

function setSettings(data) {
  data = data || {};
  if (String(data.password) !== ADMIN_PASSWORD) return { ok: false, error: 'Kata laluan admin salah' };
  ensureSheets();
  const sh = sheet(SHEET_SETTINGS);
  if (!sh) return { ok: false, error: 'Sheet Settings tidak dijumpai / tidak boleh dibuka' };
  const updates = {};
  if (typeof data.pmEnabled !== 'undefined') updates.pmEnabled = data.pmEnabled ? 'true' : 'false';
  if (typeof data.theme !== 'undefined' && data.theme) {
    const theme = String(data.theme);
    const allowed = ['aurora','rose','emerald','sunset','midnight'];
    if (allowed.indexOf(theme) === -1) return { ok: false, error: 'Tema tidak sah: ' + theme };
    updates.theme = theme;
  }
  if (!Object.keys(updates).length) return { ok: false, error: 'Tiada tetapan untuk disimpan' };
  const last = sh.getLastRow();
  const existing = {};
  if (last >= 2) {
    const v = sh.getRange(2, 1, last - 1, 2).getValues();
    v.forEach((r, i) => { existing[String(r[0] || '').trim()] = i + 2; });
  }
  Object.keys(updates).forEach(k => {
    if (existing[k]) sh.getRange(existing[k], 2).setValue(updates[k]);
    else sh.appendRow([k, updates[k]]);
  });
  SpreadsheetApp.flush();
  return { ok: true, settings: getSettings(), version: APP_VERSION };
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
    m.appendRow(['id', 'timestamp', 'userId', 'name', 'avatar', 'type', 'content', 'fileUrl', 'fileName', 'toUserId']);
    m.setFrozenRows(1);
  } else if (m.getLastColumn() < 10) {
    // upgrade: add toUserId column
    m.getRange(1, 10).setValue('toUserId');
  }
  let u = ss.getSheetByName(SHEET_USERS);
  if (!u) {
    u = ss.insertSheet(SHEET_USERS);
    u.appendRow(['userId', 'name', 'avatar', 'joined', 'lastSeen']);
    u.setFrozenRows(1);
  }
  let s = ss.getSheetByName(SHEET_SETTINGS);
  if (!s) {
    s = ss.insertSheet(SHEET_SETTINGS);
    s.appendRow(['key', 'value']);
    s.setFrozenRows(1);
    s.appendRow(['pmEnabled', 'false']);
    s.appendRow(['theme', 'aurora']);
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
