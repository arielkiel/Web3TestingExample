/**
 * log-analyzer.js
 *
 * AI-powered blockchain transaction log analyzer.
 *
 * Problem this solves:
 * On-call engineers receive cryptic blockchain error logs like:
 *   "Error: execution reverted (action='estimateGas', data='0x08c379a0...')"
 *
 * This tool:
 * 1. Collects recent error logs (from Elasticsearch, files, or stdin)
 * 2. Sends them to Claude API for root cause analysis
 * 3. Returns plain-English summaries with recommended actions
 *
 * Usage:
 *   node log-analyzer.js --file ./logs/errors.log
 *   node log-analyzer.js --es-index transactions-errors --minutes 30
 *   cat error.log | node log-analyzer.js --stdin
 *
 * Integration idea: Run this in your PagerDuty/Opsgenie runbook automation
 * so on-call engineers get pre-analyzed summaries in Slack.
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const readline = require("readline");

// ─── Sample log entries (used for demo when no real logs provided) ─────────

const SAMPLE_BLOCKCHAIN_LOGS = [
  {
    timestamp: "2024-01-15T14:23:11Z",
    level: "ERROR",
    service: "transaction-service",
    message: "Transaction failed: execution reverted",
    details: {
      txHash: "0xabc123...",
      from: "0xf39Fd...",
      to: "0x5FbDB...", // Contract address
      error: "Error: execution reverted (action='estimateGas', data='0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020476f6b656e3a20696e73756666696369656e742062616c616e6365')",
      gasUsed: "21000",
      gasLimit: "200000",
    },
  },
  {
    timestamp: "2024-01-15T14:23:15Z",
    level: "ERROR",
    service: "transaction-service",
    message: "Transaction failed: execution reverted",
    details: {
      txHash: "0xdef456...",
      from: "0x70997...",
      to: "0x5FbDB...",
      error: "Error: execution reverted (action='estimateGas', data='0x08c379a0...')",
      gasUsed: "21000",
      gasLimit: "200000",
    },
  },
  {
    timestamp: "2024-01-15T14:24:01Z",
    level: "ERROR",
    service: "wallet-service",
    message: "RPC connection timeout",
    details: {
      rpcUrl: "https://eth-mainnet.alchemyapi.io/v2/...",
      timeout: 30000,
      retryCount: 3,
      error: "Error: timeout of 30000ms exceeded",
    },
  },
  {
    timestamp: "2024-01-15T14:24:45Z",
    level: "WARN",
    service: "transaction-service",
    message: "High gas price detected",
    details: {
      currentGasPrice: "150 gwei",
      thresholdGasPrice: "100 gwei",
      transactionsPending: 47,
    },
  },
  {
    timestamp: "2024-01-15T14:25:00Z",
    level: "ERROR",
    service: "contract-service",
    message: "Contract call failed: GameToken.transfer()",
    details: {
      contract: "GameToken",
      method: "transfer",
      args: ["0x3C44CdDdB...", "1000000000000000000000"], // 1000 tokens
      error: "GameToken: token transfers are paused",
      revertReason: "GameToken: token transfers are paused",
    },
  },
];

// ─── Core Functions ────────────────────────────────────────────────────────

/**
 * Analyzes a batch of blockchain error logs using Claude API.
 *
 * @param {Array} logs - Array of log entry objects
 * @returns {Promise<string>} - Structured analysis with root causes and recommendations
 */
async function analyzeLogs(logs) {
  const client = new Anthropic();

  const logText = logs
    .map((log) => JSON.stringify(log, null, 2))
    .join("\n\n---\n\n");

  const prompt = `You are a senior blockchain infrastructure engineer analyzing production error logs.

Below are error logs from a Web3 transaction service. Analyze them and provide:

1. **Root Cause Summary**: What is actually going wrong? Group related errors.
2. **Severity Assessment**: Is this a critical outage, degraded performance, or a known warning?
3. **Likely Cause**: Technical explanation of why this is happening (contract state, RPC issues, gas, etc.)
4. **Immediate Actions**: What should the on-call engineer do RIGHT NOW?
5. **Preventive Measures**: How do we stop this from happening again?

Be specific and actionable. Reference the actual error messages and values from the logs.

---
LOGS TO ANALYZE:

${logText}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text;
}

/**
 * Generates a concise Slack-ready summary of an incident.
 * Useful for automated alerting pipelines.
 *
 * @param {string} analysis - Full analysis from analyzeLogs()
 * @returns {Promise<string>} - Short Slack-formatted message
 */
async function generateSlackAlert(analysis) {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `Convert this incident analysis into a brief Slack alert (max 3 sentences, plain text, no markdown).
Include: what's broken, severity, and the one most important action.

Analysis:
${analysis}`,
      },
    ],
  });

  return response.content[0].text;
}

/**
 * Loads logs from a file.
 * Supports both JSON array format and newline-delimited JSON (NDJSON).
 */
function loadLogsFromFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8").trim();
  try {
    return JSON.parse(content); // JSON array
  } catch {
    // Try NDJSON format
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  let logs;

  const args = process.argv.slice(2);
  const fileFlag = args.indexOf("--file");
  const stdinFlag = args.includes("--stdin");
  const demoFlag = args.includes("--demo");

  if (fileFlag !== -1 && args[fileFlag + 1]) {
    console.log(`Loading logs from file: ${args[fileFlag + 1]}\n`);
    logs = loadLogsFromFile(args[fileFlag + 1]);
  } else if (stdinFlag) {
    console.log("Reading logs from stdin...\n");
    const rl = readline.createInterface({ input: process.stdin });
    const lines = [];
    for await (const line of rl) lines.push(line);
    logs = lines.filter(Boolean).map((l) => JSON.parse(l));
  } else {
    // Default: use sample logs for demonstration
    console.log("Running with sample logs (use --file or --stdin for real logs)\n");
    logs = SAMPLE_BLOCKCHAIN_LOGS;
  }

  console.log(`Analyzing ${logs.length} log entries...\n`);
  console.log("=".repeat(60));

  // Full analysis
  const analysis = await analyzeLogs(logs);
  console.log("\nINCIDENT ANALYSIS\n");
  console.log(analysis);
  console.log("\n" + "=".repeat(60));

  // Slack-ready summary
  const slackAlert = await generateSlackAlert(analysis);
  console.log("\nSLACK ALERT (copy-paste ready):\n");
  console.log(slackAlert);
  console.log("\n" + "=".repeat(60));

  return { analysis, slackAlert };
}

main().catch(console.error);

module.exports = { analyzeLogs, generateSlackAlert, loadLogsFromFile };
