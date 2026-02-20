import { BaseTool } from "../base";
import { QuickbaseClient } from "../../client/quickbase";

export interface GetDefaultAppParams {
  // Intentionally empty; included for consistency with tool interface
}

export interface GetDefaultAppResult {
  currentAppId?: string;
  hasDefaultApp: boolean;
}

/**
 * Tool to read current runtime default Quickbase app context.
 */
export class GetDefaultAppTool extends BaseTool<
  GetDefaultAppParams,
  GetDefaultAppResult
> {
  public name = "get_default_app";
  public description =
    "Gets the current default Quickbase application ID used by app-scoped tools";

  public paramSchema = {
    type: "object",
    properties: {},
    required: [],
  };

  constructor(client: QuickbaseClient) {
    super(client);
  }

  protected async run(): Promise<GetDefaultAppResult> {
    const currentAppId = this.client.getDefaultAppId();
    return {
      currentAppId,
      hasDefaultApp: !!currentAppId,
    };
  }
}
