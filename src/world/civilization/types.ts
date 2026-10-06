// Types partagés de la civilisation (données déterministes issues de la seed).

export type FactionKind = 'royaume' | 'ordre' | 'bandits' | 'culte' | 'guilde';
export interface Faction {
  id: number;
  name: string;
  kind: FactionKind;
  color: number;
  capitalId: number;              // implantation principale (-1 si aucune)
  regions: number[];
  relations: number[];            // -1 (haine) … +1 (alliance), indexé par id de faction
  notes: string[];                // pourquoi les relations sont ce qu'elles sont
}

export type SettlementType =
  | 'hameau' | 'village' | 'village minier' | 'port' | 'bourg' | 'ville' | 'capitale'
  | 'fort' | 'château' | 'monastère' | 'avant-poste' | 'camp' | 'ruines';

export type Good = 'grain' | 'bois' | 'minerai' | 'fer' | 'poisson' | 'laine' | 'herbes' | 'sel' | 'vin' | 'pierre' | 'gibier' | 'outils' | 'étoffe';

export interface Settlement {
  id: number;
  name: string;
  type: SettlementType;
  ci: number; cj: number;         // cellule macro
  x: number; z: number;           // centre (m)
  y: number;                      // altitude du plateau
  radius: number;                 // rayon bâti (m)
  population: number;
  factionId: number;
  regionId: number;
  produces: Good[];
  needs: Good[];
  reasons: string[];              // « pourquoi ce lieu existe ici »
  events: number[];               // événements historiques liés
  abandoned: boolean;
  founded: number;                // année de fondation
}

export type EventKind =
  | 'fondation' | 'chute' | 'guerre' | 'bataille' | 'peste' | 'schisme' | 'mine'
  | 'expédition' | 'révolte' | 'forteresse' | 'destruction';
export interface HistoryEvent {
  id: number;
  year: number;
  kind: EventKind;
  title: string;
  text: string;
  factions: number[];
  places: number[];               // implantations concernées
  pois: number[];                 // traces physiques
}

export type PoiKind =
  | 'ruines' | 'tour de guet' | 'statue' | 'menhirs' | 'camp de bandits' | 'grotte' | 'mine'
  | 'cimetière' | 'pont' | 'sanctuaire' | 'champ de bataille' | 'arbre remarquable' | 'crypte'
  | 'tanière de loups' | 'repaire de gobelins' | 'antre du troll' | 'nid d\'araignées';
export interface Poi {
  id: number;
  kind: PoiKind;
  name: string;
  x: number; z: number;
  settlementId: number;           // implantation associée (-1)
  eventId: number;                // événement historique à l'origine (-1)
  dungeonId: number;              // donjon accessible (-1)
  factionId: number;              // occupants (-1)
  roadId: number;                 // route concernée (-1)
  why: string;                    // raison d'être
}

export interface RoadPoint { x: number; z: number; y: number }
export interface Bridge { x: number; z: number; y: number; yaw: number; length: number; width: number; roadId: number }
export interface Road {
  id: number;
  a: number; b: number;           // implantations reliées
  kind: 1 | 2;                    // 1 chemin, 2 route
  cells: number[];
  points: RoadPoint[];
  width: number;
  bridges: Bridge[];
  trade: number;                  // importance commerciale (0..1)
}

export interface Dungeon {
  id: number;
  kind: 'grotte' | 'mine' | 'crypte' | 'forteresse';
  name: string;
  poiId: number;
  depth: number;                  // difficulté 1..5
  boss: string;                   // rencontre principale
}
