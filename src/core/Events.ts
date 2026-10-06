// Bus d'événements typé : c'est par lui que les systèmes communiquent
// (mort → réputation, mémoire des PNJ, rumeurs, quêtes, économie…).

export interface GameEvents {
  'entity:killed': { victimId: string; killerId: string | null; kind: 'npc' | 'monster' | 'player'; type: string; factionId?: number; settlementId?: number; campId?: number; x: number; z: number };
  'entity:damaged': { targetId: string; sourceId: string | null; amount: number };
  'player:crime': { type: 'vol' | 'agression' | 'meurtre'; victimId?: string; settlementId?: number; factionId?: number; witnesses: string[]; value?: number };
  'player:helped': { npcId: string; magnitude: number; reason: string };
  'item:picked': { itemId: string; qty: number; key?: string };
  'container:opened': { key: string; ownerId?: string };
  'camp:cleared': { campId: number };
  'quest:started': { questId: string };
  'quest:updated': { questId: string };
  'quest:completed': { questId: string };
  'place:discovered': { placeId: string };
  'weather:changed': { region: number; state: string };
  'time:hour': { hour: number; day: number };
  'trade': { npcId: string; itemId: string; qty: number; price: number; sold: boolean };
  'message': { text: string; color?: number };
  'noise': { x: number; z: number; radius: number; sourceId: string };
  'corpse:found': { finderId: string; victimId: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Handler<any>[]>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
    return () => { const l = this.handlers.get(type); if (l) l.splice(l.indexOf(fn), 1); };
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const list = this.handlers.get(type);
    if (list) for (const fn of [...list]) fn(payload);
  }
}
