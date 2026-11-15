// The address rules beyond the checksum (src/address-rules.js, KaPay iOS 5848fb0).
import assert from "node:assert/strict";
import { lowercasedKaspaAddress, addressShapeOk, validOnActiveNetwork } from "../src/address-rules.js";
import { reencodeAddress } from "../shared/engine/network.js";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
// An address with `version` and `length` payload bytes: encoded with a dummy checksum, then given
// the right one by the engine's own re-encoding.
function addressOf(version, length, hrp = "kaspa") {
  const bytes = [version, ...Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff)];
  let acc = 0; let bits = 0; let body = "";
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; body += CHARSET[(acc >> bits) & 31]; } acc &= (1 << bits) - 1; }
  if (bits) body += CHARSET[(acc << (5 - bits)) & 31];
  return reencodeAddress(`other:${body}qqqqqqqq`, hrp);
}

const schnorr = addressOf(0, 32);
const ecdsa = addressOf(1, 33);
const p2sh = addressOf(8, 32);
assert.ok(addressShapeOk(schnorr) && addressShapeOk(ecdsa) && addressShapeOk(p2sh), "each version at its length");
assert.ok(addressShapeOk(addressOf(0, 32, "kaspatest")));
assert.equal(addressShapeOk(addressOf(0, 33)), false, "Schnorr must be 32 bytes");
assert.equal(addressShapeOk(addressOf(1, 32)), false, "ECDSA must be 33 bytes");
assert.equal(addressShapeOk(addressOf(8, 20)), false, "script hash must be 32 bytes");
assert.equal(addressShapeOk(addressOf(3, 32)), false, "an unknown version");
assert.equal(addressShapeOk(addressOf(0, 32, "bitcoin")), false, "an unknown prefix");
assert.equal(addressShapeOk(schnorr.slice(0, -1) + (schnorr.endsWith("q") ? "p" : "q")), false, "a bad checksum");

// case: all capitals are lowercased (compact QR codes); mixed case is refused
const upper = schnorr.toUpperCase();
assert.equal(lowercasedKaspaAddress(upper), schnorr);
assert.equal(lowercasedKaspaAddress(`  ${schnorr}  `), schnorr);
const mixed = schnorr.slice(0, 10) + schnorr.slice(10, 20).toUpperCase() + schnorr.slice(20);
assert.equal(lowercasedKaspaAddress(mixed), mixed, "mixed case is left as typed");
assert.equal(addressShapeOk(lowercasedKaspaAddress(mixed)), false, "and then fails");
assert.equal(addressShapeOk(upper), false, "capitals are checked only once lowercased");
assert.equal(lowercasedKaspaAddress(`KASPA:${schnorr.slice(6)}`), schnorr, "a capital prefix alone");
assert.equal(lowercasedKaspaAddress(`${upper}?amount=1`), `${upper}?amount=1`, "a link with a query is left alone");

// the running network
assert.ok(validOnActiveNetwork(schnorr, "mainnet"));
assert.equal(validOnActiveNetwork(schnorr, "testnet"), false);
assert.ok(validOnActiveNetwork(addressOf(0, 32, "kaspatest"), "testnet"));
assert.equal(validOnActiveNetwork(mixed, "mainnet"), false);

console.log("address rules: ok");
