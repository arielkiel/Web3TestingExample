# Web3 QA Testing Examples

A production-grade reference repository demonstrating QA automation patterns for Web3 applications — covering smart contract testing, wallet UI automation, blockchain API validation, and AI-assisted QA tooling.

Built by a QA Automation Leader with 15+ years of experience, including 7 years at a blockchain intelligence company.

---

## Repository Structure

```
web3-qa-examples/
├── hardhat-contract-tests/     # Smart contract unit & integration tests (Hardhat + ethers.js)
├── playwright-web3-ui/         # Browser UI tests with MetaMask wallet simulation (Playwright)
├── api-tests/                  # REST & GraphQL blockchain API tests (Jest + axios)
├── ai-tools-integration/       # AI-powered QA tools (log analysis, test generation)
└── docs/                       # Testing patterns, strategy, and runbooks
```

---

## What This Covers

| Layer | Tools | What's Tested |
|-------|-------|--------------|
| Smart Contract Unit | Hardhat, ethers.js, Chai | ERC-20 transfer, approve, mint, revert conditions |
| Smart Contract Integration | Hardhat, Waffle | Multi-contract interactions, access control |
| UI / E2E | Playwright, synpress | Wallet connect, token purchase flow, NFT display |
| API | Jest, axios, supertest | Transaction endpoints, balance queries, error handling |
| AI-Assisted | OpenAI API / Claude API | Log analysis, anomaly detection, test generation |

---

## Quick Start

### Prerequisites
- Node.js >= 18
- npm >= 9

### Install all dependencies

```bash
npm run install:all
```

### Run all tests

```bash
# Smart contract tests
cd hardhat-contract-tests && npx hardhat test

# UI tests (headless)
cd playwright-web3-ui && npx playwright test

# API tests
cd api-tests && npm test
```

---

## Key Design Principles

1. **Test at the right layer** — Unit test contract logic in isolation; reserve E2E for critical user journeys
2. **Deterministic environments** — Use local Hardhat node for contract tests; never depend on live testnets in CI
3. **Explicit assertions** — Every test asserts both the happy path AND the state change (e.g. balance before/after)
4. **Revert testing** — Web3 failures are first-class; test rejected transactions, out-of-gas, and access control
5. **Documented intent** — Each test explains the business scenario it protects, not just the technical action

---

## Testing Pyramid for Web3

```
        ___________
       /    E2E    /     ← Playwright: wallet connect, purchase flow (few, slow)
      /____________/
     /  API Tests  /     ← Jest: REST/GraphQL endpoints (moderate)
    /______________/
   / Contract Unit /     ← Hardhat: ERC-20 logic, reverts (many, fast)
  /________________/
```

---

## Docs

- [Web3 Testing Patterns](./docs/web3-testing-patterns.md)
- [Smart Contract Testing Guide](./docs/smart-contract-testing-guide.md)
- [AI Tools Integration Guide](./docs/ai-tools-integration.md)
- [CI/CD Setup](./docs/ci-cd-setup.md)
