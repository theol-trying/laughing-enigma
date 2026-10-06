import type { EventBus } from '@ascii-fort/core/Events';
import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import type { NPCData } from '../entities/NPC';
import { factionOf } from '@ascii-fort/worldgen/civilization/History';

// Réputation (globale, par faction, locale) et mémoire des PNJ. Les événements du jeu
// modifient l'opinion → dialogues, prix, quêtes, hostilité des gardes.

export interface NpcLookup { findNpc(id: string): NPCData | undefined; npcsOf(sid: number): NPCData[] }

export class Reputation {
  global = 0;                                   // renommée −100 … 100
  faction: number[];                            // par faction
  readonly local = new Map<number, number>();   // par implantation
  /** amendes en cours par implantation (délits vus par des témoins) */
  readonly bounty = new Map<number, number>();
  day = () => 0;

  constructor(private civ: Civilization, events: EventBus, private npcs: NpcLookup) {
    this.faction = civ.factions.map(() => 0);
    events.on('player:crime', (c) => {
      const severe = c.type === 'meurtre' ? 40 : c.type === 'agression' ? 12 : 5;
      if (!c.witnesses.length) return;
      if (c.settlementId !== undefined) {
        this.addLocal(c.settlementId, -severe);
        this.bounty.set(c.settlementId, (this.bounty.get(c.settlementId) ?? 0) + (c.type === 'meurtre' ? 400 : c.type === 'agression' ? 60 : (c.value ?? 10) * 3));
      }
      if (c.factionId !== undefined && c.factionId >= 0) this.faction[c.factionId] -= severe / 2;
      this.global -= severe / 4;
      const verb = c.type === 'vol' ? 'm\'a volé' : c.type === 'agression' ? 'a attaqué quelqu\'un' : 'a tué quelqu\'un';
      for (const id of c.witnesses) this.remember(id, c.type, `Le voyageur ${verb} sous mes yeux.`, -0.6);
      if (c.victimId) this.remember(c.victimId, c.type, 'Le voyageur s\'en est pris à moi.', -1);
    });
    events.on('entity:killed', (k) => {
      if (k.killerId !== 'player') return;
      if (k.kind === 'npc') {
        // la famille et les amis de la victime s'en souviendront
        const v = this.npcs.findNpc(k.victimId);
        if (v) for (const r of v.relations) if (r.kind !== 'rival') this.remember(r.id, 'meurtre', `Le voyageur a tué ${v.first}.`, -1.5);
        return;
      }
      const bandit = k.type === 'bandit' || k.type === 'chef bandit';
      const near = civ.settlements.filter((s) => !s.abandoned && s.type !== 'camp' && Math.hypot(s.x - k.x, s.z - k.z) < 700);
      for (const s of near) this.addLocal(s.id, bandit ? 2 : 1);
      if (bandit) {
        this.faction[factionOf(civ, 'bandits').id] -= 8;
        for (const f of civ.factions) if (f.kind === 'royaume' || f.kind === 'guilde') this.faction[f.id] += 1;
      }
      this.global += k.type === 'troll' ? 15 : 0.5;
    });
    events.on('camp:cleared', ({ campId }) => {
      const camp = civ.pois.find((p) => p.settlementId === campId && p.kind === 'camp de bandits');
      const road = camp ? civ.roads[camp.roadId] : undefined;
      this.global += 10;
      if (road) { this.addLocal(road.a, 15); this.addLocal(road.b, 15); }
      this.faction[factionOf(civ, 'bandits').id] -= 30;
      this.faction[factionOf(civ, 'guilde').id] += 10;
      for (const f of civ.factions) if (f.kind === 'royaume') this.faction[f.id] += 4;
    });
    events.on('player:helped', (h) => {
      if (h.npcId === 'ordre') { this.faction[factionOf(civ, 'ordre').id] += h.magnitude * 10; return; }
      const n = this.npcs.findNpc(h.npcId);
      if (n) { this.remember(n.id, 'aide', h.reason, h.magnitude); this.addLocal(n.sid, h.magnitude * 8); }
      this.global += h.magnitude * 2;
    });
  }

  addLocal(sid: number, v: number): void { this.local.set(sid, Math.max(-100, Math.min(100, (this.local.get(sid) ?? 0) + v))); }

  remember(npcId: string, kind: string, text: string, weight: number): void {
    const n = this.npcs.findNpc(npcId);
    if (!n) return;
    n.memories.push({ kind, subject: 'joueur', day: this.day(), weight, text });
    if (n.memories.length > 12) n.memories.shift();
  }

  /** Opinion d'un PNJ sur le joueur (−100 … 100). */
  opinion(n: NPCData): number {
    let o = (n.traits.kindness - 0.5) * 20 + (this.local.get(n.sid) ?? 0) * 0.5 + this.global * 0.2;
    if (n.factionId >= 0) o += (this.faction[n.factionId] ?? 0) * 0.3;
    for (const m of n.memories) if (m.subject === 'joueur') o += m.weight * 30;
    return Math.max(-100, Math.min(100, o));
  }

  /** Multiplicateur de prix selon l'opinion (amis : moins cher). */
  priceFactor(n: NPCData): number { return Math.max(0.8, Math.min(1.5, 1 - this.opinion(n) / 250)); }

  mood(n: NPCData): 'hostile' | 'méfiant' | 'neutre' | 'amical' {
    const o = this.opinion(n);
    return o < -45 ? 'hostile' : o < -12 ? 'méfiant' : o > 30 ? 'amical' : 'neutre';
  }
}
