// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import { CollectionsProvider, CollectionTreeItem } from "./collectionsProvider";
import axios from "axios";
import * as https from "https";
import { RequestOptions } from "../webview/features/requestOptions/requestOptionsSlice";

function createRequestPanel(
  context: vscode.ExtensionContext,
  collectionsProvider: CollectionsProvider,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  savedRequest?: any,
) {
  const webviewContent = fs
    .readFileSync(
      vscode.Uri.joinPath(context.extensionUri, "dist/index.html").fsPath,
      { encoding: "utf-8" },
    )
    .replace(
      "styleUri",
      vscode.Uri.joinPath(context.extensionUri, "/dist/main.css")
        .with({ scheme: "vscode-resource" })
        .toString(),
    )
    .replace(
      "scriptUri",
      vscode.Uri.joinPath(context.extensionUri, "/dist/webview.js")
        .with({ scheme: "vscode-resource" })
        .toString(),
    );

  const panel = vscode.window.createWebviewPanel(
    "postcode",
    savedRequest
      ? `${savedRequest.name} - Postcode Collections`
      : "Create Request - Postcode Collections",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    },
  );

  panel.webview.html = webviewContent;
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "icons/icon.png");

  // If we have a saved request, send it to the webview to populate the form
  if (savedRequest) {
    panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.type === "webview-ready") {
          panel.webview.postMessage({
            type: "load-request",
            request: savedRequest,
          });
        }
      },
      undefined,
      context.subscriptions,
    );
  }

  // Handle HTTP requests from webview
  panel.webview.onDidReceiveMessage(
    ({ method, url, headers, body, auth, options, type, requestData }) => {
      if (type === "save-request") {
        // Handle save request command
        vscode.commands.executeCommand("postcode.saveRequest", requestData);
        return;
      }

      // Handle HTTP request (existing logic)
      const requestOptions = options as RequestOptions;
      let requestStartedAt: number, responseDuration: number;

      if (!url) {
        panel.webview.postMessage({
          type: "response",
          error: { message: "Request URL is empty" },
        });
        vscode.window.showInformationMessage("Request URL is empty");
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const headersObj: any = {};

      if (auth.type === "bearer") {
        headersObj["Authorization"] = `Bearer ${auth.bearer.token}`;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headers.forEach(({ key, value, disabled }: any) => {
        if (!disabled) {
          headersObj[key] = value;
        }
      });

      let data = "";
      if (body.mode === "formdata") {
        const dataObj = new URLSearchParams();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body.formdata.forEach(({ key, value, disabled }: any) => {
          if (!disabled) {
            dataObj.append(key, value);
          }
        });
        data = dataObj.toString();
        headersObj["Content-Type"] = "multipart/form-data";
      } else if (body.mode === "urlencoded") {
        const dataObj = new URLSearchParams();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body.urlencoded.forEach(({ key, value, disabled }: any) => {
          if (!disabled) {
            dataObj.append(key, value);
          }
        });
        data = dataObj.toString();
        headersObj["Content-Type"] = "application/x-www-form-urlencoded";
      } else if (body.mode === "raw") {
        data = body.raw;
        headersObj["Content-Type"] = {
          json: "application/json",
          html: "text/html",
          xml: "text/xml",
          text: "text/plain",
        }[body.options.raw.language];
      } else if (body.mode === "file") {
        data = body.fileData;
        headersObj["Content-Type"] = "application/octet-stream";
      } else if (body.mode === "graphql") {
        data = JSON.stringify({
          query: body.graphql.query,
          variables: body.graphql.variables,
        });
        headersObj["Content-Type"] = "application/json";
      }

      // Handle HTTP request with axios (existing logic)
      https.globalAgent.options.rejectUnauthorized =
        requestOptions.strictSSL === "yes";

      axios.interceptors.request.use((config) => {
        requestStartedAt = new Date().getTime();
        return config;
      });

      axios.interceptors.response.use((config) => {
        responseDuration = new Date().getTime() - requestStartedAt;
        return config;
      });

      axios({
        method,
        url,
        baseURL: "",
        data: data,
        headers: headersObj,
        auth: auth.type === "basic" ? auth.basic : undefined,
        transformResponse: [(data) => data],
        responseType: "text",
        validateStatus: () => true,
      })
        .then((resp) =>
          panel.webview.postMessage({
            type: "response",
            data: resp.data,
            status: resp.status,
            statusText: resp.statusText,
            headers: resp.headers,
            duration: responseDuration,
          }),
        )
        .catch((err) => {
          panel.webview.postMessage({
            type: "response",
            error: err,
          });
          vscode.window.showInformationMessage("Error: Could not send request");
        });
    },
    undefined,
    context.subscriptions,
  );
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Initialize collections provider
  const collectionsProvider = new CollectionsProvider(context);
  vscode.window.registerTreeDataProvider(
    "postcode.collections",
    collectionsProvider,
  );

  // Register collections commands
  const createCollectionCommand = vscode.commands.registerCommand(
    "postcode.createCollection",
    async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Enter collection name",
        placeHolder: "My Collection",
      });
      if (name) {
        await collectionsProvider.createCollection(name);
      }
    },
  );

  const deleteCollectionCommand = vscode.commands.registerCommand(
    "postcode.deleteCollection",
    async (item: CollectionTreeItem) => {
      const confirm = await vscode.window.showWarningMessage(
        `Delete collection "${item.label}" and all its requests?`,
        "Delete",
        "Cancel",
      );
      if (confirm === "Delete") {
        await collectionsProvider.deleteCollection(item.itemId);
      }
    },
  );

  const deleteRequestCommand = vscode.commands.registerCommand(
    "postcode.deleteRequest",
    async (item: CollectionTreeItem) => {
      const confirm = await vscode.window.showWarningMessage(
        `Delete request "${item.label}"?`,
        "Delete",
        "Cancel",
      );
      if (confirm === "Delete") {
        await collectionsProvider.deleteRequest(item.itemId);
      }
    },
  );

  const renameItemCommand = vscode.commands.registerCommand(
    "postcode.renameItem",
    async (item: CollectionTreeItem) => {
      const newName = await vscode.window.showInputBox({
        prompt: `Rename ${item.itemType}`,
        value: item.label as string,
      });
      if (newName && newName !== item.label) {
        await collectionsProvider.renameItem(
          item.itemId,
          item.itemType,
          newName,
        );
      }
    },
  );

  const loadRequestCommand = vscode.commands.registerCommand(
    "postcode.loadRequest",
    async (item: CollectionTreeItem) => {
      const request = collectionsProvider.getRequest(item.itemId);
      if (request) {
        // Create a new webview panel with the loaded request
        createRequestPanel(context, collectionsProvider, request);
      }
    },
  );

  const saveRequestCommand = vscode.commands.registerCommand(
    "postcode.saveRequest",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (requestData: any) => {
      const collections = collectionsProvider.getCollections();
      if (collections.length === 0) {
        vscode.window.showWarningMessage(
          "No collections found. Create a collection first.",
        );
        return;
      }

      const collectionItems = collections.map((c) => ({
        label: c.name,
        id: c.id,
      }));
      const selectedCollection = await vscode.window.showQuickPick(
        collectionItems,
        {
          placeHolder: "Select a collection to save the request to",
        },
      );

      if (selectedCollection) {
        const requestName = await vscode.window.showInputBox({
          prompt: "Enter request name",
          placeHolder: "My Request",
        });

        if (requestName) {
          await collectionsProvider.saveRequest(
            { ...requestData, name: requestName },
            selectedCollection.id,
          );
          vscode.window.showInformationMessage(
            `Request "${requestName}" saved successfully!`,
          );
        }
      }
    },
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    "postcode.createRequest",
    () => {
      // The code you place here will be executed every time your command is executed
      vscode.window.showInformationMessage(
        "Welcome to Postcode Collections (Community)!",
      );
      createRequestPanel(context, collectionsProvider);
    },
  );

  context.subscriptions.push(
    disposable,
    createCollectionCommand,
    deleteCollectionCommand,
    deleteRequestCommand,
    renameItemCommand,
    loadRequestCommand,
    saveRequestCommand,
  );
}

// this method is called when your extension is deactivated
// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() {}
