import type { Prop } from '@ascii-fort/worldgen/Chunk';
import type { Dungeon } from '@ascii-fort/worldgen/civilization/types';
import { generateDungeon, buildDungeon, type DungeonLayout } from '@ascii-fort/worldgen/dungeons/DungeonGenerator';
import { generateFloor, buildFloor, buildDescent, levelOneDescent, floorCount, besideStairs, dangerOf, type FloorLayout } from '@ascii-fort/worldgen/dungeons/Floors';
import { underCode } from '@ascii-fort/worldgen/dungeons/Under';
import { generateCave, buildCave, buildVeins, type CaveLayout } from '@ascii-fort/worldgen/caves/CaveInterior';
import { entrancePos, type CaveEntrance, type CaveNet } from '@ascii-fort/worldgen/caves/Caves';
import { dungeonLevel } from '@ascii-fort/sim/entities/Monster';
import { direction, distance } from '@ascii-fort/sim/gameplay/Dialogue';
import { lieu } from '@ascii-fort/sim/gameplay/Chains';
import type { MeshData } from '@ascii-fort/ascii-engine/Mesh';
import { C } from '@ascii-fort/ascii-engine/TextGrid';
import { M } from '@ascii-fort/ascii-engine/Materials';
import type { InstanceBuffer } from '@ascii-fort/ascii-engine/Renderer';
import { trsYawPitch } from '@ascii-fort/core/math';
import { hashString } from '@ascii-fort/core/RNG';
import type { Game } from './Game';

// Étape 55 (passe 2), côté jeu : étages inférieurs des donjons et réseaux de grottes. Le niveau 1 d'un donjon reste celui
// d'origine (Game.enterDungeon) ; on y ajoute seulement, si le donjon a plusieurs étages, une cage d'escalier dans une salle
// reculée. Escaliers (E), leviers et herse, champignons à cueillir, entrées et issues des grottes (on peut ressortir par une
// autre entrée du réseau), découvertes et carte, rumeurs, étage affiché, journal, sauvegarde et console.

/** Où l'on se trouve sous terre quand on n'est pas au niveau 1 d'un donjon (le niveau 1 garde l'ancien format). */
export interface UnderSave { k: 'étage' | 'grotte'; id: number; floor: number; x: number; y: number; z: number; heading: number; ret: { x: number; z: number; heading: number } }

const THEME_LINE: Record<FloorLayout['theme'], string> = {
  catacombes: 'des catacombes : des ossements à perte de vue',
  cachots: 'des cachots oubliés, où quelque chose gémit encore',
  galeries: 'des galeries abandonnées, étayées de bois pourri',
  'salles inondées': 'des salles inondées, où l’eau goutte sans fin',
  'grottes profondes': 'des grottes profondes, plus anciennes que le donjon',
};

export class Underground {
  private floorCache = new Map<string, FloorLayout>();
  private caveCache = new Map<number, CaveLayout>();
  private descents = new Map<number, ReturnType<typeof levelOneDescent>>();
  private counts = new Map<number, number>();
  private m4 = new Float32Array(16);
  private discoverT = 0;
  private veinsSeen = -1;
  /** levée de la herse (0 fermée … 1 levée), pour l'animation */
  private gateLift = 0;
  private lastDay = -1;
  /** rang de l'entrée par laquelle on est entré dans la grotte en cours */
  private enteredBy = 0;

  constructor(private g: Game) {
    this.seedRumors();
    g.events.on('entity:killed', (k) => this.onKilled(k.victimId));
  }

  /** pendant un chargement : pas de messages ni de bandeau d'arrivée */
  private silent = false;
  private say(text: string, color: number = C.text) { if (!this.silent) this.g.events.emit('message', { text, color }); }
  private get atlas() { return this.g.world.caves; }

