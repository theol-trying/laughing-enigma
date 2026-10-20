import type { Entity } from '@ascii-fort/sim/entities/Entity';
import type { NPCData } from '@ascii-fort/sim/entities/NPC';
import { stallSpot, MARKET_OPEN, MARKET_CLOSE, bardRests, bardTavern } from '@ascii-fort/sim/ai/Schedule';
import { STALLS, CRAFT_DEFS, TAVERN_MENU, TAVERN_ORDERS, SONGS, TOASTS, BARD_LINES, DICE_STAKES, DICE_PURSE, rollDice, diceOutcome, type Ware } from '@ascii-fort/sim/gameplay/Market';
import { direction, distance, type DialogueHooks, type DialogueNode, type DialogueOption } from '@ascii-fort/sim/gameplay/Dialogue';
import { item } from '@ascii-fort/sim/gameplay/Items';
import { insideRect, rectOf, doorOutside, type Rect } from '@ascii-fort/sim/gameplay/Estate';
import { craftOf } from '@ascii-fort/worldgen/civilization/Districts';
import type { Layout, Building, QuarterKind } from '@ascii-fort/worldgen/civilization/Layout';
import { de } from '@ascii-fort/worldgen/civilization/Names';
import { hashString } from '@ascii-fort/core/RNG';
import { trsYawPitch } from '@ascii-fort/core/math';
import { C } from '@ascii-fort/ascii-engine/TextGrid';
import { M } from '@ascii-fort/ascii-engine/Materials';
import type { InstanceBuffer } from '@ascii-fort/ascii-engine/Renderer';
import type { Game } from './Game';

// Quartiers des villes (étape 55), côté jeu : étalages des étals le jour et bâches la nuit, criées des marchands, soirées
// des tavernes (toasts, chansons, barde et musique), commandes au comptoir, rumeurs et tournée générale, partie de dés
// contre un client, marchandises des étals et des ateliers, lieu affiché (quartier, taverne, marché), console.
// Les habitants eux-mêmes sont des PNJ ordinaires de la zone « s<sid> » (sim/entities/NPC.ts : generateDistrictNPCs).

const hash01 = (s: string) => hashString(s) / 4294967296;
const QUARTER_NAME: Record<QuarterKind, string> = { artisan: 'le quartier des artisans', marchand: 'le quartier marchand', résidentiel: 'le quartier résidentiel', aisé: 'le quartier aisé' };
const QUARTER_LABEL: Record<QuarterKind, string> = { artisan: 'quartier des artisans', marchand: 'quartier marchand', résidentiel: 'quartier résidentiel', aisé: 'quartier aisé' };

/** Bulle au-dessus d'un PNJ (criée, toast, chanson) : emplacements réutilisés. */
export interface Bubble { e: Entity | null; text: string; t: number; color: number }
interface Inst { m: Float32Array; color: number; mat: number; shape: number }
/** Étalage (jour) et bâche (nuit) d'un étal, calculés une fois le terrain chargé. */
interface StallLook { day: Inst[]; night: Inst[] }

export class Quarters {
  readonly hooks: DialogueHooks;
  /** bulles visibles (lues par le HUD) */
  readonly bubbles: Bubble[] = Array.from({ length: 10 }, () => ({ e: null, text: '', t: 0, color: C.white }));
  /** le joueur est dans une taverne où joue le barde (musique d'ambiance) */
  bardPlaying = false;
  /** lieu précis affiché par le HUD (taverne, marché, quartier), ou null */
  place: string | null = null;
  private acc = 0;
  private here = -1;
  private tavernIn = -1;
  private looks = new Map<number, StallLook[]>();
  private rects = new Map<number, Rect>();
  /** pertes du jour de chaque client aux dés (« id:jour ») et nombre de parties (tirages) */
  private diceLost = new Map<string, number>();
  private diceN = 0;
  /** tournées générales déjà payées (« sid:jour ») : la réputation n'en profite qu'une fois par jour et par lieu */
  private rounds = new Set<string>();
  private m4 = new Float32Array(16);

  constructor(private g: Game) {
    this.hooks = { menu: (e) => this.menu(e), talk: (e, t) => this.talk(e, t) };
  }

