import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const addressContextSrc = readFileSync(
  join(process.cwd(), "src/contexts/delivery-location-context.tsx"),
  "utf8",
);
const addAddressFlowSrc = readFileSync(
  join(process.cwd(), "src/components/location/add-address-flow.tsx"),
  "utf8",
);
const proxySrc = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");

describe("delivery address CSRF contract", () => {
  it("uses csrfFetch for address mutations", () => {
    expect(addressContextSrc).toMatch(
      /import\s+\{\s*csrfFetch\s*\}\s+from\s+["']@\/lib\/csrf-client["']/,
    );
    expect(
      addressContextSrc.match(
        /csrfFetch\(\s*[`"']\/api\/v1\/delivery-addresses/g,
      ),
    ).toHaveLength(3);
  });

  it("keeps credentials and methods explicit for address mutations", () => {
    expect(addressContextSrc).toMatch(
      /headers\.set\(["']x-guest-key["'],\s*guestKey\);\s*return\s*\{\s*\.\.\.init,\s*credentials:\s*["']include["'],\s*headers\s*\}/,
    );
    expect(
      addressContextSrc.match(
        /\.\.\.addressFetchInit\([\s\S]*?\),\s*method:\s*["'](?:POST|PUT|DELETE)["']/g,
      ),
    ).toHaveLength(3);
  });

  it("uses csrfFetch for place-image mutations", () => {
    expect(addAddressFlowSrc).toMatch(
      /import\s+\{\s*csrfFetch\s*\}\s+from\s+["']@\/lib\/csrf-client["']/,
    );
    expect(
      addAddressFlowSrc.match(
        /csrfFetch\(\s*[`"']\/api\/v1\/upload\/place-images/g,
      ),
    ).toHaveLength(2);
  });

  it("does not weaken CSRF protection for state-changing endpoints", () => {
    // Tolerate the optional type annotation (`readonly string[]`) that
    // sits between the identifier and the `=`. Without `[\s\S]*?` the
    // type prefix would skip past the closing `];` and capture the
    // whole file.
    const exemptBlock = proxySrc.match(
      /const\s+CSRF_EXEMPT_PATHS\b[\s\S]*?=\s*\[([\s\S]*?)\];/,
    )?.[1];

    expect(exemptBlock).toBeDefined();
    expect(exemptBlock).not.toContain("/api/v1/delivery-addresses");
    expect(exemptBlock).not.toContain("/api/v1/upload/place-images");
  });
});
