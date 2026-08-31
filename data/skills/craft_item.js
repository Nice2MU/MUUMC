/**
 * Skill: craft_item
 * Crafts a specified item using the Safe DSL craft helper.
 */

const itemName = args.item_name || args.item;
const count = args.count || 1;

if (!itemName) {
  throw new Error('Item name to craft is required');
}

dsl.chat(`Preparing to craft ${count}x ${itemName}...`);
const res = await dsl.craftItem(itemName, count);
return res;
