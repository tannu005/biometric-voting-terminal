// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {VotingSystem} from "../src/VotingSystem.sol";

contract Deploy is Script {

    function run() external returns (VotingSystem) {

        vm.startBroadcast();

        // Deploy with 3 candidates
        VotingSystem votingSystem = new VotingSystem(3);

        vm.stopBroadcast();

        return votingSystem;
    }
}