import type { EventBus } from '@ascii-fort/core/Events';
import type { World } from '@ascii-fort/worldgen/World';
import type { Character } from './Character';
import type { Reputation } from './Reputation';
import type { Economy } from './Economy';
import { GOOD_NAMES } from './Economy';
import type { EntityManager } from '../entities/EntityManager';
import type { GameTime } from '@ascii-fort/core/Time';
import type { Player } from '../entities/Player';
import type { NPCData } from '../entities/NPC';
import { de } from '@ascii-fort/worldgen/civilization/Names';
import { item } from './Items';

// Quêtes systémiques : elles naissent de l'état réel du monde (camp de bandits sur une route →
// pénurie chez un marchand ; tanière près d'un troupeau ; relique dans une crypte ; expédition
// disparue ; gobelins dans une mine) et leur résolution modifie le monde en retour.

export type QuestKind = 'bandits' | 'loups' | 'relique' | 'expédition' | 'mine';
export interface Quest {
  id: string; kind: QuestKind; giver: string; sid: number;
  title: string; summary: string;
  stage: number; stages: string[];
  status: 'disponible' | 'active' | 'terminée';
  target: { x: number; z: number; label: string } | null;
  reward: { gold: number; xp: number; item?: string };
  data: { campSid?: number; roadId?: number; lairKey?: string; dungeonId?: number; item?: string; count?: number; killed?: number; good?: string; poiId?: number };
}

export interface QuestHost {
  world: World<any>; events: EventBus; character: Character; rep: Reputation; economy: Economy;
  entities: EntityManager; time: GameTime; player: Player;
}

export class QuestSystem {
  quests: Quest[] = [];

  constructor(private h: QuestHost) {
    this.generate();
    const ev = h.events;
    ev.on('camp:cleared', ({ campId }) => {
      for (const q of this.active('bandits')) if (q.data.campSid === campId && q.stage < 2) this.setStage(q, 2);
    });
    ev.on('entity:killed', (k) => {
      if (k.killerId !== 'player') return;
      for (const q of this.active('loups')) {
        if (k.type === 'loup' && k.victimId.startsWith(q.data.lairKey + ':')) {
          q.data.killed = (q.data.killed ?? 0) + 1;
          q.stages[0] = `Abattre les loups de la tanière (${Math.min(q.data.killed, q.data.count!)}/${q.data.count})`;
          if (q.data.killed >= q.data.count! && q.stage === 0) this.setStage(q, 1);
          else ev.emit('quest:updated', { questId: q.id });
        }
      }
      for (const q of this.active('mine')) if (k.victimId.startsWith(`dj${q.data.dungeonId}:`) && (k.type === 'chef gobelin') && q.stage === 0) this.setStage(q, 1);
    });
    ev.on('item:picked', ({ itemId }) => {
      for (const q of this.quests) {
        if (q.status !== 'active' || q.data.item !== itemId) continue;
        if (q.kind === 'bandits' && q.stage < 2) this.setStage(q, 2);
        if ((q.kind === 'relique' || q.kind === 'expédition') && q.stage === 0) this.setStage(q, 1);
      }
    });
  }

  private active(kind: QuestKind): Quest[] { return this.quests.filter((q) => q.kind === kind && q.status === 'active'); }

  private npcWith(sid: number, profs: string[]): NPCData | undefined {
    const npcs = this.h.entities.npcsOf(sid);
    for (const p of profs) { const n = npcs.find((x) => x.profession === p && x.alive); if (n) return n; }
    return undefined;
  }

