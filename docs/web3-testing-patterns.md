# Web3 Testing Patterns

A reference guide for QA engineers testing blockchain-based applications. These patterns cover the unique challenges that Web3 introduces compared to traditional web applications.

---

## Why Web3 Testing is Different

Traditional web apps have a clear separation: frontend → backend → database. Web3 adds a fourth layer — the **blockchain** — which changes everything:

| Challenge | Traditional Web | Web3 |
|-----------|----------------|------|
| State persistence | Database you control | Immutable blockchain — bugs cannot be patched |
| Transaction cost | Free | Every operation costs real money (gas) |
| Async results | HTTP response | Submit tx → wait for mining → poll for confirmation |
| User auth | Sessions/JWT | Cryptographic wallet signature |
| Error messages | HTTP status codes | Opaque hex-encoded revert reasons |
| Test isolation | Database rollback | Must redeploy contracts or fork mainnet |

---

## Pattern 1: Test Pyramid for Web3

```
                    ┌──────────────────┐
                    │   E2E / UI Tests  │  ← Few, slow, expensive
                    │ (Playwright + MM) │     Test critical user journeys only
                    └────────┬─────────┘
               ┌─────────────┴─────────────┐
               │      API / Integration     │  ← Moderate number
               │   (Jest + axios + node)    │     Test backend ↔ blockchain bridge
               └─────────────┬─────────────┘
          ┌───────────────────┴────────────────────┐
          │         Contract Unit Tests             │  ← Many, fast, cheap
          │  (Hardhat + ethers.js + Chai)           │     Test every function and revert
          └────────────────────────────────────────┘
```

---

## Pattern 2: Local Blockchain for Deterministic Testing

