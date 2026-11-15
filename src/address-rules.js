// Kaspa address rules beyond the checksum (KaPay iOS 5848fb0 Bech32 / KaspaAddress /
// lowercasedKaspaAddress), with no DOM or SDK so tools/test-address-rules.mjs runs them in node:
//   - the prefix is kaspa, kaspatest, kaspasim or kaspadev;
//   - the part after ":" is one case: an all-capital address (compact QR codes) is lowercased, a
//     mixed-case one is refused even with a valid checksum;
//   - the payload is the length its version needs: Schnorr (0) and script hash (8) 32 bytes,
//     ECDSA (1) 33 bytes; any other version is refused.
// A name service's answer is held to the same rules, and to the running network.

import { isValidKaspaAddress, networkOfAddress, NETWORK } from "../shared/engine/network.js";

const PREFIXES = new Set(["kaspa", "kaspatest", "kaspasim", "kaspadev"]);
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const PAYLOAD_BYTES = new Map([[0, 32], [1, 33], [8, 32]]);

/** A typed or scanned `kaspa:` / `kaspatest:` address as it should be checked: one with no "?"
 *  whose part after ":" is all capitals is lowercased; anything else is left as it was (so a
 *  mixed-case one fails `addressShapeOk`). */
export function lowercasedKaspaAddress(text) {
  const value = String(text ?? "").trim();
  if (!/^kaspa(test)?:/i.test(value) || value.includes("?")) return value;
  const colon = value.indexOf(":");
  const body = value.slice(colon + 1);
  const letters = body.replace(/[^a-z]/gi, "");
  if (letters && letters === letters.toUpperCase()) return value.toLowerCase();
  if (body === body.toLowerCase()) return value.slice(0, colon).toLowerCase() + ":" + body;
  return value;
}

/** Whether `address` (lowercase, no "?") has a known prefix, one case, a valid checksum and the
 *  payload length its version needs. */
export function addressShapeOk(address) {
  const value = String(address ?? "").trim();
  const colon = value.indexOf(":");
  if (colon < 1) return false;
  const prefix = value.slice(0, colon);
  const body = value.slice(colon + 1);
  if (!PREFIXES.has(prefix) || body !== body.toLowerCase()) return false;
  if (!isValidKaspaAddress(value)) return false;
  // the 5-bit groups before the checksum, regrouped into bytes: the version, then the payload
  const groups = Array.from(body.slice(0, -8), (ch) => CHARSET.indexOf(ch));
  const bytes = [];
  let acc = 0;
  let bits = 0;
  for (const g of groups) {
    acc = (acc << 5) | g;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
    acc &= (1 << bits) - 1;
  }
  // leftover bits must be padding zeros, fewer than 5
  if (bits >= 5 || acc !== 0) return false;
  const [version, ...payload] = bytes;
  return PAYLOAD_BYTES.get(version) === payload.length;
}

/** A valid address of the running network (iOS KaspaAddress.isValidOnActiveNetwork). */
export function validOnActiveNetwork(address, network = NETWORK) {
  return addressShapeOk(address) && networkOfAddress(address) === network;
}
