# shared/

Copies of KaChat-Desktop files the wallet is built on. Don't edit them here: change them in
KaChat-Desktop, then `npm run sync-shared` and commit with the KaChat-Desktop commit in the
message.

| Folder | What |
|---|---|
| `engine/` | The desktop app's wallet engine: key derivation, transactions and signing, wRPC nodes, REST endpoints, the .kas reveal recovery (`kns-reveal-recovery.js`), prices, network (mainnet / testnet-10), the history rows' swap amounts (`history-amounts.js`), and Swap's kUSDT trade (`kusdt-trade.js`, with Trestly's pool code run in its own worker: `kusdt-wallet-core.js`, `-worker.js`, `-bridge.js`, `-install.js`). Only the files the extension imports. |
| `ui/` | `kspt.js` (KasSigner KSPT: unsigned transactions, animated QR frames, signed-transaction scan-back and broadcast) the BIP39 English word list, and the account backup and import rules without a DOM (`account-backup-status.js`, `account-import.js`), kUSDT's wallet state (`kusdt-wallet.js`: balances, Discover, the lists, history), Swap's ChangeNOW quotes (`swap-quote.js`), the kUSDT approval's numbers and warnings (`swap-approval.js`), the shared poll beat and notification-recency rules (`foreground-beat.js`, `notification-recency.js`), and Cold Storage's KasSigner quantum-resistant address rules (`cold-quantum.js`). |
| `kusdt/` | kUSDT's transaction builder: Trestly's KCC-20 WebAssembly (`kusdt_wasm_bg.wasm`, 7.9 MB, checked against its pinned SHA-256 before it compiles), its patched loader, the pinned covenant template, `VERSION`, `LICENSE` and `SHA256SUMS`, as K-Desktop records them; and Trestly's pool code for Swap (`kusdt-wallet.js`, pinned in `SHA256SUMS`). |
| `kaspa/` | The rusty-kaspa WASM SDK (`kaspa.js`, `kaspa_bg.wasm`, ISC licence), prebuilt, with its provenance (`VERSION`: SDK 2.0.1, toolchain, local glue patches, and what isn't known) and checksums (`SHA256SUMS`; `shasum -a 256 -c SHA256SUMS`), as KaChat-Desktop records them. |

Copied from K-Desktop (KaChat-Desktop) 522623c.
