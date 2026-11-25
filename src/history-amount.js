// A history row's figure when a transaction also spent someone else's coins (K iOS 961fc05a): a
// kUSDT swap through Trestly's pool. Pure, so tools/test-history-swap.mjs can run it in node.
// Reads the rows src/wallet.js history() describes: spentFrom [{ address (lowercased), sompi }],
// paidTo [{ address, sompi }] and outputTotalSompi, amounts in BigInt sompi.

/**
 * An outgoing history row's amount when the transaction also spent coins that aren't this
 * address's (K iOS 961fc05a KaspaFullTransactionResponse.ownHistoryAmount): a kUSDT swap spends
 * Trestly's pool, which pays its whole balance back to itself, and that output counted as "Sent"
 * (hundreds of thousands of KAS for a swap of a few). Works from what left this wallet instead:
 * its inputs, less what came back (this address, and `ownChange` to the wallet's other addresses)
 * and its share of the network fee, never more than `toOthers`. When the wallet came out ahead (a
 * swap that paid it Kaspa) the row is Received, by that much. Null when an input of this wallet
 * has no known amount, so the caller keeps its own figure.
 *
 * Each of the wallet's addresses funding one send shows the whole send: coins aren't tied to
 * outputs, so nothing says which paid what. The fee: with only the wallet's coins in, it paid all
 * of it; with another party's coins in too (a swap pool) its share by amount; with an outside
 * input of unknown amount, none is taken off. `isOwnAddress(lowercased)` says which other input
 * addresses are the wallet's.
 */
export function ownHistoryAmount(tx, address, { toOthers, ownChange = 0n, isOwnAddress = () => false }) {
  const self = String(address || "").toLowerCase();
  let spentHere = 0n;
  let spentByWallet = 0n;
  let inputTotal = 0n;
  let allInputsKnown = true;
  let outsideInputs = false;
  for (const input of tx?.spentFrom || []) {
    const from = input.address || "";
    const here = from === self;
    const ours = here || (from !== "" && Boolean(isOwnAddress(from)));
    if (!ours) outsideInputs = true;
    if (input.sompi == null) {
      if (ours) return null;
      allInputsKnown = false;
      continue;
    }
    inputTotal += input.sompi;
    if (here) spentHere += input.sompi;
    if (ours) spentByWallet += input.sompi;
  }
  if (spentHere === 0n) return null;
  const returnedHere = (tx.paidTo || [])
    .filter((o) => String(o.address || "").toLowerCase() === self)
    .reduce((sum, o) => sum + o.sompi, 0n);
  const returnedToWallet = returnedHere + ownChange;
  if (returnedToWallet >= spentByWallet) {
    // came out ahead (or even): what it gained
    return returnedToWallet > spentByWallet ? { direction: "in", amountSompi: returnedToWallet - spentByWallet } : null;
  }
  let paid = spentByWallet - returnedToWallet;
  const outputTotal = tx.outputTotalSompi ?? 0n;
  const fee = allInputsKnown && inputTotal >= outputTotal ? inputTotal - outputTotal : 0n;
  const walletFee = !outsideInputs || inputTotal === 0n ? fee : (fee * spentByWallet) / inputTotal;
  paid -= paid < walletFee ? paid : walletFee;
  return { direction: "out", amountSompi: paid < toOthers ? paid : toOthers };
}
