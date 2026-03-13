/**
 * GameToken.test.js
 *
 * Comprehensive test suite for the GameToken ERC-20 smart contract.
 *
 * Testing strategy:
 * - Every public function has both a happy-path and at least one revert test
 * - State assertions check BEFORE and AFTER to prove the change happened
 * - Event emission is verified (contracts communicate via events — test them!)
 * - Edge cases: zero address, zero amount, max supply boundary
 *
 * Run: npx hardhat test
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper: convert human-readable token amounts to wei (18 decimals)
const toTokens = (amount) => ethers.parseUnits(amount.toString(), 18);

describe("GameToken", function () {
  // ─── Fixtures ────────────────────────────────────────────────────────────

  /**
   * Deploy a fresh contract before each test group.
   * Using a fixture pattern keeps tests isolated — no shared state bleeds between tests.
   */
  async function deployGameTokenFixture() {
    const [owner, player1, player2, attacker] = await ethers.getSigners();

    const INITIAL_SUPPLY = toTokens(1_000_000); // 1M tokens
    const MAX_SUPPLY = toTokens(10_000_000);    // 10M cap

    const GameToken = await ethers.getContractFactory("GameToken");
    const token = await GameToken.deploy(
      "GameToken",
      "GTK",
      INITIAL_SUPPLY,
      MAX_SUPPLY
    );

    return { token, owner, player1, player2, attacker, INITIAL_SUPPLY, MAX_SUPPLY };
  }

  // ─── Deployment ──────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("should set the correct token name and symbol", async function () {
      const { token } = await deployGameTokenFixture();

      expect(await token.name()).to.equal("GameToken");
      expect(await token.symbol()).to.equal("GTK");
    });

    it("should set decimals to 18", async function () {
      const { token } = await deployGameTokenFixture();
      expect(await token.decimals()).to.equal(18);
    });

    it("should assign the entire initial supply to the owner", async function () {
      const { token, owner, INITIAL_SUPPLY } = await deployGameTokenFixture();

      const ownerBalance = await token.balanceOf(owner.address);
      expect(ownerBalance).to.equal(INITIAL_SUPPLY);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);
    });

    it("should set the deployer as owner", async function () {
      const { token, owner } = await deployGameTokenFixture();
      expect(await token.owner()).to.equal(owner.address);
    });

    it("should NOT deploy if max supply < initial supply", async function () {
      const GameToken = await ethers.getContractFactory("GameToken");
      await expect(
        GameToken.deploy("GameToken", "GTK", toTokens(1000), toTokens(500))
      ).to.be.revertedWith("GameToken: max supply must be >= initial supply");
    });

    it("should start unpaused", async function () {
      const { token } = await deployGameTokenFixture();
      expect(await token.paused()).to.equal(false);
    });
  });

  // ─── Transfer ────────────────────────────────────────────────────────────

  describe("transfer()", function () {
    it("should transfer tokens and update both balances correctly", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();
      const transferAmount = toTokens(500);

      const ownerBefore = await token.balanceOf(owner.address);
      const player1Before = await token.balanceOf(player1.address);

      await token.transfer(player1.address, transferAmount);

      // Assert sender balance decreased
      expect(await token.balanceOf(owner.address)).to.equal(ownerBefore - transferAmount);
      // Assert recipient balance increased
      expect(await token.balanceOf(player1.address)).to.equal(player1Before + transferAmount);
    });

    it("should emit a Transfer event with correct args", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();
      const amount = toTokens(100);

      await expect(token.transfer(player1.address, amount))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, player1.address, amount);
    });

    it("should revert if sender has insufficient balance", async function () {
      const { token, player1, player2 } = await deployGameTokenFixture();

      // player1 has no tokens — trying to send 1 should fail
      await expect(
        token.connect(player1).transfer(player2.address, toTokens(1))
      ).to.be.revertedWith("GameToken: insufficient balance");
    });

    it("should revert if recipient is the zero address", async function () {
      const { token, owner } = await deployGameTokenFixture();

      await expect(
        token.transfer(ethers.ZeroAddress, toTokens(100))
      ).to.be.revertedWith("GameToken: transfer to zero address");
    });

    it("should allow transferring zero tokens without reverting", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();
      // Zero transfers are valid per ERC-20 spec
      await expect(token.transfer(player1.address, 0)).not.to.be.reverted;
    });

    it("should revert transfer when contract is paused", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();

      await token.pause();

      await expect(
        token.transfer(player1.address, toTokens(100))
      ).to.be.revertedWith("GameToken: token transfers are paused");
    });
  });

  // ─── Approve & transferFrom ──────────────────────────────────────────────

  describe("approve() and transferFrom()", function () {
    it("should set allowance correctly after approve()", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();
      const approvalAmount = toTokens(1000);

      await token.approve(player1.address, approvalAmount);

      expect(await token.allowance(owner.address, player1.address)).to.equal(approvalAmount);
    });

    it("should emit Approval event", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();
      const amount = toTokens(500);

      await expect(token.approve(player1.address, amount))
        .to.emit(token, "Approval")
        .withArgs(owner.address, player1.address, amount);
    });

    it("should allow approved spender to transferFrom successfully", async function () {
      /**
       * Business scenario: A game marketplace contract (player1) is approved
       * to spend tokens on behalf of the player (owner).
       * This is how NFT marketplaces and DeFi protocols work.
       */
      const { token, owner, player1, player2 } = await deployGameTokenFixture();
      const approvalAmount = toTokens(1000);
      const transferAmount = toTokens(400);

      await token.approve(player1.address, approvalAmount);

      const ownerBefore = await token.balanceOf(owner.address);

      await token.connect(player1).transferFrom(owner.address, player2.address, transferAmount);

      // Owner balance reduced
      expect(await token.balanceOf(owner.address)).to.equal(ownerBefore - transferAmount);
      // Recipient received tokens
      expect(await token.balanceOf(player2.address)).to.equal(transferAmount);
      // Allowance consumed
      expect(await token.allowance(owner.address, player1.address)).to.equal(
        approvalAmount - transferAmount
      );
    });

    it("should revert transferFrom if allowance is insufficient", async function () {
      const { token, owner, player1, player2 } = await deployGameTokenFixture();

      // Approve 100, try to spend 200
      await token.approve(player1.address, toTokens(100));

      await expect(
        token.connect(player1).transferFrom(owner.address, player2.address, toTokens(200))
      ).to.be.revertedWith("GameToken: insufficient allowance");
    });

    it("should revert transferFrom if source has insufficient balance", async function () {
      const { token, owner, player1, player2 } = await deployGameTokenFixture();

      // Give player1 a large allowance but owner will have no tokens
      await token.approve(player1.address, toTokens(999_999_999));

      // Transfer all owner tokens away first
      const ownerBalance = await token.balanceOf(owner.address);
      await token.transfer(player2.address, ownerBalance);

      await expect(
        token.connect(player1).transferFrom(owner.address, player2.address, toTokens(1))
      ).to.be.revertedWith("GameToken: insufficient balance");
    });

    it("should revert transferFrom when paused", async function () {
      const { token, owner, player1, player2 } = await deployGameTokenFixture();

      await token.approve(player1.address, toTokens(1000));
      await token.pause();

      await expect(
        token.connect(player1).transferFrom(owner.address, player2.address, toTokens(100))
      ).to.be.revertedWith("GameToken: token transfers are paused");
    });
  });

  // ─── Minting ─────────────────────────────────────────────────────────────

  describe("mint()", function () {
    it("should allow owner to mint tokens up to max supply", async function () {
      const { token, owner, player1, INITIAL_SUPPLY } = await deployGameTokenFixture();
      const mintAmount = toTokens(5000);

      await token.mint(player1.address, mintAmount);

      expect(await token.balanceOf(player1.address)).to.equal(mintAmount);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY + mintAmount);
    });

    it("should emit Mint and Transfer events on mint", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();
      const amount = toTokens(1000);

      await expect(token.mint(player1.address, amount))
        .to.emit(token, "Mint")
        .withArgs(player1.address, amount)
        .and.to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, player1.address, amount); // ERC-20: mint = transfer from 0x0
    });

    it("should revert mint if it would exceed max supply", async function () {
      const { token, owner, player1, MAX_SUPPLY, INITIAL_SUPPLY } = await deployGameTokenFixture();
      const remaining = MAX_SUPPLY - INITIAL_SUPPLY;
      const tooMany = remaining + toTokens(1);

      await expect(
        token.mint(player1.address, tooMany)
      ).to.be.revertedWith("GameToken: max supply exceeded");
    });

    it("should revert mint if called by non-owner", async function () {
      const { token, attacker, player1 } = await deployGameTokenFixture();

      await expect(
        token.connect(attacker).mint(player1.address, toTokens(1000))
      ).to.be.revertedWith("GameToken: caller is not the owner");
    });

    it("should allow minting exactly up to max supply boundary", async function () {
      /**
       * Boundary value test: minting exactly the remaining capacity should succeed.
       * One token more should fail (tested above). Classic off-by-one boundary check.
       */
      const { token, owner, player1, MAX_SUPPLY, INITIAL_SUPPLY } = await deployGameTokenFixture();
      const exactRemaining = MAX_SUPPLY - INITIAL_SUPPLY;

      await expect(token.mint(player1.address, exactRemaining)).not.to.be.reverted;
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    });
  });

  // ─── Pause / Unpause ─────────────────────────────────────────────────────

  describe("pause() and unpause()", function () {
    it("should allow owner to pause and unpause", async function () {
      const { token, owner } = await deployGameTokenFixture();

      await token.pause();
      expect(await token.paused()).to.equal(true);

      await token.unpause();
      expect(await token.paused()).to.equal(false);
    });

    it("should emit Paused and Unpaused events", async function () {
      const { token, owner } = await deployGameTokenFixture();

      await expect(token.pause()).to.emit(token, "Paused").withArgs(owner.address);
      await expect(token.unpause()).to.emit(token, "Unpaused").withArgs(owner.address);
    });

    it("should revert pause if already paused", async function () {
      const { token } = await deployGameTokenFixture();
      await token.pause();
      await expect(token.pause()).to.be.revertedWith("GameToken: already paused");
    });

    it("should revert unpause if not paused", async function () {
      const { token } = await deployGameTokenFixture();
      await expect(token.unpause()).to.be.revertedWith("GameToken: not paused");
    });

    it("should NOT pause if called by non-owner", async function () {
      const { token, attacker } = await deployGameTokenFixture();
      await expect(token.connect(attacker).pause()).to.be.revertedWith(
        "GameToken: caller is not the owner"
      );
    });

    it("should resume transfers correctly after unpause", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();

      await token.pause();
      await token.unpause();

      // Transfer should now succeed
      await expect(token.transfer(player1.address, toTokens(100))).not.to.be.reverted;
    });
  });

  // ─── Ownership ───────────────────────────────────────────────────────────

  describe("transferOwnership()", function () {
    it("should transfer ownership to a new address", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();

      await token.transferOwnership(player1.address);
      expect(await token.owner()).to.equal(player1.address);
    });

    it("should emit OwnershipTransferred event", async function () {
      const { token, owner, player1 } = await deployGameTokenFixture();

      await expect(token.transferOwnership(player1.address))
        .to.emit(token, "OwnershipTransferred")
        .withArgs(owner.address, player1.address);
    });

    it("should prevent old owner from minting after ownership transfer", async function () {
      /**
       * Security test: after transferring ownership, the old owner loses
       * privileged access. This is a critical security property.
       */
      const { token, owner, player1 } = await deployGameTokenFixture();

      await token.transferOwnership(player1.address);

      await expect(
        token.connect(owner).mint(owner.address, toTokens(1000))
      ).to.be.revertedWith("GameToken: caller is not the owner");
    });

    it("should revert ownership transfer to zero address", async function () {
      const { token } = await deployGameTokenFixture();

      await expect(
        token.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("GameToken: new owner is zero address");
    });
  });
});
