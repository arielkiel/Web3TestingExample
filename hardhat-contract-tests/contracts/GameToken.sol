// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GameToken
 * @dev A simple ERC-20 token representing in-game currency.
 *
 * Demonstrates standard ERC-20 patterns plus:
 * - Owner-only minting (common in gaming platforms)
 * - Pausable transfers (emergency stop mechanism)
 * - Capped supply (deflationary model)
 *
 * QA Note: Every public function and require() condition
 * has a corresponding test in ../test/GameToken.test.js
 */
contract GameToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    uint256 public maxSupply;

    address public owner;
    bool public paused;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // --- Events ---
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Mint(address indexed to, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // --- Modifiers ---
    modifier onlyOwner() {
        require(msg.sender == owner, "GameToken: caller is not the owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "GameToken: token transfers are paused");
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _maxSupply
    ) {
        require(_maxSupply >= _initialSupply, "GameToken: max supply must be >= initial supply");

        name = _name;
        symbol = _symbol;
        decimals = 18;
        maxSupply = _maxSupply;
        owner = msg.sender;

        _mint(msg.sender, _initialSupply);
    }

    // --- Core ERC-20 ---

    /**
     * @dev Transfer tokens to a recipient.
     * Reverts if: paused, insufficient balance, zero address recipient.
     */
    function transfer(address to, uint256 amount) public whenNotPaused returns (bool) {
        require(to != address(0), "GameToken: transfer to zero address");
        require(balanceOf[msg.sender] >= amount, "GameToken: insufficient balance");

        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;

        emit Transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @dev Approve a spender to use tokens on your behalf.
     */
    function approve(address spender, uint256 amount) public returns (bool) {
        require(spender != address(0), "GameToken: approve to zero address");

        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @dev Transfer tokens from one address to another using an allowance.
     * Reverts if: paused, insufficient allowance, insufficient balance.
     */
    function transferFrom(address from, address to, uint256 amount) public whenNotPaused returns (bool) {
        require(to != address(0), "GameToken: transfer to zero address");
        require(balanceOf[from] >= amount, "GameToken: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "GameToken: insufficient allowance");

        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
        return true;
    }

    // --- Minting ---

    /**
     * @dev Mint new tokens. Only callable by owner. Respects max supply cap.
     */
    function mint(address to, uint256 amount) public onlyOwner {
        require(to != address(0), "GameToken: mint to zero address");
        require(totalSupply + amount <= maxSupply, "GameToken: max supply exceeded");

        _mint(to, amount);
    }

    // --- Emergency Controls ---

    function pause() public onlyOwner {
        require(!paused, "GameToken: already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyOwner {
        require(paused, "GameToken: not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    // --- Ownership ---

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "GameToken: new owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // --- Internal ---

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        emit Mint(to, amount);
    }
}
