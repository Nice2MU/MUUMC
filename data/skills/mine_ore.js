// Mine Ores Skill
const oreType = args.ore_type || 'iron';
const count = args.count || 6;
return await dsl.mineOres(oreType, count);
