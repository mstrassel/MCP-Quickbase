import * as fs from "fs/promises";
import * as path from "path";
import { QuickbaseClient } from "../client/quickbase";
import { CleanupQblFormV2SectionsTool } from "../tools/cleanup_qbl_formv2_sections";

describe("CleanupQblFormV2SectionsTool", () => {
  const workspaceRoot = process.cwd();
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(workspaceRoot, "tmp-formv2-cleanup-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createTool(): CleanupQblFormV2SectionsTool {
    return new CleanupQblFormV2SectionsTool({} as QuickbaseClient);
  }

  it("updates IsCollapsible only for blank Title sections", async () => {
    const filePath = path.join(tempDir, "form.yaml");
    await fs.writeFile(
      filePath,
      [
        "root:",
        "  $Section_A:",
        "    Type: QB::FormV2::Section",
        "    Properties:",
        "      Title:",
        "      IsCollapsible: true",
        "  $Section_B:",
        "    Type: QB::FormV2::Section",
        "    Properties:",
        "      Title: Labor",
        "      IsCollapsible: true",
      ].join("\n"),
      "utf-8",
    );

    const tool = createTool();
    const result = await tool.execute({
      target_path: path.relative(workspaceRoot, filePath),
      dry_run: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.filesScanned).toBe(1);
    expect(result.data?.filesChanged).toBe(1);
    expect(result.data?.sectionsUpdated).toBe(1);

    const updated = await fs.readFile(filePath, "utf-8");
    expect(updated).toContain("      Title:\n      IsCollapsible: false");
    expect(updated).toContain("      Title: Labor\n      IsCollapsible: true");
  });

  it("reports changes in dry_run mode without writing file", async () => {
    const filePath = path.join(tempDir, "dryrun.yaml");
    const original = [
      "$X:",
      "  Type: QB::FormV2::Section",
      "  Properties:",
      "    Title:",
      "    IsCollapsible: true",
    ].join("\n");
    await fs.writeFile(filePath, original, "utf-8");

    const tool = createTool();
    const result = await tool.execute({
      target_path: path.relative(workspaceRoot, filePath),
      dry_run: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.filesChanged).toBe(1);
    expect(result.data?.sectionsUpdated).toBe(1);

    const afterDryRun = await fs.readFile(filePath, "utf-8");
    expect(afterDryRun).toBe(original);
  });

  it("scans directories recursively and only updates matching sections", async () => {
    const nestedDir = path.join(tempDir, "nested");
    await fs.mkdir(nestedDir, { recursive: true });

    const rootFile = path.join(tempDir, "root.yaml");
    const nestedFile = path.join(nestedDir, "nested.yaml");

    await fs.writeFile(
      rootFile,
      [
        "$A:",
        "  Type: QB::FormV2::Section",
        "  Properties:",
        "    Title:",
        "    IsCollapsible: true",
      ].join("\n"),
      "utf-8",
    );

    await fs.writeFile(
      nestedFile,
      [
        "$B:",
        "  Type: QB::FormV2::Section",
        "  Properties:",
        "    Title: Keep",
        "    IsCollapsible: true",
      ].join("\n"),
      "utf-8",
    );

    const tool = createTool();
    const result = await tool.execute({
      target_path: path.relative(workspaceRoot, tempDir),
      recursive: true,
      dry_run: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.filesScanned).toBe(2);
    expect(result.data?.filesChanged).toBe(1);
    expect(result.data?.sectionsUpdated).toBe(1);

    const rootUpdated = await fs.readFile(rootFile, "utf-8");
    const nestedUpdated = await fs.readFile(nestedFile, "utf-8");
    expect(rootUpdated).toContain("IsCollapsible: false");
    expect(nestedUpdated).toContain("IsCollapsible: true");
  });

  it("rejects paths outside the workspace", async () => {
    const tool = createTool();
    const result = await tool.execute({
      target_path: "../outside-workspace.yaml",
      dry_run: true,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain(
      "target_path must be within the current workspace",
    );
  });
});
