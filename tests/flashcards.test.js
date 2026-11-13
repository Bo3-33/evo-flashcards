import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { convertCsv, indexSource, pickerState, addToPicker } from "../dist/decks.js";
import { chooseEvo, EvoLink, packet, readPacket, sourcePayload, unpackSource, decodeData } from "../dist/evo.js";

const context = {};
runInNewContext(readFileSync(new URL("../dist/vendor/papaparse.min.js", import.meta.url), "utf8"), context);

test("quoted CSV and literal backslashes round-trip through Python", () => {
  const source = convertCsv('Front,Back\r\n007,"a, ""b""\r\nsecond \\r 😀"\r\n', "bio1", true, context.Papa);
  const output = execFileSync("python3", ["-c", "import json,sys; ns={}; exec(sys.stdin.read(),ns); print(json.dumps(ns['CARDS']))"],
    { input: source.source, encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), [["007", 'a, "b"\nsecond \\r 😀']]);
  assert.equal(source.name, "BIO1");
});

test("reports invalid records, reserved names, and header-only CSVs", () => {
  for (const input of ['a,b,c', 'a,', '"a,b', 'a,b\nc']) {
    assert.throws(() => convertCsv(input, "BIO", false, context.Papa), /record/);
  }
  assert.throws(() => convertCsv("a,b", "FLINDEX", false, context.Papa), /reserved/);
  assert.throws(() => convertCsv("a,b", "BIO", true, context.Papa), /least one/);
});

test("Evo source container matches the reference payload", () => {
  const body = sourcePayload("BIO1", "CARDS = ()\n");
  assert.equal(Buffer.from(body).toString("hex"),
    "bf686d65746144617461bf64747970650f6776657273696f6e01646e616d654801e808e80ee802e4ff6776657273696f6e016473697a6518216464617461582113010000210000000400000042494f31000b0000024341524453203d2028290a00ff");
  assert.equal(unpackSource(body), "CARDS = ()\n");
});

test("calculator chooser filters to the Evo and handles cancellation", async () => {
  const port = {};
  assert.deepEqual(await chooseEvo({ serial: { requestPort(options) {
    assert.deepEqual(options.filters, [{ usbVendorId: 0x0451, usbProductId: 0xe018 }]);
    return port;
  } } }), { port });
  await assert.rejects(chooseEvo({ serial: { requestPort() {
    throw new DOMException("Canceled", "NotFoundError");
  } } }), /No calculator selected/);
});

test("Kermit serial transport accepts fragmented ACKs and encodes the complete write", async () => {
  const replies = [];
  const sent = [];
  const link = new EvoLink({
    async write(bytes) {
      const frame = readPacket(bytes);
      sent.push(frame);
      const reply = packet(frame.seq, "Y");
      replies.push(reply.subarray(0, 2), reply.subarray(2));
    },
    async read() { return replies.shift(); }
  });
  const source = "# comment\n" + 'CARDS = (("a #~", "β"),)\n'.repeat(260);
  await link.writeSource("BIO1", source, false);
  assert.match(Buffer.from(sent[1].data).toString(), /type=15&memtarget=0&policy=0$/);
  assert.equal(sent.at(-1).kind, "B");
  assert.equal(unpackSource(decodeData(Buffer.concat(sent.filter(p => p.kind === "D").map(p => p.data)))), source);
});

test("get resource handles a combined ACK and response and suppresses duplicate data", async () => {
  const replies = [];
  const sent = [];
  const link = new EvoLink({
    async write(bytes) {
      const frame = readPacket(bytes);
      sent.push(frame);
      if (frame.kind === "Y") return;
      if (frame.kind === "B") {
        const data = packet(3, "D", new TextEncoder().encode("ok"));
        replies.push(Buffer.concat([packet(frame.seq, "Y"), packet(0, "S"), packet(1, "F"),
          packet(2, "A"), data, data, packet(4, "Z"), packet(5, "B")]));
      } else replies.push(packet(frame.seq, "Y"));
    },
    async read() { return replies.shift(); }
  });
  assert.equal(new TextDecoder().decode(await link.get("test")), "ok");
  assert.equal(sent.filter(frame => frame.kind === "Y" && frame.seq === 3).length, 2);
});

test("picker prunes stale decks and retries an interrupted index write", async () => {
  const writes = [];
  let index = indexSource(["ZOO", "DELETED"]);
  const link = {
    list: async () => ["ZOO", "BIO", "FLINDEX"].map(name => ({ name, type: 15, ram: true })),
    readSource: async () => index,
    async writeSource(name, source, overwrite) {
      assert.equal(name, "FLINDEX");
      assert.equal(overwrite, true);
      writes.push(name);
      if (writes.length === 1) throw new Error("Disconnected");
      index = source;
    }
  };
  await assert.rejects(addToPicker(link, "BIO", await pickerState(link)), /Disconnected/);
  assert.equal(index, indexSource(["ZOO", "DELETED"]));
  await addToPicker(link, "BIO", await pickerState(link));
  assert.equal(index, indexSource(["BIO", "ZOO"]));
  assert.deepEqual(writes, ["FLINDEX", "FLINDEX"]);
});
