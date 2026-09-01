// Cave Spelunking & Exploration Skill
const maxSteps = args.max_steps || 25;
const maxDurationSec = args.duration_sec || 60;
return await dsl.exploreCave({ maxSteps, maxDurationSec });
