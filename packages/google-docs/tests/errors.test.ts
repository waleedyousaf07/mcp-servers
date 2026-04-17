import { describe, expect, it } from "vitest";
import { mapGoogleApiError } from "../src/lib/errors.js";

describe("mapGoogleApiError", () => {
  it("maps not found responses", () => {
    const error = mapGoogleApiError(
      404,
      {
        error: {
          message: "Requested entity was not found.",
          status: "NOT_FOUND",
          errors: [
            {
              reason: "notFound"
            }
          ]
        }
      },
      "docs.getDocument"
    );

    expect(error.kind).toBe("not_found");
    expect(error.status).toBe(404);
    expect(error.message).toMatch(/not found/i);
  });

  it("maps rate limit responses", () => {
    const error = mapGoogleApiError(
      429,
      {
        error: {
          message: "Quota exceeded.",
          status: "RESOURCE_EXHAUSTED",
          errors: [
            {
              reason: "rateLimitExceeded"
            }
          ]
        }
      },
      "docs.searchDocuments"
    );

    expect(error.kind).toBe("rate_limited");
    expect(error.details?.reason).toBe("rateLimitExceeded");
  });
});
