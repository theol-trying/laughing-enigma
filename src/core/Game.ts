import { WorldSeed } from './Seed';
import { GameTime } from './Time';
import { EventBus } from './Events';
import type { Input } from './Input';
import { World } from '../world/World';
import { buildFarTerrain } from '../world/FarTerrain';
import { Player } from '../entities/Player';
import { Camera } from '../rendering/Camera';
import { computeAtmosphere, CLEAR_WEATHER } from '../rendering/Atmosphere';
import { InstanceBuffer, type Renderer, type GpuMesh, type DrawItem, type PointLight } from '../rendering/Renderer';

/** Partie en cours : monde, joueur, temps et systèmes. (Étendu aux étapes 5 à 10.) */
export class Game {
  readonly seed: WorldSeed;
  readonly world: World<GpuMesh>;
  readonly player = new Player();
  readonly time = new GameTime();
  readonly events = new EventBus();
  readonly camera = new Camera();
  readonly instances = new InstanceBuffer();
  private far: GpuMesh;
  elapsed = 0;

  constructor(seedText: string, private renderer: Renderer) {
    this.seed = new WorldSeed(seedText);
    this.world = new World<GpuMesh>(this.seed, { upload: (m) => renderer.createMesh(m), release: (g) => renderer.deleteMesh(g) });
    this.far = renderer.createMesh(buildFarTerrain(this.world.macro, (mb) => this.world.civWorld.landmarks(mb)));
    const sp = this.world.spawn();
    this.player.x = sp.x; this.player.z = sp.z; this.player.heading = sp.heading;
    this.world.chunks.update(sp.x, sp.z, -1);
    this.player.y = this.world.heightAt(sp.x, sp.z) + 0.1;
  }

  update(dt: number, input: Input): void {
    this.elapsed += dt;
    this.time.advance(dt);
    this.player.look(input);
    this.player.update(dt, input, this.world);
    this.world.chunks.update(this.player.x, this.player.z, 5);
  }

  render(viewMode = 0): void {
    const p = this.player, c = this.camera;
    c.x = p.x; c.y = p.eyeY; c.z = p.z; c.heading = p.heading; c.pitch = p.pitch;
    const atmo = computeAtmosphere(this.time.hour, CLEAR_WEATHER, 0, 0);
    const items: DrawItem[] = [{ mesh: this.far, clip: 1 }];
    for (const g of this.world.chunks.gpuMeshes()) items.push({ mesh: g, clip: 2, shadow: true });
    const lights: PointLight[] = [];
    const torchOn = Math.min(1, Math.max(0, (atmo.night - 0.12) / 0.35));
    const near = this.world.chunks.lightsNear(c.x, c.z, 90).map((l) => ({ l, d: Math.hypot(l.x - c.x, l.z - c.z) })).sort((a, b) => a.d - b.d);
    for (const { l } of near) {
      const k = (l.kind === 'torch' ? torchOn : 1) * (0.85 + 0.15 * Math.sin(this.elapsed * 11 + l.x * 3) * Math.sin(this.elapsed * 7 + l.z * 5));
      if (k < 0.02) continue;
      lights.push({ x: l.x, y: l.y, z: l.z, radius: l.radius, r: l.r * k, g: l.g * k, b: l.b * k });
      if (lights.length >= 24) break;
    }
    this.instances.reset();
    this.renderer.render({ camera: c, atmo, time: this.elapsed, items, clipRadius: this.world.chunks.clipRadius, instances: this.instances, lights, viewMode, sceneOn: true });
  }
}
