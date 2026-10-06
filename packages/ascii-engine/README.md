# @ascii-fort/ascii-engine

Moteur d'affichage **3D → caractères** pour navigateur (WebGL2, sans bibliothèque 3D).

1. passe scène : G-buffer à 2 × 2 sous-échantillons par caractère (couleur éclairée, matière,
   normale, lettre d'entité, profondeur), ombres du soleil, 24 lumières ponctuelles ;
2. passe cellule : un glyphe + deux couleurs par case (quadrants sur les silhouettes, rampe de
   glyphes par matière, brouillard, ciel, pluie, neige) ;
3. présentation : atlas de glyphes net (`texelFetch`), **deux grilles** superposées — le monde
   en police fine (option « finesse ») et l'interface en police de lecture.

| Module | Contenu |
|---|---|
| `Renderer` | les trois passes, `InstanceBuffer` (objets animés), `resize(taille, finesse)` |
| `Materials` | matières et vocabulaires de glyphes (`M.STONE`, `M.WATER`…) |
| `Mesh` | `MeshBuilder` : construction de maillages côté CPU (boîtes, pignons, cylindres…) |
| `Shapes` | formes unitaires instanciées (boîte, cylindre, sphère, tronc de cône, cône) |
| `TextGrid` | interface en caractères (texte, cadres, barres) |
| `Camera`, `Atmosphere` | caméra subjective ; soleil, lune, ciel, brouillard, météo, palette |
| `GlyphAtlas` | jeu de caractères et atlas (blocs et traits de boîte dessinés) |
| `Input` | clavier (AZERTY/QWERTY par `e.code`), souris, capture du pointeur |

Réutilisable pour tout jeu 3D au look terminal : fournir des `GpuMesh` (via `createMesh`) et des
instances, puis appeler `render()` à chaque image.
