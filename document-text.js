import { unzipSync } from "./vendor/fflate.js";

const maxFile = 20 * 1024 * 1024;
const maxXml = 12 * 1024 * 1024;
const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const odf = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";

function xmlText(bytes, extension) {
  const path = extension === "docx" ? "word/document.xml" : "content.xml";
  const files = unzipSync(bytes, { filter: file => file.name === path && file.originalSize <= maxXml });
  if (!files[path]) throw new Error("The document text is missing or too large to import.");
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(files[path]), "application/xml");
  if (xml.getElementsByTagNameNS("*", "parsererror").length) throw new Error("The document contains invalid XML.");
  const namespace = extension === "docx" ? word : odf;
  const paragraphs = [...xml.getElementsByTagNameNS(namespace, "*")]
    .filter(node => node.localName === "p" || (namespace === odf && node.localName === "h"));
  function extract(node) {
    if (node.nodeType === 3 || node.nodeType === 4) return namespace === odf ? node.nodeValue : "";
    if (node.namespaceURI === namespace) {
      const name = node.localName;
      if (namespace === word && name === "t") return node.textContent;
      if (["tab"].includes(name)) return "\t";
      if (["br", "cr", "line-break"].includes(name)) return "\n";
      if (namespace === odf && name === "s") {
        return " ".repeat(Math.min(1024, Math.max(1, Number(node.getAttributeNS(odf, "c")) || 1)));
      }
      if (["drawing", "object", "del", "pict", "note"].includes(name)) return "";
    }
    return [...node.childNodes].map(extract).join("");
  }
  return paragraphs.map(extract).join("\n");
}

const destinations = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object",
  "header", "footer", "headerl", "headerr", "footerl", "footerr", "listtable",
  "listoverridetable", "fldinst", "datastore", "themedata", "generator", "xmlnstbl"]);
const substitutions = new Map(Object.entries({
  par: "\n", line: "\n", page: "\n\n", tab: "\t", cell: "\t", row: "\n",
  emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”"
}));

export function rtfText(bytes) {
  const input = new TextDecoder("windows-1252").decode(bytes);
  if (!/^\s*\{\\rtf\d+\b/.test(input)) throw new Error("This file is not a valid RTF document.");
  let decoder = new TextDecoder("windows-1252");
  let state = { skip: false, fallback: 1 };
  let ignore = 0;
  const stack = [];
  const output = [];
  const tokens = /\\([a-z]+)(-?\d+)? ?|\\'([a-f\d]{2})|\\([\s\S])|[{}]|[^\\{}]+/giy;
  while (tokens.lastIndex < input.length) {
    const token = tokens.exec(input);
    if (!token) throw new Error("This RTF document has invalid syntax.");
    const [raw, command, argument, hex, symbol] = token;
    if (raw === "{") {
      stack.push(state);
      state = { ...state };
      continue;
    }
    if (raw === "}") {
      if (!stack.length) throw new Error("This RTF document has unbalanced groups.");
      state = stack.pop();
      continue;
    }
    if (command === "bin") {
      tokens.lastIndex += Math.max(0, Number(argument) || 0);
      continue;
    }
    if (symbol === "*" || destinations.has(command)) state.skip = true;
    if (state.skip) continue;
    if (command === "ansicpg") {
      try { decoder = new TextDecoder("windows-" + argument); } catch { /* Use the default code page. */ }
    } else if (command === "uc") {
      state.fallback = Math.max(0, Number(argument) || 0);
    } else if (command === "u" && argument !== undefined) {
      output.push(String.fromCharCode(Number(argument) & 65535));
      ignore = state.fallback;
    } else if (substitutions.has(command)) {
      output.push(substitutions.get(command));
    } else if (!command && symbol !== "*") {
      const characters = hex ? decoder.decode(Uint8Array.of(parseInt(hex, 16)))
        : symbol ? ({ "~": " ", "_": "-", "\\": "\\", "{": "{", "}": "}" })[symbol] ?? ""
        : raw.replace(/[\r\n]/g, "");
      const skipped = Math.min(ignore, characters.length);
      output.push(characters.slice(skipped));
      ignore -= skipped;
    }
  }
  if (stack.length) throw new Error("This RTF document has unbalanced groups.");
  return output.join("").trim();
}

export async function importNoteFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (!["txt", "md", "docx", "odt", "rtf"].includes(extension)) {
    throw new Error("Choose a .txt, .md, .docx, .odt, or .rtf file.");
  }
  if (file.size > maxFile) throw new Error("Choose a document under 20 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text;
  try {
    if (extension === "rtf") text = rtfText(bytes);
    else if (extension === "docx" || extension === "odt") text = xmlText(bytes, extension);
    else text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError && ["txt", "md"].includes(extension)) {
      throw new Error("Save the text file as UTF‑8 and try again.");
    }
    if (extension === "docx" || extension === "odt") {
      throw new Error("Could not extract text from this document. Check that it opens and is not password protected.");
    }
    throw error;
  }
  if (!text.trim()) throw new Error("No readable text was found in the document.");
  return text;
}
