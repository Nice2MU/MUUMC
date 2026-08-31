/**
 * Skill: follow_player
 * Follows a specified player or the nearest player safely.
 */

const targetPlayer = args.target_player;
const range = args.range || 2.0;

let player = null;
if (targetPlayer) {
  player = world.findEntity({ name: targetPlayer, type: 'player' });
} else {
  player = world.findEntity({ type: 'player' });
}

if (!player) {
  dsl.chat('No player found to follow.');
  return { success: false, message: 'Player not found' };
}

dsl.chat(`Following ${player.name || targetPlayer}...`);
await dsl.navigate(player.position.x, player.position.y, player.position.z, range);
return { success: true, followed: player.name || targetPlayer };
