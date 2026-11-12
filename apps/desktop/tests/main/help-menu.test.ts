import { describe, expect, it } from "vitest";

import { helpMenuLinks } from "../../src/main/help-menu.js";

describe("helpMenuLinks", () => {
  it("opens the support and changelog pages, and promises nothing that does not exist", () => {
    expect(helpMenuLinks("en-US")).toEqual([
      { label: "Get Support", url: "https://openpixo.com/support" },
      { label: "Changelog", url: "https://openpixo.com/changelog" },
    ]);
  });

  it("opens the Chinese pages on a Chinese system", () => {
    expect(helpMenuLinks("zh-CN").map((link) => link.url)).toEqual([
      "https://openpixo.com/support.zh",
      "https://openpixo.com/changelog.zh",
    ]);
  });
});
