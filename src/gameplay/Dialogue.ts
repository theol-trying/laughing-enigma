import type { NPCData } from '../entities/NPC';
import type { Entity } from '../entities/Entity';
import type { World } from '../world/World';
import type { Reputation } from './Reputation';
import type { Economy } from './Economy';
import { GOOD_NAMES } from './Economy';
import type { Rumors } from './Rumors';
import type { QuestSystem } from './QuestSystem';
import type { GameTime } from '../core/Time';
import type { WorldState } from './WorldState';
import { hash2i } from '../core/RNG';
import { de } from '../world/civilization/Names';

// Dialogues procéduraux : modèles + règles, à partir de l'identité du PNJ, de son métier, de ses
// traits, du lieu, de l'heure, de ses souvenirs, des rumeurs locales, de ce qu'il sait du monde
// et des quêtes. Un fermier parle de ce qu'un fermier du coin peut savoir.

export interface DialogueOption { label: string; go: () => DialogueNode | null }
export interface DialogueNode { speaker: string; sub: string; mood: string; lines: string[]; options: DialogueOption[] }

export interface DialogueHost {
  world: World<any>; rep: Reputation; economy: Economy; rumors: Rumors; quests: QuestSystem; time: GameTime; state: WorldState;
  weather(): string;
  openTrade(e: Entity): void;
  payFine(sid: number): boolean;
  resistArrest(sid: number): void;
}

