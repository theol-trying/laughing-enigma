import { WorldSeed } from '@ascii-fort/core/Seed';
import { GameTime } from '@ascii-fort/core/Time';
import { EventBus } from '@ascii-fort/core/Events';
import type { Input } from '@ascii-fort/ascii-engine/Input';
import { World } from '@ascii-fort/worldgen/World';
import type { MacroWorld } from '@ascii-fort/worldgen/MacroWorld';
import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import { buildFarTerrain } from '@ascii-fort/worldgen/FarTerrain';
import { generateDungeon, buildDungeon, type DungeonLayout } from '@ascii-fort/worldgen/dungeons/DungeonGenerator';
import type { ChunkData, Prop } from '@ascii-fort/worldgen/Chunk';
import { Player } from '@ascii-fort/sim/entities/Player';
import { EntityManager } from '@ascii-fort/sim/entities/EntityManager';
import type { Entity } from '@ascii-fort/sim/entities/Entity';
import { MONSTERS } from '@ascii-fort/sim/entities/Monster';
import { type CombatHost } from '@ascii-fort/sim/gameplay/Combat';
import { Character } from '@ascii-fort/sim/gameplay/Character';
import { PlayerCombat , projectileLook } from '@ascii-fort/sim/gameplay/PlayerCombat';
import { WorldState, type Dropped } from '@ascii-fort/sim/gameplay/WorldState';
import { item } from '@ascii-fort/sim/gameplay/Items';
import { packBits, unpackBits, type SaveData } from './SaveManager';
import type { Coop } from '../net/Coop';
import type { Mood } from '../audio/AudioEngine';
import { B } from '@ascii-fort/worldgen/terrain/Biomes';
import { W_SEA, W_LAKE } from '@ascii-fort/worldgen/terrain/Hydrology';
import { GAME_VERSION, GENERATOR_VERSION } from '../version';
import type { Good } from '@ascii-fort/worldgen/civilization/types';
import { creatureLoot, containerLoot, type LootLine } from '@ascii-fort/sim/gameplay/Loot';
import { perceives, lineOfSight, playerNoise } from '@ascii-fort/sim/ai/Perception';
import { Reputation } from '@ascii-fort/sim/gameplay/Reputation';
import { Economy } from '@ascii-fort/sim/gameplay/Economy';
import { Rumors } from '@ascii-fort/sim/gameplay/Rumors';
import { QuestSystem } from '@ascii-fort/sim/gameplay/QuestSystem';
import { DialogueSystem, type DialogueNode } from '@ascii-fort/sim/gameplay/Dialogue';
import { Camera } from '@ascii-fort/ascii-engine/Camera';
import { Weather, type WeatherState } from '@ascii-fort/sim/gameplay/Weather';
import { AudioEngine, type Surface } from '../audio/AudioEngine';
import type { WeatherMix } from '@ascii-fort/ascii-engine/Atmosphere';
import { computeAtmosphere, CLEAR_WEATHER } from '@ascii-fort/ascii-engine/Atmosphere';
import { M } from '@ascii-fort/ascii-engine/Materials';
import { trsYawPitch, mat4 } from '@ascii-fort/core/math';
import { InstanceBuffer, type Renderer, type GpuMesh, type DrawItem, type PointLight } from '@ascii-fort/ascii-engine/Renderer';

interface ActiveDungeon { layout: DungeonLayout; mesh: GpuMesh; data: ChunkData; ret: { x: number; z: number; heading: number } }

/** Ce que le joueur vise : objet, personnage ou créature (vivante ou morte), objet au sol. */
/** Bonus temporaire : dégâts (fraction), armure, soins par seconde, récupération d'endurance (fraction). */
export interface Buff { id: string; name: string; t: number; dmg?: number; armor?: number; regen?: number; stam?: number }

export type Focus =
  | { t: 'prop'; prop: Prop; label: string; hint?: string; danger?: boolean }
  | { t: 'entity'; e: Entity; label: string; pick?: boolean }
  | { t: 'drop'; d: Dropped; label: string }
  | { t: 'player'; id: string; label: string };

/** Partie en cours : monde, joueur, temps et systèmes. */
export class Game {
  readonly seed: WorldSeed;
  readonly world: World<GpuMesh>;
  readonly player = new Player();
  readonly character = new Character();
  readonly time = new GameTime();
  readonly events = new EventBus();
  readonly camera = new Camera();
  readonly instances = new InstanceBuffer();
  readonly state = new WorldState();
  readonly fight = new PlayerCombat();
  readonly entities: EntityManager;
  readonly combat: CombatHost;
  readonly rep: Reputation;
  readonly economy: Economy;
  readonly rumors: Rumors;
  readonly quests: QuestSystem;
  readonly dialogue: DialogueSystem;
  readonly weatherSys: Weather;
  readonly audio = new AudioEngine();
  wx: { mix: WeatherMix; state: WeatherState; flash: number } = { mix: CLEAR_WEATHER, state: 'clair', flash: 0 };
  private stepDist = 0;
  private drownMsgT = -10;
  /** sons : état précédent des créatures proches (alerte, attaque, mort), combat récent, hurlements */
  private heard = new Map<string, { target: boolean; swing: number; alive: boolean }>();
  private combatT = 0;
  private howlT = 20;
  private waterT = 0;
  private waterNear: { p: { x: number; y: number; z: number } | null; kind: 'rivière' | 'lac' | 'mer' | null } = { p: null, kind: null };
  private clanged = new WeakSet<Entity>();
  /** coups déjà portés aux arbres et rochers en cours de récolte */
  private nodeHits = new Map<string, number>();
  private harvestMsgT = -10;
  /** bonus temporaires actifs */
  buffs: Buff[] = [];
  /** objets récupérés récemment (affichés à droite de l'écran) */
  lootFeed: { text: string; color: number; t: number }[] = [];
  /** bandeau central (montée de niveau…) */
  banner: { text: string; sub: string; t: number } | null = null;
  private lastLevel = 1;
  private tintFlash: { c: [number, number, number]; t: number } | null = null;
  /** humidité des surfaces (0..1) : monte sous la pluie, sèche lentement */
  wetness = 0;
  private swimT = 0;
  private lastHp = 100;
  private lastFlash = 0;
  /** branché par l'interface : ouverture des écrans de dialogue et de commerce */
  ui: { openDialogue(node: DialogueNode, onClose: () => void): void; openTrade(e: Entity): void } | null = null;
  private stocks = new Map<string, { id: string; qty: number }[]>();
  private questT = 0;
  private far: GpuMesh;
  dungeon: ActiveDungeon | null = null;
  focus: Focus | null = null;
  target: Entity | null = null;
  elapsed = 0;
  private respawnT = 0;
  private lastDay = 0;
  private atmoNight = 0;
  private discoverT = 0;
  private m4 = mat4();
  // outils de développement
  god = false;
  weatherOverride: WeatherState | null = null;
  viewMode = 0;
  showChunks = false;
  /** sensibilité de la souris (options) */
  sensitivity = 1;
  /** libère les ressources GPU (retour au titre) */
  /** mode coopératif en ligne (null en solo) */
  coop: Coop | null = null;

  dispose(): void { this.coop?.dispose(); this.coop = null; this.world.chunks.clear(); this.renderer.deleteMesh(this.far); if (this.dungeon) this.renderer.deleteMesh(this.dungeon.mesh); }

  constructor(seedText: string, private renderer: Renderer, macro?: MacroWorld, civ?: Civilization) {
    this.seed = new WorldSeed(seedText);
    this.world = new World<GpuMesh>(this.seed, { upload: (m) => renderer.createMesh(m), release: (g) => renderer.deleteMesh(g) }, macro, civ);
    this.far = renderer.createMesh(buildFarTerrain(this.world.macro, (mb) => this.world.civWorld.landmarks(mb)));
    const sp = this.world.spawn();
    this.player.x = sp.x; this.player.z = sp.z; this.player.heading = sp.heading;
    this.world.chunks.update(sp.x, sp.z, -1);
    this.player.y = this.world.heightAt(sp.x, sp.z) + 0.1;
    this.combat = { player: this.player, events: this.events, onPlayerDeath: () => this.onPlayerDeath(), playerArmor: () => this.character.armor, forward: (e, a, el) => !!this.coop?.forwardHit(e, a, el) };
    this.entities = new EntityManager(this);
    this.world.chunks.dynamic = this.entities.dynamic;
    this.lastDay = this.time.day;
    this.rep = new Reputation(this.world.civ, this.events, this.entities);
    this.rep.day = () => this.time.day;
    this.economy = new Economy(this.world.civ, this.seed, (sid) => !this.entities.clearedCamps.has(sid));
    this.rumors = new Rumors(this.world.civ, this.events, () => this.time.day);
    this.quests = new QuestSystem(this);
    this.dialogue = new DialogueSystem(this);
    this.weatherSys = new Weather(this.world.macro);
    this.events.on('entity:damaged', (d) => { if (d.sourceId === 'player') this.audio.hit(); });
    this.events.on('quest:completed', () => this.audio.chime());
    this.events.on('quest:started', () => this.audio.chime());
    this.events.on('camp:cleared', () => this.economy.refreshBlocked());
    this.events.on('entity:killed', (k) => {
      if (k.killerId !== 'player' || k.kind !== 'npc') return;
      const w = this.witnesses();
      this.events.emit('player:crime', { type: 'meurtre', victimId: k.victimId, settlementId: k.settlementId, factionId: k.factionId, witnesses: w.map((x) => x.id) });
      if (w.length && k.settlementId !== undefined) this.alertGuards(k.settlementId);
    });
    // équipement de départ du voyageur
    const ch = this.character;
    for (const [id, n] of [['épée courte', 1], ['tunique de cuir', 1], ['pain', 3], ['potion de soin', 2], ['viande crue', 1]] as [string, number][]) ch.inv.add(id, n);
    ch.inv.gold = 25;
    ch.equipItem('épée courte'); ch.equipItem('tunique de cuir');
    this.syncStats(true);
    this.events.on('entity:killed', (ev) => {
      if (ev.killerId !== 'player') return;
      const victim = this.entities.entities.find((x) => x.id === ev.victimId);
      const xp = ev.kind === 'monster' ? victim?.mon?.xp ?? MONSTERS[ev.type]?.xp ?? 15 : 10;
      const ups = ch.gainXp(xp);
      this.events.emit('message', { text: `+${xp} XP`, color: 0xe8c050 });
      void ups;
    });
    this.state.explore(sp.x, sp.z);
  }

