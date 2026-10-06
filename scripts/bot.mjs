// Compagnon de test du multijoueur : `npm run bot -- CODE [serveur]`
// Un joueur scripté rejoint le salon, suit le premier joueur à quelques pas et salue.
// Serveur par défaut : http://127.0.0.1:8787 (`npm run dev:server`) ; en ligne, passer l'adresse du site.
const [code, base = 'http://127.0.0.1:8787'] = process.argv.slice(2);
if (!code) { console.log('usage : npm run bot -- CODE [serveur]'); process.exit(1); }
const GEN = (await import('../packages/core/src/version.ts').catch(() => null))?.GENERATOR_VERSION ?? '0.1.0';
const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws/' + code.toUpperCase());
const send = (m) => ws.send(JSON.stringify(m));
let me = '', lead = '', pos = null, t = 0;
ws.onopen = () => send({ t: 'hello', name: 'Compagnon', key: 'bot-compagnon', gen: GEN, proto: 1 });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'welcome') { me = m.you; console.log(`Dans le salon ${code} (seed ${m.seed}) avec : ${m.players.map((p) => p.name).join(', ') || 'personne'}`); setTimeout(() => send({ t: 'chat', text: 'Bonjour ! Je vous suis.' }), 1500); }
  else if (m.t === 'st' && (!lead || m.id === lead)) { lead = m.id; pos = m.s; }
  else if (m.t === 'chat') console.log(`[${m.name}] ${m.text}`);
  else if (m.t === 'to' && m.d?.k === 'hurt') console.log(`aïe (${m.d.a})`);
  else if (m.t === 'err') { console.log('erreur :', m.msg); if (m.fatal) process.exit(1); }
};
ws.onclose = () => { console.log('déconnecté'); process.exit(0); };
setInterval(() => {
  if (!me || !pos) return;
  t += 0.1;
  const a = t * 0.5, x = pos.x + Math.cos(a) * 3.5, z = pos.z + Math.sin(a) * 3.5;
  send({ t: 'st', s: { x, y: pos.y, z, h: Math.atan2(-Math.sin(a), -Math.cos(a)) + Math.PI / 2, sw: 0, bl: 0, d: 0, hp: 100, mhp: 100, lk: 'épée|b|1|0', dg: pos.dg, cr: 0, sp: 0 } });
}, 100);
