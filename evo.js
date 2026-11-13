// Protocol references: TI-84-Evo-tools (MIT) and Evo-Programming/evo_usb_py.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const bytes = (...values) => Uint8Array.of(...values);
const ascii = value => encoder.encode(value);
const empty = bytes();
const init = ascii('~0 @-#Y1~."5M');

function join(...parts) {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function check(data) {
  const sum = data.reduce((total, byte) => total + byte, 0);
  return 32 + ((sum + ((sum >> 6) & 3)) & 63);
}

export function packet(seq, kind, data = empty) {
  const length = data.length + 1;
  const head = bytes(length <= 92 ? length + 34 : 32, 32 + (seq & 63), kind.charCodeAt(0));
  let header = head;
  if (length > 92) {
    const long = join(head, bytes(32 + Math.floor(length / 95), 32 + (length % 95)));
    header = join(long, bytes(check(long)));
  }
  const body = join(header, data);
  return join(bytes(1), body, bytes(check(body), 13));
}

export function readPacket(buffer) {
  const start = buffer.indexOf(1);
  if (start < 0 || buffer.length < start + 6) return null;
  const raw = buffer.subarray(start);
  const extended = raw[1] === 32;
  if (extended && raw.length < 9) return null;
  const length = extended ? 8 + (raw[4] - 32) * 95 + raw[5] - 32 : raw[1] - 29;
  if (length < 6 || length > 9033 || raw[2] < 32 || raw[2] > 95) {
    throw new Error("Invalid USB packet length.");
  }
  if (raw.length < length) return null;
  if (raw[length - 1] !== 13 || check(raw.subarray(1, length - 2)) !== raw[length - 2] ||
      (extended && check(raw.subarray(1, 6)) !== raw[6])) {
    throw new Error("USB packet checksum failed. Reconnect and retry.");
  }
  return {
    seq: raw[2] - 32, kind: String.fromCharCode(raw[3]),
    data: raw.slice(extended ? 7 : 4, length - 2), rest: raw.slice(length)
  };
}

function* encodedChunks(payload) {
  let chunk = [];
  for (const byte of payload) {
    const low = byte & 127;
    let unit = [byte];
    if (low < 32 || low === 127) unit = [35, byte ^ 64];
    else if (byte === 35 || byte === 126) unit = [35, byte];
    if (chunk.length + unit.length > 90) {
      yield bytes(...chunk);
      chunk = [];
    }
    chunk.push(...unit);
  }
  if (chunk.length) yield bytes(...chunk);
}

export function decodeData(data) {
  const out = [];
  let offset = 0;
  while (offset < data.length) {
    let count = 1;
    if (data[offset] === 126) {
      count = data[offset + 1] - 32;
      offset += 2;
    }
    let byte = data[offset++];
    if (byte === 35) {
      byte = data[offset++];
      if ((byte & 127) === 63 || (byte & 96) === 64) byte ^= 64;
    }
    if (byte === undefined || count < 1 || count > 94) throw new Error("Invalid quoted USB data.");
    for (let index = 0; index < count; index++) out.push(byte);
  }
  return Uint8Array.from(out);
}

function word(value, size, little = false) {
  const result = new Uint8Array(size);
  const view = new DataView(result.buffer);
  if (size === 2) view.setUint16(0, value, little);
  else view.setUint32(0, value, little);
  return result;
}

function cborLength(major, length) {
  const start = major << 5;
  if (length < 24) return bytes(start + length);
  if (length < 256) return bytes(start + 24, length);
  const size = length < 65536 ? 2 : 4;
  return join(bytes(start + (size === 2 ? 25 : 26)), word(length, size));
}

function field(key, value) {
  const label = ascii(key);
  return join(cborLength(3, label.length), label, value);
}

export function tokenName(name) {
  return join(...Array.from(name, char => {
    const code = char.charCodeAt(0);
    return word(code >= 65 ? 0xe800 + code - 65 : 0xe401 + code - 48, 2, true);
  }));
}

function tokenText(tokens, display = false) {
  let result = "";
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const code = tokens[i] + 256 * tokens[i + 1];
    if (!code) break;
    if (display) {
      if (code >= 0xe800 && code <= 0xe819) result += String.fromCharCode(65 + code - 0xe800);
      else if (code >= 0xe401 && code <= 0xe40a) result += String.fromCharCode(48 + code - 0xe401);
      else return "";
    } else {
      for (const byte of ascii(String.fromCharCode(code))) {
        result += "%" + byte.toString(16).padStart(2, "0").toUpperCase();
      }
    }
  }
  return result;
}

export function sourcePayload(name, source) {
  const text = ascii(source);
  if (text.length > 65535) throw new Error("Python source exceeds the transfer size limit.");
  const app = join(word(0x113, 4, true), word(18 + name.length + text.length, 4, true),
    word(name.length, 4, true), ascii(name), bytes(0), word(text.length, 2, true),
    bytes(0, 2), text, bytes(0));
  const token = tokenName(name);
  return join(bytes(191), field("metaData", join(bytes(191),
    field("type", bytes(15)), field("version", bytes(1)),
    field("name", join(cborLength(2, token.length), token)), bytes(255))),
  field("version", bytes(1)), field("size", cborLength(0, app.length)),
  field("data", join(cborLength(2, app.length), app)), bytes(255));
}

