// Recover Crafting Table Skill
const tables = adapter.findBlocks({ matching: 'crafting_table', maxDistance: 16, count: 1 });
if (tables.length > 0) {
  const tBlock = adapter.getBlockAt(tables[0]);
  if (tBlock) {
    await dsl.safeDigBlock(tBlock);
    await dsl.navigateXZ(tables[0].x + 0.5, tables[0].z + 0.5, 0.4, 2000).catch(() => {});
  }
}
return true;
