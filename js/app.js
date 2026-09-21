/* ─── LLM Chat — 纯静态版 v2 ────────────────────────────────── */

// ─── Constants ───────────────────────────────────────────────────

const DEFAULT_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.1-pro',
  'gpt-5.6-sol',
  'claude-opus-5',
];

const MAX_PENDING_IMAGES = 15;

const LS = {
  settings: 'llm_chat_settings',
  convos: 'llm_chat_convos',       // 会话索引（不含 messages，轻量）
  convoPrefix: 'llm_chat_convo_',  // 旧版兼容/迁移时使用的会话 key
  current: 'llm_chat_current',
};

const IDB = {
  name: 'llm-chat-db',
  version: 1,
  metaStore: 'meta',
  convoStore: 'conversations',
  messageStore: 'messages',
  migrationKey: 'legacy-localstorage-migrated',
};

// ─── State ──────────────────────────────────────────────────────

const state = {
  conversations: [],
  currentConvoId: null,
  currentMessages: [],
  pendingImages: [],
  pendingFiles: [],
  isStreaming: false,
  abortController: null,
  editingGroupId: null,
  editingConvoGroupId: null,
  editingModelIdx: -1,
  userScrollAway: false,
  convoSelectionToken: 0,
  renderedMessageStart: 0,
  isProgrammaticScrolling: false,
};

var convoDb = null;
var convoStorageMode = 'localStorage';
var convoDbWriteQueue = Promise.resolve();
var convoDbErrorWarned = false;

// ─── DOM ────────────────────────────────────────────────────────

const $ = function (s) { return document.querySelector(s); };

const dom = {
  sidebar: $('#sidebar'),
  sidebarToggle: $('#sidebarToggle'),
  conversationList: $('#conversationList'),
  btnNewChat: $('#btnNewChat'),
  btnSettings: $('#btnSettings'),
  btnExportMd: $('#btnExportMd'),
  btnExportJson: $('#btnExportJson'),
  btnImportJson: $('#btnImportJson'),
  importJsonInput: $('#importJsonInput'),
  conversationTitle: $('#conversationTitle'),
  btnRenameConvo: $('#btnRenameConvo'),
  modelSelector: $('#modelSelector'),
  modelInput: $('#modelInput'),
  modelDropdownArrow: $('#modelDropdownArrow'),
  modelDropdown: $('#modelDropdown'),
  messagesContainer: $('#messagesContainer'),
  chatOutline: $('#chatOutline'),
  chatOutlineHead: $('#chatOutlineHead'),
  chatOutlineList: $('#chatOutlineList'),
  welcomeScreen: $('#welcomeScreen'),
  welcomeTitle: $('#welcomeTitle'),
  welcomeSub: $('#welcomeSub'),
  messageInput: $('#messageInput'),
  btnSend: $('#btnSend'),
  btnFileUpload: $('#btnFileUpload'),
  fileInput: $('#fileInput'),
  attachmentPreviews: $('#attachmentPreviews'),
  groupSelector: $('#groupSelector'),
  groupSelectorBtn: $('#groupSelectorBtn'),
  groupSelectorLabel: $('#groupSelectorLabel'),
  groupDropdown: $('#groupDropdown'),
  settingsOverlay: $('#settingsOverlay'),
  btnSettingsClose: $('#btnSettingsClose'),
  btnSettingsCancel: $('#btnSettingsCancel'),
  btnSettingsSave: $('#btnSettingsSave'),
  groupTabs: $('#groupTabs'),
  btnAddGroup: $('#btnAddGroup'),
  settingGroupName: $('#settingGroupName'),
  settingGroupBase: $('#settingGroupBase'),
  settingGroupProtocol: $('#settingGroupProtocol'),
  settingGroupKey: $('#settingGroupKey'),
  modelEditList: $('#modelEditList'),
  settingModelInput: $('#settingModelInput'),
  btnAddModel: $('#btnAddModel'),
  convoGroupTabs: $('#convoGroupTabs'),
  btnAddConvoGroup: $('#btnAddConvoGroup'),
  settingConvoGroupName: $('#settingConvoGroupName'),
  settingConvoGroupPrompt: $('#settingConvoGroupPrompt'),
  btnDeleteConvoGroup: $('#btnDeleteConvoGroup'),
  settingFontSize: $('#settingFontSize'),
  settingShowThinking: $('#settingShowThinking'),
  btnExportSettingsJson: $('#btnExportSettingsJson'),
  btnCopySettingsJson: $('#btnCopySettingsJson'),
  settingExportIncludeKey: $('#settingExportIncludeKey'),
  importSettingsMode: $('#importSettingsMode'),
  btnSelectSettingsFile: $('#btnSelectSettingsFile'),
  importSettingsFileInput: $('#importSettingsFileInput'),
  importSettingsText: $('#importSettingsText'),
  btnApplyImportSettingsText: $('#btnApplyImportSettingsText'),
  btnQuickExportSettings: $('#btnQuickExportSettings'),
  btnQuickImportSettings: $('#btnQuickImportSettings'),
  imageOverlay: $('#imageOverlay'),
  imageOverlayImg: $('#imageOverlayImg'),
  btnImageOverlayClose: $('#btnImageOverlayClose'),
  deleteConfirmOverlay: $('#deleteConfirmOverlay'),
  deleteConfirmText: $('#deleteConfirmText'),
  btnDeleteConfirmClose: $('#btnDeleteConfirmClose'),
  btnDeleteConfirmCancel: $('#btnDeleteConfirmCancel'),
  btnDeleteConfirmOk: $('#btnDeleteConfirmOk'),
  pdfViewerOverlay: $('#pdfViewerOverlay'),
  pdfViewerTitle: $('#pdfViewerTitle'),
  pdfViewerPageBadge: $('#pdfViewerPageBadge'),
  pdfViewerImg: $('#pdfViewerImg'),
  pdfViewerThumbnails: $('#pdfViewerThumbnails'),
  btnPdfViewerPrev: $('#btnPdfViewerPrev'),
  btnPdfViewerNext: $('#btnPdfViewerNext'),
  btnPdfViewerClose: $('#btnPdfViewerClose'),
  renameConvoOverlay: $('#renameConvoOverlay'),
  renameConvoInput: $('#renameConvoInput'),
  btnRenameConvoClose: $('#btnRenameConvoClose'),
  btnRenameConvoCancel: $('#btnRenameConvoCancel'),
  btnRenameConvoSave: $('#btnRenameConvoSave'),
  toastContainer: $('#toastContainer'),
};

// ─── localStorage ───────────────────────────────────────────────

function load(k, fallback) {
  try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
// 返回是否写盘成功：配额满时 localStorage.setItem 抛异常，调用方据此提示，避免静默丢数据
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { return false; }
}

function getSettings() {
  var raw = load(LS.settings, null);
  var s = normalizeSettings(raw);
  var rawStr = raw ? JSON.stringify(raw) : '';
  var sStr = JSON.stringify(s);
  if (rawStr !== sStr) save(LS.settings, s);
  return s;
}
function setSettings(s) { save(LS.settings, s); }

function convoKey(id) { return LS.convoPrefix + id; }

// ─── IndexedDB conversation storage ────────────────────────────

function idbRequest(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error || new Error('IndexedDB request failed')); };
  });
}

function openConvoDb() {
  if (!window.indexedDB) return Promise.reject(new Error('IndexedDB unavailable'));
  return new Promise(function (resolve, reject) {
    var request;
    try { request = window.indexedDB.open(IDB.name, IDB.version); }
    catch (e) { reject(e); return; }
    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains(IDB.metaStore)) {
        db.createObjectStore(IDB.metaStore, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(IDB.convoStore)) {
        db.createObjectStore(IDB.convoStore, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IDB.messageStore)) {
        var messageStore = db.createObjectStore(IDB.messageStore, { keyPath: 'key' });
        messageStore.createIndex('conversationId', 'conversationId', { unique: false });
      }
    };
    request.onsuccess = function () {
      var db = request.result;
      db.onversionchange = function () { db.close(); };
      resolve(db);
    };
    request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
    request.onblocked = function () { reject(new Error('IndexedDB open blocked')); };
  });
}

function idbGet(storeName, key) {
  var tx = convoDb.transaction(storeName, 'readonly');
  return idbRequest(tx.objectStore(storeName).get(key));
}

function idbGetAll(storeName) {
  var tx = convoDb.transaction(storeName, 'readonly');
  return idbRequest(tx.objectStore(storeName).getAll());
}

function idbPut(storeName, value) {
  var tx = convoDb.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return new Promise(function (resolve, reject) {
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error || new Error('IndexedDB write failed')); };
    tx.onabort = function () { reject(tx.error || new Error('IndexedDB write aborted')); };
  });
}

function idbDeleteConversation(id) {
  var tx = convoDb.transaction([IDB.convoStore, IDB.messageStore], 'readwrite');
  var convoStore = tx.objectStore(IDB.convoStore);
  var messageStore = tx.objectStore(IDB.messageStore);
  convoStore.delete(id);
  var keyRequest = messageStore.index('conversationId').getAllKeys(IDBKeyRange.only(id));
  keyRequest.onsuccess = function () {
    keyRequest.result.forEach(function (key) { messageStore.delete(key); });
  };
  return new Promise(function (resolve, reject) {
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error || new Error('IndexedDB delete failed')); };
    tx.onabort = function () { reject(tx.error || new Error('IndexedDB delete aborted')); };
  });
}

function idbPutConvoMetadata(c, order) {
  // Only persist known serializable conversation fields. This also protects
  // against DOM events accidentally passed through a click handler.
  var metadata = {};
  var fields = ['id', 'title', 'model', 'groupId', 'createdAt', 'updatedAt', 'messageCount', 'lastMessage', 'titleCustom', 'parentId', 'branchMessageIndex'];
  fields.forEach(function (k) {
    if (k === 'groupId' && c[k] !== undefined && typeof c[k] !== 'string') return;
    if (c[k] !== undefined) metadata[k] = c[k];
  });
  if (typeof order === 'number') metadata.listOrder = order;
  return idbPut(IDB.convoStore, metadata);
}

function idbLoadMessages(id) {
  var tx = convoDb.transaction(IDB.messageStore, 'readonly');
  var request = tx.objectStore(IDB.messageStore).index('conversationId').getAll(IDBKeyRange.only(id));
  return idbRequest(request).then(function (rows) {
    rows.sort(function (a, b) { return a.messageIndex - b.messageIndex; });
    return rows.map(function (row) { return row.message; });
  });
}

function serializeMessageForStorage(m) {
  if (!m || typeof m !== 'object') return m;
  var out = {};
  for (var k in m) {
    // 过滤掉 DOM 节点引用和前端易挥发的运行时私有缓存字段，防止 IndexedDB 结构化克隆报 DataCloneError
    if (k.indexOf('_cached') === 0) continue;
    if (typeof Node !== 'undefined' && m[k] instanceof Node) continue;
    if (typeof m[k] === 'function') continue;
    out[k] = m[k];
  }
  return out;
}

function idbReplaceMessages(id, messages) {
  var tx = convoDb.transaction(IDB.messageStore, 'readwrite');
  var store = tx.objectStore(IDB.messageStore);
  var keyRequest = store.index('conversationId').getAllKeys(IDBKeyRange.only(id));
  keyRequest.onsuccess = function () {
    keyRequest.result.forEach(function (key) { store.delete(key); });
    messages.forEach(function (message, index) {
      store.put({
        key: id + '\u0000' + index,
        conversationId: id,
        messageIndex: index,
        message: serializeMessageForStorage(message)
      });
    });
  };
  return new Promise(function (resolve, reject) {
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error || new Error('IndexedDB message write failed')); };
    tx.onabort = function () { reject(tx.error || new Error('IndexedDB message write aborted')); };
  });
}

function persistConversation(c, order) {
  if (convoStorageMode === 'indexeddb' && convoDb) {
    return enqueueConvoDbWrite(function () {
      var jobs = [idbPutConvoMetadata(c, order)];
      if (Array.isArray(c.messages)) jobs.push(idbReplaceMessages(c.id, c.messages));
      return Promise.all(jobs);
    });
  }
  var cleanC = {};
  for (var k in c) {
    if (k === 'messages' && Array.isArray(c.messages)) {
      cleanC.messages = c.messages.map(serializeMessageForStorage);
    } else {
      cleanC[k] = c[k];
    }
  }
  return Promise.resolve(save(convoKey(c.id), cleanC));
}

function persistConversationMetadata(c, order) {
  if (convoStorageMode === 'indexeddb' && convoDb) {
    return enqueueConvoDbWrite(function () { return idbPutConvoMetadata(c, order); });
  }
  saveConvos();
  return Promise.resolve(true);
}

function enqueueConvoDbWrite(job) {
  var run = convoDbWriteQueue.then(job, job);
  convoDbWriteQueue = run.catch(function () {});
  return run;
}

function legacyConversationsForMigration() {
  var arr = load(LS.convos, []);
  if (!Array.isArray(arr)) return [];
  return arr.map(function (source) {
    var c = {};
    for (var k in source) c[k] = source[k];
    if (!Array.isArray(c.messages)) {
      var stored = load(convoKey(c.id), null);
      c.messages = stored && Array.isArray(stored.messages) ? stored.messages : [];
    }
    return c;
  });
}

function clearLegacyConversationStorage(conversations) {
  localStorage.removeItem(LS.convos);
  conversations.forEach(function (c) { localStorage.removeItem(convoKey(c.id)); });
}

async function migrateLegacyConversations() {
  var legacy = legacyConversationsForMigration();
  // A failed first attempt may have left partial records. They are new-format
  // records only, so clearing them before retry is safe while the marker is unset.
  var oldMeta = convoDb.transaction(IDB.metaStore, 'readonly');
  var marker = await idbRequest(oldMeta.objectStore(IDB.metaStore).get(IDB.migrationKey));
  if (!marker || !marker.done) {
    var clearTx = convoDb.transaction([IDB.convoStore, IDB.messageStore], 'readwrite');
    clearTx.objectStore(IDB.convoStore).clear();
    clearTx.objectStore(IDB.messageStore).clear();
    await new Promise(function (resolve, reject) {
      clearTx.oncomplete = resolve;
      clearTx.onerror = function () { reject(clearTx.error || new Error('IndexedDB clear failed')); };
      clearTx.onabort = function () { reject(clearTx.error || new Error('IndexedDB clear aborted')); };
    });
    for (var i = 0; i < legacy.length; i++) {
      await idbPutConvoMetadata(legacy[i], i);
      await idbReplaceMessages(legacy[i].id, legacy[i].messages || []);
    }
    await idbPut(IDB.metaStore, { key: IDB.migrationKey, done: true });
    clearLegacyConversationStorage(legacy);
  }
}

async function initConversationStorage() {
  try {
    convoDb = await openConvoDb();
    await migrateLegacyConversations();
    convoStorageMode = 'indexeddb';
    return true;
  } catch (e) {
    convoStorageMode = 'localStorage';
    convoDb = null;
    console.warn('IndexedDB unavailable; using legacy localStorage conversation storage.', e);
    return false;
  }
}

function reportConvoDbError(e) {
  console.warn('IndexedDB conversation write failed.', e);
  if (!convoDbErrorWarned) {
    convoDbErrorWarned = true;
    showToast('本地历史保存失败，请尽快备份数据', 'error');
  }
}

// 读索引；检测到旧版全量单 key 格式时迁移：messages 拆到独立 key，索引只留元数据
function loadConvos() {
  var arr = load(LS.convos, []);
  if (!Array.isArray(arr)) return [];
  var needMigrate = false;
  for (var i = 0; i < arr.length; i++) {
    var c = arr[i];
    if (c && Array.isArray(c.messages)) {
      save(convoKey(c.id), { id: c.id, messages: c.messages });
      delete c.messages;
      needMigrate = true;
    }
  }
  if (needMigrate) save(LS.convos, arr);
  return arr;
}

// 索引只存元数据；内存中的 state.conversations 仍是完整会话（含 messages）。
// IndexedDB 模式下，消息由 messageStore 保存，索引只更新会话元数据。
function saveConvos() {
  if (convoStorageMode === 'indexeddb' && convoDb) {
    state.conversations.forEach(function (c, i) {
      enqueueConvoDbWrite(function () { return idbPutConvoMetadata(c, i); }).catch(reportConvoDbError);
    });
    return;
  }
  save(LS.convos, state.conversations.map(function (c) {
    var m = {};
    for (var k in c) { if (k !== 'messages') m[k] = c[k]; }
    return m;
  }));
}

// 懒加载：会话消息只在选中时从 IndexedDB（或旧版 localStorage）读入内存
async function ensureConvoLoaded(c) {
  if (!c.messages || !c.messages.length) {
    if (convoStorageMode === 'indexeddb' && convoDb) {
      c.messages = await idbLoadMessages(c.id);
    } else {
      var stored = load(convoKey(c.id), null);
      c.messages = (stored && Array.isArray(stored.messages)) ? stored.messages : [];
    }

    // 自动修复与容灾：若因历史保存异常导致分支会话消息丢失为空（但保留了 parentId 和 branchMessageIndex），
    // 自动从父会话恢复上下文并重新持久化，救回用户的分支对话数据
    if ((!c.messages || !c.messages.length) && c.parentId && typeof c.branchMessageIndex === 'number') {
      var parent = state.conversations.find(function (p) { return p.id === c.parentId; });
      if (parent) {
        var parentMsgs = await ensureConvoLoaded(parent);
        if (parentMsgs && parentMsgs.length > c.branchMessageIndex) {
          c.messages = parentMsgs.slice(0, c.branchMessageIndex + 1).map(function (m) {
            var copy = {};
            for (var k in m) {
              if (k.indexOf('_cached') === 0) continue;
              copy[k] = m[k];
            }
            if (Array.isArray(m.images)) copy.images = m.images.slice();
            if (Array.isArray(m.files)) copy.files = m.files.map(function (f) { var out = {}; for (var key in f) out[key] = f[key]; return out; });
            return copy;
          });
          c.messageCount = c.messages.filter(function (m) { return m.role !== 'break'; }).length;
          persistConversation(c, state.conversations.indexOf(c)).catch(function () {});
        }
      }
    }
  }
  return c.messages;
}

function dedupe(arr) { return arr.filter(function (v, i, a) { return a.indexOf(v) === i; }); }

function getGroupIn(s, id) { return (s.apiGroups || []).find(function (g) { return g.id === id; }); }
function getGroup(id) { return getGroupIn(getSettings(), id); }

function normalizeSettings(s) {
  if (s && !Array.isArray(s.apiGroups)) {
    // Legacy single-config format → migrate into one group
    var legacy = dedupe(DEFAULT_MODELS.concat(s.customModels || []));
    s = {
      apiGroups: [{
        id: uid(),
        name: '默认配置',
        apiBase: s.apiBase || 'https://api.openai.com/v1',
        apiProtocol: s.apiProtocol || 'auto',
        apiKey: s.apiKey || '',
        models: legacy
      }],
      activeGroupId: null,
      systemPrompt: s.systemPrompt || ''
    };
    s.activeGroupId = s.apiGroups[0].id;
  }
  if (!s || !s.apiGroups || !s.apiGroups.length) {
    var g0 = { id: uid(), name: '默认配置', apiBase: 'https://api.openai.com/v1', apiProtocol: 'auto', apiKey: '', models: DEFAULT_MODELS.slice() };
    s = { apiGroups: [g0], activeGroupId: g0.id, systemPrompt: '' };
  }
  s.apiGroups = s.apiGroups.map(function (g, i) {
    g.id = g.id || uid();
    g.name = g.name || ('配置组 ' + (i + 1));
    g.apiBase = g.apiBase || 'https://api.openai.com/v1';
    g.apiProtocol = g.apiProtocol || 'auto';
    g.apiKey = g.apiKey || '';
    var oldDefaultJson = JSON.stringify(['gpt-5.6-sol', 'claude-opus-5', 'claude-fable-5', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-lite', 'gemini-3.6-flash']);
    if (Array.isArray(g.models) && JSON.stringify(g.models) === oldDefaultJson) {
      g.models = DEFAULT_MODELS.slice();
    } else {
      g.models = Array.isArray(g.models) ? dedupe(g.models) : DEFAULT_MODELS.slice();
    }
    return g;
  });
  if (!getGroupIn(s, s.activeGroupId)) s.activeGroupId = s.apiGroups[0].id;
  // v3 迁移：全局系统提示词 → 「默认分组」，旧对话由 migrateLegacyConvoGroup 归入该组
  if (!Array.isArray(s.convoGroups)) s.convoGroups = [];
  if (!Array.isArray(s.collapsedConvoGroups)) s.collapsedConvoGroups = [];
  if ('systemPrompt' in s) {
    var legacyPrompt = s.systemPrompt || '';
    delete s.systemPrompt;
    if (legacyPrompt) {
      var dg = { id: uid(), name: '默认分组', systemPrompt: legacyPrompt };
      s.convoGroups.push(dg);
      s._legacyConvoGroupId = dg.id;
    }
  }
  s.convoGroups = s.convoGroups.map(function (g, i) {
    g.id = g.id || uid();
    g.name = g.name || ('分组 ' + (i + 1));
    g.systemPrompt = g.systemPrompt || '';
    return g;
  });
  s.appearance = Object.assign({ fontSize: 14 }, s.appearance || {});
  // 全局 API 跨域代理网关（空为自动按 PROXY_GATEWAYS 首选节点）
  s.proxyUrl = typeof s.proxyUrl === 'string' ? s.proxyUrl : '';
  if (s.proxyUrl.indexOf('yulucha.xyz') !== -1 || s.proxyUrl.indexOf('workers.dev') !== -1) {
    s.proxyUrl = '';
  }
  // 思维链默认关闭：仅状态栏橙色「思考中」，开启后才显示思考内容
  s.showThinking = !!s.showThinking;
  return s;
}

// 应用字体大小设置（CSS 变量驱动，实时生效）
function applyFontSize() {
  var px = parseInt((getSettings().appearance || {}).fontSize, 10) || 14;
  document.documentElement.style.setProperty('--msg-font-size', px + 'px');
}

function getActiveGroup() {
  var s = getSettings();
  return getGroupIn(s, s.activeGroupId) || s.apiGroups[0];
}

function getModels() { return getActiveGroup().models || []; }

// v3 一次性迁移：有全局系统提示词的旧对话归入「默认分组」，提示词不丢
function migrateLegacyConvoGroup() {
  var s = getSettings();
  if (!s._legacyConvoGroupId) return;
  var changed = false;
  state.conversations.forEach(function (c) {
    if (!c.groupId) { c.groupId = s._legacyConvoGroupId; changed = true; }
  });
  if (changed) saveConvos();
  delete s._legacyConvoGroupId;
  setSettings(s);
}

// ─── Helpers ────────────────────────────────────────────────────

function uid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
function getModel() { return dom.modelInput.value.trim() || DEFAULT_MODELS[0]; }
function showToast(msg, type) {
  var t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.textContent = msg;
  dom.toastContainer.appendChild(t);
  setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'all .3s'; setTimeout(function () { t.remove(); }, 300); }, 3000);
}
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function fmtTokens(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n); }

// ─── File and attachment helpers ───────────────────────────────
var MAX_FILE_SIZE = 60 * 1024 * 1024;
var MAX_PDF_RENDER_PAGES = 50;
var MAX_TOTAL_FILE_TEXT = 240000;
var TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|ts|jsx|tsx|py|java|c|h|cpp|hpp|cs|go|rs|php|rb|swift|kt|kts|sql|ya?ml|toml|ini|conf|log|rtf)$/i;
var ARCHIVE_EXTENSIONS = /\.(docx|xlsx|xlsm|pptx)$/i;
var LEGACY_BINARY_EXTENSIONS = /\.(doc|xls|ppt)$/i;

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function fileExtension(name) { var m = /\.([^.]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
function decodeUtf8(buffer) { return new TextDecoder('utf-8', { fatal: false }).decode(buffer); }
function clampFileText(text) {
  text = String(text || '').replace(/\u0000/g, '').trim();
  return text.length > MAX_TOTAL_FILE_TEXT ? text.slice(0, MAX_TOTAL_FILE_TEXT) + '\n[文件内容已截断]' : text;
}

async function unzipEntries(buffer) {
  var bytes = new Uint8Array(buffer), view = new DataView(buffer), start = Math.max(0, bytes.length - 65557), eocd = -1;
  for (var i = bytes.length - 22; i >= start; i--) { if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('不是有效的 Office 文档');
  var count = view.getUint16(eocd + 10, true), centralOffset = view.getUint32(eocd + 16, true), entries = {};
  for (var n = 0, pos = centralOffset; n < count; n++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    var method = view.getUint16(pos + 10, true), compSize = view.getUint32(pos + 20, true), nameLen = view.getUint16(pos + 28, true), extraLen = view.getUint16(pos + 30, true), commentLen = view.getUint16(pos + 32, true), localOffset = view.getUint32(pos + 42, true);
    var name = decodeUtf8(bytes.slice(pos + 46, pos + 46 + nameLen));
    var localNameLen = view.getUint16(localOffset + 26, true), localExtraLen = view.getUint16(localOffset + 28, true), dataStart = localOffset + 30 + localNameLen + localExtraLen;
    var compressed = bytes.slice(dataStart, dataStart + compSize), data;
    if (method === 0) data = compressed;
    else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      var ds = new DecompressionStream('deflate-raw');
      data = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(ds)).arrayBuffer());
    } else throw new Error('当前浏览器不支持该 Office 压缩格式');
    entries[name] = data;
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
function xmlText(xml) {
  try { return new DOMParser().parseFromString(xml, 'application/xml').documentElement.textContent || ''; }
  catch (e) { return xml.replace(/<[^>]+>/g, ' '); }
}
async function extractOfficeText(file, buffer) {
  var entries = await unzipEntries(buffer), ext = fileExtension(file.name), chunks = [];
  if (ext === 'docx') {
    chunks.push(xmlText(decodeUtf8(entries['word/document.xml'] || new Uint8Array())));
  } else if (ext === 'xlsx' || ext === 'xlsm') {
    var shared = entries['xl/sharedStrings.xml'] ? xmlText(decodeUtf8(entries['xl/sharedStrings.xml'])) : '';
    var sheetNames = Object.keys(entries).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/i.test(n); }).sort();
    sheetNames.forEach(function (n) { chunks.push(xmlText(decodeUtf8(entries[n]))); });
    if (shared) chunks.unshift('共享字符串\n' + shared);
  } else if (ext === 'pptx') {
    Object.keys(entries).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/i.test(n); }).sort().forEach(function (n) { chunks.push(xmlText(decodeUtf8(entries[n]))); });
  }
  return clampFileText(chunks.join('\n\n'));
}
var pdfJsPromise = null;
function ensurePdfJs() {
  if (typeof window !== 'undefined' && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfJsPromise) {
    pdfJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'js/vendor/pdfjs/pdf.min.js';
      s.onload = function () {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdfjs/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        } else {
          pdfJsPromise = null;
          reject(new Error('PDF.js 未正确初始化'));
        }
      };
      s.onerror = function () {
        // Fallback to CDN if local fails
        var cdn = document.createElement('script');
        cdn.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        cdn.onload = function () {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            resolve(window.pdfjsLib);
          } else {
            pdfJsPromise = null;
            reject(new Error('PDF 渲染组件初始化失败'));
          }
        };
        cdn.onerror = function () {
          pdfJsPromise = null;
          reject(new Error('PDF 渲染组件加载失败，请检查网络'));
        };
        document.head.appendChild(cdn);
      };
      document.head.appendChild(s);
    });
  }
  return pdfJsPromise;
}

