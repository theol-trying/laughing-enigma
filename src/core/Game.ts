import { WorldSeed } from './Seed';
import { GameTime } from './Time';
import { EventBus } from './Events';
import type { Input } from './Input';
import { World } from '../world/World';
import { buildFarTerrain } from '../world/FarTerrain';
import { generateDungeon, buildDungeon, type DungeonLayout } from '../world/dungeons/DungeonGenerator';
import type { ChunkData, Prop } from '../world/Chunk';
import { Player } from '../entities/Player';
import { Camera } from '../rendering/Camera';
import { computeAtmosphere, CLEAR_WEATHER } from '../rendering/Atmosphere';
import { M } from '../rendering/Materials';
import { trsYawPitch, mat4 } from './math';
import { InstanceBuffer, type Renderer, type GpuMesh, type DrawItem, type PointLight } from '../rendering/Renderer';

interface ActiveDungeon { layout: DungeonLayout; mesh: GpuMesh; data: ChunkData; ret: { x: number; y: number; z: number; heading: number }; doorOpen: boolean }

/** Partie en cours : monde, joueur, temps et systèmes. (Étendu aux étapes 6 à 10.) */
export class Game {
  readonly seed: WorldSeed;
  readonly world: World<GpuMesh>;
  readonly player = new Player();
  readonly time = new GameTime();
  readonly events = new EventBus();
  readonly camera = new Camera();
  readonly instances = new InstanceBuffer();
  private far: GpuMesh;
  dungeon: ActiveDungeon | null = null;
  /** objet interactif visé (pour l'invite « [E] … ») */
  focus: Prop | null = null;
  elapsed = 0;
  private m4 = mat4();

  constructor(seedText: string, private renderer: Renderer) {
    this.seed = new WorldSeed(seedText);
    this.world = new World<GpuMesh>(this.seed, { upload: (m) => renderer.createMesh(m), release: (g) => renderer.deleteMesh(g) });
    this.far = renderer.createMesh(buildFarTerrain(this.world.macro, (mb) => this.world.civWorld.landmarks(mb)));
    const sp = this.world.spawn();
    this.player.x = sp.x; this.player.z = sp.z; this.player.heading = sp.heading;
    this.world.chunks.update(sp.x, sp.z, -1);
    this.player.y = this.world.heightAt(sp.x, sp.z) + 0.1;
  }

  /** Nom lisible d'un objet interactif. */
  propLabel(p: Prop): string {
    if (p.kind === 'entrée') return `Entrer : ${this.world.civ.dungeons[p.dungeonId]?.name ?? 'souterrain'}`;
    if (p.kind === 'sortie') return 'Remonter à la surface';
    if (p.kind === 'porte verrouillée') return this.dungeon?.doorOpen ? '' : 'Porte verrouillée';
    return p.kind;
  }

  private findFocus(): Prop | null {
    const p = this.player;
    const fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
    let best: Prop | null = null, bs = Infinity;
    for (const pr of this.world.chunks.propsNear(p.x, p.z, 3.2)) {
      const dx = pr.x - p.x, dz = pr.z - p.z, d = Math.hypot(dx, dz);
      const facing = d < 0.8 ? 1 : (dx * fx + dz * fz) / d;
      if (facing < 0.35) continue;
      const score = d - facing;
      if (score < bs && this.propLabel(pr)) { bs = score; best = pr; }
    }
    return best;
  }

  interact(): void {
    const f = this.focus;
    if (!f) return;
    if (f.kind === 'entrée') this.enterDungeon(f.dungeonId);
    else if (f.kind === 'sortie') this.exitDungeon();
    else this.events.emit('message', { text: `${f.kind} (interactions à l'étape 7)` });
  }

