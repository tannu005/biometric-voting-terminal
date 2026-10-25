import os
import hashlib
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger("blockchain")

RPC_URL = os.environ.get("ANVIL_RPC_URL", "http://127.0.0.1:8545")
CONTRACT_ADDRESS = os.environ.get("CONTRACT_ADDRESS", "0x5FbDB2315678afecb367f032d93F642f64180aa3")
PRIVATE_KEY = os.environ.get("ANVIL_PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
SYSTEM_SALT = os.environ.get("SYSTEM_SALT", "LOCAL_TEST_SALT_2026")

CONTRACT_ABI = [
    {
        "inputs": [
            {"internalType": "bytes32", "name": "voterHash", "type": "bytes32"},
            {"internalType": "uint256", "name": "candidateId", "type": "uint256"}
        ],
        "name": "castVote",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "candidateCount",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "name": "candidateVotes",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "electionOpen",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
        "name": "hasVoted",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "uint256", "name": "candidateId", "type": "uint256"}
        ],
        "name": "getCandidateVotes",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
]

def generate_voter_hash(voter_id: str) -> bytes:
    data = f"{SYSTEM_SALT}:{voter_id.strip().upper()}".encode("utf-8")
    return hashlib.sha256(data).digest()

def get_web3_instance():
    try:
        from web3 import Web3
        w3 = Web3(Web3.HTTPProvider(RPC_URL))
        if w3.is_connected():
            return w3
    except Exception:
        pass
    return None

def is_blockchain_ready() -> bool:
    w3 = get_web3_instance()
    return w3 is not None

def cast_vote_on_chain(voter_hash_hex: str, candidate_id: int) -> Optional[str]:
    w3 = get_web3_instance()
    if not w3:
        return None

    try:
        from web3 import Web3
        clean_hex = voter_hash_hex.strip()
        if clean_hex.startswith("0x"):
            clean_hex = clean_hex[2:]
        voter_hash_bytes = bytes.fromhex(clean_hex)

        account = w3.eth.account.from_key(PRIVATE_KEY)
        account_addr = Web3.to_checksum_address(account.address)
        contract_addr = Web3.to_checksum_address(CONTRACT_ADDRESS)

        contract = w3.eth.contract(address=contract_addr, abi=CONTRACT_ABI)

        if not contract.functions.electionOpen().call():
            logger.warning("Election is closed on-chain.")
            return None

        if contract.functions.hasVoted(voter_hash_bytes).call():
            logger.warning("Voter already voted on-chain.")
            return None

        candidate_count = contract.functions.candidateCount().call()
        if candidate_id < 0 or candidate_id >= candidate_count:
            logger.warning(f"Invalid candidate_id {candidate_id} for candidateCount {candidate_count}")
            return None

        nonce = w3.eth.get_transaction_count(account_addr)
        tx = contract.functions.castVote(voter_hash_bytes, candidate_id).build_transaction({
            "from": account_addr,
            "nonce": nonce,
            "gas": 200000,
            "gasPrice": w3.eth.gas_price
        })

        signed = w3.eth.account.sign_transaction(tx, private_key=PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=10)

        if receipt.status == 1:
            tx_hex = tx_hash.hex()
            if not tx_hex.startswith("0x"):
                tx_hex = "0x" + tx_hex
            logger.info(f"On-chain vote confirmed! TX: {tx_hex}")
            return tx_hex
    except Exception as e:
        logger.warning(f"On-chain castVote error: {e}")
    return None

def get_candidate_votes(candidate_id: int) -> Optional[int]:
    w3 = get_web3_instance()
    if not w3:
        return None
    try:
        from web3 import Web3
        contract_addr = Web3.to_checksum_address(CONTRACT_ADDRESS)
        contract = w3.eth.contract(address=contract_addr, abi=CONTRACT_ABI)
        return contract.functions.candidateVotes(candidate_id).call()
    except Exception as e:
        logger.warning(f"Error reading candidate votes: {e}")
        return None
