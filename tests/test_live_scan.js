const { MinecraftBotClient } = require('../src/bot/client');
const { config } = require('../src/config/loader');
const { logger } = require('../src/bot/logger');

async function testLiveScan() {
  console.log('🚀 Starting Live Server Environmental Scan Verification...');

  // Prepare safe test configuration (prevent autonomous actions & auto-reconnect loops)
  const testConfig = JSON.parse(JSON.stringify(config.minecraft));
  testConfig.auto_reconnect.enabled = false;
  testConfig.autonomous.enabled = false;

  const client = new MinecraftBotClient(testConfig);

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Live test timed out after 35 seconds')), 35000)
  );

  const runTestPromise = new Promise((resolve, reject) => {
    client.connect().then(success => {
      if (!success) return reject(new Error('Failed to initiate bot connection'));
    }).catch(reject);

    client.bot.once('spawn', async () => {
      try {
        console.log('🌍 Bot spawned into the live world!');
        const botPos = client.adapter.getPosition();
        console.log(`📍 Bot Current Coordinates: X=${botPos.x.toFixed(2)}, Y=${botPos.y.toFixed(2)}, Z=${botPos.z.toFixed(2)}`);

        // Wait for spawn chunk column to load from server
        let blockUnder = null;
        for (let i = 0; i < 25; i++) {
          blockUnder = client.adapter.getBlockAt(botPos.offset(0, -1, 0));
          if (blockUnder && blockUnder.name && blockUnder.name !== 'air' && blockUnder.name !== 'undefined') break;
          await new Promise(r => setTimeout(r, 200));
        }
        console.log(`🦶 Block under bot feet: '${blockUnder?.name}' (type=${blockUnder?.type})`);

        let testPassed = true;
        let checksCount = 0;

        // 1. Test Block Scanning (State Scanner POIs)
        console.log('\n--- [1] Testing _scanNearbyBlocks(24, 6) ---');
        const scannedBlocks = client.stateScanner._scanNearbyBlocks(24, 6);
        for (const [type, positions] of Object.entries(scannedBlocks)) {
          console.log(`  Found ${positions.length}x ${type}`);
          for (const pos of positions) {
            const dy = Math.abs(pos.y - botPos.y);
            const dist = client.adapter.distanceTo(pos);
            checksCount++;
            if (dy > 6.01) {
              console.error(`  ❌ VIOLATION: Block ${type} at Y=${pos.y} exceeds dy <= 6 (dy=${dy.toFixed(2)})!`);
              testPassed = false;
            }
          }
        }
        console.log(`  ✅ All scanned POI blocks adhere strictly to |ΔY| <= 6`);

        // 1.1 Test Live World Blocks (tinted_glass spawn platform)
        console.log('\n--- [1.1] Testing adapter.findBlocks on tinted_glass (maxDistance: 24, maxDistanceY: 6) ---');
        const glassBlocks = client.adapter.findBlocks({
          matching: 'tinted_glass',
          maxDistance: 24,
          maxDistanceY: 6,
          count: 10,
        });
        console.log(`  Found ${glassBlocks.length} tinted_glass blocks within 24m and dy <= 6`);
        for (const bPos of glassBlocks) {
          const dy = Math.abs(bPos.y - botPos.y);
          const dist = client.adapter.distanceTo(bPos);
          console.log(`  - Block 'tinted_glass': pos=(${bPos.x}, ${bPos.y}, ${bPos.z}), dist=${dist.toFixed(1)}m (ΔY=${dy.toFixed(1)})`);
          checksCount++;
          if (dy > 6.01 || dist > 24.01) {
            console.error(`  ❌ VIOLATION: Block at Y=${bPos.y} exceeds bounds!`);
            testPassed = false;
          }
        }
        console.log(`  ✅ All scanned blocks strictly adhere to dist <= 24 and |ΔY| <= 6`);

        // 2. Test Entity Scanning (State Scanner)
        console.log('\n--- [2] Testing _scanNearbyEntities(16, 6) ---');
        const scannedEntities = client.stateScanner._scanNearbyEntities(16, 6);
        console.log(`  Found ${scannedEntities.length} entities in range`);
        for (const ent of scannedEntities) {
          const dy = Math.abs(ent.position.y - botPos.y);
          const dist = client.adapter.distanceTo(ent.position);
          console.log(`  - Entity '${ent.name}' (${ent.type}): dist=${dist.toFixed(1)}m, Y=${ent.position.y.toFixed(1)} (ΔY=${dy.toFixed(1)})`);
          checksCount++;
          if (dy > 6.01) {
            console.error(`  ❌ VIOLATION: Entity '${ent.name}' at Y=${ent.position.y} exceeds dy <= 6 (dy=${dy.toFixed(2)})!`);
            testPassed = false;
          }
        }
        console.log(`  ✅ All scanned entities adhere strictly to |ΔY| <= 6`);

        // 3. Test Hostiles Scanning
        console.log('\n--- [3] Testing findHostiles(10, 6) ---');
        const hostiles = client.adapter.findHostiles(10, 6);
        console.log(`  Found ${hostiles.length} hostiles within 10m and dy <= 6`);
        for (const mob of hostiles) {
          const dy = Math.abs(mob.position.y - botPos.y);
          const dist = client.adapter.distanceTo(mob.position);
          console.log(`  - Hostile '${mob.name}': dist=${dist.toFixed(1)}m, Y=${mob.position.y.toFixed(1)} (ΔY=${dy.toFixed(1)})`);
          checksCount++;
          if (dy > 6.01 || dist > 10.01) {
            console.error(`  ❌ VIOLATION: Hostile '${mob.name}' out of bounds!`);
            testPassed = false;
          }
        }
        console.log(`  ✅ All hostiles adhere strictly to dist <= 10 and |ΔY| <= 6`);

        // 4. Test Animals Scanning
        console.log('\n--- [4] Testing findAnimals(16, 6) ---');
        const animals = client.adapter.findAnimals(16, 6);
        console.log(`  Found ${animals.length} animals within 16m and dy <= 6`);
        for (const animal of animals) {
          const dy = Math.abs(animal.position.y - botPos.y);
          const dist = client.adapter.distanceTo(animal.position);
          console.log(`  - Animal '${animal.name}': dist=${dist.toFixed(1)}m, Y=${animal.position.y.toFixed(1)} (ΔY=${dy.toFixed(1)})`);
          checksCount++;
          if (dy > 6.01 || dist > 16.01) {
            console.error(`  ❌ VIOLATION: Animal '${animal.name}' out of bounds!`);
            testPassed = false;
          }
        }
        console.log(`  ✅ All animals adhere strictly to dist <= 16 and |ΔY| <= 6`);

        // 5. Test Dropped Items Scanning
        console.log('\n--- [5] Testing findDroppedItems(6, 6) ---');
        const items = client.adapter.findDroppedItems(6, 6);
        console.log(`  Found ${items.length} dropped items within 6m and dy <= 6`);
        for (const item of items) {
          const dy = Math.abs(item.position.y - botPos.y);
          const dist = client.adapter.distanceTo(item.position);
          checksCount++;
          if (dy > 6.01 || dist > 6.01) {
            console.error(`  ❌ VIOLATION: Dropped item out of bounds!`);
            testPassed = false;
          }
        }
        console.log(`  ✅ All dropped items adhere strictly to dist <= 6 and |ΔY| <= 6`);

        // 6. Test Exposed Ores Scanning
        console.log('\n--- [6] Testing findNearbyExposedOres(16, 6) ---');
        const ores = client.dsl.findNearbyExposedOres(16, 6);
        console.log(`  Found ${ores.length} safe exposed ores within 16m and dy <= 6`);
        for (const orePos of ores) {
          const dy = Math.abs(orePos.y - botPos.y);
          const dist = client.adapter.distanceTo(orePos);
          const block = client.adapter.getBlockAt(orePos);
          console.log(`  - Ore '${block?.name || 'ore'}': dist=${dist.toFixed(1)}m, Y=${orePos.y} (ΔY=${dy.toFixed(1)})`);
          checksCount++;
          if (dy > 6.01 || dist > 16.01) {
            console.error(`  ❌ VIOLATION: Exposed ore out of bounds!`);
            testPassed = false;
          }
        }
        console.log(`  ✅ All exposed ores adhere strictly to dist <= 16 and |ΔY| <= 6`);

        // 7. Test Autonomous Perception Snapshot
        console.log('\n--- [7] Testing _buildPerceptionSnapshot() ---');
        const snapshot = client.autonomousEngine._buildPerceptionSnapshot();
        console.log('  Perception Snapshot Summary:');
        console.log(`  - Crafting Table nearby: ${snapshot.nearby.crafting_table_nearby}`);
        console.log(`  - Furnace nearby: ${snapshot.nearby.furnace_nearby}`);
        console.log(`  - Chests nearby: ${snapshot.nearby.chests_nearby}`);
        console.log(`  - Beds nearby: ${snapshot.nearby.beds_nearby}`);
        console.log(`  - Exposed ores count: ${snapshot.nearby.exposed_ores.length}`);
        console.log(`  - Hostiles spotted: ${snapshot.entities.hostiles.length}`);
        console.log(`  - Animals spotted: ${snapshot.entities.animals.length}`);
        console.log(`  - Players spotted: ${snapshot.entities.players.length}`);
        console.log(`  ✅ Perception Snapshot compiled smoothly in real-time`);

        if (testPassed) {
          console.log(`\n🎉 LIVE SERVER SCAN VERIFICATION SUCCEEDED! (${checksCount} data points verified)`);
          resolve();
        } else {
          reject(new Error('One or more checks violated Y-axis clamping rules'));
        }
      } catch (err) {
        reject(err);
      } finally {
        console.log('\n🔌 Disconnecting bot from live server...');
        client.disconnect();
      }
    });

    client.bot.on('kicked', reason => {
      reject(new Error(`Bot was kicked: ${JSON.stringify(reason)}`));
    });

    client.bot.on('error', err => {
      reject(new Error(`Bot connection error: ${err.message}`));
    });
  });

  await Promise.race([runTestPromise, timeoutPromise]);
}

testLiveScan()
  .then(() => {
    console.log('✅ Live server test completed successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Live server test failed:', err.message);
    process.exit(1);
  });