  // ================================================================ donjons : étages
  /** Nombre d'étages d'un donjon (1 : il n'y a que le plan d'origine). */
  floors(d: Dungeon): number {
    let n = this.counts.get(d.id);
    if (n === undefined) { n = floorCount(this.g.world.civ, d); this.counts.set(d.id, n); }
    return n;
  }
  floorPlan(d: Dungeon, level: number): FloorLayout {
    const k = `${d.id}.${level}`;
    let F = this.floorCache.get(k);
    if (!F) { F = generateFloor(this.g.seed, d, level, this.floors(d)); this.floorCache.set(k, F); }
    return F;
  }
  /** Cage d'escalier du niveau 1 (null : un seul étage). */
  descent(d: Dungeon, L?: DungeonLayout): ReturnType<typeof levelOneDescent> | null {
    if (this.floors(d) < 2) return null;
    if (!this.descents.has(d.id)) this.descents.set(d.id, levelOneDescent(L ?? generateDungeon(this.g.seed, d)));
    return this.descents.get(d.id) ?? null;
  }
  /** Ajouts du niveau 1 (maillage et objets à part) : l'escalier vers le niveau 2. */
  levelOneExtras(d: Dungeon, L: DungeonLayout): { mesh: MeshData; data: ReturnType<typeof buildDescent>['data'] }[] {
    const ds = this.descent(d, L);
    return ds ? [buildDescent(L, ds)] : [];
  }

  /** Change d'étage dans le donjon actif (escalier, ou console). */
  goFloor(level: number): boolean {
    const g = this.g, dg = g.dungeon;
    if (!dg || dg.floor < 1) return false;
    const civ = g.world.civ, d = civ.dungeons[dg.layout.id];
    if (!d) return false;
    const n = this.floors(d);
    if (level < 1 || level > n || level === dg.floor) return false;
    const down = level > dg.floor, ret = dg.ret;
    if (level === 1) {
      const L1 = generateDungeon(g.seed, d), ds = this.descent(d, L1);
      if (!ds) return false;
      g.mountUnder({ layout: L1, built: buildDungeon(L1), extra: this.levelOneExtras(d, L1), floor: 1, code: d.id, zone: 'd' + d.id, prefix: 'dj' + d.id, level: dungeonLevel(civ, d), ret, at: besideStairs(ds) });
      this.say(`Vous remontez au niveau 1 ${lieu(d.name, 'de')}.`, C.cyan);
      return true;
    }
    const F = this.floorPlan(d, level);
    const at = down || !F.down ? F.entrance : besideStairs(F.down);
    g.mountUnder({ layout: F, built: buildFloor(F), floor: level, code: underCode(false, d.id, level), zone: `d${d.id}.${level}`, prefix: `dj${d.id}.${level}`, level: dungeonLevel(civ, d) + (level - 1), ret, at, floorPlan: F });
    this.gateLift = this.gateOpen() ? 1 : 0;
    const key = `étage:${d.id}:${level}`, first = !g.state.discovered.has(key);
    g.state.discovered.add(key);
    if (down) {
      this.say(`Vous descendez au niveau ${level} (sur ${n}) : ${THEME_LINE[F.theme]}.`, C.cyan);
      if (first && !this.silent) {
        g.banner = { text: `NIVEAU ${level} / ${n}`, sub: `${F.theme.charAt(0).toUpperCase() + F.theme.slice(1)} · créatures plus fortes, trésors plus riches`, t: 4.5, color: C.cyan };
        if (F.guardian) this.say(`On murmure qu’un gardien veille à cet étage : ${F.guardian}.`, C.magenta);
        if (F.gate) this.say('Une herse ferme une salle de cet étage. Le mécanisme doit être quelque part…', C.yellow);
        g.character.gainXp(10);
      }
    } else this.say(`Vous remontez au niveau ${level} (sur ${n}).`, C.cyan);
    return true;
  }

  // ================================================================ grottes
  cave(net: number): CaveLayout {
    let Cv = this.caveCache.get(net);
    if (!Cv) {
      const N = this.atlas.nets[net];
      Cv = generateCave(this.g.seed, N, dangerOf(this.g.world.civ, N.x, N.z));
      if (this.caveCache.size > 3) this.caveCache.delete(this.caveCache.keys().next().value as number);
      this.caveCache.set(net, Cv);
    }
    return Cv;
  }
  private netOf(key: string): { N: CaveNet; e: CaveEntrance } | null {
    const m = /^gr(\d+):[es](\d+)$/.exec(key);
    const N = m ? this.atlas.nets[Number(m[1])] : undefined, e = N?.entrances[Number(m![2])];
    return N && e ? { N, e } : null;
  }