const DIRS = ['au nord', 'au nord-est', "à l'est", 'au sud-est', 'au sud', 'au sud-ouest', "à l'ouest", 'au nord-ouest'];
export function direction(fx: number, fz: number, tx: number, tz: number): string {
  const a = Math.atan2(tx - fx, -(tz - fz)); // 0 = nord, sens horaire
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
export function distance(d: number): string {
  return d < 300 ? 'tout près d\'ici' : d < 1000 ? "à un quart de lieue" : d < 2500 ? 'à une demi-lieue' : d < 5000 ? 'à une bonne lieue' : 'loin, très loin';
}

export class DialogueSystem {
  private told = new Map<string, Set<string>>(); // ce que chaque PNJ a déjà raconté

  constructor(private h: DialogueHost) {}

  private pick<T>(n: NPCData, topic: number, list: T[]): T {
    return list[hash2i(n.id.length * 977 + n.id.charCodeAt(n.id.length - 1), this.h.time.day * 31 + topic, n.age) % list.length];
  }

  start(e: Entity): DialogueNode {
    const n = e.npc!, h = this.h;
    const mood = h.rep.mood(n);
    const bounty = h.rep.bounty.get(n.sid) ?? 0;
    if ((n.profession === 'garde' || n.profession === 'soldat') && bounty > 0) return this.arrest(e, bounty);
    const lines = [this.greeting(n, mood)];
    const mem = n.memories.filter((m) => m.subject === 'joueur').slice(-1)[0];
    if (mem) lines.push(mem.weight > 0 ? `Je n'ai pas oublié ce que tu as fait pour nous.` : mem.kind === 'vol' ? 'Je t\'ai à l\'œil, voleur.' : 'Je me souviens de toi. Et pas en bien.');
    if (mood === 'hostile') return { ...this.head(e, mood), lines: [...lines, 'Passe ton chemin. Je n\'ai rien à te dire.'], options: [{ label: 'Partir', go: () => null }] };
    return { ...this.head(e, mood), lines, options: this.menu(e) };
  }

  private head(e: Entity, mood: string) {
    const n = e.npc!;
    const s = this.h.world.civ.settlements[n.sid];
    return { speaker: `${n.first} ${n.last}`, sub: `${n.profession}${n.profession === 'voyageur' ? '' : ' · ' + s.name} · ${n.age} ans`, mood };
  }

  private greeting(n: NPCData, mood: string): string {
    const hr = this.h.time.hour, w = this.h.weather();
    const hello = hr < 5 || hr >= 21 ? 'Bonsoir' : hr < 12 ? 'Bonjour' : 'Le bonjour';
    const extra = w === 'pluie' || w === 'orage' ? ' Sale temps, hein ?' : hr >= 21 || hr < 5 ? ' Il est tard pour traîner dehors.' : '';
    if (mood === 'amical') return this.pick(n, 1, [`Ah, te revoilà ! ${hello} !`, `${hello}, l'ami !${extra}`, `Content de te voir.${extra}`]);
    if (mood === 'méfiant') return this.pick(n, 1, ['Hmm. Qu\'est-ce que tu veux ?', `${hello}… Fais vite.`]);
    return this.pick(n, 1, [`${hello}, voyageur.${extra}`, `${hello}. Tu n'es pas d'ici, toi.${extra}`, `${hello}.${extra} Je peux t'aider ?`]);
  }

  private menu(e: Entity): DialogueOption[] {
    const n = e.npc!, h = this.h, back = () => this.again(e);
    const opts: DialogueOption[] = [];
    const offer = h.quests.offerFor(n.id), active = h.quests.activeFor(n.id);
    if (offer) opts.push({ label: 'Tu as l\'air soucieux…', go: () => this.questOffer(e) });
    if (active) opts.push({ label: h.quests.canTurnIn(active) ? `À propos de « ${active.title} »… c'est réglé.` : `À propos de « ${active.title} »…`, go: () => this.questProgress(e) });
    opts.push({ label: 'Parle-moi de toi.', go: () => this.node(e, this.about(n), back) });
    opts.push({ label: 'Comment vont les affaires ?', go: () => this.node(e, this.job(n), back) });
    opts.push({ label: 'Quelles nouvelles ?', go: () => this.node(e, this.news(n), back) });
    opts.push({ label: 'Que sais-tu des environs ?', go: () => this.node(e, this.surroundings(n), back) });
    if (n.knowledge.some((k) => k.startsWith('event:'))) opts.push({ label: 'Raconte-moi le passé de la région.', go: () => this.node(e, this.past(n), back) });
    if (h.economy.stock(n, h.time.day).length) opts.push({ label: 'Montre-moi tes marchandises.', go: () => { h.openTrade(e); return null; } });
    opts.push({ label: 'Au revoir.', go: () => null });
    return opts;
  }

  private again(e: Entity): DialogueNode {
    return { ...this.head(e, this.h.rep.mood(e.npc!)), lines: [this.pick(e.npc!, 9, ['Autre chose ?', 'Oui ?', 'Je t\'écoute.'])], options: this.menu(e) };
  }

  private node(e: Entity, lines: string[], back: () => DialogueNode | null): DialogueNode {
    return { ...this.head(e, this.h.rep.mood(e.npc!)), lines, options: [{ label: 'Autre chose…', go: back }, { label: 'Au revoir.', go: () => null }] };
  }

  private about(n: NPCData): string[] {
    const civ = this.h.world.civ, s = civ.settlements[n.sid];
    const years = Math.max(1, Math.min(n.age - 15, (n.age * 7) % 30 + 2));
    const spouse = n.relations.find((r) => r.kind === 'époux');
    const sp = spouse ? this.h.world ? undefined : undefined : undefined;
    void sp;
    const out = [n.profession === 'voyageur' ? `Je ne fais que passer. Je suis sur les routes depuis ${years} ans.` : `Je suis ${n.profession}${n.sex === 'f' && n.profession === 'fermier' ? 'e' : ''} ici, à ${s.name}, depuis ${years} ans.`];
    if (spouse) out.push('Ma famille vit ici avec moi.');
    out.push(n.goal.startsWith('retrouver') ? `Je n'ai qu'une idée en tête : ${n.goal}.` : `Ce que je veux ? ${n.goal.charAt(0).toUpperCase() + n.goal.slice(1)}.`);
    if (n.traits.piety > 0.8) out.push('Je prie chaque soir à la chapelle.');
    if (n.traits.greed > 0.8) out.push('Et je ne crache pas sur une pièce bien gagnée.');
    return out;
  }

  /** Le métier, relié à ce qui se passe réellement autour. */
  private job(n: NPCData): string[] {
    const h = this.h, civ = h.world.civ, s = civ.settlements[n.sid];
    const shortages = h.economy.shortages(n.sid);
    const wolves = h.world.civ.pois.find((p) => p.kind === 'tanière de loups' && Math.hypot(p.x - s.x, p.z - s.z) < 1100);
    const river = civ.macro.hydro.rivers.find((r) => s.reasons.includes(`au bord de ${r.name}`));
    switch (n.profession) {
      case 'fermier': return [wolves ? 'Les loups ont encore emporté deux brebis la nuit dernière. Ils viennent de la tanière dans les bois, ' + direction(s.x, s.z, wolves.x, wolves.z) + '.' : 'La terre est bonne, cette année.', this.pick(n, 2, ['Il faudrait de la pluie pour le blé.', 'Tant que le temps tient, la récolte sera belle.'])];
      case 'forgeron': {
        const fer = shortages.find((x) => x.good === 'fer' || x.good === 'minerai' || x.good === 'outils');
        if (fer) return [`Je manque de ${fer.good === 'outils' ? 'métal' : 'fer'}. Il venait de ${civ.settlements[fer.from].name} par la route… mais plus rien n'arrive depuis que les bandits la tiennent.`, 'Sans métal, pas d\'épées. Et sans épées, qui nous défendra ?'];
        return ['Le travail ne manque pas : socs, fers à cheval, et quelques lames pour les gardes.', 'Si tu as besoin d\'une arme, tu sais où me trouver.'];
      }
      case 'marchand': case 'aubergiste': {
        const sh = shortages[0];
        if (sh) {
          const from = civ.settlements[sh.from].name;
          const gn = GOOD_NAMES[sh.good], pl = gn.startsWith('les ');
          return [`${gn.charAt(0).toUpperCase() + gn.slice(1)} n'arrive${pl ? 'nt' : ''} plus de ${from}. Les convois se font attaquer sur la route.`, 'Du coup, je dois vendre plus cher. Ça ne plaît à personne, à moi le premier.'];
        }
        return n.profession === 'aubergiste' ? ['Les voyageurs vont et viennent. Une chambre, c\'est dix pièces la nuit.', 'Et la soupe est chaude.'] : ['Les affaires vont, les routes sont sûres. Pourvu que ça dure.'];
      }
      case 'garde': case 'soldat': {
        const dangers = civ.pois.filter((p) => ['camp de bandits', 'antre du troll', 'tanière de loups'].includes(p.kind) && Math.hypot(p.x - s.x, p.z - s.z) < 2500);
        const d = dangers[0];
        return [d ? `Méfie-toi : ${d.kind === 'camp de bandits' ? 'des bandits tiennent un camp' : d.kind === 'antre du troll' ? 'une bête monstrueuse vit dans les montagnes' : 'une meute rôde'} ${direction(s.x, s.z, d.x, d.z)}, ${distance(Math.hypot(d.x - s.x, d.z - s.z))}.` : 'Tout est calme. Trop calme, peut-être.', 'La nuit, on double les rondes.'];
      }
      case 'prêtre': case 'moine': {
        const crypt = civ.pois.find((p) => p.kind === 'crypte' && Math.hypot(p.x - s.x, p.z - s.z) < 2000);
        return crypt ? [`${crypt.name}… ${crypt.why.charAt(0).toUpperCase() + crypt.why.slice(1)}.`, 'Depuis quelque temps, les morts n\'y reposent plus en paix.'] : ['Les fidèles se font rares. Les temps sont durs.'];
      }
      case 'chasseur': return [wolves ? `Le gibier fuit les bois ${direction(s.x, s.z, wolves.x, wolves.z)} : une meute de loups s'y est installée.` : 'Le gibier est abondant ces temps-ci.', 'Je vends des peaux, et parfois un arc.'];
      case 'meunier': return [river ? `${river.name.charAt(0).toUpperCase() + river.name.slice(1)} fait tourner ma roue depuis toujours.` : 'Le moulin tourne.', 'Le grain arrive des fermes autour.'];
      case 'pêcheur': return [river ? `Le poisson remonte ${river.name}, en ce moment.` : 'La pêche est bonne.'];
      case 'guérisseuse': return ['Les herbes du marais soignent bien des maux… mais attention aux araignées qui y vivent.', 'Si tu as besoin de potions, j\'en prépare.'];
      case 'mineur': return ['On ne descend plus dans les galeries basses. Des gobelins y ont fait leur nid.', 'Sans minerai, le village va crever de faim.'];
      case 'noble': {
        const enemy = civ.factions.find((f) => f.kind === 'royaume' && s.factionId >= 0 && (civ.factions[s.factionId]?.relations[f.id] ?? 0) < -0.3);
        return [enemy ? `Le ${enemy.name} n'a jamais digéré sa défaite. Il faudra un jour en finir.` : 'La paix tient. Pour l\'instant.'];
      }
      case 'voyageur': {
        const from = n.knowledge.find((k) => k.startsWith('settlement:'));
        const t = from ? civ.settlements[parseInt(from.split(':')[1], 10)] : undefined;
        const r = t ? this.h.rumors.known(t.id)[0] : undefined;
        return [t ? `J'arrive de ${t.name}.` : 'Je viens de loin.', r ? `Là-bas, on raconte que… ${r.text}` : 'Les routes sont longues et les auberges rares.'];
      }
      default: return ['On fait aller. Le travail ne manque pas.'];
    }
  }

  private news(n: NPCData): string[] {
    const told = this.told.get(n.id) ?? new Set<string>();
    this.told.set(n.id, told);
    const known = this.h.rumors.known(n.sid).filter((r) => !told.has(String(r.id)));
    if (!known.length) return [this.pick(n, 4, ['Rien de neuf sous le soleil.', 'Pas grand-chose, à part les ragots habituels.'])];
    const r = known[hash2i(n.age, this.h.time.day, known.length) % known.length];
    told.add(String(r.id));
    return [this.pick(n, 5, ['Tu n\'as pas entendu ?', 'Il paraît que…', 'On raconte que…']), r.text];
  }

  private surroundings(n: NPCData): string[] {
    const h = this.h, civ = h.world.civ, s = civ.settlements[n.sid];
    const out: string[] = [];
    const pois = n.knowledge.filter((k) => k.startsWith('poi:')).map((k) => civ.pois[parseInt(k.split(':')[1], 10)])
      .filter((p) => p && p.kind !== 'pont').sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    for (const p of pois.slice(0, 3)) {
      out.push(`${p.name} : ${distance(Math.hypot(p.x - s.x, p.z - s.z))}, ${direction(s.x, s.z, p.x, p.z)}. ${p.why.charAt(0).toUpperCase() + p.why.slice(1)}.`);
      h.state.discovered.add(`poi:${p.id}`);
    }
    const near = n.knowledge.filter((k) => k.startsWith('settlement:')).map((k) => civ.settlements[parseInt(k.split(':')[1], 10)]).filter(Boolean)[0];
    if (near) { out.push(`La route mène à ${near.name}, ${direction(s.x, s.z, near.x, near.z)}.`); h.state.discovered.add(`settlement:${near.id}`); }
    if (!out.length) out.push('Je ne m\'éloigne jamais beaucoup du village, tu sais.');
    else out.push('(Ces lieux sont maintenant marqués sur votre carte.)');
    return out;
  }

  private past(n: NPCData): string[] {
    const civ = this.h.world.civ;
    const evs = n.knowledge.filter((k) => k.startsWith('event:')).map((k) => civ.events[parseInt(k.split(':')[1], 10)]).filter(Boolean);
    const e = evs[hash2i(n.age, this.h.time.day + 7, evs.length) % evs.length];
    const ago = civ.presentYear - e.year;
    const intro = ago < n.age - 10 ? 'J\'étais là, je m\'en souviens comme si c\'était hier.' : ago < 100 ? 'Mon grand-père en parlait souvent.' : 'C\'était il y a bien longtemps.';
    return [`${e.title} (${e.year}). ${intro}`, e.text];
  }

  private questOffer(e: Entity): DialogueNode {
    const q = this.h.quests.offerFor(e.npc!.id)!;
    return {
      ...this.head(e, this.h.rep.mood(e.npc!)), lines: [q.summary, 'Tu pourrais m\'aider ? Je saurai me montrer reconnaissant.'],
      options: [
        { label: `Accepter : « ${q.title} »`, go: () => { this.h.quests.accept(q); return this.node(e, ['Merci ! Reviens me voir quand ce sera fait.'], () => this.again(e)); } },
        { label: 'Pas maintenant.', go: () => this.again(e) },
      ],
    };
  }

  private questProgress(e: Entity): DialogueNode {
    const qs = this.h.quests, q = qs.activeFor(e.npc!.id)!;
    if (qs.canTurnIn(q)) return this.node(e, [qs.turnIn(q)], () => this.again(e));
    return this.node(e, [`Alors, où en es-tu ? (${q.stages[q.stage]})`, 'Fais attention à toi.'], () => this.again(e));
  }

  private arrest(e: Entity, bounty: number): DialogueNode {
    const n = e.npc!, h = this.h;
    return {
      ...this.head(e, 'hostile'), lines: [`Halte ! Tu es recherché${de(h.world.civ.settlements[n.sid].name).replace(/^d/, ' d')} pour tes méfaits.`, `L'amende est de ${bounty} pièces. Paie, ou suis-moi.`],
      options: [
        { label: `Payer l'amende (${bounty} or)`, go: () => (h.payFine(n.sid) ? this.node(e, ['Bien. Que je ne t\'y reprenne pas.'], () => this.again(e)) : this.node(e, ['Tu n\'as pas de quoi payer ? Alors…'], () => { h.resistArrest(n.sid); return null; })) },
        { label: 'Résister', go: () => { h.resistArrest(n.sid); return null; } },
      ],
    };
  }
}
