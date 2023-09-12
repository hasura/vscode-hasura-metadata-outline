"use strict";

import * as vscode from "vscode";

import { JsonOutlineProvider } from "./jsonOutline";

export function activate(context: vscode.ExtensionContext) {
  const jsonOutlineProvider = new JsonOutlineProvider(context);
  vscode.window.registerTreeDataProvider("hasuraOutline", jsonOutlineProvider);
  vscode.commands.registerCommand("hasuraOutline.refresh", () =>
    jsonOutlineProvider.refresh()
  );
  vscode.commands.registerCommand("hasuraOutline.refreshNode", (offset) =>
    jsonOutlineProvider.refresh(offset)
  );
  vscode.commands.registerCommand("hasuraOutline.renameNode", (args) => {
    let offset = undefined;
    if (args.selectedTreeItems && args.selectedTreeItems.length) {
      offset = args.selectedTreeItems[0];
    } else if (typeof args === "number") {
      offset = args;
    }
    if (offset) {
      jsonOutlineProvider.rename(offset);
    }
  });
  vscode.commands.registerCommand("hasuraOutline.openJsonSelection", (range) =>
    jsonOutlineProvider.select(range)
  );
}