export function readCbor(data) {
  let at = 0;
  function take(length) {
    if (at + length > data.length) throw new Error("Truncated calculator data.");
    const part = data.subarray(at, at + length);
    at += length;
    return part;
  }
  function value(depth = 0) {
    if (depth > 20) throw new Error("Unexpected nested calculator data.");
    const tag = take(1)[0];
    const major = tag >> 5;
    const low = tag & 31;
    if (tag === 244 || tag === 245) return tag === 245;
    if (tag === 246 || tag === 247) return null;
    let length = low;
    if (low >= 24 && low <= 27) {
      length = 0;
      for (const byte of take(2 ** (low - 24))) length = length * 256 + byte;
    }
    if (major === 0) return length;
    if (major === 1) return -1 - length;
    if ((major === 2 || major === 3) && low !== 31) {
      const part = take(length);
      return major === 2 ? part : decoder.decode(part);
    }
    if (major === 4 || major === 5) {
      const result = major === 4 ? [] : Object.create(null);
      for (let i = 0; low === 31 ? data[at] !== 255 : i < length; i++) {
        const item = value(depth + 1);
        if (major === 4) result.push(item);
        else result[item] = value(depth + 1);
      }
      if (low === 31) take(1);
      return result;
    }
    throw new Error("Unsupported calculator response format.");
  }
  return value();
}

export function unpackSource(payload) {
  const item = readCbor(payload);
  const raw = item.data;
  if (!(raw instanceof Uint8Array) || raw.length < 18) throw new Error("Invalid Python source from calculator.");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const offset = 13 + view.getUint32(8, true);
  if (view.getUint32(0, true) !== 0x113 || offset + 4 >= raw.length || raw[offset + 3] !== 2) {
    throw new Error("The calculator returned an unsupported Python file.");
  }
  const length = view.getUint16(offset, true);
  if (offset + 4 + length >= raw.length) throw new Error("Truncated Python source from calculator.");
  return decoder.decode(raw.subarray(offset + 4, offset + 4 + length));
}

class Kermit {
  constructor(transport) {
    this.transport = transport;
    this.buffer = empty;
    this.seq = 0;
  }

  async receive() {
    const deadline = Date.now() + 6500;
    while (Date.now() < deadline) {
      const received = readPacket(this.buffer);
      if (received) {
        this.buffer = received.rest;
        if (received.kind === "E") {
          throw new Error("Calculator rejected the transfer (" +
            new TextDecoder().decode(decodeData(received.data)).trim() + ").");
        }
        return received;
      }
      this.buffer = join(this.buffer, await this.transport.read(deadline - Date.now()));
      if (this.buffer.length > 32768) throw new Error("Invalid USB response.");
    }
    throw new Error("Calculator response timed out.");
  }

  async send(kind, data, allowIncoming = false) {
    const seq = this.seq++ & 63;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.transport.write(packet(seq, kind, data));
      for (let skipped = 0; skipped < 6; skipped++) {
        const answer = await this.receive();
        if (allowIncoming && answer.kind === "S") return answer;
        if (answer.seq !== seq) continue;
        if (answer.kind === "Y") return null;
        if (answer.kind === "N") break;
        throw new Error("Unexpected calculator acknowledgement.");
      }
    }
    throw new Error("Calculator did not acknowledge the USB packet.");
  }

  async transfer(url, payload, get) {
    await this.send("S", init);
    await this.send("F", ascii(url));
    const size = String(payload.length);
    await this.send("A", join(ascii('""B81'), bytes(32 + size.length), ascii(size + "@ ")));
    for (const chunk of encodedChunks(payload)) await this.send("D", chunk);
    await this.send("Z");
    const initial = await this.send("B", empty, get);
    if (!get) return;

    let incoming = initial;
    const chunks = [];
    let previous = null;
    let phase = "S";
    let length = 0;
    while (true) {
      incoming ??= await this.receive();
      const { kind, seq, data } = incoming;
      const duplicate = previous?.kind === kind && previous?.seq === seq;
      if (!duplicate) {
        if (kind !== phase && !(phase === "D" && kind === "Z")) {
          throw new Error("Unexpected calculator file response.");
        }
        if (kind === "D") {
          chunks.push(data);
          length += data.length;
          if (length > 4 * 1024 * 1024) throw new Error("Calculator response is too large.");
        } else {
          phase = ({ S: "F", F: "A", A: "D", Z: "B" })[kind];
        }
      }
      await this.transport.write(packet(seq, "Y", kind === "S" ? init : empty));
      if (kind === "B") return decodeData(join(...chunks));
      previous = incoming;
      incoming = null;
    }
  }
}

