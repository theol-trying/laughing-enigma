import type { Input } from '@ascii-fort/ascii-engine/Input';
import type { Entity } from '@ascii-fort/sim/entities/Entity';
import type { NPCData } from '@ascii-fort/sim/entities/NPC';
import type { Prop } from '@ascii-fort/worldgen/Chunk';
import type { Building } from '@ascii-fort/worldgen/civilization/Layout';
import { MIN_PER_DAY } from '@ascii-fort/core/Time';
import { hitEntity } from '@ascii-fort/sim/gameplay/Combat';
import { direction, type DialogueNode, type DialogueOption, type ServiceOffer } from '@ascii-fort/sim/gameplay/Dialogue';
import { Estate, LAYOUT_REACH, housePrice, footprints, insideRect, rectOf, doorOutside, sanitizeEstate, type EstateSave, type HouseRef, type Rect } from '@ascii-fort/sim/gameplay/Estate';
import {
  COATS, HORSE_GRADES, MERC, MOUNT, CONTRACT_MIN, horseOffer, mercOffer, mercLevel, mercPrice, mercStats, archName, canRenew, renewContract, tickContract, contractLabel, worldOf,
  type HorseOffer, type MercOffer, type AllyState,
} from '@ascii-fort/sim/gameplay/Companions';
import { ChestScreen } from '../ui/ChestScreen';
import type { Game, Focus } from './Game';

const GREEN = 0x60d070, RED = 0xe05040, YELLOW = 0xf0d060, ORANGE = 0xf09040, GOLD = 0xe8c050, CYAN = 0x60d0e0;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** « d’Aldric », « de Brann » : élision devant une voyelle ou un h muet (prénoms de personnes). */
const deNom = (n: string) => (/^[AEIOUYÉÈÊÂÎÔŒH]/i.test(n) ? `d’${n}` : `de ${n}`);
/** Idem pour un nom de lieu : pas de h muet (« Haut-… » est aspiré). */
const deLieu = (n: string) => (/^[AEIOUYÉÈÊÂÎÔŒ]/i.test(n) ? `d’${n}` : `de ${n}`);

export interface HorseView { name: string; coat: string; grade: string; hp: number; maxHp: number; stamina: number; maxStamina: number; mounted: boolean; winded: boolean; limp: boolean; dist: number }
export interface MercView { name: string; level: number; hp: number; maxHp: number; mode: string; ko: number; left: number }

/**
 * Biens du joueur : maison (lit, coffre, porte), cheval (acheter, monter, siffler) et mercenaire (engager, ordres, contrat).
 * Orchestration côté jeu : touches G / Y / N, achats chez l'aubergiste et le fermier, descente automatique, sauvegarde.
 * La logique pure est dans sim/gameplay/Companions.ts et Estate.ts, l'IA dans sim/ai/AllyAI.ts, les entités dans EntityManager.
 */
export class Possessions {
  readonly estate = new Estate();
  /** le joueur est chez lui (dans l'emprise de sa maison) */
  atHome = false;
  private wasRiding = false; private horseAlive = false;
  private blockMsgT = -10; private hurtMsgT = -10; private limpShown = false;
  private foot: { t: number; list: Rect[] } = { t: -10, list: [] };
  private homeB: { key: string; b: Building | null } = { key: '', b: null };

  constructor(private g: Game) {
    // le cheval attaqué : cri et message (limités) ; les coups partagés avec le cavalier (« rider ») ne comptent pas
    g.events.on('entity:damaged', (d) => {
      const h = this.horse;
      if (d.targetId !== 'ally:horse' || !h || !d.sourceId || d.sourceId === 'rider' || this.g.elapsed - this.hurtMsgT < 6) return;
      this.hurtMsgT = this.g.elapsed;
      this.say(`${h.name} est attaqué !`, RED);
      this.g.audio.creature('cheval', 'attaque', { x: h.x, y: h.y + 1.2, z: h.z });
    });
  }

  get horse(): Entity | null { return this.g.entities.horse; }
  get merc(): Entity | null { return this.g.entities.merc; }
  get riding(): boolean { const h = this.horse; return !!h && h.alive && !!h.ally?.mounted; }
  private say(text: string, color = 0xc8c8bc) { this.g.events.emit('message', { text, color }); }
  /** conseil affiché une seule fois (drapeau local : jamais publié au salon) */
  private tip(key: string, text: string) { const f = this.g.state.flags; if (!f.get('astuce:' + key)) { f.set('astuce:' + key, true); this.say(text, 0xe8e0c0); } }

  // ---------------------------------------------------------------- maison et coffre
  isMine(pr: Prop): boolean { const h = this.estate.house; return !!h && pr.sid === h.sid && pr.bid === h.bid; }

  /** Maison du joueur : bâtiment, lieu et position (null : aucune). */
  home(): { sid: number; bid: number; x: number; z: number; place: string; building: Building } | null {
    const h = this.estate.house;
    if (!h) return null;
    const key = `${h.sid}:${h.bid}`;
    if (this.homeB.key !== key) this.homeB = { key, b: this.g.world.civWorld.layouts.find((l) => l.sid === h.sid)?.buildings[h.bid] ?? null };
    const b = this.homeB.b;
    return b ? { ...h, x: b.x, z: b.z, place: this.g.world.civ.settlements[h.sid]?.name ?? '', building: b } : null;
  }