**Never run unit tests against a real testnet** (Sepolia, Goerli, etc.) in CI. Testnets are:
- Slow (12+ second block times)
- Flaky (RPC endpoints go down)
- Shared state (other people's transactions affect yours)

Use **Hardhat's local node** instead:

```javascript
// hardhat.config.js — the 'hardhat' network is always local and instant
networks: {
  hardhat: {
    chainId: 31337,
    // Optional: fork mainnet for realistic state
    forking: {
      url: process.env.MAINNET_RPC_URL,
      blockNumber: 19500000, // Pin to a specific block for reproducibility
    }
  }
}
```

**Key benefits of local node:**
- Instant mining (no waiting for block confirmation)
- 20 pre-funded accounts with 10,000 ETH each
- Full EVM — exact same execution as mainnet
- Resets between test runs — perfect isolation

---

## Pattern 3: State Assertion (Before / After)

The most common Web3 test mistake is asserting only the final state without proving a change happened.

```javascript
// ❌ BAD — This passes even if the transfer silently failed
test("transfer tokens", async () => {
  await token.transfer(player.address, toTokens(100));
  expect(await token.balanceOf(player.address)).to.equal(toTokens(100));
  // If player already had 100 tokens, this passes even with a broken transfer
});

// ✅ GOOD — Captures before state, asserts the delta
test("transfer tokens", async () => {
  const senderBefore = await token.balanceOf(owner.address);
  const receiverBefore = await token.balanceOf(player.address);

  await token.transfer(player.address, toTokens(100));

  expect(await token.balanceOf(owner.address)).to.equal(senderBefore - toTokens(100));
  expect(await token.balanceOf(player.address)).to.equal(receiverBefore + toTokens(100));
  // Both sides of the ledger must balance
});
```

---

## Pattern 4: Test Every Revert Condition

Smart contracts communicate failures through `require()` statements that revert the transaction. Every `require()` in your contract must have a test.

```solidity
// Contract has these require() statements:
function transfer(address to, uint256 amount) public {
  require(to != address(0), "GameToken: transfer to zero address");           // ← test 1
  require(balanceOf[msg.sender] >= amount, "GameToken: insufficient balance"); // ← test 2
  require(!paused, "GameToken: token transfers are paused");                  // ← test 3
  ...
}
```

```javascript
// Each require() gets its own test:
test("should revert transfer to zero address", async () => {
  await expect(
    token.transfer(ethers.ZeroAddress, toTokens(100))
  ).to.be.revertedWith("GameToken: transfer to zero address");
});

test("should revert transfer when balance insufficient", async () => {
  await expect(
    token.connect(player).transfer(owner.address, toTokens(99999))
  ).to.be.revertedWith("GameToken: insufficient balance");
});

test("should revert transfer when paused", async () => {
  await token.pause();
  await expect(
    token.transfer(player.address, toTokens(100))
  ).to.be.revertedWith("GameToken: token transfers are paused");
});
```

---

## Pattern 5: Event Emission Testing

Contracts emit events as their primary communication mechanism. Test them — they're as important as return values.

```javascript
// ✅ Verify event name AND all arguments
test("should emit Transfer event with correct args", async () => {
  await expect(token.transfer(player.address, toTokens(100)))
    .to.emit(token, "Transfer")
    .withArgs(
      owner.address,   // from
      player.address,  // to
      toTokens(100)    // amount
    );
});

// ✅ ERC-20 standard: mint = Transfer from zero address
test("mint should emit Transfer from zero address", async () => {
  await expect(token.mint(player.address, toTokens(500)))
    .to.emit(token, "Transfer")
    .withArgs(ethers.ZeroAddress, player.address, toTokens(500));
});
```

---

## Pattern 6: Boundary Value Testing

Smart contracts often have critical numeric boundaries (max supply, min deposit, etc.). Always test:
- Exactly at the boundary (should succeed)
- One unit above the boundary (should fail)
- Zero (may or may not be valid — check the spec)

```javascript
describe("max supply boundary tests", () => {
  it("should mint exactly remaining supply", async () => {
    const remaining = MAX_SUPPLY - INITIAL_SUPPLY;
    await expect(token.mint(player.address, remaining)).not.to.be.reverted;
  });

  it("should revert when minting 1 wei above max supply", async () => {
    const remaining = MAX_SUPPLY - INITIAL_SUPPLY;
    await expect(token.mint(player.address, remaining + 1n))
      .to.be.revertedWith("GameToken: max supply exceeded");
  });
});
```

---

## Pattern 7: Simulating MetaMask in E2E Tests

Real MetaMask is hard to automate. For CI, mock `window.ethereum`:

```typescript
// Inject mock before page loads
await page.addInitScript(() => {
  window.ethereum = {
    isMetaMask: true,
    selectedAddress: "0xf39F...2266",
    request: async ({ method }) => {
      switch (method) {
        case "eth_requestAccounts": return ["0xf39F...2266"];
        case "eth_chainId": return "0x1";
        case "eth_sendTransaction": return "0xabc123..."; // fake tx hash
        default: return null;
      }
    },
    on: () => {},
    removeListener: () => {},
  };
});
```

For full MetaMask extension testing in staging, use **Synpress**:
```bash
npm install @synthetixio/synpress
```

---

## Pattern 8: Testing Transaction Lifecycle

Web3 transactions are async. The full lifecycle:

```
User clicks "Buy"
  → Wallet prompts for signature
    → User signs (or rejects!)
      → Transaction broadcast to network
        → Transaction in mempool (pending)
          → Miner includes in block (confirmed)
            → UI updates
```

Test each stage separately:

```javascript
// Stage 1: Signature rejection
test("should handle user rejection gracefully", async () => {
  await injectMockEthereum(page, { rejectSign: true });
  await page.getByRole("button", { name: /buy/i }).click();
  await expect(page.getByText(/cancelled/i)).toBeVisible();
});

// Stage 2: Submitted but pending
test("should show pending state while tx confirms", async () => {
  await injectMockEthereum(page, { txDelay: 5000 }); // slow confirmation
  await page.getByRole("button", { name: /buy/i }).click();
  await expect(page.getByTestId("tx-pending")).toBeVisible();
});

// Stage 3: On-chain revert
test("should show error when tx reverts on chain", async () => {
  await injectMockEthereum(page, { revertTx: true });
  await page.getByRole("button", { name: /buy/i }).click();
  await expect(page.getByText(/transaction failed/i)).toBeVisible();
});
```

---

## Pattern 9: Access Control Testing

Every `onlyOwner` or role-based modifier needs an adversarial test.

```javascript
// For every privileged function, test that non-owners can't call it
const privilegedFunctions = [
  () => token.connect(attacker).mint(attacker.address, toTokens(1000)),
  () => token.connect(attacker).pause(),
  () => token.connect(attacker).unpause(),
  () => token.connect(attacker).transferOwnership(attacker.address),
];

for (const fn of privilegedFunctions) {
  it(`should revert unauthorized call`, async () => {
    await expect(fn()).to.be.revertedWith("GameToken: caller is not the owner");
  });
}
```

---

## Common Web3 Error Codes

| Error Code | Cause | Test Approach |
|-----------|-------|--------------|
| `4001` | User rejected MetaMask prompt | Test UI recovers, shows friendly message |
| `-32603` | Internal JSON-RPC error / on-chain revert | Test error message parsing |
| `INSUFFICIENT_FUNDS` | Not enough ETH for gas | Test balance pre-flight check |
| `REPLACEMENT_UNDERPRICED` | Gas too low to replace pending tx | Test retry UI |
| `NONCE_EXPIRED` | Transaction nonce conflict | Test nonce management |
