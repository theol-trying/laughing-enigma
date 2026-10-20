import type { Civilization } from '@ascii-fort/worldgen/civilization/Civilization';
import type { Poi, Dungeon, Settlement } from '@ascii-fort/worldgen/civilization/types';
import type { WorldSeed } from '@ascii-fort/core/Seed';
import type { RNG } from '@ascii-fort/core/RNG';
import { generateDungeon, type DungeonLayout, type DRoom } from '@ascii-fort/worldgen/dungeons/DungeonGenerator';
import { B } from '@ascii-fort/worldgen/terrain/Biomes';
import { de } from '@ascii-fort/worldgen/civilization/Names';
import type { NPCData } from '../entities/NPC';
import type { UniqueLook } from '../entities/Models';
import { dangerAt, dungeonLevel, type Lair, type FoeDef } from '../entities/Monster';
import { item } from './Items';

// Chaînes de quêtes : des « histoires » de 3 ou 4 étapes, dérivées au moment de l'exécution des données du monde
// (donjons, repaires, implantations, PNJ). Aucune génération du monde n'est modifiée : les seuls tirages viennent du
// flux « chaînes » (noms, épithètes, choix d'étape), qui ne décale aucun autre flux. Chaque histoire se termine par un
// boss unique nommé (variante d'une créature existante) qui laisse un objet épique. Module pur.

export type Archetype = 'bandits' | 'loups' | 'gobelins' | 'crypte' | 'forteresse' | 'troll' | 'araignées' | 'morts';
export type StepKind = 'enquête' | 'objet' | 'lieutenant' | 'boss';

/** Lieu d'une étape : position à la surface (entrée du souterrain, repaire, ruine) et, sous terre, position dans le donjon. */
export interface Anchor {
  x: number; z: number;
  /** souterrain (-1 : surface) et position dans l'espace du souterrain (x ≥ 20 000) */
  dungeonId: number; dx: number; dz: number;
  /** nom du lieu (« Grotte Noire », « Camp des Écorcheurs… ») et point d'intérêt d'origine (-1 : aucun) */
  place: string; poiId: number;
}

export interface ChainStep {
  kind: StepKind;
  /** texte de l'étape (journal, suivi à l'écran) */
  text: string;
  anchor?: Anchor;
  /** enquête : PNJ à interroger, son implantation, le prix de son information */
  npc?: string; sid?: number; price?: number;
  /** objet : id de l'objet de quête et son nom avec l'article (« le Registre des rançons ») */
  item?: string; label?: string;
  /** lieutenant ou boss */
  foe?: FoeDef;
}

export interface ChainDef {
  /** « ch-d3 » (souterrain 3), « ch-l45 » (repaire du point d'intérêt 45) */
  id: string;
  arch: Archetype;
  tier: 1 | 2 | 3;
  danger: number;
  title: string;
  /** résumé (journal, à la 3e personne) et requête du commanditaire (à la 1re personne) */
  summary: string; pitch: string;
  giver: string; sid: number;
  steps: ChainStep[];
  boss: FoeDef;
  reward: { gold: number; xp: number; item: string; rep: number };
  thanks: string;
  /** objet de quête de la chaîne (rendu au commanditaire), s'il y en a un */
  item?: string;
}

export interface ChainWorld {
  civ: Civilization; seed: WorldSeed; lairs: Lair[];
  npcsOf(sid: number): NPCData[];
  /** PNJ déjà commanditaires d'une autre quête (on ne leur confie pas une histoire en plus) */
  avoid?: Set<string>;
}

/** Nombre maximal d'histoires dans un monde. */
export const MAX_CHAINS = 6;
/** Distance minimale entre deux boss d'histoires différentes (m). */
const SPREAD = 1200;
/** Rayon de recherche des lieux d'une histoire autour de son boss (m). */
const REACH = 3600;

// ------------------------------------------------------------------ français : articles et accords
/** Genre du premier mot des noms de lieux du monde (« la Grotte Noire », « les Galeries de… », « l’Antre du troll »). */
const GENDER: Record<string, 'm' | 'f' | 'p'> = {
  Forteresse: 'f', Cachots: 'p', Cimetière: 'm', Antre: 'm', Mines: 'p', Galeries: 'p', Champ: 'm', Statue: 'f', Pont: 'm', Camp: 'm',
  Tanière: 'f', Grotte: 'f', Nid: 'm', Crypte: 'f', Tour: 'f', Sanctuaire: 'm', Cercle: 'm', Ruines: 'p', Repaire: 'm',
  // grottes (étape 55)
  Gouffre: 'm', Caverne: 'f', Cavernes: 'p', Grottes: 'p',
};
/**
 * Nom de lieu avec son article et sa préposition : lieu('Grotte Noire', 'à') → « à la Grotte Noire », lieu('Camp des…', 'de') → « du Camp
 * des… », lieu('Antre du troll', 'dans') → « dans l’Antre du troll ». Un nom propre (village) n'a pas d'article : « à Clairlac ».
 */