  inDungeon(): boolean { return this.dungeon !== null; }
  weather(): string { return this.dungeon ? 'souterrain' : this.wx.state; }

  /** Stock du jour d'un marchand (les achats le vident). */
  stockOf(e: Entity): { id: string; qty: number }[] {
    const key = `${e.id}:${this.time.day}`;
    let s = this.stocks.get(key);
    if (!s) { s = this.economy.stock(e.npc!, this.time.day); this.stocks.set(key, s); }
    return s.filter((x) => x.qty > 0);
  }
  openTrade(e: Entity): void { if (this.rep.mood(e.npc!) === 'hostile') return; this.ui?.openTrade(e); }
  payFine(sid: number): boolean {
    const b = this.rep.bounty.get(sid) ?? 0;
    if (this.character.inv.gold < b) return false;
    this.character.inv.gold -= b; this.rep.bounty.delete(sid);
    for (const e of this.entities.entities) if (e.npc?.sid === sid) e.hostile = false;
    this.events.emit('message', { text: `Amende payée (${b} or).` });
    return true;
  }
  resistArrest(sid: number): void { this.alertGuards(sid); this.events.emit('message', { text: 'Les gardes dégainent !', color: 0xe05040 }); }
  alertGuards(sid: number): void { for (const e of this.entities.entities) if (e.npc?.sid === sid && (e.npc.profession === 'garde' || e.npc.profession === 'soldat')) e.hostile = true; }

  /** Le joueur a frappé quelqu'un : agression (témoins, gardes). */
  onHit(e: Entity): void {
    this.target = e;
    if (!e.npc || e.hostile) return;
    e.hostile = true; e.thinkT = 0;
    const w = this.witnesses();
    this.events.emit('player:crime', { type: 'agression', victimId: e.id, settlementId: e.npc.sid, factionId: e.npc.factionId, witnesses: [...new Set([...w.map((x) => x.id), e.id])] });
    this.alertGuards(e.npc.sid);
  }
  rain(): number { return this.dungeon ? 0 : this.wx.mix.rain + this.wx.mix.storm * 0.5; }
  night(): number { return this.atmoNight; }
  fog(): number { return this.dungeon ? 0 : this.wx.mix.fog; }

  /** Valeurs dérivées de la fiche → joueur. */
  syncStats(refill = false): void {
    const p = this.player, ch = this.character;
    p.maxHp = ch.maxHp; p.maxStamina = ch.maxStamina; p.maxMana = ch.maxMana;
    if (refill) { p.hp = p.maxHp; p.stamina = p.maxStamina; p.mana = p.maxMana; }
    p.hp = Math.min(p.hp, p.maxHp);
  }

  onPlayerDeath(): void {
    if (this.respawnT > 0) return;
    this.respawnT = 4;
    this.events.emit('message', { text: 'Vous vous effondrez… tout devient noir.', color: 0xe05040 });
  }

  private respawn(): void {
    if (this.dungeon) this.exitDungeon();
    const sp = this.world.spawn(), p = this.player;
    p.x = sp.x; p.z = sp.z; p.heading = sp.heading; p.vx = p.vz = p.vy = 0;
    this.world.chunks.update(p.x, p.z, -1);
    p.y = this.world.heightAt(p.x, p.z) + 0.1;
    p.dead = false; p.hp = Math.round(p.maxHp * 0.5); p.stamina = p.maxStamina; p.poison = p.burn = p.frost = 0;
    const lost = Math.floor(this.character.inv.gold * 0.2);
    this.character.inv.gold -= lost;
    if (!this.coop) this.time.minutes += 8 * 60;
    this.respawnT = 0;
    this.events.emit('message', { text: `Vous vous réveillez à l'auberge${this.coop ? '' : ', huit heures plus tard'}. Votre bourse est plus légère (-${lost} or).` });
  }

  // ------------------------------------------------------------------ objets interactifs
  private isOwned(pr: Prop): boolean {
    if (pr.sid < 0 || pr.key.startsWith('dj')) return false;
    const s = this.world.civ.settlements[pr.sid];
    return !!s && !s.abandoned && s.type !== 'camp';
  }

  private buildingKind(pr: Prop): string {
    const L = this.world.civWorld.layouts.find((l) => l.sid === pr.sid);
    const s = this.world.civ.settlements[pr.sid];
    if (s?.type === 'camp') return 'camp';
    return L?.buildings[pr.bid]?.kind ?? 'maison';
  }

  private propLabel(pr: Prop): string {
    const owned = this.isOwned(pr);
    switch (pr.kind) {
      case 'entrée': return `Entrer : ${this.world.civ.dungeons[pr.dungeonId]?.name ?? 'souterrain'}`;
      case 'sortie': return 'Remonter à la surface';
      case 'porte verrouillée': return this.state.flags.get(`door:dj${pr.dungeonId}`) ? '' : 'Porte verrouillée';
      case 'coffre': case 'tonneau': case 'caisse':
        return this.state.opened.has(pr.key) ? '' : `${owned ? 'Voler dans' : 'Fouiller'} : ${pr.kind}${owned ? ' (vol)' : ''}`;
      case 'lit': return this.buildingKind(pr) === 'auberge' ? 'Dormir (chambre : 10 or)' : owned ? '' : 'Dormir';
      case 'autel': case 'sanctuaire': return 'Prier';
      case 'puits': return "Boire l'eau du puits";
      case 'âtre': case 'feu': case 'foyer':
        if (pr.kind === 'foyer' && this.buildingKind(pr) === 'forge') return 'Fondre le minerai (2 minerais de fer + 1 charbon)';
        return this.character.inv.count('viande crue') ? 'Cuire la viande' : '';
      case 'enclume': return 'Forger des flèches (1 bûche ou des branches + 1 lingot)';
      case 'établi': return 'Préparer une potion (2 herbes)';
      case 'piège': return this.state.flags.get(pr.key) ? '' : 'Désamorcer le piège';
      default: return '';
    }
  }

  private findFocus(): Focus | null {
    const p = this.player;
    const e = this.entities.pick(p.x, p.z, p.heading, 3.2, false);
    const see = (x: number, z: number) => lineOfSight(this.world.chunks, p.x, p.z, x, z, p.y);
    if (e && see(e.x, e.z)) {
      if (e.alive && e.npc) {
        const behind = (p.x - e.x) * Math.sin(e.heading) - (p.z - e.z) * Math.cos(e.heading) < 0;
        if (p.crouch && behind && Math.hypot(e.x - p.x, e.z - p.z) < 1.9 && !this.aware(e)) return { t: 'entity', e, label: `Voler à la tire : ${e.label}`, pick: true };
        return { t: 'entity', e, label: `Parler à ${e.label}${this.stockOf(e).length ? ' · [T] commercer' : ''}` };
      }
      if (!e.alive && !e.looted) return { t: 'entity', e, label: `Fouiller : ${e.npc ? e.label : e.name}` };
    }
    const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
    // un autre joueur juste devant : on peut lui proposer un échange
    if (this.coop) {
      const dg = this.dungeon ? this.dungeon.layout.id : -1;
      for (const r of this.coop.players.values()) {
        const dx = r.x - p.x, dz = r.z - p.z, d = Math.hypot(dx, dz);
        if (!r.seen || r.dungeon !== dg || d > 3 || (d > 0.6 && (dx * fx + dz * fz) / d < 0.6) || r.pose.dead > 0.5 || !see(r.x, r.z)) continue;
        return { t: 'player', id: r.id, label: `Proposer un échange à ${r.name}` };
      }
    }
    let best: Focus | null = null, bs = Infinity;
    for (const pr of this.world.chunks.propsNear(p.x, p.z, 3.2)) {
      const dx = pr.x - p.x, dz = pr.z - p.z, d = Math.hypot(dx, dz);
      const facing = d < 0.8 ? 1 : (dx * fx + dz * fz) / d;
      if (facing < 0.35 || Math.abs(pr.y - p.y) > 2.5) continue;
      const label = this.propLabel(pr);
      if (label && d - facing < bs && see(pr.x, pr.z)) { bs = d - facing; best = { t: 'prop', prop: pr, label }; }
    }
    // vol : on montre s'il y a des témoins
    if (best?.t === 'prop' && /^(coffre|tonneau|caisse)$/.test(best.prop.kind) && this.isOwned(best.prop)) {
      const n = this.theftWitnesses();
      best.hint = n ? `${n} témoin${n > 1 ? 's' : ''} vous verrai${n > 1 ? 'en' : ''}t ou entendrai${n > 1 ? 'en' : ''}t !` : p.crouch ? 'personne ne vous voit ni ne vous entend' : 'personne ne vous voit (accroupi avec C : plus silencieux)';
      best.danger = n > 0;
    }
    for (const dr of this.state.dropped) {
      const d = Math.hypot(dr.x - p.x, dr.z - p.z);
      if (d < 2.2 && d - 1 < bs) { bs = d - 1; best = { t: 'drop', d: dr, label: `Ramasser : ${item(dr.id).name}${dr.qty > 1 ? ' ×' + dr.qty : ''}` }; }
    }
    return best;
  }

