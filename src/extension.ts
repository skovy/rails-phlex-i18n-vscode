import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { exec } from "child_process";
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
        return;
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
      return;
    }

    const translationPath = ["en", ...computedPath, ...key.split(".")];

    translationPath.reduce((acc, key, index) => {
      if (index === translationPath.length - 1) {
        acc[key] = text;
      } else {
        acc[key] = acc[key] || {};
      }

      return acc[key];
    }, translations);

    const translation = `t(".${key}")`;
    editor.edit((editBuilder) => {
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

export function deactivate() {}
