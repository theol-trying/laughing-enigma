// Test de bout en bout du serveur de salons : `node scripts/test-room.mjs [url]`
// (par défaut http://localhost:8787, lancé par `npm run dev:server`).
// Deux joueurs : création, arrivée, relais d'état, propriété de zone, fait persistant,
// message adressé, départ, puis retour du premier joueur avec sa sauvegarde.
const base = process.argv[2] ?? 'http://localhost:8787';
const GEN = (await import('../packages/core/src/version.ts').catch(() => null))?.GENERATOR_VERSION ?? '0.1.0';
const { code } = await (await fetch(base + '/api/new')).json();
const wsUrl = base.replace(/^http/, 'ws') + '/ws/' + code;
const ok = (c, msg) => { if (!c) { console.error('ÉCHEC :', msg); process.exit(1); } console.log('ok  ', msg); };

function client(name, key, create) {
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else inbox.push(m);
  };
  const next = (pred, ms = 3000) => {
    const i = inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((res, rej) => { waiters.push({ pred, res }); setTimeout(() => rej(new Error('délai dépassé : ' + name)), ms); });
  };
  const send = (m) => ws.send(JSON.stringify(m));
  const open = new Promise((r) => (ws.onopen = r));
  return { ws, next, send, open, hello: async () => { await open; send({ t: 'hello', name, key, gen: GEN, proto: 1, create }); return next((m) => m.t === 'welcome' || m.t === 'err'); } };
}

const a = client('Alice', 'cle-alice', { seed: 'TEST-001' });
const wa = await a.hello();
ok(wa.t === 'welcome' && wa.seed === 'TEST-001', `salon ${code} créé, seed ${wa.seed}`);

const ghost = client('Fantôme', 'cle-x');
await ghost.open; ghost.send({ t: 'hello', name: 'x', key: 'x', gen: 'autre', proto: 1 });
const ge = await ghost.next((m) => m.t === 'err');
ok(ge.fatal && /générateur/.test(ge.msg), 'version de générateur différente refusée');

const b = client('Bruno', 'cle-bruno');
const wb = await b.hello();
ok(wb.t === 'welcome' && wb.players.some((p) => p.name === 'Alice'), 'Bruno rejoint et voit Alice');
ok((await a.next((m) => m.t === 'join')).p.name === 'Bruno', 'Alice est prévenue de l\'arrivée de Bruno');

a.send({ t: 'st', s: { x: 1, z: 2 } });
const st = await b.next((m) => m.t === 'st');
ok(st.id === wa.you && st.s.x === 1, 'état d\'Alice relayé à Bruno');

a.send({ t: 'claim', z: 's12' });
ok((await a.next((m) => m.t === 'owner')).id === wa.you, 'Alice devient propriétaire de la zone s12');
await b.next((m) => m.t === 'owner'); // diffusion de la prise de s12 par Alice
b.send({ t: 'claim', z: 's12' });
ok((await b.next((m) => m.t === 'owner' && m.z === 's12')).id === wa.you, 'Bruno apprend qu\'Alice possède s12');
a.send({ t: 'ents', z: 's12', l: [['n12:0', 5, 0, 5]] });
ok((await b.next((m) => m.t === 'ents')).l.length === 1, 'entités de la zone relayées');
b.send({ t: 'ents', z: 's12', l: [['triche']] });

b.send({ t: 'to', to: wa.you, d: { hit: 7 } });
ok((await a.next((m) => m.t === 'to')).d.hit === 7, 'message adressé (dégâts) reçu par Alice');

a.send({ t: 'fact', k: 'coffre:42', v: wa.you, once: true });
ok((await b.next((m) => m.t === 'fact')).k === 'coffre:42', 'fait partagé diffusé');
b.send({ t: 'fact', k: 'coffre:42', v: 'bruno', once: true });
ok((await b.next((m) => m.t === 'fact')).v === wa.you, 'coffre : le premier arrivé garde le butin');

a.send({ t: 'save', c: { or: 99 } });
await new Promise((r) => setTimeout(r, 200));
a.ws.close();
ok((await b.next((m) => m.t === 'owner' && m.z === 's12')).id === wb.you, 'Alice partie : la zone passe à Bruno');
ok((await b.next((m) => m.t === 'leave')).id === wa.you, 'départ d\'Alice annoncé');

const a2 = client('Alice', 'cle-alice');
const wa2 = await a2.hello();
ok(wa2.save?.or === 99 && wa2.facts['coffre:42'] === wa.you, 'Alice revient : sauvegarde et faits retrouvés');
ok(wa2.owners.s12 === wb.you, 'propriétaires des zones transmis à l\'arrivée');

const c = client('Zoé', 'cle-z');
await c.open; c.send({ t: 'hello', name: 'Zoé', key: 'z', gen: GEN, proto: 1 });
ok((await c.next((m) => m.t === 'welcome')).players.length === 2, 'troisième joueur accepté');
for (const x of [a2, b, c]) x.ws.close();
console.log('\nTous les tests du salon passent.');
process.exit(0);
