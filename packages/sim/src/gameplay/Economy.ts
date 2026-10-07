import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import type { Good } from '@ascii-fort/worldgen/civilization/types';
import type { WorldSeed } from '@ascii-fort/core/Seed';
import type { NPCData } from '../entities/NPC';
import { item, type ItemDef } from './Items';

// Économie simplifiée : chaque implantation produit et importe des biens par les routes.
// Un camp de bandits actif bloque sa route → pénurie et hausse des prix chez les marchands
// qui en dépendent ; une fois le camp démantelé, l'offre revient progressivement.

export const GOODS: Good[] = ['grain', 'bois', 'minerai', 'fer', 'poisson', 'laine', 'herbes', 'sel', 'vin', 'pierre', 'gibier', 'outils', 'étoffe'];
export const GOOD_NAMES: Record<Good, string> = {
  grain: 'le grain', bois: 'le bois', minerai: 'le minerai', fer: 'le fer', poisson: 'le poisson', laine: 'la laine', herbes: 'les herbes',
  sel: 'le sel', vin: 'le vin', pierre: 'la pierre', gibier: 'le gibier', outils: 'les outils', étoffe: "l'étoffe",
};

export interface Shortage { good: Good; supply: number; roadId: number; from: number }

export class Economy {
  /** offre courante (1 = normale) par implantation et par bien */
  readonly supply = new Map<number, Record<Good, number>>();
  readonly blocked = new Set<number>();

  constructor(private civ: Civilization, private seed: WorldSeed, private campActive: (campSid: number) => boolean) {
    this.refreshBlocked();
    for (const s of civ.settlements) {
      const rec = {} as Record<Good, number>;
      for (const g of GOODS) rec[g] = this.target(s.id, g);
      this.supply.set(s.id, rec);
    }
  }

  /** Routes bloquées : un camp de bandits non démantelé s'y trouve. */
  refreshBlocked(): void {
    this.blocked.clear();
    for (const p of this.civ.pois) if (p.kind === 'camp de bandits' && p.roadId >= 0 && this.campActive(p.settlementId)) this.blocked.add(p.roadId);
  }

  /** Voisins directs (par la route) qui produisent ce bien. */
  sources(sid: number, g: Good): { roadId: number; from: number }[] {
    const out: { roadId: number; from: number }[] = [];
    for (const r of this.civ.roads) {
      if (r.a !== sid && r.b !== sid) continue;
      const o = r.a === sid ? r.b : r.a;
      if (this.civ.settlements[o]?.produces.includes(g)) out.push({ roadId: r.id, from: o });
    }
    return out;
  }

  target(sid: number, g: Good): number {
    const s = this.civ.settlements[sid];
    if (s.produces.includes(g)) return 1.2;
    const src = this.sources(sid, g);
    if (!src.length) return 0.75;
    const open = src.filter((x) => !this.blocked.has(x.roadId)).length;
    return 0.4 + 0.7 * (open / src.length);
  }

  /** Chaque jour, l'offre glisse vers sa cible (chute rapide, reprise lente). */
  dailyTick(): void {
    this.refreshBlocked();
    for (const s of this.civ.settlements) {
      const rec = this.supply.get(s.id)!;
      for (const g of GOODS) {
        const t = this.target(s.id, g), v = rec[g];
        rec[g] = v > t ? Math.max(t, v - 0.35) : Math.min(t, v + 0.15);
      }
    }
  }

  supplyOf(sid: number, g: Good): number { return this.supply.get(sid)?.[g] ?? 1; }

  /** Pénuries d'une implantation, avec leur cause (route bloquée). */
  shortages(sid: number): Shortage[] {
    const out: Shortage[] = [];
    for (const g of GOODS) {
      const v = this.supplyOf(sid, g);
      if (v >= 0.75) continue;
      const src = this.sources(sid, g).find((x) => this.blocked.has(x.roadId)) ?? this.sources(sid, g)[0];
      if (src) out.push({ good: g, supply: v, roadId: src.roadId, from: src.from });
    }
    return out.sort((a, b) => a.supply - b.supply);
  }