  setHouse(ref: HouseRef | null): void { this.estate.house = ref; this.homeB = { key: '', b: null }; this.g.entities.setOwnedHouse(ref); }

  /** Maison à vendre d'une implantation (null : aucune) : prix et situation par rapport à la place. */
  sale(sid: number): { bid: number; price: number; x: number; z: number; where: string; place: string; building: Building } | null {
    const g = this.g, bid = g.entities.saleHouse(sid), L = g.world.civWorld.layouts.find((l) => l.sid === sid), s = g.world.civ.settlements[sid];
    if (bid === null || !L || !s) return null;
    const b = L.buildings[bid], px = L.plaza?.x ?? s.x, pz = L.plaza?.z ?? s.z, d = Math.hypot(b.x - px, b.z - pz);
    return { bid, price: housePrice(s.type, b.w, b.d), x: b.x, z: b.z, building: b, place: s.name, where: d < 10 ? 'tout près de la place' : `${direction(px, pz, b.x, b.z)} de la place, à ${Math.round(d / 5) * 5} m` };
  }

  openChest(pr: Prop): void {
    const g = this.g, p = g.player, home = this.home();
    let lastHit = p.hitT;
    g.audio.chest(true);
    g.ui?.openScreen?.(new ChestScreen({
      character: g.character, events: g.events, chest: this.estate.chest, title: `Votre coffre — ${home?.place ?? 'maison'}`,
      closeReason: () => {
        const hit = p.hitT > lastHit + 1e-3; lastHit = p.hitT;
        if (p.dead) return '';
        if (hit) return 'Vous êtes attaqué : vous refermez le coffre !';
        if (Math.hypot(pr.x - p.x, pr.z - p.z) > 4.5) return 'Le coffre est trop loin.';
        return null;
      },
      onClose: () => { g.audio.chest(false); g.coop?.saveNow(); },
    }));
  }

  // ---------------------------------------------------------------- vendeurs (aubergiste, fermier)
  private week(): number { return Math.floor(this.g.time.day / 7); }
  private horseFor(n: NPCData): HorseOffer | null {
    const g = this.g, s = g.world.civ.settlements[n.sid];
    if (!s || g.state.flags.get(`cheval:${n.id}:${this.week()}`)) return null;
    return horseOffer(g.seed, n.sid, s.type, this.week(), n.id, n.profession === 'fermier', g.character.priceMult(true), g.rep.priceFactor(n));
  }
  private mercFor(n: NPCData): MercOffer {
    const g = this.g;
    return mercOffer(g.seed, n.sid, g.world.civ.settlements[n.sid].name, this.week(), n.id, g.character.level);
  }

  /** Ce que ce PNJ propose : cheval (aubergiste, ou fermier d'un lieu sans auberge), mercenaire et maison (aubergiste). */
  offers(n: NPCData): ServiceOffer[] {
    const g = this.g, s = g.world.civ.settlements[n.sid], L = g.world.civWorld.layouts.find((l) => l.sid === n.sid);
    if (!s || !L || (n.profession !== 'aubergiste' && n.profession !== 'fermier')) return [];
    if (n.profession === 'fermier' && L.buildings.some((b) => b.kind === 'auberge')) return [];
    const out: ServiceOffer[] = [], h = this.horse;
    const ho = h?.alive ? null : this.horseFor(n);
    if (h?.alive) out.push({ id: 'cheval', label: '', info: `Tu as déjà ${h.name}, ${h.ally!.grade} ${COATS[h.ally!.look]?.name ?? ''}.`, price: 0, locked: true });
    else if (!ho) out.push({ id: 'cheval', label: '', info: 'L’écurie est vide cette semaine : le dernier cheval est parti.', price: 0, locked: true });
    else out.push({ id: 'cheval', label: `Acheter ${ho.name}, ${ho.grade} ${COATS[ho.coat].name}`, info: `À l’écurie : ${ho.name}, ${ho.grade} ${COATS[ho.coat].name}.`, price: ho.price });
    if (n.profession === 'fermier') return out;
    const m = this.merc?.ally;
    if (m) {
      const ok = canRenew(m.left);
      out.push({ id: 'renouveler', label: `Prolonger le contrat ${deNom(m.first)} (+7 jours)`, price: mercPrice(g.character.level), locked: !ok,
        info: `${m.first} ${m.last} est à ton service : il reste ${contractLabel(m.left)}.${ok ? '' : ' Reviens quand il en restera moins de sept jours.'}` });
    } else {
      const o = this.mercFor(n);
      out.push({ id: 'mercenaire', label: `Engager ${o.first} ${o.last}`, price: o.price, info: `Au fond de la salle : ${o.first} ${o.last}, ${archName(o.arch, o.sex)}, niveau ${o.level}, ${o.blurb}. Contrat de 7 jours.` });
    }
    const home = this.home();
    if (home) out.push({ id: 'maison', label: '', info: `Tu es propriétaire d’une maison à ${home.place}.`, price: 0, locked: true });
    else { const sale = this.sale(n.sid); if (sale) out.push({ id: 'maison', label: 'Acheter la maison', info: `Une maison est à vendre ${sale.where}.`, price: sale.price }); }
    return out;
  }

