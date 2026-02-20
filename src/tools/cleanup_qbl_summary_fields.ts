import { BaseTool } from "./base";
import { QuickbaseClient } from "../client/quickbase";
import { createLogger } from "../utils/logger";
import * as fs from "fs/promises";
import * as path from "path";

const logger = createLogger("CleanupQblSummaryFieldsTool");

const SUMMARY_PROPERTIES_TO_REMOVE = [
  "DefaultValue",
  "DefaultSortOrder",
  "InputOptions",
  "IsRequired",
  "IsUnique",
  "AllowDataCopy",
] as const;

type SummaryPropertyToRemove = (typeof SUMMARY_PROPERTIES_TO_REMOVE)[number];

export interface CleanupQblSummaryFieldsParams {
  target_path: string;
  recursive?: boolean;
  dry_run?: boolean;
}

export interface CleanupQblSummaryFieldsResult {
  targetPath: string;
  dryRun: boolean;
  recursive: boolean;
  filesScanned: number;
  filesChanged: number;
  totalPropertiesRemoved: number;
  removedByProperty: Record<SummaryPropertyToRemove, number>;
  changedFiles: Array<{
    filePath: string;
    totalRemoved: number;
    removedByProperty: Record<SummaryPropertyToRemove, number>;
  }>;
}

interface FileCleanupResult {
  updatedLines: string[];
  removedByProperty: Record<SummaryPropertyToRemove, number>;
}

export class CleanupQblSummaryFieldsTool extends BaseTool<
  CleanupQblSummaryFieldsParams,
  CleanupQblSummaryFieldsResult
> {
  public name = "cleanup_qbl_summary_fields";
  public description =
    "Removes unsupported/default summary-field properties from QBL YAML files (DefaultValue, DefaultSortOrder, InputOptions, IsRequired, IsUnique, AllowDataCopy)";

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
    params: CleanupQblSummaryFieldsParams,
  ): Promise<CleanupQblSummaryFieldsResult> {
    const recursive = params.recursive ?? true;
    const dryRun = params.dry_run ?? false;

    const resolvedTarget = this.resolveAndValidatePath(params.target_path);
    const stat = await fs.stat(resolvedTarget);

    const files = stat.isDirectory()
      ? await this.collectYamlFiles(resolvedTarget, recursive)
      : [resolvedTarget];

    const aggregateRemoved = this.createEmptyCountMap();
    const changedFiles: CleanupQblSummaryFieldsResult["changedFiles"] = [];

    for (const filePath of files) {
      const originalText = await fs.readFile(filePath, "utf-8");
      const originalLines = originalText.split(/\r?\n/);
      const { updatedLines, removedByProperty } =
        this.cleanupSummaryFieldProperties(originalLines);

      const totalRemoved = Object.values(removedByProperty).reduce(
        (sum, value) => sum + value,
        0,
      );

      if (totalRemoved === 0) {
        continue;
      }

      for (const key of SUMMARY_PROPERTIES_TO_REMOVE) {
        aggregateRemoved[key] += removedByProperty[key];
      }

      if (!dryRun) {
        await fs.writeFile(filePath, `${updatedLines.join("\n")}\n`, "utf-8");
      }

      changedFiles.push({
        filePath,
        totalRemoved,
        removedByProperty,
      });
    }

    const totalPropertiesRemoved = Object.values(aggregateRemoved).reduce(
      (sum, value) => sum + value,
      0,
    );

    logger.info("QBL summary cleanup completed", {
      targetPath: resolvedTarget,
      filesScanned: files.length,
      filesChanged: changedFiles.length,
      totalPropertiesRemoved,
      dryRun,
      recursive,
    });

    return {
      targetPath: resolvedTarget,
      dryRun,
      recursive,
      filesScanned: files.length,
      filesChanged: changedFiles.length,
      totalPropertiesRemoved,
      removedByProperty: aggregateRemoved,
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

  private cleanupSummaryFieldProperties(lines: string[]): FileCleanupResult {
    const updatedLines: string[] = [];
    const removedByProperty = this.createEmptyCountMap();

    const n = lines.length;
    let index = 0;

    while (index < n) {
      const line = lines[index];

      if (line.trim() !== "Type: QB::Field::Summary") {
        updatedLines.push(line);
        index += 1;
        continue;
      }

      updatedLines.push(line);
      const typeIndent = this.getIndent(line);
      index += 1;

      while (index < n) {
        const currentLine = lines[index];
        const currentTrimmed = currentLine.trim();
        const currentIndent = this.getIndent(currentLine);

        if (currentTrimmed && currentIndent < typeIndent) {
          break;
        }

        if (currentTrimmed === "Properties:" && currentIndent === typeIndent) {
          updatedLines.push(currentLine);
          const propertiesIndent = currentIndent;
          index += 1;

          while (index < n) {
            const propertyLine = lines[index];
            const propertyTrimmed = propertyLine.trim();
            const propertyIndent = this.getIndent(propertyLine);

            if (propertyTrimmed && propertyIndent <= propertiesIndent) {
              break;
            }

            if (propertyTrimmed && propertyIndent === propertiesIndent + 2) {
              const key = propertyTrimmed.split(":", 1)[0].trim();
              if (
                SUMMARY_PROPERTIES_TO_REMOVE.includes(
                  key as SummaryPropertyToRemove,
                )
              ) {
                const typedKey = key as SummaryPropertyToRemove;
                removedByProperty[typedKey] += 1;

                if (typedKey === "InputOptions") {
                  index += 1;
                  while (index < n) {
                    const nestedLine = lines[index];
                    const nestedTrimmed = nestedLine.trim();
                    const nestedIndent = this.getIndent(nestedLine);
                    if (nestedTrimmed && nestedIndent <= propertyIndent) {
                      break;
                    }
                    index += 1;
                  }
                  continue;
                }

                index += 1;
                continue;
              }
            }

            updatedLines.push(propertyLine);
            index += 1;
          }

          continue;
        }

        updatedLines.push(currentLine);
        index += 1;
      }
    }

    return {
      updatedLines,
      removedByProperty,
    };
  }

  private getIndent(line: string): number {
    return line.length - line.trimStart().length;
  }

  private createEmptyCountMap(): Record<SummaryPropertyToRemove, number> {
    return {
      DefaultValue: 0,
      DefaultSortOrder: 0,
      InputOptions: 0,
      IsRequired: 0,
      IsUnique: 0,
      AllowDataCopy: 0,
    };
  }
}
