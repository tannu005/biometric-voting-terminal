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
from app import app


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

    def test_strict_facial_verification_genuine_vs_imposter(self):
        import cv2
        p1 = os.path.join(ROOT_DIR, "data", "voter_db", "VOTE-IND-2026-001.jpg")
        p2 = os.path.join(ROOT_DIR, "data", "voter_db", "VOTE-IND-2026-002.jpg")
        if os.path.exists(p1) and os.path.exists(p2):
            img1 = cv2.imread(p1)
            img2 = cv2.imread(p2)

            res_genuine = self.pipe.verify_voter_face("VOTE-IND-2026-001", snapshot_frame=img1)
            self.assertEqual(res_genuine["status"], "MATCH_SUCCESS")
            self.assertGreaterEqual(res_genuine["match_score"], 75.0)

            res_imposter = self.pipe.verify_voter_face("VOTE-IND-2026-001", snapshot_frame=img2)
            self.assertEqual(res_imposter["status"], "MATCH_FAIL")
            self.assertLess(res_imposter["match_score"], 50.0)

    def test_blank_snapshot_rejection(self):
        blank = np.zeros((480, 640, 3), dtype=np.uint8)
        res_blank = self.pipe.verify_voter_face("VOTE-IND-2026-001", snapshot_frame=blank)
        self.assertEqual(res_blank["status"], "MATCH_FAIL")
        self.assertEqual(res_blank["match_score"], 0.0)
        self.assertIn("No face detected", res_blank["message"])


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

        # Step 2: Fingerprint verification
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

        # Step 3: Facial verification
        r_face = self.client.post("/api/biometrics/face-verify", json={"epic": test_epic, "force_mock": True})
        self.assertEqual(r_face.status_code, 200)
        self.assertEqual(r_face.json()["verification"]["status"], "MATCH_SUCCESS")

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

    def test_api_face_verify_rejects_missing_or_blank(self):
        test_epic = "VOTE-IND-2026-002"
        self.client.post("/api/voter/lookup", json={"epic": test_epic})
        r_empty = self.client.post("/api/biometrics/face-verify", json={"epic": test_epic})
        self.assertEqual(r_empty.status_code, 200)
        self.assertEqual(r_empty.json()["verification"]["status"], "MATCH_FAIL")
        self.assertFalse(r_empty.json()["session_status"]["is_fully_validated"])

    def test_pi_camera_endpoint_handles_connection(self):
        r_pi = self.client.post("/api/biometrics/pi-camera-capture")
        self.assertEqual(r_pi.status_code, 200)
        data = r_pi.json()
        self.assertIn("success", data)

    def test_voter_registration_workflow(self):
        # 1. Check next available slot
        r_slot = self.client.get("/api/voter/next-slot")
        self.assertEqual(r_slot.status_code, 200)
        slot_data = r_slot.json()
        self.assertIn("next_slot", slot_data)
        next_slot = slot_data["next_slot"]
        self.assertGreater(next_slot, 0)

        # 2. Register new voter
        test_epic = f"VOTE-IND-TEST-{uuid.uuid4().hex[:6].upper()}"
        dummy_b64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
        r_reg = self.client.post("/api/voter/register", json={
            "epic": test_epic,
            "name": "Integration Test Voter",
            "gender": "Female",
            "dob": "1997-04-10",
            "constituency": "Central Tech Constituency - AC-07",
            "fingerprint_slot": next_slot,
            "photo_base64": dummy_b64
        })
        self.assertEqual(r_reg.status_code, 200)
        reg_data = r_reg.json()
        self.assertTrue(reg_data["success"])
        self.assertEqual(reg_data["voter"]["epic"], test_epic)
        self.assertEqual(reg_data["voter"]["fingerprint_slot"], next_slot)

        # 3. Lookup newly registered voter
        r_lookup = self.client.post("/api/voter/lookup", json={"epic": test_epic})
        self.assertEqual(r_lookup.status_code, 200)
        voter_info = r_lookup.json()["voter"]
        self.assertEqual(voter_info["name"], "Integration Test Voter")

        # 4. Duplicate registration should be rejected
        r_dup = self.client.post("/api/voter/register", json={
            "epic": test_epic,
            "name": "Duplicate Voter",
            "gender": "Male"
        })
        self.assertEqual(r_dup.status_code, 409)

        # Cleanup created test photos and voter record
        for base_p in [os.path.join(ROOT_DIR, "data", "voter_db"), os.path.join(ROOT_DIR, "public", "voter_db")]:
            p = os.path.join(base_p, f"{test_epic}.jpg")
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass

        voters_file = os.path.join(ROOT_DIR, "data", "voters.json")
        if os.path.exists(voters_file):
            try:
                import json
                with open(voters_file, "r", encoding="utf-8") as f:
                    v_list = json.load(f)
                v_filtered = [v for v in v_list if v.get("epic") != test_epic]
                with open(voters_file, "w", encoding="utf-8") as f:
                    json.dump(v_filtered, f, indent=2)
            except Exception:
                pass



if __name__ == "__main__":
    unittest.main(verbosity=2)