function timed(promise, timeout = 6500) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Calculator timed out. Return it to the home screen and retry.")), timeout);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export async function chooseEvo(browser = globalThis.navigator) {
  const serial = browser?.serial;
  const usb = browser?.usb;
  if (!serial && !usb) throw new Error("Open this site in desktop Chrome to send over USB.");
  try {
    if (serial) {
      const port = await serial.requestPort({ filters: [{ usbVendorId: 0x0451, usbProductId: 0xe018 }] });
      return { port };
    }
    const device = await usb.requestDevice({ filters: [{ vendorId: 0x0451, productId: 0xe018 }] });
    return { device };
  } catch (error) {
    if (error.name === "NotFoundError") throw new Error("No calculator selected. Connect the Evo with a USB data cable and try again.");
    if (error.name === "SecurityError") throw new Error("USB access is blocked. Open the site directly in desktop Chrome.");
    throw error;
  }
}

async function withSerial(port, action) {
  await timed(port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none", bufferSize: 16384 }));
  let reader;
  let writer;
  try {
    reader = port.readable.getReader();
    writer = port.writable.getWriter();
    return await action(new EvoLink({
      write: data => timed(writer.write(data)),
      async read(timeout) {
        const { value, done } = await timed(reader.read(), timeout);
        if (done) throw new Error("Calculator disconnected. Reconnect the USB cable and retry.");
        return value;
      }
    }));
  } finally {
    if (reader) {
      await timed(reader.cancel(), 1000).catch(() => {});
      reader.releaseLock();
    }
    if (writer) writer.releaseLock();
    await timed(port.close(), 1000).catch(() => {});
  }
}

export async function withEvo(connection, action) {
  if (connection.port) return withSerial(connection.port, action);
  const { device } = connection;
  let opened = false;
  try {
    await timed(device.open());
    opened = true;
    if (!device.configuration) await timed(device.selectConfiguration(device.configurations[0].configurationValue));
    const candidates = device.configuration.interfaces.flatMap(iface => iface.alternates.map(alt => ({
      iface, alt,
      input: alt.endpoints.find(ep => ep.type === "bulk" && ep.direction === "in"),
      output: alt.endpoints.find(ep => ep.type === "bulk" && ep.direction === "out")
    }))).filter(candidate => candidate.input && candidate.output);
    candidates.sort((a, b) => Number(b.alt.interfaceClass === 255) - Number(a.alt.interfaceClass === 255));
    let selected;
    for (const candidate of candidates) {
      const number = candidate.iface.interfaceNumber;
      try {
        await timed(device.claimInterface(number));
        if (candidate.alt.alternateSetting !== candidate.iface.alternate.alternateSetting) {
          await timed(device.selectAlternateInterface(number, candidate.alt.alternateSetting));
        }
        selected = candidate;
        break;
      } catch {
        await timed(device.releaseInterface(number)).catch(() => {});
      }
    }
    if (!selected) throw new Error("Could not claim the calculator USB interface. Close TI Connect Evo and reconnect.");
    const transport = {
      async write(data) {
        const result = await timed(device.transferOut(selected.output.endpointNumber, data));
        if (result.status !== "ok" || result.bytesWritten !== data.length) throw new Error("USB write failed. Reconnect the calculator.");
      },
      async read(timeout) {
        const result = await timed(device.transferIn(selected.input.endpointNumber, 4096), timeout);
        if (result.status !== "ok" || !result.data) throw new Error("USB read failed. Reconnect the calculator.");
        return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
      }
    };
    return await action(new EvoLink(transport));
  } finally {
    if (opened && device.opened) await timed(device.close(), 1000).catch(() => {});
  }
}

export class EvoLink {
  constructor(transport) {
    this.transport = transport;
  }

  async get(uri) {
    return new Kermit(this.transport).transfer("hh01/get/hh01/" + uri, ascii("h"), true);
  }

  async list() {
    const directory = readCbor(await this.get("inf/res?name=directory&gotohome=1"));
    if (!Array.isArray(directory.data)) throw new Error("Could not read the calculator file list.");
    return directory.data.map(item => {
      const tokens = item.tokName instanceof Uint8Array ? item.tokName : empty;
      const display = item.dispName instanceof Uint8Array ? new TextDecoder().decode(item.dispName) : item.dispName;
      return { name: tokenText(tokens, true) || String(display ?? "").toUpperCase(),
        type: Number(item.type), ram: item.mem === true || item.mem === 0 || item.mem === "RAM", tokens };
    });
  }

  async readSource(entry) {
    return unpackSource(await this.get("xfr/var?name=" + tokenText(entry.tokens) + "&type=15"));
  }

  async writeSource(name, source, overwrite = false) {
    const url = "hh01/xfr/var?name=" + tokenText(tokenName(name)) +
      "&type=15&memtarget=0&policy=" + Number(overwrite);
    await new Kermit(this.transport).transfer(url, sourcePayload(name, source), false);
  }
}