  private layout(sid: number): Layout | undefined { return this.g.happenings.cal.layout(sid); }
  private say(text: string, color: number = C.text) { this.g.events.emit('message', { text, color }); }
  private rectFor(b: Building): Rect { let r = this.rects.get(b.sid * 4096 + b.id); if (!r) { r = rectOf(b); this.rects.set(b.sid * 4096 + b.id, r); } return r; }

  // ---------------------------------------------------------------- lieu du joueur
  /** Implantation à quartiers où se trouve le joueur (−1 : aucune). */
  private findHere(): number {
    const p = this.g.player;
    for (const s of this.g.world.civ.settlements) {
      if (s.abandoned || Math.abs(s.x - p.x) > s.radius + 30 || Math.abs(s.z - p.z) > s.radius + 30) continue;
      if (Math.hypot(s.x - p.x, s.z - p.z) < s.radius + 25 && this.layout(s.id)?.district) return s.id;
    }
    return -1;
  }
  /** Taverne (id de bâtiment) dans laquelle se trouve le point, −1 sinon. */
  private tavernAt(L: Layout, x: number, z: number): number {
    for (const id of L.district?.taverns ?? []) if (insideRect(this.rectFor(L.buildings[id]), x, z)) return id;
    return -1;
  }
  private evening(): boolean { const h = this.g.time.hour; return h >= 18 || h < 2; }
  private marketOpen(): boolean { const h = this.g.time.hour; return h >= MARKET_OPEN && h < MARKET_CLOSE && this.g.rain() <= 0.35; }

