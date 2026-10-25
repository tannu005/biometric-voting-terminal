import os
import sys
import uuid
import unittest
import numpy as np
from fastapi.testclient import TestClient

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from hardware.as608 import AS608Driver
from biometrics.face_verify import FacialVerificationPipeline
from biometrics.fusion_engine import BiometricFusionEngine
from backend.crypto_utils import DecoupledCryptoEngine
from backend.app import app

class TestAS608Driver(unittest.TestCase):
    def setUp(self):
        self.driver = AS608Driver(mock_mode=True)

    def test_packet_building_and_checksum(self):
        packet = self.driver._build_packet(AS608Driver.PID_COMMAND, bytes([0x01]))
        self.assertEqual(len(packet), 12)
        self.assertEqual(packet[0:2], b'\xef\x01')
        self.assertEqual(packet[2:6], b'\xff\xff\xff\xff')
        self.assertEqual(packet[6], 0x01)

    def test_mock_verification_touch_gating(self):
        res_no_touch = self.driver.verify_fingerprint(expected_voter_slot=1, timeout_sec=1.0, touch_detected=False)
        self.assertEqual(res_no_touch["status"], "MATCH_FAIL")
        self.assertIn("No finger detected", res_no_touch["message"])

        res_touch = self.driver.verify_fingerprint(expected_voter_slot=1, timeout_sec=1.0, touch_detected=True)
        self.assertEqual(res_touch["status"], "MATCH_SUCCESS")
        self.assertGreaterEqual(res_touch["score"], 60)
        self.assertIn("mode", res_touch)


class TestFacialVerification(unittest.TestCase):
    def setUp(self):
        self.pipe = FacialVerificationPipeline()

    def test_signature_extraction_invariance(self):
        img1 = np.full((128, 128, 3), (180, 150, 130), dtype=np.uint8)
        img2 = np.full((128, 128, 3), (180, 150, 130), dtype=np.uint8)
        
        sig1 = self.pipe.extract_face_signature(img1)
        sig2 = self.pipe.extract_face_signature(img2)
        
        self.assertEqual(sig1.shape, sig2.shape)
        sim = self.pipe.compute_similarity(sig1, sig2)
        self.assertAlmostEqual(sim, 1.0, places=2)

    def test_reject_blank_or_non_face(self):
        blank = np.zeros((320, 240, 3), dtype=np.uint8)
        box, liveness, status = self.pipe.detect_face_region(blank)
        self.assertIsNone(box)
        self.assertEqual(status, "NO_FACE")

    def test_detect_real_face_portrait(self):
        import cv2
        portrait_path = os.path.join(ROOT_DIR, "data", "voter_db", "VOTE-IND-2026-001.jpg")
        if os.path.exists(portrait_path):
            img = cv2.imread(portrait_path)
            box, liveness, status = self.pipe.detect_face_region(img)
            self.assertIsNotNone(box)
            self.assertEqual(status, "FACE_DETECTED")
            self.assertGreaterEqual(liveness, 0.50)


class TestCryptographicDecoupling(unittest.TestCase):
    def setUp(self):
        self.crypto = DecoupledCryptoEngine(salt="TEST-SALT-XYZ")

    def test_deterministic_salted_hash(self):
        epic = "VOTE-IND-2026-001"
        hash1 = self.crypto.compute_salted_voter_hash(epic)
        hash2 = self.crypto.compute_salted_voter_hash(epic)
        
        self.assertEqual(hash1, hash2)
        self.assertTrue(hash1.startswith("0x"))
        self.assertEqual(len(hash1), 66)

    def test_ephemeral_token_single_use(self):
        epic = "VOTE-IND-2026-001"
        token_rec = self.crypto.issue_ephemeral_token(epic)
        token_str = token_rec["token"]
        
        consumed_hash = self.crypto.validate_and_consume_token(token_str)
        self.assertIsNotNone(consumed_hash)
        
        second_attempt = self.crypto.validate_and_consume_token(token_str)
        self.assertIsNone(second_attempt)

    def test_double_voting_prevention(self):
        unique_epic = f"VOTE-TEST-{uuid.uuid4().hex[:8]}"
        v_hash = self.crypto.compute_salted_voter_hash(unique_epic)
        payload1 = self.crypto.create_ballot_payload("CAND-01", v_hash)
        
        res1 = self.crypto.commit_vote_ledger(payload1)
        self.assertTrue(res1["success"])
        
        payload2 = self.crypto.create_ballot_payload("CAND-02", v_hash)
        res2 = self.crypto.commit_vote_ledger(payload2)
        self.assertFalse(res2["success"])
        self.assertEqual(res2["error"], "DOUBLE_VOTING_DETECTED")


class TestEndToEndKioskAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.post("/api/admin/reset")

    def test_full_kiosk_voting_flow(self):
        test_epic = "VOTE-IND-2026-001"

        r_lookup = self.client.post("/api/voter/lookup", json={"epic": test_epic})
        self.assertEqual(r_lookup.status_code, 200)
        self.assertEqual(r_lookup.json()["voter"]["epic"], test_epic)

        r_face = self.client.post("/api/biometrics/face-verify", json={"epic": test_epic, "force_mock": True})
        self.assertEqual(r_face.status_code, 200)
        self.assertEqual(r_face.json()["verification"]["status"], "MATCH_SUCCESS")

        r_fp_notouch = self.client.post("/api/biometrics/fingerprint-verify", json={
            "epic": test_epic,
            "method": "LAPTOP_HARDWARE_FINGERPRINT",
            "credential": None
        })
        self.assertEqual(r_fp_notouch.status_code, 200)
        self.assertEqual(r_fp_notouch.json()["verification"]["status"], "MATCH_FAIL")

        r_fp = self.client.post("/api/biometrics/fingerprint-verify", json={
            "epic": test_epic,
            "method": "LAPTOP_HARDWARE_FINGERPRINT",
            "credential": {"id": "laptop_power_button_auth_proof_99"}
        })
        self.assertEqual(r_fp.status_code, 200)
        self.assertEqual(r_fp.json()["verification"]["status"], "MATCH_SUCCESS")

        r_auth = self.client.post("/api/ballot/authorize", json={"epic": test_epic})
        self.assertEqual(r_auth.status_code, 200)
        auth_data = r_auth.json()
        ephemeral_token = auth_data["ephemeral_token"]
        self.assertEqual(len(auth_data["candidates"]), 3)
        self.assertEqual(auth_data["candidates"][0]["contract_id"], 0)
        self.assertEqual(auth_data["candidates"][1]["contract_id"], 1)
        self.assertEqual(auth_data["candidates"][2]["contract_id"], 2)

        r_cast = self.client.post("/api/ballot/cast", json={
            "ephemeral_token": ephemeral_token,
            "candidate_id": "CAND-01",
            "epic": test_epic
        })
        self.assertEqual(r_cast.status_code, 200)
        cast_data = r_cast.json()
        self.assertTrue(cast_data["success"])
        self.assertIn("receipt", cast_data)
        self.assertEqual(cast_data["receipt"]["contract_candidate_id"], 0)

        r_lookup_again = self.client.post("/api/voter/lookup", json={"epic": test_epic})
        self.assertEqual(r_lookup_again.status_code, 409)
        self.assertEqual(r_lookup_again.json()["detail"]["error"], "ALREADY_VOTED")


if __name__ == "__main__":
    unittest.main(verbosity=2)