  /** Entre dans une grotte par l'entrée k de son réseau. */
  enterCave(net: number, k: number): void {
    const g = this.g, N = this.atlas.nets[net], e = N?.entrances[k];
    if (!N || !e || g.dungeon) return;
    const p = g.player;
    let mo = this.atlas.mouth(e);
    // bouche pas encore calée (console, chargement) : on construit son chunk pour savoir où l'on ressortira
    if (!mo) { g.world.chunks.update(e.ax, e.az, -1); mo = this.atlas.mouth(e); }
    if (p.mounted) g.poss.dismount('Pas de cheval là-dedans : vous mettez pied à terre.', 0xf0d060);
    const Cv = this.cave(net);
    const ret = mo ? { x: mo.ox, z: mo.oz, heading: mo.heading } : { x: p.x, z: p.z, heading: p.heading + Math.PI };
    this.discoverEntrance(e, false);
    g.mountUnder({
      layout: Cv, built: buildCave(Cv), extra: [{ mesh: buildVeins(Cv, (id) => g.world.chunks.removed.has(id)), data: null }],
      floor: 0, code: underCode(true, net), zone: `gr${net}`, prefix: `gr${net}`, level: Cv.danger + (N.entrances.length > 1 ? 1 : 0), ret, at: Cv.exits[k].arrive, cave: Cv,
    });
    this.enteredBy = k;
    this.veinsSeen = g.world.chunks.removed.size;
    this.say(`Vous vous glissez ${lieu(N.name, 'dans')}.${N.entrances.length > 1 ? ` Un courant d’air : il y a d’autres issues (${N.entrances.length} en tout).` : ''}`, C.cyan);
  }

  /** Ressort de la grotte par l'issue k (devant l'entrée de surface correspondante). */
  exitCave(k: number): void {
    const g = this.g, dg = g.dungeon;
    if (!dg?.cave) return;
    const N = this.atlas.nets[dg.cave.id], e = N.entrances[k];
    if (!e) return;
    let mo = this.atlas.mouth(e);
    if (!mo) { g.world.chunks.update(e.ax, e.az, -1); mo = this.atlas.mouth(e); }
    if (mo) dg.ret = { x: mo.ox, z: mo.oz, heading: mo.heading };
    const back = k === this.enteredBy;
    g.exitDungeon();
    this.discoverEntrance(e, !back);
    this.say(back ? 'Vous retrouvez l’air libre.' : `Vous ressortez à l’air libre par une autre issue ${lieu(N.name, 'de')}.`, C.cyan);
  }

  private discoverEntrance(e: CaveEntrance, announce: boolean): void {
    const g = this.g, key = 'grotte:' + e.key;
    if (g.state.discovered.has(key)) return;
    g.state.discovered.add(key);
    if (announce) { g.events.emit('place:discovered', { placeId: key }); this.say(`Lieu découvert : ${this.atlas.nets[e.net].name}`, 0x60d0e0); g.character.gainXp(5); }
  }

  // ================================================================ objets interactifs (escaliers, entrées, issues, leviers…)
  private floorOfKey(key: string): number { const m = /^dj\d+\.(\d+):/.exec(key); return m ? Number(m[1]) : 1; }

  propLabel(pr: Prop): string {
    const g = this.g, dg = g.dungeon;
    switch (pr.kind) {
      case 'escalier': {
        if (!dg) return '';
        const d = g.world.civ.dungeons[dg.layout.id], n = d ? this.floors(d) : 1, here = this.floorOfKey(pr.key);
        return pr.key.endsWith(':descendre') ? `Descendre au niveau ${here + 1} (sur ${n})` : `Remonter au niveau ${here - 1}`;
      }
      case 'grotte': {
        const r = this.netOf(pr.key);
        if (!r) return '';
        return `${g.player.mounted ? 'Mettre pied à terre et entrer' : 'Entrer'} : ${r.N.name}`;
      }
      case 'issue': {
        const r = this.netOf(pr.key);
        if (!r) return '';
        if (r.N.entrances.length < 2) return 'Sortir à l’air libre';
        return `Sortir à l’air libre (issue ${direction(r.N.x, r.N.z, r.e.ax, r.e.az).replace(/^(au |à l')/, '')})`;
      }
      case 'levier': return g.state.flags.get('door:' + pr.key) ? '' : 'Actionner le levier';
      case 'herse': return this.gateOpen() ? '' : 'Herse fermée';
      case 'champignons': return g.state.flags.get('cueilli:' + pr.key) === (g.time.day as unknown) ? '' : 'Cueillir : champignons';
      default: return '';
    }
  }