  // ---------------------------------------------------------------- vie du marché et des tavernes
  tick(dt: number): void {
    const g = this.g;
    for (const b of this.bubbles) if (b.t > 0) { b.t -= dt; if (b.t <= 0) b.e = null; }
    this.acc += dt;
    if (this.acc < 0.5) return;
    const step = this.acc;
    this.acc = 0;
    this.bardPlaying = false;
    this.here = g.dungeon ? -1 : this.findHere();
    const L = this.here >= 0 ? this.layout(this.here) : undefined, D = L?.district;
    if (!L || !D) { this.tavernIn = -1; this.place = null; return; }
    const p = g.player;
    this.tavernIn = this.tavernAt(L, p.x, p.z);
    this.place = this.tavernIn >= 0 ? L.buildings[this.tavernIn].name : this.placeLabel(L, p.x, p.z);
    const zone = g.entities.zones.get(this.here);
    if (!zone) return;
    const open = this.marketOpen(), eve = this.evening(), tick = Math.floor(g.elapsed * 2);
    let toasts = 0;
    for (const e of zone.ents) {
      const n = e.npc;
      if (!n || !e.alive || e.hostile) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d > 34) continue;
      // criées : le marchand à son étal, quand le joueur est sur la place (pas dans une maison)
      if (open && n.stall !== undefined && this.tavernIn < 0 && D.stalls[n.stall]) {
        const sp = stallSpot(D.stalls[n.stall], true);
        if (Math.hypot(sp.x - e.x, sp.z - e.z) < 1.6 && hash01(`${n.id}|criée|${tick}`) < step / 16) {
          const cries = STALLS[D.stalls[n.stall].kind].cries;
          this.bubble(e, cries[Math.floor(hash01(`${n.id}|${tick}`) * cries.length)], C.yellow, 4.5);
          g.audio.call({ x: e.x, y: e.y + 1.6, z: e.z }, n.sex === 'f');
        }
        continue;
      }
      // taverne : le joueur y est, les clients boivent et chantent le soir, le barde joue
      if (this.tavernIn < 0 || d > 16 || !insideRect(this.rectFor(L.buildings[this.tavernIn]), e.x, e.z)) continue;
      if (n.profession === 'barde') {
        const h = g.time.hour;
        if (h >= 19 || h < 1) {   // ses heures de jeu (avant, il dîne)
          this.bardPlaying = true;
          if (hash01(`${n.id}|barde|${tick}`) < step / 20) this.bubble(e, BARD_LINES[Math.floor(hash01(`${n.id}|air|${tick}`) * BARD_LINES.length)], C.magenta, 4);
        }
        continue;
      }
      if (n.profession === 'tavernier' || !eve) continue;
      if (hash01(`${n.id}|soir|${tick}`) < step / 11 && toasts < 2) {
        const song = hash01(`${n.id}|chante|${tick}`) < 0.4;
        const list = song ? SONGS : TOASTS;
        this.bubble(e, list[Math.floor(hash01(`${n.id}|vers|${tick}`) * list.length)], song ? C.cyan : C.white, song ? 5 : 3);
        if (!song) g.audio.clink({ x: e.x, y: e.y + 1.2, z: e.z });
        toasts++;
      }
    }
  }

  private placeLabel(L: Layout, x: number, z: number): string | null {
    const D = L.district!, P = L.plaza;
    if (P && D.stalls.length && Math.hypot(x - P.x, z - P.z) < P.r + 2) return 'place du marché';
    let best: QuarterKind | null = null, bd = Infinity;
    for (const q of D.quarters) { const d = Math.hypot(q.x - x, q.z - z); if (d < q.r + 4 && d < bd) { bd = d; best = q.kind; } }
    return best ? QUARTER_LABEL[best] : null;
  }

  private bubble(e: Entity, text: string, color: number, t: number): void {
    let slot = this.bubbles.find((b) => b.e === e) ?? this.bubbles.find((b) => b.t <= 0);
    if (!slot) slot = this.bubbles.reduce((a, b) => (b.t < a.t ? b : a));
    slot.e = e; slot.text = ` ${text} `; slot.color = color; slot.t = t;
  }

  // ---------------------------------------------------------------- étalages
  render(ib: InstanceBuffer, cx: number, cz: number): void {
    const g = this.g;
    if (g.dungeon) return;
    const open = this.marketOpen();
    for (const s of g.world.civ.settlements) {
      if (s.abandoned || Math.abs(s.x - cx) > s.radius + 120 || Math.abs(s.z - cz) > s.radius + 120) continue;
      const looks = this.looksOf(s.id);
      if (!looks) continue;
      for (const lk of looks) for (const it of open ? lk.day : lk.night) ib.add(it.m, it.color, it.mat, 0, 0, 1, it.shape);
    }
  }

  /** Étalage et bâche de chaque étal (une fois le terrain chargé : hauteur exacte du sol). */
  private looksOf(sid: number): StallLook[] | null {
    const got = this.looks.get(sid);
    if (got) return got;
    const L = this.layout(sid), S = L?.district?.stalls;
    if (!L || !S?.length) return null;
    const g = this.g;
    if (!g.world.chunks.chunkAt(S[0].x, S[0].z)) return null;
    const out: StallLook[] = [];
    for (const st of S) {
      const y = g.world.heightAt(st.x, st.z) + 0.9, c = Math.cos(st.yaw), s = Math.sin(st.yaw);
      const at = (lx: number, lz: number) => ({ x: st.x + lx * c + lz * s, z: st.z - lx * s + lz * c });
      const mk = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: number, mat: number, shape: number, yaw = st.yaw, pitch = 0): Inst => {
        const q = at(lx, lz);
        return { m: trsYawPitch(new Float32Array(16), q.x, y + ly, q.z, yaw, pitch, sx, sy, sz), color, mat, shape };
      };
      const wares: Ware[] = STALLS[st.kind].wares, day: Inst[] = [];
      // deux rangées sur le comptoir (les rouleaux d'étoffe et les bûches sont couchés), deux paniers au pied, côté clients
      for (let i = 0; i < 7; i++) {
        const w = wares[i % wares.length], lx = -0.85 + (i % 4) * 0.56 + (i >= 4 ? 0.28 : 0), lz = i >= 4 ? -0.18 : 0.18;
        const lying = w.shape === 1 && w.sy > 0.45;
        day.push(lying ? mk(lx, w.sx / 2, 0, w.sx, w.sy, w.sz, w.color, M.ITEM, 1, st.yaw, Math.PI / 2) : mk(lx, w.sy / 2, lz, w.sx, w.sy, w.sz, w.color, M.ITEM, w.shape));
      }
      for (const k of [-0.7, 0.7]) {
        day.push(mk(k, -0.68, 0.85, 0.5, 0.42, 0.5, 0x8a6a3a, M.WOOD, 1));
        const w = wares[(k > 0 ? 1 : 0) % wares.length];
        day.push(mk(k, -0.42, 0.85, 0.42, 0.14, 0.42, w.color, M.CLOTH, 2));
      }
      // la nuit : marchandises rentrées, bâche nouée sur le comptoir
      const night = [mk(0, 0.06, 0, 2.3, 0.12, 1.1, 0x9a8a6a, M.CLOTH, 0), mk(0, -0.22, 0.56, 2.3, 0.5, 0.04, 0x8a7a5a, M.CLOTH, 0), mk(0, -0.22, -0.56, 2.3, 0.5, 0.04, 0x8a7a5a, M.CLOTH, 0), mk(0.8, -0.6, -0.9, 0.6, 0.6, 0.6, 0x7a5a32, M.WOOD, 0)];
      out.push({ day, night });
    }
    this.looks.set(sid, out);
    return out;
  }

  // ---------------------------------------------------------------- marchandises
  /** Marchandises d'un étal, d'une taverne ou d'un atelier des quartiers ; null : celles du métier (Economy). */
  stockFor(e: Entity): { id: string; qty: number }[] | null {
    const n = e.npc, g = this.g;
    if (!n || n.quarter === undefined) return null;
    const L = this.layout(n.sid), D = L?.district, day = g.time.day;
    if (!L) return null;
    if (n.stall !== undefined && D?.stalls[n.stall]) return g.economy.listStock(n, day, STALLS[D.stalls[n.stall].kind].items);
    if (n.profession === 'tavernier') return g.economy.listStock(n, day, this.menuOf(n.sid));
    const c = n.work >= 0 ? craftOf(L.buildings[n.work]) : null;
    return c ? g.economy.listStock(n, day, CRAFT_DEFS[c].items) : null;
  }
  /** Carte de la taverne : les classiques, plus les spécialités de la région. */
  private menuOf(sid: number): string[] {
    const s = this.g.world.civ.settlements[sid], out = [...TAVERN_MENU];
    if (s.produces.includes('poisson')) out.push('soupe de poisson', 'poisson grillé');
    if (s.produces.includes('gibier')) out.push('viande grillée');
    return out;
  }

  // ---------------------------------------------------------------- dialogues
  private menu(e: Entity): DialogueOption[] {
    const n = e.npc;
    if (!n) return [];
    if (n.profession === 'tavernier' && n.quarter) {
      return [
        { label: 'Qu’as-tu à boire et à manger ?', go: () => this.orders(e) },
        { label: 'Quelles rumeurs courent en ce moment ?', go: () => this.rumorNode(e) },
        { label: `Payer une tournée générale (${this.roundPrice(e)} or)`, go: () => this.round(e) },
      ];
    }
    return this.patron(e) ? [{ label: 'Une partie de dés ?', go: () => this.diceIntro(e) }] : [];
  }
  /** Client attablé dans une taverne des quartiers (ni le tavernier ni le barde). */
  private patron(e: Entity): boolean {
    const n = e.npc;
    if (!n || n.profession === 'tavernier' || n.profession === 'barde' || n.profession === 'garde' || n.profession === 'soldat') return false;
    const L = this.layout(n.sid);
    return !!L?.district && this.tavernAt(L, e.x, e.z) >= 0;
  }
  private back(e: Entity): () => DialogueNode { return () => this.g.dialogue.again(e); }
  private priceOf(e: Entity, id: string): number { const g = this.g; return g.economy.price(item(id), e.npc!.sid, true, g.character.priceMult(true), g.rep.priceFactor(e.npc!)); }

  private orders(e: Entity): DialogueNode {
    const g = this.g, n = e.npc!, again = () => this.orders(e);
    const opts: DialogueOption[] = TAVERN_ORDERS.map((o) => {
      const price = this.priceOf(e, o.id);
      return {
        label: `${o.label} (${price} or)`,
        go: () => {
          if (g.character.inv.gold < price) return g.dialogue.node(e, ['Tu n’as pas de quoi payer. Reviens quand ta bourse sera plus ronde.'], again);
          g.character.inv.gold -= price;
          g.character.inv.add(o.id, 1);
          g.useItem(o.id);
          g.audio.clink();
          return g.dialogue.node(e, [o.id === 'ragoût' ? 'Un bol bien chaud, tout droit de la marmite. Régale-toi.' : n.sex === 'f' ? 'Et voilà, servi comme il faut. À ta santé, voyageur !' : 'Voilà pour toi. À ta santé, voyageur !'], again);
        },
      };
    });
    return { ...g.dialogue.head(e, g.rep.mood(n)), lines: ['La bière est fraîche, l’hydromel vient du pays et le ragoût mijote depuis ce matin.', 'Pour emporter, regarde plutôt mes marchandises.'], options: [...opts, { label: 'Autre chose…', go: this.back(e) }, { label: 'Au revoir.', go: () => null }] };
  }

  private rumorNode(e: Entity): DialogueNode {
    const g = this.g, n = e.npc!, civ = g.world.civ, day = g.time.day;
    const here = g.rumors.known(n.sid), lines: string[] = [];
    if (here.length) {
      const a = here[Math.floor(hash01(`${n.id}|rumeur|${day}`) * here.length)];
      lines.push(`Ici, on ne parle que de ça : ${a.text}`);
      const b = here.find((r) => r !== a);
      if (b && here.length > 2) lines.push(`Et on raconte aussi que… ${b.text}`);
    }
    // un voyageur arrivé d'une ville voisine par la route
    const roads = civ.roads.filter((r) => r.a === n.sid || r.b === n.sid);
    if (roads.length) {
      const r = roads[Math.floor(hash01(`${n.id}|route|${day}`) * roads.length)], other = civ.settlements[r.a === n.sid ? r.b : r.a];
      const far = g.rumors.known(other.id).filter((x) => !here.includes(x));
      if (far.length) lines.push(`Un voyageur arrivé ${de(other.name)} jurait que… ${far[Math.floor(hash01(`${other.id}|${day}`) * far.length)].text}`);
    }
    if (!lines.length) lines.push('Rien de bien neuf. Les clients parlent du temps qu’il fait et du prix du grain.');
    lines.push('Les langues se délient mieux autour d’une tournée, si tu vois ce que je veux dire.');
    return g.dialogue.node(e, lines, this.back(e));
  }

  /** Clients présents dans la taverne du tavernier (pour le prix de la tournée et les vivats). */
  private patronsOf(e: Entity): Entity[] {
    const n = e.npc!, L = this.layout(n.sid), z = this.g.entities.zones.get(n.sid);
    if (!L || !z || n.work < 0) return [];
    const r = this.rectFor(L.buildings[n.work]);
    return z.ents.filter((x) => x !== e && x.alive && x.npc && insideRect(r, x.x, x.z));
  }
  private roundPrice(e: Entity): number { return 6 + 3 * this.patronsOf(e).length; }

  private round(e: Entity): DialogueNode {
    const g = this.g, n = e.npc!, civ = g.world.civ, s = civ.settlements[n.sid], price = this.roundPrice(e), key = `${n.sid}:${g.time.day}`;
    if (g.character.inv.gold < price) return g.dialogue.node(e, ['Une tournée pour toute la salle ? Avec quoi, ta bonne mine ?'], this.back(e));
    g.character.inv.gold -= price;
    const first = !this.rounds.has(key);
    this.rounds.add(key);
    if (first) g.rep.addLocal(n.sid, 3);
    for (const x of this.patronsOf(e)) this.bubble(x, x.npc!.sex === 'f' ? 'À la santé du voyageur !' : 'À ta santé, l’ami !', C.white, 3.5);
    g.audio.cheer(); g.audio.clink();
    const lines = [`Une tournée générale ! ${this.patronsOf(e).length ? 'La salle t’acclame.' : 'Les tonneaux t’acclament, à défaut de clients.'}`];
    // pour la peine, le tavernier confie un lieu qu'il connaît et que le joueur ignore encore
    const pois = n.knowledge.filter((k) => k.startsWith('poi:')).map((k) => civ.pois[Number(k.slice(4))]).filter((p) => p && !g.state.discovered.has(`poi:${p.id}`));
    const poi = pois[Math.floor(hash01(`${n.id}|tournée|${g.time.day}`) * pois.length)];
    if (poi) {
      g.state.discovered.add(`poi:${poi.id}`);
      lines.push(`Un client te glisse à l’oreille : ${poi.name}, ${distance(Math.hypot(poi.x - s.x, poi.z - s.z))}, ${direction(s.x, s.z, poi.x, poi.z)}. ${poi.why.charAt(0).toUpperCase() + poi.why.slice(1)}.`, '(Ce lieu est maintenant marqué sur votre carte.)');
    } else lines.push('Les histoires fusent, mais tu les connais déjà toutes.');
    this.say(`Tournée générale à la ${g.world.civWorld.layouts.find((l) => l.sid === n.sid)?.buildings[n.work]?.name.replace(/^Taverne /, 'taverne ') ?? 'taverne'} (-${price} or)${first ? ' : on vous apprécie un peu plus ici.' : '.'}`, C.gold);
    return g.dialogue.node(e, lines, this.back(e));
  }

  // ---------------------------------------------------------------- jeu de dés
  private diceKey(n: NPCData): string { return `${n.id}:${this.g.time.day}`; }
  private diceIntro(e: Entity, note?: DialogueNode['note']): DialogueNode {
    const g = this.g, n = e.npc!, lost = this.diceLost.get(this.diceKey(n)) ?? 0, gold = g.character.inv.gold;
    const il = n.sex === 'f' ? 'Elle' : 'Il';
    if (lost >= DICE_PURSE) return g.dialogue.node(e, [n.sex === 'f' ? 'Tu m’as plumée pour ce soir. Reviens demain, que je prenne ma revanche !' : 'Tu m’as plumé pour ce soir. Reviens demain, que je prenne ma revanche !'], this.back(e));
    const opts: DialogueOption[] = DICE_STAKES.filter((k) => k <= gold && k <= DICE_PURSE - lost).map((k) => ({ label: `Miser ${k} or`, go: () => this.diceRoll(e, k) }));
    const lines = ['Deux dés chacun : le plus gros total gagne, et un double bat tout le reste. À égalité, chacun reprend sa mise.'];
    if (!opts.length) lines.push(gold < DICE_STAKES[0] ? `Sans quelques pièces, pas de partie. ${il} retourne à sa chope.` : `${il} n’a plus de quoi suivre une telle mise.`);
    return { ...g.dialogue.head(e, g.rep.mood(n)), lines, options: [...opts, { label: 'Pas ce soir.', go: this.back(e) }], ...(note ? { note } : {}) };
  }
  private diceRoll(e: Entity, stake: number): DialogueNode {
    const g = this.g, n = e.npc!, ch = g.character;
    if (ch.inv.gold < stake) return this.diceIntro(e);
    const rng = g.seed.stream('quartiers', 'dés', n.id, g.time.day, this.diceN++, Math.floor(g.time.minutes));
    const me = rollDice(rng), him = rollDice(rng), res = diceOutcome(me, him);
    const show = (d: [number, number]) => `${d[0]} et ${d[1]} (${d[0] === d[1] ? 'double' : d[0] + d[1]})`;
    const il = n.sex === 'f' ? 'elle' : 'il', key = this.diceKey(n);
    g.audio.dice();
    if (res === 'gagné') { ch.inv.gold += stake; this.diceLost.set(key, (this.diceLost.get(key) ?? 0) + stake); }
    else if (res === 'perdu') { ch.inv.gold -= stake; this.diceLost.set(key, (this.diceLost.get(key) ?? 0) - stake); }
    const verdict = res === 'gagné' ? `Tu gagnes ${stake} or.` : res === 'perdu' ? `Tu perds ${stake} or.` : 'Égalité : chacun reprend sa mise.';
    const quip = res === 'gagné' ? (n.sex === 'f' ? 'Peste ! La chance est avec toi ce soir.' : 'Peste ! Tu as la main heureuse, toi.') : res === 'perdu' ? 'Ha ! Les dés m’aiment bien, ce soir.' : 'On remet ça ?';
    return this.diceIntro(e, { text: `Tu lances ${show(me)} ; ${il} lance ${show(him)}. ${verdict} « ${quip} »`, color: res === 'gagné' ? C.green : res === 'perdu' ? C.red : C.dim });
  }

  // ---------------------------------------------------------------- conversation
  private talk(e: Entity, topic: 'about' | 'job'): string[] | undefined {
    const n = e.npc;
    if (!n || n.quarter === undefined) return undefined;
    const g = this.g, s = g.world.civ.settlements[n.sid], L = this.layout(n.sid), D = L?.district, title = n.title ?? n.profession;
    const years = Math.max(1, Math.min(n.age - 15, (n.age * 7) % 25 + 2)), goal = `Ce que je veux ? ${n.goal.charAt(0).toUpperCase() + n.goal.slice(1)}.`;
    const work = L && n.work >= 0 ? L.buildings[n.work] : undefined;
    if (topic === 'about') {
      if (n.profession === 'tavernier' && work) return [`Je tiens la ${work.name} depuis ${years} ans.`, goal];
      if (n.profession === 'barde') return ['Je vais de taverne en taverne avec mon luth et mes histoires.', D?.taverns.length ? `Le soir, je joue à la ${L!.buildings[bardTavern(n, D.taverns, g.time.day)].name}${bardRests(n, g.time.day) ? ', mais ce soir je repose ma voix' : ''}.` : 'Le soir, je joue où l’on veut bien de moi.', goal];
      if (n.stall !== undefined) return [`Je suis ${title} ici, à ${s.name}, depuis ${years} ans.`, 'Tu me trouves à mon étal sur la place, du matin jusqu’au soir.', goal];
      if (n.profession === 'bourgeois') return [`Ma famille tient son rang à ${s.name} depuis trois générations.`, `Nous habitons ${QUARTER_NAME[n.quarter]}.`, goal];
      return [`Je suis ${title}. J’habite ${QUARTER_NAME[n.quarter]} depuis ${years} ans.`, goal];
    }
    if (n.profession === 'tavernier') {
      const bard = g.entities.npcsOf(n.sid).find((x) => x.profession === 'barde' && x.alive);
      return ['La bière coule, les langues se délient : le soir, c’est plein à craquer.', bard ? `${bard.first}, le barde, vient jouer presque tous les soirs.` : 'Il me manque un bon barde. Les clients chantent faux, mais ils chantent.', 'Si tu veux savoir ce qui se dit en ville, paie une tournée : on t’en racontera.'];
    }
    if (n.profession === 'barde') return ['Une chanson par-ci, une pièce par-là : on ne fait pas fortune, mais on mange.', 'Je collectionne les histoires. Si tu en as une bonne, je la mettrai en vers.'];
    if (n.stall !== undefined && D?.stalls[n.stall]) {
      const def = STALLS[D.stalls[n.stall].kind];
      const short = g.economy.shortages(n.sid).find((x) => def.items.some((id) => item(id).good === x.good));
      return short
        ? [`Les arrivages se font rares : la route ${de(g.world.civ.settlements[short.from].name)} n’est plus sûre.`, 'Je vends ce qui me reste, et plus cher, forcément.']
        : ['Le marché ouvre à l’aube et ferme avant le soir. Les meilleures affaires se font tôt.', def.cries[0]];
    }
    const c = work ? craftOf(work) : null;
    if (c) return [CRAFT_DEFS[c].job, CRAFT_DEFS[c].items.length ? 'Passe à l’atelier si tu as besoin de quelque chose.' : 'Tout part chez les marchands de la place : je ne vends rien ici.'];
    if (work?.kind === 'échoppe') return undefined;   // boutiquier : les répliques habituelles d'un marchand (pénuries, routes)
    if (n.profession === 'bourgeois') return ['Les affaires ? Mon intendant s’en charge. Moi, je reçois.'];
    return D?.taverns.length ? ['On fait aller. Le marché le jour, la taverne le soir : c’est la vie de quartier.'] : ['On fait aller. Le travail ne manque pas, et le soir on se retrouve à l’auberge.'];
  }

  // ---------------------------------------------------------------- console
  dev(cmd: string, args: string[]): { text: string; err?: boolean }[] {
    const g = this.g, p = g.player, civ = g.world.civ, out: { text: string; err?: boolean }[] = [], say = (text: string, err = false) => out.push({ text, err });
    /** liste longue sur plusieurs lignes (la console coupe au-delà de sa largeur) */
    const sayList = (head: string, items: string[]) => {
      let line = head;
      for (const it of items) { if (line.length + it.length > 84) { say(line.replace(/, $/, ',')); line = '    '; } line += it + ', '; }
      say(line.replace(/, $/, ''));
    };
    const named = args.join(' ').toLowerCase();
    const pick = (ok: (L: Layout) => boolean) => {
      let best: Layout | null = null, bd = Infinity;
      for (const L of g.world.civWorld.layouts) {
        if (L.sid < 0 || !ok(L)) continue;
        const s = civ.settlements[L.sid];
        if (named && !s.name.toLowerCase().includes(named)) continue;
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < bd) { bd = d; best = L; }
      }
      return best;
    };
    const tp = (x: number, z: number, heading: number) => {
      if (g.dungeon) g.exitDungeon();
      p.x = x; p.z = z; p.heading = heading; p.vx = p.vz = p.vy = 0;
      g.world.chunks.update(x, z, -1); p.y = g.world.heightAt(x, z) + 0.3;
    };
    switch (cmd) {
      case 'quartiers': {
        const L = pick((l) => !!l.district);
        if (!L) { say('aucun lieu à quartiers', true); break; }
        const s = civ.settlements[L.sid], D = L.district!, nb = L.base?.buildings ?? L.buildings.length, added = L.buildings.slice(nb);
        const count = (k: string) => added.filter((b) => b.kind === k).length;
        const all = g.entities.npcsOf(s.id), base = g.entities.baseNpcsOf(s.id), extra = all.slice(base.length);
        say(`${s.name} (${s.type}) : ${nb} bâtiments d’origine + ${added.length} ajoutés`);
        say(`  ${count('taverne')} taverne(s), ${count('échoppe')} échoppe(s), ${count('atelier')} atelier(s), ${count('maison')} maison(s)`);
        say(`marché : ${D.stalls.length} étal(s) dont ${D.stalls.filter((x) => !x.existing).length} nouveau(x) · ${D.squares.length} placette(s), ${D.paths.length} ruelle(s)`);
        sayList(`PNJ : ${base.length} d’origine + ${extra.length} nouveaux (${base.length ? Math.round((extra.length / base.length) * 100) : 0} %) : `, extra.map((n) => n.title ?? n.profession));
        for (const q of D.quarters) say(`  ${QUARTER_LABEL[q.kind]} : ${direction(s.x, s.z, q.x, q.z)}, à ${Math.round(Math.hypot(q.x - s.x, q.z - s.z))} m du centre (rayon ${Math.round(q.r)} m)`);
        break;
      }
      case 'taverne': {
        const L = pick((l) => !!l.district?.taverns.length);
        if (!L) { say('aucune taverne', true); break; }
        const T = L.district!.taverns.map((id) => L.buildings[id]).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        const b = T[0], d = doorOutside(b, 2.2);
        tp(d.x, d.z, d.heading);
        say(`→ ${b.name} (${civ.settlements[L.sid].name}), ${L.district!.taverns.length} taverne(s) ici`);
        say('  « time 20 » pour la soirée (clients, chansons, barde)');
        break;
      }
      case 'marché': case 'marche': {
        const L = pick((l) => !!l.district?.stalls.length);
        if (!L) { say('aucun marché', true); break; }
        const st = L.district!.stalls[0], c = stallSpot(st, false);
        tp(c.x + Math.sin(st.yaw) * 2, c.z + Math.cos(st.yaw) * 2, c.face);
        say(`→ marché ${de(civ.settlements[L.sid].name)} : ${L.district!.stalls.length} étals, ouverts de ${MARKET_OPEN} h à ${Math.floor(MARKET_CLOSE)} h 30`);
        sayList('  ', L.district!.stalls.map((x) => STALLS[x.kind].m));
        break;
      }
    }
    return out;
  }
}
