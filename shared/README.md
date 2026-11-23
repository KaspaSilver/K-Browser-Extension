# shared/

Copies of KaChat-Desktop files the wallet is built on. Don't edit them here: change them in
KaChat-Desktop, then `npm run sync-shared` and commit with the KaChat-Desktop commit in the
message.

| Folder | What |
|---|---|
| `engine/` | The desktop app's wallet engine: key derivation, transactions and signing, wRPC nodes, REST endpoints, KNS, prices, network (mainnet / testnet-10). Only the files the extension imports. |
| `ui/` | `kspt.js` (KasSigner KSPT: unsigned transactions, animated QR frames, signed-transaction scan-back and broadcast) the BIP39 English word list, and the account backup and import rules without a DOM (`account-backup-status.js`, `account-import.js`), and kUSDT's wallet state (`kusdt-wallet.js`: balances, Discover, the lists, history). |
| `kusdt/` | kUSDT's transaction builder: Trestly's KCC-20 WebAssembly (`kusdt_wasm_bg.wasm`, 7.9 MB, checked against its pinned SHA-256 before it compiles), its patched loader, the pinned covenant template, `VERSION`, `LICENSE` and `SHA256SUMS`, as K-Desktop records them. |
| `kaspa/` | The rusty-kaspa WASM SDK (`kaspa.js`, `kaspa_bg.wasm`, ISC licence), prebuilt, with its provenance (`VERSION`: SDK 2.0.1, toolchain, local glue patches, and what isn't known) and checksums (`SHA256SUMS`; `shasum -a 256 -c SHA256SUMS`), as KaChat-Desktop records them. |

Copied from K-Desktop (KaChat-Desktop) 9787553.
