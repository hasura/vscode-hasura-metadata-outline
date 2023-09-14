import * as vscode from "vscode";
import * as json from "jsonc-parser";
import * as path from "path";
import * as _ from "lodash";

const KNOWN_KINDS = [
  "AuthConfig",
  "HasuraHubDataSource",
  "DataConnectorScalarRepresentation",

  "Model",
  "ModelSelectPermissions",

  "ObjectType",
  "ScalarType",
  "TypeOutputPermissions",

  "Relationship",
];

const SIMPLE_KIND_MAPS: Record<string, string[]> = {
  "KIND:HasuraHubDataSource": ["name"],
  "KIND:Model": ["name"],
  "KIND:ModelSelectPermissions": ["modelName"],
  "KIND:ObjectType": ["name"],
  "KIND:ScalarType": ["name"],
  "KIND:TypeOutputPermissions": ["typeName"],
  SCALAR_REPRESENTATION: ["scalarType"],
};

const __HACK_KIND_DOCUMENT_POSITION = "__HACK_KIND_DOCUMENT_POSITION";

class KindTree extends vscode.TreeItem {
  children: KindTree[] = [];
  command: any;

  static createRoot(j: any): KindTree {
    const n = new KindTree(
      "ROOT_KIND_TREE",
      "ROOT",
      undefined,
      vscode.TreeItemCollapsibleState.Expanded,
      undefined
    );
    n.buildJson(j);
    return n;
  }

  buildJson(j: any) {
    if (this.tag == "ROOT") {
      const m = j?.metadata;
      if (!m) return;

      _.forEach(m, (mm, i) => {
        mm[__HACK_KIND_DOCUMENT_POSITION] = i;
      });

      const groupKinds = _.groupBy(m, "kind");
      const kinds = _.intersection(
        _.union(KNOWN_KINDS, _.keys(groupKinds)),
        _.keys(groupKinds)
      );

      for (const k of kinds) {
        const n = new KindTree(
          k,
          "KIND:" + k,
          KNOWN_KINDS.includes(k) ? undefined : "Unknown Kind",
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined
        );
        n.buildJson(groupKinds[k]);

        this.children.push(n);
      }
    } else if (this.tag == "KIND:DataConnectorScalarRepresentation") {
      const groupKinds = _.groupBy(j, "dataSource");
      this.children = _.keys(groupKinds)
        .sort()
        .map((g) => {
          const n = new KindTree(
            g,
            "SCALAR_REPRESENTATION",
            "Data Source",
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined
          );
          n.buildJson(groupKinds[g]);
          return n;
        });
    } else if (this.tag == "KIND:AuthConfig") {
      this.children = _.sortBy(j, "name").map((jj) => {
        const description = jj.webhook
          ? `Webhook: ${jj.webhook.webhookUrl}`
          : "jwt";
        return new KindTree(
          "AuthConfig",
          "leaf",
          description,
          vscode.TreeItemCollapsibleState.None,
          jj[__HACK_KIND_DOCUMENT_POSITION]
        );
      });
    } else if (this.tag == "KIND:Relationship") {
      const cs = j.map((jj: any) => {
        return new KindTree(
          `${jj.source}.${jj.name}`,
          "leaf",
          `-> ${jj.target.modelName} ${
            jj.target.relationshipType == "Array" ? "[]" : "{}"
          }`,
          vscode.TreeItemCollapsibleState.None,
          jj[__HACK_KIND_DOCUMENT_POSITION]
        );
      });
      this.children = _.sortBy(cs, "label");
    } else if (_.keys(SIMPLE_KIND_MAPS).includes(this.tag)) {
      const labelProp = SIMPLE_KIND_MAPS[this.tag][0];
      this.children = _.sortBy(j, labelProp).map((jj: any) => {
        return new KindTree(
          jj[labelProp],
          "leaf",
          undefined,
          vscode.TreeItemCollapsibleState.None,
          jj[__HACK_KIND_DOCUMENT_POSITION]
        );
      });
    }
  }

  constructor(
    public readonly label: string,
    public readonly tag: string,
    public readonly description: string | undefined,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly documentPositon: number | undefined
  ) {
    super(label, collapsibleState);
    if (this.documentPositon)
      this.command = {
        command: "hasuraOutline.openJsonSelection",
        title: "",
        arguments: [this.documentPositon],
      };
  }
}

export class JsonOutlineProvider implements vscode.TreeDataProvider<KindTree> {
  private _onDidChangeTreeData: vscode.EventEmitter<KindTree | undefined> =
    new vscode.EventEmitter<KindTree | undefined>();
  readonly onDidChangeTreeData: vscode.Event<KindTree | undefined> =
    this._onDidChangeTreeData.event;

  private hasuraTree: KindTree | undefined = undefined;
  private tree: json.Node | undefined;
  private text = "";
  private editor: vscode.TextEditor | undefined;
  private autoRefresh = true;

