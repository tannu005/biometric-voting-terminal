// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {VotingSystem} from "../src/VotingSystem.sol";

contract VotingSystemTest is Test {

    VotingSystem voting;
    address owner = address(this);
    address voter1 = address(0x1234);
    address voter2 = address(0x5678);
    address attacker = address(0x9999);

    bytes32 voterHash1 = keccak256("voter1");
    bytes32 voterHash2 = keccak256("voter2");

    function setUp() public {
        voting = new VotingSystem(3);
    }

    function testInitialState() public view {
        assertEq(voting.candidateCount(), 3);
        assertTrue(voting.electionOpen());
        assertEq(voting.owner(), owner);
    }

    function testValidVote() public {
        vm.prank(voter1);
        voting.castVote(voterHash1, 1);

        assertEq(voting.getCandidateVotes(1), 1);
        assertTrue(voting.hasVoted(voterHash1));
    }

    function testCannotVoteTwice() public {
        vm.prank(voter1);
        voting.castVote(voterHash1, 1);

        vm.prank(voter1);
        vm.expectRevert(
            bytes("Voter has already voted")
        );
        voting.castVote(voterHash1, 1);
    }

    function testCannotVoteForInvalidCandidate() public {
        vm.prank(voter1);
        vm.expectRevert(bytes("Invalid candidate"));
        voting.castVote(voterHash1, 3);
    }

    function testCannotVoteWhenElectionClosed() public {
        voting.closeElection();

        vm.prank(voter1);
        vm.expectRevert(bytes("Election is closed"));
        voting.castVote(voterHash1, 0);
    }

    function testOnlyOwnerCanCloseElection() public {
        vm.prank(attacker);
        vm.expectRevert(bytes("Not the owner"));
        voting.closeElection();
    }

    function testOnlyOwnerCanOpenElection() public {
        voting.closeElection();

        vm.prank(attacker);
        vm.expectRevert(bytes("Not the owner"));
        voting.openElection();
    }

    function testOwnerCanReopenElection() public {
        voting.closeElection();
        voting.openElection();

        assertTrue(voting.electionOpen());
    }

    function testDifferentVotersCanVote() public {
        vm.prank(voter1);
        voting.castVote(voterHash1, 0);

        vm.prank(voter2);
        voting.castVote(voterHash2, 0);

        assertEq(voting.getCandidateVotes(0), 2);
    }

    function testCannotDeployWithZeroCandidates() public {
        vm.expectRevert(bytes("No candidates"));
        new VotingSystem(0);
    }
}