  /** Conclut un achat : or déduit, bien livré, message et son ; renvoie la réplique du PNJ (un refus est une réplique). */
  buy(n: NPCData, id: ServiceOffer['id']): string {
    const g = this.g, ch = g.character, o = this.offers(n).find((x) => x.id === id);
    if (!o || o.locked) return 'Désolé, il n’y a plus rien à vendre de ce côté.';
    if (id === 'maison' && (g.rep.bounty.get(n.sid) ?? 0) > 0) return 'On ne vend rien aux hors-la-loi. Paie d’abord ton amende.';
    if (ch.inv.gold < o.price) { this.say(`Il vous manque ${o.price - ch.inv.gold} or.`, RED); return 'Reviens quand tu auras de quoi payer.'; }
    ch.inv.gold -= o.price; n.wealth += o.price;
    g.events.emit('trade', { npcId: n.id, itemId: id === 'renouveler' ? 'mercenaire' : id, qty: 1, price: o.price, sold: false });
    ch.practice('commerce', 2);
    g.audio.coin();
    const reply = id === 'cheval' ? this.giveHorse(n) : id === 'maison' ? this.giveHouse(n) : id === 'mercenaire' ? this.hire(n) : this.renew();
    g.coop?.saveNow();
    return reply;
  }

  private giveHorse(n: NPCData): string {
    const g = this.g, p = g.player, o = this.horseFor(n)!, gr = HORSE_GRADES[o.grade];
    const inn = g.world.civWorld.layouts.find((l) => l.sid === n.sid)?.buildings[n.work];
    const at = n.profession === 'aubergiste' && inn ? doorOutside(inn, 3.5) : { x: p.x + Math.sin(p.heading) * 3, z: p.z - Math.cos(p.heading) * 3, heading: p.heading + Math.PI };
    g.state.flags.set(`cheval:${n.id}:${this.week()}`, true);
    g.entities.spawnHorse({ grade: o.grade, coat: o.coat, name: o.name, hp: gr.hp, x: at.x, z: at.z, heading: at.heading, stamina: gr.stamina });
    this.say(`Vous achetez ${o.name}, ${o.grade} ${COATS[o.coat].name} (${o.price} or). ${n.profession === 'aubergiste' ? 'Un palefrenier l’amène devant l’auberge.' : 'Le fermier vous met la bride en main.'}`, GOLD);
    this.tip('cheval', 'G : monter ou descendre · Y : siffler (portée 120 m) · Maj : galop (endurance du cheval).');
    return `Marché conclu. ${o.name} t’attend ${n.profession === 'aubergiste' ? 'devant l’auberge' : 'ici'}. Prends-en soin.`;
  }

  private hire(n: NPCData): string {
    const g = this.g, p = g.player, o = this.mercFor(n), st = mercStats(o.level, o.arch);
    g.entities.spawnMerc({ first: o.first, last: o.last, sex: o.sex, arch: o.arch, look: o.look, hp: st.hp, left: CONTRACT_MIN, mode: 'suivre', x: p.x + Math.sin(p.heading) * 2, z: p.z - Math.cos(p.heading) * 2 }, g.character.level);
    this.say(`${o.first} ${o.last} vous suit (contrat de 7 jours, ${o.price} or).`, GOLD);
    this.tip('merc', 'N : suivre ou attendre · E sur lui : ordres, contrat, potion s’il est à terre.');
    return `${o.first} est à toi pour sept jours. Ne ${o.sex === 'f' ? 'la' : 'le'} laisse pas crever pour rien.`;
  }

  private renew(): string {
    const m = this.merc, a = m?.ally;
    if (!m || !a) return 'Il est parti, ton mercenaire.';
    a.left = renewContract(a.left);
    this.say(`Contrat ${deNom(m.name)} prolongé : il reste ${contractLabel(a.left)}.`, GOLD);
    return 'Marché reconduit.';
  }

  private giveHouse(n: NPCData): string {
    const g = this.g, sale = this.sale(n.sid)!;
    this.setHouse({ sid: n.sid, bid: sale.bid });
    this.say(`Acte signé : la maison ${deLieu(sale.place)} est à vous (${sale.price} or). Le lit et le coffre aussi.`, GOLD);
    g.banner = { text: 'VOTRE MAISON', sub: `${sale.place} · le lit, le coffre et la porte sont à vous`, t: 5, color: GOLD };
    g.audio.chime();
    this.tip('maison', 'E sur le coffre ou le lit de votre maison · M : sa position (♥) · on y renaît si l’on meurt.');
    return 'Voilà les clés. La maison est à toi : le lit, le coffre, la porte. Elle est vide, je m’en suis occupé.';
  }

  // ---------------------------------------------------------------- monture
  private buildingAt(x: number, z: number): Building | null {
    for (const L of this.g.world.civWorld.layouts) {
      if (Math.hypot(L.x - x, L.z - z) > L.radius + LAYOUT_REACH) continue;
      for (const b of L.buildings) {
        if (b.ruined || Math.hypot(b.x - x, b.z - z) > Math.hypot(b.w, b.d) / 2 + 1) continue;   // pré-test sans allocation (appelé à chaque image monté)
        if (insideRect(rectOf(b, 0.35), x, z)) return b;
      }
    }
    return null;
  }
  private footprintsNow(): Rect[] {
    const g = this.g;
    if (g.elapsed - this.foot.t > 0.5) this.foot = { t: g.elapsed, list: footprints(g.world.civWorld.layouts, g.player.x, g.player.z) };
    return this.foot.list;
  }