  enterDungeon(id: number): void {
    const d = this.world.civ.dungeons[id];
    if (!d || this.dungeon) return;
    const layout = generateDungeon(this.seed, d);
    const built = buildDungeon(layout);
    const p = this.player;
    this.dungeon = { layout, mesh: this.renderer.createMesh(built.mesh), data: built.data, ret: { x: p.x, y: p.y, z: p.z, heading: p.heading + Math.PI }, doorOpen: false };
    this.applyDoor();
    this.world.chunks.overlays = [built.data];
    p.bounded = false;
    p.x = layout.entrance.x; p.z = layout.entrance.z; p.y = 0.05; p.vx = p.vz = p.vy = 0;
    p.heading = 0; // vers le nord du donjon (−z), où sont les autres salles
    this.events.emit('message', { text: `Vous descendez dans ${d.name}.` });
  }

  exitDungeon(): void {
    const dg = this.dungeon;
    if (!dg) return;
    this.renderer.deleteMesh(dg.mesh);
    this.world.chunks.overlays = [];
    const p = this.player;
    p.bounded = true;
    p.x = dg.ret.x; p.z = dg.ret.z; p.heading = dg.ret.heading; p.vx = p.vz = p.vy = 0;
    this.dungeon = null;
    this.world.chunks.update(p.x, p.z, -1);
    p.y = this.world.heightAt(p.x, p.z) + 0.1;
  }

  /** Collision de la porte verrouillée (retirée quand elle s'ouvre). */
  applyDoor(): void {
    const dg = this.dungeon;
    if (!dg || !dg.layout.lockedDoor) return;
    const d = dg.layout.lockedDoor, segs = dg.data.segs;
    const i = segs.findIndex((s) => (s as any).door);
    if (i >= 0) segs.splice(i, 1);
    if (dg.doorOpen) return;
    const s = d.horizontal ? { ax: d.x, az: d.z - 1.8, bx: d.x, bz: d.z + 1.8 } : { ax: d.x - 1.8, az: d.z, bx: d.x + 1.8, bz: d.z };
    segs.push(Object.assign({ ...s, r: 0.3, bottom: -1, top: 5 }, { door: true }));
  }

  update(dt: number, input: Input): void {
    this.elapsed += dt;
    this.time.advance(dt);
    this.player.look(input);
    this.player.update(dt, input, this.world);
    if (!this.dungeon) this.world.chunks.update(this.player.x, this.player.z, 5);
    this.focus = this.findFocus();
    if (input.key('e')) this.interact();
  }

  render(viewMode = 0): void {
    const p = this.player, c = this.camera, dg = this.dungeon;
    c.x = p.x; c.y = p.eyeY; c.z = p.z; c.heading = p.heading; c.pitch = p.pitch;
    const atmo = computeAtmosphere(dg ? 0 : this.time.hour, CLEAR_WEATHER, dg ? 1 : 0, 0);
    if (dg) {
      // souterrain : ni soleil ni ciel, ambiance faible et chaude, brouillard noir
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
    for (const { l } of near) {
      const k = (l.kind === 'torch' ? torchOn : 1) * (0.85 + 0.15 * Math.sin(this.elapsed * 11 + l.x * 3) * Math.sin(this.elapsed * 7 + l.z * 5));
      if (k < 0.02) continue;
      lights.push({ x: l.x, y: l.y, z: l.z, radius: l.radius, r: l.r * k, g: l.g * k, b: l.b * k });
      if (lights.length >= 24) break;
    }
    this.instances.reset();
    if (dg && dg.layout.lockedDoor && !dg.doorOpen) {
      const d = dg.layout.lockedDoor;
      this.instances.add(trsYawPitch(this.m4, d.x, 1.6, d.z, d.horizontal ? Math.PI / 2 : 0, 0, 3.4, 3.2, 0.3), 0x5a3a22, M.DOOR, 0, 0, 0.3);
    }
    this.renderer.render({ camera: c, atmo, time: this.elapsed, items, clipRadius: this.world.chunks.clipRadius, instances: this.instances, lights, viewMode, sceneOn: true });
  }
}