  /** Ajoute un butin à l'inventaire et le résume. */
  giveLoot(lines: LootLine[], from: string): void {
    const inv = this.character.inv;
    const parts: string[] = [];
    for (const l of lines) {
      if (l.id === 'or') { inv.gold += l.qty; parts.push(`${l.qty} or`); }
      else { inv.add(l.id, l.qty); parts.push(`${item(l.id).name}${l.qty > 1 ? ' ×' + l.qty : ''}`); this.events.emit('item:picked', { itemId: l.id, qty: l.qty }); }
    }
    this.events.emit('message', { text: parts.length ? `${from} : ${parts.join(', ')}` : `${from} : rien.`, color: 0xc8c8bc });
    const now = performance.now();
    if (!lines.length) this.lootFeed.push({ text: `${from} : vide`, color: 0x7a7a70, t: now });
    for (const l of lines) {
      const d = l.id === 'or' ? null : item(l.id);
      const color = !d ? 0xe8c050 : d.rarity === 'épique' ? 0xd070d0 : d.rarity === 'rare' ? 0x5a9ae8 : d.cat === 'quête' || d.cat === 'clé' ? 0xf0d060 : 0xe8e8e0;
      this.lootFeed.push({ text: `+ ${l.qty > 1 || !d ? l.qty + ' ' : ''}${d ? d.name : 'pièces d’or'}`, color, t: now });
    }
    if (this.lootFeed.length > 8) this.lootFeed.splice(0, this.lootFeed.length - 8);
  }

  /** PNJ qui voient le joueur (témoins d'un délit). */
  witnesses(actNoise = 0): Entity[] {
    const p = this.player, env = { night: this.atmoNight, fog: this.fog() };
    return this.entities.entities.filter((e) => e.npc && e.alive && !e.remote && Math.hypot(e.x - p.x, e.z - p.z) < 22
      && perceives(this.world.chunks, { x: e.x, z: e.z, y: e.y, heading: e.heading, range: 22, nocturnal: false, asleep: e.action === 'dormir' }, { x: p.x, z: p.z, y: p.y, stealth: p.crouch ? Math.max(0.35, this.character.stealth()) : 0, noise: Math.max(actNoise, playerNoise(p)) }, env));
  }

  /** Bruit de la fouille d'un contenant : on ouvre plus discrètement accroupi. */
  private theftNoise(): number { return this.player.crouch ? 0.12 : 0.5; }
  private theftT = -1; private theftN = 0;
  private theftWitnesses(): number {
    if (this.elapsed - this.theftT >= 0.25) { this.theftT = this.elapsed; this.theftN = this.witnesses(this.theftNoise()).length; }
    return this.theftN;
  }

  private watchT = 0;
  private watchCache: { npcs: Entity[]; hunters: Entity[] } = { npcs: [], hunters: [] };
  /** Qui voit le joueur en ce moment (témoins et créatures qui le chassent), recalculé 4 fois par seconde. */
  watchers(): { npcs: Entity[]; hunters: Entity[] } {
    if (this.elapsed - this.watchT < 0.25) return this.watchCache;
    this.watchT = this.elapsed;
    const hunters = this.entities.entities.filter((e) => e.alive && e.mon && e.mon.targetId === 'player');
    this.watchCache = { npcs: this.witnesses(), hunters };
    return this.watchCache;
  }

  interact(): void {
    const f = this.focus, ch = this.character, p = this.player;
    if (!f) return;
    if (f.t === 'entity') {
      const e = f.e;
      if (e.alive && e.npc) { if (f.pick) this.pickpocket(e); else this.talkTo(e); return; }
      if (!e.alive && !e.looted) {
        e.looted = true;
        const biome = this.world.sampler.biomeAt(e.x, e.z);
        const table = e.mon ? e.mon.loot : 'maison';
        const seedKey = `${e.id}:${this.time.day}`;
        const give = () => this.giveLoot(creatureLoot(this.seed, table, seedKey, { biome }), e.name);
        if (this.coop) this.coop.claimOnce('loot:' + seedKey, give); else give();
      }
      return;
    }
    if (f.t === 'player') { this.coop?.askTrade(f.id); return; }
    if (f.t === 'drop') {
      ch.inv.add(f.d.id, f.d.qty);
      this.lootFeed.push({ text: `+ ${f.d.qty > 1 ? f.d.qty + ' ' : ''}${item(f.d.id).name}`, color: 0xe8e8e0, t: performance.now() });
      this.state.dropped = this.state.dropped.filter((x) => x !== f.d);
      this.events.emit('message', { text: `Ramassé : ${item(f.d.id).name}` });
      return;
    }
    const pr = f.prop;
    switch (pr.kind) {
      case 'entrée': this.enterDungeon(pr.dungeonId); break;
      case 'sortie': this.exitDungeon(); break;
      case 'porte verrouillée': {
        const dg = this.dungeon;
        if (!dg) break;
        if (ch.inv.count(dg.layout.keyItem)) {
          this.setFlag(`door:dj${dg.layout.id}`, true);
          this.applyDoor();
          this.events.emit('message', { text: 'La clé tourne dans la serrure. La porte s’ouvre en grinçant.', color: 0xf0d060 });
        } else this.events.emit('message', { text: 'Verrouillée. Il doit y avoir une clé quelque part dans ces souterrains.' });
        break;
      }
      case 'coffre': case 'tonneau': case 'caisse': {
        if (this.state.opened.has(pr.key)) break;
        if (this.coop) { this.coop.claimOnce('open:' + pr.key, () => this.openContainer(pr)); break; }
        this.openContainer(pr);
        break;
      }
      case 'lit': {
        const inn = this.buildingKind(pr) === 'auberge';
        const flag = `chambre:${pr.sid}`;
        if (inn && this.state.flags.get(flag) !== this.time.day) {
          if (ch.inv.gold < 10) { this.events.emit('message', { text: "« Dix pièces la nuit, c'est le prix. » Vous n'avez pas assez." }); break; }
          ch.inv.gold -= 10; this.state.flags.set(flag, this.time.day);
          this.events.emit('trade', { npcId: 'auberge', itemId: 'chambre', qty: 1, price: 10, sold: false });
        }
        this.sleep();
        break;
      }
      case 'autel': case 'sanctuaire': {
        p.poison = 0; p.stamina = p.maxStamina;
        const key = `prière:${pr.key}`, now = this.time.minutes;
        const last = this.state.flags.get(key) as unknown as number | undefined;
        if (typeof last === 'number' && now - last < 6 * 60) { this.events.emit('message', { text: 'Vous priez encore, mais la grâce vous a déjà été accordée ici. Revenez dans quelques heures.', color: 0xe8e0c0 }); break; }
        this.state.flags.set(key, now as unknown as boolean);
        this.addBuff({ id: 'béni', name: 'Béni', t: 240, dmg: 0.15, armor: 3, regen: 1 });
        this.tintFlash = { c: [1, 0.85, 0.45], t: 1.2 };
        this.audio.chime();
        this.events.emit('message', { text: 'Vous priez. Une chaleur vous envahit : vous êtes béni (dégâts +15 %, armure +3, soins lents, 4 min).', color: 0xf0d060 });
        this.events.emit('player:helped', { npcId: 'ordre', magnitude: 0.01, reason: 'prière' });
        break;
      }
      case 'puits':
        p.stamina = p.maxStamina;
        this.addBuff({ id: 'désaltéré', name: 'Désaltéré', t: 120, stam: 0.5 });
        this.events.emit('message', { text: "L'eau est fraîche : vous êtes désaltéré (endurance +50 %, 2 min)." });
        break;
      case 'âtre': case 'feu': case 'foyer': {
        if (pr.kind === 'foyer' && this.buildingKind(pr) === 'forge' && ch.inv.count('minerai de fer') >= 2 && ch.inv.count('charbon') >= 1) {
          const n = Math.min(Math.floor(ch.inv.count('minerai de fer') / 2), ch.inv.count('charbon'));
          ch.inv.remove('minerai de fer', n * 2); ch.inv.remove('charbon', n); ch.inv.add('lingot de fer', n); ch.practice('artisanat', 2 * n);
          this.lootFeed.push({ text: `+ ${n > 1 ? n + ' ' : ''}Lingot de fer`, color: 0xe8e8e0, t: performance.now() });
          this.events.emit('message', { text: `Le minerai fond dans le creuset : ${n} lingot${n > 1 ? 's' : ''} de fer.` });
          this.audio.clang({ x: pr.x, y: pr.y + 1, z: pr.z });
          break;
        }
        const n = ch.inv.count('viande crue');
        if (n) { ch.inv.remove('viande crue', n); ch.inv.add('viande grillée', n); ch.practice('artisanat', n); this.events.emit('message', { text: `Vous faites griller ${n} morceau(x) de viande.` }); }
        break;
      }
      case 'enclume':
        if ((ch.inv.count('bois') || ch.inv.count('branche')) && ch.inv.count('lingot de fer')) {
          ch.inv.remove(ch.inv.count('branche') ? 'branche' : 'bois'); ch.inv.remove('lingot de fer');
          const n = 8 + Math.floor(ch.skills.artisanat / 10);
          ch.inv.add('flèche', n); ch.practice('artisanat', 3);
          this.events.emit('message', { text: `Vous forgez ${n} pointes et montez autant de flèches.` });
        } else this.events.emit('message', { text: 'Il faut une bûche (ou des branches) et un lingot de fer.' });
        break;
      case 'établi':
        if (ch.inv.count('herbe médicinale') >= 2 || (ch.inv.count('herbe médicinale') && ch.inv.count('écorce'))) {
          if (ch.inv.count('écorce') && ch.inv.count('herbe médicinale') < 2) { ch.inv.remove('écorce'); ch.inv.remove('herbe médicinale'); } else ch.inv.remove('herbe médicinale', 2);
          ch.inv.add('potion de soin'); ch.practice('artisanat', 3);
          this.events.emit('message', { text: 'Vous broyez les herbes et préparez une potion de soin.' });
        } else this.events.emit('message', { text: 'Il faut deux herbes médicinales (ou une herbe et de l’écorce).' });
        break;
      case 'piège':
        if (ch.skills.furtivité >= 15 || ch.stats.AGI >= 7) { this.setFlag(pr.key, true); ch.practice('furtivité', 3); this.events.emit('message', { text: 'Piège désamorcé.' }); }
        else this.events.emit('message', { text: 'Le mécanisme est trop délicat pour vous (Furtivité 15 requise).' });
        break;
    }
  }

