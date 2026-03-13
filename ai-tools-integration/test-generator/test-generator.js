/**
 * test-generator.js
 *
 * AI-powered test case generator for smart contracts.
 *
 * Problem this solves:
 * Writing comprehensive test cases for every edge case and revert condition
 * in a smart contract is time-consuming and easy to miss coverage.
 *
 * This tool:
 * 1. Reads a Solidity contract source file
 * 2. Sends it to Claude API for analysis
 * 3. Generates a complete Hardhat test file with:
 *    - Happy path tests for every function
 *    - Revert tests for every require() condition
 *    - Edge case and boundary tests
 *    - Event emission tests
 *
 * Usage:
 *   node test-generator.js --contract ../../hardhat-contract-tests/contracts/GameToken.sol
 *   node test-generator.js --contract ./MyNFT.sol --output ./test/MyNFT.test.js
 *
 * QA Philosophy: Use AI-generated tests as a STARTING POINT and COVERAGE CHECKER.
 * Always review, adjust, and add domain-specific scenarios before committing.
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

// ─── Core Functions ────────────────────────────────────────────────────────

/**
 * Analyzes a Solidity contract and generates Hardhat tests.
 *
 * @param {string} contractSource - Full Solidity source code
 * @param {string} contractName - Name of the contract to test
 * @returns {Promise<string>} - Generated JavaScript test file content
 */
async function generateTests(contractSource, contractName) {
  const client = new Anthropic();

  const systemPrompt = `You are a senior Web3 QA engineer specializing in smart contract testing.
You write comprehensive Hardhat tests using ethers.js v6 and Chai.

Your test files follow these patterns:
1. Use async fixtures for fresh contract deployment per test group
2. Test EVERY public function with happy path and all revert conditions
3. Always assert state BEFORE and AFTER to prove changes happened
4. Verify event emissions with correct arguments
5. Test boundary values (zero amounts, max values, exact boundaries)
6. Include security tests (unauthorized access, re-entrancy if applicable)
7. Add clear comments explaining the business scenario each test covers

Output ONLY valid JavaScript code, no explanations or markdown.`;

  const userPrompt = `Generate a complete Hardhat test file for this Solidity contract.

Contract name: ${contractName}
Contract source:

${contractSource}

Requirements:
- Test every public/external function
- Test every require() statement (at minimum one test per revert condition)
- Test all event emissions
- Include boundary value tests
- Include access control tests
- Use descriptive test names that explain the business scenario
- Add comments explaining WHY each test exists, not just WHAT it does`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content[0].text;
}

/**
 * Analyzes a contract to identify potential test coverage gaps.
 * Use this to audit existing test suites.
 *
 * @param {string} contractSource - Solidity source
 * @param {string} existingTests - Existing test file content
 * @returns {Promise<string>} - Gap analysis report
 */
async function analyzeTestCoverage(contractSource, existingTests) {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `You are a senior Web3 QA engineer reviewing test coverage.

Analyze the existing tests against the contract and identify:
1. Functions with no test coverage
2. Revert conditions not tested
3. Edge cases not covered (zero values, max values, etc.)
4. Missing event emission tests
5. Security scenarios not tested (access control, integer overflow, etc.)

Be specific: list the exact function name and missing scenario.

CONTRACT:
${contractSource}

EXISTING TESTS:
${existingTests}

Format your response as a prioritized list with HIGH/MEDIUM/LOW severity.`,
      },
    ],
  });

  return response.content[0].text;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const contractFlag = args.indexOf("--contract");
  const outputFlag = args.indexOf("--output");
  const auditFlag = args.indexOf("--audit-existing");

  if (contractFlag === -1 || !args[contractFlag + 1]) {
    console.error("Usage: node test-generator.js --contract <path-to-sol-file> [--output <path>]");
    process.exit(1);
  }

  const contractPath = args[contractFlag + 1];
  const contractSource = fs.readFileSync(contractPath, "utf-8");
  const contractName = path.basename(contractPath, ".sol");

  console.log(`\nAnalyzing contract: ${contractName}`);
  console.log("=".repeat(60));

  if (auditFlag !== -1 && args[auditFlag + 1]) {
    // Coverage gap analysis mode
    const existingTestPath = args[auditFlag + 1];
    const existingTests = fs.readFileSync(existingTestPath, "utf-8");

    console.log("\nAnalyzing test coverage gaps...\n");
    const gapReport = await analyzeTestCoverage(contractSource, existingTests);
    console.log(gapReport);
  } else {
    // Test generation mode
    console.log("\nGenerating test file...\n");
    const generatedTests = await generateTests(contractSource, contractName);

    const outputPath = args[outputFlag + 1] || `./generated-${contractName}.test.js`;
    fs.writeFileSync(outputPath, generatedTests, "utf-8");

    console.log(`Tests written to: ${outputPath}`);
    console.log("\nIMPORTANT: Review generated tests before committing!");
    console.log("   - Verify test data values match your deployment configuration");
    console.log("   - Add domain-specific business logic tests");
    console.log("   - Run: npx hardhat test to validate generated tests compile and pass\n");
  }
}

main().catch(console.error);

module.exports = { generateTests, analyzeTestCoverage };