export function lieu(name: string, prep: '' | 'à' | 'de' | 'dans' | 'près de' = ''): string {
  let s: string;
  if (/^(Le|La|Les) /.test(name)) s = name.charAt(0).toLowerCase() + name.slice(1);
  else {
    const g = name.includes(' ') ? GENDER[name.split(' ')[0]] : undefined;   // « Pont-Marais » est un village, « Pont sur la Garne » un lieu
    if (!g) return prep === 'à' ? `à ${name}` : prep === 'de' ? de(name) : prep === 'près de' ? `près ${de(name)}` : prep === 'dans' ? `à ${name}` : name;
    s = g === 'p' ? `les ${name}` : /^[AEIOUYÉÈÊÂÎÔŒ]/i.test(name) ? `l’${name}` : `${g === 'm' ? 'le' : 'la'} ${name}`;
  }
  if (prep === 'à') return s.replace(/^le /, 'au ').replace(/^les /, 'aux ').replace(/^(la |l’)/, 'à $1');
  if (prep === 'de' || prep === 'près de') return (prep === 'près de' ? 'près ' : '') + s.replace(/^le /, 'du ').replace(/^les /, 'des ').replace(/^(la |l’)/, 'de $1');
  if (prep === 'dans') return `dans ${s}`;
  return s;
}
/** « du Royaume de Belmorne », « de la Guilde des… », « des Écorcheurs… » : complément d'un nom de faction. */
export function deFaction(name: string): string {
  if (/^Les /.test(name)) return 'des ' + name.slice(4);
  if (/^Le /.test(name)) return 'du ' + name.slice(3);
  if (/^La /.test(name)) return 'de la ' + name.slice(3);
  if (/^(Royaume|Ordre|Culte) /.test(name)) return 'du ' + name;
  if (/^(Guilde|Maison|Confrérie|Bande) /.test(name)) return 'de la ' + name;
  return de(name);
}
/** Majuscule initiale (« la Tisseuse » en début de phrase). */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const FEM_PROF: Record<string, string> = {
  marchand: 'marchande', fermier: 'fermière', chasseur: 'chasseuse', prêtre: 'prêtresse', forgeron: 'forgeronne', meunier: 'meunière',
  pêcheur: 'pêcheuse', mineur: 'mineuse', voyageur: 'voyageuse', moine: 'moniale', artisan: 'artisane',
};
/** Métier accordé au sexe du PNJ (« fermière », « prêtresse »). */
export function profFr(n: { profession: string; sex: 'm' | 'f' }): string { return n.sex === 'f' ? FEM_PROF[n.profession] ?? n.profession : n.profession; }

/** « des marais », « des bois »… selon le biome du lieu. */
function biomeDe(b: number): string {
  return b === B.SWAMP ? 'des marais' : b === B.FOREST ? 'des bois' : b === B.TAIGA ? 'des sapinières' : b === B.MOUNTAIN || b === B.SNOW ? 'des monts'
    : b === B.HEATH ? 'des landes' : b === B.BEACH ? 'des côtes' : 'des plaines';
}

// ------------------------------------------------------------------ archétypes
interface ArchDef {
  base: string; look: UniqueLook; hpMul: number; dmgMul: number;
  lieut: string; lieutLook: UniqueLook; lieutYield: boolean;
  /** métiers des commanditaires, par ordre de préférence */
  givers: string[];
  /** noms des boss [nom, féminin] et épithètes (selon le biome) */
  names: [string, boolean][]; titles: (b: string) => string[];
  /** lieutenants [nom, épithète, féminin] */
  lieutNames: [string, string, boolean][];
  /** objet de quête : genre (Items : « quête:<genre>:<chaîne> ») et article */
  object: [string, string];
  epic: string;
  title(boss: string): string;
  pitch(boss: string, place: string): string;
  summary(boss: string, place: string, giver: string): string;
  thanks: string;
}

const SKEL_LIEUT: [string, string, boolean][] = [['Sire Gauvain', 'le Chevalier sans repos', false], ['Hadrien', 'le Pâle', false], ['Bertrade', 'la Veuve des tombes', true], ['Aymon', 'le Porte-Glaive', false]];