  /** Fouille d'un contenant : butin, objets de quête, vol devant témoins. */
  private openContainer(pr: Prop): void {
    const ch = this.character;
    this.state.opened.add(pr.key);
    let building = this.buildingKind(pr), questItem: string | null = null, depth = 0;
    if (pr.key.startsWith('dj') && this.dungeon) {
      const c = this.dungeon.layout.chests.find((x) => x.key === pr.key);
      building = `coffre${c?.tier ?? 1}`; depth = this.world.civ.dungeons[this.dungeon.layout.id]?.depth ?? 1;
      if (c?.hasKey) questItem = this.dungeon.layout.keyItem;
      if (c && c.tier >= 3) { const k = this.dungeon.layout.kind; if (k === 'crypte') questItem = `quête:relique:${this.dungeon.layout.id}`; if (k === 'forteresse') questItem = `quête:journal:${this.dungeon.layout.id}`; }
    }
    if (building === 'camp' && !this.state.flags.get(`marchandises:${pr.sid}`)) { questItem = `quête:marchandises:${pr.sid}`; this.state.flags.set(`marchandises:${pr.sid}`, true); }
    this.giveLoot(containerLoot(this.seed, pr.key, { building, depth, questItem }), pr.kind === 'coffre' ? 'Coffre' : pr.kind === 'tonneau' ? 'Tonneau' : 'Caisse');
    if (this.isOwned(pr)) {
      const w = this.witnesses(this.theftNoise());
      this.events.emit('player:crime', { type: 'vol', settlementId: pr.sid, factionId: this.world.civ.settlements[pr.sid]?.factionId, witnesses: w.map((x) => x.id), value: 10 });
      if (w.length) this.events.emit('message', { text: `${w[0].label} vous a vu voler !`, color: 0xe05040 });
      else ch.practice('furtivité', 2);
    }
  }

  /** Coup dans le vide : un arbre (hache) ou un rocher (pioche) devant soi se récolte. */
  private harvest(heavy: boolean): void {
    const p = this.player, wk = this.character.weapon?.weapon?.kind;
    const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
    let node = null as (ReturnType<typeof this.world.chunks.nodesNear>[number]) | null, bd = Infinity;
    for (const n of this.world.chunks.nodesNear(p.x, p.z, 4)) {
      const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
      const reach = n.kind === 'arbre' ? 2.4 : 1.8 + n.size * 0.8;
      if (d > reach || (d > 0.5 && (dx * fx + dz * fz) / d < 0.55) || Math.abs(n.y - p.y) > 2.5 || d >= bd) continue;
      node = n; bd = d;
    }
    if (!node || this.dungeon) return;
    const pos = { x: node.x, y: node.y + 1, z: node.z };
    const tree = node.kind === 'arbre';
    if (tree ? wk !== 'hache' : wk !== 'pioche') {
      if (tree) this.audio.chop(pos); else this.audio.mine(pos);
      if (this.elapsed - this.harvestMsgT > 4) { this.harvestMsgT = this.elapsed; this.events.emit('message', { text: tree ? 'Il faudrait une hache pour couper ce bois (le forgeron en vend).' : 'Il faudrait une pioche pour briser cette roche (le forgeron en vend).', color: 0x9a9a90 }); }
      return;
    }
    if (tree) this.audio.chop(pos); else this.audio.mine(pos);
    this.character.practice('artisanat', 0.4);
    const need = tree ? 4 : 2 + Math.round(node.size * 1.5);
    const hits = (this.nodeHits.get(node.id) ?? 0) + (heavy ? 2 : 1);
    const r = Math.random, ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    if (hits < need) {
      this.nodeHits.set(node.id, hits);
      if (r() < 0.25) this.giveLoot([tree ? { id: r() < 0.6 ? 'branche' : 'écorce', qty: 1 } : { id: 'pierre', qty: 1 }], tree ? 'Copeaux' : 'Éclats');
      return;
    }
    this.nodeHits.delete(node.id);
    const biome = this.world.sampler.biomeAt(node.x, node.z), high = biome === B.MOUNTAIN || biome === B.SNOW;
    const lines: { id: string; qty: number }[] = [];
    if (tree) {
      lines.push({ id: 'bois', qty: ri(2, 4) }, { id: 'branche', qty: ri(1, 3) });
      if (r() < 0.7) lines.push({ id: 'écorce', qty: ri(1, 2) });
      this.audio.timber(pos);
    } else {
      lines.push({ id: 'pierre', qty: ri(1, 3) + Math.round(node.size) });
      if (r() < (high ? 0.6 : 0.35)) lines.push({ id: 'minerai de fer', qty: ri(1, 2) });
      if (r() < 0.3) lines.push({ id: 'charbon', qty: ri(1, 2) });
      if (r() < (high ? 0.08 : 0.04)) lines.push({ id: 'pépite d’or', qty: 1 });
      if (r() < (high ? 0.06 : 0.02)) lines.push({ id: 'gemme brute', qty: 1 });
    }
    this.giveLoot(lines, tree ? 'L’arbre s’abat' : 'La roche se fend');
    this.world.chunks.removeNode(node.id);
    this.coop?.fact('node:' + node.id, 1);
  }

  /** Sorts de bonus. */
  private castBonus(id: string): void {
    if (id === 'bouclier de mana') { this.addBuff({ id: 'bouclier', name: 'Bouclier de mana', t: 60, armor: 6 }); this.tintFlash = { c: [0.5, 0.6, 1], t: 0.6 }; this.events.emit('message', { text: 'Une aura bleutée vous enveloppe (armure +6).', color: 0x7a9ae8 }); }
    else if (id === 'lumière') { this.addBuff({ id: 'lumière', name: 'Lumière', t: 120 }); this.events.emit('message', { text: 'Un globe de lumière s’allume au-dessus de vous.', color: 0xf0e0a0 }); }
    else if (id === 'pas feutrés') { this.addBuff({ id: 'feutré', name: 'Pas feutrés', t: 45 }); this.events.emit('message', { text: 'Vos pas deviennent silencieux.', color: 0x9a9ab0 }); }
    this.audio.chime();
  }

