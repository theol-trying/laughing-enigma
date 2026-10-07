import type { Entity } from '../entities/Entity';
import type { Player } from '../entities/Player';
import type { EventBus } from '@ascii-fort/core/Events';

// Résolution des dégâts : armure, blocage, esquive, effets élémentaires, mort.

export interface CombatHost {
  player: Player;
  events: EventBus;
  onPlayerDeath(): void;
  playerArmor(): number;
  /** multijoueur : coup sur une entité simulée par un autre joueur → transmis (renvoie true) */
  forward?(e: Entity, amount: number, element?: Element): boolean;
}

export type Element = 'poison' | 'feu' | 'givre' | undefined;

/** Dégâts infligés à une entité ; renvoie les dégâts réels. */
export function hitEntity(host: CombatHost, e: Entity, amount: number, sourceId: string | null, element?: Element): number {
  if (!e.alive) return 0;
  if (sourceId === 'player' && host.forward?.(e, amount, element)) {
    e.flash = 0.18;
    host.events.emit('entity:damaged', { targetId: e.id, sourceId, amount });
    return amount;
  }
  const armor = e.mon ? e.mon.armor : e.npc ? (e.npc.profession === 'garde' || e.npc.profession === 'soldat' ? 4 : 0) : 0;
  let dmg = Math.max(1, Math.round(amount * (1 - armor / (armor + 12))));
  if (element === 'feu' && e.mon?.def === 'troll') dmg = Math.round(dmg * 1.6); // le feu empêche le troll de se régénérer
  if (e.mon?.def === 'squelette' && element === 'feu') dmg = Math.round(dmg * 1.3);
  e.hp -= dmg;
  e.flash = 0.18;
  host.events.emit('entity:damaged', { targetId: e.id, sourceId, amount: dmg });
  if (e.mon) { e.mon.alerted = true; if (sourceId) e.mon.targetId = sourceId; }
  if (e.hp <= 0) {
    e.hp = 0; e.alive = false; e.deadT = 0;
    if (e.npc) { e.npc.alive = false; e.npc.hp = 0; }
    host.events.emit('entity:killed', {
      victimId: e.id, killerId: sourceId, kind: e.kind === 'npc' ? 'npc' : 'monster', type: e.type,
      factionId: e.npc?.factionId, settlementId: e.npc?.sid ?? (e.mon && e.mon.campId >= 0 ? e.mon.campId : undefined),
      campId: e.mon && e.mon.campId >= 0 ? e.mon.campId : undefined, x: e.x, z: e.z,
    });
  }
  return dmg;
}

/** Dégâts infligés au joueur (blocage frontal, esquive, armure, éléments). */
export function hitPlayer(host: CombatHost, amount: number, src: Entity, element?: Element): number {
  const p = host.player;
  if (p.dead || p.invuln > 0) return 0;
  const dx = src.x - p.x, dz = src.z - p.z, d = Math.hypot(dx, dz) || 1;
  const front = (dx * Math.sin(p.heading) - dz * Math.cos(p.heading)) / d > 0.3;
  let dmg = amount;
  if (p.blocking && front && p.stamina > 0) {
    p.stamina = Math.max(0, p.stamina - amount * 1.2);
    dmg *= p.shield ? 0.15 : 0.35;
    host.events.emit('message', { text: 'Coup paré !', color: 0x9ad0ff });
  }
  const armor = host.playerArmor();
  dmg = Math.max(1, Math.round(dmg * (1 - armor / (armor + 15))));
  p.hp -= dmg;
  p.hurt = Math.min(1, 0.35 + dmg / 30);
  p.hitAmount = dmg; p.hitT = 1; p.hitDir = Math.atan2(src.x - p.x, -(src.z - p.z));
  if (element === 'poison') p.poison = Math.max(p.poison, 6);
  if (element === 'givre') p.frost = Math.max(p.frost, 3);
  if (element === 'feu') p.burn = Math.max(p.burn, 3);
  if (p.hp <= 0) { p.hp = 0; p.dead = true; host.onPlayerDeath(); }
  return dmg;
}
