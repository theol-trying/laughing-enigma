import { C, type TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import type { Game } from '../game/Game';
import { GENERATOR_VERSION } from '../version';
import { CHUNK } from '@ascii-fort/worldgen/constants';
import { BIOMES } from '@ascii-fort/worldgen/terrain/Biomes';

// Interface de jeu en caractères : barres, boussole, heure, cible, invites, messages.

export interface HudState { log: { text: string; t: number; color: number }[]; debug: boolean; fps: number; genMs: number; drawCalls: number }

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

function bar(g: TextGrid, x: number, y: number, label: string, v: number, max: number, color: number, w = 12) {
  g.text(x, y, label.padEnd(4), C.text, C.panel, 0.55);
  g.bar(x + 4, y, w, max > 0 ? v / max : 0, color, C.faint, C.panel);
  g.text(x + 5 + w, y, `${Math.ceil(v)}/${Math.round(max)}`.padEnd(8), C.dim, C.panel, 0.55);
}

export function drawHud(g: TextGrid, game: Game, st: HudState): void {
  const p = game.player, ch = game.character, cols = g.cols, rows = g.rows;
  const now = performance.now();
  // barres
  const by = rows - 4;
  bar(g, 1, by, 'HP', p.hp, p.maxHp, p.poison > 0 ? C.green : C.hp);
  bar(g, 1, by + 1, 'END', p.stamina, p.maxStamina, C.sta);
  bar(g, 1, by + 2, 'MANA', p.mana, p.maxMana, C.mp);
  const status = [p.poison > 0 ? 'empoisonné' : '', p.frost > 0 ? 'gelé' : '', p.burn > 0 ? 'brûlé' : '', p.crouch ? 'accroupi' : '', ch.inv.weight() > ch.carryMax() ? 'surchargé' : ''].filter(Boolean).join(' · ');
  g.text(1, by - 1, ` Niv ${ch.level} · ${ch.xp}/${ch.xpForNext()} XP · ${ch.inv.gold} or${ch.statPoints ? ' · +' + ch.statPoints + ' pt (C)' : ''} ${status ? '· ' + status : ''} `, C.gold, C.panel, 0.55);
  g.text(1, rows - 1, ` ${ch.weapon?.name ?? 'Poings'}${ch.weapon?.weapon?.kind === 'arc' ? ` (${ch.inv.count('flèche')} flèches)` : ''} · H potion (${ch.inv.count('potion de soin')}) · R feu · F soin `, C.dim, C.panel, 0.45);

  // boussole
  const cw = Math.min(61, cols - 30), cx0 = Math.floor((cols - cw) / 2);
  const deg = (h: number) => ((h * 180) / Math.PI + 360) % 360;
  const head = deg(p.heading);
  const marks = new Map<number, [string, number]>();
  for (let i = 0; i < 8; i++) marks.set(i * 45, [DIRS[i], i % 2 ? C.dim : C.white]);
  const q = game.quests.quests.find((x) => x.status === 'active' && x.target);
  const put = (worldX: number, worldZ: number, ch2: string, col: number) => {
    const a = deg(Math.atan2(worldX - p.x, -(worldZ - p.z)));
    let d = a - head; if (d > 180) d -= 360; if (d < -180) d += 360;
    if (Math.abs(d) < 60) g.text(cx0 + Math.round((d / 60) * (cw / 2)) + Math.floor(cw / 2), 1, ch2, col, C.panel, 0.6);
  };
  for (let i = 0; i < cw; i++) {
    const a = (head + ((i - cw / 2) / (cw / 2)) * 60 + 360) % 360;
    const near = [...marks.keys()].find((k) => Math.abs(((a - k + 540) % 360) - 180) < 60 / cw * 1.01);
    g.text(cx0 + i, 1, near !== undefined ? marks.get(near)![0][0] : i % 4 === 0 ? '·' : ' ', near !== undefined ? marks.get(near)![1] : C.faint, C.panel, 0.6);
  }
  if (q && !game.dungeon) put(q.target!.x, q.target!.z, '!', C.yellow);
  g.text(cx0 - 1, 1, '[', C.dim, C.panel, 0.6); g.text(cx0 + cw, 1, ']', C.dim, C.panel, 0.6);

  // heure, météo, lieu
  const civ = game.world.civ, m = game.world.macro;
  const here = civ.settlements.find((s) => !s.abandoned && Math.hypot(s.x - p.x, s.z - p.z) < s.radius + 20);
  const region = m.regions[m.region[m.cellOf(p.x, p.z)]]?.name ?? '';
  const place = game.dungeon ? game.dungeon.layout.name : here ? here.name : region;
  const right = ` ${game.time.label()} · ${game.time.phase} · ${game.weather()} `;
  g.text(cols - right.length - 1, 0, right, C.text, C.panel, 0.6);
  g.text(cols - place.length - 3, 1, ` ${place} `, C.title, C.panel, 0.6);

  // cible et réticule
  const t = game.target;
  if (t && t.alive && Math.hypot(t.x - p.x, t.z - p.z) < 35) {
    g.center(3, ` ${t.label} `, t.mon ? C.red : C.orange, C.panel);
    g.bar(Math.floor(cols / 2) - 8, 4, 16, t.hp / t.maxHp, C.hp, C.faint, C.panel);
  }
  const mid = Math.floor(rows / 2);
  g.text(Math.floor(cols / 2), mid, game.fight.charge > 0.42 && ch.weapon?.weapon?.kind !== 'arc' ? '✶'.length ? '*' : '+' : '+', p.blocking ? C.cyan : C.white);
  if (game.focus) g.center(mid + 2, ` [E] ${game.focus.label} `, C.yellow, C.panel);
  if (ch.weapon?.weapon?.kind === 'arc' && game.fight.charge > 0) g.bar(Math.floor(cols / 2) - 5, mid + 1, 10, Math.min(1, game.fight.charge / 0.8), C.gold, C.faint);

  // messages
  const msgs = st.log.filter((l) => now - l.t < 7000).slice(-5);
  msgs.forEach((l, i) => g.text(cols - Math.min(cols - 30, l.text.length + 2) - 1, rows - 1 - msgs.length + i, ` ${l.text.slice(0, cols - 34)} `, l.color, C.panel, 0.6));
  if (p.dead) { g.center(mid - 4, '  Vous êtes mort  ', C.red, C.black); g.center(mid - 3, ' On vous ramènera à l\'auberge… ', C.dim, C.black); }

  // débogage (F3)
  if (st.debug) {
    const lines = [
      `World: ${game.seed.text} · Generator: ${GENERATOR_VERSION} · ${m.worldName}`,
      `${st.fps.toFixed(0)} fps · ${cols}×${rows} · draw ${st.drawCalls} · génération ${st.genMs.toFixed(0)} ms`,
      `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} · chunk ${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)} · ${game.world.chunks.chunks.size} chunks · ${game.entities.entities.length} entités · ${game.entities.zones.size} zones`,
      `${BIOMES[game.world.sampler.biomeAt(p.x, p.z)].name} · ${region} · seed locale ${game.seed.int('terrain', `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`).toString(16)}`,
    ];
    lines.forEach((l, i) => g.text(1, 3 + i, ` ${l} `, i === 0 ? C.title : C.text, C.panel, 0.75));
  }
}
