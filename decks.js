const deckName = /^[A-Z][A-Z0-9]{0,7}$/;
const reserved = new Set(["FLASH", "FLINDEX"]);
const indexHeader = "# Evo Flashcards index v1\n";

export function validName(name) {
  return deckName.test(name) && !reserved.has(name);
}

export function convertCsv(text, name, hasHeader, parser) {
  name = name.trim().toUpperCase();
  if (!validName(name)) {
    throw new Error("Use 1–8 letters or digits, starting with a letter. FLASH and FLINDEX are reserved.");
  }
  const result = parser.parse(text, { delimiter: ",", skipEmptyLines: true });
  const error = result.errors[0];
  if (error) throw new Error(`CSV record ${(error.row ?? 0) + 1}: ${error.message}`);
  const cards = [];
  for (const [index, row] of result.data.entries()) {
    if (row.length !== 2 || row.some(side => !side.trim())) {
      throw new Error(`CSV record ${index + 1} must have two nonempty columns.`);
    }
    if (hasHeader && index === 0) continue;
    cards.push(row);
  }
  if (!cards.length) throw new Error("The CSV needs at least one card.");
  // Normalize actual line endings before quoting, so literal backslashes stay intact.
  const side = value => JSON.stringify(value.replace(/\r\n?/g, "\n"));
  const pairs = cards.map(([front, back]) => `    (${side(front)}, ${side(back)}),`);
  const source = `# Evo Flashcards deck v1\nCARDS = (\n${pairs.join("\n")}\n)\n`;
  if (new TextEncoder().encode(source).length > 65535) {
    throw new Error("This deck exceeds the Evo source format limit. Split the CSV into smaller decks.");
  }
  return { name, source, count: cards.length };
}

export function indexSource(names) {
  return indexHeader + "DECKS = (\n" +
    [...new Set(names)].sort().map(name => `    "${name}",\n`).join("") + ")\n";
}

export function readIndex(source) {
  if (source === null) return [];
  const normalized = source.replace(/\r\n/g, "\n");
  const body = normalized.slice(indexHeader.length + "DECKS = (\n".length, -2);
  const names = body.split("\n").filter(Boolean).map(line => {
    const match = /^    "([A-Z][A-Z0-9]{0,7})",$/.exec(line);
    if (!match || !validName(match[1])) throw new Error("FLINDEX is not a valid flashcard index.");
    return match[1];
  });
  if (indexSource(names) !== normalized) throw new Error("FLINDEX is not a valid flashcard index.");
  return names;
}

export async function pickerState(link) {
  const files = await link.list();
  const indexes = files.filter(file => file.name === "FLINDEX" && file.type === 15);
  if (indexes.some(file => !file.ram) || indexes.length > 1) {
    throw new Error("Move FLINDEX to RAM before sending a deck.");
  }
  const names = readIndex(indexes.length ? await link.readSource(indexes[0]) : null);
  const ramNames = new Set(files.filter(file => file.type === 15 && file.ram).map(file => file.name));
  return { files, hasIndex: indexes.length > 0, names: names.filter(name => ramNames.has(name)), ramNames };
}

export async function addToPicker(link, name, state) {
  if (!state.ramNames.has(name)) {
    throw new Error(`Deck ${name} is missing from RAM. Send it again.`);
  }
  await link.writeSource("FLINDEX", indexSource([...state.names, name]), state.hasIndex);
}
