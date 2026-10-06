import { WorldSeed } from './Seed';
import { GameTime } from './Time';
import { EventBus } from './Events';
import type { Input } from './Input';
import { World } from '../world/World';
import type { MacroWorld } from '../world/MacroWorld';
import type { Civilization } from '../world/civilization/Civilization';
import { buildFarTerrain } from '../world/FarTerrain';
import { generateDungeon, buildDungeon, type DungeonLayout } from '../world/dungeons/DungeonGenerator';
import type { ChunkData, Prop } from '../world/Chunk';
import { Player } from '../entities/Player';
import { EntityManager } from '../entities/EntityManager';
import type { Entity } from '../entities/Entity';
import { MONSTERS } from '../entities/Monster';
import { type CombatHost } from '../gameplay/Combat';
import { Character } from '../gameplay/Character';
import { PlayerCombat } from '../gameplay/PlayerCombat';
import { WorldState, type Dropped } from '../gameplay/WorldState';
import { item } from '../gameplay/Items';
import { creatureLoot, containerLoot, type LootLine } from '../gameplay/Loot';
import { perceives } from '../ai/Perception';
import { Reputation } from '../gameplay/Reputation';
import { Economy } from '../gameplay/Economy';
import { Rumors } from '../gameplay/Rumors';
import { QuestSystem } from '../gameplay/QuestSystem';
import { DialogueSystem, type DialogueNode } from '../gameplay/Dialogue';
import { Camera } from '../rendering/Camera';
import { Weather, type WeatherState } from '../gameplay/Weather';
import { AudioEngine, type Surface } from '../audio/AudioEngine';
import type { WeatherMix } from '../rendering/Atmosphere';
import { computeAtmosphere, CLEAR_WEATHER } from '../rendering/Atmosphere';
import { M } from '../rendering/Materials';
import { trsYawPitch, mat4 } from './math';
import { InstanceBuffer, type Renderer, type GpuMesh, type DrawItem, type PointLight } from '../rendering/Renderer';

interface ActiveDungeon { layout: DungeonLayout; mesh: GpuMesh; data: ChunkData; ret: { x: number; z: number; heading: number } }

