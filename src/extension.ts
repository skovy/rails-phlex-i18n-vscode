import * as vscode from "vscode";
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
  const text = editor.document.getText(selection);
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

  const translation = `t(."${key}")`;
  editor.edit((editBuilder) => {
    editBuilder.replace(selection, translation);
  });
}

export function deactivate() {}