  interact(pr: Prop): void {
    const g = this.g;
    switch (pr.kind) {
      case 'escalier': {
        const here = this.floorOfKey(pr.key);
        this.goFloor(pr.key.endsWith(':descendre') ? here + 1 : here - 1);
        break;
      }
      case 'grotte': { const r = this.netOf(pr.key); if (r) this.enterCave(r.N.id, r.e.k); break; }
      case 'issue': { const r = this.netOf(pr.key); if (r) this.exitCave(r.e.k); break; }
      case 'levier': {
        const F = g.dungeon?.floorPlan;
        if (!F || g.state.flags.get('door:' + pr.key)) break;
        g.setFlag('door:' + pr.key, true);
        g.audio.clang({ x: pr.x, y: 1, z: pr.z });
        const left = F.levers.filter((l) => !g.state.flags.get('door:' + l.key)).length;
        if (left) this.say(`Le levier bascule avec un claquement sourd. Quelque part, une chaîne se tend… (encore ${left} levier${left > 1 ? 's' : ''})`, C.yellow);
        else { this.say('Le dernier levier bascule : un long grincement de chaînes… la herse se lève !', C.green); g.audio.chime(); }
        g.applyDoor();
        break;
      }
      case 'herse': {
        const F = g.dungeon?.floorPlan;
        if (!F || this.gateOpen()) break;
        const left = F.levers.filter((l) => !g.state.flags.get('door:' + l.key)).length;
        this.say(`La herse ne bouge pas d’un pouce. ${left} levier${left > 1 ? 's' : ''} à trouver ailleurs dans cet étage.`, C.dim);
        break;
      }
      case 'champignons': {
        if (g.state.flags.get('cueilli:' + pr.key) === (g.time.day as unknown)) break;
        g.state.flags.set('cueilli:' + pr.key, g.time.day as unknown as boolean);
        const lines = [{ id: 'champignon', qty: 1 + Math.floor(Math.random() * 3) }];
        if (Math.random() < 0.3) lines.push({ id: 'herbe médicinale', qty: 1 });
        g.giveLoot(lines, 'Cueillette');
        g.audio.rustle({ x: pr.x, y: 0.5, z: pr.z });
        g.character.practice('artisanat', 0.3);
        break;
      }
    }
  }

  // ================================================================ herse et leviers
  gateOpen(): boolean {
    const g = this.g, F = g.dungeon?.floorPlan;
    if (!F?.gate) return false;
    for (const l of F.levers) if (!g.state.flags.get('door:' + l.key)) return false;
    return true;
  }
  /** Collision de la herse (retirée quand tous les leviers sont actionnés) ; appelé par Game.applyDoor. */
  applyGate(): void {
    const g = this.g, dg = g.dungeon, F = dg?.floorPlan;
    if (!dg) return;
    const segs = dg.data.segs, i = segs.findIndex((s) => (s as { gate?: boolean }).gate);
    if (i >= 0) segs.splice(i, 1);
    if (!F?.gate || this.gateOpen()) return;
    const d = F.gate;
    const s = d.horizontal ? { ax: d.x, az: d.z - 1.8, bx: d.x, bz: d.z + 1.8 } : { ax: d.x - 1.8, az: d.z, bx: d.x + 1.8, bz: d.z };
    segs.push(Object.assign({ ...s, r: 0.3, bottom: -1, top: 5 }, { gate: true }));
  }

  // ================================================================ boucle
  tick(dt: number): void {
    const g = this.g, dg = g.dungeon;
    if (g.time.day !== this.lastDay) { if (this.lastDay >= 0) this.dailyRumor(); this.lastDay = g.time.day; }
    if (!dg) {
      // entrées de grottes découvertes en passant (45 m)
      if ((this.discoverT -= dt) > 0) return;
      this.discoverT = 1;
      const p = g.player;
      for (const e of this.atlas.entrances) if (Math.abs(e.ax - p.x) < 45 && Math.abs(e.az - p.z) < 45 && Math.hypot(e.ax - p.x, e.az - p.z) < 45) this.discoverEntrance(e, true);
      return;
    }
    if (dg.floorPlan?.gate) this.gateLift += ((this.gateOpen() ? 1 : 0) - this.gateLift) * Math.min(1, dt * 0.8);
    // un filon épuisé (ici ou par un autre joueur) : maillage des filons refait
    const n = g.world.chunks.removed.size;
    if (dg.cave && n !== this.veinsSeen) {
      this.veinsSeen = n;
      g.swapUnderMesh(0, buildVeins(dg.cave, (id) => g.world.chunks.removed.has(id)));
    }
  }

