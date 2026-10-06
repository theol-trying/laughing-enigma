import { MeshBuilder, type MeshData } from './Mesh';

// Formes unitaires instanciées pour les modèles animés (centrées, tenant dans -0.5..0.5) :
// la matrice d'instance les place, les oriente et les étire. Normales lissées pour les formes
// de révolution : une fois converties en glyphes, les volumes arrondis donnent des silhouettes
// et des dégradés bien plus lisibles que des boîtes.

export const SHAPE = { BOX: 0, CYL: 1, SPHERE: 2, TAPER: 3, CONE: 4 } as const;
export const SHAPE_COUNT = 5;

/** Solide de révolution autour de Y : profil [rayon, y] du bas vers le haut, bouchons plats. */
function lathe(b: MeshBuilder, profile: [number, number][], n: number, capBottom: boolean, capTop: boolean) {
  const rings: number[] = [];
  for (let j = 0; j < profile.length; j++) {
    const [r, y] = profile[j];
    const [r0, y0] = profile[Math.max(0, j - 1)], [r1, y1] = profile[Math.min(profile.length - 1, j + 1)];
    let nr = y1 - y0, ny = -(r1 - r0);
    const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
    rings.push(b.vcount);
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
      b.vertex(cu * r, y, su * r, cu * nr, ny, su * nr, 0xffffff, 0);
    }
  }
  for (let j = 0; j + 1 < rings.length; j++) for (let i = 0; i < n; i++) {
    const a = rings[j] + i, c = rings[j + 1] + i;
    b.quad(a, c, c + 1, a + 1);
  }
  const cap = (r: number, y: number, ny: number) => {
    if (r < 0.001) return;
    const c = b.vertex(0, y, 0, 0, ny, 0, 0xffffff, 0), base = b.vcount;
    for (let i = 0; i <= n; i++) { const u = (i / n) * Math.PI * 2; b.vertex(Math.cos(u) * r, y, Math.sin(u) * r, 0, ny, 0, 0xffffff, 0); }
    for (let i = 0; i < n; i++) b.tri(c, base + i, base + i + 1);
  };
  if (capBottom) cap(profile[0][0], profile[0][1], -1);
  if (capTop) cap(profile[profile.length - 1][0], profile[profile.length - 1][1], 1);
}

export function buildShapes(): MeshData[] {
  const out: MeshData[] = [];
  let b = new MeshBuilder(32);
  b.box(0, -0.5, 0, 1, 1, 1, 0, 0xffffff, 0);
  out[SHAPE.BOX] = b.finish();
  b = new MeshBuilder(64);
  lathe(b, [[0.5, -0.5], [0.5, 0.5]], 8, true, true);
  out[SHAPE.CYL] = b.finish();
  b = new MeshBuilder(128);
  b.blob(0, 0, 0, 0.5, 0.5, 0.5, 0xffffff, 0, 10, 6);
  out[SHAPE.SPHERE] = b.finish();
  b = new MeshBuilder(64);
  // tronc de cône légèrement bombé : membres, museaux, queues (le bout étroit est en haut)
  lathe(b, [[0.5, -0.5], [0.47, 0], [0.32, 0.5]], 8, true, true);
  out[SHAPE.TAPER] = b.finish();
  b = new MeshBuilder(64);
  lathe(b, [[0.5, -0.5], [0.3, 0], [0, 0.5]], 8, true, false);
  out[SHAPE.CONE] = b.finish();
  return out;
}