  /** La cible a-t-elle repéré le joueur ? (créature en chasse ou alertée, PNJ hostile ou qui le voit) */
  aware(e: Entity): boolean {
    const p = this.player;
    if (e.mon) return e.mon.alerted || e.mon.targetId === 'player' || e.mon.state === 'chasse';
    if (e.hostile) return true;
    return perceives(this.world.chunks, { x: e.x, z: e.z, y: e.y, heading: e.heading, range: 22, nocturnal: false, asleep: e.action === 'dormir' },
      { x: p.x, z: p.z, y: p.y, stealth: p.crouch ? Math.max(0.35, this.character.stealth()) : 0, noise: playerNoise(p) }, { night: this.atmoNight, fog: this.fog() });
  }

  /** Attaque sournoise : accroupi, sur une cible qui ne vous a pas repéré → ×3 au corps à corps, ×2 à distance. */
  private sneakMult(e: Entity, ranged: boolean): number {
    if (!this.player.crouch || !e.alive || this.aware(e)) return 1;
    return ranged ? 2 : 3;
  }

  /** Vol à la tire : réussite selon la furtivité et l'agilité ; un échec est un délit. */
  private pickpocket(e: Entity): void {
    const n = e.npc!, ch = this.character, key = `poche:${n.id}`;
    if (this.state.flags.get(key) as unknown === this.time.day) { this.events.emit('message', { text: `Les poches de ${n.first} sont vides pour aujourd'hui.`, color: 0x9a9a90 }); return; }
    this.state.flags.set(key, this.time.day as unknown as boolean);
    const chance = Math.min(0.9, 0.45 + ch.skills.furtivité * 0.006 + (ch.stats.AGI - 5) * 0.03);
    if (Math.random() < chance) {
      const gold = Math.min(n.wealth, 3 + Math.floor(Math.random() * 16));
      n.wealth -= gold;
      const pools: Record<string, string[]> = {
        forgeron: ['lingot de fer', 'charbon'], aubergiste: ['pain', 'bière'], marchand: ['pomme', 'sel', 'fromage'],
        prêtre: ['potion de soin', 'parchemin : lumière'], guérisseuse: ['herbe médicinale', 'potion de soin'], garde: ['flèche', 'pain'],
        chasseur: ['flèche', 'viande crue'], fermier: ['pomme', 'pain'], mineur: ['charbon', 'minerai de fer'],
      };
      const lines: { id: string; qty: number }[] = [];
      if (gold > 0) lines.push({ id: 'or', qty: gold });
      if (Math.random() < 0.55) { const pool = pools[n.profession] ?? ['pain', 'pomme', 'herbe médicinale']; const id = pool[Math.floor(Math.random() * pool.length)]; lines.push({ id, qty: id === 'flèche' ? 5 : 1 }); }
      ch.practice('furtivité', 4);
      this.giveLoot(lines, `Poche de ${n.first}`);
      return;
    }
    // pris la main dans le sac
    e.hostile = true; e.thinkT = 0;
    const w = this.witnesses();
    this.events.emit('message', { text: `${n.first} ${n.last} vous surprend la main dans sa poche !`, color: 0xe05040 });
    this.events.emit('player:crime', { type: 'vol', settlementId: n.sid, factionId: n.factionId, witnesses: [...new Set([e.id, ...w.map((x) => x.id)])], value: 10 });
    this.alertGuards(n.sid);
  }

  /** Ajoute (ou renouvelle) un bonus temporaire. */
  addBuff(b: Buff): void {
    const i = this.buffs.findIndex((x) => x.id === b.id);
    if (i >= 0) this.buffs[i] = b; else this.buffs.push(b);
  }

  private updateBuffs(dt: number) {
    const p = this.player, ch = this.character;
    let dmg = 0, armor = 0, regen = 0, stam = 0;
    for (const b of this.buffs) { b.t -= dt; dmg += b.dmg ?? 0; armor += b.armor ?? 0; regen += b.regen ?? 0; stam += b.stam ?? 0; }
    this.buffs = this.buffs.filter((b) => b.t > 0);
    ch.bonusDmg = dmg; ch.bonusArmor = armor; p.staminaRegen = 1 + stam;
    p.quiet = this.buffs.some((b) => b.id === 'feutré');
    if (regen > 0 && !p.dead) p.hp = Math.min(p.maxHp, p.hp + regen * dt);
    if (this.tintFlash && (this.tintFlash.t -= dt) <= 0) this.tintFlash = null;
  }

  /** Drapeau du monde ; en ligne, partagé avec le salon (porte de donjon, piège désamorcé). */
  setFlag(key: string, v: boolean): void {
    this.state.flags.set(key, v);
    this.coop?.fact('flag:' + key, v);
  }

  /** T : commerce direct avec le PNJ visé (s'il a des marchandises et accepte de traiter). */
  tradeWithFocus(): void {
    const f = this.focus;
    if (f?.t !== 'entity' || !f.e.alive || !f.e.npc || !this.stockOf(f.e).length) return;
    if (this.rep.mood(f.e.npc) === 'hostile') { this.events.emit('message', { text: `${f.e.label} refuse de traiter avec vous.`, color: 0xe05040 }); return; }
    f.e.talkT = 6;
    this.ui?.openTrade(f.e);
  }

  talkTo(e: Entity): void {
    e.talkT = 60;
    const node = this.dialogue.start(e);
    if (this.ui) this.ui.openDialogue(node, () => { e.talkT = 2; });
  }

  sleep(): void {
    const t = this.time, p = this.player;
    const h = t.hour;
    const wake = h >= 18 || h < 6 ? ((24 + 7 - h) % 24) * 60 : 3 * 60;
    if (this.coop) {
      p.hp = p.maxHp; p.stamina = p.maxStamina; p.mana = p.maxMana;
      this.addBuff({ id: 'reposé', name: 'Reposé', t: 600, stam: 0.3, dmg: 0.05 });
      this.events.emit('message', { text: 'Vous vous reposez un moment. (En ligne, le temps ne s’arrête pour personne.)', color: 0x9ad0ff });
      return;
    }
    t.minutes += wake;
    this.addBuff({ id: 'reposé', name: 'Reposé', t: 600, stam: 0.3, dmg: 0.05 });
    p.hp = p.maxHp; p.stamina = p.maxStamina; p.mana = p.maxMana;
    this.events.emit('message', { text: `Vous dormez. ${t.label()}.`, color: 0x9ad0ff });
  }

  // ------------------------------------------------------------------ donjons
  enterDungeon(id: number): void {
    const d = this.world.civ.dungeons[id];
    if (!d || this.dungeon) return;
    const layout = generateDungeon(this.seed, d);
    const built = buildDungeon(layout);
    const p = this.player;
    this.dungeon = { layout, mesh: this.renderer.createMesh(built.mesh), data: built.data, ret: { x: p.x, z: p.z, heading: p.heading + Math.PI } };
    this.world.chunks.overlays = [built.data];
    this.applyDoor();
    this.entities.clear();
    this.entities.spawnDungeon(layout);
    p.bounded = false;
    p.x = layout.entrance.x; p.z = layout.entrance.z; p.y = 0.05; p.vx = p.vz = p.vy = 0;
    p.heading = 0;
    this.events.emit('message', { text: `Vous descendez dans ${d.name}.` });
  }

  exitDungeon(): void {
    const dg = this.dungeon;
    if (!dg) return;
    this.renderer.deleteMesh(dg.mesh);
    this.world.chunks.overlays = [];
    this.entities.clearDungeon();
    const p = this.player;
    p.bounded = true;
    p.x = dg.ret.x; p.z = dg.ret.z; p.heading = dg.ret.heading; p.vx = p.vz = p.vy = 0;
    this.dungeon = null;
    this.world.chunks.update(p.x, p.z, -1);
    p.y = this.world.heightAt(p.x, p.z) + 0.1;
  }

  /** Collision de la porte verrouillée (retirée quand elle est ouverte). */
  applyDoor(): void {
    const dg = this.dungeon;
    if (!dg || !dg.layout.lockedDoor) return;
    const d = dg.layout.lockedDoor, segs = dg.data.segs;
    const i = segs.findIndex((s) => (s as any).door);
    if (i >= 0) segs.splice(i, 1);
    if (this.state.flags.get(`door:dj${dg.layout.id}`)) return;
    const s = d.horizontal ? { ax: d.x, az: d.z - 1.8, bx: d.x, bz: d.z + 1.8 } : { ax: d.x - 1.8, az: d.z, bx: d.x + 1.8, bz: d.z };
    segs.push(Object.assign({ ...s, r: 0.3, bottom: -1, top: 5 }, { door: true }));
  }

