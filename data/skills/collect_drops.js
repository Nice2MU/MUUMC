/**
 * Skill: collect_drops
 * Sweeps and collects all dropped items within search radius.
 */
const radius = args.radius || 16;
return await dsl.pickupNearbyItems(radius);
