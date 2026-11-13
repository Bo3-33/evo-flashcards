import pathlib
import sys
import types
import unittest
from unittest.mock import patch

SOURCE = (pathlib.Path(__file__).parents[1] / "dist" / "FLASH.py").read_text()


class ViewerTests(unittest.TestCase):
    def run_viewer(self, keys, modules, deck_name=None):
        screen = {}
        frames = []

        def wait():
            frames.append(dict(screen))
            return next(keys)

        ti = types.SimpleNamespace(
            disp_at=lambda row, text, _: screen.update({row: text}),
            disp_clr=screen.clear,
            wait_key=wait,
        )
        with patch.dict(sys.modules, {"ti_system": ti, **modules}):
            with patch("builtins.input", return_value=deck_name):
                exec(SOURCE, {})
        return frames

    def test_picker_navigation_and_two_decks(self):
        frames = self.run_viewer(iter([105, 24, 105, 26, 34, 45, 34, 105, 45, 45]), {
            "FLINDEX": types.SimpleNamespace(DECKS=("ZOO", "BIO", "BIO")),
            "BIO": types.SimpleNamespace(CARDS=(("one", "answer"), ("\n".join(map(str, range(9))), "last"))),
            "ZOO": types.SimpleNamespace(CARDS=(("animal", "answer"),)),
        })
        self.assertEqual(frames[0][3], "> BIO")
        self.assertEqual(frames[2][1], "1/2 Front")
        self.assertEqual(frames[3][1], "1/2 Back")
        self.assertEqual(frames[4][1], "2/2 Front  1/2")
        self.assertEqual(frames[5][3], "7")
        self.assertEqual(frames[8][3], "animal")

    def test_stale_entry_and_manual_open(self):
        frames = self.run_viewer(iter([105, 45, 34, 105, 45, 45]), {
            "FLINDEX": types.SimpleNamespace(DECKS=("MISSING",)),
            "BIO": types.SimpleNamespace(CARDS=(("manual", "answer"),)),
        }, "bio")
        self.assertEqual(frames[1][1], "Deck unavailable")
        self.assertEqual(frames[4][3], "manual")

    def test_empty_picker(self):
        frames = self.run_viewer(iter([45]), {"FLINDEX": None})
        self.assertEqual(frames[0][6], "> Open by name")


if __name__ == "__main__":
    unittest.main()
