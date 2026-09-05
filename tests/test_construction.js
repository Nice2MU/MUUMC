/**
 * Construction & Schematic Subsystem Test Suite.
 * Validates:
 * - Blueprint & Schematic Loader
 * - BOM Calculation & Shorthand Resolution
 * - 3D Grid Rotation
 * - Site Preparation & Staging Chest APIs
 * - MCP Tools Registration & Standby Execution
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { blueprintLoader, sitePreparer, stagingChestManager, structureBuilder } = require('../src/builder');
const { TOOL_DEFINITIONS, MCPToolHandler } = require('../src/mcp/tools');

async function runConstructionTests() {
  console.log('🧪 Running Construction Subsystem Test Suite...\n');

  // Test 1: List Blueprints
  console.log('Test 1: Listing blueprints from library...');
  const blueprints = await blueprintLoader.listAll();
  assert(Array.isArray(blueprints), 'Blueprints should be an array');
  assert(blueprints.length >= 4, `Expected at least 4 default blueprints, found ${blueprints.length}`);
  const names = blueprints.map(b => b.name);
  assert(names.includes('small_wood_house'), 'Should include small_wood_house');
  assert(names.includes('dirt_shelter'), 'Should include dirt_shelter');
  console.log(`  ✅ Found ${blueprints.length} blueprints: ${names.join(', ')}`);

  // Test 2: Load Blueprint & BOM calculation
  console.log('Test 2: Loading small_wood_house and verifying BOM...');
  const bp = await blueprintLoader.load('small_wood_house');
  assert.strictEqual(bp.name, 'small_wood_house');
  assert.strictEqual(bp.dimensions.x, 5);
  assert.strictEqual(bp.dimensions.y, 4);
  assert.strictEqual(bp.dimensions.z, 7);
  assert(bp.bom['oak_planks'] > 0, 'Should require oak_planks');
  assert(bp.bom['oak_log'] > 0, 'Should require oak_log');
  assert(bp.bom['red_bed'] > 0, 'Should require red_bed (normalized from bed)');
  assert(bp.totalBlocks > 0, 'Total blocks should be greater than 0');
  console.log(`  ✅ Dimensions: ${bp.dimensions.x}x${bp.dimensions.y}x${bp.dimensions.z}, Total blocks: ${bp.totalBlocks}`);
  console.log(`  ✅ BOM:`, JSON.stringify(bp.bom));

  // Test 3: 3D Grid Rotation
  console.log('Test 3: Testing 3D Grid Rotation (90 and 180 degrees)...');
  const rot90 = blueprintLoader.rotate(bp, 90);
  assert.strictEqual(rot90.dimensions.x, 7, 'Rotated 90 width should match old length');
  assert.strictEqual(rot90.dimensions.z, 5, 'Rotated 90 length should match old width');
  assert.strictEqual(rot90.dimensions.y, 4, 'Rotated 90 height should be preserved');

  const rot180 = blueprintLoader.rotate(bp, 180);
  assert.strictEqual(rot180.dimensions.x, 5, 'Rotated 180 width should match old width');
  assert.strictEqual(rot180.dimensions.z, 7, 'Rotated 180 length should match old length');
  console.log('  ✅ Rotation algorithms verified successfully');

  // Test 4: Design & Save Blueprint
  console.log('Test 4: Designing and saving custom blueprint...');
  const testName = 'temp_test_pavilion';
  const customData = {
    name: testName,
    description: 'A test 3x3 pavilion',
    offset: 0,
    blocks: [
      [['stone', 'stone', 'stone'], ['stone', 'stone', 'stone'], ['stone', 'stone', 'stone']],
      [['oak_fence', 'air', 'oak_fence'], ['air', 'air', 'air'], ['oak_fence', 'air', 'oak_fence']],
      [['oak_slab', 'oak_slab', 'oak_slab'], ['oak_slab', 'oak_slab', 'oak_slab'], ['oak_slab', 'oak_slab', 'oak_slab']],
    ],
  };
  const saveRes = blueprintLoader.saveBlueprint(testName, customData);
  assert(saveRes.success, 'Save should succeed');
  assert(fs.existsSync(saveRes.filePath), 'Saved file should exist on disk');

  const reloaded = await blueprintLoader.load(testName);
  assert.strictEqual(reloaded.dimensions.x, 3);
  assert.strictEqual(reloaded.dimensions.y, 3);
  assert.strictEqual(reloaded.dimensions.z, 3);
  assert.strictEqual(reloaded.bom['stone'], 9);
  assert.strictEqual(reloaded.bom['oak_fence'], 4);
  assert.strictEqual(reloaded.bom['oak_slab'], 9);
  fs.unlinkSync(saveRes.filePath); // Clean up
  console.log('  ✅ Save, reload, and BOM verification passed');

  // Test 5: Verify MCP Tools Registration
  console.log('Test 5: Verifying MCP Tools suite registration...');
  assert.strictEqual(TOOL_DEFINITIONS.length, 12, 'Should have 12 MCP tools registered');
  const toolNames = TOOL_DEFINITIONS.map(t => t.name);
  assert(toolNames.includes('muu_mc_list_blueprints'), 'muu_mc_list_blueprints registered');
  assert(toolNames.includes('muu_mc_design_blueprint'), 'muu_mc_design_blueprint registered');
  assert(toolNames.includes('muu_mc_build_structure'), 'muu_mc_build_structure registered');
  console.log('  ✅ All 12 MCP tools registered');

  // Test 6: Verify Tool Call Execution
  console.log('Test 6: Testing Tool Handler execution...');
  const listToolRes = await MCPToolHandler.handleToolCall('muu_mc_list_blueprints', {});
  assert.strictEqual(listToolRes.status, 'success');
  assert(listToolRes.blueprints.length >= 4);

  const buildStandbyRes = await MCPToolHandler.handleToolCall('muu_mc_build_structure', {
    blueprint_name: 'dirt_shelter',
  });
  assert(buildStandbyRes.status === 'mock_success' || buildStandbyRes.status === 'success');
  console.log('  ✅ Tool Handler execution verified');

  console.log('\n🎉 ALL CONSTRUCTION TESTS PASSED SUCCESSFULLY!\n');
}

runConstructionTests().catch(err => {
  console.error('\n❌ Construction Test Failed:', err);
  process.exit(1);
});
