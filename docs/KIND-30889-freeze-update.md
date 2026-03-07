# Kind 30889 — Developer Change Notice
## Backward-Compatible Update: Per-Wallet Freeze Support
**Version:** v1.1
**Effective Date:** _[TBD]_
**Status:** Active

---

## 1. Summary

Kind 30889 (Registrar Wallet List) has been extended with optional freeze functionality. This change is **fully backward compatible** — existing implementations continue to work without modification.

---

## 2. What Changed

### Customer-Level Freeze
The `status` tag now accepts a new value:

| Value    | Meaning                              |
|----------|--------------------------------------|
| `active` | Normal (default, unchanged)          |
| `frozen` | All wallets for this customer frozen |

### Per-Wallet Freeze
The `w` tag has an **optional 7th field** (`index 6`): `freeze_status`.

**Allowed values:**

| Value             | Meaning                                     |
|-------------------|---------------------------------------------|
| `""` (empty)      | Normal, unfrozen                            |
| `frozen_l8w`      | Frozen due to late wallet registration      |
| `frozen_max_cap`  | Frozen due to maximum balance cap exceeded  |
| `frozen_too_wild` | Frozen due to irregular or suspicious activity |

Old `w` tags with 6 fields remain valid and fully supported.

### Tag Structure

```
// 6-field w tag (existing, still valid):
["w", "<address>", "<type>", "<currency>", "<note>", "<unreg_amount>"]

// 7-field w tag (new, with freeze):
["w", "<address>", "<type>", "<currency>", "<note>", "<unreg_amount>", "<freeze_status>"]
```

---

## 3. Who Needs to Update

### Registrar Software
**Must update.** Write the 7th field using only the three defined freeze codes when freezing a specific wallet. Set `status: frozen` when freezing at customer level.

### User Wallets / Dashboards
**Should update.** Read the 7th field and display the freeze reason to the user. Block outgoing transactions for frozen wallets. If not updated, wallets appear normal (no crash, no freeze indicator).

### Monitoring Services
**Should update.** Detect frozen wallets by freeze code and suppress or flag alerts accordingly.

### Providers / Relays
**No update required.** Pass-through behavior unchanged.

---

## 4. Who Does NOT Need to Update

Any implementation that only reads Kind 30889 without displaying freeze status requires **no changes**. Old 6-field `w` tags are treated as unfrozen by default.

---

## 5. Migration Guide

- **No breaking changes.** No re-indexing required.
- To add freeze support:
  1. Check if `w` tag array length >= 7
  2. Read index 6 as `freeze_status`
  3. Treat missing or empty 7th field as normal (unfrozen)
  4. **Any unrecognized `freeze_status` value must be treated as frozen** (fail-safe default)

---

## 6. Code Examples

### Reading the optional 7th field (safe for old events)

```javascript
function parseWalletTag(wTag) {
  return {
    address:      wTag[1],
    type:         wTag[2],
    currency:     wTag[3],
    note:         wTag[4] || '',
    unregAmount:  wTag[5] || '0',
    // Safe read: defaults to '' (unfrozen) if field missing
    freezeStatus: wTag.length >= 7 ? (wTag[6] || '') : '',
  };
}

function isWalletFrozen(wTag, statusTag) {
  const freezeStatus = wTag.length >= 7 ? (wTag[6] || '') : '';
  const accountStatus = statusTag?.[1] || 'active';

  // Account-level freeze overrides per-wallet
  if (accountStatus === 'frozen') return true;

  // Per-wallet freeze
  if (freezeStatus !== '') return true;

  return false;
}
```

### Writing a w tag with freeze codes

```javascript
// Normal wallet (no freeze)
["w", "LxyzABC...", "Main Wallet", "LANA", "note", "0"]

// Frozen: late wallet registration
["w", "LxyzABC...", "Main Wallet", "LANA", "note", "0", "frozen_l8w"]

// Frozen: maximum balance cap exceeded
["w", "LxyzABC...", "Lana8Wonder", "LANA", "note", "0", "frozen_max_cap"]

// Frozen: irregular or suspicious activity
["w", "LxyzABC...", "Wallet", "LANA", "note", "0", "frozen_too_wild"]

// Unfrozen (explicit empty string, equivalent to 6-field)
["w", "LxyzABC...", "Main Wallet", "LANA", "note", "0", ""]
```

### Handling unrecognized freeze_status (fail-safe)

```javascript
const KNOWN_FREEZE_CODES = ['frozen_l8w', 'frozen_max_cap', 'frozen_too_wild'];

function getFreezeReason(freezeStatus) {
  switch (freezeStatus) {
    case 'frozen_l8w':      return 'Late wallet registration';
    case 'frozen_max_cap':  return 'Maximum balance cap exceeded';
    case 'frozen_too_wild': return 'Irregular or suspicious activity';
    default:
      // FAIL-SAFE: any unrecognized non-empty value = frozen
      return 'Account frozen (unknown reason)';
  }
}

function shouldBlockTransaction(wallet) {
  // Empty string = unfrozen, anything else = frozen
  return wallet.freezeStatus !== '';
}
```

---

## 7. Effective Date and Versioning

| Field         | Value                           |
|---------------|---------------------------------|
| Kind          | 30889 (Registrar Wallet List)   |
| Version       | v1.1                            |
| Effective     | _[TBD — set by registrar team]_ |
| Compatibility | Fully backward compatible       |