  toggleMount(): void {
    const g = this.g, p = g.player, h = this.horse;
    if (this.riding) { this.dismount(); return; }
    if (!h || !h.alive) { this.say('Vous n’avez pas de cheval.'); return; }
    if (g.dungeon) { this.say('Pas de cheval là-dedans.'); return; }
    const a = h.ally!;
    if (a.dormant || Math.hypot(h.x - p.x, h.z - p.z) > MOUNT.mountRange) { this.say(`${h.name} est trop loin (Y : siffler).`, YELLOW); return; }
    if (p.swimming || p.depth > 0.6) { this.say('Pas dans l’eau.', YELLOW); return; }
    if (this.buildingAt(p.x, p.z)) { this.say('On ne monte pas à cheval dans une maison.', YELLOW); return; }
    a.mounted = true; a.mode = 'attendre'; a.post = null; p.mounted = true; p.crouch = false;
    h.x = p.x; h.y = p.y; h.z = p.z;
    g.audio.mount(); g.particles.emit('poussière', p.x, p.y + 0.1, p.z, 6);
    this.say(`Vous montez ${h.name}.`, GREEN);
  }

  /** Met pied à terre à 1,3 m du cheval (à droite, à gauche, derrière), jamais dans un bâtiment ni dans l'eau profonde. */
  dismount(msg = 'Vous mettez pied à terre.', color = 0xc8c8bc): void {
    const g = this.g, p = g.player, h = this.horse;
    if (!h?.ally?.mounted) return;
    const a = h.ally, ch = Math.cos(h.heading), sh = Math.sin(h.heading);
    a.mounted = false; a.mode = 'attendre'; a.post = null; p.mounted = false;
    for (const [dx, dz] of [[ch, sh], [-ch, -sh], [-sh, ch]]) {
      const x = h.x + dx * 1.3, z = h.z + dz * 1.3, w = g.world.waterAt(x, z);
      if ((!Number.isNaN(w) && w - g.world.heightAt(x, z) > 0.9) || this.buildingAt(x, z)) continue;
      p.x = x; p.z = z; p.y = g.entities.ground(x, z, p.y + 0.7);
      break;
    }
    p.vx = p.vz = 0;
    g.audio.mount(); g.particles.emit('poussière', p.x, p.y + 0.1, p.z, 4);
    if (msg) this.say(msg, color);
  }

  /** Ordre de rendez-vous : le cheval accourt (jusqu'à 120 m), vers la porte si le joueur est dans un bâtiment. */
  whistle(): void {
    const g = this.g, p = g.player, h = this.horse;
    if (!h || !h.alive) { this.say('Vous n’avez pas de cheval.'); return; }
    if (g.dungeon) { this.say('Le sifflet se perd sous la terre.'); return; }
    const a = h.ally!;
    if (a.mounted) return;
    g.audio.whistle();
    const d = Math.hypot(h.x - p.x, h.z - p.z);
    if (a.dormant || d > MOUNT.whistleRange) { this.say(`Votre sifflet reste sans réponse : ${h.name} est à ${Math.round(d / 10) * 10} m ${direction(p.x, p.z, h.x, h.z)}.`, YELLOW); return; }
    const inside = this.buildingAt(p.x, p.z);
    a.mode = 'siffle'; a.stuck = 0; a.post = inside ? doorOutside(inside, 3) : null;
    g.audio.whinny('appel', { x: h.x, y: h.y + 1.2, z: h.z });
    this.say(`Vous sifflez : ${h.name} accourt.`, GREEN);
  }

  /** Les coups reçus par le cavalier (non parés) blessent aussi le cheval, pour 30 %. */
  shareHit(raw: number, blocked: boolean): void {
    const h = this.horse;
    if (blocked || !h || !this.riding) return;
    hitEntity(this.g.combat, h, Math.max(1, Math.round(raw * MOUNT.hurtShare)), 'rider');
  }

  // ---------------------------------------------------------------- mercenaire
  mercOrder(): void {
    const m = this.merc;
    if (!m?.ally) { this.say('Vous n’avez engagé personne.'); return; }
    if (m.ally.ko > 0) { this.say(`${m.name} est à terre.`, ORANGE); return; }
    this.order(m, m.ally.mode === 'suivre' ? 'attendre' : 'suivre');
  }
  private order(m: Entity, mode: 'suivre' | 'attendre'): void {
    const a = m.ally!;
    a.mode = mode; a.post = mode === 'attendre' ? { x: m.x, z: m.z } : null; a.trail.length = 0; a.following = false; m.foe = null;
    this.say(`${a.first} : « ${mode === 'suivre' ? 'Je vous suis.' : 'Je tiens la position.'} »`, 0xa8d0f0);
  }

