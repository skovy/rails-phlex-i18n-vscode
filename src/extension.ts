import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
// TODO: remove.
import yaml from "js-yaml";
import { exec } from "child_process";
import { snakeCase } from "lodash";
import YAML from "yaml";

export function activate(context: vscode.ExtensionContext) {
  console.log('"rails-phlex-i18n" is active!');

  const extractToTranslationCommand = vscode.commands.registerCommand(
    "rails-phlex-i18n.extractToTranslation",
    extractToTranslation
  );
  context.subscriptions.push(extractToTranslationCommand);

  const openTranslationCommand = vscode.commands.registerCommand(
    "rails-phlex-i18n.openTranslation",
    openTranslation
  );
  context.subscriptions.push(openTranslationCommand);

  const translationHover = vscode.languages.registerHoverProvider("ruby", {
    provideHover,
  });
  context.subscriptions.push(translationHover);
}

const provideHover: vscode.HoverProvider["provideHover"] = async (
  document,
  position
) => {
  const range = document.getWordRangeAtPosition(
    position,
    /\bt\(\"\.[^"]+\"(.*)\)/
  );
  if (!range) return;

  const text = document.getText(range);
  const match = text.match(/t\(\"\.([^"]+)\"(.*)\)/);
  if (!match) return;

  const key = match[1];
  if (!key) return;

  const translationFilePath = getTranslationFilePath();
  if (!translationFilePath) return;

  const translationPath = await getComputedTranslationPathForCurrentEditor(
    document,
    key
  );

  const lineCounter = new YAML.LineCounter();
  const parsed = YAML.parseDocument<YAML.YAMLMap<YAML.Scalar, YAML.YAMLMap>>(
    fs.readFileSync(translationFilePath, "utf8"),
    {
      keepSourceTokens: true,
      lineCounter,
    }
  );

  const node = findNodeByPath(translationPath, parsed.contents);
  if (!node) return;

  const offset = node?.key.srcToken?.offset;
  const line = lineCounter.linePos(offset!);

  const contents = new vscode.MarkdownString(
    `${
      node?.value?.value
    }\n\n---\n\n[View translation](command:rails-phlex-i18n.openTranslation?${JSON.stringify(
      [line.line - 1, line.col - 1]
    )} "Open key in translations file")`
  );

  contents.supportHtml = true;
  contents.isTrusted = true;

  return new vscode.Hover(contents, range);
};

const openTranslation = async (line: number, column: number) => {
  const translationFilePath = getTranslationFilePath();
  if (!translationFilePath) return;

  await vscode.workspace
    .openTextDocument(translationFilePath)
    .then(async (doc) => {
      const position = new vscode.Position(line, column);
      const options: vscode.TextDocumentShowOptions = {
        selection: new vscode.Range(position, position),
        preview: false,
      };
      await vscode.window.showTextDocument(doc, options);
    });
};

