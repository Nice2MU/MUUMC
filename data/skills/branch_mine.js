// Branch / Fishbone Mining Skill
const length = args.length || 15;
const spacing = args.spacing || 3;
const branchLength = args.branch_length || 6;
return await dsl.branchMine({ length, spacing, branchLength });