const ARCH: Record<Archetype, ArchDef> = {
  bandits: {
    base: 'chef bandit', look: { scale: 1.2, tint: 0x3a1010, cape: 0x141414, eyes: 0xffb030 }, hpMul: 3.2, dmgMul: 1.5,
    lieut: 'bandit', lieutLook: { scale: 1.12, tint: 0x5a1a1a, cape: 0x3a1a1a }, lieutYield: true,
    givers: ['garde', 'marchand', 'aubergiste', 'noble', 'soldat'],
    names: [['Morgath', false], ['Brakmar', false], ['Vargas', false], ['Dorvan', false], ['Grimaud', false], ['Ulric', false]],
    titles: (b) => [`fléau ${b}`, 'le Seigneur-Brigand', `le Boucher ${b}`, 'la Main Rouge'],
    lieutNames: [['Gorm', 'le Balafré', false], ['Sauvin', 'l’Égorgeur', false], ['Fulk', 'Œil-de-Corbeau', false], ['Rotrou', 'le Borgne', false]],
    object: ['registre', 'le'], epic: 'écorcheuse',
    title: (b) => `La chute ${de(b)}`,
    pitch: (b, p) => `${cap(b)}… Ce chien rançonne nos routes depuis ${lieu(p)}. Ses hommes ont pendu deux colporteurs la semaine passée. Je veux sa tête.`,
    summary: (b, p, g) => `${cap(b)}, rançonne les routes depuis ${lieu(p)}. ${g} veut sa tête.`,
    thanks: 'Les routes vont enfin respirer. Tiens, tu l’as bien mérité : toute la contrée te doit une fière chandelle.',
  },
  loups: {
    base: 'loup', look: { scale: 1.7, tint: 0x9a9a92, cape: 0x6a6a64, eyes: 0xffd040 }, hpMul: 9, dmgMul: 1.6,
    lieut: 'loup', lieutLook: { scale: 1.3, tint: 0x3a3a38, eyes: 0xff6030 }, lieutYield: false,
    givers: ['chasseur', 'fermier', 'garde'],
    names: [['Croc-Gris', false], ['Lune-Noire', false], ['Fendgueule', false], ['Griffe-Pâle', false]],
    titles: (b) => ['le loup géant', `la terreur ${b}`, 'le Dévoreur', `le fantôme ${b}`],
    lieutNames: [['Crocs-Noirs', 'chef de meute', false], ['Échine-Rousse', 'chef de meute', false], ['Mâchefer', 'le loup balafré', false]],
    object: ['carnet', 'le'], epic: 'croc-de-lune',
    title: (b) => `La traque ${de(b)}`,
    pitch: (b, p) => `Une bête énorme, ${b}, mène les meutes jusqu’à nos bergeries. On la dit tapie du côté ${lieu(p, 'de')}. Mon voisin est parti la chasser… on n’a retrouvé que son chapeau.`,
    summary: (b, p, g) => `${cap(b)}, mène les meutes jusqu’aux bergeries depuis ${lieu(p)}. ${g} veut qu’on l’abatte.`,
    thanks: 'Plus de hurlements la nuit… Les bêtes vont pouvoir dormir, et nous aussi. Merci.',
  },
  gobelins: {
    base: 'chef gobelin', look: { scale: 1.35, tint: 0x4a1a5a, cape: 0x2a1a3a, crown: true, eyes: 0xff3020 }, hpMul: 3.2, dmgMul: 1.5,
    lieut: 'gobelin', lieutLook: { scale: 1.25, tint: 0x6a2a1a, eyes: 0xff8020 }, lieutYield: true,
    givers: ['mineur', 'forgeron', 'garde'],
    names: [['Grishnak', false], ['Snorg', false], ['Gobrak', false], ['Zirgut', false]],
    titles: (b) => ['roi des galeries', 'le Mange-Taupe', 'seigneur des tunnels', `le fléau ${b}`],
    lieutNames: [['Snik', 'l’Écorcheur', false], ['Grul', 'le Chaman', false], ['Mork', 'le Fouineur', false]],
    object: ['plan', 'le'], epic: 'heaume royal',
    title: (b) => `Le trône ${de(b)}`,
    pitch: (b, p) => `${cap(b)}, s’est taillé un royaume ${lieu(p, 'dans')}. Ses gobelins volent nos outils, nos bêtes, et même nos enfants, dit-on. Il faut lui reprendre sa couronne… et sa tête avec.`,
    summary: (b, p, g) => `${cap(b)}, règne sur les gobelins ${lieu(p, 'de')}. ${g} veut qu’on le détrône.`,
    thanks: 'Sans leur roi, ces vermines vont se disperser. Les galeries vont revivre !',
  },
  crypte: {
    base: 'gardien des tombes', look: { scale: 1.25, tint: 0x3a2a4a, cape: 0x1a0a2a, crown: true, eyes: 0xff4030 }, hpMul: 2.4, dmgMul: 1.45,
    lieut: 'squelette', lieutLook: { scale: 1.2, tint: 0x8a8a90, cape: 0x2a2a3a, eyes: 0xff4030 }, lieutYield: false,
    givers: ['prêtre', 'moine', 'garde'],
    names: [['Vorlath', false], ['Malthus', false], ['Ostrogar', false], ['Sire Aldéric', false]],
    titles: () => ['le Seigneur des cendres', 'le Roi des os', 'le Dormeur sans repos'],
    lieutNames: SKEL_LIEUT,
    object: ['grimoire', 'le'], epic: 'linceul des cendres',
    title: (b) => `Le linceul ${de(b)}`,
    pitch: (b, p) => `Les morts ne dorment plus. ${cap(b)}, s’est éveillé ${lieu(p, 'dans')}, et ses serviteurs rôdent jusqu’à nos portes la nuit. Que la lumière me pardonne : il faut le renvoyer au néant.`,
    summary: (b, p, g) => `${cap(b)}, s’est éveillé ${lieu(p, 'dans')}. ${g} veut qu’on le renvoie au néant.`,
    thanks: 'Les morts vont enfin reposer. Que la lumière te garde, voyageur.',
  },
  forteresse: {
    base: 'roi-squelette', look: { scale: 1.2, tint: 0x5a1a1a, cape: 0x6a0a0a, crown: true, eyes: 0xff6020 }, hpMul: 1.8, dmgMul: 1.4,
    lieut: 'squelette', lieutLook: { scale: 1.2, tint: 0x9a8a70, cape: 0x4a1a1a, eyes: 0xff6020 }, lieutYield: false,
    givers: ['noble', 'garde', 'soldat', 'prêtre'],
    names: [['Hadrimond', false], ['Valérius', false], ['Théodric', false], ['Ansegisel', false]],
    titles: () => ['le Roi déchu', 'le Souverain des ruines', 'le Roi sans royaume'],
    lieutNames: SKEL_LIEUT,
    object: ['sceau', 'le'], epic: 'glas',
    title: (b) => `La couronne ${de(b)}`,
    pitch: (b, p) => `${cap(b)}, a repris son trône ${lieu(p, 'dans')}. Le dernier roi d’un royaume oublié, revenu d’entre les morts ! Ses soldats se rassemblent, et ils regardent nos terres. Il faut l’abattre avant qu’il ne lève son armée.`,
    summary: (b, p, g) => `${cap(b)}, a repris son trône ${lieu(p, 'dans')}. ${g} veut qu’on l’abatte avant qu’il ne lève son armée.`,
    thanks: 'Le vieux royaume peut retourner à la poussière. Notre seigneur saura s’en souvenir.',
  },
  troll: {
    base: 'troll', look: { scale: 1.2, tint: 0x3a4a2a, eyes: 0xff4020 }, hpMul: 1.9, dmgMul: 1.25,
    lieut: 'gobelin', lieutLook: { scale: 1.1, tint: 0x3a3a1a, eyes: 0xffd040 }, lieutYield: true,
    givers: ['chasseur', 'garde', 'fermier', 'mineur'],
    names: [['Gorgoth', false], ['Brisemont', false], ['Vieux-Moussu', false], ['Ogrin', false]],
    titles: (b) => ['le troll ancien', `le fléau ${b}`, 'le Broyeur', 'le Mangeur de bergers'],
    lieutNames: [['Grizzle', 'le Rabatteur', false], ['Nok', 'le Larbin', false]],
    object: ['carnet', 'le'], epic: 'fend-montagne',
    title: (b) => `La colère ${de(b)}`,
    pitch: (b, p) => `${cap(b)}… Une bête haute comme deux hommes, qui a déjà rasé un hameau. Elle descend ${lieu(p, 'de')} les nuits sans lune. Personne n’a osé la poursuivre. Toi, peut-être ?`,
    summary: (b, p, g) => `${cap(b)}, descend ${lieu(p, 'de')} les nuits sans lune. ${g} veut qu’on en finisse.`,
    thanks: 'On va enfin pouvoir mener les bêtes aux alpages. Tu es un héros, et je le dirai partout.',
  },
  araignées: {
    base: 'araignée', look: { scale: 1.8, tint: 0x3a1a2a, eyes: 0x60ff60 }, hpMul: 8, dmgMul: 1.5,
    lieut: 'araignée', lieutLook: { scale: 1.35, tint: 0x4a3a1a, eyes: 0xffa020 }, lieutYield: false,
    givers: ['guérisseuse', 'chasseur', 'fermier'],
    names: [['la Tisseuse', true], ['Mère-Venin', true], ['Aranée', true], ['la Veuve Noire', true]],
    titles: (b) => ['reine des araignées', `la fileuse ${b}`, 'mère de la nichée'],
    lieutNames: [['Couveuse', 'la gardienne du nid', true], ['Pique-Mort', 'l’araignée-loup', false]],
    object: ['fiole', 'la'], epic: 'arc de la tisseuse',
    title: (b) => `La toile ${de(b)}`,
    pitch: (b, p) => `${cap(b)}, file sa toile ${lieu(p, 'à')} : des cocons gros comme des hommes pendent aux branches. Les remèdes ne guérissent plus le venin de ses petites. Il faut détruire la mère.`,
    summary: (b, p, g) => `${cap(b)}, file sa toile ${lieu(p, 'à')}. ${g} veut qu’on détruise la mère de la nichée.`,
    thanks: 'Sans la mère, la nichée va dépérir. Le pays redevient un peu plus sûr. Merci.',
  },
  morts: {
    base: 'squelette', look: { scale: 1.45, tint: 0x6a6a72, cape: 0x2a3a5a, eyes: 0x80ff90 }, hpMul: 6.5, dmgMul: 1.5,
    lieut: 'squelette', lieutLook: { scale: 1.2, tint: 0x8a8a90, cape: 0x2a2a3a, eyes: 0x80ff90 }, lieutYield: false,
    givers: ['prêtre', 'garde', 'moine'],
    names: [['Sire Brandin', false], ['Gaudry', false], ['Sire Tancrède', false]],
    titles: () => ['le Champion des morts', 'la Sentinelle éternelle', 'le Chevalier pâle'],
    lieutNames: SKEL_LIEUT,
    object: ['étendard', 'l’'], epic: 'pavois du veilleur',
    title: (b) => `Le serment ${de(b)}`,
    pitch: (b, p) => `On dit qu’un champion tombé ne trouve pas le repos ${lieu(p, 'à')} : ${b}. Les morts se relèvent à son appel. Il faut briser son serment.`,
    summary: (b, p, g) => `${cap(b)}, relève les morts ${lieu(p, 'à')}. ${g} veut qu’on brise son serment.`,
    thanks: 'Les morts vont enfin se rendormir. Que la terre leur soit légère… et à toi, merci.',
  },
};
/** Objet épique laissé par le boss de chaque archétype. */
export const EPIC_OF: Record<Archetype, string> = Object.fromEntries((Object.keys(ARCH) as Archetype[]).map((a) => [a, ARCH[a].epic])) as Record<Archetype, string>;

