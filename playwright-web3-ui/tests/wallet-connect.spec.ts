/**
 * wallet-connect.spec.ts
 *
 * E2E tests for Web3 wallet connection and token purchase flows.
 *
 * Strategy:
 * - MetaMask interactions are stubbed via window.ethereum mock (no real extension needed in CI)
 * - We test the DApp's UI behaviour in response to wallet states
 * - Real MetaMask E2E is done in staging using Synpress (see README)
 *
 * Scenarios covered:
 * 1. Wallet connect — happy path
 * 2. Wallet connect — user rejects connection
 * 3. Token purchase — successful transaction
 * 4. Token purchase — user rejects transaction signature
 * 5. Token purchase — transaction fails (reverted on chain)
 * 6. Wrong network detection
 * 7. Account switch detection
 */

import { test, expect, Page } from "@playwright/test";

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Injects a mock window.ethereum provider into the page.
 * This simulates MetaMask being installed without needing the real extension.
 *
 * @param page - Playwright page
 * @param options - Control which scenarios to simulate
 */
async function injectMockEthereum(
  page: Page,
  options: {
    accounts?: string[];
    chainId?: string;
    rejectConnect?: boolean;
    rejectSign?: boolean;
    revertTx?: boolean;
  } = {}
) {
  const {
    accounts = ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
    chainId = "0x1", // Mainnet
    rejectConnect = false,
    rejectSign = false,
    revertTx = false,
  } = options;

  await page.addInitScript(
    ({ accounts, chainId, rejectConnect, rejectSign, revertTx }) => {
      const mockProvider = {
        isMetaMask: true,
        selectedAddress: accounts[0] || null,
        chainId,

        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          switch (method) {
            case "eth_requestAccounts":
              if (rejectConnect) {
                throw { code: 4001, message: "User rejected the request." };
              }
              return accounts;

            case "eth_accounts":
              return accounts;

            case "eth_chainId":
              return chainId;

            case "eth_sendTransaction":
              if (rejectSign) {
                throw { code: 4001, message: "MetaMask Tx Signature: User denied transaction signature." };
              }
              if (revertTx) {
                throw { code: -32603, message: "execution reverted: GameToken: insufficient balance" };
              }
              // Return a fake tx hash
              return "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1";

            case "wallet_switchEthereumChain":
              return null;

            default:
              return null;
          }
        },

        on: (event: string, handler: Function) => {
          // Store handlers for later triggering in tests
          (window as any).__mockEthereumHandlers = (window as any).__mockEthereumHandlers || {};
          (window as any).__mockEthereumHandlers[event] = handler;
        },

        removeListener: () => {},
      };

      (window as any).ethereum = mockProvider;
    },
    { accounts, chainId, rejectConnect, rejectSign, revertTx }
  );
}

/**
 * Truncates an Ethereum address for display matching (e.g., "0xf39F...2266")
 */
function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────

test.describe("Wallet Connection", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the DApp — update this URL to your actual app
    await page.goto("http://localhost:3000");
  });

  test("TC-001: should connect wallet and display truncated address", async ({ page }) => {
    /**
     * Business scenario: A player visits the game store and connects
     * their MetaMask wallet to see their token balance and make purchases.
     *
     * Acceptance criteria:
     * - Connect button becomes "Connected"
     * - Wallet address displayed in truncated format
     * - Token balance loads
     */
    await injectMockEthereum(page);
    await page.reload();

    const connectButton = page.getByRole("button", { name: /connect wallet/i });
    await expect(connectButton).toBeVisible();

    await connectButton.click();

    // Address should be displayed in truncated format
    const expectedAddress = truncateAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    await expect(page.getByText(expectedAddress)).toBeVisible({ timeout: 5000 });

    // Balance should load (not show skeleton/spinner)
    await expect(page.getByTestId("token-balance")).not.toBeEmpty();
  });

  test("TC-002: should show error message when user rejects wallet connection", async ({ page }) => {
    /**
     * Business scenario: Player clicks Connect but dismisses the MetaMask popup.
     * The app should recover gracefully — not freeze or show a blank screen.
     */
    await injectMockEthereum(page, { rejectConnect: true });
    await page.reload();

    await page.getByRole("button", { name: /connect wallet/i }).click();

    // App should show a user-friendly error, not a raw exception
    await expect(
      page.getByText(/connection rejected|please try again|wallet not connected/i)
    ).toBeVisible({ timeout: 5000 });

    // Connect button should still be available to retry
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  });

  test("TC-003: should detect wrong network and prompt user to switch", async ({ page }) => {
    /**
     * Business scenario: Player has MetaMask set to Polygon but the app needs Ethereum mainnet.
     * The app should detect this and guide the user to switch.
     */
    await injectMockEthereum(page, {
      chainId: "0x89", // Polygon mainnet
    });
    await page.reload();

    await page.getByRole("button", { name: /connect wallet/i }).click();

    await expect(
      page.getByText(/wrong network|switch to ethereum|unsupported network/i)
    ).toBeVisible({ timeout: 5000 });

    // The switch network button should appear
    const switchButton = page.getByRole("button", { name: /switch network/i });
    await expect(switchButton).toBeVisible();
  });
});