async function extractToTranslation() {
  const editor = getActiveEditor();
  if (!editor) return;

  const workspacePath = getWorkspacePath();
  if (!workspacePath) return;

  const translationFilePath = getTranslationFilePath();
  if (!translationFilePath) return;

  const translations = YAML.parse(
    fs.readFileSync(translationFilePath, "utf8"),
    { keepSourceTokens: true }
  ) as Record<string, any>;

  const selections = editor.selections;
  for (const selection of selections) {
    const document = editor.document;
    const text = document
      .getText(selection)
      // Trim leading and trailing quotes.
      ?.replace(/^\s*"(.*)$/, "$1")
      ?.replace(/(.*)"\s*$/, "$1");

    if (!text) {
      vscode.window.showErrorMessage(
        "No text selected. Please select text to extract."
      );
      return;
    }

    const key = await vscode.window.showInputBox({
      title: "Provide a key for the translation",
      value: snakeCase(text),
    });
    if (!key) {
      vscode.window.showErrorMessage("No key provided. Please provide a key.");
      return;
    }

    const translationPath = await getComputedTranslationPathForCurrentEditor(
      document,
      key
    );

    translationPath.reduce((acc, key, index) => {
      if (index === translationPath.length - 1) {
        acc[key] = text;
      } else {
        acc[key] = acc[key] || {};
      }

      return acc[key];
    }, translations);

    const translation = `t(".${key}")`;
    await editor.edit((editBuilder) => {
      editBuilder.replace(selection, translation);
    });
  }

  fs.writeFileSync(translationFilePath, yaml.dump(translations));
  await editor.document.save();

  exec("bundle exec i18n-tasks normalize", { cwd: workspacePath }, (error) => {
    if (error) {
      vscode.window.showErrorMessage(
        `Error running i18n-tasks normalize: ${error.message}`
      );
      return;
    }
  });
}

// ================
// Helper functions
// ================

const getActiveEditor = () => {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showErrorMessage(
      "No active text editor found. Please open a file and select text to extract."
    );
  }

  return editor;
};

const getWorkspacePath = () => {
  const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.path;

  if (!workspacePath) {
    vscode.window.showErrorMessage(
      "No workspace folder found. Please open a workspace and try again."
    );
  }

  return workspacePath;
};

const getTranslationFilePath = () => {
  const workspacePath = getWorkspacePath();

  if (workspacePath) return path.join(workspacePath, "config/locales/en.yml");
};

/**
 * Recursively find a node in a YAML AST by a given "path" of keys.
 *
 * For example, given the following YAML:
 *
 * ```yaml
 * en:
 *  users:
 *    title: "Users"
 * ```
 *
 * The path `["en", "users", "title"]` would return the node with the value `"Users"`.
 */
const findNodeByPath = (
  keys: string[],
  value: YAML.YAMLMap<YAML.Scalar, YAML.YAMLMap | YAML.Scalar> | null
): YAML.Pair<YAML.Scalar, YAML.Scalar> | undefined => {
  const [first, ...rest] = keys;

  const currentItem = value?.items.find((item) => item.key.value === first);

  if (rest.length === 0) {
    return currentItem as YAML.Pair<YAML.Scalar, YAML.Scalar>;
  } else {
    return findNodeByPath(
      rest,
      currentItem?.value as YAML.YAMLMap<YAML.Scalar, YAML.YAMLMap>
    );
  }
};

/**
 * Compute the translation path based on the current file's path and assumptions around Rails.
 */
const getComputedTranslationPathForCurrentEditor = async (
  document: vscode.TextDocument,
  key: string
) => {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) return [];

  const appControllersPath = path.join(workspacePath, "app/controllers");
  const appViewsPath = path.join(workspacePath, "app/views");

  // Get the relative path of the current file from the 'app/views/' directory
  const filePath = document.uri.fsPath;

  // Compute the key based on the relative path of the current file.
  let computedPath;
  if (filePath.startsWith(appControllersPath)) {
    // Conntrollers.
    const relativePath = path.parse(
      path.relative(appControllersPath, filePath)
    );

    // TODO: can we infer this from LSP/AST?
    const controllerAction = await vscode.window.showInputBox({
      title: "What is the controller action name?",
    });
    if (!controllerAction) {
      vscode.window.showErrorMessage(
        "No controller action provided. Please provide a controller action."
      );
      return [];
    }

    computedPath = path
      .join(relativePath.dir, relativePath.name.replace("_controller", ""))
      .split(path.sep)
      .concat(controllerAction);
  } else if (filePath.startsWith(appViewsPath)) {
    // Phlex views.
    const relativePath = path.parse(path.relative(appViewsPath, filePath));
    computedPath = path
      .join(relativePath.dir, relativePath.name)
      .split(path.sep);
  } else {
    vscode.window.showErrorMessage(
      "The current file is not in the 'app/views/' or 'app/controllers/' directory. Please open a file from the 'app/views/' or 'app/controllers/' directory."
    );
    return [];
  }

  return ["en", ...computedPath, ...key.split(".")];
};

export function deactivate() {}
