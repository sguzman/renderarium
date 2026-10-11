import assert from "node:assert/strict";
import {createHash} from "node:crypto";

// Immutable revision of the acceptance decision recorded on 2026-10-09.
// Updating the ledger requires an explicit owner-authorized new baseline,
// not merely a simultaneous ledger + scene source edit.
export const ACCEPTED_BLOCK_CHIBI_LEDGER_BLOB=
  "d49365235fd3c60c0693a7c04ead0464640955da";

export function gitBlobSha1(source){
  const buffer=Buffer.isBuffer(source)?source:Buffer.from(source);
  return createHash("sha1").update("blob "+buffer.length+"\0")
    .update(buffer).digest("hex");
}

export function assertAcceptedLedgerRevision(source){
  const sha=gitBlobSha1(source);
  assert.equal(sha,ACCEPTED_BLOCK_CHIBI_LEDGER_BLOB,
    "accepted visual verdict ledger revision differs from immutable baseline");
  return sha;
}
