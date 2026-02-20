import { BaseTool } from "../base";
import { QuickbaseClient } from "../../client/quickbase";
import { createLogger } from "../../utils/logger";

const logger = createLogger("SetDefaultAppTool");

export interface SetDefaultAppParams {
  app_id?: string;
  clear?: boolean;
}

export interface SetDefaultAppResult {
  previousAppId?: string;
  currentAppId?: string;
  changed: boolean;
}

/**
 * Tool to set/clear the default Quickbase app context at runtime.
 * This enables dynamic multi-app workflows without restarting the MCP server.
 */
export class SetDefaultAppTool extends BaseTool<
  SetDefaultAppParams,
  SetDefaultAppResult
> {
  public name = "set_default_app";
  public description =
    "Sets or clears the default Quickbase application ID for subsequent app-scoped tools";

  public paramSchema = {
    type: "object",
    properties: {
      app_id: {
        type: "string",
        description: "Application ID to set as default",
      },
      clear: {
        type: "boolean",
        description: "If true, clears the current default app context",
      },
    },
    required: [],
  };

  constructor(client: QuickbaseClient) {
    super(client);
  }

  protected async run(params: SetDefaultAppParams): Promise<SetDefaultAppResult> {
    const { app_id, clear } = params;
    const previousAppId = this.client.getDefaultAppId();

    if (clear === true) {
      this.client.setDefaultAppId(undefined);
      const currentAppId = this.client.getDefaultAppId();

      logger.info("Cleared default app context", {
        previousAppId,
      });

      return {
        previousAppId,
        currentAppId,
        changed: previousAppId !== currentAppId,
      };
    }

    if (!app_id || app_id.trim() === "") {
      throw new Error("Either provide app_id or set clear=true");
    }

    const normalizedAppId = app_id.trim();

    const testResponse = await this.client.request({
      method: "GET",
      path: `/apps/${normalizedAppId}`,
      skipCache: true,
    });

    if (!testResponse.success) {
      throw new Error(
        testResponse.error?.message ||
          `Failed to validate application ID: ${normalizedAppId}`,
      );
    }

    this.client.setDefaultAppId(normalizedAppId);
    const currentAppId = this.client.getDefaultAppId();

    logger.info("Set default app context", {
      previousAppId,
      currentAppId,
    });

    return {
      previousAppId,
      currentAppId,
      changed: previousAppId !== currentAppId,
    };
  }
}