  // ------------------------------------------------------------------ boucle
  update(dt: number, input: Input): void {
    this.elapsed += dt;
    if (this.coop) this.time.minutes = this.coop.clockMinutes(); else this.time.advance(dt);
    if (this.time.day !== this.lastDay) { this.lastDay = this.time.day; this.entities.dailyTick(); this.economy.dailyTick(); this.rumors.dailyTick(); this.stocks.clear(); }
    // météo au point du joueur
    const prevState = this.wx.state;
    this.wx = this.weatherSys.at(this.player.x, this.player.z, this.time.minutes);
    if (this.weatherOverride) this.wx = this.weatherSys.forced(this.weatherOverride, this.time.minutes);
    if (this.wx.state !== prevState && !this.dungeon) {
      const msg: Record<string, string> = { pluie: 'Il se met à pleuvoir.', orage: 'Le ciel gronde : un orage éclate.', neige: 'La neige commence à tomber.', brouillard: 'Un brouillard épais se lève.', couvert: 'Le ciel se couvre.', clair: 'Le temps se dégage.' };
      this.events.emit('weather:changed', { region: 0, state: this.wx.state });
      this.events.emit('message', { text: msg[this.wx.state], color: 0x9ab0c8 });
    }
    const wetTarget = this.dungeon ? 0 : Math.min(1, this.rain() * 1.4);
    this.wetness += (wetTarget - this.wetness) * Math.min(1, dt * (wetTarget > this.wetness ? 0.08 : 0.015));
    this.updateBuffs(dt);
    if (this.character.level !== this.lastLevel) {
      const gained = this.character.level - this.lastLevel;
      this.lastLevel = this.character.level;
      if (gained > 0) {
        this.syncStats(true);
        this.banner = { text: `NIVEAU ${this.character.level}`, sub: `PV, endurance, mana et dégâts augmentent · +${gained} point${gained > 1 ? 's' : ''} à dépenser (touche P)`, t: 5 };
        this.tintFlash = { c: [1, 0.9, 0.5], t: 0.8 };
        this.audio.chime();
        this.events.emit('message', { text: `Niveau ${this.character.level} ! Appuyez sur P pour dépenser vos points de caractéristique.`, color: 0xf0d060 });
      }
    }
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;
    this.questT -= dt;
    if (this.questT <= 0) { this.questT = 1; this.quests.tick(); }
    const p = this.player;
    this.syncStats();
    if (p.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
    } else {
      p.look(input, 0.0022 * this.sensitivity);
      p.blocking = input.locked && input.mouseDown(2) && p.stamina > 0;
      const over = this.character.inv.weight() > this.character.carryMax();
      p.update(dt, input, this.world, over ? 0.55 : 1);
      p.tickStatus(dt);
      if (this.god) { p.hp = p.maxHp; p.dead = false; p.stamina = p.maxStamina; p.mana = p.maxMana; }
      if (p.dead) this.onPlayerDeath();
      if (p.lastFall > 13) {
        const fall = Math.round((p.lastFall - 13) * 6);
        p.hp -= fall; p.hurt = Math.min(1, 0.4 + fall / 30); p.hitAmount = fall; p.hitT = 1; p.hitDir = null;
        this.events.emit('message', { text: 'Chute douloureuse.', color: 0xe05040 });
        if (p.hp <= 0) { p.hp = 0; p.dead = true; this.onPlayerDeath(); }
      }
      this.fight.update(dt, input, {
        player: p, character: this.character, events: this.events, combat: this.combat, entities: this.entities.entities,
        heightAt: (x, z) => (this.dungeon ? 0 : this.world.heightAt(x, z)), onHit: (e) => this.onHit(e), harvest: (heavy) => this.harvest(heavy), castBonus: (id) => this.castBonus(id), sneak: (e, ranged) => this.sneakMult(e, ranged),
      });
      // nage : l'endurance s'épuise (plus vite en plongée) ; à bout de souffle, on se noie
      if (p.swimming) p.stamina = Math.max(0, p.stamina - 2.5 * dt);
      const headUnder = !this.dungeon && !Number.isNaN(p.water) && p.eyeY < p.water - 0.05;
      if (headUnder) {
        p.breath = Math.max(0, p.breath - dt / 20);
        if (p.breath <= 0 && !this.god) {
          p.hp -= 8 * dt; p.hurt = Math.max(p.hurt, 0.3);
          if (this.elapsed - this.drownMsgT > 4) { this.drownMsgT = this.elapsed; this.events.emit('message', { text: 'Plus d\'air ! Remontez (Espace) ou vous allez vous noyer.', color: 0xe05040 }); }
          if (p.hp <= 0) { p.hp = 0; p.dead = true; this.onPlayerDeath(); }
        }
      } else p.breath = Math.min(1, p.breath + dt / 3);
      if (input.key('h') && this.character.inv.count('potion de soin')) this.useItem('potion de soin');
      if (input.key('b')) this.swapBow();
      this.checkTraps();
      this.sounds(dt);
    }
    if (!this.dungeon) this.world.chunks.update(p.x, p.z, 5);
    this.entities.update(dt);
    this.coop?.update(dt);
    this.focus = p.dead ? null : this.findFocus();
    if (input.key('e')) this.interact();
    if (input.key('t')) this.tradeWithFocus();
    // découverte des lieux et brouillard de la carte
    this.discoverT -= dt;
    if (this.discoverT <= 0 && !this.dungeon) {
      this.discoverT = 1;
      this.state.explore(p.x, p.z);
      const civ = this.world.civ;
      for (const s of civ.settlements) this.discover(`settlement:${s.id}`, s.name, s.x, s.z, s.radius + 60);
      for (const poi of civ.pois) if (poi.kind !== 'pont') this.discover(`poi:${poi.id}`, poi.name, poi.x, poi.z, 70);
    }
  }

  private discover(key: string, name: string, x: number, z: number, r: number) {
    if (this.state.discovered.has(key) || Math.hypot(x - this.player.x, z - this.player.z) > r) return;
    this.state.discovered.add(key);
    this.events.emit('place:discovered', { placeId: key });
    this.events.emit('message', { text: `Lieu découvert : ${name}`, color: 0x60d0e0 });
    this.character.gainXp(5);
  }

  private surfaceUnder(): Surface {
    const p = this.player;
    if (p.swimming) return 'eau';
    if (this.dungeon) return 'pierre';
    if (p.y > this.world.heightAt(p.x, p.z) + 0.15) return 'bois';
    const s = this.world.sampler.sample(p.x, p.z);
    return s.road ? 'pierre' : s.mat === M.SNOW ? 'neige' : s.mat === M.ROCK ? 'pierre' : 'herbe';
  }

