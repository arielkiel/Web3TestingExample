# AI Tools Integration Guide

How to integrate AI-powered tools into your Web3 QA workflow to reduce toil and find issues faster.

---

## 1. Log Analysis with Claude API

### Problem
Blockchain error logs are notoriously cryptic:
```
Error: execution reverted (action='estimateGas', data='0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020476f6b656e3a20696e73756666696369656e742062616c616e6365', reason='GameToken: insufficient balance', ...)
```

On-call engineers lose time decoding these instead of fixing the actual issue.

### Solution: AI-Powered Log Summarization

```javascript
// log-analyzer/log-analyzer.js
const { analyzeLogs } = require("./log-analyzer");

// Collect last 30 minutes of errors from Elasticsearch
const errors = await esClient.search({
  index: "transaction-errors",
  body: {
    query: { range: { timestamp: { gte: "now-30m" } } },
    size: 100,
  },
});

const analysis = await analyzeLogs(errors.hits.hits.map(h => h._source));
// Returns: plain English root cause + recommended actions
```

### Integration with PagerDuty

```bash
# In your incident runbook:
LOGS=$(curl -s "$ES_URL/transaction-errors/_search?q=level:ERROR&size=50")
ANALYSIS=$(echo "$LOGS" | node log-analyzer.js --stdin)
curl -X POST "$PAGERDUTY_WEBHOOK" -d "{\"analysis\": \"$ANALYSIS\"}"
```

---

## 2. AI Test Generation

### When to Use

- New contract deployed — generate a test skeleton immediately
- Audit existing tests for coverage gaps
- Onboarding new QA engineers — show them what "complete coverage" looks like

### Running the Generator

```bash
# Generate tests for a new contract
node test-generator/test-generator.js \
  --contract ../hardhat-contract-tests/contracts/GameToken.sol \
  --output ../hardhat-contract-tests/test/GameToken.generated.test.js

# Audit coverage gaps in existing tests
node test-generator/test-generator.js \
  --contract ../hardhat-contract-tests/contracts/GameToken.sol \
  --audit-existing ../hardhat-contract-tests/test/GameToken.test.js
```

### Sample Coverage Gap Report Output
```
HIGH: mint() — max supply exact boundary not tested (off-by-one risk)
HIGH: transferOwnership() — no test for old owner losing access after transfer
MEDIUM: approve() — no test for zero address spender
MEDIUM: transfer() — zero-amount transfer not tested (ERC-20 spec allows it)
LOW: pause() — no test for event args verification
```

---

## 3. Visual Regression with Applitools

### Setup

```bash
npm install @applitools/eyes-playwright
```

```typescript
// In your Playwright config
import { Eyes, Target, Configuration } from "@applitools/eyes-playwright";

test("wallet connect UI should match baseline", async ({ page }) => {
  const eyes = new Eyes();
  await eyes.open(page, "GameStore DApp", "Wallet Connect Flow");

  await page.goto("/");
  await eyes.check("Landing page", Target.window().fully());

  await page.getByRole("button", { name: /connect wallet/i }).click();
  await eyes.check("Connected state", Target.window().fully());

  await eyes.close();
});
```

### Why AI Visual Testing Matters for Web3

- Token balances rendered differently (1,000.00 GTK vs 1000 GTK vs 1000.00)
- NFT thumbnail rendering after minting
- Transaction history table layout with long tx hashes

Applitools' AI ignores rendering noise (anti-aliasing, font rendering) and only flags real visual regressions.

---

## 4. AI-Assisted Test Review (GitHub Actions)

Add this to your PR workflow to auto-review test quality:

```yaml
# .github/workflows/test-review.yml
name: AI Test Review

on:
  pull_request:
    paths:
      - "**/*.test.js"
      - "**/*.spec.ts"

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Get changed test files
        id: changed
        run: |
          echo "files=$(git diff --name-only origin/main HEAD | grep -E '\.(test|spec)\.(js|ts)$' | tr '\n' ' ')" >> $GITHUB_OUTPUT

      - name: AI Test Quality Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          for file in ${{ steps.changed.outputs.files }}; do
            node scripts/review-tests.js --file "$file" >> review-comments.md
          done

      - name: Post review as PR comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const review = fs.readFileSync('review-comments.md', 'utf8');
            await github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body: `## AI Test Review\n\n${review}`
            });
```