  /** Dialogue d'ordres avec le mercenaire (construit à la main : ce n'est pas un PNJ du village). */
  mercDialogue(e: Entity): DialogueNode {
    const g = this.g, a = e.ally!, ch = g.character, again = () => this.mercDialogue(e);
    const base = { speaker: e.name, sub: `mercenaire · niv. ${a.level} · PV ${Math.ceil(e.hp)}/${e.maxHp}`, mood: 'amical' };
    const bye: DialogueOption = { label: 'Au revoir.', go: () => null };
    const say = (lines: string[]): DialogueNode => ({ ...base, lines, options: [{ label: 'Autre chose…', go: again }, bye] });
    if (a.ko > 0) {
      const options: DialogueOption[] = ch.inv.count('potion de soin') ? [{ label: 'Lui faire boire une potion de soin.', go: () => {
        ch.inv.remove('potion de soin'); a.ko = 0; e.hp = Math.ceil(e.maxHp * MERC.potionFrac);
        this.say(`${e.name} reprend connaissance.`, GREEN); return null;
      } }, bye] : [bye];
      return { ...base, sub: `${base.sub} · à terre`, lines: ['…'], options };
    }
    const wait = a.mode === 'attendre', price = mercPrice(ch.level);
    const options: DialogueOption[] = [{ label: wait ? 'Suis-moi.' : 'Attends ici.', go: () => { this.order(e, wait ? 'suivre' : 'attendre'); return null; } }];
    if (canRenew(a.left)) options.push({ label: `Prolonger ton contrat (+7 jours, ${price} or).`, go: () => {
      if (ch.inv.gold < price) { this.say(`Il vous manque ${price - ch.inv.gold} or.`, RED); return say(['Pas de quoi me payer ? Revenez quand vous aurez la bourse pleine, patron.']); }
      ch.inv.gold -= price; g.audio.coin(); g.events.emit('trade', { npcId: 'mercenaire', itemId: 'mercenaire', qty: 1, price, sold: false });
      return say([this.renew()]);
    } });
    options.push({ label: 'Je te libère de ton contrat.', go: () => ({
      ...base, lines: ['Vous me renvoyez ? Sans un sou de remboursement ?'],
      options: [{ label: 'Oui, c’est fini.', go: () => { this.say(`Vous congédiez ${e.name}.`, ORANGE); g.entities.removeAlly('merc'); return null; } }, { label: 'Non, reste.', go: again }],
    }) }, bye);
    return { ...base, lines: [wait ? 'Je garde la position, patron.' : 'Je vous suis, patron.', `Mon contrat court encore ${contractLabel(a.left)}. Je me bats ${a.arch === 'lame' ? 'à l’épée' : a.arch === 'lancier' ? 'à la lance' : 'à la hache'}.`], options };
  }

  // ---------------------------------------------------------------- cycle de la boucle de jeu
  /** Temps de jeu écoulé (minutes) : le contrat du mercenaire s'use, y compris pendant un sommeil. */
  elapse(minutes: number): void {
    const m = this.merc, a = m?.ally;
    if (!m || !a || minutes <= 0) return;
    const before = a.left;
    a.left = tickContract(a.left, minutes);
    if (before > MIN_PER_DAY && a.left <= MIN_PER_DAY && a.left > 0) this.say(`Le contrat ${deNom(m.name)} se termine demain.`, ORANGE);
    if (a.left <= 0) { this.say(`${m.name} rompt son contrat et reprend la route.`, ORANGE); this.g.entities.removeAlly('merc'); }
  }

  /** Chaque image, même mort : contrat, niveau du mercenaire, hauteur de l'œil (lissée). */
  tick(dt: number): void {
    const g = this.g, p = g.player;
    this.elapse(dt * g.time.scale);
    g.entities.syncMerc(g.character.level);
    // le cheval vient de mourir (coup d'un monstre ou chute sous le cavalier) : hennissement de mort, une seule fois
    const h = this.horse, alive = !!h?.alive;
    if (this.horseAlive && h && !alive) g.audio.whinny('mort', { x: h.x, y: h.y + 1.2, z: h.z });
    this.horseAlive = alive;
    const target = this.riding ? MOUNT.lift : 0;
    p.mountLift = Math.abs(p.mountLift - target) < 0.002 ? target : p.mountLift + (target - p.mountLift) * Math.min(1, dt * 6);
  }

  /** Avant Player.update : touches G / Y / N, état de monte, allures du cheval, bâtiments interdits. */
  beforeMove(input: Input): void {
    const p = this.g.player;
    if (input.key('g')) this.toggleMount();
    if (input.key('y')) this.whistle();
    if (input.key('n')) this.mercOrder();
    const h = this.horse, riding = this.riding;
    if (this.wasRiding && !riding && h && !h.alive) {
      p.hp = Math.max(1, p.hp - MOUNT.fallDamage); p.hurt = Math.max(p.hurt, 0.4);
      this.say(`${h.name} s’effondre sous vous : vous roulez à terre !`, RED);
    }
    this.wasRiding = riding;
    p.mounted = riding;
    if (riding && h) {
      const a = h.ally!, gr = HORSE_GRADES[a.grade], limp = h.hp < h.maxHp * MOUNT.limpHp ? MOUNT.limpMul : 1;
      p.mountTrot = gr.trot * limp; p.mountGallop = gr.gallop * limp; p.mountRadius = MOUNT.radius; p.mountTired = a.winded;
      p.keepOut = this.footprintsNow();
    } else { p.keepOut = null; p.mountTired = false; }
  }