const INFORMANTS = ['aubergiste', 'marchand', 'chasseur', 'voyageur', 'garde', 'prêtre', 'forgeron', 'fermier'];
const REWARD_ITEM = ['', 'grande potion de soin', 'potion de force', 'gemme'];
const INFO_PRICE = [0, 25, 45, 75];

// ------------------------------------------------------------------ lieux
interface Site { key: string; kind: 'donjon' | 'repaire' | 'lieu'; x: number; z: number; poi: Poi; dungeon?: Dungeon; lair?: Lair; arch?: Archetype }
const LIEUX = new Set(['ruines', 'cimetière', 'champ de bataille', 'tour de guet', 'menhirs']);

function archOf(type: string, d?: Dungeon): Archetype | undefined {
  if (d) return d.kind === 'crypte' ? 'crypte' : d.kind === 'forteresse' ? 'forteresse' : 'gobelins';
  return type === 'bandit' ? 'bandits' : type === 'loup' ? 'loups' : type === 'troll' ? 'troll' : type === 'araignée' ? 'araignées'
    : type === 'gobelin' ? 'gobelins' : type === 'squelette' || type === 'spectre' ? 'morts' : undefined;
}

function sitesOf(w: ChainWorld): Site[] {
  const civ = w.civ, out: Site[] = [], poiById = (id: number) => (civ.pois[id]?.id === id ? civ.pois[id] : civ.pois.find((p) => p.id === id));
  for (const d of civ.dungeons) { const poi = poiById(d.poiId); if (poi) out.push({ key: `d${d.id}`, kind: 'donjon', x: poi.x, z: poi.z, poi, dungeon: d, arch: archOf('', d) }); }
  const used = new Set(out.map((s) => s.poi.id));
  for (const l of w.lairs) {
    if (l.poiId < 0) continue;
    const poi = poiById(l.poiId);
    if (!poi || poi.dungeonId >= 0 || used.has(poi.id)) continue;
    used.add(poi.id);
    out.push({ key: `l${poi.id}`, kind: 'repaire', x: l.x, z: l.z, poi, lair: l, arch: archOf(l.type) });
  }
  for (const p of civ.pois) if (LIEUX.has(p.kind) && !used.has(p.id)) out.push({ key: `p${p.id}`, kind: 'lieu', x: p.x, z: p.z, poi: p });
  return out;
}

