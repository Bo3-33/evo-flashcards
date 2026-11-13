import { validName } from "./decks.js";

const width = 25;
export const noteRows = 8;

function wrap(text) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let rest = Array.from(paragraph);
    while (rest.length > width) {
      const space = rest.slice(0, width + 1).lastIndexOf(" ");
      const cut = space > 0 ? space : width;
      lines.push(rest.slice(0, cut).join(""));
      rest = rest.slice(cut);
      while (rest[0] === " ") rest.shift();
    }
    lines.push(rest.join(""));
  }
  return lines;
}

export function convertNote(text, name) {
  name = name.trim().toUpperCase();
  if (!validName(name)) {
    throw new Error("Use 1–8 letters or digits, starting with a letter. FLASH and FLINDEX are reserved.");
  }
  if (!text.trim()) throw new Error("Enter some text for the note.");
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").trimEnd();
  const lines = wrap(normalized);
  const source = `# Evo Flashcards note v1
from ti_system import disp_at, disp_clr, wait_key

LINES = (
${lines.map(line => "    " + JSON.stringify(line) + ",").join("\n")}
)
ROWS = ${noteRows}

def main():
    first = 0
    last = max(0, len(LINES) - ROWS)
    while True:
        disp_clr()
        disp_at(1, "${name} " + str(first + 1) + "/" + str(len(LINES)), "left")
        for i in range(min(ROWS, len(LINES) - first)):
            disp_at(i + 2, LINES[first + i], "left")
        disp_at(11, "Arrows scroll  CLEAR exit", "left")
        key = wait_key()
        if key == 45:
            disp_clr()
            return
        if key == 25:
            first = max(0, first - 1)
        elif key == 34:
            first = min(last, first + 1)
        elif key == 24:
            first = max(0, first - ROWS)
        elif key == 26:
            first = min(last, first + ROWS)

main()
`;
  if (new TextEncoder().encode(source).length > 65535) {
    throw new Error("This note exceeds the Evo source format limit. Split it into smaller notes.");
  }
  return { name, lines, source };
}
