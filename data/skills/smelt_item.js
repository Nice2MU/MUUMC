// Smelt Item Skill
const itemName = args.item_name || 'raw_iron';
const count = args.count || 1;
return await dsl.smeltItem(itemName, count);