/** Salles d'un souterrain triées de la plus proche à la plus éloignée de l'entrée (distance sur la grille). */
function roomsByDepth(L: DungeonLayout): DRoom[] {
  const e = L.rooms[0];
  return L.rooms.filter((r) => r.role !== 'entrée' && r.role !== 'boss').sort((a, b) => (Math.abs(a.gx - e.gx) + Math.abs(a.gy - e.gy)) - (Math.abs(b.gx - e.gx) + Math.abs(b.gy - e.gy)) || a.id - b.id);
}

// ------------------------------------------------------------------ génération
/** Toutes les histoires du monde, dans un ordre stable (la première est accessible près du départ). */
export function generateChains(w: ChainWorld): ChainDef[] {
  const civ = w.civ, start = civ.settlements[civ.startId];
  if (!start) return [];
  const sites = sitesOf(w);
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  const cands = sites.filter((s) => s.arch).sort((a, b) => dist(a, start) - dist(b, start) || (a.key < b.key ? -1 : 1));
  const layouts = new Map<number, DungeonLayout>();
  const layoutOf = (d: Dungeon) => { let L = layouts.get(d.id); if (!L) { L = generateDungeon(w.seed, d); layouts.set(d.id, L); } return L; };
  const usedNpc = new Set<string>(w.avoid ?? []), usedNames = new Set<string>(), usedArch = new Set<Archetype>();
  const chosen: ChainDef[] = [], chosenSites: Site[] = [];
  const tierOf = (s: Site) => { const d = dangerAt(civ, s.x, s.z); return d <= 3 ? 1 : d <= 7 ? 2 : 3; };
  const spread = (s: Site) => chosenSites.every((o) => dist(o, s) > SPREAD);
  const tryBuild = (s: Site): boolean => {
    const c = build(w, s, sites, layoutOf, usedNpc, usedNames, dist, chosen.length === 0);
    if (!c) return false;
    chosen.push(c); chosenSites.push(s); usedArch.add(s.arch!);
    return true;
  };
  // 1. la plus proche du départ ; 2. une histoire de chaque palier plus lointain ; 3. on complète par les plus dangereuses, archétypes variés d'abord
  for (const s of cands) if (tryBuild(s)) break;
  for (const t of [2, 3]) for (const s of cands) if (tierOf(s) === t && !usedArch.has(s.arch!) && spread(s) && tryBuild(s)) break;
  const far = [...cands].sort((a, b) => dangerAt(civ, b.x, b.z) - dangerAt(civ, a.x, a.z) || dist(a, start) - dist(b, start));
  for (const pass of [0, 1]) for (const s of far) {
    if (chosen.length >= MAX_CHAINS) break;
    // second passage (archétype déjà pris) seulement si le monde n'a pas assez d'histoires variées
    if (chosenSites.includes(s) || !spread(s) || (pass === 0 && usedArch.has(s.arch!)) || (pass === 1 && (chosen.length >= 4 || chosen.filter((c) => c.arch === s.arch).length >= 2))) continue;
    tryBuild(s);
  }
  return chosen;
}

