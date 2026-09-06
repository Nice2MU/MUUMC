// Go To Surface Skill
await dsl.packUpCraftingTable().catch(() => {});
const res = await dsl.goToSurface();
return res;