test.describe("Token Purchase Flow", () => {
  const CONNECTED_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  test.beforeEach(async ({ page }) => {
    await injectMockEthereum(page, { accounts: [CONNECTED_WALLET] });
    await page.goto("http://localhost:3000/store");
  });

  test("TC-004: should complete token purchase and show success confirmation", async ({ page }) => {
    /**
     * Business scenario: Player buys 1000 GTK tokens from the game store.
     * The complete happy path: select amount → confirm → tx submitted → success.
     *
     * Key assertions:
     * - Loading state appears during tx
     * - Success message includes tx hash
     * - Token balance updates to reflect purchase
     */
    const balanceBefore = await page.getByTestId("token-balance").textContent();

    // Select token package
    await page.getByTestId("package-1000-tokens").click();

    // Confirm purchase
    await page.getByRole("button", { name: /buy now|purchase|confirm/i }).click();

    // Loading state should appear
    await expect(page.getByTestId("tx-pending")).toBeVisible({ timeout: 3000 });

    // Success state should appear with tx hash
    await expect(page.getByTestId("tx-success")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/0xabc123/i)).toBeVisible(); // tx hash visible

    // Balance should have increased
    const balanceAfter = await page.getByTestId("token-balance").textContent();
    expect(balanceAfter).not.toEqual(balanceBefore);
  });

  test("TC-005: should show cancellation message when user rejects transaction signature", async ({ page }) => {
    /**
     * Business scenario: Player selects a token package but clicks "Reject"
     * in the MetaMask popup instead of confirming.
     *
     * The app must:
     * - Not get stuck in a loading state
     * - Show a clear "cancelled" message
     * - Allow the user to try again
     */
    await injectMockEthereum(page, { rejectSign: true });
    await page.reload();

    await page.getByTestId("package-1000-tokens").click();
    await page.getByRole("button", { name: /buy now|purchase|confirm/i }).click();

    await expect(
      page.getByText(/transaction cancelled|rejected by user|signature denied/i)
    ).toBeVisible({ timeout: 5000 });

    // Buy button should be re-enabled
    await expect(
      page.getByRole("button", { name: /buy now|purchase|confirm/i })
    ).toBeEnabled();
  });

  test("TC-006: should display on-chain error when transaction reverts", async ({ page }) => {
    /**
     * Business scenario: Player tries to buy tokens but the contract rejects
     * the transaction (e.g., insufficient ETH, contract paused, etc.)
     *
     * Important: On-chain reverts return an error code -32603.
     * The app should parse this and show a human-readable message.
     */
    await injectMockEthereum(page, { revertTx: true });
    await page.reload();

    await page.getByTestId("package-1000-tokens").click();
    await page.getByRole("button", { name: /buy now|purchase|confirm/i }).click();

    // Should show the contract's revert reason in a friendly way
    await expect(
      page.getByText(/transaction failed|insufficient|try again/i)
    ).toBeVisible({ timeout: 5000 });

    // Should NOT show raw JSON or stack traces to the user
    await expect(page.getByText(/-32603/)).not.toBeVisible();
  });
});

test.describe("Account & Session Management", () => {
  test("TC-007: should update displayed address when user switches accounts in MetaMask", async ({ page }) => {
    /**
     * Business scenario: Player switches from account A to account B in MetaMask
     * while the app is open. The app should detect the accountsChanged event
     * and update all wallet-dependent UI.
     */
    const accountA = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const accountB = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    await injectMockEthereum(page, { accounts: [accountA] });
    await page.goto("http://localhost:3000");
    await page.getByRole("button", { name: /connect wallet/i }).click();

    await expect(page.getByText(truncateAddress(accountA))).toBeVisible();

    // Simulate MetaMask account switch event
    await page.evaluate((newAccount) => {
      const handlers = (window as any).__mockEthereumHandlers;
      if (handlers && handlers["accountsChanged"]) {
        handlers["accountsChanged"]([newAccount]);
      }
    }, accountB);

    // UI should update to show new account
    await expect(page.getByText(truncateAddress(accountB))).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(truncateAddress(accountA))).not.toBeVisible();
  });
});
