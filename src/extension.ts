import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
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

  const usageHover = vscode.languages.registerHoverProvider("yaml", {
    provideHover: yamlProvideHover,
  });
  context.subscriptions.push(usageHover);
}

const provideHover: vscode.HoverProvider["provideHover"] = async (
  document,
  position
) => {
  const range = getRangeFromTextPosition(document, position);
  if (!range) return;

  const text = document.getText(range);

  const match = text.match(/t\(\s*\"\.([^"]+)\"[^\)]*\)/);
  if (!match) return;

  const key = match[1];
  if (!key) return;

  const translationFilePath = getTranslationFilePath();
  if (!translationFilePath) return;

  const translationPath = await getComputedTranslationPathForCurrentEditor(
    document,
    range.start,
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
    `${getNodeContent(
      node
    )}\n\n---\n\n[View translation](command:rails-phlex-i18n.openTranslation?${JSON.stringify(
      [line.line - 1, line.col - 1]
    )} "Open key in translations file")`
  );

  contents.supportHtml = true;
  contents.isTrusted = true;

  return new vscode.Hover(contents, range);
};

const yamlProvideHover: vscode.HoverProvider["provideHover"] = async (
  document,
  position
) => {
  const translationFilePath = getTranslationFilePath();
  if (!translationFilePath) return;

  // Only show the hover for the translations file.
  if (document.uri.fsPath !== translationFilePath) return;

  const { keyPath, isScalar } = getKeyPathAtPosition(document, position);

  // Only show the hover if we found a matching key.
  if (!keyPath) return;

  // Strip the "en" prefix since it's not used for anything in practice.
  const [_en, ...absoluteKey] = keyPath;

  // Scalar means the key contains a string value (not another map).
  // If it's not a scalar, it could be a key in a file or a file so we don't show the hover.
  if (!isScalar) return;

  const workspacePath = getWorkspacePath();
  if (!workspacePath) return;

  const currentKeyPathAndFile = [...absoluteKey];
  let foundFilePath: string | null = null;
  while (currentKeyPathAndFile.length > 0) {
    const fileName = currentKeyPathAndFile.pop();
    const viewFilePath = path.join(
      workspacePath,
      "app/views",
      ...currentKeyPathAndFile,
      `${fileName}.rb`
    );

    if (fs.existsSync(viewFilePath)) {
      foundFilePath = viewFilePath;
      break;
    }

    const controllerFilePath = path.join(
      workspacePath,
      "app/controllers",
      ...currentKeyPathAndFile,
      `${fileName}_controller.rb`
    );

    if (fs.existsSync(controllerFilePath)) {
      foundFilePath = controllerFilePath;
      break;
    }
  }

  if (!foundFilePath) return;

  const relativeFilePath = path.relative(workspacePath, foundFilePath);
  const contents = new vscode.MarkdownString(
    `Absolute key: \`${absoluteKey.join(
      "."
    )}\`\n\nFile path: \`${relativeFilePath}\`\n\n---\n\n[Open file](command:vscode.open?${JSON.stringify(
      [vscode.Uri.file(foundFilePath)]
    )} "Open file")`
  );

  contents.supportHtml = true;
  contents.isTrusted = true;

  return new vscode.Hover(contents);
};

function getKeyPathAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): { keyPath: string[] | null; isScalar: boolean } {
  const text = document.getText();
  const yamlDoc = YAML.parseDocument(text);

  const keyPath: string[] = [];
  let isScalar: boolean = false;

  function traverse(node: any, currentPath: string[] = []): boolean {
    if (YAML.isMap(node)) {
      for (const item of node.items) {
        if (YAML.isPair<YAML.Scalar<string>, YAML.Node>(item)) {
          const key = item.key;
          const value = item.value;
          const newPath = [...currentPath, key.value];

          // When the key range contains the position that means we've found the exact node.
          // We can stop traversing and return the path.
          if (
            key &&
            key.range &&
            key.range[0] <= document.offsetAt(position) &&
            key.range[1] >= document.offsetAt(position)
          ) {
            keyPath.push(key.value);
            isScalar = YAML.isScalar(value);
            return true;
          }

          // Otherwise, check to see if this node's value range contains the position.
          if (
            value &&
            value.range &&
            value.range[0] <= document.offsetAt(position) &&
            value.range[1] >= document.offsetAt(position)
          ) {
            keyPath.push(key.value);

            return traverse(value, newPath);
          }
        }
      }
    }

    return false;
  }

  if (traverse(yamlDoc.contents)) {
    return { keyPath, isScalar };
  }

  return { keyPath: null, isScalar: false };
}

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
      selection.start,
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

  fs.writeFileSync(
    translationFilePath,
    YAML.stringify(translations, {
      schema: "yaml-1.1",
    })
  );
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
):
  | YAML.Pair<YAML.Scalar, YAML.Scalar | YAML.YAMLMap<YAML.Scalar, YAML.Scalar>>
  | undefined => {
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
 * Given a YAML node, return the content as a string.
 *
 * This handles "leaf" nodes (scalars) and "branch" nodes (maps).
 */
const getNodeContent = (
  node: YAML.Pair<
    YAML.Scalar,
    YAML.Scalar | YAML.YAMLMap<YAML.Scalar, YAML.Scalar>
  >
) => {
  if (!node.value) return;

  if ("items" in node.value && node.value?.items?.length > 0) {
    return node.value.items
      .map((item) => {
        return `- \`${item.key.value}\`: ${item.value?.value}`;
      })
      .join("\n");
  } else if ("value" in node.value) {
    return node.value.value;
  }
};

/**
 * Compute the translation path based on the current file's path and assumptions around Rails.
 */
const getComputedTranslationPathForCurrentEditor = async (
  document: vscode.TextDocument,
  position: vscode.Position,
  key: string
) => {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) return [];

  const appControllersPath = path.join(workspacePath, "app/controllers");
  const appViewsPath = path.join(workspacePath, "app/views");
  const specViewsPath = path.join(workspacePath, "spec/views");

  // Get the relative path of the current file from the 'app/views/' directory
  const filePath = document.uri.fsPath;

  // Compute the key based on the relative path of the current file.
  let computedPath;
  if (filePath.startsWith(appControllersPath)) {
    // Conntrollers.
    const relativePath = path.parse(
      path.relative(appControllersPath, filePath)
    );

    // First try to infer the controller action from the current file.
    // Then fallback to asking the user for the controller action.
    let controllerAction = getControllerAction(document, position);
    if (!controllerAction) {
      controllerAction = await vscode.window.showInputBox({
        title: "What is the controller action name?",
      });
    }
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
  } else if (filePath.startsWith(specViewsPath)) {
    // View specs.
    const relativePath = path.parse(path.relative(specViewsPath, filePath));
    computedPath = path
      .join(relativePath.dir, relativePath.name.replace("_spec", ""))
      .split(path.sep);
  } else {
    vscode.window.showErrorMessage(
      "The current file is not in the 'app/views/', 'spec/views/', or 'app/controllers/' directory."
    );
    return [];
  }

  return ["en", ...computedPath, ...key.split(".")];
};

const TRANSLATION_REGEX = /t\(\s*\"\.([^"]+)\"[^\)]*\)/g;

function getRangeFromTextPosition(
  document: vscode.TextDocument,
  position: vscode.Position
) {
  // There is also the `document.getWordRangeAtPosition` helper,
  // but it doesn't work well when the translation is on multiple lines.
  const text = document.getText();

  let match;
  while ((match = TRANSLATION_REGEX.exec(text)) !== null) {
    const startPos = document.positionAt(match.index);
    const endPos = document.positionAt(match.index + match[0].length);

    // There could be multiple matches in the same file,
    // so we need to check if the position is within the range.
    if (startPos.isBeforeOrEqual(position) && endPos.isAfterOrEqual(position)) {
      return new vscode.Range(startPos, endPos);
    }
  }

  return null;
}

function getControllerAction(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  const line = position.line;

  for (let i = line; i >= 0; i--) {
    const lineText = document.lineAt(i).text.trim();
    const match = lineText.match(/^def\s+(\w+)/);
    if (match) {
      return match[1];
    }
  }
}

export function deactivate() {}
