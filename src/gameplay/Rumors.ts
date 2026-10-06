import type { EventBus } from '../core/Events';
import type { Civilization } from '../world/civilization/Civilization';
import { de } from '../world/civilization/Names';

// Rumeurs : nées d'un lieu, elles se propagent de village en village le long des routes
// et s'éteignent avec le temps. Les PNJ ne connaissent que celles arrivées chez eux.

export interface Rumor { id: number; text: string; origin: number; day: number; reach: Set<number>; tag: string }

export class Rumors {
  readonly list: Rumor[] = [];
  private n = 0;

  constructor(private civ: Civilization, events: EventBus, private today: () => number) {
    const near = (x: number, z: number) => civ.settlements.filter((s) => !s.abandoned && s.type !== 'camp')
      .reduce((a, b) => (Math.hypot(a.x - x, a.z - z) < Math.hypot(b.x - x, b.z - z) ? a : b));
    // rumeurs initiales : tirées de l'état réel du monde
    for (const p of civ.pois) {
      if (p.kind === 'camp de bandits' && p.roadId >= 0) {
        const r = civ.roads[p.roadId], a = civ.settlements[r.a], b = civ.settlements[r.b];
        this.add(`Des bandits détroussent les voyageurs sur la route entre ${a.name} et ${b.name}. Les convois n'arrivent plus.`, r.a, `camp:${p.settlementId}`, -2);
        this.add(`On ne prend plus la route de ${a.name} sans escorte, à cause des bandits.`, r.b, `camp:${p.settlementId}`, -2);
      }
      if (p.kind === 'antre du troll') this.add(`Les bergers parlent d'une bête énorme dans les montagnes, celle qui a rasé un hameau.`, near(p.x, p.z).id, 'troll', -5);
      if (p.kind === 'tanière de loups') this.add(`Les loups rôdent près des fermes la nuit. Fermez bien les bergeries.`, near(p.x, p.z).id, `loups:${p.id}`, -1);
      if (p.kind === 'crypte') this.add(`Il paraît que des lueurs bougent la nuit autour de ${p.name}.`, near(p.x, p.z).id, `crypte:${p.id}`, -3);
      if (p.kind === 'mine') this.add(`Les mineurs ne descendent plus dans les galeries basses : des gobelins y ont fait leur nid.`, p.settlementId, `mine:${p.id}`, -4);
    }
    for (const e of civ.events) {
      if (e.kind === 'expédition' && e.places[0] !== undefined) this.add(`${e.text} Leur famille attend toujours.`, e.places[0], `expé:${e.id}`, -10);
      if (e.kind === 'révolte' && e.places[0] !== undefined) this.add(`Depuis la révolte ${de(civ.settlements[e.places[0]].name)}, les impôts n'ont pas baissé, et la colère gronde.`, e.places[0], 'révolte', -8);
    }
    // rumeurs nées des actes du joueur
    events.on('camp:cleared', ({ campId }) => {
      const p = civ.pois.find((x) => x.settlementId === campId);
      const r = p ? civ.roads[p.roadId] : undefined;
      if (r) this.add(`Un voyageur aurait chassé les bandits de la route entre ${civ.settlements[r.a].name} et ${civ.settlements[r.b].name} ! Les convois reprennent.`, r.a, `camp-libre:${campId}`);
      for (const x of this.list) if (x.tag === `camp:${campId}`) x.day = -999; // l'ancienne rumeur s'éteint
    });
    events.on('player:crime', (c) => {
      if (c.settlementId === undefined || !c.witnesses.length) return;
      const s = civ.settlements[c.settlementId];
      this.add(c.type === 'vol' ? `Un étranger a volé chez des gens ${de(s.name)}. Gardez vos coffres fermés.` : `Un étranger a versé le sang ${s.name.match(/^[AEIOUY]/i) ? "à " : 'à '}${s.name} !`, c.settlementId, 'crime');
    });
    events.on('entity:killed', (k) => {
      if (k.killerId === 'player' && k.type === 'troll') this.add('La bête des montagnes est morte ! Un voyageur l\'a abattue.', near(k.x, k.z).id, 'troll-mort');
    });
    events.on('quest:completed', ({ questId }) => {
      const sid = parseInt(questId.split(':')[1] ?? '-1', 10);
      if (sid >= 0 && civ.settlements[sid]) this.add(`On dit beaucoup de bien d'un voyageur passé ${de(civ.settlements[sid].name).replace(/^de /, 'par ').replace(/^d'/, "par ")}.`, sid, 'gloire');
    });
  }

  add(text: string, origin: number, tag: string, ageDays = 0): void {
    if (origin < 0) return;
    const r: Rumor = { id: this.n++, text, origin, day: this.today() + ageDays, reach: new Set([origin]), tag };
    // une rumeur ancienne a déjà voyagé
    for (let d = 0; d < -ageDays; d++) this.spread(r);
    this.list.push(r);
  }

  private spread(r: Rumor): void {
    const add: number[] = [];
    for (const road of this.civ.roads) {
      if (r.reach.has(road.a) && !r.reach.has(road.b) && (road.id + r.id + r.reach.size) % 2 === 0) add.push(road.b);
      if (r.reach.has(road.b) && !r.reach.has(road.a) && (road.id + r.id + r.reach.size) % 2 === 0) add.push(road.a);
    }
    for (const s of add) r.reach.add(s);
  }

  /** Une fois par jour : propagation et oubli. */
  dailyTick(): void {
    const day = this.today();
    for (const r of this.list) this.spread(r);
    for (let i = this.list.length - 1; i >= 0; i--) if (day - this.list[i].day > 25) this.list.splice(i, 1);
  }

  known(sid: number): Rumor[] { return this.list.filter((r) => r.reach.has(sid)); }
}
