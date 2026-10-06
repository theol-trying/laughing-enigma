import { RNG } from '../../core/RNG';

// Générateur de noms à saveur médiévale française. Déterministe (flux « names »),
// garantit l'unicité au sein d'un monde.

const PREFIX = ['Val', 'Roche', 'Mont', 'Bois', 'Pont', 'Clair', 'Noir', 'Haut', 'Gué', 'Fort', 'Champ', 'Font', 'Bel', 'Grand', 'Vieux', 'Pierre', 'Combe', 'Brume', 'Croix', 'Mur', 'Aube', 'Cendre', 'Givre', 'Ronce'];
const SUFFIX = ['cendre', 'brune', 'morne', 'lune', 'fer', 'vent', 'fleur', 'sombre', 'gris', 'loup', 'fontaine', 'court', 'ville', 'mont', 'val', 'roc', 'lac', 'bois', 'garde', 'marche', 'sel', 'rive', 'aigle', 'pierre'];
const SYL1 = ['ar', 'bre', 'cal', 'dor', 'fen', 'gar', 'lan', 'mor', 'ner', 'ros', 'sal', 'tor', 'ver', 'aud', 'cor', 'per', 'tal', 'vau', 'mar', 'bel', 'gué', 'ol', 'ra', 'sau', 'ber', 'char', 'mal', 'cré'];
const SYL2 = ['en', 'il', 'ou', 'an', 'é', 'or', 'ar', 'ul', 'ai', 'om', 'ev', 'ag'];
const END = ['onne', 'eil', 'ac', 'ais', 'ain', 'ay', 'enne', 'ières', 'eux', 'ille', 'ouse', 'ange', 'erre', 'aux', 'ac', 'is', 'ons', 'ecourt', 'emont', 'eval'];

const MALE = ['Aubin', 'Bertrand', 'Clément', 'Denis', 'Évrard', 'Fulbert', 'Gautier', 'Guérin', 'Hugues', 'Jehan', 'Lambert', 'Mathieu', 'Nicolas', 'Odon', 'Pierre', 'Raoul', 'Simon', 'Thibault', 'Urbain', 'Yves', 'Gilles', 'Arnaud', 'Baudouin', 'Enguerrand', 'Foulques', 'Gaspard', 'Josselin', 'Lucas', 'Martin', 'Renaud', 'Anselme', 'Bastien', 'Colin', 'Étienne', 'Guillaume', 'Henri', 'Jacquemin', 'Léonard', 'Robin', 'Tristan'];
const FEMALE = ['Aude', 'Béatrice', 'Clémence', 'Douce', 'Ermengarde', 'Flore', 'Gisèle', 'Héloïse', 'Isabeau', 'Jeanne', 'Mahaut', 'Marguerite', 'Nicolette', 'Odile', 'Perrine', 'Roselyne', 'Sibylle', 'Tiphaine', 'Ysolde', 'Agnès', 'Blanche', 'Catherine', 'Guenièvre', 'Liesse', 'Mélisende', 'Pétronille', 'Ade', 'Berthe', 'Colette', 'Emmeline', 'Alix', 'Bérengère', 'Constance', 'Edmée', 'Gillette', 'Jacquette', 'Margot', 'Philippa', 'Sancie', 'Yolande'];
const FAMILY = ['Lefèvre', 'Dumoulin', 'Laforge', 'Boucher', 'Charpentier', 'Meunier', 'Tisserand', 'Berger', 'Fournier', 'Marchand', 'Bonnet', 'Rousseau', 'Leblanc', 'Moreau', 'Garnier', 'Fontaine', 'Duval', 'Dubois', 'Delarue', 'Morel', 'Lenoir', 'Brun', 'Girard', 'Mercier', 'Roux', 'Vasseur', 'Courtois', 'Perrin', 'Chauvin', 'Barbier', 'Pelletier', 'Tonnelier', 'Vigneron', 'Potier', 'Lechat', 'Corbin', 'Malet', 'Sauvage', 'Hardy', 'Gaillard'];

/** « de X » ou « d'X » selon l'initiale. */
export function de(name: string): string { return /^[AEIOUYÉÈÊÂÎÔŒ]/i.test(name) ? `d'${name}` : `de ${name}`; }

export class NameGen {
  constructor(private rng: RNG, private used = new Set<string>()) {}