  /** Après Player.update : descente automatique (eau, bâtiment, blessure), refus d'avancer, entrée chez soi. */
  afterMove(): void {
    const g = this.g, p = g.player, h = this.horse;
    if (p.mounted && h?.alive) {
      const a = h.ally!;
      if (p.swimming) this.dismount('Vous perdez pied dans l’eau : vous mettez pied à terre.', YELLOW);
      else if (this.buildingAt(p.x, p.z)) this.dismount('Le cheval ne va pas plus loin : vous mettez pied à terre.', YELLOW);
      else if (h.hp <= h.maxHp * MOUNT.throwHp) {
        this.say(`${h.name} se cabre, blessé, et vous désarçonne !`, RED);
        this.dismount('', RED);
        a.mode = 'fuite'; a.fleeT = MOUNT.fleeSeconds; a.fleeDx = -Math.sin(h.heading); a.fleeDz = Math.cos(h.heading);
        g.audio.whinny('cri', { x: h.x, y: h.y + 1.2, z: h.z });
      } else {
        if (p.moving && g.elapsed - this.blockMsgT > 3) {
          if (p.blockedBuilding) { this.blockMsgT = g.elapsed; this.say('Le cheval ne passe pas la porte : descendez (G).', YELLOW); }
          else if (p.blockedWater) { this.blockMsgT = g.elapsed; this.say(`${h.name} refuse l’eau profonde.`, YELLOW); }
        }
        const limp = h.hp < h.maxHp * MOUNT.limpHp;
        if (limp && !this.limpShown) this.say(`${h.name} boite : ménagez-le.`, ORANGE);
        this.limpShown = limp;
      }
    } else this.limpShown = false;
    const home = this.home(), was = this.atHome;
    this.atHome = !!home && !p.mounted && !g.dungeon && insideRect(rectOf(home.building, 0), p.x, p.z);
    if (this.atHome && !was) this.say('Vous rentrez chez vous.', GREEN);
  }

  /** Mort du joueur : plus de monture (le cheval reste où il est) ; renvoie le point de réveil si l'on a une maison. */
  onDeath(): { x: number; z: number; heading: number } | null {
    const h = this.horse;
    if (h?.ally) h.ally.mounted = false;
    this.g.player.mounted = false; this.wasRiding = false;
    const home = this.home();
    return home ? doorOutside(home.building, 3.5) : null;
  }

  // ---------------------------------------------------------------- interface : visée, carte, journal, HUD
  focusOf(e: Entity): Focus {
    const a = e.ally!;
    if (a.kind === 'horse') return { t: 'entity', e, label: `Monter : ${e.name}`, hint: 'G : monter · Y : siffler' };
    return { t: 'entity', e, label: `Parler à ${e.label}`, hint: a.ko > 0 ? `à terre : une potion de soin ${a.sex === 'f' ? 'la' : 'le'} relèverait` : 'N : suivre / attendre' };
  }
  interactAlly(e: Entity): void {
    if (e.ally!.kind === 'horse') { this.toggleMount(); return; }
    e.talkT = 60;
    this.g.ui?.openDialogue(this.mercDialogue(e), () => { e.talkT = 2; });
  }

  /** Léger tangage de la caméra au trot et au galop (m). */
  bob(): number { const h = this.horse; return h && this.riding ? Math.sin(h.pose.walk * 2) * (this.g.player.sprinting ? 0.045 : 0.025) : 0; }

