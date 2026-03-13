/**
 * transaction-api.spec.ts
 *
 * REST API tests for blockchain transaction and wallet endpoints.
 *
 * These tests cover the backend layer that bridges your DApp frontend
 * with on-chain data — common in Web3 platforms like Xsolla that provide
 * APIs for game studios to query token balances, transaction history, etc.
 *
 * Tools: Jest + axios + nock (HTTP mocking for blockchain node calls)
 *
 * Test categories:
 * 1. GET /api/wallet/:address/balance   — token balance lookup
 * 2. GET /api/wallet/:address/history   — transaction history
 * 3. POST /api/transactions/send        — initiate a token transfer
 * 4. GET /api/transactions/:txHash      — transaction status polling
 * 5. Error handling                     — malformed inputs, node errors
 */

import axios, { AxiosInstance } from "axios";

// ─── Test Setup ───────────────────────────────────────────────────────────

const BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

// Addresses for testing — use Hardhat's deterministic test accounts
const VALID_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const FUNDED_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const EMPTY_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const INVALID_ADDRESS = "not-an-ethereum-address";

// A known confirmed tx hash (from local Hardhat test run)
const CONFIRMED_TX_HASH = "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1";
const PENDING_TX_HASH = "0xpending123def456abc123def456abc123def456abc123def456abc123def456";

let api: AxiosInstance;

beforeAll(() => {
  api = axios.create({
    baseURL: BASE_URL,
    timeout: 10_000,
    validateStatus: () => true, // Don't throw on 4xx/5xx — we'll assert manually
  });
});

// ─── Wallet Balance ───────────────────────────────────────────────────────

describe("GET /api/wallet/:address/balance", () => {
  test("TC-API-001: returns token balance for a valid funded address", async () => {
    /**
     * Business scenario: A game studio queries a player's GTK token balance
     * to determine which in-game items they can afford.
     */
    const response = await api.get(`/api/wallet/${FUNDED_ADDRESS}/balance`);

    expect(response.status).toBe(200);

    // Response schema validation
    expect(response.data).toMatchObject({
      address: FUNDED_ADDRESS,
      balance: expect.any(String),       // BigInt as string to avoid precision loss
      balanceFormatted: expect.any(String), // Human-readable: "1,000.00 GTK"
      token: expect.objectContaining({
        symbol: "GTK",
        decimals: 18,
      }),
    });

    // Balance should be a valid numeric string
    expect(Number(response.data.balance)).toBeGreaterThan(0);
  });

  test("TC-API-002: returns zero balance for address with no tokens", async () => {
    const response = await api.get(`/api/wallet/${EMPTY_ADDRESS}/balance`);

    expect(response.status).toBe(200);
    expect(response.data.balance).toBe("0");
    expect(response.data.balanceFormatted).toBe("0.00 GTK");
  });

  test("TC-API-003: returns 400 for an invalid Ethereum address", async () => {
    /**
     * Validation test: the API should reject malformed addresses before
     * even hitting the blockchain node — saves RPC calls and gives fast feedback.
     */
    const response = await api.get(`/api/wallet/${INVALID_ADDRESS}/balance`);

    expect(response.status).toBe(400);
    expect(response.data).toMatchObject({
      error: expect.stringMatching(/invalid address|malformed/i),
    });
  });

  test("TC-API-004: returns 400 for zero address (0x000...000)", async () => {
    /**
     * The zero address is the null address in Ethereum — it's not a real wallet.
     * Querying it is usually a bug and should be rejected.
     */
    const zeroAddress = "0x0000000000000000000000000000000000000000";
    const response = await api.get(`/api/wallet/${zeroAddress}/balance`);

    expect(response.status).toBe(400);
  });

  test("TC-API-005: response time is under 2000ms for balance query", async () => {
    /**
     * Performance baseline: balance queries should not block the game experience.
     * If this is failing consistently, investigate RPC node latency or add caching.
     */
    const start = Date.now();
    await api.get(`/api/wallet/${VALID_ADDRESS}/balance`);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(2000);
  });
});

// ─── Transaction History ──────────────────────────────────────────────────

describe("GET /api/wallet/:address/history", () => {
  test("TC-API-006: returns paginated transaction history", async () => {
    const response = await api.get(`/api/wallet/${FUNDED_ADDRESS}/history?page=1&limit=10`);

    expect(response.status).toBe(200);

    // Pagination envelope
    expect(response.data).toMatchObject({
      transactions: expect.any(Array),
      pagination: expect.objectContaining({
        page: 1,
        limit: 10,
        total: expect.any(Number),
        hasNext: expect.any(Boolean),
      }),
    });

    // Each transaction should have the key fields
    if (response.data.transactions.length > 0) {
      const tx = response.data.transactions[0];
      expect(tx).toMatchObject({
        hash: expect.stringMatching(/^0x[a-fA-F0-9]{64}$/),
        from: expect.stringMatching(/^0x[a-fA-F0-9]{40}$/),
        to: expect.stringMatching(/^0x[a-fA-F0-9]{40}$/),
        amount: expect.any(String),
        timestamp: expect.any(Number),
        status: expect.stringMatching(/^(confirmed|pending|failed)$/),
        blockNumber: expect.any(Number),
      });
    }
  });

  test("TC-API-007: filters history by transfer direction (sent vs received)", async () => {
    const sentResponse = await api.get(
      `/api/wallet/${FUNDED_ADDRESS}/history?direction=sent`
    );
    const receivedResponse = await api.get(
      `/api/wallet/${FUNDED_ADDRESS}/history?direction=received`
    );

    expect(sentResponse.status).toBe(200);
    expect(receivedResponse.status).toBe(200);

    // Sent txs should have our address as 'from'
    sentResponse.data.transactions.forEach((tx: any) => {
      expect(tx.from.toLowerCase()).toBe(FUNDED_ADDRESS.toLowerCase());
    });

    // Received txs should have our address as 'to'
    receivedResponse.data.transactions.forEach((tx: any) => {
      expect(tx.to.toLowerCase()).toBe(FUNDED_ADDRESS.toLowerCase());
    });
  });

  test("TC-API-008: returns 400 for invalid pagination params", async () => {
    const response = await api.get(
      `/api/wallet/${VALID_ADDRESS}/history?page=-1&limit=99999`
    );
    expect(response.status).toBe(400);
  });
});