// 阶梯式自适应画质配置：根据页数动态权衡最佳画质与数据体积
function getPdfRenderProfile(pagesCount) {
  if (pagesCount <= 8) {
    // 8 页以内（短篇论文、实验报告、快报）：极致超清，电路引脚与微小波形纤毫毕现
    return { targetWidth: 1600, quality: 0.88, maxScale: 2.8, label: '超清' };
  } else if (pagesCount <= 16) {
    // 9 ~ 16 页（常规会议/期刊全文）：高清呈现，兼顾极速与细节
    return { targetWidth: 1380, quality: 0.82, maxScale: 2.4, label: '高清' };
  } else if (pagesCount <= 30) {
    // 17 ~ 30 页（长篇文献/芯片数据手册）：均衡画质，严格控制总体积
    return { targetWidth: 1150, quality: 0.76, maxScale: 2.0, label: '均衡' };
  } else {
    // 31 ~ 50 页（超长技术规格书/白皮书）：轻量流畅，确保穿透网关与请求限制
    return { targetWidth: 960, quality: 0.70, maxScale: 1.8, label: '轻量' };
  }
}

// 纯前端将 PDF 分页光栅化为多模态大图（根据页数自适应阶梯分辨率与画质）
async function renderPdfToPageImages(file, buffer, onProgress) {
  var pdfjs = await ensurePdfJs();
  var loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
    cMapPacked: true
  });
  var pdf = await loadingTask.promise;
  var totalPages = pdf.numPages;
  var maxPagesToRender = Math.min(totalPages, MAX_PDF_RENDER_PAGES);
  var profile = getPdfRenderProfile(maxPagesToRender);
  var pages = [];
  var fullText = [];

  for (var i = 1; i <= maxPagesToRender; i++) {
    var page = await pdf.getPage(i);
    var viewport = page.getViewport({ scale: 1.0 });
    // 根据自适应画质配置动态计算最适合的 Canvas 缩放比
    var scale = Math.min(profile.maxScale, Math.max(0.85, profile.targetWidth / viewport.width));
    viewport = page.getViewport({ scale: scale });

    var canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    var dataUrl = canvas.toDataURL('image/jpeg', profile.quality);

    var pageText = '';
    try {
      var textContent = await page.getTextContent();
      pageText = textContent.items.map(function (item) { return item.str; }).join(' ').trim();
    } catch (_) {}

    pages.push({
      pageNumber: i,
      totalPages: totalPages,
      name: file.name + ' (第 ' + i + ' 页)',
      dataUrl: dataUrl,
      text: pageText
    });
    if (pageText) fullText.push('--- 第 ' + i + ' 页 ---\n' + pageText);
    if (typeof onProgress === 'function') onProgress(i, maxPagesToRender, totalPages);
  }

  // 若文档总页数超过光栅化上限，全量抽取后续页面的结构化文本，保证文献不遗漏任何正文内容
  if (totalPages > maxPagesToRender) {
    for (var j = maxPagesToRender + 1; j <= totalPages; j++) {
      try {
        var extraPage = await pdf.getPage(j);
        var extraTc = await extraPage.getTextContent();
        var extraPt = extraTc.items.map(function (item) { return item.str; }).join(' ').trim();
        if (extraPt) fullText.push('--- 第 ' + j + ' 页 ---\n' + extraPt);
      } catch (_) {}
    }
  }

  return {
    totalPages: totalPages,
    renderedPages: pages,
    extractedText: fullText.join('\n\n'),
    profileLabel: profile.label
  };
}

function extractLegacyOfficeText(buffer) {
  var bytes = new Uint8Array(buffer), out = [], ascii = '', utf16 = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i];
    if (b >= 32 && b < 127) ascii += String.fromCharCode(b); else { if (ascii.length >= 4) out.push(ascii); ascii = ''; }
    if (i + 1 < bytes.length && bytes[i + 1] === 0 && b >= 32 && b < 127) { utf16 += String.fromCharCode(b); i++; }
    else if (utf16.length && !(b >= 32 && b < 127)) { if (utf16.length >= 3) out.push(utf16); utf16 = ''; }
  }
  if (ascii.length >= 4) out.push(ascii);
  if (utf16.length >= 3) out.push(utf16);
  return clampFileText(out.join(' '));
}
function readFileBuffer(file) { return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = function () { reject(r.error || new Error('文件读取失败')); }; r.readAsArrayBuffer(file); }); }
function readFileDataUrl(file) { return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = function () { reject(r.error || new Error('文件读取失败')); }; r.readAsDataURL(file); }); }

async function parseAttachment(file) {
  var ext = fileExtension(file.name), buffer = await readFileBuffer(file), text = '';
  var mime = String(file.type || '');
  var isPdf = (ext === 'pdf' || mime === 'application/pdf');

  if (isPdf) {
    try {
      var pdfRes = await renderPdfToPageImages(file, buffer);
      return {
        name: file.name,
        type: 'application/pdf',
        size: file.size,
        text: pdfRes.extractedText || '',
        pageCount: pdfRes.totalPages,
        renderedPageCount: pdfRes.renderedPages ? pdfRes.renderedPages.length : 0,
        pages: pdfRes.renderedPages || [],
        profileLabel: pdfRes.profileLabel || '',
        isPdf: true
      };
    } catch (_) {
      text = '';
    }
  } else if (TEXT_EXTENSIONS.test(file.name) || mime.indexOf('text/') === 0 || mime === 'application/json') {
    text = clampFileText(decodeUtf8(buffer));
  } else if (ARCHIVE_EXTENSIONS.test(file.name)) {
    text = await extractOfficeText(file, buffer);
  } else if (LEGACY_BINARY_EXTENSIONS.test(file.name)) {
    text = extractLegacyOfficeText(buffer);
  }

  if (!text) {
    text = '（该文件未能在浏览器中提取文本，请使用支持文件输入的模型或先将文件转换为 PDF、TXT、CSV、DOCX、XLSX 后再上传。）';
  }
  return {
    name: file.name,
    type: isPdf ? 'application/pdf' : (file.type || 'application/octet-stream'),
    size: file.size,
    text: text,
    isPdf: isPdf
  };
}

function isImageFile(file) { return (file.type || '').indexOf('image/') === 0; }

async function addFiles(files) {
  var list = Array.from(files || []);
  if (!list.length) return;

  for (var i = 0; i < list.length; i++) {
    var file = list[i];
    if (!file) continue;

    // 1. 如果是图片，走图片流程
    if (isImageFile(file)) {
      await addImages([file]);
      continue;
    }

    if (file.size > MAX_FILE_SIZE) {
      showToast(file.name + ' 超过 ' + formatFileSize(MAX_FILE_SIZE) + ' 限制', 'error');
      continue;
    }

    // 2. 如果是 PDF 文件，优先进行多模态页面光栅化（转高清图保留波形图与电路图）
    var isPdf = fileExtension(file.name) === 'pdf' || (file.type === 'application/pdf');
    if (isPdf) {
      if (state.pendingFiles.length >= 10) {
        showToast('最多上传 10 个文件', 'error');
        continue;
      }
      showToast('正在解析 ' + file.name + '，请稍候...', 'info');
      try {
        var buffer = await readFileBuffer(file);
        var lastToastTime = 0;
        var pdfResult = await renderPdfToPageImages(file, buffer, function (curr, total, docTotal) {
          var now = Date.now();
          if (now - lastToastTime > 1200 || curr === total) {
            lastToastTime = now;
            showToast('正在光栅化 ' + file.name + ' (' + curr + '/' + total + ' 页)...', 'info');
          }
        });
        var renderedPages = pdfResult.renderedPages || [];

        // 页面图像直接保存在 PDF 文件对象内部，不在输入框弹出大量散落图片！
        state.pendingFiles.push({
          name: file.name,
          type: 'application/pdf',
          size: file.size,
          text: pdfResult.extractedText || '',
          pageCount: pdfResult.totalPages,
          renderedPageCount: renderedPages.length,
          pages: renderedPages,
          profileLabel: pdfResult.profileLabel || '',
          isPdf: true
        });

        renderAttachmentPreviews();
        var pLabel = pdfResult.profileLabel ? (' · ' + pdfResult.profileLabel) : '';
        var extraNote = pdfResult.totalPages > renderedPages.length
          ? ('（已按' + (pdfResult.profileLabel || '高清') + '画质光栅化前 ' + renderedPages.length + ' 页视觉图，已抽取全部 ' + pdfResult.totalPages + ' 页文本）')
          : ('（共 ' + renderedPages.length + ' 页' + pLabel + '）');
        showToast('已解析 ' + file.name + extraNote + '，波形与电路图已就绪！', 'success');
      } catch (pdfErr) {
        console.warn('PDF 光栅化失败，降级为普通文件附件处理:', pdfErr);
        try {
          state.pendingFiles.push(await parseAttachment(file));
          renderAttachmentPreviews();
        } catch (e) {
          showToast(file.name + ' 处理失败: ' + e.message, 'error');
        }
      }
      continue;
    }

    // 3. 常规文件
    if (state.pendingFiles.length >= 10) {
      showToast('最多上传 10 个文件', 'error');
      continue;
    }
    try {
      state.pendingFiles.push(await parseAttachment(file));
      renderAttachmentPreviews();
    } catch (e) {
      showToast(file.name + ' 处理失败: ' + e.message, 'error');
    }
  }

  renderAttachmentPreviews();
}

function removeFile(i) { state.pendingFiles.splice(i, 1); renderAttachmentPreviews(); }

function renderAttachmentPreviews() {
  var html = state.pendingImages.map(function (img, i) {
    return '<div class="image-preview-item" title="点击放大预览"><img src="' + esc(img) + '" alt="图片预览" style="cursor:zoom-in"><button class="image-preview-remove" data-kind="image" data-index="' + i + '">×</button></div>';
  }).join('');
  html += state.pendingFiles.map(function (f, i) {
    var isPdf = f.isPdf || (f.type === 'application/pdf') || /\.pdf$/i.test(f.name);
    var iconClass = isPdf ? 'file-preview-icon file-icon-pdf' : 'file-preview-icon';
    var iconText = isPdf ? 'PDF' : '▧';
    var count = f.renderedPageCount || (f.pages ? f.pages.length : 0);
    var badgeText = count ? ('共 ' + count + ' 页' + (f.profileLabel ? (' · ' + f.profileLabel) : '')) : '多模态';
    var badgeHtml = isPdf ? ('<span class="file-preview-badge" title="大模型原生视觉阅读">' + badgeText + '</span>') : '';
    var previewBtnHtml = (isPdf && f.pages && f.pages.length) ? ('<button class="btn-file-preview-action" type="button" data-preview-file-index="' + i + '" title="预览页面与图表">👁 预览</button>') : '';
    return '<div class="file-preview-item' + (isPdf ? ' is-pdf' : '') + '">' +
      '<span class="' + iconClass + '">' + iconText + '</span>' +
      '<span class="file-preview-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
      badgeHtml +
      '<span class="file-preview-size">' + formatFileSize(f.size) + '</span>' +
      previewBtnHtml +
      '<button class="file-preview-remove" data-kind="file" data-index="' + i + '" title="移除文件">×</button>' +
    '</div>';
  }).join('');
  dom.attachmentPreviews.innerHTML = html;
  syncOutlineBounds();
  dom.attachmentPreviews.querySelectorAll('.image-preview-item img').forEach(function (imgEl) {
    imgEl.addEventListener('click', function () {
      dom.imageOverlayImg.src = this.src;
      dom.imageOverlay.classList.add('active');
    });
  });
  dom.attachmentPreviews.querySelectorAll('.btn-file-preview-action').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var fIndex = parseInt(this.dataset.previewFileIndex, 10);
      var f = state.pendingFiles[fIndex];
      if (f && f.pages && f.pages.length) {
        openPdfViewer(f);
      }
    });
  });
  dom.attachmentPreviews.querySelectorAll('.image-preview-remove, .file-preview-remove').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (this.dataset.kind === 'file') removeFile(parseInt(this.dataset.index, 10));
      else removeImage(parseInt(this.dataset.index, 10));
    });
  });
}
// ─── Init ───────────────────────────────────────────────────────

async function init() {
  // On small screens the conversation panel starts closed so the chat is
  // immediately usable; the menu button can reopen it at any time.
  if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
    dom.sidebar.classList.add('collapsed');
  }
  await initConversationStorage();
  if (convoStorageMode === 'indexeddb') {
    state.conversations = (await idbGetAll(IDB.convoStore)).sort(function (a, b) {
      var ao = typeof a.listOrder === 'number' ? a.listOrder : Number.MAX_SAFE_INTEGER;
      var bo = typeof b.listOrder === 'number' ? b.listOrder : Number.MAX_SAFE_INTEGER;
      return ao - bo;
    });
  } else {
    state.conversations = loadConvos();
  }
  migrateLegacyConvoGroup();
  applyFontSize();
  syncOutlineBounds();
  window.addEventListener('resize', syncOutlineBounds);
  renderGroupSelector();
  renderSidebar();
  var lastId = localStorage.getItem(LS.current);
  if (lastId && state.conversations.find(function (c) { return c.id === lastId; })) {
    selectConvo(lastId);
  } else if (state.conversations.length) {
    selectConvo(state.conversations[0].id);
  } else {
    setModelValue(DEFAULT_MODELS[0]);
    showWelcome();
  }

  // 利用浏览器空闲时间后台预热前几个最近对话的消息与 Markdown 缓存
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(function () { preloadTopConversations(); });
  } else {
    setTimeout(preloadTopConversations, 1200);
  }
}

// ─── 空闲预加载 ────────────────────────────────────────────────
// 在浏览器空闲帧预读并预热前 5 个最近会话的 Markdown 缓存，彻底消除首次点击切换时的运算停顿
function preloadTopConversations() {
  if (!state.conversations || !state.conversations.length) return;
  var topConvos = state.conversations.slice(0, 5);
  var i = 0;

  function processNextConvo() {
    if (i >= topConvos.length) return;
    var c = topConvos[i++];
    if (!c || c.id === state.currentConvoId) {
      scheduleNext();
      return;
    }
    ensureConvoLoaded(c).then(function (msgs) {
      if (!msgs || !msgs.length) {
        scheduleNext();
        return;
      }
      var start = Math.max(0, msgs.length - 10);
      for (var j = start; j < msgs.length; j++) {
        var m = msgs[j];
        if (m && !m._cachedHtml && m.role === 'assistant' && m.text) {
          try {
            m._cachedHtml = renderMd(m.text);
            if (m.reasoning) m._cachedReasoningHtml = renderMd(m.reasoning);
          } catch (e) {}
        }
      }
      scheduleNext();
    }).catch(function () {
      scheduleNext();
    });
  }

  function scheduleNext() {
    if (i < topConvos.length) {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(function (deadline) {
          if (deadline.timeRemaining() > 10) processNextConvo();
          else setTimeout(processNextConvo, 80);
        });
      } else {
        setTimeout(processNextConvo, 80);
      }
    }
  }

  scheduleNext();
}

// ─── Custom Model Dropdown ──────────────────────────────────────

function getModelList() { return getModels(); }

function openModelDropdown(filterByInput) {
  var models = getModelList();
  var cur = dom.modelInput.value.trim().toLowerCase();
  var html = '';
  var filtered = models;
  if (filterByInput && cur) {
    filtered = models.filter(function (m) { return m.toLowerCase().indexOf(cur) !== -1; });
  }
  if (filtered.length === 0) {
    html = '<div class="model-dropdown-empty">无匹配模型，输入自定义名称</div>';
  } else {
    for (var i = 0; i < filtered.length; i++) {
      var cls = filtered[i] === dom.modelInput.value ? ' active' : '';
      html += '<div class="model-dropdown-item' + cls + '" data-value="' + esc(filtered[i]) + '"><div class="model-name">' + esc(filtered[i]) + '</div></div>';
    }
  }
  dom.modelDropdown.innerHTML = html;
  dom.modelDropdown.style.display = 'block';

  dom.modelDropdown.querySelectorAll('.model-dropdown-item').forEach(function (item) {
    item.addEventListener('mousedown', function (e) {
      e.preventDefault();
      dom.modelInput.value = this.dataset.value;
      closeModelDropdown();
      dom.modelInput.focus();
      if (state.currentConvoId) persistConvo();
    });
  });
}

function closeModelDropdown() {
  dom.modelDropdown.style.display = 'none';
}

function toggleModelDropdown() {
  if (dom.modelDropdown.style.display === 'block') {
    closeModelDropdown();
  } else {
    openModelDropdown(false);
  }
}

dom.modelInput.addEventListener('focus', function () {
  openModelDropdown(false);
});

dom.modelInput.addEventListener('click', function () {
  if (dom.modelDropdown.style.display !== 'block') {
    openModelDropdown(false);
  }
});

dom.modelInput.addEventListener('input', function () {
  openModelDropdown(true);
});

dom.modelInput.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown' && dom.modelDropdown.style.display === 'block') {
    e.preventDefault();
    var items = dom.modelDropdown.querySelectorAll('.model-dropdown-item');
    if (items.length) { items[0].focus(); }
  }
  if (e.key === 'Escape') {
    closeModelDropdown();
  }
});

dom.modelDropdownArrow.addEventListener('click', function (e) {
  e.stopPropagation();
  toggleModelDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', function (e) {
  if (!dom.modelSelector.contains(e.target)) {
    closeModelDropdown();
  }
});

// Persist model change on blur
dom.modelInput.addEventListener('blur', function () {
  setTimeout(function () { closeModelDropdown(); }, 150);
  if (state.currentConvoId) persistConvo();
});

// ─── API Config Group Selector (header) ────────────────────────

function closeGroupDropdown() { dom.groupDropdown.style.display = 'none'; }

function renderGroupSelector() {
  var s = getSettings();
  var active = getGroupIn(s, s.activeGroupId) || s.apiGroups[0];
  dom.groupSelectorLabel.textContent = active ? active.name : '未配置';
  var html = s.apiGroups.map(function (g) {
    var cls = g.id === s.activeGroupId ? ' active' : '';
    return '<div class="group-dropdown-item' + cls + '" data-id="' + g.id + '"><span class="group-dropdown-name">' + esc(g.name) + '</span><span class="group-dropdown-meta">' + esc(g.apiBase || '') + '</span></div>';
  }).join('');
  html += '<div class="group-dropdown-item manage"><span class="group-dropdown-name">⚙ 管理配置组</span></div>';
  dom.groupDropdown.innerHTML = html;
}

function switchGroup(id) {
  var s = getSettings();
  if (s.activeGroupId === id) return;
  var oldModels = getActiveGroup().models || [];
  s.activeGroupId = id;
  setSettings(s);
  var newModels = getActiveGroup().models || [];
  var cur = dom.modelInput.value.trim();
  if (oldModels.indexOf(cur) !== -1 && newModels.length && newModels.indexOf(cur) === -1) {
    setModelValue(newModels[0]);
  }
  if (state.currentConvoId) persistConvo();
  renderGroupSelector();
  closeModelDropdown();
}

dom.groupSelectorBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  if (dom.groupDropdown.style.display === 'block') closeGroupDropdown();
  else { renderGroupSelector(); dom.groupDropdown.style.display = 'block'; }
});

dom.groupDropdown.addEventListener('click', function (e) {
  var item = e.target.closest('.group-dropdown-item');
  if (!item) return;
  if (item.classList.contains('manage')) { closeGroupDropdown(); openSettings(); return; }
  switchGroup(item.dataset.id);
  closeGroupDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', function (e) {
  if (!dom.groupSelector.contains(e.target)) closeGroupDropdown();
});

// ─── Sidebar ────────────────────────────────────────────────────

// 快速更新侧边栏高亮选中项（毫秒级，避免切换会话时全量重绘整个侧边栏 DOM）
function updateSidebarActive(activeId) {
  var prev = dom.conversationList.querySelector('.convo-item.active');
  if (prev) {
    if (prev.dataset.id === activeId) return;
    prev.classList.remove('active');
  }
  if (activeId) {
    var cur = dom.conversationList.querySelector('.convo-item[data-id="' + activeId + '"]');
    if (cur) cur.classList.add('active');
  }
}

// 对话分组区（置顶，含空组）+ 未分组区（固定最后）分层展示；折叠状态持久化到 settings.collapsedConvoGroups
function renderSidebar() {
  if (movePopoverEl) closeConvoMovePopover();
  var s = getSettings();
  var convoGroups = s.convoGroups || [];
  // 仅在既没有对话，也没有任何自定义分组时，才显示全空占位
  if (!state.conversations.length && !convoGroups.length) {
    dom.conversationList.innerHTML = '<div class="empty-conversations">暂无对话记录<br>点击上方按钮开始新对话</div>';
    return;
  }
  var collapsedIds = s.collapsedConvoGroups || [];
  var html = '';
  convoGroups.forEach(function (g) {
    var convos = state.conversations.filter(function (c) { return c.groupId === g.id; });
    html += renderSidebarGroup(g.id, g.name, convos, collapsedIds, true);
  });
  // 未分组区固定最后；groupId 指向已删除分组的对话也归入这里兜底显示
  var ungrouped = state.conversations.filter(function (c) {
    return !c.groupId || !convoGroups.some(function (g) { return g.id === c.groupId; });
  });
  if (ungrouped.length > 0 || (!convoGroups.length && state.conversations.length > 0)) {
    html += renderSidebarGroup('', '未分组', ungrouped, collapsedIds, false);
  }
  dom.conversationList.innerHTML = html;
}

function renderSidebarGroup(groupId, name, convos, collapsedIds, showNewBtn) {
  var isCollapsed = collapsedIds.indexOf(groupId) !== -1;
  var items = '';
  if (convos.length > 0) {
    items = convos.map(function (c) {
      var active = c.id === state.currentConvoId ? ' active' : '';
      var last = (c.lastMessage || '').slice(0, 60);
      var model = c.model || '';
      return '<div class="convo-item' + active + '" data-id="' + c.id + '" draggable="true">' +
        '<div class="convo-drag-handle" title="按住拖拽排序"><svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg></div>' +
        '<div class="convo-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg></div>' +
        '<div class="convo-info"><div class="convo-title">' + esc(c.title || 'New Chat') + '</div><div class="convo-meta">' + esc((model ? model + ' · ' : '') + (last || 'No messages')) + '</div></div>' +
        '<div class="convo-actions" draggable="false"><button class="btn-convo-action btn-convo-move" data-action="move" data-id="' + c.id + '" title="移动到分组"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button><button class="btn-convo-action" data-action="delete" data-id="' + c.id + '" title="删除对话"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div>' +
        '</div>';
    }).join('');
  } else {
    items = '<div class="sidebar-group-empty" data-drop-group-id="' + esc(groupId) + '">暂无对话，点击 + 新建或拖拽至此</div>';
  }
  var newBtn = showNewBtn ? '<button class="btn-group-new" data-group-id="' + esc(groupId) + '" title="在该组新建对话"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' : '';
  return '<div class="sidebar-group' + (isCollapsed ? ' collapsed' : '') + '" data-group-id="' + esc(groupId) + '"><div class="sidebar-group-head" title="折叠/展开"><svg class="sidebar-group-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg><span class="sidebar-group-name">' + esc(name) + '</span><span class="sidebar-group-count">' + convos.length + '</span>' + newBtn + '</div><div class="sidebar-group-body" data-group-id="' + esc(groupId) + '">' + items + '</div></div>';
}

function toggleConvoGroupCollapse(id) {
  var s = getSettings();
  var arr = (s.collapsedConvoGroups || []).slice();
  var idx = arr.indexOf(id);
  if (idx === -1) arr.push(id);
  else arr.splice(idx, 1);
  s.collapsedConvoGroups = arr;
  setSettings(s);
  renderSidebar();
}

// 移动到分组：悬停对话 → 文件夹图标 → 弹层选组
var movePopoverEl = null;
function openConvoMovePopover(convoId, anchorBtn) {
  closeConvoMovePopover();
  var c = state.conversations.find(function (x) { return x.id === convoId; });
  if (!c) return;
  var s = getSettings();
  var cur = c.groupId || '';
  var html = '<div class="convo-move-title">移动到</div>';
  html += '<div class="convo-move-item' + (cur === '' ? ' active' : '') + '" data-group-id="">未分组' + (cur === '' ? '<span class="convo-move-check">✓</span>' : '') + '</div>';
  s.convoGroups.forEach(function (g) {
    html += '<div class="convo-move-item' + (g.id === cur ? ' active' : '') + '" data-group-id="' + esc(g.id) + '">' + esc(g.name) + (g.id === cur ? '<span class="convo-move-check">✓</span>' : '') + '</div>';
  });
  movePopoverEl = document.createElement('div');
  movePopoverEl.className = 'convo-move-popover';
  movePopoverEl.dataset.convoId = convoId;
  movePopoverEl.innerHTML = html;
  var itemEl = anchorBtn.closest('.convo-item');
  if (!itemEl) { movePopoverEl = null; return; }
  itemEl.appendChild(movePopoverEl);
  movePopoverEl.addEventListener('click', function (e) {
    e.stopPropagation();
    var item = e.target.closest('.convo-move-item');
    if (item) moveConvoToGroup(movePopoverEl.dataset.convoId, item.dataset.groupId);
  });
}
function closeConvoMovePopover() {
  if (movePopoverEl) { movePopoverEl.remove(); movePopoverEl = null; }
}
function moveConvoToGroup(convoId, groupId) {
  var c = state.conversations.find(function (x) { return x.id === convoId; });
  if (!c) return;
  var g = (getSettings().convoGroups || []).find(function (x) { return x.id === groupId; });
  c.groupId = groupId ? groupId : undefined;
  persistConversationMetadata(c, state.conversations.indexOf(c)).catch(reportConvoDbError);
  saveConvos();
  closeConvoMovePopover();
  renderSidebar();
  showToast('已移动到「' + (g ? g.name : '未分组') + '」', 'success');
}

