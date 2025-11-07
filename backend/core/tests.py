from django.test import TestCase
from django.urls import reverse

class HealthTest(TestCase):
    def test_health(self):
        resp = self.client.get("/api/health/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True})