// ─── Send Transaction ─────────────────────────────────────────────────────

describe("POST /api/transactions/send", () => {
  test("TC-API-009: accepts valid transfer request and returns pending tx hash", async () => {
    /**
     * Business scenario: Game backend initiates a reward payout to a player's wallet.
     * The API should validate params, submit to the blockchain, and return the tx hash
     * immediately (before confirmation — polling handles confirmation).
     */
    const payload = {
      from: FUNDED_ADDRESS,
      to: EMPTY_ADDRESS,
      amount: "10", // 10 GTK tokens
      privateKey: process.env.TEST_PRIVATE_KEY, // Only in test env — never log this
    };

    const response = await api.post("/api/transactions/send", payload);

    expect(response.status).toBe(202); // 202 Accepted — tx submitted, not yet confirmed
    expect(response.data).toMatchObject({
      txHash: expect.stringMatching(/^0x[a-fA-F0-9]{64}$/),
      status: "pending",
    });
  });

  test("TC-API-010: returns 400 if 'to' address is missing", async () => {
    const response = await api.post("/api/transactions/send", {
      from: FUNDED_ADDRESS,
      amount: "10",
      // 'to' is intentionally missing
    });

    expect(response.status).toBe(400);
    expect(response.data.error).toMatch(/to.*required|missing.*address/i);
  });

  test("TC-API-011: returns 400 if amount is zero or negative", async () => {
    for (const badAmount of ["0", "-5", "0.000000000000000001"]) {
      const response = await api.post("/api/transactions/send", {
        from: FUNDED_ADDRESS,
        to: EMPTY_ADDRESS,
        amount: badAmount,
      });

      expect(response.status).toBe(400);
    }
  });

  test("TC-API-012: returns 422 if sender has insufficient balance", async () => {
    /**
     * Pre-flight balance check: the API should verify the sender has enough tokens
     * before submitting to the blockchain (saves gas fees on doomed transactions).
     */
    const response = await api.post("/api/transactions/send", {
      from: EMPTY_ADDRESS, // This address has 0 tokens
      to: FUNDED_ADDRESS,
      amount: "1000",
    });

    expect(response.status).toBe(422); // Unprocessable Entity
    expect(response.data.error).toMatch(/insufficient balance/i);
  });
});

// ─── Transaction Status Polling ───────────────────────────────────────────

describe("GET /api/transactions/:txHash", () => {
  test("TC-API-013: returns confirmed status for a confirmed transaction", async () => {
    /**
     * After submitting a tx, the frontend polls this endpoint until
     * it sees "confirmed" — then updates the player's UI.
     */
    const response = await api.get(`/api/transactions/${CONFIRMED_TX_HASH}`);

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      hash: CONFIRMED_TX_HASH,
      status: "confirmed",
      blockNumber: expect.any(Number),
      blockTimestamp: expect.any(Number),
      gasUsed: expect.any(String),
      confirmations: expect.any(Number),
    });

    // A confirmed tx must have at least 1 confirmation
    expect(response.data.confirmations).toBeGreaterThanOrEqual(1);
  });

  test("TC-API-014: returns pending status for an unconfirmed transaction", async () => {
    const response = await api.get(`/api/transactions/${PENDING_TX_HASH}`);

    if (response.status === 200) {
      // If found, it must be pending
      expect(response.data.status).toBe("pending");
      expect(response.data.blockNumber).toBeNull();
    } else {
      // Or 404 if not found in mempool yet
      expect(response.status).toBe(404);
    }
  });

  test("TC-API-015: returns 400 for a malformed transaction hash", async () => {
    const response = await api.get("/api/transactions/not-a-valid-hash");

    expect(response.status).toBe(400);
    expect(response.data.error).toMatch(/invalid.*hash|malformed/i);
  });
});

// ─── Error Handling & Resilience ──────────────────────────────────────────

describe("Error Handling", () => {
  test("TC-API-016: responds with structured error format, not raw exceptions", async () => {
    /**
     * All error responses must follow a consistent schema.
     * Raw stack traces or unhandled exceptions reaching the client
     * are a security risk and a poor user experience.
     */
    const response = await api.get(`/api/wallet/${INVALID_ADDRESS}/balance`);

    // Must have an 'error' field
    expect(response.data).toHaveProperty("error");

    // Must NOT leak internal details
    expect(JSON.stringify(response.data)).not.toMatch(/stack|at Object|node_modules/i);
  });

  test("TC-API-017: includes request ID in error responses for traceability", async () => {
    /**
     * Observability requirement: every response (including errors) should include
     * a request ID so support staff can correlate user-reported issues with logs.
     */
    const response = await api.get(`/api/wallet/${INVALID_ADDRESS}/balance`);

    // Either in body or headers
    const hasRequestId =
      response.headers["x-request-id"] !== undefined ||
      response.data["requestId"] !== undefined;

    expect(hasRequestId).toBe(true);
  });
});
