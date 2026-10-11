#!/usr/bin/env node
/** Immutable accepted decision is independent of mutable checkout history. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
  ACCEPTED_BLOCK_CHIBI_LEDGER_BLOB,
  gitBlobSha1,assertAcceptedLedgerRevision
} from "../runtime/chat/accepted-ledger-pin.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const ledger=readFileSync(resolve(root,"contracts/accepted-block-chibi-v1.json"));
assert.equal(assertAcceptedLedgerRevision(ledger),
  ACCEPTED_BLOCK_CHIBI_LEDGER_BLOB);
assert.match(ACCEPTED_BLOCK_CHIBI_LEDGER_BLOB,/^[0-9a-f]{40}$/);
const specimen=Buffer.from("source revision fixture\n","utf8");
const expected=createHash("sha1")
  .update("blob "+specimen.length+"\0").update(specimen).digest("hex");
assert.equal(gitBlobSha1(specimen),expected);
assert.throws(()=>assertAcceptedLedgerRevision(
  Buffer.concat([ledger,Buffer.from("\n")])),
  "ledger metadata tampering failed to reject");
assert.throws(()=>assertAcceptedLedgerRevision(
  Buffer.from(ledger.toString("utf8").replace(
    '"source_geometry": "frozen"', '"source_geometry": "changed"'))),
  "ledger content revision tampering failed to reject");
assert.throws(()=>assertAcceptedLedgerRevision(specimen),
  "unrelated source should not match accepted ledger hash");
console.log("PASS immutable ledger Git blob revision, independent Git hashing and 3 tamper cases");