  constructor(private context: vscode.ExtensionContext) {
    vscode.window.onDidChangeActiveTextEditor(() =>
      this.onActiveEditorChanged()
    );
    vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChanged(e));
    this.autoRefresh = vscode.workspace
      .getConfiguration("hasuraOutline")
      .get("autorefresh", true);
    vscode.workspace.onDidChangeConfiguration(() => {
      this.autoRefresh = vscode.workspace
        .getConfiguration("hasuraOutline")
        .get("autorefresh", true);
    });
    this.onActiveEditorChanged();
  }

  refresh(node?: KindTree): void {
    this.parseTree();
    if (node) {
      this._onDidChangeTreeData.fire(node);
    } else {
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  private onActiveEditorChanged(): void {
    if (vscode.window.activeTextEditor) {
      if (vscode.window.activeTextEditor.document.uri.scheme === "file") {
        const enabled =
          vscode.window.activeTextEditor.document.languageId === "json" ||
          vscode.window.activeTextEditor.document.languageId === "jsonc";
        vscode.commands.executeCommand(
          "setContext",
          "hasuraOutlineEnabled",
          enabled
        );
        if (enabled) {
          this.refresh();
        }
      }
    } else {
      vscode.commands.executeCommand(
        "setContext",
        "hasuraOutlineEnabled",
        false
      );
    }
  }

  private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent): void {
    if (
      this.tree &&
      this.autoRefresh &&
      changeEvent.document.uri.toString() ===
        this.editor?.document.uri.toString()
    ) {
      this.parseTree();
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  private parseTree(): void {
    this.text = "";
    this.tree = undefined;
    this.editor = vscode.window.activeTextEditor;
    if (this.editor && this.editor.document) {
      this.text = this.editor.document.getText();
      this.tree = json.parseTree(this.text);
      this.hasuraTree = KindTree.createRoot(json.parse(this.text));
    }
  }

  getChildren(node?: KindTree): Thenable<KindTree[]> {
    return Promise.resolve(
      node ? node.children : this.hasuraTree?.children || []
    );
  }

  getTreeItem(node: KindTree): vscode.TreeItem {
    if (!this.tree) {
      throw new Error("Invalid tree");
    }
    if (!this.editor) {
      throw new Error("Invalid editor");
    }

    return node;
  }

  select(kindDocumentPosition: number) {
    if (this.editor && this.tree) {
      const valueNode = json.findNodeAtLocation(this.tree, [
        "metadata",
        kindDocumentPosition,
      ]);
      if (valueNode) {
        const range = new vscode.Range(
          this.editor.document.positionAt(valueNode.offset),
          this.editor.document.positionAt(valueNode.offset + valueNode.length)
        );
        this.editor.selection = new vscode.Selection(range.start, range.end);
        this.editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      }
    }
  }

  private getIcon(node: json.Node): any {
    const nodeType = node.type;
    if (nodeType === "boolean") {
      return {
        light: this.context.asAbsolutePath(
          path.join("resources", "light", "boolean.svg")
        ),
        dark: this.context.asAbsolutePath(
          path.join("resources", "dark", "boolean.svg")
        ),
      };
    }
    if (nodeType === "string") {
      return {
        light: this.context.asAbsolutePath(
          path.join("resources", "light", "string.svg")
        ),
        dark: this.context.asAbsolutePath(
          path.join("resources", "dark", "string.svg")
        ),
      };
    }
    if (nodeType === "number") {
      return {
        light: this.context.asAbsolutePath(
          path.join("resources", "light", "number.svg")
        ),
        dark: this.context.asAbsolutePath(
          path.join("resources", "dark", "number.svg")
        ),
      };
    }
    return null;
  }

  private getLabel(node: json.Node): string {
    if (node.parent?.type === "array") {
      const prefix = node.parent.children?.indexOf(node).toString();
      if (node.type === "object") {
        return prefix + ":{ }";
      }
      if (node.type === "array") {
        return prefix + ":[ ]";
      }
      return prefix + ":" + node.value.toString();
    } else {
      const property = node.parent?.children
        ? node.parent.children[0].value.toString()
        : "";
      if (node.type === "array" || node.type === "object") {
        if (node.type === "object") {
          return "{ } " + property;
        }
        if (node.type === "array") {
          return "[ ] " + property;
        }
      }
      const value = this.editor?.document.getText(
        new vscode.Range(
          this.editor.document.positionAt(node.offset),
          this.editor.document.positionAt(node.offset + node.length)
        )
      );
      return `${property}: ${value}`;
    }
  }
}

/*

"kind": "AuthConfig",


"kind": "HasuraHubDataSource",
"name": "onedb"


"kind": "DataConnectorScalarRepresentation",
"dataSource": "onedb",
"scalarType": "any"


"kind": "Model",
"name": "posts",
...
"dataType": "posts",


"kind": "ModelSelectPermissions",
"modelName": "posts",


"kind": "ObjectType",
"name": "posts"


"kind": "ScalarType",
"name": "any"


"kind": "TypeOutputPermissions",
"typeName": "posts"


"kind": "Relationship",
"name": "user",
...
"source": "posts",
"target": {
  "modelName": "users",
  "relationshipType": "Object"
}

*/

/*

KINDS

  AuthConfig

  HasuraHubDataSource
    onedb (name)

  DataConnectorScalarRepresentation
    onedb (dataSource)
      any (scalarType)

  Model
    posts (name)

  ModelSelectPermissions
    posts (modelName)

  ObjectType
    posts (name)

  ScalarType
    any (name)

  TypeOutputPermissions
    posts (typeName)

  Relationship
    posts.user [posts -> users []] (source.name [source -> target []|{}])

*/
