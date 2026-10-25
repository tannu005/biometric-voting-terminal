// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VotingSystem {

    // Stores whether a voter has already voted.
    mapping(bytes32 => bool) public hasVoted;

    // Stores the number of votes received by each candidate.
    mapping(uint256 => uint256) public candidateVotes;

    // Determines whether voting is currently allowed.
    bool public electionOpen;

    // Total number of candidates.
    uint256 public candidateCount;

    // Address allowed to control the election.
    address public owner;

    // Restricts certain functions to the owner.
    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    // Configure candidates and owner during deployment.
    constructor(uint256 _candidateCount) {
        require(_candidateCount > 0, "No candidates");

        owner = msg.sender;
        candidateCount = _candidateCount;
        electionOpen = true;
    }

    // Cast a vote for a candidate.
    function castVote(
        bytes32 voterHash,
        uint256 candidateId
    ) external {

        require(electionOpen, "Election is closed");
        require(!hasVoted[voterHash], "Voter has already voted");
        require(candidateId < candidateCount, "Invalid candidate");

        hasVoted[voterHash] = true;
        candidateVotes[candidateId]++;
    }

    // Close the election. Only owner can do this.
    function closeElection() external onlyOwner {
        electionOpen = false;
    }

    // Re-open the election. Only owner can do this.
    function openElection() external onlyOwner {
        electionOpen = true;
    }

    // Retrieve a candidate's vote count.
    function getCandidateVotes(
        uint256 candidateId
    ) external view returns (uint256) {

        require(candidateId < candidateCount, "Invalid candidate");

        return candidateVotes[candidateId];
    }
}