import type { ModelDef, Pose } from './Models';
import type { NPCData } from './NPC';
import type { Spot } from '../ai/Schedule';

/** Données de combat/comportement d'un monstre (remplies par Monster.ts). */
export interface MonsterState {
  def: string;
  homeX: number; homeZ: number; territory: number;
  aggro: number;            // 0..1
  perception: number;       // portée de vue (m)
  nocturnal: boolean;
  damage: number; armor: number; attackCd: number; reach: number;
  state: 'repos' | 'errance' | 'patrouille' | 'chasse' | 'attaque' | 'fuite' | 'retour' | 'garde';
  targetId: string | null;  // 'player' ou id d'entité
  cooldown: number;
  alerted: boolean;
  campId: number;           // implantation (camp) ou -1
  poiId: number;
  unique: string;           // clé d'unicité pour la sauvegarde
  leader: boolean;
  loot: string;             // table de butin
  element?: 'poison' | 'feu' | 'givre';
  xp: number;
  windup: number;           // élan de l'attaque en cours (s)
  lair: string;             // repaire d'origine
}

export class Entity {
  x = 0; y = 0; z = 0;
  vx = 0; vz = 0;
  heading = 0;
  speed = 1.5;
  radius: number;
  hp: number; maxHp: number;
  alive = true;
  deadT = 0;
  pose: Pose = { walk: 0, swing: 0, dead: 0, hover: 0, block: 0 };
  path: { x: number; z: number }[] | null = null;
  pathI = 0;
  target: { x: number; z: number } | null = null;
  pathPending = false;
  spot: Spot | null = null;
  action = 'idle';
  thinkT = 0;
  flash = 0;
  talkT = 0;
  faceTo: number | null = null;
  sid = -1;
  npc?: NPCData;
  mon?: MonsterState;
  /** adversaire au combat (gardes) et recharge d'attaque */
  foe: Entity | null = null;
  /** effets élémentaires en cours */
  status?: { burn: number; frost: number; poison: number; tick?: number };
  looted = false;
  /** hostile au joueur (garde après un délit, villageois agressé) */
  hostile = false;
  cooldown = 0;
  /** bâtiments/zone où l'entité se trouve (pour la nav locale) */
  zone = -1;

  constructor(readonly id: string, readonly kind: 'npc' | 'monster', readonly type: string, public name: string, readonly model: ModelDef, hp: number) {
    this.radius = model.radius;
    this.hp = hp; this.maxHp = hp;
  }

  get label(): string {
    if (this.npc) return `${this.npc.first} ${this.npc.last} (${this.npc.profession})`;
    return this.name;
  }
}