  /** Poignées des leviers et barreaux de la herse (mobiles). */
  render(ib: InstanceBuffer): void {
    const g = this.g, F = g.dungeon?.floorPlan, m = this.m4;
    if (!F) return;
    for (const l of F.levers) {
      // poignée qui sort du mur est : relevée (0,7 rad) puis abaissée une fois actionnée
      const on = !!g.state.flags.get('door:' + l.key), a = on ? -0.7 : 0.7, ax = -Math.cos(a), ay = Math.sin(a), px = l.x + 0.08, py = 0.95;
      ib.add(trsYawPitch(m, px + ax * 0.35, py + ay * 0.35, l.z, Math.PI / 2, Math.atan2(ax, ay), 0.07, 0.7, 0.07), 0x4a4a50, M.METAL, 0, 0, 0, 1);
      ib.add(trsYawPitch(m, px + ax * 0.72, py + ay * 0.72, l.z, 0, 0, 0.14, 0.14, 0.14), on ? 0x60d070 : 0xd04030, M.METAL, 0, 0, 0, 2);
    }
    const d = F.gate;
    if (!d || this.gateLift > 0.98) return;
    const lift = this.gateLift * 3.1;
    for (let k = -3; k <= 3; k++) {
      const x = d.x + (d.horizontal ? 0 : k * 0.5), z = d.z + (d.horizontal ? k * 0.5 : 0);
      ib.add(trsYawPitch(m, x, 1.6 + lift, z, 0, 0, 0.09, 3.2, 0.09), 0x5a5a62, M.METAL, 0, 0, 0, 1);
    }
    for (const y of [0.6, 1.8, 2.9]) ib.add(trsYawPitch(m, d.x, y + lift, d.z, d.horizontal ? Math.PI / 2 : 0, 0, 3.4, 0.09, 0.09), 0x5a5a62, M.METAL, 0, 0, 0);
  }

  // ================================================================ morts : gardiens
  private onKilled(id: string): void {
    const g = this.g, F = g.dungeon?.floorPlan;
    if (!F) return;
    const m = /^dj\d+\.\d+:m(\d+)$/.exec(id), s = m ? F.spawns[Number(m[1])] : undefined;
    if (!s?.elite) return;
    g.banner = { text: `${s.elite.name.toUpperCase()} EST TOMBÉ${s.elite.fem ? 'E' : ''}`, sub: `${s.elite.title.charAt(0).toUpperCase() + s.elite.title.slice(1)} · le coffre de sa salle vous attend`, t: 5, color: C.magenta };
  }

