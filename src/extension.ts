import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";

import { snakeCase } from "lodash";

export function activate(context: vscode.ExtensionContext) {
  console.log('"rails-phlex-i18n" is active!');

  let disposable = vscode.commands.registerCommand(
    "rails-phlex-i18n.extractToTranslation",
    extractToTranslation
  );

  context.subscriptions.push(disposable);
}

async function extractToTranslation() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage(
      "No active text editor found. Please open a file and select text to extract."
    );
    return;
  }

  const selection = editor.selection;
  const document = editor.document;
  const text = document
    .getText(selection)
	// Trim leading and trailing quotes.
    ?.replace(/^"(.*)$/, "$1")
    ?.replace(/(.*)"$/, "$1");

  if (!text) {
    vscode.window.showErrorMessage(
      "No text selected. Please select text to extract."
    );
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.path;
  if (!workspacePath) {
    vscode.window.showErrorMessage(
      "No workspace folder found. Please open a workspace and try again."
    );
    return;
  }

  const translationFilePath = path.join(workspacePath, "config/locales/en.yml");
  const translations = yaml.load(
    fs.readFileSync(translationFilePath, "utf8")
  ) as Record<string, any>;

  const key = await vscode.window.showInputBox({
    title: "Provide a key for the translation",
    value: snakeCase(text),
  });
  if (!key) {
    vscode.window.showErrorMessage("No key provided. Please provide a key.");
    return;
  }

  // Get the relative path of the current file from the 'app/views/' directory
  const filePath = document.uri.fsPath;
  const relativePath = path.parse(
    path.relative(path.join(workspacePath, "app/views"), filePath)
  );
  const computedPath = path
    .join(relativePath.dir, relativePath.name)
    .split(path.sep);
  const translationPath = ["en", ...computedPath, key];

  translationPath.reduce((acc, key, index) => {
    if (index === translationPath.length - 1) {
      acc[key] = text;
    } else {
      acc[key] = acc[key] || {};
    }

    return acc[key];
  }, translations);

  fs.writeFileSync(translationFilePath, yaml.dump(translations));

  const translation = `t(".${key}")`;
  editor.edit((editBuilder) => {
    editBuilder.replace(selection, translation);
  });
}

export function deactivate() {}
