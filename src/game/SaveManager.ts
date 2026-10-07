// Sauvegardes : IndexedDB (repli localStorage). Une sauvegarde = seed + version du générateur
// + différences avec le monde généré (le reste se régénère à l'identique depuis la seed).

export interface SaveData {
  /** arbres abattus, rochers brisés */
  removed?: string[];
  format: 1;
  game: string; generator: string; seed: string; savedAt: number; label: string;
  time: number;
  player: { x: number; y: number; z: number; heading: number; pitch: number; hp: number; stamina: number; mana: number; dungeon: number; ret: { x: number; z: number; heading: number } | null };
  character: { stats: Record<string, number>; skills: Record<string, number>; skillXp: Record<string, number>; level: number; xp: number; statPoints: number; inv: [string, number][]; gold: number; equip: Record<string, string | null> };
  state: { opened: string[]; dropped: { key: string; id: string; qty: number; x: number; y: number; z: number }[]; flags: [string, number | string | boolean][]; discovered: string[]; explored: string };
  npcs: { id: string; alive: boolean; hp: number; wealth: number; memories: { kind: string; subject: string; day: number; weight: number; text: string }[] }[];
  rep: { global: number; faction: number[]; local: [number, number][]; bounty: [number, number][] };
  economy: [number, Record<string, number>][];
  quests: { id: string; status: string; stage: number; killed: number }[];
  rumors: { text: string; origin: number; day: number; reach: number[]; tag: string }[];
  lairs: { key: string; alive: number; leaderAlive: boolean }[];
  killed: string[];
  clearedCamps: number[];
}

const DB = 'ascii-fort', STORE = 'saves', META = 'ascii-fort-save-meta';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB indisponible')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const SaveManager = {
  async save(slot: string, data: SaveData): Promise<void> {
    try {
      const db = await openDb();
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(data, slot);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
      });
    } catch {
      localStorage.setItem(`ascii-fort-save:${slot}`, JSON.stringify(data));
    }
    try { localStorage.setItem(META, JSON.stringify({ slot, seed: data.seed, savedAt: data.savedAt, label: data.label })); } catch { /* ignore */ }
  },

  async load(slot: string): Promise<SaveData | null> {
    try {
      const db = await openDb();
      const v = await new Promise<SaveData | undefined>((res, rej) => {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(slot);
        r.onsuccess = () => res(r.result as SaveData | undefined); r.onerror = () => rej(r.error);
      });
      if (v) return v;
    } catch { /* repli */ }
    const s = localStorage.getItem(`ascii-fort-save:${slot}`);
    return s ? (JSON.parse(s) as SaveData) : null;
  },

  /** Dernière sauvegarde écrite (pour « Continuer »). */
  latest(): { slot: string; seed: string; savedAt: number; label: string } | null {
    try { const m = localStorage.getItem(META); return m ? JSON.parse(m) : null; } catch { return null; }
  },
};

/** Encodage compact d'un tableau d'octets 0/1 (brouillard de la carte) : base64 de bits. */
export function packBits(a: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(a.length / 8));
  for (let i = 0; i < a.length; i++) if (a[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function unpackBits(s: string, out: Uint8Array): void {
  const b = atob(s);
  for (let i = 0; i < out.length; i++) out[i] = (b.charCodeAt(i >> 3) >> (i & 7)) & 1;
}