  // ================================================================ repères : HUD, carte, journal
  /** Lieu affiché par le HUD sous terre. */
  label(): string {
    const g = this.g, dg = g.dungeon;
    if (!dg) return '';
    if (dg.cave) return dg.cave.name;
    const d = g.world.civ.dungeons[dg.layout.id], n = d ? this.floors(d) : 1;
    return n > 1 ? `${d.name} · niveau ${dg.floor}/${n}` : dg.layout.name;
  }
  /** Étage à côté de la boussole (vide à la surface et dans un donjon à un seul niveau). */
  floorTag(): string {
    const g = this.g, dg = g.dungeon;
    if (!dg) return '';
    if (dg.cave) return 'sous terre';
    const d = g.world.civ.dungeons[dg.layout.id], n = d ? this.floors(d) : 1;
    return n > 1 ? `niveau ${dg.floor}/${n}` : '';
  }
  /** Marqueurs de la carte : entrées de grottes connues (découvertes ou signalées par une rumeur). */
  markers(): { x: number; z: number; glyph: string; color: number; name?: string }[] {
    const g = this.g, out: { x: number; z: number; glyph: string; color: number; name?: string }[] = [];
    for (const e of this.atlas.entrances) {
      if (!g.state.discovered.has('grotte:' + e.key)) continue;
      const p = entrancePos(this.atlas, e);
      out.push({ x: p.x, z: p.z, glyph: '∩', color: 0xb0a080, name: this.atlas.nets[e.net].name });
    }
    return out;
  }
  /** Section « Souterrains » du journal. */
  journalLines(): { text: string; color: number }[] {
    const g = this.g, out: { text: string; color: number }[] = [], dg = g.dungeon, civ = g.world.civ;
    if (dg) out.push({ text: `► Vous êtes ici : ${this.label()}`, color: C.white });
    for (const d of civ.dungeons) {
      const n = this.floors(d);
      if (n < 2) continue;
      let deepest = 0;
      for (let l = 2; l <= n; l++) if (g.state.discovered.has(`étage:${d.id}:${l}`)) deepest = l;
      if (!deepest && !(dg && dg.floor >= 1 && dg.layout.id === d.id)) continue;
      const guards = [];
      for (let l = 2; l <= deepest; l++) { const F = this.floorPlan(d, l); const s = F.spawns.findIndex((x) => x.elite); if (s >= 0) guards.push(g.entities.killed.has(`dj${d.id}.${l}:m${s}`) ? `gardien du niveau ${l} vaincu` : `gardien du niveau ${l} : ${F.guardian}`); }
      out.push({ text: `Ω ${d.name} : ${n} niveaux, ${deepest ? `jusqu’au niveau ${deepest}/${n} exploré` : 'niveau 1 seulement'}${guards.length ? ' · ' + guards.join(' · ') : ''}`, color: C.cyan });
    }
    for (const N of this.atlas.nets) {
      const known = N.entrances.filter((e) => g.state.discovered.has('grotte:' + e.key)).length;
      if (!known) continue;
      const p = g.player, here = dg ? dg.ret : p, q = entrancePos(this.atlas, N.entrances.find((e) => g.state.discovered.has('grotte:' + e.key))!);
      out.push({ text: `∩ ${N.name}${N.entrances.length > 1 ? ` · ${known} entrée${known > 1 ? 's' : ''} connue${known > 1 ? 's' : ''} sur ${N.entrances.length}` : ''} · ${distance(Math.hypot(q.x - here.x, q.z - here.z)).replace('tout près d\'ici', 'tout près')}, ${direction(here.x, here.z, q.x, q.z)}`, color: 0xb0a080 });
    }
    return out;
  }

  // ================================================================ rumeurs
  /** Rumeurs de départ : les grottes les plus proches des villages, signalées par les bergers (une rumeur ajoutée ne décale rien). */
  private seedRumors(): void {
    const g = this.g, civ = g.world.civ, towns = civ.settlements.filter((s) => !s.abandoned && s.type !== 'camp' && s.type !== 'ruines');
    if (!towns.length) return;
    const pairs = this.atlas.entrances.map((e) => {
      const s = towns.reduce((a, b) => (Math.hypot(a.x - e.ax, a.z - e.az) < Math.hypot(b.x - e.ax, b.z - e.az) ? a : b));
      return { e, s, d: Math.hypot(s.x - e.ax, s.z - e.az) };
    }).filter((x) => x.d < 2600).sort((a, b) => a.d - b.d).slice(0, 4);
    for (const { e, s, d } of pairs) this.rumor(e, s.id, d, s.x, s.z, -2);
  }
  private rumor(e: CaveEntrance, sid: number, d: number, sx: number, sz: number, age = 0): void {
    const g = this.g, N = this.atlas.nets[e.net], tag = 'grotte:' + e.key;
    if (g.rumors.list.some((r) => r.tag === tag)) return;
    const where = `${distance(d)}, ${direction(sx, sz, e.ax, e.az)}`;
    const t = [
      `Un berger jure avoir vu l’entrée d’une grotte ${where}, au flanc de la montagne. Il en sortait un souffle glacé. On l’appelle ${lieu(N.name)}.`,
      `Les chevriers évitent ${lieu(N.name)}, ${where}. Des yeux luisent dans le noir, et l’on y entend battre des ailes.`,
      `Un mineur m’a juré qu’on trouve du fer et même de l’or ${lieu(N.name, 'dans')}, ${where}. Mais il n’y est jamais retourné.`,
    ][hashString(e.key) % 3];
    g.rumors.add(N.entrances.length > 1 ? `${t} On dit que ses galeries ressortent ailleurs.` : t, sid, tag, age);
  }
  /** Tous les trois jours, un village de plus parle d'une grotte encore inconnue du joueur. */
  private dailyRumor(): void {
    const g = this.g, day = g.time.day;
    if (day % 3) return;
    const civ = g.world.civ, unknown = this.atlas.entrances.filter((e) => !g.state.discovered.has('grotte:' + e.key));
    if (!unknown.length) return;
    const e = unknown[day % unknown.length], towns = civ.settlements.filter((s) => !s.abandoned && s.type !== 'camp' && s.type !== 'ruines');
    if (!towns.length) return;
    const s = towns.reduce((a, b) => (Math.hypot(a.x - e.ax, a.z - e.az) < Math.hypot(b.x - e.ax, b.z - e.az) ? a : b));
    this.rumor(e, s.id, Math.hypot(s.x - e.ax, s.z - e.az), s.x, s.z);
  }

