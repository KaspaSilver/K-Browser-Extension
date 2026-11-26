// Typed names - a port of K iOS NameServices.swift (518fdc8c, "Name services: .kachat only"):
// since K 5.4 (owner's call, 2026-11-23) .kachat is the only name service K reads. KNS (.kas), dotk
// (.k) and Kaspa Names (.kaspa) are gone; the reveal that finishes a .kas transfer started before
// then still runs (wallet.js resumeDomainReveals, iOS KNSRevealRecovery).
//
//   .kachat  KaChat's own names (Kaspa covenants), read through the shared registry
//            (kachat-names.js: a names indexer, or the chain itself).

import { validOnActiveNetwork } from "./address-rules.js";
import { kachatLabel } from "./kachat-label.js";
import { kachatRegistry, kachatService, kachatLaunched } from "./kachat-names.js";
import { resolveHeldChecked, confirmLiveOnChain } from "./kachat-resolve.js";
import { Status } from "../shared/engine/kachat-names/registry-state.js";
import { normalize as kachatNormalize, isValid as kachatIsValid } from "../shared/engine/kachat-names/codec.js";
import { KachatNamesRegistry } from "../shared/engine/kachat-names/registry.js";
import { logInfo } from "./log.js";

export const NAME_SERVICES = [
  // live on both networks since mainnet v1 (iOS ef6b21e)
  { tld: "kachat", suffix: ".kachat", serviceName: "KaChat Names", live: kachatLaunched },
];

export const service = (tld) => NAME_SERVICES.find((s) => s.tld === tld);

/** { label, tld } - "kachat" when the .kachat ending was typed, else null. */
export function splitTypedName(input) {
  const trimmed = String(input ?? "").trim();
  if (trimmed.toLowerCase().endsWith(".kachat")) return { label: trimmed.slice(0, -".kachat".length), tld: "kachat" };
  return { label: trimmed, tld: null };
}

/** Could this be a username (and is not an address)? */
export function looksLikeName(input) {
  const trimmed = String(input ?? "").trim().toLowerCase();
  if (trimmed.startsWith("kaspa:") || trimmed.startsWith("kaspatest:")) return false;
  const { label } = splitTypedName(trimmed);
  return Boolean(label) && /^[\p{L}\p{N}\p{M}_-]+$/u.test(label);
}

// --- forward resolution: typed name -> address --------------------------------------------

/** .kachat: the owner of a name that is active or in its grace period - a name in grace keeps
 *  resolving to its owner (iOS f7c371a); one past grace does not. Same rules as the registry:
 *  a-z, 0-9, hyphen. Always listed first; where the registry isn't live yet (mainnet before its
 *  launch) it is listed as "Coming soon" and resolves nothing (iOS 6ac48a7).
 *  Every typed name may be paid, so an indexer's answer counts only once the chain holds the
 *  record it describes (KaPay 953b255 confirmOnChain); when it doesn't, or the indexer answered
 *  for another name, the lookup failed. The address and the check come from one answer
 *  (kachat-resolve.js): the engine's `resolveHeldOnChain` reads the indexer twice. */
async function resolveKachat(label) {
  const canonical = kachatNormalize(label);
  if (!kachatIsValid(canonical)) return null;
  // shown bare, never with the ending (K iOS 522fd9f4 KachatNameLabel.display)
  const display = kachatLabel(canonical);
  const registry = kachatRegistry();
  if (!registry) return { tld: "kachat", display, address: null, failed: false, notLive: true };
  try {
    const address = await resolveHeldChecked(registry, canonical, kachatService());
    return { tld: "kachat", display, address: address || null, failed: false };
  } catch (error) {
    logInfo(".kachat lookup failed:", error?.message || error);
    return { tld: "kachat", display, address: null, failed: true };
  }
}

/**
 * What `input` points to: [{ tld: "kachat", display, address|null, failed }], or [] when it can't be
 * a .kachat name (iOS resolveEverywhere: one answer).
 */
export async function resolveEverywhere(input) {
  const { label } = splitTypedName(input);
  if (!label) return [];
  const result = await resolveKachat(label);
  if (!result) return [];
  // an answer that isn't a valid address of the running network is no answer: the lookup failed
  // (KaPay iOS 5848fb0 NameResolution)
  return [result.address && !validOnActiveNetwork(result.address) ? { ...result, address: null, failed: true } : result];
}

/** The answer a typed name gets: its .kachat owner, or null. */
export function primaryResolution(results) {
  return (results || []).find((r) => r.tld === "kachat" && r.address) || null;
}

/** The one not-found message every address field shows (K iOS 518fdc8c notFoundMessage). */
export function notFoundMessage(typed, results = []) {
  const kachatNotLive = !service("kachat").live || (results || []).some((r) => r.notLive);
  if (kachatNotLive) return ".kachat names aren't live on this network yet";
  // the registry couldn't be asked: that says nothing about whether the name exists (KaPay iOS 2da5f4b)
  const failed = (results || []).find((r) => r.failed);
  if (failed) return `Couldn't look up ${failed.display} right now. Try again in a moment.`;
  return "No username found";
}

// --- account discovery (iOS NameServicesClient.ownsAnyName) ----------------------------------

/** Does `address` hold a .kachat name? Account discovery asks this so an address whose only trace
 *  is a name is still found. */
export function ownsAnyName(address) {
  return ownsKachatName(address);
}

/** The addresses among `addresses` that hold a .kachat name (iOS ownersOfNames); failures count
 *  as none. */
export async function kachatOwnersOf(addresses) {
  try {
    return new Set((await kachatRegistry()?.ownersOfNames(addresses)) || []);
  } catch {
    return new Set();
  }
}

/** A .kachat name the address still holds - active or expired in
 *  grace, never lapsed (iOS 25cc2c9, aa36d2a). */
async function ownsKachatName(address) {
  const registry = kachatRegistry();
  const key = registry ? KachatNamesRegistry.keyOf(String(address || "").toLowerCase()) : null;
  if (!key) return false;
  try {
    await registry.refreshIfStale();
    return (await registry.heldNames(key)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Who made a payment request (K iOS RequestedByHeader): `address`'s .kachat name, and whether it
 * checks out - the name resolves back to this key, isn't lapsed, and its record is on the chain right
 * now. The signature proves the address only; the name is the registry's answer for it, so the
 * green seal waits for the name itself. -> { name: "alice.kachat" | null, verified }. Never throws.
 */
export async function requesterName(address) {
  const registry = kachatRegistry();
  if (!registry || !address) return { name: null, verified: false };
  let label = null;
  try { label = (await registry.identity(address))?.label ?? null; } catch { label = null; }
  if (!label) return { name: null, verified: false };
  const name = kachatLabel(label);
  try {
    const owner = KachatNamesRegistry.keyOf(String(address).toLowerCase());
    const found = await registry.lookup(label);
    const info = found?.kind === "registered" ? found.info : null;
    const ok = info && owner && info.name === kachatNormalize(label) && info.owner === owner
      && info.status(registry.graceMs, BigInt(Date.now())) !== Status.lapsed;
    if (!ok) return { name, verified: false };
    await confirmLiveOnChain(registry, info, kachatService());
    return { name, verified: true };
  } catch {
    return { name, verified: false };
  }
}
