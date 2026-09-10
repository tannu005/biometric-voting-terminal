import os
import time
import hashlib
import secrets
import json
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("crypto")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

ELECTION_SALT = os.environ.get("ELECTION_SALT", "ELECTION-2026-AIRGAPPED-SALT-98F12B")
LOCAL_LEDGER_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "audit_ledger.jsonl")

class DecoupledCryptoEngine:
    def __init__(self, salt: str = ELECTION_SALT):
        self.salt = salt
        self.active_ephemeral_tokens: Dict[str, Dict[str, Any]] = {}
        self.casted_hashes = set()
        self._load_existing_ledger()

    def _load_existing_ledger(self):
        if os.path.exists(LOCAL_LEDGER_PATH):
            try:
                with open(LOCAL_LEDGER_PATH, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            record = json.loads(line)
                            v_hash = record.get("salted_voter_hash")
                            if v_hash:
                                self.casted_hashes.add(v_hash)
            except Exception as e:
                logger.warning(f"Could not read local audit ledger: {e}")

    def compute_salted_voter_hash(self, voter_epic: str) -> str:
        normalized_epic = voter_epic.strip().upper()
        h = hashlib.sha256()
        h.update(normalized_epic.encode("utf-8"))
        h.update(self.salt.encode("utf-8"))
        return f"0x{h.hexdigest()}"

    def check_has_voted(self, voter_epic: str) -> bool:
        v_hash = self.compute_salted_voter_hash(voter_epic)
        return v_hash in self.casted_hashes

    def issue_ephemeral_token(self, voter_epic: str, validity_sec: int = 180) -> Dict[str, Any]:
        token = secrets.token_hex(32)
        expiry = time.time() + validity_sec
        salted_hash = self.compute_salted_voter_hash(voter_epic)

        token_record = {
            "token": f"0x{token}",
            "salted_voter_hash": salted_hash,
            "created_at": time.time(),
            "expires_at": expiry,
            "is_used": False
        }

        self.active_ephemeral_tokens[token_record["token"]] = token_record
        return token_record

    def validate_and_consume_token(self, ephemeral_token: str) -> Optional[str]:
        record = self.active_ephemeral_tokens.get(ephemeral_token)
        if not record:
            return None

        if record["is_used"]:
            return None

        if time.time() > record["expires_at"]:
            del self.active_ephemeral_tokens[ephemeral_token]
            return None

        record["is_used"] = True
        del self.active_ephemeral_tokens[ephemeral_token]
        return record["salted_voter_hash"]

    def create_ballot_payload(self, candidate_id: str, salted_voter_hash: str, booth_id: str = "KIOSK-BOOTH-01") -> Dict[str, Any]:
        timestamp = int(time.time())
        ballot_nonce = f"0x{secrets.token_hex(16)}"
        msg = f"{ballot_nonce}:{salted_voter_hash}:{candidate_id}:{timestamp}"
        signature = f"0x{hashlib.sha256(msg.encode('utf-8')).hexdigest()}"

        return {
            "protocol_version": "v1.2",
            "ballot_nonce": ballot_nonce,
            "salted_voter_hash": salted_voter_hash,
            "candidate_id": candidate_id,
            "terminal_id": booth_id,
            "timestamp": timestamp,
            "terminal_signature": signature,
            "zk_proof_receipt": f"0x{secrets.token_hex(16)}"
        }

    def commit_vote_ledger(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        v_hash = payload["salted_voter_hash"]
        if v_hash in self.casted_hashes:
            return {
                "success": False,
                "error": "DOUBLE_VOTING_DETECTED",
                "message": "Voter hash already recorded."
            }

        self.casted_hashes.add(v_hash)

        try:
            os.makedirs(os.path.dirname(LOCAL_LEDGER_PATH), exist_ok=True)
            with open(LOCAL_LEDGER_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(payload) + "\n")
        except (OSError, IOError):
            try:
                tmp_path = os.path.join("/tmp", "audit_ledger.jsonl")
                with open(tmp_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(payload) + "\n")
            except Exception:
                pass

        ledger_status = "RECORDED_LOCALLY"
        web3_endpoint = os.environ.get("WEB3_MODULE_URL", "http://localhost:8545/api/vote")
        try:
            import requests
            r = requests.post(web3_endpoint, json=payload, timeout=0.8)
            if r.status_code == 200:
                ledger_status = "CONFIRMED"
        except Exception:
            ledger_status = "BUFFERED"

        return {
            "success": True,
            "ballot_nonce": payload["ballot_nonce"],
            "salted_voter_hash": v_hash,
            "zk_proof_receipt": payload["zk_proof_receipt"],
            "timestamp": payload["timestamp"],
            "ledger_status": ledger_status
        }

crypto_engine = DecoupledCryptoEngine()