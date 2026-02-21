import assert from "node:assert/strict";
import test from "node:test";

import { parseExtractionListFilters, parseExtractionPatchAction } from "./extractions-request.ts";

test("parseExtractionListFilters accepts valid filters", () => {
  const result = parseExtractionListFilters(
    new URLSearchParams({
      status: "completed",
      reviewStatus: "approved",
      documentType: "invoice",
    }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.filters.status, "completed");
    assert.equal(result.filters.reviewStatus, "approved");
    assert.equal(result.filters.documentType, "invoice");
  }
});

test("parseExtractionListFilters rejects invalid filters", () => {
  const statusResult = parseExtractionListFilters(new URLSearchParams({ status: "bad-status" }));
  assert.equal(statusResult.ok, false);
  if (!statusResult.ok) {
    assert.equal(statusResult.error, "Invalid status filter");
  }

  const reviewResult = parseExtractionListFilters(new URLSearchParams({ reviewStatus: "bad-review" }));
  assert.equal(reviewResult.ok, false);
  if (!reviewResult.ok) {
    assert.equal(reviewResult.error, "Invalid reviewStatus filter");
  }

  const docResult = parseExtractionListFilters(new URLSearchParams({ documentType: "bad-doc" }));
  assert.equal(docResult.ok, false);
  if (!docResult.ok) {
    assert.equal(docResult.error, "Invalid documentType filter");
  }
});

test("parseExtractionPatchAction validates assign/review payloads", () => {
  const assignParsed = parseExtractionPatchAction({
    action: "assign",
    reviewer: "reviewer@flowstate.dev",
  });
  assert.equal(assignParsed.success, true);

  const reviewParsed = parseExtractionPatchAction({
    action: "review",
    reviewStatus: "approved",
    reviewer: "reviewer@flowstate.dev",
    reviewNotes: "looks good",
  });
  assert.equal(reviewParsed.success, true);

  const invalidReviewer = parseExtractionPatchAction({
    action: "assign",
    reviewer: "   ",
  });
  assert.equal(invalidReviewer.success, false);
});
