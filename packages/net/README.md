# @ascii-fort/net

Protocole du mode multijoueur, partagé entre le jeu (`src/net/`) et le serveur Cloudflare
(`server/worker.ts`). Pur TypeScript.

- `ClientMsg` / `ServerMsg` : messages JSON (`hello`, `st`, `ents`, `claim`/`release`, `to`, `fact`,
  `fx`, `save`, `chat`, `ping` ; `welcome`, `join`/`leave`, `owner`, `pong`, `err`…)
- constantes : `PROTOCOL`, `MAX_PLAYERS`, `NET_HZ`, tailles maximales, durée de vie d'un salon vide
- utilitaires : `roomCode()` (codes faciles à dicter), `shortId()`, `cleanName/Seed/Code()`

Le serveur est un « salon » générique : relais, propriété des zones, faits persistants, sauvegardes.
Il peut servir à tout jeu dont le monde se reconstruit à partir d'une seed.
