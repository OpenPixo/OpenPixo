// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";


import {
  FilesPanel,
  type FilesNavState,
} from "../../src/components/FilesPanel";
import { setHtmlSourceSnapshot } from "../../src/components/html-source-snapshot-cache";
import type {
  ProjectFile,
  ProjectFileKind,
  ProjectFolder,
} from "../../src/types";



function folder(path: string): ProjectFolder {
  return {
    name: path.split("/").pop() ?? path,
    path,
    type: "dir",
    size: 0,
    mtime: 1700000000,
  };
}

// Stub localStorage so the component's view-state persistence writes to an
// in-memory store. Cleared in beforeEach so no test bleeds state into the next.
const lsStore = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => lsStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    lsStore.set(key, value);
  },
  removeItem: (key: string) => {
    lsStore.delete(key);
  },
  clear: () => {
    lsStore.clear();
  },
});

beforeEach(() => {
  lsStore.clear();
});

function extForKind(kind: ProjectFileKind): string {
  if (kind === "html") return "html";
  if (kind === "image") return "png";
  if (kind === "sketch") return "sketch.json";
  if (kind === "text") return "txt";
  if (kind === "code") return "ts";
  if (kind === "pdf") return "pdf";
  return "bin";
}

function file(
  overrides: Partial<ProjectFile> & Pick<ProjectFile, "name">,
): ProjectFile {
  return {
    path: overrides.name,
    type: "file",
    size: 1024,
    mtime: Date.now(),
    kind: "html",
    mime: "text/html",
    ...overrides,
  };
}

function generateFiles(count: number): ProjectFile[] {
  const kinds: ProjectFileKind[] = [
    "html",
    "image",
    "sketch",
    "text",
    "code",
    "pdf",
  ];
  return Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length]!;
    return file({
      name: `file-${i + 1}.${extForKind(kind)}`,
      kind,
      size: 1024 * (i + 1),
      mtime: Date.now() - i * 60_000,
      mime: "text/plain",
    });
  });
}

function renderPanel(
  files: ProjectFile[],
  overrides: Partial<ComponentProps<typeof FilesPanel>> = {},
) {
  const onOpenFile = vi.fn();
  const onDeleteFiles = vi.fn();
  const onClearUploadError = vi.fn();
  const result = render(
    <FilesPanel
      projectId="test-project"
      projectKind="prototype"
      files={files}
      onRefreshFiles={vi.fn()}
      onOpenFile={onOpenFile}
      onRenameFile={vi.fn()}
      onDeleteFile={vi.fn()}
      onDeleteFiles={onDeleteFiles}
      onUpload={vi.fn()}
      onUploadFiles={vi.fn()}
      onPaste={vi.fn()}
      onClearUploadError={onClearUploadError}
      {...overrides}
    />,
  );
  return { ...result, onDeleteFiles, onOpenFile, onClearUploadError };
}

// 资源库 type filter (全部 · 图片 · 音频 · 脚本 · 场景 · 其它). A filter other
// than 全部 lists the current folder's whole subtree flat.
function clickFilter(type: "all" | "image" | "audio" | "script" | "scene" | "other") {
  fireEvent.click(document.getElementById(`library-type-${type}`)!);
}

/** Cards only exist in the grid layout (list is the default). */
function useGrid() {
  lsStore.set("pixo:library-layout:test-project", "grid");
}