  /** Prix d'un objet dans une implantation (achat ou vente). */
  price(def: ItemDef, sid: number, buy: boolean, charMult: number, npcFactor: number): number {
    let p = def.value;
    if (def.good) {
      const s = this.civ.settlements[sid];
      const local = s.produces.includes(def.good) ? 0.8 : s.needs.includes(def.good) ? 1.2 : 1;
      p *= local * Math.pow(1 / Math.max(0.3, this.supplyOf(sid, def.good)), 0.8);
    }
    p *= charMult * (buy ? npcFactor : 2 - npcFactor);
    return Math.max(1, Math.round(p));
  }

  /** Marchandise d'un PNJ pour la journée (déterministe), réduite en cas de pénurie. */
  stock(n: NPCData, day: number): { id: string; qty: number }[] {
    const rng = this.seed.stream('economy', n.id, day);
    const lists: Record<string, string[]> = {
      marchand: ['pain', 'fromage', 'pomme', 'sel', 'étoffe', 'outils', 'potion de soin', 'antidote', 'flèche', 'bottes', 'gants', 'bois', 'hache de bûcheron', 'pioche', 'crochet', 'canne à pêche'],
      forgeron: ['hache de bûcheron', 'pioche', 'épée courte', 'épée longue', 'hache', 'masse', 'lance', 'dague', 'casque de fer', 'cotte de mailles', 'bouclier en bois', 'bouclier de fer', 'lingot de fer', 'charbon', 'flèche'],
      mineur: ['pioche', 'minerai de fer', 'charbon', 'pierre', 'lingot de fer'],
      fermier: ['pain', 'pomme', 'fromage', 'viande crue'],
      pêcheur: ['poisson grillé', 'sel', 'canne à pêche', 'truite', 'hareng'],
      aubergiste: ['pain', 'fromage', 'ragoût', 'bière', 'hydromel', 'viande grillée', 'poisson grillé'],
      guérisseuse: ['potion de soin', 'grande potion de soin', 'antidote', 'potion d’endurance', 'potion de mana', 'herbe médicinale', 'parchemin : lumière'],
      chasseur: ['arc court', 'arc long', 'flèche', 'viande crue', 'tunique de cuir', 'casque de cuir', 'bottes', 'gants'],
      prêtre: ['potion de soin', 'antidote', 'potion de mana', 'parchemin : lumière', 'parchemin : bouclier de mana', 'parchemin : pas feutrés'],
      moine: ['potion de mana', 'parchemin : éclat de givre', 'parchemin : éclair', 'parchemin : lumière', 'parchemin : invisibilité'],
      meunier: ['pain', 'pain', 'bière'],
      voyageur: ['pomme', 'hydromel', 'gemme', 'flèche'],
    };
    const list = lists[n.profession];
    if (!list) return [];
    const out: { id: string; qty: number }[] = [];
    for (const id of list) {
      const d = item(id);
      if (d.name === id && !d.value && !d.weapon) continue;
      const sup = d.good ? this.supplyOf(n.sid, d.good) : 1;
      const base = d.cat === 'munition' ? 20 : d.cat === 'arme' || d.cat === 'armure' || d.cat === 'bouclier' ? 1 : 3;
      const qty = Math.max(0, Math.round(base * sup * rng.float(0.5, 1.5) - (sup < 0.7 ? 1 : 0)));
      if (qty > 0 && (d.cat === 'munition' || rng.chance(Math.min(1, 0.55 + sup * 0.35)))) out.push({ id, qty });
    }
    // outils de récolte : toujours disponibles chez le forgeron et le mineur
    if (n.profession === 'forgeron' || n.profession === 'mineur') for (const id of ['hache de bûcheron', 'pioche']) if (!out.some((o) => o.id === id) && (n.profession === 'forgeron' || id === 'pioche')) out.unshift({ id, qty: 1 });
    return out;
  }
}