/** Ce que le joueur vise : objet, personnage ou créature (vivante ou morte), objet au sol. */
export type Focus =
  | { t: 'prop'; prop: Prop; label: string }
  | { t: 'entity'; e: Entity; label: string }
  | { t: 'drop'; d: Dropped; label: string };

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
  /** sensibilité de la souris (options) */
  sensitivity = 1;
  /** libère les ressources GPU (retour au titre) */
  dispose(): void { this.world.chunks.clear(); this.renderer.deleteMesh(this.far); if (this.dungeon) this.renderer.deleteMesh(this.dungeon.mesh); }

  constructor(seedText: string, private renderer: Renderer, macro?: MacroWorld, civ?: Civilization) {
    this.seed = new WorldSeed(seedText);
    this.world = new World<GpuMesh>(this.seed, { upload: (m) => renderer.createMesh(m), release: (g) => renderer.deleteMesh(g) }, macro, civ);
    this.far = renderer.createMesh(buildFarTerrain(this.world.macro, (mb) => this.world.civWorld.landmarks(mb)));
    const sp = this.world.spawn();
    this.player.x = sp.x; this.player.z = sp.z; this.player.heading = sp.heading;
    this.world.chunks.update(sp.x, sp.z, -1);
    this.player.y = this.world.heightAt(sp.x, sp.z) + 0.1;
    this.combat = { player: this.player, events: this.events, onPlayerDeath: () => this.onPlayerDeath(), playerArmor: () => this.character.armor };
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
      const xp = ev.kind === 'monster' ? MONSTERS[ev.type]?.xp ?? 15 : 10;
      const ups = ch.gainXp(xp);
      this.events.emit('message', { text: `+${xp} XP`, color: 0xe8c050 });
      if (ups) { this.syncStats(true); this.events.emit('message', { text: `Niveau ${ch.level} ! Un point de caractéristique à répartir (écran C).`, color: 0xf0d060 }); }
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
    e.hostile = true;
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
    this.time.minutes += 8 * 60;
    this.respawnT = 0;
    this.events.emit('message', { text: `Vous vous réveillez à l'auberge, huit heures plus tard. Votre bourse est plus légère (−${lost} or).` });
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
      case 'âtre': case 'feu': case 'foyer': return this.character.inv.count('viande crue') ? 'Cuire la viande' : '';
      case 'enclume': return 'Forger des flèches (1 bûche + 1 lingot)';
      case 'établi': return 'Préparer une potion (2 herbes)';
      case 'piège': return this.state.flags.get(pr.key) ? '' : 'Désamorcer le piège';
      default: return '';
    }
  }

  private findFocus(): Focus | null {
    const p = this.player;
    const e = this.entities.pick(p.x, p.z, p.heading, 3.2, false);
    if (e) {
      if (e.alive && e.npc) return { t: 'entity', e, label: `Parler à ${e.label}` };
      if (!e.alive && !e.looted) return { t: 'entity', e, label: `Fouiller : ${e.npc ? e.label : e.name}` };
    }
    const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
    let best: Focus | null = null, bs = Infinity;
    for (const pr of this.world.chunks.propsNear(p.x, p.z, 3.2)) {
      const dx = pr.x - p.x, dz = pr.z - p.z, d = Math.hypot(dx, dz);
      const facing = d < 0.8 ? 1 : (dx * fx + dz * fz) / d;
      if (facing < 0.35 || Math.abs(pr.y - p.y) > 2.5) continue;
      const label = this.propLabel(pr);
      if (label && d - facing < bs) { bs = d - facing; best = { t: 'prop', prop: pr, label }; }
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
  }

  /** PNJ qui voient le joueur (témoins d'un délit). */
  witnesses(): Entity[] {
    const p = this.player, env = { night: this.atmoNight, fog: 0 };
    return this.entities.entities.filter((e) => e.npc && e.alive && Math.hypot(e.x - p.x, e.z - p.z) < 22
      && perceives(this.world.chunks, { x: e.x, z: e.z, y: e.y, heading: e.heading, range: 22, nocturnal: false, asleep: e.action === 'dormir' }, { x: p.x, z: p.z, y: p.y, stealth: p.crouch ? this.character.stealth() : 0, noise: 0 }, env));
  }

  interact(): void {
    const f = this.focus, ch = this.character, p = this.player;
    if (!f) return;
    if (f.t === 'entity') {
      const e = f.e;
      if (e.alive && e.npc) { this.talkTo(e); return; }
      if (!e.alive && !e.looted) {
        e.looted = true;
        const biome = this.world.sampler.biomeAt(e.x, e.z);
        const table = e.mon ? e.mon.loot : 'maison';
        this.giveLoot(creatureLoot(this.seed, table, `${e.id}:${this.time.day}`, { biome }), e.name);
      }
      return;
    }
    if (f.t === 'drop') {
      ch.inv.add(f.d.id, f.d.qty);
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
          this.state.flags.set(`door:dj${dg.layout.id}`, true);
          this.applyDoor();
          this.events.emit('message', { text: 'La clé tourne dans la serrure. La porte s’ouvre en grinçant.', color: 0xf0d060 });
        } else this.events.emit('message', { text: 'Verrouillée. Il doit y avoir une clé quelque part dans ces souterrains.' });
        break;
      }
      case 'coffre': case 'tonneau': case 'caisse': {
        if (this.state.opened.has(pr.key)) break;
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
          const w = this.witnesses();
          this.events.emit('player:crime', { type: 'vol', settlementId: pr.sid, factionId: this.world.civ.settlements[pr.sid]?.factionId, witnesses: w.map((x) => x.id), value: 10 });
          if (w.length) this.events.emit('message', { text: `${w[0].label} vous a vu voler !`, color: 0xe05040 });
          else ch.practice('furtivité', 2);
        }
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
      case 'autel': case 'sanctuaire':
        p.poison = 0; p.stamina = p.maxStamina;
        this.events.emit('message', { text: 'Vous priez un moment. Une paix étrange vous envahit.', color: 0xe8e0c0 });
        this.events.emit('player:helped', { npcId: 'ordre', magnitude: 0.01, reason: 'prière' });
        break;
      case 'puits': p.stamina = Math.min(p.maxStamina, p.stamina + 40); this.events.emit('message', { text: "L'eau est fraîche." }); break;
      case 'âtre': case 'feu': case 'foyer': {
        const n = ch.inv.count('viande crue');
        if (n) { ch.inv.remove('viande crue', n); ch.inv.add('viande grillée', n); ch.practice('artisanat', n); this.events.emit('message', { text: `Vous faites griller ${n} morceau(x) de viande.` }); }
        break;
      }
      case 'enclume':
        if (ch.inv.count('bois') && ch.inv.count('lingot de fer')) {
          ch.inv.remove('bois'); ch.inv.remove('lingot de fer');
          const n = 8 + Math.floor(ch.skills.artisanat / 10);
          ch.inv.add('flèche', n); ch.practice('artisanat', 3);
          this.events.emit('message', { text: `Vous forgez ${n} pointes et montez autant de flèches.` });
        } else this.events.emit('message', { text: 'Il faut une bûche et un lingot de fer.' });
        break;
      case 'établi':
        if (ch.inv.count('herbe médicinale') >= 2) {
          ch.inv.remove('herbe médicinale', 2); ch.inv.add('potion de soin'); ch.practice('artisanat', 3);
          this.events.emit('message', { text: 'Vous broyez les herbes et préparez une potion de soin.' });
        } else this.events.emit('message', { text: 'Il faut deux herbes médicinales.' });
        break;
      case 'piège':
        if (ch.skills.furtivité >= 15 || ch.stats.AGI >= 7) { this.state.flags.set(pr.key, true); ch.practice('furtivité', 3); this.events.emit('message', { text: 'Piège désamorcé.' }); }
        else this.events.emit('message', { text: 'Le mécanisme est trop délicat pour vous (Furtivité 15 requise).' });
        break;
    }
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
    t.minutes += wake;
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
    this.time.advance(dt);
    if (this.time.day !== this.lastDay) { this.lastDay = this.time.day; this.entities.dailyTick(); this.economy.dailyTick(); this.rumors.dailyTick(); this.stocks.clear(); }
    // météo au point du joueur
    const prevState = this.wx.state;
    this.wx = this.weatherSys.at(this.player.x, this.player.z, this.time.minutes);
    if (this.wx.state !== prevState && !this.dungeon) {
      const msg: Record<string, string> = { pluie: 'Il se met à pleuvoir.', orage: 'Le ciel gronde : un orage éclate.', neige: 'La neige commence à tomber.', brouillard: 'Un brouillard épais se lève.', couvert: 'Le ciel se couvre.', clair: 'Le temps se dégage.' };
      this.events.emit('weather:changed', { region: 0, state: this.wx.state });
      this.events.emit('message', { text: msg[this.wx.state], color: 0x9ab0c8 });
    }
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
      if (p.dead) this.onPlayerDeath();
      if (p.lastFall > 13) {
        p.hp -= Math.round((p.lastFall - 13) * 6);
        this.events.emit('message', { text: 'Chute douloureuse.', color: 0xe05040 });
        if (p.hp <= 0) { p.hp = 0; p.dead = true; this.onPlayerDeath(); }
      }
      this.fight.update(dt, input, {
        player: p, character: this.character, events: this.events, combat: this.combat, entities: this.entities.entities,
        heightAt: (x, z) => (this.dungeon ? 0 : this.world.heightAt(x, z)), onHit: (e) => this.onHit(e),
      });
      if (input.key('h') && this.character.inv.count('potion de soin')) this.useItem('potion de soin');
      if (input.key('b')) this.swapBow();
      this.checkTraps();
      this.sounds(dt);
    }
    if (!this.dungeon) this.world.chunks.update(p.x, p.z, 5);
    this.entities.update(dt);
    this.focus = p.dead ? null : this.findFocus();
    if (input.key('e')) this.interact();
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

  private sounds(dt: number) {
    const p = this.player, a = this.audio;
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
    a.ambient((Math.hypot(this.wx.mix.windX, this.wx.mix.windZ) * 0.5 + Math.max(0, p.y - 120) / 300) * cover, this.rain() * cover, fire, this.elapsed);
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
    if (!d.use || !ch.inv.remove(id)) return false;
    if (d.use.hp) p.hp = Math.min(p.maxHp, p.hp + d.use.hp);
    if (d.use.stamina) p.stamina = Math.min(p.maxStamina, p.stamina + d.use.stamina);
    if (d.use.mana) p.mana = Math.min(p.maxMana, p.mana + d.use.mana);
    if (d.use.cure) p.poison = 0;
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

  render(viewMode = 0): void {
    const p = this.player, c = this.camera, dg = this.dungeon;
    c.x = p.x; c.y = p.eyeY; c.z = p.z; c.heading = p.heading; c.pitch = p.pitch;
    const atmo = computeAtmosphere(dg ? 0 : this.time.hour, dg ? CLEAR_WEATHER : this.wx.mix, dg ? 1 : 0, dg ? 0 : this.wx.flash);
    if (p.underRoof) { atmo.rain = 0; atmo.snow = 0; }
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
    for (const pr of this.fight.projectiles) if (pr.kind === 'feu') lights.push({ x: pr.x, y: pr.y, z: pr.z, radius: 8, r: 2, g: 0.9, b: 0.3 });
    for (const { l } of near) {
      const k = (l.kind === 'torch' ? torchOn : 1) * (0.85 + 0.15 * Math.sin(this.elapsed * 11 + l.x * 3) * Math.sin(this.elapsed * 7 + l.z * 5));
      if (k < 0.02) continue;
      lights.push({ x: l.x, y: l.y, z: l.z, radius: l.radius, r: l.r * k, g: l.g * k, b: l.b * k });
      if (lights.length >= 24) break;
    }
    this.instances.reset();
    this.entities.render(this.instances, c.x, c.z, this.target && this.target.alive ? this.target.id : null);
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
    this.renderer.render({ camera: c, atmo, time: this.elapsed, items, clipRadius: this.world.chunks.clipRadius, instances: this.instances, lights, viewMode, sceneOn: true, hurt: Math.max(0, p.hurt) * 2 });
  }
}