  /** Thème musical selon la situation : combat, donjon, village, nuit, exploration. */
  private musicMood(dt: number): Mood {
    const p = this.player;
    if (p.dead) return 'silence';
    const near = this.watchers().hunters.some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 45);
    if (near || p.hp < this.lastHp - 0.5) this.combatT = 7;
    this.combatT -= dt;
    if (this.combatT > 0) return 'combat';
    if (this.dungeon) return 'donjon';
    const here = this.world.civ.settlements.some((s) => !s.abandoned && s.type !== 'camp' && Math.hypot(s.x - p.x, s.z - p.z) < s.radius + 25);
    if (here && this.atmoNight < 0.5) return 'village';
    if (this.atmoNight > 0.55) return 'nuit';
    return 'exploration';
  }

  /** Sons du monde autour du joueur : cris des créatures, forge, hurlements, eau, oiseaux, grillons, village. */
  private worldSounds(dt: number) {
    const p = this.player, a = this.audio, c = this.camera;
    a.listener(c.x, c.y, c.z, p.heading);
    a.setUnderwater(!this.dungeon && !Number.isNaN(p.water) && c.y < p.water - 0.05);
    a.mood(this.musicMood(dt));
    // créatures et PNJ proches : alerte, attaque, mort (à leur position)
    const seen = new Set<string>();
    for (const e of this.entities.entities) {
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d > 55) continue;
      seen.add(e.id);
      const pos = { x: e.x, y: e.y + 1, z: e.z };
      const prev = this.heard.get(e.id) ?? { target: false, swing: 0, alive: e.alive };
      if (e.mon) {
        const target = !!e.mon.targetId;
        if (target && !prev.target && e.alive) a.creature(e.type, 'alerte', pos);
        if (e.alive && e.pose.swing > 0.55 && prev.swing <= 0.55) a.creature(e.type, 'attaque', pos);
        if (!e.alive && prev.alive) a.creature(e.type, 'mort', pos);
        prev.target = target;
      } else if (e.npc?.profession === 'forgeron' && e.action === 'travailler' && e.alive && d < 45) {
        // marteau sur l'enclume, au sommet du geste
        if (e.pose.swing > 0.85 && !this.clanged.has(e)) { this.clanged.add(e); a.clang(pos); }
        if (e.pose.swing < 0.3) this.clanged.delete(e);
      } else if (e.npc && e.alive && e.pose.swing > 0.55 && prev.swing <= 0.55 && e.action === 'combattre') a.swing(pos);
      prev.swing = e.pose.swing; prev.alive = e.alive;
      this.heard.set(e.id, prev);
    }
    for (const k of this.heard.keys()) if (!seen.has(k)) this.heard.delete(k);
    // la nuit, un loup hurle quelque part
    if ((this.howlT -= dt) <= 0) {
      this.howlT = 25 + Math.random() * 45;
      if (!this.dungeon && this.atmoNight > 0.5) {
        const l = this.entities.lairs.find((x) => x.type === 'loup' && x.alive > 0 && Math.hypot(x.x - p.x, x.z - p.z) < 600);
        if (l) a.howl({ x: l.x, y: this.world.heightAt(l.x, l.z) + 2, z: l.z });
      }
    }
    // eau la plus proche (rivière, lac, mer), cherchée deux fois par seconde
    if ((this.waterT -= dt) <= 0 && !this.dungeon) {
      this.waterT = 0.5;
      let best: { x: number; z: number; d: number; w: number } | null = null;
      for (const r of [0, 6, 14, 26]) for (let i = 0; i < (r ? 12 : 1); i++) {
        const an = (i / 12) * Math.PI * 2, x = p.x + Math.cos(an) * r, z = p.z + Math.sin(an) * r;
        const w = this.world.waterAt(x, z);
        if (!Number.isNaN(w) && w > this.world.heightAt(x, z) + 0.1 && (!best || r < best.d)) best = { x, z, d: r, w };
        if (best && r > 0) break;
      }
      const cell = best ? this.world.macro.cellOf(best.x, best.z) : -1;
      const wk = cell >= 0 ? this.world.macro.hydro.water[cell] : 0;
      this.waterNear = best ? { p: { x: best.x, y: best.w, z: best.z }, kind: wk === W_SEA ? 'mer' : wk === W_LAKE ? 'lac' : 'rivière' } : { p: null, kind: null };
    }
    const biome = this.world.sampler.biomeAt(p.x, p.z);
    const forest = biome === B.FOREST || biome === B.TAIGA ? 1 : biome === B.SWAMP ? 0.6 : biome === B.PLAINS || biome === B.HEATH ? 0.3 : 0.1;
    let crowd = 0;
    for (const e of this.entities.entities) if (e.npc && e.alive && e.action !== 'dormir' && Math.hypot(e.x - p.x, e.z - p.z) < 35) crowd++;
    return { x: p.x, y: p.y + 1.5, z: p.z, day: 1 - this.atmoNight, rain: this.rain(), outdoor: !this.dungeon && !p.underRoof, forest, crowd: Math.min(1, crowd / 8), water: this.dungeon ? null : this.waterNear.p, waterKind: this.dungeon ? null : this.waterNear.kind };
  }

  private sounds(dt: number) {
    const p = this.player, a = this.audio;
    const amb = this.worldSounds(dt);
    if (p.swimming && p.moving) { this.swimT -= dt; if (this.swimT <= 0) { this.swimT = 0.75; a.splash(0.6); } }
    if (p.onGround && p.moving) {
      this.stepDist += Math.hypot(p.vx, p.vz) * dt;
      if (this.stepDist > (p.sprinting ? 2.2 : 1.6)) { this.stepDist = 0; a.step(this.surfaceUnder()); }
    }
    if (p.hp < this.lastHp - 0.5) a.hurt();
    this.lastHp = p.hp;
    if (this.wx.flash > 0.5 && this.lastFlash <= 0.5) setTimeout(() => a.thunder(), 600);
    this.lastFlash = this.wx.flash;
    let fire = 0;
    for (const l of this.world.chunks.lightsNear(p.x, p.z, 8)) if (l.kind === 'fire') fire = Math.max(fire, 1 - Math.hypot(l.x - p.x, l.z - p.z) / 8);
    const cover = p.underRoof || this.dungeon ? 0.25 : 1;
    a.ambient((Math.hypot(this.wx.mix.windX, this.wx.mix.windZ) * 0.5 + Math.max(0, p.y - 120) / 300) * cover, this.rain() * cover, fire, this.elapsed, amb);
  }

  private checkTraps() {
    const p = this.player;
    if (!this.dungeon) return;
    for (const pr of this.dungeon.data.props) {
      if (pr.kind !== 'piège' || this.state.flags.get(pr.key)) continue;
      if (Math.hypot(pr.x - p.x, pr.z - p.z) < 0.9) {
        this.state.flags.set(pr.key, true);
        p.hp -= 15; p.hurt = 0.5;
        this.events.emit('message', { text: 'Des piques jaillissent du sol !', color: 0xe05040 });
        if (p.hp <= 0) { p.hp = 0; p.dead = true; this.onPlayerDeath(); }
      }
    }
  }

  /** Utiliser / consommer un objet de l'inventaire. */
  useItem(id: string): boolean {
    const d = item(id), ch = this.character, p = this.player;
    if (d.weapon || d.armor || d.shield) { ch.equipItem(id); this.events.emit('message', { text: `${ch.isEquipped(id) ? 'Équipé' : 'Rangé'} : ${d.name}` }); return true; }
    if (d.cat === 'parchemin') {
      const sid = id.replace('parchemin : ', '');
      if (ch.spells.includes(sid)) { this.events.emit('message', { text: 'Vous connaissez déjà ce sort.', color: 0x9a9a90 }); return false; }
      ch.inv.remove(id); ch.spells.push(sid);
      this.events.emit('message', { text: `Vous apprenez « ${d.name.replace('Parchemin : ', '')} ». Assignez-le à R ou F (Tab → Sorts).`, color: 0x60d0e0 });
      this.audio.chime();
      return true;
    }
    if (!d.use || !ch.inv.remove(id)) return false;
    if (d.use.hp) p.hp = Math.min(p.maxHp, p.hp + d.use.hp);
    if (d.use.stamina) p.stamina = Math.min(p.maxStamina, p.stamina + d.use.stamina);
    if (d.use.mana) p.mana = Math.min(p.maxMana, p.mana + d.use.mana);
    if (d.use.cure) p.poison = 0;
    if (d.cat === 'nourriture') this.addBuff(id === 'viande grillée' || id === 'ragoût' ? { id: 'rassasié', name: 'Rassasié', t: 300, regen: 0.6, stam: 0.2 } : { id: 'rassasié', name: 'Rassasié', t: 150, regen: 0.3 });
    this.events.emit('message', { text: `${d.cat === 'potion' ? 'Vous buvez' : 'Vous mangez'} : ${d.name}` });
    return true;
  }

  dropItem(id: string, qty = 1): void {
    const ch = this.character, p = this.player;
    if (!ch.inv.remove(id, qty)) return;
    if (ch.isEquipped(id) && !ch.inv.count(id)) for (const k of Object.keys(ch.equip) as (keyof typeof ch.equip)[]) if (ch.equip[k] === id) ch.equip[k] = null;
    this.state.drop(id, qty, p.x + Math.sin(p.heading) * 1.2, p.y, p.z - Math.cos(p.heading) * 1.2);
  }

  private swapBow() {
    const ch = this.character;
    const bow = ['arc long', 'arc court'].find((b) => ch.inv.count(b));
    if (!bow) return;
    if (ch.weapon?.weapon?.kind === 'arc') {
      const melee = [...ch.inv.items.keys()].find((k) => item(k).weapon && item(k).weapon!.kind !== 'arc');
      if (melee) ch.equipItem(melee); else ch.equip.arme = null;
    } else ch.equipItem(bow);
    this.events.emit('message', { text: `En main : ${ch.weapon?.name ?? 'poings'}` });
  }

  // ------------------------------------------------------------------ sauvegarde
  toSave(label = 'manuel'): SaveData {
    const p = this.player, ch = this.character, st = this.state;
    this.entities.syncLairs();
    const npcs: SaveData['npcs'] = [];
    for (const list of this.entities.allNpcData().values()) for (const n of list) {
      const e = this.entities.entities.find((x) => x.id === n.id);
      if (e) n.hp = e.alive ? e.hp : 0;
      npcs.push({ id: n.id, alive: n.alive, hp: n.hp, wealth: n.wealth, memories: n.memories });
    }
    return {
      format: 1, game: GAME_VERSION, generator: GENERATOR_VERSION, seed: this.seed.text, savedAt: Date.now(), label, time: this.time.minutes,
      player: { x: p.x, y: p.y, z: p.z, heading: p.heading, pitch: p.pitch, hp: p.hp, stamina: p.stamina, mana: p.mana, dungeon: this.dungeon ? this.dungeon.layout.id : -1, ret: this.dungeon ? this.dungeon.ret : null },
      character: { stats: { ...ch.stats }, skills: { ...ch.skills }, skillXp: { ...ch.skillXp }, level: ch.level, xp: ch.xp, statPoints: ch.statPoints, inv: [...ch.inv.items], gold: ch.inv.gold, equip: { ...ch.equip }, spells: [...ch.spells], spellR: ch.spellR, spellF: ch.spellF },
      state: { opened: [...st.opened], dropped: st.dropped, flags: [...st.flags], discovered: [...st.discovered], explored: packBits(st.explored) },
      npcs,
      rep: { global: this.rep.global, faction: [...this.rep.faction], local: [...this.rep.local], bounty: [...this.rep.bounty] },
      economy: [...this.economy.supply].map(([k, v]) => [k, { ...v }]),
      quests: this.quests.quests.filter((q) => q.status !== 'disponible').map((q) => ({ id: q.id, status: q.status, stage: q.stage, killed: q.data.killed ?? 0 })),
      rumors: this.rumors.list.map((r) => ({ text: r.text, origin: r.origin, day: r.day, reach: [...r.reach], tag: r.tag })),
      lairs: this.entities.lairs.map((l) => ({ key: l.key, alive: l.alive, leaderAlive: l.leaderAlive })),
      killed: [...this.entities.killed], clearedCamps: [...this.entities.clearedCamps],
      removed: [...this.world.chunks.removed],
    };
  }

  applySave(d: SaveData): void {
    if (this.dungeon) this.exitDungeon();
    this.entities.clear();
    const ch = this.character, st = this.state, p = this.player;
    this.time.minutes = d.time; this.lastDay = this.time.day;
    Object.assign(ch.stats, d.character.stats); Object.assign(ch.skills, d.character.skills); Object.assign(ch.skillXp, d.character.skillXp);
    ch.level = d.character.level; ch.xp = d.character.xp; ch.statPoints = d.character.statPoints;
    ch.inv.items.clear(); for (const [id, n] of d.character.inv) ch.inv.items.set(id, n);
    ch.inv.gold = d.character.gold; Object.assign(ch.equip, d.character.equip);
    if (d.character.spells) { ch.spells = [...d.character.spells]; ch.spellR = d.character.spellR ?? 'trait de feu'; ch.spellF = d.character.spellF ?? 'soin'; }
    st.opened.clear(); for (const k of d.state.opened) st.opened.add(k);
    st.dropped = d.state.dropped; st.flags.clear(); for (const [k, v] of d.state.flags) st.flags.set(k, v);
    st.discovered.clear(); for (const k of d.state.discovered) st.discovered.add(k);
    unpackBits(d.state.explored, st.explored);
    for (const s of d.npcs) { const n = this.entities.findNpc(s.id); if (n) { n.alive = s.alive; n.hp = s.hp; n.wealth = s.wealth; n.memories = s.memories; } }
    this.rep.global = d.rep.global; this.rep.faction = [...d.rep.faction];
    this.rep.local.clear(); for (const [k, v] of d.rep.local) this.rep.local.set(k, v);
    this.rep.bounty.clear(); for (const [k, v] of d.rep.bounty) this.rep.bounty.set(k, v);
    for (const [sid, rec] of d.economy) this.economy.supply.set(sid, rec as Record<Good, number>);
    for (const l of d.lairs) { const x = this.entities.lairs.find((y) => y.key === l.key); if (x) { x.alive = l.alive; x.leaderAlive = l.leaderAlive; } }
    this.entities.killed.clear(); for (const k of d.killed) this.entities.killed.add(k);
    this.entities.clearedCamps.clear(); for (const k of d.clearedCamps) this.entities.clearedCamps.add(k);
    this.economy.refreshBlocked();
    for (const id of d.removed ?? []) this.world.chunks.removeNode(id);
    for (const q of d.quests) this.quests.restore(q.id, q.status as 'active', q.stage, q.killed);
    this.rumors.list.length = 0;
    for (const r of d.rumors) this.rumors.list.push({ id: this.rumors.list.length, text: r.text, origin: r.origin, day: r.day, reach: new Set(r.reach), tag: r.tag });
    if (d.player.dungeon >= 0) {
      this.enterDungeon(d.player.dungeon);
      if (this.dungeon && d.player.ret) this.dungeon.ret = d.player.ret;
    } else this.world.chunks.update(d.player.x, d.player.z, -1);
    p.x = d.player.x; p.y = d.player.y; p.z = d.player.z; p.heading = d.player.heading; p.pitch = d.player.pitch;
    p.vx = p.vy = p.vz = 0; p.dead = false;
    this.syncStats();
    p.hp = d.player.hp; p.stamina = d.player.stamina; p.mana = d.player.mana;
    this.lastHp = p.hp;
  }

  render(viewMode = 0): void {
    viewMode = viewMode || this.viewMode;
    const p = this.player, c = this.camera, dg = this.dungeon;
    c.x = p.x; c.y = p.eyeY; c.z = p.z; c.heading = p.heading; c.pitch = p.pitch;
    // secousse quand on encaisse un coup
    if (p.hurt > 0) { const k = Math.min(1, p.hurt) * 0.035; c.heading += (Math.random() - 0.5) * k; c.pitch += (Math.random() - 0.5) * k; c.y += (Math.random() - 0.5) * k * 2; }
    const atmo = computeAtmosphere(dg ? 0 : this.time.hour, dg ? CLEAR_WEATHER : this.wx.mix, dg ? 1 : 0, dg ? 0 : this.wx.flash);
    if (p.underRoof) { atmo.rain = 0; atmo.snow = 0; }
    atmo.wet = dg ? 0 : this.wetness;
    this.atmoNight = dg ? 0.5 : atmo.night;
    if (dg) {
      atmo.sunColor = [0, 0, 0]; atmo.ambSky = [0.13, 0.115, 0.1]; atmo.ambGround = [0.08, 0.07, 0.06];
      atmo.fogColor = [0.012, 0.01, 0.01]; atmo.fogDensity = 0.03; atmo.shadows = false;
    }
    const items: DrawItem[] = [];
    if (dg) items.push({ mesh: dg.mesh });
    else {
      items.push({ mesh: this.far, clip: 1 });
      for (const g of this.world.chunks.gpuMeshes()) items.push({ mesh: g, clip: 2, shadow: true });
    }
    const lights: PointLight[] = [];
    const torchOn = dg ? 1 : Math.min(1, Math.max(0, (atmo.night - 0.12) / 0.35));
    const near = this.world.chunks.lightsNear(c.x, c.z, 90).map((l) => ({ l, d: Math.hypot(l.x - c.x, l.z - c.z) })).sort((a, b) => a.d - b.d);
    if (!dg) for (const l of this.entities.lanterns(atmo.night)) lights.push(l);
    for (const pr of this.fight.projectiles) { const l = projectileLook(pr.kind).light; if (l) lights.push({ x: pr.x, y: pr.y, z: pr.z, radius: 8, r: l[0], g: l[1], b: l[2] }); }
    if (this.coop) lights.push(...this.coop.lights());
    if (this.buffs.some((b) => b.id === 'lumière')) lights.unshift({ x: p.x, y: p.eyeY + 0.7, z: p.z, radius: 16, r: 1.5, g: 1.35, b: 1.05 });
    for (const { l } of near) {
      const k = (l.kind === 'torch' ? torchOn : 1) * (0.85 + 0.15 * Math.sin(this.elapsed * 11 + l.x * 3) * Math.sin(this.elapsed * 7 + l.z * 5));
      if (k < 0.02) continue;
      lights.push({ x: l.x, y: l.y, z: l.z, radius: l.radius, r: l.r * k, g: l.g * k, b: l.b * k });
      if (lights.length >= 24) break;
    }
    this.instances.reset();
    this.entities.render(this.instances, c.x, c.z, this.target && this.target.alive ? this.target.id : null);
    this.coop?.render(this.instances, c.x, c.z);
    if (dg && dg.layout.lockedDoor && !this.state.flags.get(`door:dj${dg.layout.id}`)) {
      const d = dg.layout.lockedDoor;
      this.instances.add(trsYawPitch(this.m4, d.x, 1.6, d.z, d.horizontal ? Math.PI / 2 : 0, 0, 3.4, 3.2, 0.3), 0x5a3a22, M.DOOR, 0, 0, 0.3);
    }
    for (const dr of this.state.dropped) {
      if (Math.hypot(dr.x - c.x, dr.z - c.z) > 60) continue;
      const y = dg ? 0 : this.world.heightAt(dr.x, dr.z);
      this.instances.add(trsYawPitch(this.m4, dr.x, y + 0.15, dr.z, 0, 0, 0.35, 0.25, 0.35), 0xffd860, M.ITEM, '*'.charCodeAt(0) - 31, 0, 1);
    }
    if (!p.dead) this.fight.render(this.instances, c, this.character, p.blocking);
    if (this.showChunks && !dg) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const x = (Math.floor(p.x / 64) + i) * 64, z = (Math.floor(p.z / 64) + j) * 64;
      this.instances.add(trsYawPitch(this.m4, x, this.world.heightAt(x, z) + 6, z, 0, 0, 0.3, 12, 0.3), 0xff40ff, M.GLOW, 0, 0, 1);
    }
    // sous l'eau : image bleutée et ondulante, brouillard épais ; en nageant, légère teinte
    const under = !dg && !Number.isNaN(p.water) && c.y < p.water - 0.05;
    let tint: [number, number, number, number] | undefined, wobble = 0;
    if (under) {
      tint = [0.16, 0.42, 0.62, 0.62]; wobble = 1;
      atmo.fogColor = [0.04, 0.16, 0.24]; atmo.fogDensity = 0.09; atmo.rain = 0; atmo.snow = 0;
    } else if (p.swimming) tint = [0.2, 0.5, 0.7, 0.16];
    else if (p.hurt > 0) tint = [0.9, 0.08, 0.05, Math.min(0.3, p.hurt * 0.4)];
    else if (this.tintFlash) tint = [...this.tintFlash.c, Math.min(0.35, this.tintFlash.t * 0.35)] as [number, number, number, number];
    this.renderer.render({ camera: c, atmo, time: this.elapsed, items, clipRadius: this.world.chunks.clipRadius, instances: this.instances, lights, viewMode, sceneOn: true, hurt: Math.max(0, p.hurt) * 2, tint, wobble });
  }
}
