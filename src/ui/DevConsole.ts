import { C } from '../rendering/TextGrid';
import type { Screen, UICtx } from './UI';
import type { Game } from '../core/Game';
import type { Input } from '../core/Input';
import { ITEMS, item } from '../gameplay/Items';
import { makeMonster, MONSTERS } from '../entities/Monster';
import { GENERATOR_VERSION } from '../version';
import { blockAt } from '../ai/Schedule';
import { MACRO } from '../world/constants';
import type { WeatherState } from '../gameplay/Weather';

// Console de développement (F1) : téléportation, temps, god mode, IA figée, apparitions,
// vues de débogage, informations sur les PNJ, météo, objets…

const HELP = [
  'tp <x> <z> | tp <lieu> | tp départ      téléportation',
  'time <hh[:mm]> | timescale <n>          heure / vitesse du temps',
  'god | freeze | noclip | heal            invulnérable, IA figée, vol libre, soin',
  'spawn <créature> [n]                    créatures : ' + Object.keys(MONSTERS).join(', '),
  'view <normal|depth|normals|material|light>   vues de débogage',
  'chunks | seed | npc | quests | reveal   bords de chunks, seed, PNJ visé, quêtes, carte entière',
  'weather <clair|couvert|pluie|brouillard|orage|neige|auto>',
  'give <objet> [n] | gold <n> | xp <n>    objets, or, expérience',
];

export class DevConsole implements Screen {
  modal = true;
  private line = '';
  private out: { text: string; color: number }[] = [{ text: 'Console de développement — « help » pour la liste des commandes.', color: C.dim }];
  private history: string[] = [];
  private hi = -1;

  constructor(private game: Game, private inp: Input, private onClose: () => void) {
    inp.textSink = (e) => {
      if (e.key === 'Escape' || e.key === 'F1') { this.close(); return true; }
      if (e.key === 'Enter') { this.run(this.line); this.history.unshift(this.line); this.hi = -1; this.line = ''; return true; }
      if (e.key === 'Backspace') { this.line = this.line.slice(0, -1); return true; }
      if (e.key === 'ArrowUp') { this.hi = Math.min(this.history.length - 1, this.hi + 1); this.line = this.history[this.hi] ?? ''; return true; }
      if (e.key === 'ArrowDown') { this.hi = Math.max(-1, this.hi - 1); this.line = this.hi < 0 ? '' : this.history[this.hi]; return true; }
      if (e.key.length === 1) { this.line += e.key; return true; }
      return false;
    };
  }
  private closing = false;
  private close() { this.inp.textSink = null; this.closing = true; this.onClose(); }
  private print(text: string, color = C.text) { this.out.push({ text, color }); if (this.out.length > 200) this.out.shift(); }