  /** Invite de la ligne centrale du HUD. */
  hint(): { text: string; color: number } | null {
    const g = this.g, h = this.horse;
    if (!h?.alive || g.dungeon) return null;
    const a = h.ally!;
    if (a.mounted) return a.winded ? { text: 'Essoufflé : trot imposé · G : descendre', color: RED } : g.player.sprinting ? { text: 'GALOP · G : descendre', color: YELLOW } : { text: 'Trot · Maj : galop · G : descendre · Y : siffler', color: 0x9a9a90 };
    return !a.dormant && Math.hypot(h.x - g.player.x, h.z - g.player.z) < MOUNT.mountRange ? { text: `[G] Monter ${h.name}`, color: 0x9a9a90 } : null;
  }
  horseView(): HorseView | null {
    const g = this.g, h = this.horse;
    if (!h?.alive || !h.ally || g.dungeon) return null;
    const a = h.ally;
    return { name: h.name, coat: COATS[a.look]?.name ?? '', grade: a.grade, hp: h.hp, maxHp: h.maxHp, stamina: a.stamina, maxStamina: a.maxStamina, mounted: a.mounted, winded: a.winded, limp: h.hp < h.maxHp * MOUNT.limpHp, dist: Math.hypot(h.x - g.player.x, h.z - g.player.z) };
  }
  mercView(): MercView | null {
    const m = this.merc;
    return m?.ally ? { name: m.name, level: m.ally.level, hp: m.hp, maxHp: m.maxHp, mode: m.ally.mode, ko: m.ally.ko, left: m.ally.left } : null;
  }
  /** Marqueurs de la carte (M) : maison, cheval laissé à pied, mercenaire qui attend. */
  markers(): { x: number; z: number; glyph: string; color: number; name?: string }[] {
    const out: { x: number; z: number; glyph: string; color: number; name?: string }[] = [], home = this.home(), h = this.horse, m = this.merc;
    if (home) out.push({ x: home.x, z: home.z, glyph: '♥', color: GREEN, name: 'Ma maison' });
    if (h?.alive && !h.ally!.mounted && worldOf(h.x, h.z) === -1) out.push({ x: h.x, z: h.z, glyph: 'h', color: ORANGE, name: h.name });
    if (m?.ally && m.ally.mode === 'attendre' && worldOf(m.x, m.z) === -1) out.push({ x: m.x, z: m.z, glyph: '☻', color: CYAN, name: m.ally.first });
    return out;
  }
  /** Section « Biens et compagnons » du journal (J). */
  journalLines(): { text: string; color: number }[] {
    const g = this.g, p = g.player, out: { text: string; color: number }[] = [], home = this.home(), h = this.horse, m = this.merc;
    // sous terre, les coordonnées du joueur sont hors du monde (x ≥ 20 000) : aucune distance n'aurait de sens
    const under = !!g.dungeon;
    const where = (x: number, z: number) => { const d = Math.hypot(x - p.x, z - p.z); return `${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m'} ${direction(p.x, p.z, x, z)}`; };
    if (home) out.push({ text: `♥ Maison à ${home.place}${under ? ' (vous êtes sous terre)' : ', ' + where(home.x, home.z)} · coffre : ${this.estate.chest.items.size} pile(s), ${this.estate.chest.gold} or`, color: GREEN });
    if (h?.alive && h.ally) {
      const a = h.ally;
      out.push({ text: `h ${h.name}, ${a.grade} ${COATS[a.look]?.name ?? ''} · PV ${Math.ceil(h.hp)}/${h.maxHp} · ${a.mounted ? 'sous vous' : worldOf(h.x, h.z) !== -1 ? 'laissé à l’entrée du souterrain' : under ? 'resté à la surface (vous êtes sous terre)' : where(h.x, h.z)}`, color: ORANGE });
    }
    if (m?.ally) out.push({ text: `☻ ${m.name}, ${archName(m.ally.arch, m.ally.sex)} niv. ${m.ally.level} · contrat : ${contractLabel(m.ally.left)} · ${m.ally.ko > 0 ? 'à terre' : m.ally.mode === 'suivre' ? 'vous suit' : 'attend'}`, color: CYAN });
    return out;
  }