  /** Générateur dérivé (flux indépendant) partageant l'unicité des noms. */
  fork(name: string): NameGen { return new NameGen(this.rng.fork(name), this.used); }

  private unique(make: () => string): string {
    for (let i = 0; i < 40; i++) {
      const n = make();
      if (!this.used.has(n)) { this.used.add(n); return n; }
    }
    const n = make() + ' ' + (this.used.size % 97);
    this.used.add(n);
    return n;
  }

  private cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

  private rawPlace(): string {
    const r = this.rng;
    const k = r.next();
    if (k < 0.4) {
      const p = r.pick(PREFIX), s = r.pick(SUFFIX);
      if (p.toLowerCase().endsWith(s) || s.startsWith(p.toLowerCase())) return p + 'ac';
      return r.chance(0.3) ? `${p}-${this.cap(s)}` : p + s;
    }
    if (k < 0.85) {
      let s = r.pick(SYL1);
      if (r.chance(0.45)) s += r.pick(SYL2);
      return this.cap(s + r.pick(END));
    }
    return `${r.pick(PREFIX)}-${this.cap(r.pick(SYL1) + r.pick(END))}`;
  }

  /** Nom de lieu habité (village, ville, château…). */
  place(): string { return this.unique(() => this.rawPlace()); }

  /** Nom de rivière, avec article (« la Vèze », « l'Orbe »). */
  river(): string {
    return this.unique(() => {
      const r = this.rng;
      const base = this.cap(r.pick(SYL1) + r.pick(['e', 'ne', 'se', 'ze', 'lle', 've', 'rbe', 'nde', 'ire']));
      return /^[AEIOUÉÈ]/.test(base) ? `l'${base}` : `la ${base}`;
    });
  }

  region(kind: 'val' | 'comté' | 'marches' | 'hautes' | 'forêt' | 'marais'): string {
    const p = this.rawPlace();
    const name = {
      val: `Val ${de(p)}`, comté: `Comté ${de(p)}`, marches: `Marches ${de(p)}`,
      hautes: `Hautes-Terres ${de(p)}`, forêt: `Forêt ${de(p)}`, marais: `Marais ${de(p)}`,
    }[kind];
    return this.unique(() => name);
  }

  mountainRange(): string { return this.unique(() => `Monts ${this.rng.pick(['Gris', 'Blancs', 'Noirs', 'de ' + this.rawPlace(), 'du ' + this.rng.pick(['Loup', 'Givre', 'Roi', 'Corbeau'])])}`); }
  forest(): string { return this.unique(() => `${this.rng.pick(['Bois', 'Forêt', 'Sylve'])} ${this.rng.pick(['de ', "d'", 'des '])}${this.rawPlace()}`.replace("d'B", 'de B')); }

  person(sex: 'm' | 'f', noble = false, place?: string): { first: string; last: string } {
    const r = this.rng;
    const first = r.pick(sex === 'm' ? MALE : FEMALE);
    const last = noble && place ? `de ${place}` : r.pick(FAMILY);
    return { first, last };
  }

  faction(kind: 'royaume' | 'maison' | 'ordre' | 'bandits' | 'culte' | 'guilde', place?: string): string {
    const r = this.rng;
    const p = place ?? this.rawPlace();
    switch (kind) {
      case 'royaume': return this.unique(() => `Royaume ${de(p)}`);
      case 'maison': return this.unique(() => `Maison ${de(p)}`);
      case 'ordre': return this.unique(() => `Ordre ${r.pick(['de la Flamme', 'du Gué', "de l'Aube", 'des Cendres', 'du Saint-Puits'])}`);
      case 'bandits': return this.unique(() => `${r.pick(['Les Loups', 'Les Corbeaux', 'Les Écorcheurs', 'La Bande', 'Les Fils'])} ${r.pick([de(p), 'Gris', 'Rouges', 'du Fossé', 'Sans-Nom'])}`);
      case 'culte': return this.unique(() => `${r.pick(['Le Culte', 'Les Fidèles', 'La Confrérie'])} ${r.pick(['du Ver', 'de la Lune Noire', 'des Os', "de l'Œil Clos"])}`);
      case 'guilde': return this.unique(() => `Guilde des ${r.pick(['Marchands', 'Mineurs', 'Bateliers'])} ${de(p)}`);
    }
  }
}
