/**
 * Skill: mine_stone
 * Mines nearby stone blocks safely.
 */
const count = args.count || 8;
return await dsl.mineOres('stone', count);