  /** Lit le monde et en tire les quêtes disponibles. */
  generate(): void {
    const { world, economy, entities } = this.h;
    const civ = world.civ;
    const start = civ.start;
    const near = (x: number, z: number, d: number) => Math.hypot(x - start.x, z - start.z) < d;
    // 1. route commerciale coupée par un camp de bandits
    for (const p of civ.pois) {
      if (p.kind !== 'camp de bandits' || p.roadId < 0) continue;
      const road = civ.roads[p.roadId];
      const ends = [road.a, road.b].sort((a, b) => (b === start.id ? 1 : 0) - (a === start.id ? 1 : 0)
        || (economy.shortages(b).some((x) => x.roadId === road.id) ? 1 : 0) - (economy.shortages(a).some((x) => x.roadId === road.id) ? 1 : 0));
      for (const sid of ends) {
        const s = civ.settlements[sid];
        if (!near(s.x, s.z, 3000)) continue;
        const giver = this.npcWith(sid, ['marchand', 'aubergiste', 'forgeron']);
        if (!giver) continue;
        const other = civ.settlements[sid === road.a ? road.b : road.a];
        const short = economy.shortages(sid).find((x) => x.roadId === road.id);
        const good = short ? GOOD_NAMES[short.good as keyof typeof GOOD_NAMES] : 'les marchandises';
        this.quests.push({
          id: `q:${sid}:bandits:${p.settlementId}`, kind: 'bandits', giver: giver.id, sid,
          title: `Les convois ${de(other.name)}`,
          summary: `${giver.first} ${giver.last} ne reçoit plus ${good} de ${other.name} : des bandits tiennent la route.`,
          stage: 0, status: 'disponible',
          stages: [`Enquêter sur la route entre ${s.name} et ${other.name}`, `Démanteler le camp des bandits`, `Revenir voir ${giver.first} (${s.name})`],
          target: { x: p.x, z: p.z, label: 'route attaquée' }, reward: { gold: 70, xp: 120, item: 'potion de soin' },
          data: { campSid: p.settlementId, roadId: road.id, item: `quête:marchandises:${p.settlementId}`, good: short?.good, poiId: p.id },
        });
        break;
      }
    }
    // 2. loups près des troupeaux
    for (const l of entities.lairs) {
      if (l.type !== 'loup') continue;
      const s = civ.settlements.filter((x) => !x.abandoned && x.type !== 'camp' && Math.hypot(x.x - l.x, x.z - l.z) < 1100).sort((a, b) => Math.hypot(a.x - l.x, a.z - l.z) - Math.hypot(b.x - l.x, b.z - l.z))[0];
      if (!s || !near(s.x, s.z, 3000)) continue;
      const giver = this.npcWith(s.id, ['fermier', 'chasseur', 'garde']);
      if (!giver) continue;
      this.quests.push({
        id: `q:${s.id}:loups:${l.poiId}`, kind: 'loups', giver: giver.id, sid: s.id, title: `Les loups ${de(s.name)}`,
        summary: `Une meute venue de la tanière voisine décime les bêtes ${de(s.name)}.`, stage: 0, status: 'disponible',
        stages: [`Abattre les loups de la tanière (0/${Math.max(1, l.alive)})`, `Revenir voir ${giver.first} (${s.name})`],
        target: { x: l.x, z: l.z, label: 'tanière' }, reward: { gold: 40, xp: 90, item: 'arc court' },
        data: { lairKey: l.key, count: Math.max(1, l.alive), killed: 0, poiId: l.poiId },
      });
    }
    // 3. relique de la crypte et 4. expédition perdue et 5. mine
    for (const d of civ.dungeons) {
      const poi = civ.pois[d.poiId];
      if (d.kind === 'crypte') {
        const s = civ.settlements.filter((x) => !x.abandoned && x.type !== 'camp').sort((a, b) => Math.hypot(a.x - poi.x, a.z - poi.z) - Math.hypot(b.x - poi.x, b.z - poi.z))[0];
        const giver = s && this.npcWith(s.id, ['prêtre', 'moine']);
        if (!s || !giver) continue;
        this.quests.push({
          id: `q:${s.id}:relique:${d.id}`, kind: 'relique', giver: giver.id, sid: s.id, title: `La relique de ${poi.name}`,
          summary: `Les morts de ${poi.name} ne reposent plus en paix. ${giver.first} veut que la relique des anciens seigneurs soit rapportée à la chapelle.`,
          stage: 0, status: 'disponible', stages: [`Explorer ${poi.name} et trouver la relique`, `Rapporter la relique à ${giver.first} (${s.name})`],
          target: { x: poi.x, z: poi.z, label: poi.name }, reward: { gold: 90, xp: 160, item: 'grande potion de soin' },
          data: { dungeonId: d.id, item: `quête:relique:${d.id}`, poiId: poi.id },
        });
      }
      if (d.kind === 'forteresse') {
        const exp = civ.events.find((e) => e.kind === 'expédition' && e.pois.includes(poi.id));
        if (!exp) continue;
        const town = exp.places[0];
        const kin = entities.npcsOf(town).find((n) => n.goal.startsWith('retrouver'));
        if (!kin) continue;
        this.quests.push({
          id: `q:${town}:expédition:${d.id}`, kind: 'expédition', giver: kin.id, sid: town, title: exp.title,
          summary: `${kin.first} ${kin.last} ${kin.goal.replace('retrouver', 'cherche à retrouver')}.`, stage: 0, status: 'disponible',
          stages: [`Fouiller ${poi.name}`, `Rapporter ce que vous avez trouvé à ${kin.first} (${civ.settlements[town].name})`],
          target: { x: poi.x, z: poi.z, label: poi.name }, reward: { gold: 120, xp: 250 },
          data: { dungeonId: d.id, item: `quête:journal:${d.id}`, poiId: poi.id },
        });
      }
      if (d.kind === 'mine' && poi.settlementId >= 0) {
        const s = civ.settlements[poi.settlementId];
        const giver = this.npcWith(s.id, ['mineur', 'forgeron', 'garde']);
        if (!giver) continue;
        this.quests.push({
          id: `q:${s.id}:mine:${d.id}`, kind: 'mine', giver: giver.id, sid: s.id, title: `Les galeries ${de(s.name)}`,
          summary: `Des gobelins ont envahi les galeries ${de(s.name)} : plus de minerai, plus de travail.`, stage: 0, status: 'disponible',
          stages: [`Vaincre le chef gobelin dans ${d.name}`, `Revenir voir ${giver.first} (${s.name})`],
          target: { x: poi.x, z: poi.z, label: d.name }, reward: { gold: 80, xp: 150, item: 'casque de fer' },
          data: { dungeonId: d.id, poiId: poi.id },
        });
      }
    }
  }