describe("FilesPanel sections", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not show grouping, sort, filter, or pagination chrome", () => {
    renderPanel(generateFiles(60));

    expect(screen.queryByRole("group", { name: "Group by" })).toBeNull();
    expect(document.querySelector(".df-table")).toBeNull();
    expect(document.querySelector(".df-th-sortable")).toBeNull();
    expect(document.querySelector(".df-kind-filter")).toBeNull();
    expect(document.querySelector(".df-pagination")).toBeNull();
    expect(document.querySelector(".df-page-btn")).toBeNull();
  });

  it("renders a single-line toolbar with no up/refresh buttons, and no new-document/upload actions once files exist", () => {
    renderPanel([file({ name: "page.html", kind: "html" })]);

    expect(screen.getByTestId("library-toolbar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(document.querySelector(".df-up-btn")).toBeNull();
    expect(document.querySelector(".df-refresh-control")).toBeNull();
    // New-document / upload moved into the empty state only; see below.
    expect(screen.queryByTestId("file-list-upload-trigger")).toBeNull();
    expect(screen.queryByTestId("file-list-empty-new-document")).toBeNull();
  });

  it("shows prioritized project starter actions in the empty state", () => {
    const onNewSketch = vi.fn();
    const onOpenBrowser = vi.fn();
    const onPaste = vi.fn();
    const onUpload = vi.fn();

    renderPanel([], {
      onPaste,
      onUpload,
    });

    fireEvent.click(screen.getByTestId("file-list-empty-new-document"));
    fireEvent.click(screen.getByTestId("file-list-upload-trigger"));

    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it("lists every type under 全部 and narrows to one type with its filter", () => {
    renderPanel([
      file({ name: "page.html", kind: "html", mime: "text/html" }),
      file({ name: "chart.png", kind: "image", mime: "image/png" }),
    ]);

    expect(document.getElementById("library-type-all")?.textContent).toContain("2");
    expect(document.getElementById("library-type-image")?.textContent).toContain("1");
    expect(screen.getByTestId("design-file-row-page.html")).toBeTruthy();
    expect(screen.getByTestId("design-file-row-chart.png")).toBeTruthy();
    clickFilter("image");
    expect(screen.getByTestId("design-file-row-chart.png")).toBeTruthy();
    expect(screen.queryByTestId("design-file-row-page.html")).toBeNull();
    clickFilter("script");
    expect(screen.getByTestId("design-file-row-page.html")).toBeTruthy();
    expect(screen.queryByTestId("design-file-row-chart.png")).toBeNull();
  });

  it("labels stylesheets and scripts in their row subtitle; both are 脚本", () => {
    renderPanel([
      file({ name: "styles.css", kind: "code", mime: "text/css" }),
      file({ name: "app.ts", kind: "code", mime: "text/typescript" }),
    ]);

    expect(document.getElementById("library-type-script")?.textContent).toContain("2");
    const cssRow = screen.getByTestId("design-file-row-styles.css");
    expect(cssRow.querySelector(".df-row-sub")?.textContent).toBe("Stylesheet");
    const tsRow = screen.getByTestId("design-file-row-app.ts");
    expect(tsRow.querySelector(".df-row-sub")?.textContent).toBe("Script");
  });

  it("searches paths across the folder's subtree and clears with Esc", () => {
    renderPanel([
      file({ name: "art/hero/walk_01.png", kind: "image", mime: "image/png" }),
      file({ name: "art/enemy.png", kind: "image", mime: "image/png" }),
      file({ name: "top.html", kind: "html" }),
    ]);

    const search = screen.getByTestId("library-search");
    fireEvent.change(search, { target: { value: "hero walk" } });
    expect(screen.getByTestId("design-file-row-art/hero/walk_01.png")).toBeTruthy();
    expect(screen.queryByTestId("design-file-row-art/enemy.png")).toBeNull();
    expect(screen.queryByTestId("design-file-row-top.html")).toBeNull();
    // A flat result names the file and shows its folder underneath.
    const row = screen.getByTestId("design-file-row-art/hero/walk_01.png");
    expect(row.querySelector(".df-row-name")?.textContent).toBe("walk_01.png");
    expect(row.querySelector(".df-row-sub")?.textContent).toContain("art/hero/");

    fireEvent.change(search, { target: { value: "nothing-like-this" } });
    expect(screen.getByTestId("library-no-matches")).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(screen.getByTestId("design-file-row-top.html")).toBeTruthy();
  });

  it('shows the file size beside the modified time while preserving the type subtitle', () => {
    // Images now render as bare masonry cards without a meta strip, so the
    // list-row size/subtitle contract is asserted on a stylesheet file, which
    // still renders as a compact row.
    renderPanel([
      file({ name: 'styles.css', kind: 'code', mime: 'text/css', size: 4096 }),
    ]);

    const row = screen.getByTestId('design-file-row-styles.css');
    expect(row.querySelector('.df-row-sub')?.textContent).toBe('Stylesheet');
    expect(row.querySelector('.df-row-size')?.textContent).toBe('4.0 KB');
  });

  // #5517 removed the always-on footer drop-hint strip and its rotating
  // useful-info tip; drag & drop still works via the df-drop-overlay, which
  // the drag-and-drop suite above covers.
  it("renders no footer info strip", () => {
    renderPanel([file({ name: "page.html", kind: "html" })]);

    expect(document.querySelector(".df-footer-info")).toBeNull();
    expect(document.querySelector(".df-drop-hint")).toBeNull();
  });
});

describe("FilesPanel large list", () => {
  afterEach(() => cleanup());

  it("renders every entry at once without IntersectionObserver (no pagination)", () => {
    const { container } = renderPanel(generateFiles(500));
    expect(container.querySelectorAll("[data-testid^='design-file-row-']").length).toBe(500);
    expect(document.querySelector(".df-pagination")).toBeNull();
  });

  it("remembers the grid layout per project and reopens in it", () => {
    const first = renderPanel(generateFiles(3));
    expect(screen.getByTestId("library-list")).toBeTruthy();
    fireEvent.click(screen.getByTestId("library-layout-grid"));
    expect(screen.getByTestId("library-grid")).toBeTruthy();
    expect(screen.getByTestId("library-layout-grid")).toHaveAttribute("aria-pressed", "true");
    expect(lsStore.get("pixo:library-layout:test-project")).toBe("grid");
    first.unmount();

    const second = renderPanel(generateFiles(3));
    expect(screen.getByTestId("library-grid")).toBeTruthy();
    second.unmount();
    renderPanel(generateFiles(3), { projectId: "other-project" });
    expect(screen.getByTestId("library-list")).toBeTruthy();
  });

  it("renders 500 files within a reasonable time", () => {
    const files = generateFiles(500);
    const start = performance.now();
    renderPanel(files);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("FilesPanel selection", () => {
  afterEach(() => cleanup());

  it("shows the batch bar and passes every selected file to batch delete", () => {
    const files = generateFiles(3);
    const { container, onDeleteFiles } = renderPanel(files);

    // Selection spans filters: pick a page under 全部, then an image under 图片.
    fireEvent.click(
      screen
        .getByTestId("design-file-row-file-1.html")
        .querySelector(".df-row-check")!,
    );
    clickFilter("image");
    fireEvent.click(
      screen
        .getByTestId("design-file-row-file-2.png")
        .querySelector(".df-row-check")!,
    );

    expect(
      container.querySelector('[data-testid="file-list-batch-bar"]'),
    ).toBeTruthy();

    fireEvent.click(
      container.querySelector('[data-testid="file-list-batch-delete"]')!,
    );
    expect(onDeleteFiles).toHaveBeenCalledTimes(1);
    expect(onDeleteFiles).toHaveBeenCalledWith(["file-1.html", "file-2.png"]);
  });



  it("does not open files from card controls", () => {
    useGrid();
    const files = generateFiles(1);
    const { container, onOpenFile } = renderPanel(files);
    const card = container.querySelector(".df-card")!;

    fireEvent.click(card.querySelector(".df-card-check")!);
    expect(onOpenFile).not.toHaveBeenCalled();

    fireEvent.click(card.querySelector(".df-row-menu")!);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("copies the local file path from the row menu", async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      const { container } = renderPanel([
        file({
          name: "alpha.html",
          localPath: "/tmp/openpixo/projects/test-project/alpha.html",
        }),
      ]);

      fireEvent.click(screen.getByTestId("design-file-menu-alpha.html"));
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Copy absolute path" }),
      );

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(
          "/tmp/openpixo/projects/test-project/alpha.html",
        );
      });
      // The panel has no detail pane — copying a path never opens one.
      expect(container.querySelector(".df-preview")).toBeNull();
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  // #5517 contract: the card grid IS the preview surface, so one click on the
  // thumb opens the page in a workspace tab. There is no detail pane and no
  // double-click step.
  it("opens the file from a single click on the card thumb", () => {
    useGrid();
    const files = generateFiles(1);
    const { container, onOpenFile } = renderPanel(files);
    const card = container.querySelector(".df-card")!;

    fireEvent.click(card.querySelector(".df-card-thumb")!);
    expect(onOpenFile).toHaveBeenCalledWith("file-1.html");
    expect(container.querySelector(".df-preview")).toBeNull();
  });

  it("opens the image from a single click on its grid card", () => {
    useGrid();
    const { container, onOpenFile } = renderPanel([
      file({ name: "shot.png", kind: "image", mime: "image/png" }),
    ]);

    fireEvent.click(container.querySelector(".df-card[data-kind='image'] .df-card-thumb")!);
    expect(onOpenFile).toHaveBeenCalledWith("shot.png");
    expect(container.querySelector(".df-preview")).toBeNull();
  });

  it("reserves a full thumbnail skeleton until the grid image loads, from the asset thumbnail", () => {
    useGrid();
    const { container } = renderPanel([
      file({ name: "art/slow-shot.png", kind: "image", mime: "image/png", mtime: 1700000000000 }),
    ]);
    clickFilter("image");

    const thumb = container.querySelector<HTMLButtonElement>(
      ".df-card[data-kind='image'] .df-card-thumb",
    );
    expect(thumb?.querySelector("img")?.getAttribute("src")).toBe(
      "/api/projects/test-project/assets/thumb?path=art%2Fslow-shot.png&size=256&v=1700000000000",
    );
    const image = thumb?.querySelector<HTMLImageElement>("img");
    expect(thumb?.dataset.imageStatus).toBe("loading");
    expect(thumb?.querySelector(".df-image-skeleton")).toBeTruthy();

    fireEvent.load(image!);
    expect(thumb?.dataset.imageStatus).toBe("loaded");
    expect(thumb?.querySelector(".df-image-skeleton")).toBeNull();
  });

  it("falls back from the asset thumbnail to the original bytes, then to a glyph", () => {
    useGrid();
    const { container } = renderPanel([
      file({ name: "odd.png", kind: "image", mime: "image/png", mtime: 5 }),
    ]);
    const thumb = container.querySelector<HTMLButtonElement>(".df-card[data-kind='image'] .df-card-thumb")!;
    fireEvent.error(thumb.querySelector("img")!);
    expect(thumb.querySelector("img")?.getAttribute("src")).toBe("/api/projects/test-project/raw/odd.png?v=5");
    fireEvent.error(thumb.querySelector("img")!);
    expect(thumb.dataset.imageStatus).toBe("error");
    expect(thumb.querySelector("img")).toBeNull();
  });

  it("names grid cards by file name, with the full path as the tooltip", () => {
    useGrid();
    renderPanel([file({ name: "art/ui/button.png", kind: "image", mime: "image/png" })]);
    clickFilter("image");
    const card = screen.getByTestId("design-file-row-art/ui/button.png");
    expect(card.querySelector(".df-card-name")?.textContent).toBe("button.png");
    expect(card.querySelector(".df-card-thumb")?.getAttribute("title")).toContain("art/ui/button.png");
    expect(card.textContent).toContain("art/ui/");
  });

  it("plays one audio clip at a time from its grid card", () => {
    useGrid();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
      this.dispatchEvent(new Event("pause"));
    });
    try {
      const { onOpenFile } = renderPanel([
        file({ name: "jump.wav", kind: "audio", mime: "audio/wav" }),
        file({ name: "land.wav", kind: "audio", mime: "audio/wav" }),
      ]);
      fireEvent.click(screen.getByRole("button", { name: "Play jump.wav" }));
      expect(screen.getByRole("button", { name: "Pause jump.wav" })).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByRole("button", { name: "Play land.wav" }));
      expect(screen.getByRole("button", { name: "Play jump.wav" })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("button", { name: "Pause land.wav" })).toBeTruthy();
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(document.querySelector("audio")?.getAttribute("preload")).toBe("none");
    } finally {
      play.mockRestore();
      pause.mockRestore();
    }
  });

  it("opens the file from a single click on a list row's name", () => {
    const { container, onOpenFile } = renderPanel([
      file({ name: "notes.txt", kind: "text", mime: "text/plain" }),
    ]);

    fireEvent.click(container.querySelector(".df-file-row .df-row-name-btn")!);
    expect(onOpenFile).toHaveBeenCalledWith("notes.txt");
    expect(container.querySelector(".df-preview")).toBeNull();
  });

  // The card's name button is the inline-rename entry point for editors, and
  // stays a plain open target for read-only viewers (who have no rename path).
  it("starts an inline rename from the card name for editors", () => {
    useGrid();
    const files = generateFiles(1);
    const { container, onOpenFile } = renderPanel(files);

    fireEvent.click(container.querySelector(".df-card-name-btn")!);
    expect(container.querySelector(".df-rename-input")).toBeTruthy();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("opens instead of renaming from the card name for read-only viewers", () => {
    useGrid();
    const files = generateFiles(1);
    const { container, onOpenFile } = renderPanel(files, { viewerOnly: true });

    fireEvent.click(container.querySelector(".df-card-name-btn")!);
    expect(container.querySelector(".df-rename-input")).toBeNull();
    expect(onOpenFile).toHaveBeenCalledWith("file-1.html");
  });
});

describe("FilesPanel page thumbnails", () => {
  beforeEach(() => useGrid());
  it.each(['fresh', 'cached'])("keeps %s motion video thumbnails under inactive host playback", async (sourceMode) => {
    const source = '<!doctype html><html><head><meta name="pixo-motion-output" content="video"></head><body><main data-composition-id="main" data-duration="15" data-width="1920" data-height="1080"><audio src="sound.wav" data-duration="15"></audio></main></body></html>';
    const motionFile = file({ name: `motion-${sourceMode}.html`, kind: 'html', mime: 'text/html', size: 16000, mtime: 1700000000000 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source, { status: 200 })));
    if (sourceMode === 'cached') setHtmlSourceSnapshot({ authorizationScopeKey: 'local', projectId: 'test-project', fileName: motionFile.name, refreshKey: `${motionFile.mtime}:${motionFile.size}:0`, source });
    const { container } = renderPanel([motionFile]);
    await waitFor(() => {
      expect(container.querySelector<HTMLIFrameElement>('.df-card-thumb iframe')?.srcdoc).toContain('window.__pixoMotionPreview=true');
    });
  });
  afterEach(() => cleanup());

  it("does not fetch or iframe large HTML files for the Files thumbnail", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderPanel([
      file({
        name: "large.html",
        kind: "html",
        mime: "text/html",
        size: 2 * 1024 * 1024,
      }),
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
    // Over the inline cap the card thumb never URL-loads the iframe; it falls
    // back to the glyph placeholder.
    expect(container.querySelector(".df-card-thumb iframe")).toBeNull();
    expect(container.querySelector(".df-preview-placeholder")?.textContent).toContain("⟨⟩");
  });

  it("builds small HTML thumbnails asynchronously without URL-loading the iframe first", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("<!doctype html><html><body><main>Small</main></body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderPanel([
      file({
        name: "small.html",
        kind: "html",
        mime: "text/html",
        size: 16 * 1024,
        mtime: 1700000000000,
      }),
    ]);

    await waitFor(() => {
      const iframe = container.querySelector<HTMLIFrameElement>(".df-card-thumb iframe");
      expect(iframe).toBeTruthy();
      expect(iframe?.getAttribute("src")).toBeNull();
      expect(iframe?.getAttribute("srcdoc") ?? iframe?.srcdoc ?? "").toContain("Small");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/test-project/raw/small.html?v=1700000000000",
      expect.any(Object),
    );
  });

  it("reuses an exact-version HTML thumbnail source across panel remounts", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("<!doctype html><html><body><main>Cached</main></body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const cachedFile = file({
      name: "cached.html",
      kind: "html",
      mime: "text/html",
      size: 16 * 1024,
      mtime: 1700000000000,
    });

    const first = renderPanel([cachedFile]);
    await waitFor(() => {
      expect(first.container.querySelector(".df-card-thumb iframe")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderPanel([cachedFile]);
    await waitFor(() => {
      expect(second.container.querySelector(".df-card-thumb iframe")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    second.unmount();

    const changed = renderPanel([{ ...cachedFile, mtime: cachedFile.mtime + 1 }]);
    await waitFor(() => {
      expect(changed.container.querySelector(".df-card-thumb iframe")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds the current file thumbnail from the exact viewer source snapshot", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const currentFile = file({
      name: "current.html",
      kind: "html",
      mime: "text/html",
      size: 16 * 1024,
      mtime: 1700000000000,
    });
    setHtmlSourceSnapshot({
      authorizationScopeKey: "local",
      projectId: "test-project",
      fileName: currentFile.name,
      refreshKey: `${currentFile.mtime}:${currentFile.size}:7`,
      source: "<!doctype html><html><body><main>Already loaded</main></body></html>",
    });

    const { container } = renderPanel([currentFile], { filesRefreshKey: 7 });

    await waitFor(() => {
      const iframe = container.querySelector<HTMLIFrameElement>(".df-card-thumb iframe");
      expect(iframe?.getAttribute("srcdoc") ?? iframe?.srcdoc ?? "")
        .toContain("Already loaded");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mounts a cached HTML thumbnail with the desktop layout viewport on its first render", () => {
    const cachedFile = file({
      name: "deck.html",
      kind: "html",
      mime: "text/html",
      size: 16 * 1024,
      mtime: 1700000000001,
    });
    setHtmlSourceSnapshot({
      authorizationScopeKey: "local",
      projectId: "test-project",
      fileName: cachedFile.name,
      refreshKey: `${cachedFile.mtime}:${cachedFile.size}:8`,
      source: "<!doctype html><html><body><main>Deck</main></body></html>",
    });

    const { container } = renderPanel([cachedFile], { filesRefreshKey: 8 });
    const iframe = container.querySelector<HTMLIFrameElement>(".df-card-thumb iframe");

    expect(iframe).toBeTruthy();
    expect(iframe?.style.width).toBe("1200px");
    expect(iframe?.style.height).toBe("675px");
  });
});

describe("FilesPanel directory navigation", () => {
  afterEach(() => {
    cleanup();
  });

  it("collapses nested files into a single folder row at root with correct descendant count", () => {
    renderPanel([
      file({ name: "assets/logo.png", kind: "image" }),
      file({ name: "assets/icons/star.svg", kind: "image" }),
    ]);

    const dirRows = document.querySelectorAll(".df-dir-row");
    expect(dirRows.length).toBe(1);
    expect(dirRows[0]!.textContent).toContain("assets");
    expect(dirRows[0]!.textContent).toContain("2");
  });

  it("lists folders before the files of the folder being browsed", () => {
    renderPanel([
      file({ name: "assets/logo.png", kind: "image" }),
      file({ name: "top.html", kind: "html" }),
    ]);

    const rows = [...document.querySelectorAll("[data-testid='library-list'] > .df-row")];
    expect(rows.map((row) => row.classList.contains("df-dir-row"))).toEqual([true, false]);
    expect(screen.queryByTestId("design-file-row-assets/logo.png")).toBeNull();
  });

  it("clicking a folder row navigates into it and shows only basenames and nested dirs", () => {
    // Text files keep the list-row shell (images are bare masonry cards with
    // no visible name), so the basename contract is asserted on rows.
    renderPanel([
      file({ name: "assets/notes.txt", kind: "text", mime: "text/plain" }),
      file({ name: "assets/icons/readme.txt", kind: "text", mime: "text/plain" }),
    ]);

    fireEvent.click(document.querySelector(".df-dir-row .df-row-name-btn")!);

    expect(document.querySelector(".df-breadcrumbs")).toBeTruthy();
    expect(document.querySelector(".df-breadcrumb-current")?.textContent).toBe(
      "assets",
    );

    const dirRows = document.querySelectorAll(".df-dir-row");
    expect(dirRows.length).toBe(1);
    expect(dirRows[0]!.textContent).toContain("icons");

    const fileRow = screen.getByTestId("design-file-row-assets/notes.txt");
    expect(fileRow.querySelector(".df-row-name")?.textContent).toBe("notes.txt");
    expect(fileRow.querySelector(".df-row-name")?.textContent).not.toContain(
      "assets/",
    );
  });

  it("always renders the root breadcrumb on the default-root view", () => {
    // Regression: managed-storage projects have currentDir==='' and no
    // rootDirName, which previously collapsed the whole breadcrumb nav to null
    // and left the toolbar blank on the left for the most common path. The root
    // crumb must always render, falling back to the t('filesPanel.crumbs')
    // label when no rootDirName exists.
    renderPanel([file({ name: "top.html", kind: "html" })]);

    expect(document.querySelector(".df-breadcrumbs")).toBeTruthy();
    expect(document.querySelector(".df-breadcrumb-current")?.textContent).toBe(
      "Project",
    );
  });

  it("shows rootDirName as the root breadcrumb when one is provided", () => {
    renderPanel([file({ name: "top.html", kind: "html" })], {
      rootDirName: "my-folder",
    });

    expect(document.querySelector(".df-breadcrumb-current")?.textContent).toBe(
      "my-folder",
    );
  });

  it("clicking the root breadcrumb navigates back to root", () => {
    renderPanel([
      file({ name: "assets/logo.png", kind: "image" }),
      file({ name: "top.html", kind: "html" }),
    ]);

    fireEvent.click(document.querySelector(".df-dir-row .df-row-name-btn")!);
    expect(document.querySelector(".df-breadcrumbs")).toBeTruthy();

    fireEvent.click(document.querySelector(".df-breadcrumb-btn")!);

    expect(
      document.querySelector(".df-breadcrumb-current")?.textContent,
    ).not.toBe("assets");
    expect(screen.getByTestId("design-file-row-top.html")).toBeTruthy();
    expect(document.querySelectorAll(".df-dir-row").length).toBe(1);
  });

  it("lists subdirectory files flat under a type filter, without folder rows", () => {
    renderPanel([
      file({ name: "assets/logo.png", kind: "image" }),
      file({ name: "top.html", kind: "html" }),
    ]);

    expect(screen.getByTestId("design-file-row-top.html")).toBeTruthy();
    clickFilter("image");
    expect(screen.getByTestId("design-file-row-assets/logo.png")).toBeTruthy();
    expect(document.querySelectorAll(".df-dir-row").length).toBe(0);
    clickFilter("all");
    expect(document.querySelectorAll(".df-dir-row").length).toBe(1);
  });

  it("preserves the current directory when remounted with navState from a previous render", () => {
    let saved: FilesNavState | undefined;

    function makePanel(nav?: FilesNavState) {
      return (
        <FilesPanel
          projectId="test-project"
          projectKind="prototype"
          files={[
            file({ name: "assets/logo.png", kind: "image" }),
            file({ name: "top.html", kind: "html" }),
          ]}
          navState={nav}
          onNavStateChange={(state) => {
            saved = state;
          }}
          onRefreshFiles={vi.fn()}
          onOpenFile={vi.fn()}
          onRenameFile={vi.fn()}
          onDeleteFile={vi.fn()}
          onDeleteFiles={vi.fn()}
          onUpload={vi.fn()}
          onUploadFiles={vi.fn()}
          onPaste={vi.fn()}
        />
      );
    }

    const { unmount } = render(makePanel());

    fireEvent.click(document.querySelector(".df-dir-row .df-row-name-btn")!);
    expect(document.querySelector(".df-breadcrumb-current")?.textContent).toBe(
      "assets",
    );

    unmount();
    render(makePanel(saved));

    expect(document.querySelector(".df-breadcrumb-current")?.textContent).toBe(
      "assets",
    );
    expect(screen.getByTestId("design-file-row-assets/logo.png")).toBeTruthy();
  });

  it("keeps the type filter and search across a remount through navState", () => {
    let saved: FilesNavState | undefined;
    const props = {
      projectId: "test-project", projectKind: "prototype" as const,
      files: [file({ name: "art/hero.png", kind: "image" }), file({ name: "top.html", kind: "html" })],
      onNavStateChange: (state: FilesNavState) => { saved = state; },
      onRefreshFiles: vi.fn(), onOpenFile: vi.fn(), onRenameFile: vi.fn(), onDeleteFile: vi.fn(),
      onDeleteFiles: vi.fn(), onUpload: vi.fn(), onUploadFiles: vi.fn(), onPaste: vi.fn(),
    };
    const first = render(<FilesPanel {...props} />);
    clickFilter("image");
    fireEvent.change(screen.getByTestId("library-search"), { target: { value: "hero" } });
    first.unmount();

    render(<FilesPanel {...props} navState={saved} />);
    expect(document.getElementById("library-type-image")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("library-search")).toHaveValue("hero");
    expect(screen.getByTestId("design-file-row-art/hero.png")).toBeTruthy();
  });

  it("applies a type request once, not again on remount", () => {
    let saved: FilesNavState | undefined;
    const props = {
      projectId: "test-project", projectKind: "prototype" as const,
      files: [file({ name: "art/hero.png", kind: "image" }), file({ name: "top.html", kind: "html" })],
      onNavStateChange: (state: FilesNavState) => { saved = state; },
      onRefreshFiles: vi.fn(), onOpenFile: vi.fn(), onRenameFile: vi.fn(), onDeleteFile: vi.fn(),
      onDeleteFiles: vi.fn(), onUpload: vi.fn(), onUploadFiles: vi.fn(), onPaste: vi.fn(),
      typeFilterRequest: { type: "image" as const, nonce: 4 },
    };
    const first = render(<FilesPanel {...props} />);
    expect(document.getElementById("library-type-image")).toHaveAttribute("aria-selected", "true");
    clickFilter("all");
    first.unmount();

    render(<FilesPanel {...props} navState={saved} />);
    expect(document.getElementById("library-type-all")).toHaveAttribute("aria-selected", "true");
  });

  it("navigates up one level via the parent breadcrumb", () => {
    renderPanel([file({ name: "assets/icons/star.svg", kind: "image" })]);

    fireEvent.click(document.querySelector(".df-dir-row .df-row-name-btn")!);
    fireEvent.click(document.querySelector(".df-dir-row .df-row-name-btn")!);
    expect(document.querySelector(".df-breadcrumb-current")?.textContent).toBe(
      "icons",
    );

    const crumbs = Array.from(document.querySelectorAll(".df-breadcrumb-btn"));
    fireEvent.click(crumbs[crumbs.length - 1]!);
    expect(document.querySelector(".df-breadcrumb-current")?.textContent).toBe(
      "assets",
    );
  });

  it("clears selection when navigating into or out of a directory", () => {
    renderPanel([
      file({ name: "assets/logo.png", kind: "image" }),
      file({ name: "top.html", kind: "html" }),
    ]);

    const topRow = screen.getByTestId("design-file-row-top.html");
    fireEvent.click(topRow.querySelector(".df-row-check")!);
    expect(topRow.classList.contains("selected")).toBe(true);

    fireEvent.click(document.querySelector(".df-dir-row .df-row-name-btn")!);
    expect(
      document.querySelectorAll(".df-file-row.selected, .df-card.selected").length,
    ).toBe(0);

    fireEvent.click(document.querySelector(".df-breadcrumb-btn")!);
    expect(
      document.querySelectorAll(".df-file-row.selected, .df-card.selected").length,
    ).toBe(0);
  });

  it("resets currentDir automatically when all files in the current subdirectory are removed", () => {
    function makePanel(files: ProjectFile[]) {
      return (
        <FilesPanel
          projectId="test-project"
          projectKind="prototype"
          files={files}
          onRefreshFiles={vi.fn()}
          onOpenFile={vi.fn()}
          onRenameFile={vi.fn()}
          onDeleteFile={vi.fn()}
          onDeleteFiles={vi.fn()}
          onUpload={vi.fn()}
          onUploadFiles={vi.fn()}
          onPaste={vi.fn()}
        />
      );
    }

    const { rerender } = render(
      makePanel([
        file({ name: "assets/logo.png", kind: "image" }),
        file({ name: "top.html", kind: "html" }),
      ]),
    );

    fireEvent.click(document.querySelector(".df-dir-row .df-row-name-btn")!);
    expect(document.querySelector(".df-breadcrumb-current")?.textContent).toBe(
      "assets",
    );

    rerender(makePanel([file({ name: "top.html", kind: "html" })]));

    expect(
      document.querySelector(".df-breadcrumb-current")?.textContent,
    ).not.toBe("assets");
    expect(screen.getByTestId("design-file-row-top.html")).toBeTruthy();
  });
});

describe("FilesPanel current-directory sync", () => {
  afterEach(() => cleanup());

  it("reports the active folder so new files are created under it, not the root", () => {
    const onCurrentDirChange = vi.fn();
    renderPanel(
      [
        file({ name: "top.html", kind: "html" }),
        file({ name: "assets/logo.png", kind: "image" }),
      ],
      { onCurrentDirChange },
    );
    // Mounts at the root.
    expect(onCurrentDirChange).toHaveBeenLastCalledWith("");
    // Navigate into the folder — the parent must learn the new target dir, or
    // upload / paste / new-sketch would create at the project root (#3358 regression).
    fireEvent.click(document.querySelector(".df-dir-row .df-row-name-btn")!);
    expect(onCurrentDirChange).toHaveBeenLastCalledWith("assets");
  });
});

describe("FilesPanel persisted (empty) folders", () => {
  afterEach(() => cleanup());

  it("shows an empty persisted folder that has no files under it", () => {
    // Only a root file + an empty persisted folder; the folder must still
    // appear (it would vanish if we derived dirs from file paths alone).
    renderPanel([file({ name: "top.html", kind: "html" })], {
      folders: [folder("assets")],
    });
    const dirRows = [...document.querySelectorAll(".df-dir-row")];
    expect(dirRows.some((r) => r.textContent?.includes("assets"))).toBe(true);
  });

  it("surfaces a nested empty persisted folder after navigating into its parent", () => {
    renderPanel([], { folders: [folder("assets"), folder("assets/icons")] });
    // Zero files, but the persisted folder still renders the tree (not the
    // empty state), so 'assets' is navigable at the root.
    const rootDirs = [
      ...document.querySelectorAll(".df-dir-row .df-row-name"),
    ].map((e) => e.textContent);
    expect(rootDirs).toContain("assets");
    fireEvent.click(document.querySelector(".df-dir-row .df-row-name-btn")!);
    const nestedDirs = [
      ...document.querySelectorAll(".df-dir-row .df-row-name"),
    ].map((e) => e.textContent);
    expect(nestedDirs).toContain("icons");
  });
});

// A non-owner member's local mirror trailing the published head
// (`downloadPending`, see useProjectCollab) can still have a complete older
// materialization. Keep that useful content visible while the project-level
// sync badge communicates that a newer version is arriving. Only the
// no-local-content case should replace the empty state with a loading surface.
describe("FilesPanel pending sync (downloadPending)", () => {
  afterEach(() => cleanup());

  it("keeps an existing non-html file visible and openable while a newer version downloads", () => {
    const { onOpenFile } = renderPanel(
      [file({ name: "notes.txt", kind: "text", mime: "text/plain" })],
      { downloadPending: true },
    );

    const row = screen.getByTestId("design-file-row-notes.txt");
    expect(row.className).not.toContain("df-row-pending");
    expect(row.querySelector(".df-row-name")?.textContent).toBe("notes.txt");
    expect(row.querySelector(".skeleton-block")).toBeNull();

    fireEvent.click(row.querySelector(".df-row-name-btn")!);
    expect(onOpenFile).toHaveBeenCalledWith("notes.txt");
  });

  it("keeps an existing HTML page card visible and openable while a newer version downloads", () => {
    useGrid();
    const { onOpenFile } = renderPanel(
      [file({ name: "page.html", kind: "html", mime: "text/html" })],
      { downloadPending: true },
    );

    const card = screen.getByTestId("design-file-row-page.html");
    expect(card.className).not.toContain("df-card-pending");
    expect(card.textContent).toContain("page.html");
    const openButton = card.querySelector<HTMLButtonElement>(".df-card-thumb");
    expect(openButton).toBeTruthy();
    fireEvent.click(openButton!);
    expect(onOpenFile).toHaveBeenCalledWith("page.html");
  });

  it("keeps an existing image card visible and openable while a newer version downloads", () => {
    useGrid();
    const { onOpenFile } = renderPanel(
      [file({ name: "photo.png", kind: "image", mime: "image/png" })],
      { downloadPending: true },
    );

    const card = screen.getByTestId("design-file-row-photo.png");
    expect(card.className).not.toContain("df-card-pending");
    expect(card.getAttribute("data-kind")).toBe("image");
    const openButton = card.querySelector<HTMLButtonElement>(".df-card-thumb");
    expect(openButton).toBeTruthy();
    fireEvent.click(openButton!);
    expect(onOpenFile).toHaveBeenCalledWith("photo.png");
  });

  it("still reports the correct per-type file counts in the filter while pending", () => {
    renderPanel(
      [
        file({ name: "a.txt", kind: "text", mime: "text/plain" }),
        file({ name: "b.txt", kind: "text", mime: "text/plain" }),
      ],
      { downloadPending: true },
    );
    expect(document.getElementById("library-type-other")?.textContent).toContain("2");
  });

  it("uses the syncing empty state only when no local content is available", () => {
    renderPanel([], { downloadPending: true, viewerOnly: true });

    expect(screen.getByTestId("file-list-syncing")).toBeTruthy();
    expect(screen.queryByTestId("file-list-empty")).toBeNull();
  });

  it("replaces the retained materialization directly when the pull completes", () => {
    const commonProps = {
      projectId: "test-project",
      projectKind: "prototype" as const,
      onRefreshFiles: vi.fn(),
      onOpenFile: vi.fn(),
      onRenameFile: vi.fn(),
      onDeleteFile: vi.fn(),
      onDeleteFiles: vi.fn(),
      onUpload: vi.fn(),
      onUploadFiles: vi.fn(),
      onPaste: vi.fn(),
      viewerOnly: true,
    };
    const { rerender } = render(
      <FilesPanel
        {...commonProps}
        files={[file({ name: "version-one.txt", kind: "text", mime: "text/plain" })]}
        downloadPending
      />,
    );
    expect(screen.getByText("version-one.txt")).toBeTruthy();
    expect(document.querySelector(".skeleton-block")).toBeNull();

    rerender(
      <FilesPanel
        {...commonProps}
        files={[file({ name: "version-two.txt", kind: "text", mime: "text/plain" })]}
        downloadPending={false}
      />,
    );
    expect(screen.queryByText("version-one.txt")).toBeNull();
    expect(screen.getByText("version-two.txt")).toBeTruthy();
    expect(document.querySelector(".skeleton-block")).toBeNull();
  });
});

// The middle state: a page exists, the run is still writing it. Before this,
// the pane jumped from the starter CTAs straight to a grid of file cards, so
// the artifact was never shown taking shape.
describe("building preview", () => {
  // The suite's other cleanup hook is scoped to its own describe block.
  afterEach(() => {
    cleanup();
  });

  const page = () => file({ name: "index.html", kind: "html" });

  it("watches the page while the run is still writing it", () => {
    renderPanel([page()], { running: true, runStartedAt: Date.now() - 1000 });

    expect(screen.getByTestId("file-list-building")).toBeTruthy();
    // The grid is what it replaces, not something it sits on top of.
    expect(screen.queryByTestId("design-file-row-index.html")).toBeNull();
  });

  it('selects only HTML written since the active turn started', () => {
    const runStartedAt = 1_800_000_000_000;
    renderPanel([
      file({ name: 'index.html', mtime: runStartedAt - 1 }),
      file({ name: 'about.html', mtime: runStartedAt + 1 }),
    ], { running: true, runStartedAt });

    const preview = screen.getByTestId('file-list-building');
    expect(preview.querySelector('iframe')?.getAttribute('src')).toContain('/about.html');
  });

  it("hands the pane back to the file grid when the run ends", () => {
    const { rerender } = renderPanel([page()], { running: true, runStartedAt: Date.now() - 1000 });
    expect(screen.getByTestId("file-list-building")).toBeTruthy();

    rerender(
      <FilesPanel
        projectId="test-project"
        projectKind="prototype"
        files={[page()]}
        running={false}
        onRefreshFiles={vi.fn()}
        onOpenFile={vi.fn()}
        onRenameFile={vi.fn()}
        onDeleteFile={vi.fn()}
        onDeleteFiles={vi.fn()}
        onUpload={vi.fn()}
        onUploadFiles={vi.fn()}
        onPaste={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("file-list-building")).toBeNull();
    expect(screen.getByTestId("design-file-row-index.html")).toBeTruthy();
  });

  it("stays out of the way for a run that has produced no page", () => {
    renderPanel([file({ name: "notes.md", kind: "text", mime: "text/markdown" })], {
      running: true,
    });

    expect(screen.queryByTestId("file-list-building")).toBeNull();
    expect(screen.getByTestId("design-file-row-notes.md")).toBeTruthy();
  });

  // The starter CTAs stay where they are: a run that has not written a page
  // yet has nothing to preview, and an empty project still offers its
  // creation actions while the agent works.
  it("keeps the empty state's starter actions while a run has produced nothing", () => {
    renderPanel([], { running: true });

    expect(screen.queryByTestId("file-list-building")).toBeNull();
    expect(screen.queryByTestId("file-list-preview-toggle")).toBeNull();
  });

  // One switch, both directions. A one-way "show files" button would leave the
  // run no route back to the preview once dismissed.
  it("lets the user leave the preview for the files, and come back", () => {
    renderPanel([page()], { running: true, runStartedAt: Date.now() - 1000 });

    const toggle = screen.getByTestId("file-list-preview-toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("file-list-building")).toBeNull();
    expect(screen.getByTestId("design-file-row-index.html")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("file-list-building")).toBeTruthy();
  });

  // A switch with nothing on its other side would be a control that does
  // nothing: outside a run that has written a page, the pane has one view.
  it("shows no preview switch when no run is writing a page", () => {
    renderPanel([page()], { running: false });

    expect(screen.queryByTestId("file-list-preview-toggle")).toBeNull();
  });
});
