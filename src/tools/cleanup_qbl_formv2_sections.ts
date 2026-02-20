import { BaseTool } from "./base";
import { QuickbaseClient } from "../client/quickbase";
import { createLogger } from "../utils/logger";
import * as fs from "fs/promises";
import * as path from "path";

const logger = createLogger("CleanupQblFormV2SectionsTool");

export interface CleanupQblFormV2SectionsParams {
  target_path: string;
  recursive?: boolean;
  dry_run?: boolean;
}

export interface CleanupQblFormV2SectionsResult {
  targetPath: string;
  dryRun: boolean;
  recursive: boolean;
  filesScanned: number;
  filesChanged: number;
  sectionsUpdated: number;
  changedFiles: Array<{
    filePath: string;
    sectionsUpdated: number;
  }>;
}

interface FileCleanupResult {
  updatedLines: string[];
  sectionsUpdated: number;
}

export class CleanupQblFormV2SectionsTool extends BaseTool<
  CleanupQblFormV2SectionsParams,
  CleanupQblFormV2SectionsResult
> {
  public name = "cleanup_qbl_formv2_sections";
  public description =
    "For QB::FormV2::Section entries, sets IsCollapsible=false when section Title is blank";

  public paramSchema = {
    type: "object",
    properties: {
      target_path: {
        type: "string",
        description: "Path to a QBL YAML file or directory",
      },
      recursive: {
        type: "boolean",
        description: "When target_path is a directory, scan subdirectories",
      },
      dry_run: {
        type: "boolean",
        description:
          "If true, calculate changes without modifying files on disk",
      },
    },
    required: ["target_path"],
  };

  constructor(client: QuickbaseClient) {
    super(client);
  }

  protected async run(
    params: CleanupQblFormV2SectionsParams,
  ): Promise<CleanupQblFormV2SectionsResult> {
    const recursive = params.recursive ?? true;
    const dryRun = params.dry_run ?? false;

    const resolvedTarget = this.resolveAndValidatePath(params.target_path);
    const stat = await fs.stat(resolvedTarget);

    const files = stat.isDirectory()
      ? await this.collectYamlFiles(resolvedTarget, recursive)
      : [resolvedTarget];

    const changedFiles: CleanupQblFormV2SectionsResult["changedFiles"] = [];
    let sectionsUpdated = 0;

    for (const filePath of files) {
      const originalText = await fs.readFile(filePath, "utf-8");
      const originalLines = originalText.split(/\r?\n/);

      const { updatedLines, sectionsUpdated: updatedInFile } =
        this.cleanupFormV2Sections(originalLines);

      if (updatedInFile === 0) {
        continue;
      }

      if (!dryRun) {
        await fs.writeFile(filePath, `${updatedLines.join("\n")}\n`, "utf-8");
      }

      sectionsUpdated += updatedInFile;
      changedFiles.push({
        filePath,
        sectionsUpdated: updatedInFile,
      });
    }

    logger.info("QBL FormV2 section cleanup completed", {
      targetPath: resolvedTarget,
      filesScanned: files.length,
      filesChanged: changedFiles.length,
      sectionsUpdated,
      dryRun,
      recursive,
    });

    return {
      targetPath: resolvedTarget,
      dryRun,
      recursive,
      filesScanned: files.length,
      filesChanged: changedFiles.length,
      sectionsUpdated,
      changedFiles,
    };
  }

  private resolveAndValidatePath(inputPath: string): string {
    if (!inputPath || !inputPath.trim()) {
      throw new Error("target_path is required");
    }

    const workingDir = process.cwd();
    const resolvedPath = path.resolve(workingDir, inputPath.trim());

    if (
      resolvedPath !== workingDir &&
      !resolvedPath.startsWith(`${workingDir}${path.sep}`)
    ) {
      throw new Error("target_path must be within the current workspace");
    }

    return resolvedPath;
  }

  private async collectYamlFiles(
    dirPath: string,
    recursive: boolean,
  ): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        if (entry.name.toLowerCase().endsWith(".yaml")) {
          files.push(fullPath);
        }
        continue;
      }

      if (entry.isDirectory() && recursive) {
        const nestedFiles = await this.collectYamlFiles(fullPath, true);
        files.push(...nestedFiles);
      }
    }

    return files.sort((a, b) => a.localeCompare(b));
  }

  private cleanupFormV2Sections(lines: string[]): FileCleanupResult {
    const updatedLines = [...lines];
    const n = updatedLines.length;
    let sectionsUpdated = 0;

    for (let i = 0; i < n; i += 1) {
      const line = updatedLines[i];
      if (line.trim() !== "Type: QB::FormV2::Section") {
        continue;
      }

      const sectionTypeIndent = this.getIndent(line);
      let propertiesLine = -1;

      for (let j = i + 1; j < n; j += 1) {
        const scanLine = updatedLines[j];
        const scanTrimmed = scanLine.trim();
        const scanIndent = this.getIndent(scanLine);

        if (scanTrimmed && scanIndent < sectionTypeIndent) {
          break;
        }

        if (scanTrimmed === "Properties:" && scanIndent === sectionTypeIndent) {
          propertiesLine = j;
          break;
        }
      }

      if (propertiesLine < 0) {
        continue;
      }

      const propertiesIndent = this.getIndent(updatedLines[propertiesLine]);
      let titleBlank: boolean | undefined;
      let collapsibleTrueLine = -1;

      for (let k = propertiesLine + 1; k < n; k += 1) {
        const propertyLine = updatedLines[k];
        const propertyTrimmed = propertyLine.trim();
        const propertyIndent = this.getIndent(propertyLine);

        if (propertyTrimmed && propertyIndent <= propertiesIndent) {
          break;
        }

        if (propertyTrimmed && propertyIndent === propertiesIndent + 2) {
          if (propertyTrimmed.startsWith("Title:")) {
            titleBlank = propertyTrimmed.slice(6).trim() === "";
          }

          if (propertyTrimmed === "IsCollapsible: true") {
            collapsibleTrueLine = k;
          }
        }
      }

      if (titleBlank === true && collapsibleTrueLine >= 0) {
        updatedLines[collapsibleTrueLine] = updatedLines[collapsibleTrueLine].replace(
          "IsCollapsible: true",
          "IsCollapsible: false",
        );
        sectionsUpdated += 1;
      }
    }

    return {
      updatedLines,
      sectionsUpdated,
    };
  }

  private getIndent(line: string): number {
    return line.length - line.trimStart().length;
  }
}