  offerFor(npcId: string): Quest | undefined { return this.quests.find((q) => q.giver === npcId && q.status === 'disponible'); }
  activeFor(npcId: string): Quest | undefined { return this.quests.find((q) => q.giver === npcId && q.status === 'active'); }
  canTurnIn(q: Quest): boolean { return q.status === 'active' && q.stage === q.stages.length - 1; }

  accept(q: Quest): void {
    q.status = 'active'; q.stage = 0;
    this.h.events.emit('quest:started', { questId: q.id });
    this.h.events.emit('message', { text: `Nouvelle quête : ${q.title}`, color: 0xf0d060 });
    // l'objet a peut-être déjà été trouvé
    if (q.data.item && this.h.character.inv.count(q.data.item)) this.setStage(q, q.kind === 'bandits' ? 2 : 1);
    if (q.kind === 'bandits' && q.data.campSid !== undefined && this.h.entities.clearedCamps.has(q.data.campSid)) this.setStage(q, 2);
  }

  setStage(q: Quest, s: number): void {
    q.stage = s;
    if (s >= q.stages.length - 1) {
      const giver = this.h.entities.findNpc(q.giver);
      if (giver) { const st = this.h.world.civ.settlements[giver.sid]; q.target = { x: st.x, z: st.z, label: `${giver.first} (${st.name})` }; }
    }
    this.h.events.emit('quest:updated', { questId: q.id });
    this.h.events.emit('message', { text: `Quête — ${q.title} : ${q.stages[s]}`, color: 0xf0d060 });
  }

  /** Restaure l'état d'une quête (chargement) sans message. */
  restore(id: string, status: Quest['status'], stage: number, killed: number): void {
    const q = this.quests.find((x) => x.id === id);
    if (!q) return;
    q.status = status; q.stage = stage; q.data.killed = killed;
    if (q.kind === 'loups') q.stages[0] = `Abattre les loups de la tanière (${Math.min(killed, q.data.count!)}/${q.data.count})`;
    if (stage >= q.stages.length - 1) {
      const giver = this.h.entities.findNpc(q.giver);
      if (giver) { const st = this.h.world.civ.settlements[giver.sid]; q.target = { x: st.x, z: st.z, label: `${giver.first} (${st.name})` }; }
    }
  }

  /** Vérifications de position (repérage du camp). */
  tick(): void {
    const p = this.h.player;
    for (const q of this.active('bandits')) {
      if (q.stage === 0 && q.target && Math.hypot(q.target.x - p.x, q.target.z - p.z) < 170) {
        this.setStage(q, 1);
        this.h.events.emit('message', { text: 'Des traces de chariots mènent hors de la route… un campement.', color: 0xc8c8bc });
      }
    }
  }

  /** Récompense et conséquences ; renvoie le texte de remerciement. */
  turnIn(q: Quest): string {
    const { character: ch, events } = this.h;
    q.status = 'terminée';
    if (q.data.item && ch.inv.count(q.data.item)) ch.inv.remove(q.data.item);
    ch.inv.gold += q.reward.gold;
    if (q.reward.item) ch.inv.add(q.reward.item);
    const ups = ch.gainXp(q.reward.xp);
    events.emit('player:helped', { npcId: q.giver, magnitude: 1, reason: `Le voyageur a réglé l'affaire : ${q.title}.` });
    events.emit('quest:completed', { questId: q.id });
    events.emit('message', { text: `Quête terminée : ${q.title} (+${q.reward.gold} or, +${q.reward.xp} XP${q.reward.item ? ', ' + item(q.reward.item).name : ''})`, color: 0xf0d060 });
    if (ups) events.emit('message', { text: `Niveau ${ch.level} !`, color: 0xf0d060 });
    return q.kind === 'bandits' ? 'Les convois vont pouvoir reprendre. Les prix redescendront d\'ici quelques jours. Merci, vraiment.'
      : q.kind === 'loups' ? 'Mes bêtes vont enfin dormir tranquilles. Prends ça, tu l\'as mérité.'
      : q.kind === 'relique' ? 'Les anciens seigneurs vont enfin reposer en paix. Que la lumière te garde.'
      : q.kind === 'expédition' ? 'Alors c\'est fini… Au moins, je sais. Merci de me l\'avoir rapporté.'
      : 'Les galeries vont rouvrir. Tout le village te doit une fière chandelle.';
  }
}