  private run(cmd: string) {
    const g = this.game, p = g.player, [c0, ...args] = cmd.trim().split(/\s+/);
    const c = (c0 ?? '').toLowerCase();
    this.print('> ' + cmd, C.yellow);
    const tp = (x: number, z: number) => {
      if (g.dungeon) g.exitDungeon();
      p.x = x; p.z = z; g.world.chunks.update(x, z, -1); p.y = g.world.heightAt(x, z) + 0.3; p.vy = 0;
      this.print(`téléporté en ${x.toFixed(0)} ${z.toFixed(0)}`);
    };
    switch (c) {
      case 'help': case '?': HELP.forEach((h) => this.print(h, C.dim)); break;
      case 'tp': {
        if (args.length >= 2 && !isNaN(+args[0])) { tp(+args[0], +args[1]); break; }
        const q = args.join(' ').toLowerCase();
        const civ = g.world.civ;
        if (q === 'départ' || q === 'depart') { const s = g.world.spawn(); tp(s.x, s.z); break; }
        const s = civ.settlements.find((x) => x.name.toLowerCase().includes(q));
        const poi = civ.pois.find((x) => x.name.toLowerCase().includes(q) || x.kind.includes(q));
        const t = s ?? poi;
        if (t) { tp(t.x + 6, t.z + 6); this.print(`→ ${'name' in t ? t.name : ''}`); } else this.print('lieu inconnu', C.red);
        break;
      }
      case 'time': { const [hh, mm] = (args[0] ?? '12').split(':').map(Number); g.time.setClock(hh || 0, mm || 0); this.print(g.time.label()); break; }
      case 'timescale': g.time.scale = Math.max(0, +args[0] || 1); this.print(`×${g.time.scale}`); break;
      case 'god': g.god = !g.god; this.print(`god ${g.god ? 'activé' : 'désactivé'}`); break;
      case 'freeze': g.entities.frozen = !g.entities.frozen; this.print(`IA ${g.entities.frozen ? 'figée' : 'active'}`); break;
      case 'noclip': p.noclip = !p.noclip; this.print(`noclip ${p.noclip ? 'activé' : 'désactivé'}`); break;
      case 'heal': p.hp = p.maxHp; p.stamina = p.maxStamina; p.mana = p.maxMana; p.poison = 0; this.print('soigné'); break;
      case 'spawn': {
        const type = args[0] ?? 'loup', n = Math.min(10, +args[1] || 1);
        if (!MONSTERS[type]) { this.print('créature inconnue', C.red); break; }
        for (let i = 0; i < n; i++) {
          const x = p.x + Math.sin(p.heading) * 8 + i, z = p.z - Math.cos(p.heading) * 8;
          const e = makeMonster(`dev:${type}:${Date.now() % 100000}:${i}`, type, x, z, x, z, 40);
          e.y = g.dungeon ? 0 : g.world.heightAt(x, z);
          g.entities.entities.push(e);
        }
        this.print(`${n} × ${type}`);
        break;
      }
      case 'seed': this.print(`World: ${g.seed.text} · Generator: ${GENERATOR_VERSION} · ${g.world.macro.worldName}`); break;
      case 'view': { const m: Record<string, number> = { normal: 0, depth: 1, normals: 2, material: 3, light: 4 }; g.viewMode = m[args[0]] ?? 0; this.print(`vue ${args[0] ?? 'normal'}`); break; }
      case 'chunks': g.showChunks = !g.showChunks; this.print(`bords de chunks ${g.showChunks ? 'visibles' : 'masqués'}`); break;
      case 'npc': {
        const e = g.focus?.t === 'entity' ? g.focus.e : g.target;
        const n = e?.npc;
        if (!n) { this.print('visez un PNJ', C.red); break; }
        const b = blockAt(n, g.time.minuteOfDay);
        this.print(`${n.first} ${n.last}, ${n.age} ans, ${n.profession} · ${g.world.civ.settlements[n.sid].name} · ${g.world.civ.factions[n.factionId]?.name ?? '—'}`);
        this.print(`traits : ${Object.entries(n.traits).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`, C.dim);
        this.print(`activité : ${b.act} (${b.place}) · action ${e!.action} · opinion ${g.rep.opinion(n).toFixed(0)} (${g.rep.mood(n)}) · richesse ${n.wealth}`, C.dim);
        this.print(`objectif : ${n.goal} · relations ${n.relations.length} · connaissances ${n.knowledge.length} · souvenirs ${n.memories.length}`, C.dim);
        break;
      }
      case 'quests': g.quests.quests.forEach((q) => this.print(`${q.status.padEnd(10)} ${q.title} — ${q.stages[q.stage]}`, q.status === 'active' ? C.yellow : C.dim)); break;
      case 'reveal': g.state.explored.fill(1); for (const s of g.world.civ.settlements) g.state.discovered.add(`settlement:${s.id}`); for (const x of g.world.civ.pois) g.state.discovered.add(`poi:${x.id}`); this.print(`carte révélée (${MACRO}×${MACRO})`); break;
      case 'weather': g.weatherOverride = args[0] && args[0] !== 'auto' ? (args[0] as WeatherState) : null; this.print(`météo ${args[0] ?? 'auto'}`); break;
      case 'give': {
        const name = args.filter((a) => isNaN(+a)).join(' '), n = +args[args.length - 1] || 1;
        const id = [...ITEMS.keys()].find((k) => k === name) ?? [...ITEMS.keys()].find((k) => k.includes(name));
        if (!id) { this.print('objet inconnu', C.red); break; }
        g.character.inv.add(id, n); this.print(`+${n} ${item(id).name}`);
        break;
      }
      case 'gold': g.character.inv.gold += +args[0] || 100; this.print(`${g.character.inv.gold} or`); break;
      case 'xp': { const ups = g.character.gainXp(+args[0] || 100); g.syncStats(); this.print(`niveau ${g.character.level}${ups ? ` (+${ups})` : ''}`); break; }
      case '': break;
      default: this.print('commande inconnue (help)', C.red);
    }
  }

  draw(ctx: UICtx): void {
    const g = ctx.grid, h = Math.min(g.rows - 2, 22), w = g.cols - 2;
    g.box(1, 0, w, h, { title: 'Console (F1)', alpha: 0.92 });
    const lines = this.out.slice(-(h - 3));
    lines.forEach((l, i) => g.text(3, 1 + i, l.text.slice(0, w - 4), l.color));
    g.text(3, h - 2, `> ${this.line}${Math.floor(performance.now() / 500) % 2 ? '▌' : ' '}`.slice(0, w - 4), C.white);
  }
  input(ctx: UICtx): void { if (this.closing) { this.closing = false; ctx.close(); } }
}
