/* Persistencia local con IndexedDB: documentos, audios y ajustes.
   Nada de esto sale del navegador del usuario. */

const DB_NAME = 'voz-a-texto';
const DB_VER  = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('audios')) {
        const a = db.createObjectStore('audios', { keyPath: 'id' });
        a.createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  });
}

/* ── Documentos ───────────────────────────────── */
export const Sessions = {
  all:  () => tx('sessions', 'readonly',  s => s.getAll()),
  get:  id => tx('sessions', 'readonly',  s => s.get(id)),
  put:  obj => tx('sessions', 'readwrite', s => s.put(obj)),
  del:  id => tx('sessions', 'readwrite', s => s.delete(id)),
};

/* ── Audios ───────────────────────────────────── */
export const Audios = {
  put: obj => tx('audios', 'readwrite', s => s.put(obj)),
  get: id  => tx('audios', 'readonly',  s => s.get(id)),
  del: id  => tx('audios', 'readwrite', s => s.delete(id)),
  bySession: sessionId =>
    tx('audios', 'readonly', s => s.index('sessionId').getAll(sessionId)),
  async delBySession(sessionId) {
    const list = await Audios.bySession(sessionId);
    for (const a of list) await Audios.del(a.id);
    return list.length;
  },
};

/* ── Ajustes / perfil de voz ──────────────────── */
export const Settings = {
  async get(key, fallback = null) {
    const row = await tx('settings', 'readonly', s => s.get(key));
    return row ? row.value : fallback;
  },
  set: (key, value) => tx('settings', 'readwrite', s => s.put({ key, value })),
};

/** Espacio ocupado (aproximado) por los audios guardados */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

export function newSession(lang = 'es-AR') {
  const now = Date.now();
  return {
    id: 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: 'Documento sin título',
    text: '',
    lang,
    createdAt: now,
    updatedAt: now,
    dictatedMs: 0,
  };
}