  // ---------------------------------------------------------------- sauvegarde
  /** Rien possédé : undefined (la sauvegarde reste identique à l'ancien format). */
  toSave(): EstateSave | undefined {
    const out: EstateSave = {}, e = this.estate, h = this.horse, m = this.merc;
    if (e.house) out.house = { ...e.house };
    if (e.chest.items.size) out.chest = [...e.chest.items];
    if (e.chest.gold) out.gold = e.chest.gold;
    if (h?.alive && h.ally) out.horse = { grade: h.ally.grade, coat: h.ally.look, name: h.name, hp: Math.round(h.hp), x: r2(h.x), z: r2(h.z), heading: r2(h.heading), stamina: Math.round(h.ally.stamina), mounted: h.ally.mounted };
    if (m?.ally && m.ally.left > 0) {
      const a: AllyState = m.ally, surface = worldOf(m.x, m.z) === -1;
      out.merc = { first: a.first, last: a.last, sex: a.sex, arch: a.arch, look: a.look, hp: Math.round(a.ko > 0 ? Math.max(1, m.maxHp * MERC.reviveFrac) : m.hp), left: Math.round(a.left), mode: surface ? (a.mode === 'attendre' ? 'attendre' : 'suivre') : 'suivre' };
      if (surface && a.mode === 'attendre') { out.merc.x = r2(m.x); out.merc.z = r2(m.z); out.merc.heading = r2(m.heading); }
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** Remise à zéro (nouvelle partie, chargement : le Game est réutilisé si la seed est la même). */
  reset(): void {
    this.estate.reset(); this.homeB = { key: '', b: null };
    this.g.entities.setOwnedHouse(null); this.g.entities.clearAllies();
    const p = this.g.player;
    p.mounted = false; p.mountLift = 0; p.keepOut = null; this.atHome = false; this.wasRiding = false; this.limpShown = false;
  }

  /** Restaure depuis une sauvegarde (assainie) ; champ absent = rien de possédé. */
  load(raw: unknown): void {
    const g = this.g, p = g.player, es = sanitizeEstate(raw);
    this.reset();
    // la maison doit encore désigner une maison debout (sauvegarde d'un autre générateur : le coffre reste, la propriété tombe)
    const hb = es.house ? g.world.civWorld.layouts.find((l) => l.sid === es.house!.sid)?.buildings[es.house.bid] : undefined;
    if (es.house && hb && hb.kind === 'maison' && !hb.ruined) this.setHouse(es.house);
    for (const [id, n] of es.chest ?? []) this.estate.chest.add(id, n);
    this.estate.chest.gold = es.gold ?? 0;
    if (es.horse) {
      const mounted = es.horse.mounted === true && !g.dungeon;
      g.entities.spawnHorse({ ...es.horse, mounted });
      if (mounted) { p.mounted = true; p.mountLift = MOUNT.lift; this.wasRiding = true; }
    }
    if (es.merc) g.entities.spawnMerc({ ...es.merc, x: es.merc.x ?? p.x + 2, z: es.merc.z ?? p.z }, g.character.level);
  }

  // ---------------------------------------------------------------- console de développement
  dev(cmd: string, args: string[]): { text: string; err?: boolean }[] {
    const g = this.g, p = g.player, out: { text: string; err?: boolean }[] = [], say = (text: string, err = false) => out.push({ text, err });
    const a0 = (args[0] ?? '').toLowerCase();
    switch (cmd) {
      case 'cheval': {
        if (a0 === 'retire') { g.entities.removeAlly('horse'); p.mounted = false; say('cheval retiré'); break; }
        const h = this.horse;
        if (a0 === 'soin' && h?.alive) { h.hp = h.maxHp; h.ally!.stamina = h.ally!.maxStamina; say('cheval soigné'); break; }
        if (a0 === 'tue' && h?.alive) { hitEntity(g.combat, h, 9999, 'dev'); say('cheval tué'); break; }
        const grade = (['bidet', 'palefroi', 'destrier'] as const).find((x) => x === a0) ?? 'palefroi';
        const coat = Math.max(0, COATS.findIndex((c) => c.name === a0)), gr = HORSE_GRADES[grade];
        const x = p.x + Math.sin(p.heading) * 4, z = p.z - Math.cos(p.heading) * 4;
        g.entities.spawnHorse({ grade, coat: COATS.some((c) => c.name === a0) ? coat : 0, name: 'Braise', hp: gr.hp, x, z, heading: p.heading + Math.PI, stamina: gr.stamina });
        say(`cheval : ${grade} ${COATS[coat].name} (G : monter, Y : siffler)`);
        break;
      }
      case 'monture': { if (this.riding) this.dismount(); else { const h = this.horse; if (!h?.alive) { say('pas de cheval (cheval)', true); break; } h.x = p.x; h.z = p.z; h.ally!.dormant = false; this.toggleMount(); } break; }
      case 'mercenaire': {
        if (a0 === 'retire') { g.entities.removeAlly('merc'); say('mercenaire renvoyé'); break; }
        const m = this.merc;
        if (a0 === 'ko' && m?.ally) { hitEntity(g.combat, m, 9999, 'dev'); say('mercenaire à terre'); break; }
        if (a0 === 'jours' && m?.ally) { m.ally.left = Math.max(1, Math.floor(+args[1] || 1)) * MIN_PER_DAY; say(`contrat : ${contractLabel(m.ally.left)}`); break; }
        const st = mercStats(mercLevel(g.character.level), 'lame');
        g.entities.spawnMerc({ first: 'Aldric', last: 'Roche', sex: 'm', arch: 'lame', look: 77, hp: st.hp, left: CONTRACT_MIN, mode: 'suivre', x: p.x + 2, z: p.z }, g.character.level);
        say(`mercenaire : Aldric Roche, niveau ${mercLevel(g.character.level)} (N : suivre / attendre)`);
        break;
      }
      case 'maison': {
        if (a0 === 'retire') { this.setHouse(null); say('maison retirée'); break; }
        let best: ReturnType<Possessions['sale']> & { sid: number } | null = null, bd = Infinity;
        for (const L of g.world.civWorld.layouts) {
          if (L.sid < 0) continue;
          const s = this.sale(L.sid), d = Math.hypot(L.x - p.x, L.z - p.z);
          if (s && d < bd) { bd = d; best = { ...s, sid: L.sid }; }
        }
        if (!best) { say('aucune implantation éligible', true); break; }
        this.setHouse({ sid: best.sid, bid: best.bid });
        say(`maison : ${best.place}, ${best.where} (${best.price} or), à ${Math.round(bd)} m`);
        if (a0 === 'aller') { const d = doorOutside(best.building, 3.5); if (g.dungeon) g.exitDungeon(); p.x = d.x; p.z = d.z; p.heading = d.heading; g.world.chunks.update(d.x, d.z, -1); p.y = g.world.heightAt(d.x, d.z) + 0.3; say('téléporté devant la porte'); }
        break;
      }
      case 'coffre': {
        const home = this.home();
        if (!home) { say('aucune maison (maison)', true); break; }
        this.openChest({ key: 'dev', kind: 'coffre', x: p.x, y: p.y, z: p.z, sid: home.sid, bid: home.bid, dungeonId: -1 });
        say('coffre ouvert');
        break;
      }
      case 'biens': {
        const home = this.home(), h = this.horse, m = this.merc;
        say(`maison : ${home ? `${home.place} (b${home.bid}) · coffre ${this.estate.chest.items.size} piles, ${this.estate.chest.gold} or` : 'aucune'}`);
        say(`cheval : ${h ? `${h.name} ${h.ally!.grade} PV ${Math.ceil(h.hp)}/${h.maxHp} ${h.alive ? '' : '(mort) '}${h.ally!.mounted ? 'monté' : h.ally!.mode}${h.ally!.dormant ? ' (gelé)' : ''}` : 'aucun'}`);
        say(`mercenaire : ${m?.ally ? `${m.name} niv. ${m.ally.level} PV ${Math.ceil(m.hp)}/${m.maxHp} ${m.ally.mode}${m.ally.ko > 0 ? ' (à terre)' : ''} contrat ${contractLabel(m.ally.left)}` : 'aucun'}`);
        break;
      }
    }
    return out;
  }
}