/** PNJ adulte d'une implantation, par métier préféré, en écartant ceux déjà pris. */
function pickNpc(list: NPCData[], profs: string[], used: Set<string>, any: boolean): NPCData | undefined {
  const ok = (n: NPCData) => n.alive && n.age >= 18 && !used.has(n.id);
  for (const p of profs) { const n = list.find((x) => x.profession === p && ok(x)); if (n) return n; }
  return any ? list.find((n) => ok(n) && n.profession !== 'voyageur') : undefined;
}

const habitable = (s: Settlement) => !s.abandoned && s.type !== 'camp' && s.type !== 'ruines';

function build(w: ChainWorld, s: Site, sites: Site[], layoutOf: (d: Dungeon) => DungeonLayout, usedNpc: Set<string>, usedNames: Set<string>,
  dist: (a: { x: number; z: number }, b: { x: number; z: number }) => number, first: boolean): ChainDef | null {
  const civ = w.civ, A = ARCH[s.arch!], start = civ.settlements[civ.startId];
  const rng: RNG = w.seed.stream('chaînes', s.key);
  // commanditaire : l'implantation la plus proche du boss (la toute première histoire part du village de départ si possible)
  const towns = civ.settlements.filter(habitable).sort((a, b) => dist(a, s) - dist(b, s) || a.id - b.id);
  const order = first && dist(start, s) < 3000 ? [start, ...towns.filter((t) => t !== start)] : towns;
  let giver: NPCData | undefined, home: Settlement | undefined;
  for (const t of order) {
    if (dist(t, s) > REACH) break;
    const n = pickNpc(w.npcsOf(t.id), A.givers, usedNpc, true);
    if (n) { giver = n; home = t; break; }
  }
  if (!giver || !home) return null;
  // informateur : un autre lieu, de préférence relié par la route, pas trop loin du commanditaire
  const linked = (sid: number) => civ.roads.some((r) => (r.a === home!.id && r.b === sid) || (r.b === home!.id && r.a === sid));
  const others = towns.filter((t) => t !== home && dist(t, home!) < 4000).sort((a, b) => (dist(a, home!) - (linked(a.id) ? 800 : 0)) - (dist(b, home!) - (linked(b.id) ? 800 : 0)) || a.id - b.id);
  let inf: NPCData | undefined, infTown: Settlement | undefined;
  const taken = new Set([...usedNpc, giver.id]);
  for (const t of others) { const n = pickNpc(w.npcsOf(t.id), INFORMANTS, taken, false); if (n) { inf = n; infTown = t; break; } }
  if (!inf) { inf = pickNpc(w.npcsOf(home.id), INFORMANTS, taken, true); infTown = home; }
  if (!inf || !infTown) return null;
  usedNpc.add(giver.id); usedNpc.add(inf.id);

  const id = `ch-${s.key}`, danger = dangerAt(civ, s.x, s.z), tier = (danger <= 3 ? 1 : danger <= 7 ? 2 : 3) as 1 | 2 | 3;
  const biome = biomeDe(civ.macro.biome[civ.macro.cellOf(s.x, s.z)]);
  // noms : boss et lieutenant (jamais deux fois le même dans un monde)
  const fresh = <T extends [string, ...unknown[]]>(list: T[]): T => { const free = list.filter((x) => !usedNames.has(x[0])); const v = rng.pick(free.length ? free : list); usedNames.add(v[0]); return v; };
  const [bossName, bossFem] = fresh(A.names);
  const bossTitle = rng.pick(A.titles(biome));
  const [ltName, ltTitle, ltFem] = fresh(A.lieutNames);
  const bossFull = `${bossName}, ${bossTitle}`;
  // lieux des étapes : objet (souterrain, camp ou ruine) et lieutenant (repaire, ruine, souterrain), au plus près du boss
  const near = (pred: (o: Site) => boolean) => sites.filter((o) => o !== s && pred(o) && dist(o, s) < REACH).sort((a, b) => dist(a, s) - dist(b, s) || (a.key < b.key ? -1 : 1))[0];
  const objSite = near((o) => o.kind === 'donjon' || o.lair?.type === 'bandit' || (o.kind === 'lieu' && o.poi.kind !== 'menhirs'));
  const ltSite = near((o) => o !== objSite && (o.kind === 'repaire' || o.kind === 'lieu' || o.kind === 'donjon'));
  const level = (o: Site) => (o.dungeon ? dungeonLevel(civ, o.dungeon) : dangerAt(civ, o.x, o.z));
  const roomsUsed = new Set<number>();
  /** position d'une étape : salle du boss, salle la plus profonde (objet), salle du milieu (lieutenant), ou abords du repaire */
  const anchorAt = (o: Site, role: StepKind): Anchor => {
    const place = o.dungeon ? o.dungeon.name : o.poi.name;
    if (!o.dungeon) {
      // à l'écart du centre (feu du camp, terrier) ; plus loin encore d'une tour ou d'une ruine, pour ne pas finir dans un mur
      const off = role === 'boss' ? [4, 4] : role === 'objet' ? [-3, 3] : [3, -4], k = o.kind === 'lieu' ? 1.9 : 1;
      return { x: o.x + off[0] * k, z: o.z + off[1] * k, dungeonId: -1, dx: 0, dz: 0, place, poiId: o.poi.id };
    }
    const L = layoutOf(o.dungeon), deep = roomsByDepth(L).filter((r) => !(o === s && roomsUsed.has(r.id)));
    let r: DRoom | undefined;
    if (role === 'boss') r = L.rooms.find((x) => x.role === 'boss');
    else if (role === 'objet') r = deep[deep.length - 1];
    else r = deep[Math.floor(deep.length / 2)];
    r ??= L.rooms[L.rooms.length - 1];
    roomsUsed.add(r.id);
    const [ox, oz] = role === 'boss' ? [3, 2] : role === 'objet' ? [-2, 2] : [0, 1];
    return { x: o.x, z: o.z, dungeonId: o.dungeon.id, dx: r.x + ox, dz: r.z + oz, place, poiId: o.poi.id };
  };
  const bossAnchor = anchorAt(s, 'boss');
  const boss: FoeDef = {
    key: `chaîne:${id}:boss`, name: bossName, title: bossTitle, fem: bossFem, base: s.lair?.type === 'spectre' ? 'spectre' : A.base,
    look: s.lair?.type === 'spectre' ? { scale: 1.3, tint: 0x5a6a8a, eyes: 0xc0ffff } : A.look,
    level: level(s) + 2, hpMul: s.lair?.type === 'spectre' ? 7 : A.hpMul, dmgMul: A.dmgMul, armor: 3, xpMul: 4, loot: A.epic, canYield: false,
  };
  const lieut: FoeDef = {
    key: `chaîne:${id}:lieutenant`, name: ltName, title: ltTitle, fem: ltFem, base: A.lieut, look: A.lieutLook,
    level: level(ltSite ?? s) + 1, hpMul: 2.6, dmgMul: 1.25, armor: 1, xpMul: 2.5, canYield: A.lieutYield,
  };
  const objItem = `quête:${A.object[0]}:${id}`, objName = item(objItem).name, objArt = A.object[1];
  const objLabel = `${objArt === 'l’' ? 'l’' : objArt + ' '}${objName}`;
  const placeText = (a: Anchor, prep: 'à' | 'près de') => (a.dungeonId >= 0 ? lieu(a.place, 'dans') : lieu(a.place, prep));
  // étapes : enquête, puis objet et/ou lieutenant, puis le boss (3 étapes au premier palier, 4 au-delà)
  const steps: ChainStep[] = [{
    kind: 'enquête', npc: inf.id, sid: infTown.id, price: INFO_PRICE[tier],
    text: `Interroger ${inf.first} ${inf.last}, ${profFr(inf)} ${lieu(infTown.name, 'à')}`,
  }];
  const withObj = !!objSite && (tier > 1 || rng.chance(0.5));
  const withLt = tier > 1 || !withObj;
  if (withObj && objSite) { const a = anchorAt(objSite, 'objet'); steps.push({ kind: 'objet', anchor: a, item: objItem, label: objLabel, text: `Récupérer ${objLabel} ${placeText(a, 'à')}` }); }
  if (withLt) {
    const a = anchorAt(ltSite ?? s, 'lieutenant');
    // sans autre lieu : le lieutenant garde les abords du repaire du boss (à 45 m, du côté du commanditaire)
    if (!ltSite && a.dungeonId < 0) { const d = dist(home, s) || 1; a.x = s.x + (home.x - s.x) / d * 45; a.z = s.z + (home.z - s.z) / d * 45; }
    steps.push({ kind: 'lieutenant', anchor: a, foe: lieut, text: `Abattre ${ltName}, ${ltTitle}, ${placeText(a, 'près de')}` });
  }
  steps.push({ kind: 'boss', anchor: bossAnchor, foe: boss, text: `Affronter ${bossFull}, ${placeText(bossAnchor, 'à')}` });
  const giverName = `${giver.first} ${giver.last}`;
  return {
    id, arch: s.arch!, tier, danger, title: A.title(bossName),
    summary: A.summary(bossFull, bossAnchor.place, giverName), pitch: A.pitch(bossFull, bossAnchor.place),
    giver: giver.id, sid: home.id, steps, boss,
    reward: { gold: Math.round((80 + 40 * danger) / 5) * 5, xp: 150 + 70 * danger, item: REWARD_ITEM[tier], rep: 10 + 5 * tier },
    thanks: A.thanks, ...(withObj ? { item: objItem } : {}),
  };
}