  // ================================================================ sauvegarde
  /** Position sous terre hors du niveau 1 (absent : surface, ou niveau 1 d'un donjon, sauvegardé à l'ancienne). */
  toSave(): UnderSave | undefined {
    const g = this.g, dg = g.dungeon, p = g.player;
    if (!dg || dg.floor === 1) return undefined;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return { k: dg.cave ? 'grotte' : 'étage', id: dg.layout.id, floor: dg.floor, x: r2(p.x), y: r2(p.y), z: r2(p.z), heading: r2(p.heading), ret: { x: r2(dg.ret.x), z: r2(dg.ret.z), heading: r2(dg.ret.heading) } };
  }
  /** Retour sous terre au chargement (la sauvegarde a déjà placé le joueur devant l'entrée, à la surface). */
  restore(raw: unknown): void {
    const g = this.g, u = raw as UnderSave;
    if (!u || typeof u !== 'object' || g.dungeon) return;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    const id = num(u.id), x = num(u.x), z = num(u.z);
    if (!Number.isInteger(id) || Number.isNaN(x) || Number.isNaN(z)) return;
    this.silent = true;
    try { this.restoreAt(u, id); } finally { this.silent = false; }
    const dg = g.dungeon as Game['dungeon'], p = g.player;
    if (!dg) return;
    const rt = u.ret;
    if (rt && Number.isFinite(rt.x) && Number.isFinite(rt.z)) dg.ret = { x: rt.x, z: rt.z, heading: Number.isFinite(rt.heading) ? rt.heading : 0 };
    p.x = x; p.z = z; p.y = Number.isFinite(u.y) ? u.y : 0.05; p.heading = Number.isFinite(u.heading) ? u.heading : 0;
  }
  private restoreAt(u: UnderSave, id: number): void {
    const g = this.g, num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    if (u.k === 'grotte') {
      if (!this.atlas.nets[id]) return;
      this.enterCave(id, 0);
    } else {
      const d = g.world.civ.dungeons[id], fl = num(u.floor);
      if (!d || !Number.isInteger(fl) || fl < 2 || fl > this.floors(d)) return;
      g.enterDungeon(id);
      if (!g.dungeon) return;
      if (!this.goFloor(fl)) g.exitDungeon();
    }
  }

