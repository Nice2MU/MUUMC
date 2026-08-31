// Go To Surface & Stock Up on Wood/Tools Skill
await dsl.goToSurface();
if (world.getY() >= 55) {
  await dsl.chopTree({ count: 4 });
  await dsl.craftItem('oak_planks', 4).catch(() => {});
  await dsl.craftItem('crafting_table', 1).catch(() => {});
  await dsl.craftItem('stone_pickaxe', 2).catch(() => {});
}
return { success: true };