function showWelcome() {
  var h = new Date().getHours();
  var greeting = h < 5 ? '夜深了' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  var welcomeLines = ['今天想聊点什么？', '有什么难题需要一起解决？', '随便聊聊也可以', '想让我帮你查点什么？', '新的一天，从提问开始'];
  dom.welcomeTitle.textContent = greeting + '！';
  dom.welcomeSub.textContent = welcomeLines[Math.floor(Math.random() * welcomeLines.length)];
  dom.welcomeScreen.style.display = 'flex';
  if (dom.chatOutline) dom.chatOutline.classList.add('hidden');
  dom.messagesContainer.querySelectorAll('.message').forEach(function (m) { m.remove(); });
}
function hideWelcome() { dom.welcomeScreen.style.display = 'none'; }

// ─── Conversations ──────────────────────────────────────────────

async function selectConvo(id) {
  var c = state.conversations.find(function (x) { return x.id === id; });
  if (!c) return;
  var selectionToken = ++state.convoSelectionToken;
  state.currentConvoId = id;
  var messages;
  try {
    messages = await ensureConvoLoaded(c);
  } catch (e) {
    reportConvoDbError(e);
    return;
  }
  // Avoid an older, slower IndexedDB read repainting a conversation selected later.
  if (selectionToken !== state.convoSelectionToken || state.currentConvoId !== id) return;
  state.currentMessages = messages;
  localStorage.setItem(LS.current, id);
  setModelValue(c.model || DEFAULT_MODELS[0]);
  // renderMessages 已处理：空对话显示欢迎页（含时间问候），非空对话隐藏
  renderMessages();
  dom.conversationTitle.textContent = c.title || 'New Chat';
  updateSidebarActive(id);
  scrollBottom(true);
}

function newConvo(groupId) {
  if (typeof groupId !== 'string') groupId = '';
  var m = getModel();
  var c = { id: uid(), title: 'New Chat', model: m, groupId: groupId || undefined, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0, lastMessage: '' };
  state.conversations.unshift(c);
  saveConvos();
  renderSidebar();
  selectConvo(c.id);
  dom.messageInput.focus();
}

function openRenameConvo(convoId) {
  var c = state.conversations.find(function (x) { return x.id === convoId; });
  if (!c) { showToast('请先选择一个对话', 'info'); return; }
  state.pendingRenameId = convoId;
  dom.renameConvoInput.value = c.title === 'New Chat' ? '' : (c.title || '');
  dom.renameConvoOverlay.classList.add('active');
  setTimeout(function () {
    dom.renameConvoInput.focus();
    dom.renameConvoInput.select();
  }, 0);
}

function closeRenameConvo() {
  state.pendingRenameId = null;
  dom.renameConvoOverlay.classList.remove('active');
}

function saveConvoRename() {
  var id = state.pendingRenameId;
  var c = state.conversations.find(function (x) { return x.id === id; });
  if (!c) { closeRenameConvo(); return; }
  var name = dom.renameConvoInput.value.trim();
  if (!name) { showToast('对话名称不能为空', 'error'); dom.renameConvoInput.focus(); return; }

  c.title = name.slice(0, 80);
  c.titleCustom = true;
  c.updatedAt = new Date().toISOString();
  if (c.id === state.currentConvoId) dom.conversationTitle.textContent = c.title;
  persistConversationMetadata(c, state.conversations.indexOf(c)).catch(reportConvoDbError);
  saveConvos();
  renderSidebar();
  closeRenameConvo();
  showToast('对话名称已更新', 'success');
}

// 从任意一条消息创建独立分支：保留该消息之前的上下文（含当前消息），
// 沿用原会话的模型和对话分组，之后在新会话中的操作不会影响原会话。
async function branchConvoFromMessage(idx) {
  if (state.isStreaming) return;
  var source = state.conversations.find(function (c) { return c.id === state.currentConvoId; });
  if (!source || !Array.isArray(state.currentMessages) || idx < 0 || idx >= state.currentMessages.length) return;
  var selected = state.currentMessages[idx];
  if (!selected || selected.role === 'break') return;

  var messages = state.currentMessages.slice(0, idx + 1).map(function (m) {
    var copy = {};
    for (var k in m) {
      if (k.indexOf('_cached') === 0) continue; // 关键：绝对不复制父会话的 DOM 节点 _cachedElement 与私有缓存
      copy[k] = m[k];
    }
    if (Array.isArray(m.images)) copy.images = m.images.slice();
    if (Array.isArray(m.files)) copy.files = m.files.map(function (f) { var out = {}; for (var key in f) out[key] = f[key]; return out; });
    return copy;
  });
  var last = messages[messages.length - 1];
  var title = source.title && source.title !== 'New Chat' ? source.title : (last.text || '新对话');
  title = '分支：' + title.slice(0, 36) + (title.length > 36 ? '…' : '');
  var c = {
    id: uid(),
    title: title,
    model: source.model || getModel(),
    groupId: source.groupId || undefined,
    messages: messages,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: messages.filter(function (m) { return m.role !== 'break'; }).length,
    lastMessage: (last.text || (last.files && last.files.length ? '[' + last.files[0].name + ']' : (last.images && last.images.length ? '[图片消息]' : ''))).slice(0, 80),
    parentId: source.id,
    branchMessageIndex: idx
  };
  state.conversations.unshift(c);
  try {
    var branchSaved = await persistConversation(c, 0);
    if (branchSaved === false) throw new Error('localStorage quota exceeded');
  } catch (e) {
    state.conversations.shift();
    if (convoStorageMode === 'indexeddb' && convoDb) {
      enqueueConvoDbWrite(function () { return idbDeleteConversation(c.id); }).catch(function () {});
    }
    saveConvos();
    if (convoStorageMode === 'indexeddb') reportConvoDbError(e);
    else showToast('浏览器存储空间已满，无法创建分支对话', 'error');
    return;
  }
  saveConvos();
  renderSidebar();
  selectConvo(c.id);
  showToast('已从此处创建分支对话', 'success');
}

// 删除确认弹窗（替代浏览器原生 confirm，居中展示好点击）
function openDeleteConfirm(convoId) {
  var c = state.conversations.find(function (x) { return x.id === convoId; });
  if (!c) return;
  state.pendingDeleteId = convoId;
  var title = (c.title || 'New Chat').slice(0, 30);
  dom.deleteConfirmText.textContent = '确定要删除对话「' + title + '」吗？此操作不可撤销。';
  dom.deleteConfirmOverlay.classList.add('active');
}
function closeDeleteConfirm() {
  state.pendingDeleteId = null;
  dom.deleteConfirmOverlay.classList.remove('active');
}
function confirmDeleteConvo() {
  var id = state.pendingDeleteId;
  closeDeleteConfirm();
  if (id) deleteConvo(id);
}

function deleteConvo(id) {
  if (convoStorageMode === 'indexeddb' && convoDb) {
    enqueueConvoDbWrite(function () { return idbDeleteConversation(id); }).catch(reportConvoDbError);
  } else {
    localStorage.removeItem(convoKey(id));
  }
  state.conversations = state.conversations.filter(function (c) { return c.id !== id; });
  if (state.currentConvoId === id) {
    state.currentConvoId = null;
    state.currentMessages = [];
    localStorage.setItem(LS.current, '');
    if (state.conversations.length) { selectConvo(state.conversations[0].id); }
    else { dom.messagesContainer.querySelectorAll('.message').forEach(function (m) { m.remove(); }); showWelcome(); dom.conversationTitle.textContent = 'New Chat'; setModelValue(DEFAULT_MODELS[0]); }
  }
  saveConvos();
  renderSidebar();
  showToast('对话已删除', 'success');
}

// 防抖保存：合并模型切换/消息操作的写入；IndexedDB 模式下消息按条目保存。
var convoSaveTimer = null;
var convoSaveTarget = null;
var convoStorageFullWarned = false;
function persistConvo() {
  var c = state.conversations.find(function (x) { return x.id === state.currentConvoId; });
  if (!c) return;
  c.messages = state.currentMessages;
  c.model = getModel();
  c.updatedAt = new Date().toISOString();
  c.messageCount = state.currentMessages.filter(function (m) { return m.role !== 'break'; }).length;
  var last = null;
  for (var i = state.currentMessages.length - 1; i >= 0; i--) {
    if (state.currentMessages[i].role !== 'break') { last = state.currentMessages[i]; break; }
  }
  c.lastMessage = last ? (last.text || (last.files && last.files.length ? '[' + last.files[0].name + ']' : '[图片消息]')).slice(0, 80) : '';
  convoSaveTarget = c;
  clearTimeout(convoSaveTimer);
  // Capture the conversation: a user can switch conversations while the debounce timer is pending.
  convoSaveTimer = setTimeout(function () { flushConvoSave(c); }, 800);
}
function flushConvoSave() {
  clearTimeout(convoSaveTimer);
  var target = (arguments.length && arguments[0] && !(arguments[0] instanceof Event) && typeof arguments[0].id === 'string') ? arguments[0] : null;
  var c = target || convoSaveTarget || state.conversations.find(function (x) { return x.id === state.currentConvoId; });
  convoSaveTarget = null;
  if (!c) return;
  if (convoStorageMode === 'indexeddb' && convoDb) {
    enqueueConvoDbWrite(function () {
      return Promise.all([
        idbPutConvoMetadata(c, state.conversations.indexOf(c)),
        idbReplaceMessages(c.id, c.messages || [])
      ]);
    }).catch(reportConvoDbError);
    return;
  }
  var cleanC = {};
  for (var k in c) {
    if (k === 'messages' && Array.isArray(c.messages)) {
      cleanC.messages = c.messages.map(serializeMessageForStorage);
    } else {
      cleanC[k] = c[k];
    }
  }
  var ok = save(convoKey(c.id), cleanC);
  saveConvos();
  // 配额满时提示一次，避免每次写盘都弹
  if (!ok && !convoStorageFullWarned) {
    convoStorageFullWarned = true;
    showToast('浏览器存储空间已满，对话历史可能无法保存，建议导出备份', 'error');
  }
}
window.addEventListener('beforeunload', function () { flushConvoSave(); });

// ─── Messages ───────────────────────────────────────────────────

var INITIAL_RENDER_COUNT = 25;
var BATCH_RENDER_COUNT = 20;

function createLoadEarlierBar(remainingCount) {
  var el = document.createElement('div');
  el.className = 'load-earlier-bar';
  el.innerHTML = '<button type="button" class="btn-load-earlier"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg> <span>加载更早的 ' + remainingCount + ' 条消息</span></button>';
  el.querySelector('.btn-load-earlier').addEventListener('click', function () {
    loadEarlierMessages();
  });
  return el;
}

function loadEarlierMessages() {
  if (state.renderedMessageStart <= 0) return;
  var bar = dom.messagesContainer.querySelector('.load-earlier-bar');
  var prevStart = state.renderedMessageStart;
  var newStart = Math.max(0, prevStart - BATCH_RENDER_COUNT);
  state.renderedMessageStart = newStart;

  var prevHeight = dom.messagesContainer.scrollHeight;
  var prevTop = dom.messagesContainer.scrollTop;

  var frag = document.createDocumentFragment();
  for (var i = newStart; i < prevStart; i++) {
    var m = state.currentMessages[i];
    var node = m.role === 'break' ? createBreakBubble(i, m.bid) : createBubbleElement(m, i);
    frag.appendChild(node);
  }

  if (bar) {
    if (newStart > 0) {
      var btnSpan = bar.querySelector('.btn-load-earlier span');
      if (btnSpan) btnSpan.textContent = '加载更早的 ' + newStart + ' 条消息';
      bar.after(frag);
    } else {
      bar.after(frag);
      bar.remove();
    }
  } else {
    dom.messagesContainer.prepend(frag);
  }

  var newHeight = dom.messagesContainer.scrollHeight;
  dom.messagesContainer.scrollTop = prevTop + (newHeight - prevHeight);
  flushPendingKatex();
}

function mountAllEarlierMessages() {
  if (state.renderedMessageStart <= 0) return;
  var bar = dom.messagesContainer.querySelector('.load-earlier-bar');
  var count = state.renderedMessageStart;
  state.renderedMessageStart = 0;

  var frag = document.createDocumentFragment();
  for (var i = 0; i < count; i++) {
    var m = state.currentMessages[i];
    var node = m.role === 'break' ? createBreakBubble(i, m.bid) : createBubbleElement(m, i);
    frag.appendChild(node);
  }

  if (bar) {
    bar.after(frag);
    bar.remove();
  } else {
    dom.messagesContainer.prepend(frag);
  }
  flushPendingKatex();
}

function renderMessages() {
  dom.messagesContainer.textContent = '';
  if (!state.currentMessages.length) { showWelcome(); return; }
  hideWelcome();

  var total = state.currentMessages.length;
  var start = Math.max(0, total - INITIAL_RENDER_COUNT);
  state.renderedMessageStart = start;

  var frag = document.createDocumentFragment();
  if (start > 0) {
    frag.appendChild(createLoadEarlierBar(start));
  }

  for (var i = start; i < total; i++) {
    var m = state.currentMessages[i];
    var node = m.role === 'break' ? createBreakBubble(i, m.bid) : createBubbleElement(m, i);
    frag.appendChild(node);
  }
  dom.messagesContainer.appendChild(frag);

  renderChatOutline();
  flushPendingKatex();
}

// 左侧对话速览：每条用户输入显示为一个标记，悬停显示话题，点击跳转
function renderChatOutline() {
  if (!dom.chatOutline) return;
  var users = [];
  for (var i = 0; i < state.currentMessages.length; i++) {
    var m = state.currentMessages[i];
    if (m.role === 'user') users.push({ m: m, idx: i });
  }
  if (users.length < 1) { dom.chatOutline.classList.add('hidden'); return; }
  dom.chatOutline.classList.remove('hidden');
  dom.chatOutlineHead.textContent = '对话话题 · ' + users.length + ' 条';
  dom.chatOutlineList.innerHTML = users.map(function (x, n) {
    var text = x.m.text || '';
    if (x.m.images && x.m.images.length) text = text ? text + ' [图片]' : '[图片]';
    if (x.m.files && x.m.files.length) text = text ? text + ' [' + x.m.files.length + ' 个文件]' : '[' + x.m.files.length + ' 个文件]';
    var firstLine = text.split('\n')[0].trim() || '[图片]';
    if (firstLine.length > 26) firstLine = firstLine.slice(0, 26) + '…';
    return '<div class="chat-outline-item" data-idx="' + x.idx + '" title="' + esc(firstLine) + '" aria-label="' + esc(firstLine) + '"><span class="chat-outline-marker"></span><span class="chat-outline-text">' + esc(firstLine) + '</span></div>';
  }).join('');

  var outlineItems = Array.prototype.slice.call(dom.chatOutlineList.querySelectorAll('.chat-outline-item'));
  var hoverBoosts = [16, 12, 9, 7, 5, 3];
  function clearOutlineHover() {
    outlineItems.forEach(function (item) {
      item.classList.remove('outline-near');
      item.style.removeProperty('--hover-boost');
      item.style.removeProperty('--hover-opacity');
    });
  }
  function setOutlineHover(activeIndex) {
    clearOutlineHover();
    outlineItems.forEach(function (item, itemIndex) {
      var distance = Math.abs(itemIndex - activeIndex);
      if (distance > 5) return;
      item.classList.add('outline-near');
      item.style.setProperty('--hover-boost', hoverBoosts[distance] + 'px');
      item.style.setProperty('--hover-opacity', String(1 - distance * 0.13));
    });
  }
  outlineItems.forEach(function (item, itemIndex) {
    item.addEventListener('mouseenter', function () { setOutlineHover(itemIndex); });
    item.addEventListener('mouseleave', clearOutlineHover);
    item.addEventListener('focus', function () { setOutlineHover(itemIndex); });
    item.addEventListener('blur', clearOutlineHover);
  });
}

// 话题标记列固定在消息区域左侧并垂直居中，不再随输入区高度移动
function syncOutlineBounds() {
  if (!dom.chatOutline) return;
  dom.chatOutline.style.bottom = 'auto';
}

function createBubbleElement(msg, idx) {
  if (msg._cachedElement && !msg.streaming) {
    if (typeof idx === 'number') msg._cachedElement.dataset.index = idx;
    return msg._cachedElement;
  }
  var isUser = msg.role === 'user';
  var currentConvo = state.conversations.find(function (c) { return c.id === state.currentConvoId; });
  var replyModel = !isUser ? (msg.model || (currentConvo && currentConvo.model) || '') : '';
  var el = document.createElement('div');
  el.className = 'message ' + (isUser ? 'user' : 'assistant');
  if (typeof idx === 'number') el.dataset.index = idx;

  var imgs = '';
  if (msg.images && msg.images.length) {
    imgs = '<div class="message-images">' + msg.images.map(function (i) { return '<div class="message-image-wrapper" data-src="' + esc(i) + '"><img src="' + esc(i) + '" alt="img" loading="lazy"></div>'; }).join('') + '</div>';
  }
  var filesHtml = '';
  if (msg.files && msg.files.length) {
    filesHtml = '<div class="message-files">' + msg.files.map(function (f, fIdx) {
      var isPdf = f.isPdf || (f.type === 'application/pdf') || /\.pdf$/i.test(f.name);
      var iconClass = isPdf ? 'message-file-icon file-icon-pdf' : 'message-file-icon';
      var iconText = isPdf ? 'PDF' : '▧';
      var pageCount = f.renderedPageCount || (f.pages ? f.pages.length : 0);
      var badgeText = pageCount ? ('共 ' + pageCount + ' 页' + (f.profileLabel ? (' · ' + f.profileLabel) : '')) : 'PDF 文档';
      var badgeHtml = isPdf ? ('<span class="message-file-badge">' + badgeText + '</span>') : '';
      var previewBtnHtml = (isPdf && f.pages && f.pages.length) ? ('<button class="btn-file-preview-action" type="button" data-msg-idx="' + (typeof idx === 'number' ? idx : '') + '" data-file-idx="' + fIdx + '" title="预览页面与图表">👁 预览</button>') : '';
      return '<div class="message-file' + (isPdf ? ' is-pdf' : '') + '" title="' + esc(f.name) + '">' +
        '<span class="' + iconClass + '">' + iconText + '</span>' +
        '<span class="message-file-name">' + esc(f.name) + '</span>' +
        badgeHtml +
        '<span class="file-preview-size">' + formatFileSize(f.size || 0) + '</span>' +
        previewBtnHtml +
      '</div>';
    }).join('') + '</div>';
  }

  var txt = '';
  if (msg.text) {
    if (isUser) {
      txt = '<p style="white-space:pre-wrap">' + esc(msg.text) + '</p>';
    } else if (msg.streaming) {
      txt = renderMd(msg.text);
    } else {
      if (!msg._cachedHtml || msg._cachedHtml.indexOf('katex-pending') !== -1) {
        var rendered = renderMd(msg.text);
        if (rendered.indexOf('katex-pending') === -1) {
          msg._cachedHtml = rendered;
        }
        txt = rendered;
      } else {
        txt = msg._cachedHtml;
      }
    }
  }

  var reasoningHtml = '';
  if (!isUser && msg.reasoning && getSettings().showThinking) {
    if (msg.streaming) {
      reasoningHtml = '<details class="reasoning-block"><summary>思考过程</summary><div class="reasoning-content">' + renderMd(msg.reasoning) + '</div></details>';
    } else {
      if (!msg._cachedReasoningHtml || msg._cachedReasoningHtml.indexOf('katex-pending') !== -1) {
        var renderedReasoning = renderMd(msg.reasoning);
        if (renderedReasoning.indexOf('katex-pending') === -1) {
          msg._cachedReasoningHtml = renderedReasoning;
        }
        reasoningHtml = '<details class="reasoning-block"><summary>思考过程</summary><div class="reasoning-content">' + renderedReasoning + '</div></details>';
      } else {
        reasoningHtml = '<details class="reasoning-block"><summary>思考过程</summary><div class="reasoning-content">' + msg._cachedReasoningHtml + '</div></details>';
      }
    }
  }

  var statsHtml = '';
  if (!isUser) {
    // 兼容新版 usageStats 与旧版 cacheStats（仅命中/未命中）
    var stats = msg.usageStats || (msg.cacheStats ? { hit: msg.cacheStats.hit, miss: msg.cacheStats.miss } : null);
    if (stats) {
      var parts = [];
      if (typeof stats.prompt === 'number') {
        var s = '输入 ' + fmtTokens(stats.prompt);
        if (typeof stats.completion === 'number') {
          s += ' · 输出 ' + fmtTokens(stats.completion);
          if (typeof stats.reasoning === 'number' && stats.reasoning > 0) s += '（思考 ' + fmtTokens(stats.reasoning) + '）';
        }
        if (typeof stats.total === 'number') s += ' · 共 ' + fmtTokens(stats.total);
        parts.push(s);
      }
      if (typeof stats.hit === 'number' && typeof stats.miss === 'number' && stats.hit + stats.miss > 0) {
        parts.push('缓存命中 ' + Math.round(stats.hit / (stats.hit + stats.miss) * 100) + '% · 命中 ' + fmtTokens(stats.hit) + ' / 未命中 ' + fmtTokens(stats.miss));
      } else if (typeof stats.cached === 'number') {
        // cached_tokens 字段存在即显示（0 也显示，便于观察缓存是否生效）
        var cStr = '缓存命中';
        if (typeof stats.prompt === 'number' && stats.prompt > 0) cStr += ' ' + Math.round(stats.cached / stats.prompt * 100) + '%';
        if (stats.cached > 0) cStr += ' · ' + fmtTokens(stats.cached);
        parts.push(cStr);
      }
      if (parts.length) statsHtml = '<div class="cache-stats">' + parts.join(' · ') + '</div>';
    }
  }

  var branchBtn = '<button class="message-branch-btn" title="从此处创建分支对话" aria-label="从此处创建分支对话"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v12a3 3 0 0 0 3 3h9"/><path d="M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/><path d="M18 15l3 3-3 3"/><path d="M18 3h3v3"/><path d="M21 3l-6 6"/></svg></button>';
  var editBtn = isUser ? '<button class="message-edit-btn" title="编辑消息"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' : '';
  var copyBtn = '<button class="message-copy-btn" title="复制内容"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>';
  var delBtn = '<button class="message-del-btn" title="删除该消息"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
  var regenTitle = isUser ? '重新生成（从此消息重新请求）' : '重新生成（将删除此回复及其后的消息）';
  var regenBtn = '<button class="message-regen-btn" title="' + regenTitle + '" aria-label="重新生成"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>';

  var interruptHtml = (!isUser && msg.interrupted) ? '<span class="msg-interrupted-badge">' + (msg.interrupted === 'stopped' ? '已停止' : '已中断') + '</span>' : '';
  var streamingHtml = (!isUser && msg.streaming) ? '<span class="msg-interrupted-badge">生成中</span>' : '';

  var roleHtml = isUser ? '你' : 'AI 助手' + (replyModel ? '<span class="message-model">· ' + esc(replyModel) + '</span>' : '');
  el.innerHTML = '<div class="message-avatar">' + (isUser ? 'You' : 'AI') + '</div><div class="message-body"><div class="message-head"><div class="message-role">' + roleHtml + '</div>' + interruptHtml + streamingHtml + branchBtn + copyBtn + regenBtn + editBtn + delBtn + '</div>' + reasoningHtml + '<div class="message-content">' + (msg.streaming && !txt && !reasoningHtml ? '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>' : '') + txt + imgs + filesHtml + '</div>' + statsHtml + '</div>';

  el.querySelectorAll('.message-image-wrapper').forEach(function (w) {
    w.addEventListener('click', function () { dom.imageOverlayImg.src = this.dataset.src; dom.imageOverlay.classList.add('active'); });
  });

  if (!msg.streaming && (!msg._cachedHtml || msg._cachedHtml.indexOf('katex-pending') === -1)) {
    msg._cachedElement = el;
  }
  return el;
}

function appendBubble(msg, idx) {
  var el = createBubbleElement(msg, idx);
  dom.messagesContainer.appendChild(el);
  return el;
}

// ─── Markdown + KaTeX ───────────────────────────────────────────