  // ================================================================ console
  dev(cmd: string, args: string[]): { text: string; err?: boolean }[] {
    const g = this.g, p = g.player, out: { text: string; err?: boolean }[] = [], say = (text: string, err = false) => out.push({ text, err });
    const civ = g.world.civ, a0 = (args[0] ?? '').toLowerCase();
    const nearestDungeon = () => civ.dungeons.map((d) => ({ d, poi: civ.pois.find((q) => q.id === d.poiId) })).filter((x) => x.poi)
      .sort((a, b) => Math.hypot(a.poi!.x - p.x, a.poi!.z - p.z) - Math.hypot(b.poi!.x - p.x, b.poi!.z - p.z))[0]?.d;
    switch (cmd) {
      case 'descendre': case 'monter': {
        const dg = g.dungeon;
        if (!dg || dg.floor < 1) { say('pas dans un donjon (entrez d’abord, ou : etages aller <n>)', true); break; }
        const to = dg.floor + (cmd === 'descendre' ? 1 : -1);
        if (to < 1) { g.exitDungeon(); say('retour à la surface'); break; }
        if (!this.goFloor(to)) say(`pas de niveau ${to} ici`, true); else say(`niveau ${to}`);
        break;
      }
      case 'etages': case 'étages': case 'etage': case 'étage': {
        const dg = g.dungeon, d = dg && dg.floor >= 1 ? civ.dungeons[dg.layout.id] : /^\d+$/.test(a0) ? civ.dungeons[+a0] : nearestDungeon();
        if (a0 === 'aller') {
          const t = civ.dungeons[+(args[1] ?? -1)] ?? nearestDungeon(), lvl = Math.max(1, +(args[2] ?? 1) || 1);
          if (!t) { say('aucun donjon', true); break; }
          if (g.dungeon) g.exitDungeon();
          g.enterDungeon(t.id);
          if (lvl > 1 && !this.goFloor(Math.min(lvl, this.floors(t)))) say(`${t.name} n’a pas de niveau ${lvl}`, true);
          say(`→ ${this.label()}`);
          break;
        }
        if (!d) { say('aucun donjon', true); break; }
        const n = this.floors(d);
        say(`${d.id}. ${d.name} (${d.kind}, profondeur ${d.depth}) : ${n} niveau${n > 1 ? 'x' : ''}${dg && dg.floor >= 1 && dg.layout.id === d.id ? ` · vous êtes au niveau ${dg.floor}` : ''}`);
        const ds = this.descent(d);
        if (ds) say(`  niveau 1 : escalier dans la salle ${ds.room} (${ds.x.toFixed(1)}, ${ds.z.toFixed(1)})`);
        for (let l = 2; l <= n; l++) {
          const F = this.floorPlan(d, l);
          say(`  niveau ${l} : ${F.theme} · ${F.rooms.length} salles · ${F.features.join(', ')} · ${F.spawns.length} créatures · ${F.chests.length} coffres${F.levers.length ? ` · ${F.levers.length} leviers (${F.levers.filter((x) => g.state.flags.get('door:' + x.key)).length} actionnés)` : ''}${F.guardian ? ` · gardien : ${F.guardian}` : ''}`);
        }
        say('etages aller [id] [niveau] : entrer · descendre / monter : changer d’étage');
        break;
      }
      case 'grottes': {
        const list = this.atlas.nets.map((N) => ({ N, d: Math.min(...N.entrances.map((e) => Math.hypot(e.ax - p.x, e.az - p.z))) })).sort((a, b) => a.d - b.d);
        say(`${list.length} réseaux, ${this.atlas.entrances.length} entrées`);
        for (const { N, d } of list.slice(0, Math.max(1, +a0 || 12))) say(`${N.id}. ${N.name} · ${N.entrances.length} entrée${N.entrances.length > 1 ? 's' : ''} · ${Math.round(d)} m · danger ${dangerOf(civ, N.x, N.z)}${N.entrances.some((e) => g.state.discovered.has('grotte:' + e.key)) ? ' · connue' : ''}`);
        break;
      }
      case 'grotte': {
        const dg = g.dungeon;
        if (a0 === 'sortir' || a0 === 'issue') {
          if (!dg?.cave) { say('pas dans une grotte', true); break; }
          const k = Math.max(0, Math.min(dg.cave.exits.length - 1, +(args[1] ?? 0) || 0));
          this.exitCave(k); say(`sorti par l’issue ${k}`); break;
        }
        if (a0 === 'reveler' || a0 === 'révéler') { for (const e of this.atlas.entrances) g.state.discovered.add('grotte:' + e.key); say('toutes les grottes sont sur la carte'); break; }
        if (/^\d+$/.test(a0)) {
          const N = this.atlas.nets[+a0], k = Math.max(0, +(args[1] ?? 0) || 0);
          if (!N || !N.entrances[k]) { say('réseau ou entrée inconnu (grottes)', true); break; }
          if (dg) g.exitDungeon();
          this.enterCave(N.id, k); say(`→ ${N.name} par l’entrée ${k}`); break;
        }
        // aller devant l'entrée la plus proche
        if (dg) g.exitDungeon();
        const e = [...this.atlas.entrances].sort((a, b) => Math.hypot(a.ax - p.x, a.az - p.z) - Math.hypot(b.ax - p.x, b.az - p.z))[0];
        if (!e) { say('aucune grotte dans ce monde', true); break; }
        g.world.chunks.update(e.ax, e.az, -1);
        const mo = this.atlas.mouth(e);
        p.x = mo?.ox ?? e.ax; p.z = mo?.oz ?? e.az; p.heading = mo ? mo.heading + Math.PI : 0; p.vx = p.vz = p.vy = 0;
        g.world.chunks.update(p.x, p.z, -1); p.y = g.world.heightAt(p.x, p.z) + 0.3;
        say(`devant ${this.atlas.nets[e.net].name} (entrée ${e.k}) — [E] pour entrer`);
        break;
      }
    }
    return out;
  }
}
