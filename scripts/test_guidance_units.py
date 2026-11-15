import unittest
from engine.text_utils import reading_hints


class GuidanceUnitTests(unittest.TestCase):
    def test_ppm_is_not_interpreted_as_partial_pressure(self):
        self.assertEqual(reading_hints("Cabin CO2 6500 ppm"), [])
        self.assertEqual(reading_hints("Cabin CO2 1200 ppm"), [])

    def test_explicit_and_legacy_mmhg_questions_still_match(self):
        for question in ("CO2 is 4 mmHg", "CO2 is 4"):
            self.assertEqual(reading_hints(question)[0][0], "PROTO-ECLSS-01")