function setupMarkdown() {
  if (typeof marked === 'undefined') return;

  // GFM (tables/task lists/strikethrough/autolink) + preserve single line breaks
  marked.setOptions({ gfm: true, breaks: true });

  // marked 当前版本的内置规则允许单个 ~ 作为删除线起止符（~~?），
  // AI 普通文本中的成对波浪号因此可能误触发删除线。按 CommonMark/GFM
  // 规范收紧为必须使用成对的 ~~，普通 -、~、范围表达式不再被误删。
  marked.use({
    tokenizer: {
      del: function (src) {
        var m = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~]))\1(?=[^~]|$)/.exec(src);
        if (!m) return undefined;
        return { type: 'del', raw: m[0], text: m[2], tokens: this.lexer.inlineTokens(m[2]) };
      }
    }
  });

  // 嵌套围栏 tokenizer（覆盖 marked 的 fences：围栏代码块专用，不会并入段落）：
  // 与 renderMath 的代码块保护规则一致——带语言的 ``` 行视为嵌套开启、
  // 纯反引号行闭合栈顶围栏，使「外层代码块内含 ``` 示例」渲染为单个完整代码块而非被拆成多块
  marked.use({
    tokenizer: {
      fences: function (src) {
        var cap = /^ {0,3}(`{3,}|~{3,})([^\n]*)(?:\n|$)/.exec(src);
        if (!cap) return false; // false 才会回退到默认 fences tokenizer（缩进代码走默认 code）
        var ch = cap[1][0], need = cap[1].length, lang = (cap[2] || '').trim();
        var restLines = src.slice(cap[0].length).split('\n');
        var contentLines = [];
        var stack = [{ ch: ch, need: need }];
        var closer = null;
        for (var i = 0; i < restLines.length; i++) {
          var l = restLines[i];
          var fm = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(l);
          if (fm && fm[1][0] === ch) {
            var info = (fm[2] || '').trim();
            if (info) { stack.push({ ch: ch, need: fm[1].length }); contentLines.push(l); continue; }
            var top = stack[stack.length - 1];
            if (fm[1].length >= top.need) {
              stack.pop();
              if (!stack.length) { closer = l; break; }
              contentLines.push(l); continue;
            }
          }
          contentLines.push(l);
        }
        var text = contentLines.join('\n');
        var raw = cap[0] + text + (closer ? '\n' + closer + '\n' : (text ? '\n' : ''));
        return { type: 'code', raw: raw, lang: lang, text: text, codeBlockStyle: 'fenced' };
      }
    }
  });

  if (typeof hljs !== 'undefined') {
    // Verilog-A / SystemVerilog: hljs has no dedicated grammar — reuse the verilog one
    if (hljs.getLanguage('verilog') && typeof hljs.registerAliases === 'function') {
      try {
        hljs.registerAliases(['veriloga', 'verilog-a', 'verilog-ams', 'verilog_a', 'systemverilog', 'sv'], { languageName: 'verilog' });
      } catch (e) {}
    }
    marked.use({
      renderer: {
        code: function (token) {
          // marked v5+ removed the `highlight` option; override the code renderer instead
          var lang = (token.lang || '').split(/\s+/)[0].toLowerCase();
          var code = token.text;
          var inner = '';
          // 流式轻量模式（MARKDOWN_LIGHT）跳过语法高亮：hljs 是流式重渲染的最大开销，
          // 结束后会做一次完整渲染补上高亮
          if (!MARKDOWN_LIGHT) {
            var MAX_HL_LEN = 25000;
            if (code.length > MAX_HL_LEN) {
              // 超长代码块（如大数据、全量日志）跳过耗时的全文高亮，避免正则回溯阻塞主线程数百毫秒
              inner = esc(code);
            } else if (lang && hljs.getLanguage(lang)) {
              try { inner = hljs.highlight(code, { language: lang }).value; } catch (e) {}
            } else if (code.trim()) {
              try {
                // 常见语言子集探测，避免 highlightAuto 盲目遍历 40+ 语言语法导致 CPU 跑满
                var COMMON_SUBSET = ['javascript', 'typescript', 'python', 'json', 'bash', 'sh', 'html', 'css', 'sql', 'cpp', 'c', 'java', 'verilog', 'markdown'];
                var auto = hljs.highlightAuto(code.slice(0, 1500), COMMON_SUBSET);
                inner = auto.language ? hljs.highlight(code, { language: auto.language }).value : '';
              } catch (e) {}
            }
          }
          if (!inner) inner = esc(code);
          var label = (lang && hljs.getLanguage(lang)) ? lang : '';
          var header = '<div class="code-block-header"><span class="code-lang">' + esc(label) + '</span><button class="code-copy-btn" type="button"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>复制</span></button></div>';
          return '<div class="code-block">' + header + '<pre><code class="hljs">' + inner + '</code></pre></div>';
        }
      }
    });
  }

  if (typeof markedFootnote !== 'undefined') {
    marked.use(markedFootnote());
  }

  // 修复：CommonMark 分隔符规则要求闭合 ** 前不可为标点、后不可为文字，
  // 导致中文常见写法「**加粗：**后面」加粗失效（原样输出 **）。
  // 该场景下按用户意图渲染为强调；其余情况仍交给内置规则。
  // 不支持 Unicode 属性转义 \p{P} 的旧运行时会抛错，降级为不注册扩展而非阻断整个应用
  try {
    marked.use({
      extensions: [
        {
          name: 'strongCjk',
          level: 'inline',
          start: function (src) { var i = src.indexOf('**'); return i === -1 ? undefined : i; },
          tokenizer: function (src) {
            var m = /^\*\*([^*\n]+[^\s*])\*\*(?!\s)/.exec(src);
            if (!m || !/[\p{P}\p{S}]$/u.test(m[1])) return undefined;
            return { type: 'strongCjk', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
          },
          renderer: function (token) { return '<strong>' + this.parser.parseInline(token.tokens) + '</strong>'; }
        },
        {
          name: 'emCjk',
          level: 'inline',
          start: function (src) { var i = src.indexOf('*'); return i === -1 ? undefined : i; },
          tokenizer: function (src) {
            var m = /^\*([^*\n]+[^\s*])\*(?!\s)/.exec(src);
            if (!m || !/[\p{P}\p{S}]$/u.test(m[1])) return undefined;
            return { type: 'emCjk', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
          },
          renderer: function (token) { return '<em>' + this.parser.parseInline(token.tokens) + '</em>'; }
        }
      ]
    });
  } catch (e) {}
}

function renderMath(text, opts) {
  opts = opts || {};
  if (!text) return '';

  // 极速快路径：如果文本中既没有 $ 也没有反斜杠（无 LaTeX 公式定界符 \(、\[、$、$$），
  // 完全跳过所有逐行围栏提取和占位符正则，直接进入 Markdown 解析，节省 70%+ CPU 开销
  var hasMathDelim = text.indexOf('$') !== -1 || text.indexOf('\\') !== -1;
  if (!hasMathDelim) {
    var fastHtml;
    if (typeof marked === 'undefined') {
      fastHtml = '<p style="white-space:pre-wrap">' + esc(text) + '</p>';
    } else {
      try {
        fastHtml = marked.parse(text);
      } catch (e) { fastHtml = '<p style="white-space:pre-wrap">' + esc(text) + '</p>'; }
      if (typeof DOMPurify !== 'undefined') {
        try {
          fastHtml = DOMPurify.sanitize(fastHtml, {
            FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'option', 'link', 'meta', 'base'],
            FORBID_ATTR: ['style']
          });
        } catch (e) {}
      }
    }
    return fastHtml;
  }

  // Render $$...$$ / \[...\] (display math) and $...$ / \(...\) (inline math) with KaTeX
  // Strategy: extract math blocks → replace with placeholders → run marked → restore with KaTeX HTML
  var placeholders = [];
  var idx = 0;

  // 1. Protect code blocks (```...```) from math processing
  // 按「嵌套围栏」规则逐行配对：带语言的 ``` 行一律视为嵌套开启，纯反引号行闭合栈顶围栏。
  // 这样模型在代码块里嵌入示例（内容中再出现 ```）时，外层块不会中途断开成好几块，
  // 而是整体作为一个代码块渲染；普通连续代码块行为不变。
  // 围栏紧跟在文字/冒号后（如"例如：```verilog"）时先拆行，使其按代码块渲染
  var codeBlocks = [];
  if (text.indexOf('```') !== -1 || text.indexOf('~~~') !== -1) {
    (function () {
      var lines = text.split('\n');
      var out = [];
      var content = null, stack = null;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var m = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
        if (!m && content === null) {
          var mm = /^(.+?)([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line);
          if (mm) { out.push(mm[1]); line = mm[3] + mm[4]; m = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line); }
        }
        if (!m) { if (content) content.push(line); else out.push(line); continue; }
        var ch = m[1][0], need = m[1].length, info = (m[2] || '').trim();
        if (content === null) { content = [line]; stack = [{ ch: ch, need: need }]; continue; }
        if (info) { stack.push({ ch: ch, need: need }); content.push(line); continue; }
        var top = stack[stack.length - 1];
        if (ch === top.ch && m[1].length >= top.need) {
          content.push(line); stack.pop();
          if (!stack.length) {
            codeBlocks.push(content.join('\n'));
            out.push('\x00CODE' + (codeBlocks.length - 1) + '\x00');
            content = null; stack = null;
          }
        } else {
          content.push(line);
        }
      }
      if (content) { codeBlocks.push(content.join('\n')); out.push('\x00CODE' + (codeBlocks.length - 1) + '\x00'); }
      text = out.join('\n');
    })();
  }

  // 2. Protect inline code (`...`) from math processing
  var inlineCodes = [];
  if (text.indexOf('`') !== -1) {
    text = text.replace(/`[^`]+`/g, function (match) {
      inlineCodes.push(match);
      return '\x01ICODE' + (inlineCodes.length - 1) + '\x01';
    });
  }

  // 3. Extract \[...\] display math (LaTeX standard)
  if (text.indexOf('\\[') !== -1) {
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, function (_, formula) {
      var id = 'MATH' + (idx++);
      placeholders.push({ id: id, type: 'display', formula: formula.trim() });
      return '⟦' + id + '⟧';
    });
  }

  // 4. Extract $$...$$ display math
  if (text.indexOf('$$') !== -1) {
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, function (_, formula) {
      var id = 'MATH' + (idx++);
      placeholders.push({ id: id, type: 'display', formula: formula.trim() });
      return '⟦' + id + '⟧';
    });
  }

  // 5. Extract \(...\) inline math (LaTeX standard)
  if (text.indexOf('\\(') !== -1) {
    text = text.replace(/\\\((.+?)\\\)/g, function (_, formula) {
      var id = 'MATH' + (idx++);
      placeholders.push({ id: id, type: 'inline', formula: formula.trim() });
      return '⟦' + id + '⟧';
    });
  }

  // 6. Extract $...$ inline math (but not $ within numbers like $100)
  if (text.indexOf('$') !== -1) {
    text = text.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g, function (_, formula) {
      // 纯数字/分隔符内容（如 $5-$8、$3.5、$2024）是货币/编号而非公式
      if (/^\d[\d.,\-~+\s]*$/.test(formula.trim())) return _;
      var id = 'MATH' + (idx++);
      placeholders.push({ id: id, type: 'inline', formula: formula.trim() });
      return '⟦' + id + '⟧';
    });
  }

  // 7. Restore code before markdown parsing, so marked renders real <pre><code>
  if (codeBlocks.length > 0) {
    text = text.replace(/\x00CODE(\d+)\x00/g, function (_, i) { return codeBlocks[parseInt(i)]; });
  }
  if (inlineCodes.length > 0) {
    text = text.replace(/\x01ICODE(\d+)\x01/g, function (_, i) { return inlineCodes[parseInt(i)]; });
  }

  // 8. Render markdown on the sanitized text
  var html;
  if (typeof marked === 'undefined') {
    html = '<p style="white-space:pre-wrap">' + esc(text) + '</p>';
  } else {
    try {
      html = marked.parse(text);
    } catch (e) { html = '<p style="white-space:pre-wrap">' + esc(text) + '</p>'; }
    // 模型输出属于不可信输入：marked 不清理 HTML，必须过白名单清洗（去掉 script/事件属性/javascript: 链接等）。
    // 公式占位符是纯文本（⟦MATHn⟧），清洗后由步骤 9 原位替换为 KaTeX 输出
    if (typeof DOMPurify !== 'undefined') {
      try {
        html = DOMPurify.sanitize(html, {
          FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'option', 'link', 'meta', 'base'],
          FORBID_ATTR: ['style']
        });
      } catch (e) {}
    }
  }

  // 9. Render math with KaTeX
  // 轻量模式（流式中）或库未加载时不调用 renderToString（CPU 开销大且首屏体积高），
  // 以 .katex-pending 占位显示公式原文，KaTeX 懒加载完成后统一补渲染
  if (!opts.light && typeof katex !== 'undefined') {
    for (var i = 0; i < placeholders.length; i++) {
      var ph = placeholders[i];
      try {
        var rendered = ph.type === 'display'
          ? katex.renderToString(ph.formula, { displayMode: true, throwOnError: false })
          : katex.renderToString(ph.formula, { displayMode: false, throwOnError: false });
        html = html.replace('⟦' + ph.id + '⟧', function () { return rendered; });
      } catch (e) {
        html = html.replace('⟦' + ph.id + '⟧', function () { return '<code>' + esc(ph.formula) + '</code>'; });
      }
    }
  } else if (placeholders.length) {
    if (typeof katex === 'undefined') ensureKatex().catch(function () {});
    for (var j = 0; j < placeholders.length; j++) {
      var ph2 = placeholders[j];
      html = html.replace('⟦' + ph2.id + '⟧', function () {
        return '<span class="katex-pending" data-f="' + esc(ph2.formula) + '" data-d="' + (ph2.type === 'display' ? '1' : '0') + '">' + esc(ph2.formula) + '</span>';
      });
    }
  }

  // Safety net: never let a placeholder marker leak into output if a restore ever fails
  html = html.replace(/\x00CODE\d+\x00|\x01ICODE\d+\x01|⟦MATH\d+⟧/g, '');

  return html;
}

// 流式轻量渲染开关：由 renderMd 在调用前后切换，marked 的 code renderer 据此跳过 hljs 高亮
var MARKDOWN_LIGHT = false;

function renderMd(text, opts) {
  opts = opts || {};
  var prev = MARKDOWN_LIGHT;
  MARKDOWN_LIGHT = !!opts.light;
  try { return renderMath(text, opts); } finally { MARKDOWN_LIGHT = prev; }
}

// KaTeX 加载保障（优先直接使用 index.html 预加载的 KaTeX，未就绪时动态异步兜底）
var katexPromise = null;
function ensureKatex() {
  if (typeof katex !== 'undefined') return Promise.resolve();
  if (!katexPromise) {
    katexPromise = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[href*="katex.min.css"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'js/vendor/katex/katex.min.css';
        document.head.appendChild(link);
      }
      var s = document.createElement('script');
      s.src = 'js/vendor/katex/katex.min.js';
      s.onload = function () { resolve(); flushPendingKatex(); };
      s.onerror = function () { katexPromise = null; reject(new Error('公式渲染库加载失败')); };
      document.head.appendChild(s);
    });
  }
  return katexPromise;
}

// 补渲染页面上所有占位公式（元素原位替换，不丢滚动位置）并清除受污染的 pending 缓存
function flushPendingKatex() {
  if (typeof katex === 'undefined') return;
  var pendings = document.querySelectorAll('.katex-pending');
  if (pendings.length > 0) {
    pendings.forEach(function (el) {
      try {
        var disp = el.dataset.d === '1';
        var formula = el.dataset.f;
        if (formula !== undefined && formula !== null) {
          el.outerHTML = katex.renderToString(formula, { displayMode: disp, throwOnError: false });
        }
      } catch (e) {}
    });
  }
  // 清除受 katex-pending 污染的内存缓存，确保下次切换对话时重新生成有效 KaTeX 缓存
  if (state.currentMessages && state.currentMessages.length) {
    state.currentMessages.forEach(function (m) {
      if (!m) return;
      if (m._cachedHtml && m._cachedHtml.indexOf('katex-pending') !== -1) {
        delete m._cachedHtml;
        delete m._cachedElement;
      }
      if (m._cachedReasoningHtml && m._cachedReasoningHtml.indexOf('katex-pending') !== -1) {
        delete m._cachedReasoningHtml;
        delete m._cachedElement;
      }
    });
  }
}

// Auto-scroll to bottom; unless force, respect the user having scrolled up (e.g. during streaming)
function scrollBottom(force) {
  if (!force && state.userScrollAway) return;
  requestAnimationFrame(function () {
    dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
  });
}

dom.messagesContainer.addEventListener('scroll', function () {
  var el = dom.messagesContainer;
  state.userScrollAway = (el.scrollHeight - el.scrollTop - el.clientHeight) > 120;
  if (!state.isProgrammaticScrolling && el.scrollTop < 80 && state.renderedMessageStart > 0) {
    loadEarlierMessages();
  }
}, { passive: true });

// ─── Edit & Resend ──────────────────────────────────────────────

function enterEditMode(el) {
  if (state.isStreaming) return;
  var idx = parseInt(el.dataset.index);
  if (isNaN(idx) || idx >= state.currentMessages.length) return;
  var msg = state.currentMessages[idx];
  if (msg.role !== 'user') return;

  var contentEl = el.querySelector('.message-content');
  if (!contentEl) return;
  el._originalContent = contentEl.innerHTML;

  var imgsHtml = '';
  if (msg.images && msg.images.length) {
    imgsHtml = '<div class="message-images">' + msg.images.map(function (i) { return '<div class="message-image-wrapper" data-src="' + esc(i) + '"><img src="' + esc(i) + '" alt="img" loading="lazy"></div>'; }).join('') + '</div>';
  }

  contentEl.innerHTML = '<textarea class="edit-textarea">' + esc(msg.text || '') + '</textarea>' + imgsHtml
    + '<div class="edit-actions"><button class="btn-edit-cancel">取消</button><button class="btn-edit-save"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> 发送</button></div>';

  var textarea = contentEl.querySelector('.edit-textarea');
  textarea.focus();
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  textarea.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
  });
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); resendFromMessage(el, idx); }
    if (e.key === 'Escape') { exitEditMode(el); }
  });

  contentEl.querySelectorAll('.message-image-wrapper').forEach(function (w) {
    w.addEventListener('click', function () { dom.imageOverlayImg.src = this.dataset.src; dom.imageOverlay.classList.add('active'); });
  });

  var editBtn = el.querySelector('.message-edit-btn');
  if (editBtn) editBtn.style.display = 'none';
}

// 删除单条消息：删用户消息时连带删除其后的 AI 回复；删 AI 回复只删本条
function deleteMessage(idx) {
  if (state.isStreaming) return;
  var msgs = state.currentMessages;
  if (idx < 0 || idx >= msgs.length) return;
  var count = 1;
  if (msgs[idx].role === 'user' && msgs[idx + 1] && msgs[idx + 1].role === 'assistant') count = 2;
  msgs.splice(idx, count);
  // 移除对应 DOM 气泡，保留滚动位置
  var container = dom.messagesContainer;
  for (var i = idx; i < idx + count; i++) {
    var el = container.querySelector('.message[data-index="' + i + '"]');
    if (el) el.remove();
  }
  // 后续气泡的 data-index 前移，保证速览跳转仍准确
  for (var j = idx; j < msgs.length; j++) {
    var el2 = container.querySelector('.message[data-index="' + (j + count) + '"]');
    if (el2) el2.dataset.index = j;
  }
  persistConvo();
  renderSidebar();
  renderChatOutline();
  if (!msgs.length) {
    showWelcome();
    dom.conversationTitle.textContent = 'New Chat';
  }
}

function exitEditMode(el) {
  var contentEl = el.querySelector('.message-content');
  if (contentEl && el._originalContent) {
    contentEl.innerHTML = el._originalContent;
    delete el._originalContent;
  }
  var editBtn = el.querySelector('.message-edit-btn');
  if (editBtn) editBtn.style.display = '';
}

async function resendFromMessage(el, idx) {
  if (state.isStreaming) return;
  var textarea = el.querySelector('.edit-textarea');
  if (!textarea) return;
  var newText = textarea.value.trim();
  var msg = state.currentMessages[idx];
  if (!newText && !(msg && ((msg.images && msg.images.length) || (msg.files && msg.files.length)))) return;

  var group = getActiveGroup();
  if (!group.apiKey) { showToast('请先在设置中为配置组「' + group.name + '」配置 API Key', 'error'); return; }

  state.currentMessages.splice(idx);
  var updatedMsg = { role: 'user', text: newText, images: msg.images || [], files: msg.files || [], timestamp: new Date().toISOString() };
  state.currentMessages.push(updatedMsg);
  renderMessages();
  persistConvo();
  renderSidebar();

  var result = await streamApiResponse();
  if (result && result.failedNoData) restoreFailedSend({
    failedNoData: true,
    convoId: state.currentConvoId,
    userMsg: updatedMsg,
    text: newText,
    images: updatedMsg.images || [],
    files: updatedMsg.files || [],
    previousTitle: null
  });
}

// 针对不支持原生 PDF 多模态文件传输的旧网关或纯文本模型，将 type: 'file' / 'input_file' 平滑降级为提取的纯文本分片
function downgradeNativeFilesToText(body) {
  var changed = false;
  if (!body) return false;

  // 1. Chat Completions 协议中的 messages 数组
  if (Array.isArray(body.messages)) {
    for (var i = 0; i < body.messages.length; i++) {
      var m = body.messages[i];
      if (Array.isArray(m.content)) {
        for (var j = 0; j < m.content.length; j++) {
          var part = m.content[j];
          if (part && part.type === 'file' && part.file) {
            var fileName = part.file.filename || '文档.pdf';
            var foundText = '';
            for (var mi = 0; mi < state.currentMessages.length; mi++) {
              var origM = state.currentMessages[mi];
              if (Array.isArray(origM.files)) {
                for (var fi = 0; fi < origM.files.length; fi++) {
                  if (origM.files[fi].name === fileName) {
                    foundText = origM.files[fi].text || '';
                    break;
                  }
                }
              }
              if (foundText) break;
            }
            m.content[j] = {
              type: 'text',
              text: '\n\n【附件：' + fileName + '】\n' + (foundText || '（该网关不支持原生多模态 PDF 直传，已自动降级为文本分片）') + '\n【附件结束】'
            };
            changed = true;
          }
        }
      }
    }
  }

  // 2. Responses API 协议中的 input 数组
  if (Array.isArray(body.input)) {
    for (var k = 0; k < body.input.length; k++) {
      var item = body.input[k];
      if (Array.isArray(item.content)) {
        for (var l = 0; l < item.content.length; l++) {
          var itemPart = item.content[l];
          if (itemPart && itemPart.type === 'input_file') {
            var fName = itemPart.filename || '文档.pdf';
            var fText = '';
            for (var mIdx = 0; mIdx < state.currentMessages.length; mIdx++) {
              var currM = state.currentMessages[mIdx];
              if (Array.isArray(currM.files)) {
                for (var fIdx = 0; fIdx < currM.files.length; fIdx++) {
                  if (currM.files[fIdx].name === fName) {
                    fText = currM.files[fIdx].text || '';
                    break;
                  }
                }
              }
              if (fText) break;
            }
            item.content[l] = {
              type: 'input_text',
              text: '\n\n【附件：' + fName + '】\n' + (fText || '（该网关不支持原生多模态 PDF 直传，已自动降级为文本分片）') + '\n【附件结束】'
            };
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

async function streamApiResponse() {
  setInputEnabled(false);
  state.isStreaming = true;

  var loadingEl = createLoading();
  dom.messagesContainer.appendChild(loadingEl);
  scrollBottom(true);

  // 等待/思考/生成状态提示：随机情绪化短语 + 秒数计时 + 停止按钮
  // 思考链模型（如 deepseek-reasoner）先输出 reasoning_content，再输出正文
  var WAIT_PHRASES = ['正在等待模型响应…', '正在翻开笔记本…', '冲杯咖啡等一等…', '正在加载智慧…', '摸鱼中，马上回来'];
  var THINK_PHRASES = ['模型思考中…', '深度推理中，别急…', '正在权衡各种可能…', '大脑高速运转…', '快要想明白了…'];
  var STREAM_PHRASES = ['正在生成回答…', '正在奋笔疾书…', '灵感正在输出…', '快好了，正在收尾…'];
  var statusEl = loadingEl.querySelector('.loading-status');
  var stopBtn = loadingEl.querySelector('.loading-stop');
  var loadingStart = Date.now();
  var streamPhase = 'wait'; // wait → think（收到思考内容）→ stream（收到正文）
  var phasePhrase = WAIT_PHRASES[Math.floor(Math.random() * WAIT_PHRASES.length)];
  var lastPhraseSec = 0;
  if (stopBtn) stopBtn.addEventListener('click', stopStreaming);
  var statusTimer = setInterval(function () {
    if (!loadingEl.parentNode) { clearInterval(statusTimer); return; }
    var sec = Math.round((Date.now() - loadingStart) / 1000);
    // 每个阶段随机挑一句，等待阶段每 5 秒换一句
    if (sec - lastPhraseSec >= 5) {
      lastPhraseSec = sec;
      var list = streamPhase === 'think' ? THINK_PHRASES : (streamPhase === 'stream' ? STREAM_PHRASES : WAIT_PHRASES);
      phasePhrase = list[Math.floor(Math.random() * list.length)];
    }
    statusEl.textContent = phasePhrase + '（' + sec + ' 秒）';
    statusEl.classList.toggle('thinking', streamPhase === 'think');
  }, 1000);

  var convoId = state.currentConvoId;
  var model = getModel();
  var group = getActiveGroup();
  var activeProtocol = determineApiProtocol(group);
  var endpoint = resolveApiEndpoint(group.apiBase, activeProtocol);
  var body = activeProtocol === 'responses'
    ? buildResponsesBody(state.currentMessages, model, true)
    : buildBody(state.currentMessages, model, true);

  // 将流式中的 AI 消息先挂到原会话，切换聊天后仍能渲染已收到的部分。
  var streamConvo = state.conversations.find(function (c) { return c.id === convoId; });
  var streamingMsg = {
    role: 'assistant',
    model: model,
    text: '',
    images: [],
    reasoning: null,
    streaming: true,
    timestamp: new Date().toISOString()
  };
  if (streamConvo) {
    streamConvo.messages = streamConvo.messages || state.currentMessages;
    streamConvo.messages.push(streamingMsg);
  }
  state.abortController = new AbortController();
  var assistantText = '';
  var reasoningText = '';
  var lastUsage = null;
  var failedNoData = false;

  // 流式渲染节流：限制为每 40ms（约 25fps）最多解析重绘一次。
  // 逐 chunk 全量重跑 Markdown/KaTeX/hljs 是流式卡顿的主因，节流合并可大幅降低 80% CPU 占用且肉眼极其流畅
  var streamRenderTimer = null;
  var lastStreamRenderTime = 0;
  var STREAM_RENDER_INTERVAL = 40;
  var lastRenderedText = '';
  var lastRenderedReasoning = '';

  function doStreamRender() {
    streamRenderTimer = null;
    lastStreamRenderTime = performance.now();
    // 即使切换了聊天，也先更新会话里的流式消息；切回时可直接显示已收到的内容。
    streamingMsg.text = assistantText;
    streamingMsg.reasoning = reasoningText || null;
    if (!loadingEl.parentNode) {
      if (state.currentConvoId === convoId) {
        var draftIndex = state.currentMessages.indexOf(streamingMsg);
        var draftEl = draftIndex >= 0 ? dom.messagesContainer.querySelector('.message[data-index="' + draftIndex + '"]') : null;
        if (draftEl) draftEl.remove();
        if (draftIndex >= 0) appendBubble(streamingMsg, draftIndex);
      }
      return;
    }
    if (lastRenderedText === assistantText && lastRenderedReasoning === reasoningText) return;
    lastRenderedText = assistantText;
    lastRenderedReasoning = reasoningText;
    updateLoading(loadingEl, assistantText, reasoningText, true);
    if (!state.userScrollAway) {
      dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
    }
  }

  function getStreamRenderInterval(len) {
    if (len > 4000) return 90;
    if (len > 1500) return 65;
    return 40;
  }

  function scheduleStreamRender() {
    var now = performance.now();
    var elapsed = now - lastStreamRenderTime;
    var interval = getStreamRenderInterval(assistantText.length + reasoningText.length);
    if (elapsed >= interval) {
      if (streamRenderTimer) { cancelAnimationFrame(streamRenderTimer); clearTimeout(streamRenderTimer); streamRenderTimer = null; }
      streamRenderTimer = requestAnimationFrame(doStreamRender);
    } else if (!streamRenderTimer) {
      streamRenderTimer = setTimeout(function () {
        streamRenderTimer = requestAnimationFrame(doStreamRender);
      }, interval - elapsed);
    }
  }

  var reqHeaders = {
    'Content-Type': 'application/json'
  };
  if (group.apiKey && group.apiKey.trim()) {
    reqHeaders['Authorization'] = 'Bearer ' + group.apiKey.trim();
  }

  try {
    var reqResult = await executeSmartApiRequest(endpoint, reqHeaders, body, state.abortController.signal);
    var res = reqResult.res;
    var activeRoute = reqResult.route;

    // 400 兼容降级重试：
    // 1. 部分网关不识别 stream_options
    // 2. 部分网关不识别 max_output_tokens 或 instructions
    if (!res.ok && res.status === 400) {
      var bodyChanged = false;
      if (body.stream_options) {
        delete body.stream_options;
        bodyChanged = true;
      }
      if (body.max_output_tokens && !body.max_tokens) {
        body.max_tokens = body.max_output_tokens;
        delete body.max_output_tokens;
        bodyChanged = true;
      }
      if (body.instructions && Array.isArray(body.input)) {
        body.input.unshift({ role: 'system', content: body.instructions });
        delete body.instructions;
        bodyChanged = true;
      }
      if (downgradeNativeFilesToText(body)) {
        bodyChanged = true;
        console.warn('当前网关或模型不支持原生 PDF 视觉解析 (400)，已自动降级为文本分片重试...');
      }
      if (bodyChanged) {
        var retryResult = await executeSmartApiRequest(endpoint, reqHeaders, body, state.abortController.signal, activeRoute);
        res = retryResult.res;
        activeRoute = retryResult.route;
      }
    }

    // auto 模式智能回退：若端点报 404 (Not Found) 或 405 (Method Not Allowed)，尝试另一协议
    if (!res.ok && (res.status === 404 || res.status === 405) && (group.apiProtocol === 'auto' || !group.apiProtocol)) {
      var fallbackProto = activeProtocol === 'responses' ? 'chat' : 'responses';
      var fallbackEndpoint = resolveApiEndpoint(group.apiBase, fallbackProto);
      if (fallbackEndpoint !== endpoint) {
        var fallbackBody = fallbackProto === 'responses'
          ? buildResponsesBody(state.currentMessages, model, true)
          : buildBody(state.currentMessages, model, true);
        var fallbackResult = await executeSmartApiRequest(fallbackEndpoint, reqHeaders, fallbackBody, state.abortController.signal, activeRoute);
        var fallbackRes = fallbackResult.res;
        if (fallbackRes.ok) {
          res = fallbackRes;
          activeProtocol = fallbackProto;
          endpoint = fallbackEndpoint;
          activeRoute = fallbackResult.route;
        }
      }
    }

    if (!res.ok) {
      var errText = await res.text();
      var cleanErr = '';
      if (errText.indexOf('<html') !== -1 || errText.indexOf('<!DOCTYPE') !== -1) {
        var titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(errText);
        var pageTitle = titleMatch ? titleMatch[1].trim() : '';
        var plainBody = errText.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                               .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                               .replace(/<[^>]+>/g, ' ')
                               .replace(/\s+/g, ' ').trim();
        cleanErr = (pageTitle ? pageTitle + ': ' : '') + (plainBody.slice(0, 120) || '安全网关拒绝访问');
      } else {
        try {
          var errJson = JSON.parse(errText);
          cleanErr = (errJson.error && (errJson.error.message || errJson.error)) || errText.slice(0, 180);
        } catch (_) {
          cleanErr = errText.slice(0, 180);
        }
      }
      if (!cleanErr) {
        if (res.status === 404) cleanErr = '端点未找到 (404 Not Found)，请检查 API Base 地址或接口协议';
        else if (res.status === 401) cleanErr = '认证失败，API Key 无效或未授权';
        else if (res.status === 403) cleanErr = '访问被拒绝 (403 Forbidden)，目标网关阻断请求';
        else if (res.status === 502) cleanErr = '网关转发失败 (502 Bad Gateway)';
        else cleanErr = 'HTTP ' + res.status + ' 错误';
      }
      throw new Error('API ' + res.status + ' (' + cleanErr + ')');
    }

    var isSse = (res.headers.get('content-type') || '').indexOf('text/event-stream') !== -1;

    if (isSse) {
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var currentEvent = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (var li = 0; li < lines.length; li++) {
          var rawLine = lines[li];
          var trimmed = rawLine.trim();

          if (rawLine.indexOf('event:') === 0 || rawLine.indexOf('event: ') === 0) {
            currentEvent = rawLine.replace(/^event:\s*/, '').trim();
            continue;
          }
          if (!trimmed) {
            currentEvent = '';
            continue;
          }
          if (rawLine.indexOf('data:') === 0 || rawLine.indexOf('data: ') === 0) {
            var data = rawLine.replace(/^data:\s*/, '');
            if (data === '[DONE]') continue;
            try {
              var parsed = JSON.parse(data);
              var chunkResult = extractStreamChunk(parsed, currentEvent);

              if (chunkResult.usage) lastUsage = chunkResult.usage;

              if (chunkResult.reasoning) {
                if (streamPhase === 'wait') {
                  streamPhase = 'think';
                  phasePhrase = THINK_PHRASES[Math.floor(Math.random() * THINK_PHRASES.length)];
                  if (statusEl) { statusEl.textContent = phasePhrase; statusEl.classList.add('thinking'); }
                }
                reasoningText += chunkResult.reasoning;
                scheduleStreamRender();
              }
              if (chunkResult.text) {
                if (streamPhase !== 'stream') {
                  streamPhase = 'stream';
                  phasePhrase = STREAM_PHRASES[Math.floor(Math.random() * STREAM_PHRASES.length)];
                  if (statusEl) { statusEl.textContent = phasePhrase; statusEl.classList.remove('thinking'); }
                }
                assistantText += chunkResult.text;
                scheduleStreamRender();
              }
            } catch (e) {}
          }
        }
      }
    } else {
      // 非流式：部分兼容网关忽略 stream 参数，一次性返回完整 JSON
      var jsonRes = await res.json();
      var parsedFull = parseFullApiResponse(jsonRes);
      if (parsedFull.usage) lastUsage = parsedFull.usage;
      assistantText = parsedFull.text;
      reasoningText = parsedFull.reasoning;
      if (assistantText || reasoningText) { updateLoading(loadingEl, assistantText, reasoningText); scrollBottom(); }
      if (statusEl) {
        statusEl.textContent = STREAM_PHRASES[Math.floor(Math.random() * STREAM_PHRASES.length)];
        statusEl.classList.remove('thinking');
      }
    }

    if (streamRenderTimer) { cancelAnimationFrame(streamRenderTimer); clearTimeout(streamRenderTimer); streamRenderTimer = null; }
    finalizeAssistantMessage(convoId, loadingEl, assistantText, reasoningText, lastUsage, null, model, streamingMsg);
  } catch (e) {
    if (streamRenderTimer) { cancelAnimationFrame(streamRenderTimer); clearTimeout(streamRenderTimer); streamRenderTimer = null; }
    // 中断也保留已生成的部分内容并落库，避免用户损失已显示的文字
    var interrupted = e.name === 'AbortError' ? 'stopped' : 'error';
    var hasPartial = !!(assistantText || reasoningText);
    failedNoData = interrupted === 'error' && !hasPartial;
    finalizeAssistantMessage(convoId, loadingEl, assistantText, reasoningText, null, interrupted, model, streamingMsg);
    var suffix = hasPartial ? '，已保留已生成的内容' : '';
    if (interrupted === 'stopped') {
      showToast('已停止生成' + suffix, 'info');
    } else {
      var errMsg = e.message || '网络连接异常';
      if (errMsg.indexOf('Failed to fetch') !== -1 || e.name === 'TypeError') {
        errMsg = '网络连接失败 / 跨域代理转发受阻（已尝试默认与备用代理网关）';
      }
      showToast('请求失败: ' + errMsg + suffix, 'error');
    }
  }

  clearInterval(statusTimer);
  state.isStreaming = false;
  state.abortController = null;
  setInputEnabled(true);
  scrollBottom();
  return { failedNoData: failedNoData };
}

// 把一次回复提交到对话：流成功结束或中断（error/stopped）共用。
// 中断时保留已生成的部分内容并标记 interrupted，避免用户损失已显示的文字
function finalizeAssistantMessage(convoId, loadingEl, assistantText, reasoningText, lastUsage, interrupted, model, streamingMsg) {
  removeLoading(loadingEl);
  // ollama / 部分网关把思考以 <think>...</think> 标签输出在正文里 → 提取为思考块
  if (!reasoningText && assistantText && assistantText.indexOf('<think>') !== -1) {
    var ext = extractThinkTags(assistantText);
    if (ext.reasoning) { reasoningText = ext.reasoning; assistantText = ext.text; }
  }
  // Always save to the original conversation
  var origConvo = state.conversations.find(function (c) { return c.id === convoId; });
  var draftIndex = origConvo && origConvo.messages ? origConvo.messages.indexOf(streamingMsg) : -1;
  if (!assistantText && !reasoningText) {
    if (origConvo && draftIndex >= 0) {
      origConvo.messages.splice(draftIndex, 1);
      origConvo.messageCount = origConvo.messages.length;
      flushConvoSave(origConvo);
      if (state.currentConvoId === convoId) {
        var emptyDraftEl = dom.messagesContainer.querySelector('.message[data-index="' + draftIndex + '"]');
        if (emptyDraftEl) emptyDraftEl.remove();
      }
    }
    return;
  }
  if (origConvo) {
    // usage 统计：兼容 Chat（prompt_tokens/completion_tokens）与 Responses（input_tokens/output_tokens）
    var usageStats = null;
    if (lastUsage && (
      typeof lastUsage.prompt_tokens === 'number' ||
      typeof lastUsage.input_tokens === 'number' ||
      typeof lastUsage.prompt_cache_hit_tokens === 'number' ||
      typeof lastUsage.total_tokens === 'number'
    )) {
      var promptCount = typeof lastUsage.prompt_tokens === 'number' ? lastUsage.prompt_tokens : (typeof lastUsage.input_tokens === 'number' ? lastUsage.input_tokens : null);
      var completionCount = typeof lastUsage.completion_tokens === 'number' ? lastUsage.completion_tokens : (typeof lastUsage.output_tokens === 'number' ? lastUsage.output_tokens : null);
      var totalCount = typeof lastUsage.total_tokens === 'number' ? lastUsage.total_tokens : ((promptCount !== null && completionCount !== null) ? (promptCount + completionCount) : null);
      var reasoningCount = null;
      if (lastUsage.completion_tokens_details && typeof lastUsage.completion_tokens_details.reasoning_tokens === 'number') {
        reasoningCount = lastUsage.completion_tokens_details.reasoning_tokens;
      } else if (lastUsage.output_token_details && typeof lastUsage.output_token_details.reasoning_tokens === 'number') {
        reasoningCount = lastUsage.output_token_details.reasoning_tokens;
      } else if (lastUsage.output_tokens_details && typeof lastUsage.output_tokens_details.reasoning_tokens === 'number') {
        reasoningCount = lastUsage.output_tokens_details.reasoning_tokens;
      }
      var cachedCount = null;
      if (lastUsage.prompt_tokens_details && typeof lastUsage.prompt_tokens_details.cached_tokens === 'number') {
        cachedCount = lastUsage.prompt_tokens_details.cached_tokens;
      } else if (lastUsage.input_token_details && typeof lastUsage.input_token_details.cached_tokens === 'number') {
        cachedCount = lastUsage.input_token_details.cached_tokens;
      } else if (lastUsage.input_tokens_details && typeof lastUsage.input_tokens_details.cached_tokens === 'number') {
        cachedCount = lastUsage.input_tokens_details.cached_tokens;
      }

      usageStats = {
        prompt: promptCount,
        completion: completionCount,
        total: totalCount,
        reasoning: reasoningCount,
        cached: cachedCount,
        hit: typeof lastUsage.prompt_cache_hit_tokens === 'number' ? lastUsage.prompt_cache_hit_tokens : null,
        miss: typeof lastUsage.prompt_cache_miss_tokens === 'number' ? lastUsage.prompt_cache_miss_tokens : null,
      };
    }
    var assistantMsg = streamingMsg || {
      role: 'assistant',
      model: model || origConvo.model || getModel(),
      text: '',
      images: [],
      reasoning: null,
      timestamp: new Date().toISOString()
    };
    assistantMsg.role = 'assistant';
    assistantMsg.model = model || origConvo.model || getModel();
    assistantMsg.text = assistantText;
    assistantMsg.images = assistantMsg.images || [];
    assistantMsg.reasoning = reasoningText || null;
    assistantMsg.usageStats = usageStats;
    assistantMsg.timestamp = assistantMsg.timestamp || new Date().toISOString();
    delete assistantMsg.streaming;
    delete assistantMsg._cachedHtml;
    delete assistantMsg._cachedReasoningHtml;
    delete assistantMsg._cachedElement;
    if (interrupted) assistantMsg.interrupted = interrupted;
    origConvo.messages = origConvo.messages || [];
    if (origConvo.messages.indexOf(assistantMsg) < 0) origConvo.messages.push(assistantMsg);
    origConvo.updatedAt = new Date().toISOString();
    origConvo.messageCount = origConvo.messages.length;
    var lastMsg = origConvo.messages[origConvo.messages.length - 1];
    origConvo.lastMessage = lastMsg ? (lastMsg.text || (lastMsg.files && lastMsg.files.length ? '[' + lastMsg.files[0].name + ']' : '[图片消息]')).slice(0, 80) : '';
    flushConvoSave(origConvo); // 立即落盘（含清掉 persistConvo 的防抖定时器）
    // Only update UI if still viewing the same conversation
    if (state.currentConvoId === convoId) {
      // 切回当前会话时，先移除之前的流式草稿气泡，再渲染最终消息，避免重复。
      var assistantIndex = state.currentMessages.indexOf(assistantMsg);
      if (assistantIndex < 0) { state.currentMessages.push(assistantMsg); assistantIndex = state.currentMessages.length - 1; }
      var oldAssistantEl = dom.messagesContainer.querySelector('.message[data-index="' + assistantIndex + '"]');
      if (oldAssistantEl) oldAssistantEl.remove();
      delete assistantMsg._cachedHtml;
      delete assistantMsg._cachedReasoningHtml;
      delete assistantMsg._cachedElement;
      appendBubble(assistantMsg, assistantIndex);
      if (!interrupted) {
        // 回复完成彩蛋：输入框祝贺 + 弹跳（回复完毕时输入框恰好获得焦点）
        var greetings = ['回答完成！', '搞定！', '已送达', '今天的回答也送达啦', '随时继续提问'];
        var origPlaceholder = dom.messageInput.placeholder;
        dom.messageInput.placeholder = greetings[Math.floor(Math.random() * greetings.length)];
        dom.messageInput.classList.add('easter-egg');
        setTimeout(function () {
          dom.messageInput.placeholder = origPlaceholder;
          dom.messageInput.classList.remove('easter-egg');
        }, 2200);
        // 输入框轻微弹跳（使用 requestAnimationFrame 避免强制同步重排）
        var inputBox = document.querySelector('.input-container');
        if (inputBox) {
          inputBox.classList.remove('bounce');
          requestAnimationFrame(function () {
            inputBox.classList.add('bounce');
          });
        }
      }
    }
  }
  renderChatOutline();
  renderSidebar();
}

// ─── Images ─────────────────────────────────────────────────────

function resizeImg(file, maxW, maxH, quality) {
  // 历史消息图片以 base64 存 localStorage，压缩到 896px/0.75 显著减小读写与存储开销
  maxW = maxW || 896; maxH = maxH || 896; quality = quality || 0.75;
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > maxW || h > maxH) { var r = Math.min(maxW / w, maxH / h); w = Math.round(w * r); h = Math.round(h * r); }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL(file.type || 'image/png', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addImages(files) {
  var avail = MAX_PENDING_IMAGES - state.pendingImages.length;
  if (avail <= 0) { showToast('最多只能上传 ' + MAX_PENDING_IMAGES + ' 张图片/页面', 'error'); return; }
  var list = Array.from(files).slice(0, avail);
  for (var i = 0; i < list.length; i++) {
    if (!list[i].type.startsWith('image/')) continue;
    try { state.pendingImages.push(await resizeImg(list[i])); renderAttachmentPreviews(); } catch (e) { showToast('图片处理失败: ' + e.message, 'error'); }
  }
}

function removeImage(i) { state.pendingImages.splice(i, 1); renderAttachmentPreviews(); }

// ─── Chat ───────────────────────────────────────────────────────

// 当前对话所属分组固定的系统提示词；未分组对话无 system 消息
function getConvoSystemPrompt() {
  var c = state.conversations.find(function (x) { return x.id === state.currentConvoId; });
  if (!c || !c.groupId) return '';
  var g = (getSettings().convoGroups || []).find(function (x) { return x.id === c.groupId; });
  return g ? (g.systemPrompt || '') : '';
}

// ─── 清除上下文（Ctrl+K）─────────────────────────────────────────
// 每次 Ctrl+K 在消息流末尾追加一条居中的分隔线（可多条，各自保留原位），
// 请求只携带最后一条分隔线之后的消息；点击分隔线可移除对应那条（恢复上下文）

function getActiveMessages(messages) {
  var start = 0;
  for (var i = 0; i < messages.length; i++) {
    if (messages[i] && messages[i].role === 'break') start = i + 1;
  }
  return messages.slice(start);
}

function createBreakBubble(idx, bid) {
  var el = document.createElement('div');
  el.className = 'message context-break';
  if (typeof idx === 'number') el.dataset.index = idx;
  if (bid) el.dataset.breakId = bid;
  el.title = '点击恢复此处的对话上下文';
  el.innerHTML = '<div class="context-break-line">---清除上下文---</div>';
  el.addEventListener('click', function () { removeContextBreak(bid); });
  return el;
}

function removeContextBreak(bid) {
  if (state.isStreaming) return;
  var breakIdx = -1;
  for (var i = 0; i < state.currentMessages.length; i++) {
    var m = state.currentMessages[i];
    if (m.role === 'break' && (!bid || m.bid === bid)) { breakIdx = i; break; }
  }
  if (breakIdx < 0) return;
  var removedBid = state.currentMessages[breakIdx].bid;
  state.currentMessages.splice(breakIdx, 1);
  var el = dom.messagesContainer.querySelector('.context-break[data-break-id="' + removedBid + '"]');
  if (el) el.remove();
  for (var j = breakIdx; j < state.currentMessages.length; j++) {
    var next = dom.messagesContainer.querySelector('.message[data-index="' + (j + 1) + '"]');
    if (next) next.dataset.index = j;
  }
  persistConvo();
  renderChatOutline();
  renderSidebar();
  showToast('已恢复此处的对话上下文', 'success');
}

function setContextBreak() {
  if (state.isStreaming) return;
  var lastBreakIdx = -1;
  var realCount = 0;
  for (var i = 0; i < state.currentMessages.length; i++) {
    if (state.currentMessages[i].role === 'break') lastBreakIdx = i;
    else realCount++;
  }
  if (!realCount) { showToast('当前没有可清除的对话内容', 'info'); return; }
  // 最后一条已是分隔线（清除后尚无新消息）：重复按不叠加，避免刷出无数条线
  if (lastBreakIdx === state.currentMessages.length - 1) {
    showToast('当前上下文已清除，发送新内容后可再次清除', 'info');
    return;
  }
  var newIdx = state.currentMessages.length;
  var bid = uid();
  state.currentMessages.push({ role: 'break', text: '---清除上下文---', bid: bid, timestamp: new Date().toISOString() });
  dom.messagesContainer.appendChild(createBreakBubble(newIdx, bid));
  persistConvo();
  renderChatOutline();
  renderSidebar();
  scrollBottom(true);
  showToast('已清除上下文：新消息将不再包含此前对话', 'info');
}

function buildBody(messages, model, stream) {
  var msgs = [];
  var sp = getConvoSystemPrompt();
  if (sp) msgs.push({ role: 'system', content: sp });
  var active = getActiveMessages(messages);
  for (var i = 0; i < active.length; i++) {
    var m = active[i];
    if ((!m.images || !m.images.length) && (!m.files || !m.files.length)) { msgs.push({ role: m.role, content: m.text || '' }); }
    else {
      var content = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      var imageList = m.images || [];
      for (var j = 0; j < imageList.length; j++) { content.push({ type: 'image_url', image_url: { url: imageList[j], detail: 'auto' } }); }
      if (m.files && m.files.length) {
        for (var f = 0; f < m.files.length; f++) {
          var file = m.files[f];
          if (file.isPdf && file.pages && file.pages.length) {
            for (var p = 0; p < file.pages.length; p++) {
              content.push({ type: 'image_url', image_url: { url: file.pages[p].dataUrl, detail: 'auto' } });
            }
            if (file.text && file.text.trim()) {
              content.push({ type: 'text', text: '\n\n【附件：' + file.name + ' 参考文本】\n' + file.text + '\n【附件结束】' });
            }
          } else if (file.isPdf && file.renderedPageCount) {
            if (file.text && file.text.trim()) {
              content.push({ type: 'text', text: '\n\n【附件：' + file.name + ' 参考文本】\n' + file.text + '\n【附件结束】' });
            }
          } else if (file.base64 && (file.isPdf || file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
            content.push({
              type: 'file',
              file: {
                filename: file.name,
                file_data: file.base64
              }
            });
          } else {
            content.push({ type: 'text', text: '\n\n【附件：' + file.name + '】\n' + (file.text || '') + '\n【附件结束】' });
          }
        }
      }
      msgs.push({ role: m.role, content: content });
    }
  }
  // 上下文保护：估算 token 数，超限时裁剪中间历史（保留 system/首条与最近消息）。
  // 只影响本次请求体，不修改本地历史；估算保守偏高，避免触发 API 的 400
  msgs = trimContext(msgs);
  var body = { model: model, messages: msgs, max_tokens: 32768, temperature: 0.7, stream: !!stream };
  // 流式响应末尾 chunk 携带 usage（缓存命中统计）；不兼容的网关会 400，在 streamApiResponse 里降级重试
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

// 估算 token：中文约 1 token/字，英文约 3.5~4 字符/token，取保守值并留余量
var CONTEXT_INPUT_BUDGET = 90000; // 128K 上下文 - 32K 输出余量
function estimateTextTokens(t) {
  var cjk = (String(t || '').match(/[一-鿿㐀-䶿豈-﫿]/g) || []).length;
  return Math.ceil(cjk + (t.length - cjk) / 3.5);
}
function estimateMsgTokens(m) {
  if (!m) return 0;
  if (Array.isArray(m.content)) {
    var n = 0;
    for (var i = 0; i < m.content.length; i++) {
      var p = m.content[i];
      if (!p) continue;
      if (p.type === 'image_url' || p.type === 'input_image') {
        n += 1500;
      } else if (p.type === 'file' || p.type === 'input_file') {
        n += 2500;
      } else {
        n += estimateTextTokens(p.text);
      }
    }
    return n;
  }
  return estimateTextTokens(m.content);
}
function trimContext(msgs) {
  if (!msgs.length) return msgs;
  var total = 0;
  for (var i = 0; i < msgs.length; i++) total += estimateMsgTokens(msgs[i]);
  if (total <= CONTEXT_INPUT_BUDGET) return msgs;
  // 从后往前保留消息，直到预算用完；首条 system 消息始终保留
  var keep = [msgs[0]];
  var budget = CONTEXT_INPUT_BUDGET - estimateMsgTokens(msgs[0]);
  for (var k = msgs.length - 1; k >= 1; k--) {
    var t = estimateMsgTokens(msgs[k]);
    if (budget - t < 0) break;
    budget -= t;
    keep.unshift(msgs[k]);
  }
  if (keep.length < 2) {
    // 单条消息就超预算：尽力保留最后一条用户消息，避免空请求
    keep = [msgs[0], msgs[msgs.length - 1]];
  }
  var trimmed = msgs.length - keep.length;
  if (trimmed > 0) showToast('历史消息过长，已裁剪 ' + trimmed + ' 条旧消息（保留最近内容）', 'info');
  return keep;
}

// ─── Responses API 协议与增量解析兼容 ─────────────────────────────

function determineApiProtocol(group) {
  var proto = (group && group.apiProtocol) || 'auto';
  if (proto === 'responses' || proto === 'response') return 'responses';
  if (proto === 'chat') return 'chat';
  // auto 模式检查 base URL
  var base = ((group && group.apiBase) || '').toLowerCase().trim();
  if (
    base.endsWith('/responses') ||
    base.endsWith('/response') ||
    base.indexOf('/v1/responses') !== -1 ||
    base.indexOf('/responses') !== -1 ||
    base.indexOf('/response') !== -1
  ) {
    return 'responses';
  }
  return 'chat';
}

function resolveApiEndpoint(apiBase, protocol) {
  var base = (apiBase || '').trim().replace(/\/+$/, '');
  // 如果未配置 API Base：在 Web 域名下运行自动默认走同域服务端代理 /v1；本地文件默认走官方 OpenAI
  if (!base) {
    if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
      base = '/v1';
    } else {
      base = 'https://api.openai.com/v1';
    }
  }
  // 智能补齐 /v1：如果用户输入的是纯域名（如 https://www.ssxinjie.com）或根路径 /，自动补充标准 /v1 前缀
  try {
    var dummyOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://localhost';
    var u = new URL(base, dummyOrigin);
    if ((u.pathname === '/' || u.pathname === '') && base.indexOf('/v1') === -1) {
      base += '/v1';
    }
  } catch (_) {}

  if (protocol === 'responses') {
    if (base.endsWith('/chat/completions')) {
      return base.replace(/\/chat\/completions$/, '/responses');
    }
    if (base.endsWith('/responses') || base.endsWith('/response')) {
      return base;
    }
    return base + '/responses';
  } else {
    // chat completions 协议
    if (base.endsWith('/responses')) {
      return base.replace(/\/responses$/, '/chat/completions');
    }
    if (base.endsWith('/response')) {
      return base.replace(/\/response$/, '/chat/completions');
    }
    if (base.endsWith('/chat/completions')) {
      return base;
    }
    return base + '/chat/completions';
  }
}

function toAbsoluteUrl(url) {
  try {
    var baseOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://localhost';
    return new URL(url, baseOrigin).toString();
  } catch (_) {
    return url;
  }
}

// 统一内置跨域代理网关：优先走免费 Cloudflare 代理，超时/失败自动无缝降级至国内阿里云专属函数
var PROXY_GATEWAYS = [
  'https://api1.yulucha.xyz/api/proxy',
  'https://transfer-sybhttgkgu.cn-hangzhou.fcapp.run',
  'https://shrill-hat-47ef.a1361470438.workers.dev/api/proxy'
];

/**
 * 获取可用的代理网关候选列表：
 * 1. 同源一体化代理 /api/proxy（若在 Cloudflare Pages 部署环境）
 * 2. 免费 Cloudflare 远程网关（api1.yulucha.xyz，零成本首选）
 * 3. 国内阿里云高可用函数网关（transfer-sybhttgkgu...，国内极速兜底备用）
 * 4. 备用容灾网关（workers.dev）
 */
function getAvailableProxyGateways(targetEndpoint) {
  var list = [];
  var isWeb = typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http');
  var absTarget = toAbsoluteUrl(targetEndpoint);
  var targetHost = '';
  try { targetHost = new URL(absTarget).host; } catch (_) {}

  // 1. 同源一体化代理（如果在 Cloudflare Pages 上运行，优先走本站同源 /api/proxy 免跨域）
  if (isWeb) {
    var currentHost = window.location.host;
    if (targetHost && targetHost !== currentHost) {
      list.push('/api/proxy');
    }
  }

  // 2. 内置代理网关队列（首选 CF 免费代理 -> 超时/失败切国内阿里云 -> 备用 workers.dev）
  for (var i = 0; i < PROXY_GATEWAYS.length; i++) {
    if (list.indexOf(PROXY_GATEWAYS[i]) === -1) {
      list.push(PROXY_GATEWAYS[i]);
    }
  }

  // 3. 用户在设置中自定义配置的外部代理网关（过滤历史旧残留，若有显式自定义则插入首位）
  var s = typeof getSettings === 'function' ? getSettings() : {};
  var customProxy = (s.proxyUrl || '').trim().replace(/\/+$/, '');
  if (customProxy && (customProxy.indexOf('yulucha.xyz') !== -1 || customProxy.indexOf('workers.dev') !== -1)) {
    customProxy = '';
  }
  if (customProxy && /^https?:\/\//i.test(customProxy)) {
    var customUrl = customProxy.endsWith('/api/proxy') ? customProxy : customProxy;
    if (list.indexOf(customUrl) === -1) list.unshift(customUrl);
  }

  console.info('[ProxyGateways] 当前代理网关就绪队列 (CF免费首选 -> 阿里云兜底):', list);
  return list;
}

// 代理网关连通性快速探测缓存（存活状态缓存 45 秒，避免重复握手损耗）
var gatewayStatusCache = {};

/**
 * 快速探测网关物理连通性（发轻量 OPTIONS 请求检测当前网络与网关握手是否畅通）
 * @param {string} gatewayUrl - 代理网关地址
 * @param {number} timeoutMs - 探测超时时间（默认 3000ms）
 * @param {AbortSignal} [parentSignal] - 外部中止信号
 * @returns {Promise<boolean>}
 */
async function probeGatewayAlive(gatewayUrl, timeoutMs, parentSignal) {
  var now = Date.now();
  var cached = gatewayStatusCache[gatewayUrl];
  if (cached && (now - cached.time < 45000)) {
    return cached.alive;
  }

  var probeController = new AbortController();
  var onParentAbort = function () {
    try { probeController.abort(); } catch (_) {}
  };
  if (parentSignal) {
    if (parentSignal.aborted) return false;
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  var timer = setTimeout(function () {
    try { probeController.abort(); } catch (_) {}
  }, timeoutMs || 3000);

  try {
    var res = await fetch(gatewayUrl, {
      method: 'OPTIONS',
      signal: probeController.signal
    });
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);

    // 只要有预检响应（200, 204），且不是服务宕机 502/503/504 或未部署 404，即为通路畅通
    var isAlive = (res.status === 200 || res.status === 204);
    if (res.status === 404 && gatewayUrl === '/api/proxy') isAlive = false;
    if (res.status >= 502 && res.status <= 504) isAlive = false;

    gatewayStatusCache[gatewayUrl] = { alive: isAlive, time: now };
    return isAlive;
  } catch (_) {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
    gatewayStatusCache[gatewayUrl] = { alive: false, time: now };
    return false;
  }
}

/**
 * 遍历代理网关发起请求，支持主备自动无缝容灾（调度过程中静默不报错）
 * 调度策略：
 * 1. 优先使用免费 Cloudflare 网关，但在发送大模型真实数据前，先发快速 OPTIONS 连通性探测（3秒超时）；
 * 2. 若连通性探测不通（如内网被阻断/丢包超时），瞬间无缝切换至国内阿里云函数网关；
 * 3. 探测通过后，进入真实转发流程，该流程完全信任网络连通性，等待大模型生成（不设几秒的粗暴截断限制）。
 */
async function tryProxyGateways(targetEndpoint, headers, bodyStr, signal, gateways, originalError) {
  var lastError = originalError || new Error('所有代理网关均不可用');
  var absoluteTarget = toAbsoluteUrl(targetEndpoint);

  for (var i = 0; i < gateways.length; i++) {
    var gatewayUrl = gateways[i];
    var proxyHeaders = Object.assign({}, headers);
    proxyHeaders['x-target-url'] = absoluteTarget;

    // 1. 如果当前不是最后一个备选网关，先发轻量 OPTIONS 探测网关物理链路是否畅通（3秒超时）
    // 注意：同源 /api/proxy 没有浏览器的跨域预检，因此只会发 1 次几十毫秒的探活；
    // 一旦内网阻断 Cloudflare，3 秒超时后立刻无缝切到国内阿里云，绝不会死等卡死！
    if (i < gateways.length - 1) {
      var isAlive = await probeGatewayAlive(gatewayUrl, 3000, signal);
      if (signal && signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (!isAlive) {
        console.warn('代理网关 ' + gatewayUrl + ' 连通性探测失败或超时（3秒），正在快速切换下一备用网关...');
        continue;
      }
    }

    // 2. 链路畅通，发起真正的 POST 转发请求
    // 设置 25 秒首包安全兜底（收到响应头立即清除），既允许推理模型思考，又防止服务端彻底挂起无响应
    var postController = new AbortController();
    var postTimeoutTriggered = false;
    var postTimer = setTimeout(function () {
      postTimeoutTriggered = true;
      try { postController.abort(); } catch (_) {}
    }, 25000);

    var onUserAbort = function () {
      try { postController.abort(); } catch (_) {}
    };
    if (signal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      signal.addEventListener('abort', onUserAbort, { once: true });
    }

    try {
      var proxyRes = await fetch(gatewayUrl, {
        method: 'POST',
        headers: proxyHeaders,
        body: bodyStr,
        signal: postController.signal
      });

      // 只要收到响应头，立即解除 25 秒限制（长文本流式输出耗时数分钟也不受影响）
      clearTimeout(postTimer);
      if (signal) signal.removeEventListener('abort', onUserAbort);

      // 覆盖所有 5xx（包括 Cloudflare 的 522 连接超时、524 网关超时等）与静态托管缺失的 404 HTML
      var contentType = (proxyRes.headers.get('content-type') || '').toLowerCase();
      var is5xx = (proxyRes.status >= 500 && proxyRes.status <= 599);
      var isStatic404 = (proxyRes.status === 404 && gatewayUrl === '/api/proxy' && contentType.indexOf('text/html') !== -1);
      var isGatewayFailure = is5xx || isStatic404;

      if (!proxyRes.ok && isGatewayFailure && i < gateways.length - 1) {
        gatewayStatusCache[gatewayUrl] = { alive: false, time: Date.now() };
        console.warn('代理网关 ' + gatewayUrl + ' 返回 ' + proxyRes.status + '，正在无缝切换备用网关...');
        continue;
      }

      // 网关正常响应（包含 200 或上游业务返回的 400/401/403/404 等模型报错），标记存活并直接返回
      gatewayStatusCache[gatewayUrl] = { alive: true, time: Date.now() };
      return { res: proxyRes, route: gatewayUrl };
    } catch (proxyErr) {
      clearTimeout(postTimer);
      if (signal) signal.removeEventListener('abort', onUserAbort);

      // 如果是用户主动点击停止（Cancel），直接抛出，不触发切换
      if (signal && signal.aborted) throw proxyErr;

      gatewayStatusCache[gatewayUrl] = { alive: false, time: Date.now() };
      lastError = proxyErr;

      if (postTimeoutTriggered) {
        console.warn('代理网关 ' + gatewayUrl + ' 首包无响应（超过25秒），正在自动无缝切换备用网关...');
      } else {
        console.warn('代理网关 ' + gatewayUrl + ' 转发请求异常，尝试下一个网关...', proxyErr);
      }
    }
  }

  // 跨域再出问题再报错：所有代理通道均失败
  throw lastError;
}

/**
 * 智能 API 请求调度：
 * 1. 用户发送信息，先直接向目标服务器发起请求，不进行后端转发；
 * 2. 如果出现跨域问题（CORS 报错 / Preflight 阻断 / WAF 403 页面），自动转发后端；
 * 3. 优先使用当前站点的同源代理网关 /api/proxy（一体化 Pages 部署），零跨域；
 * 4. 过程中自动路由不报错（同源 -> api1.yulucha.xyz -> workers.dev 逐级无缝容灾）；
 * 5. 跨域再出问题再报错（仅在所有代理网关均不可用时抛出异常）。
 */
async function executeSmartApiRequest(targetEndpoint, headers, body, signal, preferredRoute) {
  var bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  var absoluteTarget = toAbsoluteUrl(targetEndpoint);

  // 1. 本地服务（localhost / 127.0.0.1）直接直连，不可通过远程云端代理
  var isLocal = false;
  try {
    var u = new URL(absoluteTarget);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      isLocal = true;
    }
  } catch (_) {}

  if (isLocal) {
    var localRes = await fetch(targetEndpoint, {
      method: 'POST',
      headers: headers,
      body: bodyStr,
      signal: signal
    });
    return { res: localRes, route: 'direct' };
  }

  var availableGateways = getAvailableProxyGateways(targetEndpoint);

  // 2. 如果指定了已验证的生效代理路由（如 400 降级重试），优先走该通道
  if (preferredRoute && preferredRoute !== 'direct') {
    var gateways = [preferredRoute].concat(
      availableGateways.filter(function (g) { return g !== preferredRoute; })
    );
    return await tryProxyGateways(targetEndpoint, headers, bodyStr, signal, gateways);
  }

  // 3. 用户发送信息，先直接向目标服务器发起请求，不进行后端转发
  try {
    var directRes = await fetch(targetEndpoint, {
      method: 'POST',
      headers: headers,
      body: bodyStr,
      signal: signal
    });

    // 检查是否遇到目标服务器 WAF 阻断网页（例如 Cloudflare 403 HTML 质询），若是则转入代理
    var contentType = (directRes.headers.get('content-type') || '').toLowerCase();
    if (directRes.status === 403 && contentType.indexOf('text/html') !== -1) {
      console.warn('直连目标服务器返回 403 HTML 网页，自动切换至代理网关...');
      return await tryProxyGateways(targetEndpoint, headers, bodyStr, signal, availableGateways);
    }

    return { res: directRes, route: 'direct' };
  } catch (directErr) {
    // 若用户主动停止生成（AbortError），直接抛出，不触发代理
    if ((signal && signal.aborted) || directErr.name === 'AbortError') throw directErr;

    // 出现跨域问题（如 TypeError: Failed to fetch 或连接受阻），静默转交后端代理
    console.warn('直连目标服务器失败（跨域受限），正在自动无缝切换至代理网关...', directErr);
    return await tryProxyGateways(targetEndpoint, headers, bodyStr, signal, availableGateways, directErr);
  }
}


function buildResponsesBody(messages, model, stream) {
  var active = getActiveMessages(messages);
  var inputItems = [];

  for (var i = 0; i < active.length; i++) {
    var m = active[i];
    if ((!m.images || !m.images.length) && (!m.files || !m.files.length)) {
      inputItems.push({ role: m.role, content: m.text || '' });
    } else {
      var contentParts = [];
      if (m.text) contentParts.push({ type: 'input_text', text: m.text });
      var imageList = m.images || [];
      for (var j = 0; j < imageList.length; j++) {
        contentParts.push({ type: 'input_image', image_url: imageList[j] });
      }
      if (m.files && m.files.length) {
        for (var f = 0; f < m.files.length; f++) {
          var file = m.files[f];
          if (file.isPdf && file.pages && file.pages.length) {
            for (var p = 0; p < file.pages.length; p++) {
              contentParts.push({ type: 'input_image', image_url: file.pages[p].dataUrl });
            }
            if (file.text && file.text.trim()) {
              contentParts.push({
                type: 'input_text',
                text: '\n\n【附件：' + file.name + ' 参考文本】\n' + file.text + '\n【附件结束】'
              });
            }
          } else if (file.isPdf && file.renderedPageCount) {
            if (file.text && file.text.trim()) {
              contentParts.push({
                type: 'input_text',
                text: '\n\n【附件：' + file.name + ' 参考文本】\n' + file.text + '\n【附件结束】'
              });
            }
          } else if (file.base64 && (file.isPdf || file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
            contentParts.push({
              type: 'input_file',
              filename: file.name,
              file_data: file.base64,
              file_url: file.base64
            });
          } else {
            contentParts.push({
              type: 'input_text',
              text: '\n\n【附件：' + file.name + '】\n' + (file.text || '') + '\n【附件结束】'
            });
          }
        }
      }
      inputItems.push({ role: m.role, content: contentParts });
    }
  }

  inputItems = trimResponsesContext(inputItems);

  var body = {
    model: model,
    input: inputItems,
    max_output_tokens: 32768,
    temperature: 0.7,
    stream: !!stream
  };

  var sp = getConvoSystemPrompt();
  if (sp) {
    body.instructions = sp;
  }

  return body;
}

function trimResponsesContext(items) {
  if (!items.length) return items;
  var total = 0;
  for (var i = 0; i < items.length; i++) total += estimateMsgTokens(items[i]);
  if (total <= CONTEXT_INPUT_BUDGET) return items;
  var keep = [];
  var budget = CONTEXT_INPUT_BUDGET;
  for (var k = items.length - 1; k >= 0; k--) {
    var t = estimateMsgTokens(items[k]);
    if (budget - t < 0) break;
    budget -= t;
    keep.unshift(items[k]);
  }
  if (keep.length === 0 && items.length > 0) {
    keep = [items[items.length - 1]];
  }
  var trimmed = items.length - keep.length;
  if (trimmed > 0) showToast('历史消息过长，已裁剪 ' + trimmed + ' 条旧消息（保留最近内容）', 'info');
  return keep;
}

function extractStreamChunk(parsed, currentEvent) {
  var text = '';
  var reasoning = '';
  var usage = null;

  if (!parsed || typeof parsed !== 'object') return { text: text, reasoning: reasoning, usage: usage };

  // 提取 usage 统计
  if (parsed.usage) {
    usage = parsed.usage;
  } else if (parsed.response && parsed.response.usage) {
    usage = parsed.response.usage;
  } else if (parsed.usage_metadata) {
    usage = parsed.usage_metadata;
  }

  var evt = String(currentEvent || parsed.type || '').trim();

  // 1. Responses API: 思考链事件（如 response.reasoning_summary_text.delta 或 response.reasoning.delta）
  if (
    evt.indexOf('reasoning') !== -1 ||
    evt === 'response.reasoning_summary_text.delta' ||
    evt === 'response.reasoning.delta' ||
    evt === 'response.reasoning_text.delta'
  ) {
    if (typeof parsed.delta === 'string') {
      reasoning = parsed.delta;
    } else if (parsed.delta && typeof parsed.delta.text === 'string') {
      reasoning = parsed.delta.text;
    } else if (parsed.delta && typeof parsed.delta.content === 'string') {
      reasoning = parsed.delta.content;
    } else if (typeof parsed.reasoning === 'string') {
      reasoning = parsed.reasoning;
    } else if (typeof parsed.summary === 'string') {
      reasoning = parsed.summary;
    }
  }
  // 2. Responses API: 正文增量事件（如 response.output_text.delta）
  else if (
    evt === 'response.output_text.delta' ||
    evt === 'response.text.delta' ||
    evt === 'response.content_part.delta' ||
    evt === 'output_text.delta'
  ) {
    if (typeof parsed.delta === 'string') {
      text = parsed.delta;
    } else if (parsed.delta && typeof parsed.delta.text === 'string') {
      text = parsed.delta.text;
    } else if (parsed.delta && typeof parsed.delta.content === 'string') {
      text = parsed.delta.content;
    } else if (typeof parsed.text === 'string') {
      text = parsed.text;
    }
  }
  // 3. OpenAI Chat Completions 标准 delta（choices[0].delta）
  else if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
    var d = parsed.choices[0].delta;
    var rv = getDeltaReasoning(d);
    if (rv && rv !== '1') reasoning = rv;
    if (typeof d.content === 'string') text = d.content;
  }
  // 4. 兼容直接输出 delta 的网关格式
  else if (typeof parsed.delta === 'string') {
    text = parsed.delta;
  } else if (parsed.delta && typeof parsed.delta === 'object') {
    var r = getDeltaReasoning(parsed.delta);
    if (r && r !== '1') reasoning = r;
    if (typeof parsed.delta.content === 'string') text = parsed.delta.content;
    else if (typeof parsed.delta.text === 'string') text = parsed.delta.text;
  } else if (typeof parsed.output_text === 'string' && (evt.indexOf('delta') !== -1 || !evt)) {
    text = parsed.output_text;
  }

  return { text: text, reasoning: reasoning, usage: usage };
}

function parseFullApiResponse(jsonRes) {
  var text = '';
  var reasoning = '';
  var usage = null;

  if (!jsonRes || typeof jsonRes !== 'object') return { text: text, reasoning: reasoning, usage: usage };

  if (jsonRes.usage) {
    usage = jsonRes.usage;
  } else if (jsonRes.response && jsonRes.response.usage) {
    usage = jsonRes.response.usage;
  }

  // 1. Chat Completions choices 格式
  if (Array.isArray(jsonRes.choices) && jsonRes.choices.length > 0) {
    var fullMsg = jsonRes.choices[0].message || jsonRes.choices[0];
    text = messageContentToString(fullMsg);
    reasoning = getMessageReasoning(fullMsg);
    return { text: text, reasoning: reasoning, usage: usage };
  }

  // 2. Responses API output_text 顶层便捷字段
  if (typeof jsonRes.output_text === 'string') {
    text = jsonRes.output_text;
  }

  // 3. Responses API output 数组结构
  if (Array.isArray(jsonRes.output)) {
    for (var i = 0; i < jsonRes.output.length; i++) {
      var item = jsonRes.output[i];
      if (!item) continue;
      // 思考项提取
      if (item.type === 'reasoning' || item.type === 'reasoning_summary') {
        var r = item.summary || item.content || item.text || '';
        if (typeof r === 'string' && r) {
          reasoning += (reasoning ? '\n' : '') + r;
        }
      }
      // 消息正文提取
      if (item.type === 'message' || item.role === 'assistant') {
        if (Array.isArray(item.content)) {
          for (var c = 0; c < item.content.length; c++) {
            var part = item.content[c];
            if (!part) continue;
            if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
              if (!jsonRes.output_text) text += part.text;
            } else if ((part.type === 'reasoning' || part.type === 'thinking') && typeof part.text === 'string') {
              reasoning += (reasoning ? '\n' : '') + part.text;
            }
          }
        } else if (typeof item.content === 'string' && !text) {
          text = item.content;
        }
      }
    }
  }

  // 4. 其他常见字段兜底
  if (!text && typeof jsonRes.content === 'string') text = jsonRes.content;
  if (!text && typeof jsonRes.response === 'string') text = jsonRes.response;
  if (!reasoning && typeof jsonRes.reasoning === 'string') reasoning = jsonRes.reasoning;

  return { text: text, reasoning: reasoning, usage: usage };
}

function extractBase64Images(text) {
  var images = [];
  var cleanText = String(text || '');

  // 1. 匹配并清洗 HTML <img> 标签（如在 base64.html 中点击「复制 <img> 标签」粘贴进来的）
  var htmlImgRe = /<img\s+[^>]*?src=["'](data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)["'][^>]*\/?>/gi;
  cleanText = cleanText.replace(htmlImgRe, function (_, dataUrl) {
    images.push(dataUrl);
    return '';
  });

  // 2. 匹配并清洗 Markdown 图片语法：![...](data:image/...;base64,...)
  var mdImgRe = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/gi;
  cleanText = cleanText.replace(mdImgRe, function (_, dataUrl) {
    images.push(dataUrl);
    return '';
  });

  // 3. 匹配纯 data:image/...;base64,... 字符串
  var rawRe = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi;
  cleanText = cleanText.replace(rawRe, function (match) {
    images.push(match);
    return '';
  });

  cleanText = cleanText.replace(/\s{2,}/g, ' ').trim();
  return { images: images, text: cleanText };
}

async function sendMessage() {
  var rawText = dom.messageInput.value.trim();
  var pendingImgs = state.pendingImages.slice();
  var pendingFiles = state.pendingFiles.slice();
  var hasImgs = pendingImgs.length > 0;

  // Parse base64 images embedded in text
  var parsed = { images: [], text: rawText };
  if (rawText) {
    parsed = extractBase64Images(rawText);
    hasImgs = hasImgs || parsed.images.length > 0;
  }

  if (!parsed.text && !hasImgs && !pendingFiles.length) return;
  if (state.isStreaming) return;

  // 立即锁定发送状态，防止狂按 Enter 或双击发送按钮触发重复请求竞态
  state.isStreaming = true;
  setInputEnabled(false);

  // 只在此处清空输入状态：sendUserMessage 也被「重新生成」调用，不能动用户正在输入的内容
  state.pendingImages = [];
  state.pendingFiles = [];
  renderAttachmentPreviews();
  dom.messageInput.value = '';
  dom.messageInput.style.height = 'auto';

  try {
    var result = await sendUserMessage(parsed.text || '', pendingImgs.concat(parsed.images), pendingFiles);
    if (result && result.failedNoData) restoreFailedSend(result);
  } finally {
    state.isStreaming = false;
    setInputEnabled(true);
    dom.messageInput.focus();
  }
}

// 请求在没有收到任何返回内容时，撤回刚发送的用户消息并恢复到输入框。
// 若请求已经返回部分内容，则保留现有消息，避免覆盖用户已经看到的结果。
function restoreFailedSend(result) {
  if (!result || !result.failedNoData) return;
  if (state.currentConvoId !== result.convoId) return;

  if (result.userMsg) {
    var idx = state.currentMessages.indexOf(result.userMsg);
    if (idx !== -1) state.currentMessages.splice(idx, 1);
  }
  var convo = state.conversations.find(function (c) { return c.id === result.convoId; });
  if (convo && result.previousTitle !== null && result.previousTitle !== undefined) {
    convo.title = result.previousTitle;
    dom.conversationTitle.textContent = convo.title || 'New Chat';
  }
  state.pendingImages = (result.images || []).slice();
  state.pendingFiles = (result.files || []).slice();
  dom.messageInput.value = result.text || '';
  dom.messageInput.style.height = 'auto';
  dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 160) + 'px';
  renderAttachmentPreviews();
  renderMessages();
  persistConvo();
  renderSidebar();
  showToast(result.failureReason === 'config' ? '消息已退回输入框' : '请求失败，消息已退回输入框', 'info');
}

// 核心发送逻辑：输入框（sendMessage）与重新生成（regenerateFromMessage）共用
async function sendUserMessage(text, images, files) {
  var attempt = {
    text: text || '',
    images: (images || []).slice(),
    files: (files || []).slice(),
    convoId: state.currentConvoId,
    userMsg: null,
    previousTitle: null
  };
  var group = getActiveGroup();
  if (!group.apiKey) {
    showToast('请先在设置中为配置组「' + group.name + '」配置 API Key', 'error');
    attempt.failedNoData = true;
    attempt.failureReason = 'config';
    return attempt;
  }

  if (!state.currentConvoId) newConvo();
  if (!state.currentConvoId) { attempt.failedNoData = true; return attempt; }
  attempt.convoId = state.currentConvoId;

  var userMsg = { role: 'user', text: text || '', images: images || [], files: files || [], timestamp: new Date().toISOString() };
  attempt.userMsg = userMsg;
  state.currentMessages.push(userMsg);
  hideWelcome();
  appendBubble(userMsg, state.currentMessages.length - 1);
  scrollBottom(true);

  var convo = state.conversations.find(function (c) { return c.id === state.currentConvoId; });
  if (convo && convo.messageCount === 0 && !convo.titleCustom) {
    attempt.previousTitle = convo.title;
     convo.title = text ? text.slice(0, 40) + (text.length > 40 ? '...' : '') : (files && files.length ? '[' + files[0].name + ']' : '[图片消息]');
    dom.conversationTitle.textContent = convo.title;
  }
  persistConvo();
  renderSidebar();

  var response = await streamApiResponse();
  for (var k in response) attempt[k] = response[k];
  return attempt;
}

// 重新生成：用户消息从自身开始，AI 消息从其对应的用户消息开始，
// 删除该位置及其后所有消息，再用对应的用户消息重新请求
function regenerateFromMessage(idx) {
  if (state.isStreaming) return;
  var msgs = state.currentMessages;
  var m = msgs[idx];
  if (!m || (m.role !== 'assistant' && m.role !== 'user')) return;
  var userIdx = m.role === 'user' ? idx : -1;
  for (var i = idx - 1; userIdx < 0 && i >= 0; i--) {
    if (msgs[i].role === 'user') { userIdx = i; break; }
  }
  if (userIdx < 0) return;
  var userMsg = msgs[userIdx];
  msgs.splice(userIdx); // 连用户消息一起删，由 sendUserMessage 重新 push（regenerate 后时间戳更新）
  renderMessages();
  state.isStreaming = true;
  setInputEnabled(false);
  sendUserMessage(userMsg.text, userMsg.images || [], userMsg.files || []).then(function (result) {
    if (result && result.failedNoData) restoreFailedSend(result);
  }).catch(function (err) {
    console.error('重新生成失败:', err);
    showToast('重新生成失败: ' + (err.message || '未知错误'), 'error');
  }).finally(function () {
    state.isStreaming = false;
    setInputEnabled(true);
    if (dom.messageInput) dom.messageInput.focus();
  });
}

// 提取思考链增量：兼容各 OpenAI 兼容实现的字段命名
// reasoning_content（DeepSeek/Qwen/Kimi/GLM 等）、reasoning（部分网关）、
// thinking（Anthropic 风格桥接，可能是对象）、thought（Gemini 兼容层，布尔标志）
function getDeltaReasoning(delta) {
  if (!delta) return '';
  var val = delta.reasoning_content || delta.reasoning || delta.thinking || delta.thinking_content || delta.think
    || delta.thoughts || delta.chain_of_thought || delta.cot || delta.thought;
  if (val === true) return '1';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return val.map(function (x) { return (x && (x.text || x.content || x.thinking)) || ''; }).filter(Boolean).join('\n');
  }
  if (val && typeof val === 'object') {
    var t = val.text || val.content || val.thinking || '';
    if (typeof t === 'string') return t;
    if (t) return String(t);
  }
  return '';
}

// 提取消息级思考链：字段名与 getDeltaReasoning 一致；
// 另支持 Anthropic 原生格式（content 数组中的 thinking 内容块）
function getMessageReasoning(msg) {
  if (!msg) return '';
  var val = msg.reasoning_content || msg.reasoning || msg.thinking || msg.thinking_content || msg.think
    || msg.thoughts || msg.chain_of_thought || msg.cot || msg.thought;
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return val.map(function (x) { return (x && (x.text || x.content || x.thinking)) || ''; }).filter(Boolean).join('\n');
  }
  if (val && typeof val === 'object') {
    var t = val.text || val.content || val.thinking || '';
    return typeof t === 'string' ? t : '';
  }
  if (Array.isArray(msg.content)) {
    return msg.content.filter(function (b) { return b && (b.type === 'thinking' || b.type === 'redacted_thinking'); })
      .map(function (b) { return b.thinking || ''; })
      .filter(Boolean).join('\n');
  }
  return '';
}

// 从正文提取 <think>...</think> 标签（ollama 等直接输出的思考），返回思考内容与清理后的正文
function extractThinkTags(text) {
  var reasoning = '';
  var out = String(text || '').replace(/<think>([\s\S]*?)<\/think>/g, function (_, inner) { reasoning += inner; return ''; });
  if (!reasoning) return { reasoning: '', text: text };
  return { reasoning: reasoning, text: out.replace(/\n{3,}/g, '\n\n').trim() };
}

// 提取消息 content：字符串或 OpenAI 多模态数组（[{type:'text',text:...}]）
function messageContentToString(msg) {
  if (!msg) return '';
  var c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map(function (p) { return (p && typeof p.text === 'string') ? p.text : ''; }).filter(Boolean).join('');
  }
  return '';
}

function createLoading() {
  var el = document.createElement('div');
  el.className = 'message assistant';
  el.id = 'loadingBubble';
  el.innerHTML = '<div class="message-avatar">AI</div><div class="message-body"><div class="message-role">AI 助手</div><div class="message-content"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div><div class="loading-status-row"><span class="loading-status">正在等待模型响应…</span><button type="button" class="loading-stop">停止</button></div></div>';
  return el;
}
function updateLoading(el, text, reasoning, light) {
  var c = el.querySelector('.message-content');
  if (!c) return;
  var html = '';
  if (reasoning && getSettings().showThinking) {
    html += '<details class="reasoning-block" open><summary>思考过程</summary><div class="reasoning-content">' + renderMd(reasoning, { light: !!light }) + '</div></details>';
  }
  if (text) html += light ? renderStreamText(text) : renderMd(text);
  c.innerHTML = html;
}

// 流式轻量渲染：未闭合的代码围栏安全截断，已配平前缀正常渲染 Markdown，
// 截断剩余部分以纯文本先行展示，闭合后由下一次渲染补全——避免整段被包进代码块样式造成跳变
function renderStreamText(text) {
  var sp = safeSplitMarkdown(text);
  var html = renderMd(sp.done, { light: true });
  if (sp.pending) html += '<pre class="stream-pending"><code>' + esc(sp.pending) + '</code></pre>';
  return html;
}

// 找到最后一个「已配对闭合」的代码围栏/普通文本行，返回 { done, pending }
function safeSplitMarkdown(text) {
  var lines = String(text || '').split('\n');
  var stack = [];
  var cut = -1;
  var pos = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = /^[ \t]{0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (m) {
      var info = (m[2] || '').trim();
      if (stack.length) {
        var top = stack[stack.length - 1];
        if (info) { stack.push({ ch: m[1][0], need: m[1].length }); }
        else if (m[1][0] === top.ch && m[1].length >= top.need) {
          stack.pop();
          if (!stack.length) cut = pos + line.length; // 围栏闭合 → 安全截断点
        }
      } else {
        stack.push({ ch: m[1][0], need: m[1].length }); // 开围栏；未闭合前不产生安全点
      }
    } else if (!stack.length) {
      cut = pos + line.length; // 围栏外的普通行，行尾即安全截断点
    }
    pos += line.length + 1;
  }
  if (cut < 0) return { done: '', pending: text };
  return { done: text.slice(0, cut), pending: text.slice(cut).replace(/^\n+/, '') };
}
function removeLoading(el) { if (el && el.parentNode) el.remove(); }

// ─── Code copy button ──────────────────────────────────────────

function legacyCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove();
}

function copyToClipboard(text, done) {
  // 统一走 execCommand 路径：不触发浏览器剪贴板权限弹窗（file:// 下 Clipboard API 会询问）
  legacyCopy(text);
  done();
}

function copyCodeText(btn) {
  var block = btn.closest('.code-block');
  if (!block) return;
  var codeEl = block.querySelector('pre code');
  var text = codeEl ? codeEl.textContent : '';
  if (!text) return;
  var done = function () {
    var span = btn.querySelector('span');
    if (span) span.textContent = '已复制';
    btn.classList.add('copied');
    setTimeout(function () { if (span) span.textContent = '复制'; btn.classList.remove('copied'); }, 1500);
  };
  copyToClipboard(text, done);
}

function copyMessageFromBtn(btn) {
  var el = btn.closest('.message');
  var contentEl = el ? el.querySelector('.message-content') : null;
  if (!contentEl) return;
  // 复制正文文本，排除文献卡片等附属内容
  var clone = contentEl.cloneNode(true);
  var text = (clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return;
  copyToClipboard(text, function () {
    btn.classList.add('copied');
    setTimeout(function () { btn.classList.remove('copied'); }, 1500);
  });
}
// 生成期间仍允许用户提前输入下一条消息；只锁定发送按钮，避免并发请求。
function setInputEnabled(on) {
  dom.messageInput.disabled = false;
  dom.messageInput.setAttribute('aria-disabled', 'false');
  dom.btnSend.disabled = !on;
  dom.btnSend.style.opacity = on ? '1' : '0.4';
  dom.btnSend.title = on ? '发送消息' : '模型回复中，请稍候';
}
function stopStreaming() { if (state.abortController) { state.abortController.abort(); state.abortController = null; } }

// ─── Settings ───────────────────────────────────────────────────

function loadSettingsForm() {
  var s = getSettings();
  dom.settingFontSize.value = String((s.appearance || {}).fontSize || 14);
  dom.settingShowThinking.checked = !!s.showThinking;
  state.editingGroupId = s.activeGroupId;
  renderGroupTabs();
  loadGroupForm();
  renderModelEditList();
  state.editingConvoGroupId = (s.convoGroups[0] && s.convoGroups[0].id) || null;
  renderConvoGroupTabs();
  loadConvoGroupForm();
}
function loadGroupForm() {
  var g = getGroup(state.editingGroupId);
  if (!g) return;
  dom.settingGroupName.value = g.name || '';
  dom.settingGroupBase.value = g.apiBase || 'https://api.openai.com/v1';
  if (dom.settingGroupProtocol) dom.settingGroupProtocol.value = g.apiProtocol || 'auto';
  dom.settingGroupKey.value = '';
  cancelModelEdit();
}
function renderGroupTabs() {
  var s = getSettings();
  dom.groupTabs.innerHTML = s.apiGroups.map(function (g) {
    var active = g.id === state.editingGroupId ? ' active' : '';
    return '<div class="group-tab' + active + '" data-id="' + g.id + '"><span class="group-tab-name">' + esc(g.name) + '</span><button class="group-tab-del" data-id="' + g.id + '" title="删除该组">×</button></div>';
  }).join('');
}
function renderModelEditList() {
  var g = getGroup(state.editingGroupId);
  if (!g) return;
  var models = g.models || [];
  dom.modelEditList.innerHTML = models.length ? models.map(function (m, i) {
    return '<div class="model-edit-item" data-idx="' + i + '"><span class="model-edit-name">' + esc(m) + '</span><button class="model-edit-btn" data-action="edit" data-idx="' + i + '" title="修改">✎</button><button class="model-edit-btn danger" data-action="del" data-idx="' + i + '" title="删除">×</button></div>';
  }).join('') : '<div class="empty-models">暂无模型，可在下方输入添加，或直接在下拉框输入</div>';
}
function flushGroupForm() {
  var s = getSettings();
  var g = getGroupIn(s, state.editingGroupId);
  if (!g) return s;
  var n = dom.settingGroupName.value.trim();
  if (n) g.name = n;
  g.apiBase = dom.settingGroupBase.value.trim() || 'https://api.openai.com/v1';
  if (dom.settingGroupProtocol) g.apiProtocol = dom.settingGroupProtocol.value || 'auto';
  var k = dom.settingGroupKey.value.trim();
  if (k) g.apiKey = k;
  setSettings(s);
  return s;
}
function cancelModelEdit() {
  state.editingModelIdx = -1;
  dom.settingModelInput.value = '';
  dom.settingModelInput.dataset.mode = 'add';
  dom.btnAddModel.textContent = '添加';
}
function startModelEdit(idx) {
  var g = getGroup(state.editingGroupId);
  if (!g || !g.models[idx]) return;
  state.editingModelIdx = idx;
  dom.settingModelInput.value = g.models[idx];
  dom.settingModelInput.dataset.mode = 'edit';
  dom.btnAddModel.textContent = '保存';
  dom.settingModelInput.focus();
}
function commitModel() {
  var name = dom.settingModelInput.value.trim();
  var idx = state.editingModelIdx;
  cancelModelEdit();
  if (!name) return;
  var s = getSettings();
  var g = getGroupIn(s, state.editingGroupId);
  if (!g) return;
  if (idx >= 0 && idx < g.models.length) {
    g.models[idx] = name;
    if (g.models.indexOf(name) !== idx) g.models.splice(idx, 1);
  } else {
    g.models = dedupe(g.models.concat([name]));
  }
  setSettings(s);
  renderModelEditList();
}
function addGroup() {
  flushGroupForm();
  var s = getSettings();
  var g = { id: uid(), name: '配置组 ' + (s.apiGroups.length + 1), apiBase: 'https://api.openai.com/v1', apiProtocol: 'auto', apiKey: '', models: DEFAULT_MODELS.slice() };
  s.apiGroups.push(g);
  state.editingGroupId = g.id;
  setSettings(s);
  renderGroupTabs();
  loadGroupForm();
  renderModelEditList();
  dom.settingGroupName.focus();
  dom.settingGroupName.select();
}
function deleteGroup(id) {
  var s = getSettings();
  if (s.apiGroups.length <= 1) { showToast('至少保留一个配置组', 'error'); return; }
  var g = getGroupIn(s, id);
  if (!g) return;
  if (!confirm('删除配置组「' + g.name + '」？此操作不可撤销。')) return;
  flushGroupForm();
  s = getSettings();
  s.apiGroups = s.apiGroups.filter(function (x) { return x.id !== id; });
  if (s.activeGroupId === id) s.activeGroupId = s.apiGroups[0].id;
  if (state.editingGroupId === id) {
    state.editingGroupId = s.activeGroupId;
    loadGroupForm();
  }
  setSettings(s);
  renderGroupTabs();
  renderModelEditList();
  renderGroupSelector();
}

// ─── 对话分组（设置页） ─────────────────────────────────────────

function renderConvoGroupTabs() {
  var s = getSettings();
  dom.convoGroupTabs.innerHTML = s.convoGroups.map(function (g) {
    var active = g.id === state.editingConvoGroupId ? ' active' : '';
    return '<div class="group-tab' + active + '" data-id="' + g.id + '"><span class="group-tab-name">' + esc(g.name) + '</span><button class="group-tab-del" data-id="' + g.id + '" title="删除该分组">×</button></div>';
  }).join('');
}
function loadConvoGroupForm() {
  var s = getSettings();
  var g = state.editingConvoGroupId ? (s.convoGroups || []).find(function (x) { return x.id === state.editingConvoGroupId; }) : null;
  dom.settingConvoGroupName.value = g ? (g.name || '') : '';
  dom.settingConvoGroupPrompt.value = g ? (g.systemPrompt || '') : '';
  var has = !!g;
  dom.settingConvoGroupName.disabled = !has;
  dom.settingConvoGroupPrompt.disabled = !has;
  dom.btnDeleteConvoGroup.disabled = !has;
}
function flushConvoGroupForm() {
  var s = getSettings();
  if (!state.editingConvoGroupId) return s;
  var g = (s.convoGroups || []).find(function (x) { return x.id === state.editingConvoGroupId; });
  if (!g) return s;
  var n = dom.settingConvoGroupName.value.trim();
  if (n) g.name = n;
  g.systemPrompt = dom.settingConvoGroupPrompt.value;
  setSettings(s);
  return s;
}
function addConvoGroup() {
  flushConvoGroupForm();
  var s = getSettings();
  var g = { id: uid(), name: '分组 ' + (s.convoGroups.length + 1), systemPrompt: '' };
  s.convoGroups.push(g);
  state.editingConvoGroupId = g.id;
  setSettings(s);
  renderConvoGroupTabs();
  loadConvoGroupForm();
  renderSidebar();
  dom.settingConvoGroupName.focus();
  dom.settingConvoGroupName.select();
}
function deleteConvoGroup(id) {
  var s = getSettings();
  var g = (s.convoGroups || []).find(function (x) { return x.id === id; });
  if (!g) return;
  if (!confirm('删除分组「' + g.name + '」？其对话将回到未分组，此操作不可撤销。')) return;
  flushConvoGroupForm();
  s = getSettings();
  s.convoGroups = s.convoGroups.filter(function (x) { return x.id !== id; });
  var changed = false;
  state.conversations.forEach(function (c) {
    if (c.groupId === id) { c.groupId = undefined; changed = true; }
  });
  if (changed) {
    saveConvos();
  }
  if (state.editingConvoGroupId === id) {
    state.editingConvoGroupId = (s.convoGroups[0] && s.convoGroups[0].id) || null;
  }
  setSettings(s);
  renderConvoGroupTabs();
  loadConvoGroupForm();
  renderSidebar();
}
function saveSettingsForm() {
  flushGroupForm();
  flushConvoGroupForm();
  var s = getSettings();
  s.appearance = { fontSize: parseInt(dom.settingFontSize.value, 10) || 14 };
  s.showThinking = dom.settingShowThinking.checked;
  setSettings(s);
  applyFontSize();
  renderGroupSelector();
  renderSidebar();
  showToast('设置已保存', 'success');
  closeSettings();
}
function openSettings() { switchSettingsTab('api'); loadSettingsForm(); dom.settingsOverlay.classList.add('active'); }
function closeSettings() { dom.settingsOverlay.classList.remove('active'); }

// ─── Settings tabs ──────────────────────────────────────────────

var settingsTabBar = document.querySelector('.settings-tabs');

function switchSettingsTab(name) {
  if (!settingsTabBar) return;
  settingsTabBar.querySelectorAll('.settings-tab').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.settings-pane').forEach(function (p) {
    p.classList.toggle('active', p.dataset.pane === name);
  });
}

if (settingsTabBar) {
  settingsTabBar.addEventListener('click', function (e) {
    var btn = e.target.closest('.settings-tab');
    if (btn) switchSettingsTab(btn.dataset.tab);
  });
}

// ─── Settings events ────────────────────────────────────────────

dom.groupTabs.addEventListener('click', function (e) {
  var del = e.target.closest('.group-tab-del');
  if (del) { e.stopPropagation(); deleteGroup(del.dataset.id); return; }
  var tab = e.target.closest('.group-tab');
  if (tab && tab.dataset.id !== state.editingGroupId) {
    flushGroupForm();
    state.editingGroupId = tab.dataset.id;
    renderGroupTabs();
    loadGroupForm();
    renderModelEditList();
  }
});

dom.btnAddGroup.addEventListener('click', addGroup);

dom.convoGroupTabs.addEventListener('click', function (e) {
  var del = e.target.closest('.group-tab-del');
  if (del) { e.stopPropagation(); deleteConvoGroup(del.dataset.id); return; }
  var tab = e.target.closest('.group-tab');
  if (tab && tab.dataset.id !== state.editingConvoGroupId) {
    flushConvoGroupForm();
    state.editingConvoGroupId = tab.dataset.id;
    renderConvoGroupTabs();
    loadConvoGroupForm();
  }
});

dom.btnAddConvoGroup.addEventListener('click', addConvoGroup);
dom.btnDeleteConvoGroup.addEventListener('click', function () {
  if (state.editingConvoGroupId) deleteConvoGroup(state.editingConvoGroupId);
});

dom.modelEditList.addEventListener('click', function (e) {
  var btn = e.target.closest('.model-edit-btn');
  if (!btn) return;
  var idx = parseInt(btn.dataset.idx);
  if (btn.dataset.action === 'edit') { startModelEdit(idx); }
  else if (btn.dataset.action === 'del') {
    var s = getSettings();
    var g = getGroupIn(s, state.editingGroupId);
    if (g && idx >= 0 && idx < g.models.length) { g.models.splice(idx, 1); setSettings(s); renderModelEditList(); }
  }
});

dom.btnAddModel.addEventListener('click', commitModel);
dom.settingModelInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); commitModel(); }
  if (e.key === 'Escape') cancelModelEdit();
});

// ─── Helpers ────────────────────────────────────────────────────

function setModelValue(v) { dom.modelInput.value = v || ''; }

// ─── 导出与备份 ────────────────────────────────────────────────

function downloadFile(name, content, mime) {
  var blob = new Blob([content], { type: mime });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// 导出当前对话为 Markdown（图片以占位说明代替；思考过程与 token 统计一并导出）
function exportConvoMd() {
  var msgs = state.currentMessages;
  if (!msgs.length) { showToast('当前没有可导出的对话', 'info'); return; }
  var lines = [];
  lines.push('# ' + (dom.conversationTitle.textContent || 'New Chat'));
  lines.push('');
  lines.push('> 导出时间：' + new Date().toLocaleString());
  lines.push('');
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    if (m.role === 'break') { lines.push('--- 清除上下文 ---'); lines.push(''); continue; }
    lines.push('## ' + (m.role === 'user' ? '你' : 'AI 助手') + (m.interrupted ? '（' + (m.interrupted === 'stopped' ? '已停止' : '已中断') + '）' : ''));
    lines.push('');
    if (m.images && m.images.length) { lines.push('［本消息含 ' + m.images.length + ' 张图片，导出时略去］'); lines.push(''); }
    if (m.files && m.files.length) { lines.push('［附件：' + m.files.map(function (f) { return f.name; }).join('、') + '］'); lines.push(''); }
    if (m.role === 'assistant' && m.reasoning) {
      lines.push('<details><summary>思考过程</summary>');
      lines.push('');
      lines.push(m.reasoning);
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    if (m.text) { lines.push(m.text); lines.push(''); }
    if (m.role === 'assistant' && m.usageStats && typeof m.usageStats.total === 'number') {
      lines.push('> tokens：输入 ' + (m.usageStats.prompt || 0) + ' · 输出 ' + (m.usageStats.completion || 0) + ' · 共 ' + m.usageStats.total + ' · 缓存命中 ' + (m.usageStats.hit || 0));
      lines.push('');
    }
  }
  var title = (dom.conversationTitle.textContent || 'New Chat').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  downloadFile('对话-' + title + '-' + new Date().toISOString().slice(0, 10) + '.md', lines.join('\n'), 'text/markdown;charset=utf-8');
  showToast('已导出当前对话', 'success');
}

// 备份全部对话为 JSON（含图片 base64，可直接用于数据恢复）
async function exportAllJson() {
  if (!state.conversations.length) { showToast('没有可备份的对话', 'info'); return; }
  try {
    var backup = [];
    for (var i = 0; i < state.conversations.length; i++) {
      var c = state.conversations[i];
      var messages = await ensureConvoLoaded(c);
      var copy = {};
      for (var k in c) copy[k] = c[k];
      copy.messages = messages.map(serializeMessageForStorage);
      backup.push(copy);
    }
    downloadFile('llm-chat-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(backup), 'application/json;charset=utf-8');
    showToast('已备份全部对话', 'success');
  } catch (e) {
    reportConvoDbError(e);
  }
}

// 从 JSON 备份恢复全部对话
async function importAllJson(file) {
  if (!file) return;
  try {
    var text = await file.text();
    var data = JSON.parse(text);
    var importedConvos = Array.isArray(data) ? data : (data && Array.isArray(data.conversations) ? data.conversations : null);
    if (!importedConvos || !importedConvos.length) {
      if (data && (data.type === 'llm-chat-settings' || data.apiGroups || (data.settings && data.settings.apiGroups))) {
        showToast('该文件为设置配置文件，请在「设置 -> 导入导出」中导入', 'warning');
        return;
      }
      showToast('未在文件中找到有效的对话数据', 'error');
      return;
    }

    var existingMap = {};
    state.conversations.forEach(function (c) {
      existingMap[c.id] = c;
    });

    var count = 0;
    for (var i = 0; i < importedConvos.length; i++) {
      var item = importedConvos[i];
      if (!item || typeof item !== 'object') continue;
      item.id = item.id || uid();
      item.title = item.title || 'New Chat';
      var msgs = Array.isArray(item.messages) ? item.messages : [];
      item.messageCount = msgs.length;
      item.messages = msgs;
      item.createdAt = item.createdAt || new Date().toISOString();
      item.updatedAt = item.updatedAt || new Date().toISOString();
      if (!item.lastMessage && msgs.length) {
        var lastMsg = msgs[msgs.length - 1];
        item.lastMessage = lastMsg ? (lastMsg.text || (lastMsg.files && lastMsg.files.length ? '[' + lastMsg.files[0].name + ']' : '[图片消息]')).slice(0, 80) : '';
      }

      await persistConversation(item, state.conversations.length);

      if (existingMap[item.id]) {
        var idx = state.conversations.findIndex(function (c) { return c.id === item.id; });
        if (idx !== -1) {
          state.conversations[idx] = item;
        }
      } else {
        state.conversations.unshift(item);
        existingMap[item.id] = item;
      }
      count++;
    }

    saveConvos();
    renderSidebar();
    if (count > 0) {
      showToast('成功恢复 ' + count + ' 个对话', 'success');
      if (!state.currentConvoId || !state.currentMessages.length) {
        if (state.conversations[0]) {
          selectConvo(state.conversations[0].id);
        }
      }
    } else {
      showToast('未恢复任何对话（文件格式不匹配）', 'warning');
    }
  } catch (err) {
    console.error('Import failed:', err);
    showToast('恢复数据失败: ' + (err.message || 'JSON 格式解析错误'), 'error');
  } finally {
    if (dom.importJsonInput) dom.importJsonInput.value = '';
  }
}

// ─── Settings Export & Import ──────────────────────────────────

function getExportableSettings(includeApiKey) {
  flushGroupForm();
  flushConvoGroupForm();
  var s = getSettings();
  if (dom.settingFontSize) s.appearance = { fontSize: parseInt(dom.settingFontSize.value, 10) || 14 };
  if (dom.settingShowThinking) s.showThinking = dom.settingShowThinking.checked;

  var clone = JSON.parse(JSON.stringify(s));
  if (!includeApiKey && Array.isArray(clone.apiGroups)) {
    clone.apiGroups.forEach(function (g) {
      g.apiKey = '';
    });
  }
  return {
    version: 1,
    type: 'llm-chat-settings',
    exportDate: new Date().toISOString(),
    settings: clone
  };
}

function exportSettingsJson() {
  try {
    var includeKey = dom.settingExportIncludeKey ? dom.settingExportIncludeKey.checked : true;
    var data = getExportableSettings(includeKey);
    var dateStr = new Date().toISOString().slice(0, 10);
    var filename = 'llm-chat-settings-' + (includeKey ? 'full-' : 'public-') + dateStr + '.json';
    downloadFile(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
    showToast('设置配置已导出', 'success');
  } catch (err) {
    showToast('导出设置失败: ' + err.message, 'error');
  }
}

async function copySettingsJson() {
  try {
    var includeKey = dom.settingExportIncludeKey ? dom.settingExportIncludeKey.checked : true;
    var data = getExportableSettings(includeKey);
    var text = JSON.stringify(data, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast('配置 JSON 已复制到剪贴板', 'success');
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('配置 JSON 已复制到剪贴板', 'success');
    }
  } catch (err) {
    showToast('复制失败: ' + err.message, 'error');
  }
}

function parseImportedSettingsData(rawJson) {
  var data = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  if (!data || typeof data !== 'object') {
    throw new Error('无效的 JSON 数据');
  }
  // 检查是否误传了对话历史备份文件
  if (Array.isArray(data) && data.length > 0 && data[0] && Array.isArray(data[0].messages)) {
    throw new Error('该文件为对话备份文件，请在侧边栏底部的「恢复数据」中导入');
  }
  if (data && Array.isArray(data.conversations)) {
    throw new Error('该文件为对话备份文件，请在侧边栏底部的「恢复数据」中导入');
  }

  // 格式 1: 标准包装格式 { type: 'llm-chat-settings', settings: { ... } }
  if (data.settings && typeof data.settings === 'object') {
    return normalizeSettings(data.settings);
  }
  // 格式 2: 直接导出的设置对象 { apiGroups: [ ... ], ... }
  if (Array.isArray(data.apiGroups)) {
    return normalizeSettings(data);
  }
  // 格式 3: 仅包含 API 分组数组 [ { name: "...", apiBase: "..." }, ... ]
  if (Array.isArray(data) && data.length && (data[0].apiBase || data[0].name || data[0].models)) {
    return normalizeSettings({ apiGroups: data });
  }
  // 格式 4: 旧版单组配置对象 { apiBase: "...", apiKey: "...", ... }
  if (data.apiBase || data.models) {
    return normalizeSettings(data);
  }

  throw new Error('未识别到有效的设置数据结构（需包含 apiGroups 或 settings）');
}

function applyImportedSettings(imported, mode) {
  var current = getSettings();
  var finalSettings;

  if (mode === 'merge') {
    finalSettings = JSON.parse(JSON.stringify(current));
    var existingGroupIds = new Set((finalSettings.apiGroups || []).map(function (g) { return g.id; }));
    var addedGroupCount = 0;

    (imported.apiGroups || []).forEach(function (newG) {
      var gCopy = Object.assign({}, newG);
      if (!gCopy.id || existingGroupIds.has(gCopy.id)) {
        gCopy.id = uid();
      }
      existingGroupIds.add(gCopy.id);
      finalSettings.apiGroups.push(gCopy);
      addedGroupCount++;
    });

    var existingConvoGroupIds = new Set((finalSettings.convoGroups || []).map(function (cg) { return cg.id; }));
    (imported.convoGroups || []).forEach(function (newCG) {
      var cgCopy = Object.assign({}, newCG);
      if (!cgCopy.id || existingConvoGroupIds.has(cgCopy.id)) {
        cgCopy.id = uid();
      }
      existingConvoGroupIds.add(cgCopy.id);
      finalSettings.convoGroups.push(cgCopy);
    });

    if (!finalSettings.proxyUrl && imported.proxyUrl) {
      finalSettings.proxyUrl = imported.proxyUrl;
    }

    finalSettings = normalizeSettings(finalSettings);
    setSettings(finalSettings);
    showToast('已成功合并导入 ' + addedGroupCount + ' 个 API 配置组', 'success');
  } else {
    finalSettings = normalizeSettings(imported);
    setSettings(finalSettings);
    showToast('配置导入成功（已覆盖全部设置）', 'success');
  }

  // 刷新所有关联界面与下拉选择器
  loadSettingsForm();
  applyFontSize();
  renderGroupSelector();
  renderSidebar();
}

async function handleImportSettingsFile(file) {
  if (!file) return;
  try {
    var text = await file.text();
    var imported = parseImportedSettingsData(text);
    var mode = dom.importSettingsMode ? dom.importSettingsMode.value : 'replace';
    applyImportedSettings(imported, mode);
  } catch (err) {
    showToast('导入失败: ' + err.message, 'error');
  }
}

function handleImportSettingsText() {
  if (!dom.importSettingsText) return;
  var text = dom.importSettingsText.value.trim();
  if (!text) {
    showToast('请先粘贴配置 JSON 内容', 'warning');
    return;
  }
  try {
    var imported = parseImportedSettingsData(text);
    var mode = dom.importSettingsMode ? dom.importSettingsMode.value : 'replace';
    applyImportedSettings(imported, mode);
    dom.importSettingsText.value = '';
  } catch (err) {
    showToast('导入失败: ' + err.message, 'error');
  }
}

// ─── Events ─────────────────────────────────────────────────────

dom.chatOutline.addEventListener('click', function (e) {
  var item = e.target.closest('.chat-outline-item');
  if (!item) return;
  var idx = parseInt(item.dataset.idx, 10);
  if (isNaN(idx)) return;

  if (state.renderedMessageStart > idx) {
    mountAllEarlierMessages();
  }
  var el = dom.messagesContainer.querySelector('.message[data-index="' + idx + '"]');
  if (!el) return;

  state.isProgrammaticScrolling = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash');
  requestAnimationFrame(function () { el.classList.add('flash'); });
  setTimeout(function () {
    state.isProgrammaticScrolling = false;
    el.classList.remove('flash');
  }, 1000);
});

dom.btnNewChat.addEventListener('click', function () { newConvo(); });
dom.conversationList.addEventListener('click', function (e) {
  var newBtn = e.target.closest('.btn-group-new');
  if (newBtn) { e.stopPropagation(); newConvo(newBtn.dataset.groupId); return; }
  var head = e.target.closest('.sidebar-group-head');
  if (head) { e.stopPropagation(); toggleConvoGroupCollapse(head.closest('.sidebar-group').dataset.groupId); return; }
  var item = e.target.closest('.convo-item');
  if (!item) return;
  var btn = e.target.closest('[data-action="delete"]');
  if (btn) { e.stopPropagation(); openDeleteConfirm(btn.dataset.id); return; }
  var moveBtn = e.target.closest('[data-action="move"]');
  if (moveBtn) { e.stopPropagation(); openConvoMovePopover(moveBtn.dataset.id, moveBtn); return; }
  if (item.dataset.id && item.dataset.id !== state.currentConvoId) selectConvo(item.dataset.id);
});

// ─── 侧边栏对话拖拽排序与跨组移动 ──────────────────────────────
var draggedConvoId = null;

dom.conversationList.addEventListener('dragstart', function (e) {
  var item = e.target.closest('.convo-item');
  if (!item) return;
  // 若在操作按钮、加号按钮或弹出菜单上拖拽，不触发拖动
  if (e.target.closest('.convo-actions') || e.target.closest('.btn-group-new') || e.target.closest('.convo-move-popover')) {
    e.preventDefault();
    return;
  }
  draggedConvoId = item.dataset.id;
  item.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedConvoId);
  }
});

dom.conversationList.addEventListener('dragover', function (e) {
  if (!draggedConvoId) return;
  e.preventDefault();

  var item = e.target.closest('.convo-item');
  if (item && item.dataset.id !== draggedConvoId) {
    var rect = item.getBoundingClientRect();
    var isTop = (e.clientY - rect.top) < (rect.height / 2);
    item.classList.toggle('drag-over-top', isTop);
    item.classList.toggle('drag-over-bottom', !isTop);
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    return;
  }

  // 拖动到了分组头部或空白占位符上
  var group = e.target.closest('.sidebar-group');
  if (group) {
    group.classList.add('drag-over-group');
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }
});

dom.conversationList.addEventListener('dragleave', function (e) {
  var item = e.target.closest('.convo-item');
  if (item && (!e.relatedTarget || !item.contains(e.relatedTarget))) {
    item.classList.remove('drag-over-top', 'drag-over-bottom');
  }
  var group = e.target.closest('.sidebar-group');
  if (group && (!e.relatedTarget || !group.contains(e.relatedTarget))) {
    group.classList.remove('drag-over-group');
  }
});

dom.conversationList.addEventListener('drop', function (e) {
  if (!draggedConvoId) return;
  e.preventDefault();

  var sourceId = draggedConvoId;
  clearDragOverStyles();

  var sourceC = state.conversations.find(function (c) { return c.id === sourceId; });
  if (!sourceC) return;

  var targetItem = e.target.closest('.convo-item');
  if (targetItem && targetItem.dataset.id && targetItem.dataset.id !== sourceId) {
    var targetId = targetItem.dataset.id;
    var targetC = state.conversations.find(function (c) { return c.id === targetId; });
    if (targetC) {
      var rect = targetItem.getBoundingClientRect();
      var isTop = (e.clientY - rect.top) < (rect.height / 2);

      // 更新所属分组（拖拽到其他组的项时自动划入该组）
      sourceC.groupId = targetC.groupId;

      // 调整列表顺序
      var sourceIdx = state.conversations.indexOf(sourceC);
      if (sourceIdx !== -1) state.conversations.splice(sourceIdx, 1);
      var targetIdx = state.conversations.indexOf(targetC);
      var insertIdx = isTop ? targetIdx : targetIdx + 1;
      state.conversations.splice(insertIdx, 0, sourceC);

      persistAndRefreshConvoOrder();
      return;
    }
  }

  // 拖动到了分组头部或分组空白区域（直接移入该组）
  var group = e.target.closest('.sidebar-group');
  if (group) {
    var targetGroupId = group.dataset.groupId || '';
    var newGroupId = targetGroupId ? targetGroupId : undefined;
    sourceC.groupId = newGroupId;
    var sIdx = state.conversations.indexOf(sourceC);
    if (sIdx !== -1) state.conversations.splice(sIdx, 1);
    var firstInGroupIdx = state.conversations.findIndex(function (c) {
      return (c.groupId || '') === targetGroupId;
    });
    if (firstInGroupIdx !== -1) {
      state.conversations.splice(firstInGroupIdx, 0, sourceC);
    } else {
      state.conversations.unshift(sourceC);
    }
    persistAndRefreshConvoOrder();
  }
});

dom.conversationList.addEventListener('dragend', function (e) {
  var item = e.target.closest('.convo-item');
  if (item) item.classList.remove('dragging');
  clearDragOverStyles();
  draggedConvoId = null;
});

function clearDragOverStyles() {
  dom.conversationList.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(function (el) {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  dom.conversationList.querySelectorAll('.drag-over-group').forEach(function (el) {
    el.classList.remove('drag-over-group');
  });
}

function persistAndRefreshConvoOrder() {
  state.conversations.forEach(function (c, idx) {
    c.listOrder = idx;
  });
  saveConvos();
  renderSidebar();
}

document.addEventListener('click', function (e) {
  if (movePopoverEl && !movePopoverEl.contains(e.target)) closeConvoMovePopover();
});
dom.sidebarToggle.addEventListener('click', function () { dom.sidebar.classList.toggle('collapsed'); });

dom.btnSettings.addEventListener('click', openSettings);
dom.btnExportMd.addEventListener('click', exportConvoMd);
dom.btnExportJson.addEventListener('click', exportAllJson);
if (dom.btnImportJson) {
  dom.btnImportJson.addEventListener('click', function () {
    if (dom.importJsonInput) dom.importJsonInput.click();
  });
}
if (dom.importJsonInput) {
  dom.importJsonInput.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) importAllJson(file);
  });
}
dom.btnSettingsClose.addEventListener('click', closeSettings);
dom.btnSettingsCancel.addEventListener('click', closeSettings);
dom.btnSettingsSave.addEventListener('click', saveSettingsForm);
dom.settingsOverlay.addEventListener('click', function (e) { if (e.target === dom.settingsOverlay) closeSettings(); });
if (dom.btnExportSettingsJson) dom.btnExportSettingsJson.addEventListener('click', exportSettingsJson);
if (dom.btnCopySettingsJson) dom.btnCopySettingsJson.addEventListener('click', copySettingsJson);
if (dom.btnSelectSettingsFile) {
  dom.btnSelectSettingsFile.addEventListener('click', function () {
    if (dom.importSettingsFileInput) dom.importSettingsFileInput.click();
  });
}
if (dom.importSettingsFileInput) {
  dom.importSettingsFileInput.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) handleImportSettingsFile(file);
    e.target.value = '';
  });
}
if (dom.btnApplyImportSettingsText) dom.btnApplyImportSettingsText.addEventListener('click', handleImportSettingsText);
if (dom.btnQuickExportSettings) dom.btnQuickExportSettings.addEventListener('click', exportSettingsJson);
if (dom.btnQuickImportSettings) {
  dom.btnQuickImportSettings.addEventListener('click', function () {
    switchSettingsTab('backup');
  });
}

dom.btnRenameConvo.addEventListener('click', function () { openRenameConvo(state.currentConvoId); });
dom.btnRenameConvoClose.addEventListener('click', closeRenameConvo);
dom.btnRenameConvoCancel.addEventListener('click', closeRenameConvo);
dom.btnRenameConvoSave.addEventListener('click', saveConvoRename);
dom.renameConvoOverlay.addEventListener('click', function (e) { if (e.target === dom.renameConvoOverlay) closeRenameConvo(); });
dom.renameConvoInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); saveConvoRename(); }
  if (e.key === 'Escape') { e.preventDefault(); closeRenameConvo(); }
});

dom.btnDeleteConfirmClose.addEventListener('click', closeDeleteConfirm);
dom.btnDeleteConfirmCancel.addEventListener('click', closeDeleteConfirm);
dom.btnDeleteConfirmOk.addEventListener('click', confirmDeleteConvo);
dom.deleteConfirmOverlay.addEventListener('click', function (e) { if (e.target === dom.deleteConfirmOverlay) closeDeleteConfirm(); });

document.addEventListener('click', function (e) {
  var btn = e.target.closest('.btn-eye');
  if (!btn) return;
  var t = document.getElementById(btn.dataset.target);
  if (t) t.type = t.type === 'password' ? 'text' : 'password';
});

dom.messageInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === 'Escape') stopStreaming();
});
dom.messageInput.addEventListener('input', function () {
  dom.messageInput.style.height = 'auto';
  dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 160) + 'px';
  syncOutlineBounds();
});
dom.btnSend.addEventListener('click', sendMessage);
dom.btnFileUpload.addEventListener('click', function () { dom.fileInput.click(); });
dom.fileInput.addEventListener('change', function (e) { addFiles(e.target.files); dom.fileInput.value = ''; });

dom.btnImageOverlayClose.addEventListener('click', function () { dom.imageOverlay.classList.remove('active'); });
dom.imageOverlay.addEventListener('click', function (e) { if (e.target === dom.imageOverlay) dom.imageOverlay.classList.remove('active'); });

// ─── PDF Page Viewer ────────────────────────────────────────────
var activePdfViewerFile = null;
var activePdfViewerPageIndex = 0;

function openPdfViewer(file, initialPageIndex) {
  if (!file || !file.pages || !file.pages.length) return;
  activePdfViewerFile = file;
  activePdfViewerPageIndex = initialPageIndex || 0;
  if (dom.pdfViewerTitle) dom.pdfViewerTitle.textContent = file.name || '文档页面预览';
  renderPdfViewerPage();
  renderPdfViewerThumbnails();
  if (dom.pdfViewerOverlay) dom.pdfViewerOverlay.classList.add('active');
}

function closePdfViewer() {
  if (dom.pdfViewerOverlay) dom.pdfViewerOverlay.classList.remove('active');
  activePdfViewerFile = null;
  activePdfViewerPageIndex = 0;
}

function renderPdfViewerPage() {
  if (!activePdfViewerFile || !activePdfViewerFile.pages || !activePdfViewerFile.pages.length) return;
  var pages = activePdfViewerFile.pages;
  if (activePdfViewerPageIndex < 0) activePdfViewerPageIndex = 0;
  if (activePdfViewerPageIndex >= pages.length) activePdfViewerPageIndex = pages.length - 1;
  var curr = pages[activePdfViewerPageIndex];
  if (dom.pdfViewerImg) dom.pdfViewerImg.src = curr.dataUrl;
  var totalInfo = (activePdfViewerFile.pageCount && activePdfViewerFile.pageCount > pages.length)
    ? (' (总计 ' + activePdfViewerFile.pageCount + ' 页，已渲染前 ' + pages.length + ' 页)')
    : (' (共 ' + pages.length + ' 页)');
  var profileInfo = activePdfViewerFile.profileLabel ? (' · ' + activePdfViewerFile.profileLabel) : '';
  if (dom.pdfViewerPageBadge) dom.pdfViewerPageBadge.textContent = '第 ' + (activePdfViewerPageIndex + 1) + ' / ' + pages.length + ' 页' + profileInfo + totalInfo;
  if (dom.btnPdfViewerPrev) dom.btnPdfViewerPrev.disabled = (activePdfViewerPageIndex <= 0);
  if (dom.btnPdfViewerNext) dom.btnPdfViewerNext.disabled = (activePdfViewerPageIndex >= pages.length - 1);

  var thumbs = dom.pdfViewerThumbnails ? dom.pdfViewerThumbnails.querySelectorAll('.pdf-thumb-item') : [];
  thumbs.forEach(function (t, idx) {
    if (idx === activePdfViewerPageIndex) {
      t.classList.add('active');
      t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } else {
      t.classList.remove('active');
    }
  });
}

function renderPdfViewerThumbnails() {
  if (!activePdfViewerFile || !activePdfViewerFile.pages || !dom.pdfViewerThumbnails) return;
  var pages = activePdfViewerFile.pages;
  var html = pages.map(function (p, idx) {
    return '<div class="pdf-thumb-item' + (idx === activePdfViewerPageIndex ? ' active' : '') + '" data-page-index="' + idx + '" title="第 ' + (idx + 1) + ' 页">' +
      '<img src="' + esc(p.dataUrl) + '" alt="Page ' + (idx + 1) + '">' +
      '<span class="thumb-num">' + (idx + 1) + '</span>' +
    '</div>';
  }).join('');
  dom.pdfViewerThumbnails.innerHTML = html;
  dom.pdfViewerThumbnails.querySelectorAll('.pdf-thumb-item').forEach(function (thumbEl) {
    thumbEl.addEventListener('click', function () {
      activePdfViewerPageIndex = parseInt(this.dataset.pageIndex, 10);
      renderPdfViewerPage();
    });
  });
}

if (dom.btnPdfViewerPrev) {
  dom.btnPdfViewerPrev.addEventListener('click', function () {
    if (activePdfViewerPageIndex > 0) {
      activePdfViewerPageIndex--;
      renderPdfViewerPage();
    }
  });
}

if (dom.btnPdfViewerNext) {
  dom.btnPdfViewerNext.addEventListener('click', function () {
    if (activePdfViewerFile && activePdfViewerFile.pages && activePdfViewerPageIndex < activePdfViewerFile.pages.length - 1) {
      activePdfViewerPageIndex++;
      renderPdfViewerPage();
    }
  });
}

if (dom.btnPdfViewerClose) {
  dom.btnPdfViewerClose.addEventListener('click', closePdfViewer);
}

if (dom.pdfViewerOverlay) {
  dom.pdfViewerOverlay.addEventListener('click', function (e) {
    if (e.target === dom.pdfViewerOverlay) closePdfViewer();
  });
}

dom.messagesContainer.addEventListener('click', function (e) {
  var previewFileBtn = e.target.closest('.btn-file-preview-action');
  if (previewFileBtn) {
    var pMsgIdx = parseInt(previewFileBtn.dataset.msgIdx, 10);
    var pFileIdx = parseInt(previewFileBtn.dataset.fileIdx, 10);
    var targetMsg = state.currentMessages[pMsgIdx];
    if (targetMsg && targetMsg.files && targetMsg.files[pFileIdx]) {
      openPdfViewer(targetMsg.files[pFileIdx]);
    }
    return;
  }
  var pdfCard = e.target.closest('.message-file.is-pdf');
  if (pdfCard) {
    var pBtn = pdfCard.querySelector('.btn-file-preview-action');
    if (pBtn) {
      var mIdx = parseInt(pBtn.dataset.msgIdx, 10);
      var fIdx = parseInt(pBtn.dataset.fileIdx, 10);
      var tMsg = state.currentMessages[mIdx];
      if (tMsg && tMsg.files && tMsg.files[fIdx]) {
        openPdfViewer(tMsg.files[fIdx]);
      }
      return;
    }
  }
  var copyBtn = e.target.closest('.message-copy-btn');
  if (copyBtn) { copyMessageFromBtn(copyBtn); return; }

  var regenBtn = e.target.closest('.message-regen-btn');
  if (regenBtn) {
    var regenEl = regenBtn.closest('.message');
    if (regenEl) { var rIdx = parseInt(regenEl.dataset.index, 10); if (!isNaN(rIdx)) regenerateFromMessage(rIdx); }
    return;
  }

  var branchBtn = e.target.closest('.message-branch-btn');
  if (branchBtn) {
    var branchEl = branchBtn.closest('.message');
    if (branchEl) {
      var branchIdx = parseInt(branchEl.dataset.index, 10);
      if (!isNaN(branchIdx)) branchConvoFromMessage(branchIdx);
    }
    return;
  }

  var chip = e.target.closest('.suggestion-chip');
  if (chip) { dom.messageInput.value = chip.dataset.prompt; sendMessage(); return; }

  copyBtn = e.target.closest('.code-copy-btn');
  if (copyBtn) { copyCodeText(copyBtn); return; }

  var delBtn = e.target.closest('.message-del-btn');
  if (delBtn) {
    var msgEl4 = delBtn.closest('.message');
    if (msgEl4) { var delIdx = parseInt(msgEl4.dataset.index, 10); if (!isNaN(delIdx)) deleteMessage(delIdx); }
    return;
  }

  var editBtn = e.target.closest('.message-edit-btn');
  if (editBtn) { var msgEl = editBtn.closest('.message'); if (msgEl) enterEditMode(msgEl); return; }

  var cancelBtn = e.target.closest('.btn-edit-cancel');
  if (cancelBtn) { var msgEl2 = cancelBtn.closest('.message'); if (msgEl2) exitEditMode(msgEl2); return; }

  var saveBtn = e.target.closest('.btn-edit-save');
  if (saveBtn) { var msgEl3 = saveBtn.closest('.message'); if (msgEl3) { var idx = parseInt(msgEl3.dataset.index); if (!isNaN(idx)) resendFromMessage(msgEl3, idx); } return; }
});

document.addEventListener('paste', function (e) {
  var files = [];
  var items = e.clipboardData && e.clipboardData.items;
  if (items) { for (var i = 0; i < items.length; i++) { if (items[i].type.indexOf('image/') === 0) files.push(items[i].getAsFile()); } }
  if (files.length) { e.preventDefault(); addFiles(files); return; }

  // 针对安全浏览器场景增强：粘贴的纯文本中如果包含 Base64 图片，自动提取并转为图片预览
  // 避免数十万字符的 Base64 塞进 textarea 导致输入框排版卡死
  var pastedText = e.clipboardData ? e.clipboardData.getData('text') : '';
  if (pastedText && pastedText.indexOf('data:image/') !== -1 && /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/i.test(pastedText)) {
    // 内存熔断保护：若单次粘贴文本超过 25MB，阻止直接处理以防沙箱内存溢出崩溃
    if (pastedText.length > 25 * 1024 * 1024) {
      e.preventDefault();
      showToast('粘贴的数据过大（超过 25MB），为防止浏览器卡死已拦截，请先用转码工具压缩', 'warning');
      return;
    }
    var parsed = extractBase64Images(pastedText);
    if (parsed.images.length > 0) {
      e.preventDefault();
      var addedCount = 0;
      var oversized = 0;
      parsed.images.forEach(function (imgData) {
        if (imgData.length > 15 * 1024 * 1024) {
          oversized++;
          return;
        }
        if (state.pendingImages.length < MAX_PENDING_IMAGES) {
          state.pendingImages.push(imgData);
          addedCount++;
        }
      });
      renderAttachmentPreviews();

      // 若同时包含普通文字（如附带的提问），把普通文字填入输入框
      if (parsed.text && document.activeElement === dom.messageInput) {
        var start = dom.messageInput.selectionStart || 0;
        var end = dom.messageInput.selectionEnd || 0;
        var val = dom.messageInput.value;
        dom.messageInput.value = val.slice(0, start) + parsed.text + val.slice(end);
        dom.messageInput.selectionStart = dom.messageInput.selectionEnd = start + parsed.text.length;
        dom.messageInput.style.height = 'auto';
        dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 160) + 'px';
      }
      if (oversized > 0) {
        showToast('已提取图片，但有 ' + oversized + ' 张因超过 15MB 被跳过', 'warning');
      } else if (addedCount > 0) {
        showToast('已自动将粘贴的 Base64 转为图片附件 (' + addedCount + ' 张)', 'success');
      } else if (state.pendingImages.length >= MAX_PENDING_IMAGES) {
        showToast('图片附件已达 ' + MAX_PENDING_IMAGES + ' 张上限', 'warning');
      }
    }
  }
});

var inputArea = document.querySelector('.input-area');
if (inputArea) {
  inputArea.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); });
  inputArea.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
}
document.addEventListener('dragover', function (e) { e.preventDefault(); });
document.addEventListener('drop', function (e) { e.preventDefault(); });

document.addEventListener('keydown', function (e) {
  if (dom.pdfViewerOverlay && dom.pdfViewerOverlay.classList.contains('active')) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePdfViewer();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (activePdfViewerPageIndex > 0) {
        activePdfViewerPageIndex--;
        renderPdfViewerPage();
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (activePdfViewerFile && activePdfViewerFile.pages && activePdfViewerPageIndex < activePdfViewerFile.pages.length - 1) {
        activePdfViewerPageIndex++;
        renderPdfViewerPage();
      }
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    // Ctrl+K 已从「聚焦输入框」改为「清除上下文」；设置/删除确认弹窗打开时不触发
    if (dom.settingsOverlay.classList.contains('active')) return;
    if (dom.deleteConfirmOverlay.classList.contains('active')) return;
    if (dom.pdfViewerOverlay && dom.pdfViewerOverlay.classList.contains('active')) return;
    setContextBreak();
  }
});

// ─── Go ─────────────────────────────────────────────────────────

setupMarkdown();
init();
