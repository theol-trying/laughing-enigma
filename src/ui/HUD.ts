import { C, TextGrid } from '@ascii-fort/ascii-engine/TextGrid';
import { spell } from '@ascii-fort/sim/gameplay/Spells';
import { item } from '@ascii-fort/sim/gameplay/Items';
import type { Game } from '../game/Game';
import { GENERATOR_VERSION } from '../version';
import { CHUNK } from '@ascii-fort/worldgen/constants';
import { BIOMES } from '@ascii-fort/worldgen/terrain/Biomes';
import { MOUNT } from '@ascii-fort/sim/gameplay/Companions';

// Interface de jeu en caractères : barres, boussole, heure, cible, invites, messages.

export interface HudState { log: { text: string; t: number; color: number }[]; debug: boolean; fps: number; genMs: number; drawCalls: number; locked?: boolean }

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
  // compagnons : cheval (PV, endurance du galop) et mercenaire (PV), à droite des barres du joueur
  // (colonnes 29-53, rangées du bas : « edge » est la première colonne libre à leur droite, 0 s'il n'y en a pas)
  let cy = by, edge = 0;
  const hv = game.poss.horseView();
  if (hv && (hv.mounted || hv.dist < 60)) {
    bar(g, 29, cy++, 'CHEV', hv.hp, hv.maxHp, C.hp);
    bar(g, 29, cy++, 'GALO', hv.stamina, hv.maxStamina, hv.winded ? C.red : C.orange);
    edge = 54;
  }
  const mv = game.poss.mercView();
  if (mv && cy < by + 3) {
    bar(g, 29, cy++, 'MERC', mv.hp, mv.maxHp, mv.ko > 0 ? C.red : C.green);
    edge = 54;
    if (mv.ko > 0 && cy <= by + 2) { const t = ` ${mv.name} à terre (${Math.ceil(mv.ko)} s) `; g.text(29, cy, t, C.red, C.panel, 0.55); edge = Math.max(edge, 29 + t.length); }
  }
  const worst = ch.worstEquipped();
  const status = [p.poison > 0 ? 'empoisonné' : '', p.frost > 0 ? 'gelé' : '', p.burn > 0 ? 'brûlé' : '', p.diving ? 'en plongée' : p.swimming ? 'à la nage' : p.depth > 0.3 ? 'dans l\'eau' : '', p.crouch && !p.swimming ? 'accroupi' : '', p.mounted ? (p.sprinting ? 'au galop' : 'à cheval') : '', hv && p.mounted && hv.limp ? 'cheval boiteux' : '', ch.inv.weight() > ch.carryMax() ? 'surchargé' : '',
    worst <= 0 ? 'équipement hors d’usage' : worst < 25 ? 'équipement très usé' : ''].filter(Boolean).join(' · ');
  const tp = ch.talentPoints();
  g.text(1, by - 1, ` Niv ${ch.level} · ${ch.xp}/${ch.xpForNext()} XP · ${ch.inv.gold} or${ch.statPoints ? ' · +' + ch.statPoints + ' pt (P)' : ''}${tp ? ' · +' + tp + ' talent' + (tp > 1 ? 's' : '') + ' (K)' : ''} ${status ? '· ' + status : ''} `, C.gold, C.panel, 0.55);
  g.text(1, rows - 1, ` ${ch.equip.arme ? item(ch.equip.arme).name : 'Poings'}${ch.weapon?.weapon?.kind === 'arc' ? ` (${ch.inv.count('flèche')} flèches)` : ''} · H potion (${ch.inv.count('potion de soin')}) · R ${spell(ch.spellR)?.name ?? '—'} · F ${spell(ch.spellF)?.name ?? '—'}${hv ? ' · G cheval · Y siffler' : ''}${mv ? ' · N mercenaire' : ''} `, C.dim, C.panel, 0.45);

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

  // en ligne : salon, joueurs, noms au-dessus des têtes
  const coop = game.coop;
  if (coop) {
    const n = coop.players.size + 1, st = coop.net.status;
    const info = st === 'en ligne' ? ` Salon ${coop.net.code} · ${n} joueur${n > 1 ? 's' : ''} · ${Math.round(coop.net.rtt)} ms ` : ` Salon ${coop.net.code} · ${st}… `;
    g.text(1, 2, info, st === 'en ligne' ? C.cyan : C.orange, C.panel, 0.6);
    const cam = game.camera, dg = game.dungeon ? game.dungeon.layout.id : -1;
    for (const r of coop.players.values()) {
      if (!r.seen || r.dungeon !== dg) continue;
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d > 60) continue;
      const pr = cam.project(r.x, r.y + 2.15 + (r.mount ? MOUNT.lift : 0), r.z);
      if (!pr || pr.u < 0 || pr.u > 1 || pr.v < 0 || pr.v > 1) continue;
      const label = ` ${r.name}${r.pose.dead > 0.5 ? ' (à terre)' : r.hp < r.maxHp * 0.35 ? ' (blessé)' : ''} `;
      g.text(Math.round(pr.u * cols - label.length / 2), Math.round(pr.v * rows), label, C.cyan, C.panel, 0.45);
      if (r.bubble && r.bubble.t > 0) { const b = ` « ${r.bubble.text.slice(0, 40)} » `; g.text(Math.round(pr.u * cols - b.length / 2), Math.round(pr.v * rows) - 1, b, C.white, C.panel, 0.8); }
    }
  }

  // suivi de la quête en cours : titre, étape, distance et direction
  const tq = game.quests.quests.find((x) => x.status === 'active');
  if (tq && !st.debug) {
    const ty = coop ? 3 : 2, tw = Math.min(46, cols - 4);
    g.text(1, ty, ` ◆ ${tq.title} `.slice(0, tw), C.yellow, C.panel, 0.65);
    g.text(1, ty + 1, `   ${tq.stages[tq.stage] ?? ''} `.slice(0, tw), C.text, C.panel, 0.55);
    if (tq.target && !game.dungeon) {
      const dx = tq.target.x - p.x, dz = tq.target.z - p.z, dist = Math.hypot(dx, dz);
      const card = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360) / 45) % 8];
      g.text(1, ty + 2, `   → ${dist > 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'} ${card} · ${tq.target.label} `.slice(0, tw), C.dim, C.panel, 0.55);
    }
  }

  // heure, météo, lieu
  const civ = game.world.civ, m = game.world.macro;
  const here = civ.settlements.find((s) => !s.abandoned && Math.hypot(s.x - p.x, s.z - p.z) < s.radius + 20);
  const region = m.regions[m.region[m.cellOf(p.x, p.z)]]?.name ?? '';
  const place = game.dungeon ? game.dungeon.layout.name : game.poss.atHome ? `♥ Chez vous · ${here?.name ?? ''}` : here ? here.name : region;
  const right = ` ${game.time.label()} · ${game.time.phase} · ${game.weather()} `;
  g.text(cols - right.length - 1, 0, right, C.text, C.panel, 0.6);
  g.text(cols - place.length - 3, 1, ` ${place} `, C.title, C.panel, 0.6);

  // cible et réticule
  const t = game.target;
  if (t && t.alive && Math.hypot(t.x - p.x, t.z - p.z) < 35) {
    const danger = t.mon && t.mon.level >= ch.level + 3;
    g.center(3, ` ${t.label}${danger ? ' — dangereux !' : ''} `, t.mon ? (danger ? C.magenta : C.red) : C.orange, C.panel);
    g.bar(Math.floor(cols / 2) - 8, 4, 16, t.hp / t.maxHp, C.hp, C.faint, C.panel);
  }
  const mid = Math.floor(rows / 2);
  g.text(Math.floor(cols / 2), mid, game.fight.charge > 0.42 && ch.weapon?.weapon?.kind !== 'arc' ? '*' : '+', p.blocking ? C.cyan : C.white);
  if (game.focus) {
    g.center(mid + 2, ` [E] ${game.focus.label} `, game.focus.t === 'entity' && game.focus.pick ? C.magenta : C.yellow, C.panel);
    const f = game.focus;
    if (f.t === 'entity' && f.hint) g.center(mid + 3, ` ${f.hint} `, C.cyan, C.panel);
    if ((f.t === 'prop' || f.t === 'bush') && f.hint) g.center(mid + 3, ` ${f.hint} `, f.t === 'prop' && f.danger ? C.red : f.t === 'bush' || (f.t === 'prop' && f.muted) ? C.dim : C.green, C.panel);
  }
  // monture : invite à monter, allure, essoufflement
  const mh = game.poss.hint();
  if (mh) g.center(mid + 4, ` ${mh.text} `, mh.color, C.panel);
  // souffle sous l'eau
  if (p.breath < 0.999 && !p.dead) {
    g.center(mid + 6, ' Souffle ', p.breath < 0.25 ? C.red : C.cyan, C.panel);
    g.bar(Math.floor(cols / 2) - 10, mid + 7, 20, p.breath, p.breath < 0.25 ? C.red : C.cyan, C.faint, C.panel);
  }
  // dégâts reçus : montant et direction de l'attaque
  if (p.hitT > 0 && !p.dead) {
    g.center(mid - 3, ` -${Math.round(p.hitAmount)} `, C.red, C.panel);
    if (p.hitDir !== null) {
      let a = p.hitDir - p.heading; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
      const dx = Math.round(Math.sin(a) * 12), dy = Math.round(-Math.cos(a) * 5);
      const arrow = Math.abs(a) < 0.4 ? '▲' : Math.abs(a) > 2.7 ? '▼' : a > 0 ? '►' : '◄';
      g.text(Math.floor(cols / 2) + dx, mid + dy, arrow, C.red, C.panel, 0.6);
    }
  }
  if (p.crouch && !p.dead && !p.swimming) {
    const w = game.watchers();
    const by = w.hunters[0]?.name ?? w.npcs[0]?.label;
    const txt = by ? ` ● Repéré par ${by} ` : ' ○ Caché ';
    g.center(mid + 5, txt, by ? C.red : C.green, C.panel);
  }
  if (!st.locked && !p.dead) g.center(mid + 7, ' Cliquez dans le jeu pour reprendre la souris ', C.white, C.panel);
  if (ch.weapon?.weapon?.kind === 'arc' && game.fight.charge > 0) g.bar(Math.floor(cols / 2) - 5, mid + 1, 10, Math.min(1, game.fight.charge / ch.bowDrawTime()), C.gold, C.faint);

  // bonus temporaires
  if (game.buffs.length) {
    const txt = game.buffs.map((b) => `${b.name} ${Math.floor(b.t / 60)}:${String(Math.floor(b.t % 60)).padStart(2, '0')}`).join(' · ');
    g.text(1, by - 2, ` ♥ ${txt} `, C.green, C.panel, 0.55);
  }
  // butin récupéré
  const feed = game.lootFeed.filter((l) => now - l.t < 6000);
  feed.forEach((l, i) => g.text(cols - l.text.length - 3, Math.floor(rows * 0.3) + i, ` ${l.text} `, l.color, C.panel, Math.max(0.2, 0.7 - (now - l.t) / 9000)));
  // montée de niveau
  if (game.banner) {
    const yb = Math.floor(rows * 0.2);
    g.center(yb, `  ◆ ${game.banner.text} ◆  `, game.banner.color ?? C.gold, C.panel);
    g.center(yb + 1, ` ${game.banner.sub} `.slice(0, cols - 2), C.text, C.panel);
    if (game.banner.sub2) g.center(yb + 2, ` ${game.banner.sub2} `.slice(0, cols - 2), Math.floor(now / 400) % 2 ? C.yellow : C.cyan, C.panel);
  }

  // messages : la pile reste à droite des barres de compagnons quand elles sont affichées (les lignes longues passent à la ligne)
  const mw = cols - (edge || 30), tw = Math.max(10, mw - 4);
  const msgs = st.log.filter((l) => now - l.t < 7000).flatMap((l) => TextGrid.wrap(l.text, tw).map((t) => ({ text: t.slice(0, tw), color: l.color }))).slice(-5);
  msgs.forEach((l, i) => g.text(cols - Math.min(mw, l.text.length + 2) - 1, rows - 1 - msgs.length + i, ` ${l.text} `, l.color, C.panel, 0.6));
  if (p.dead) { g.center(mid - 4, '  Vous êtes mort  ', C.red, C.black); g.center(mid - 3, game.poss.home() ? ' On vous ramènera chez vous… ' : ' On vous ramènera à l\'auberge… ', C.dim, C.black); }

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
