/**
 * Skill: chop_tree
 * Chops nearby trees and replants saplings.
 */
const count = args.count || 4;
return await dsl.chopTree({ count });
