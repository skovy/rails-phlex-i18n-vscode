# 💎🌐 Rails Phlex I18n

Rails Phlex I18n is a VSCode extension to make working with translations in a Rails app built with Phlex views less painful, and more fun!

It helps extract existing strings from Rails Phlex views into the translations files, displays a preview of the translation on hover, and links directly to the translation key.

Read more in this blog post: [Rails Phlex I18n: A VSCode Extension](https://www.skovy.dev/blog/rails-phlex-i18n-vscode-extension). 

## Demo

![demo](/assets/demo.gif)

## Features

- Support for `app/views` and `app/controllers` using relative keys.
  - The relevant translation path is inferred based on the files relative path to `app/views` and `app/controllers` and follows conventions.
  - The relevant controller action is inferred from the nearest function, which works most of the time.
- Multiple selection/cursor support to replace multiple string at once for bulk translating existing strings in files.
- Hover tooltip to display the value of a given translation key to make it easy to know the exact copy and intent.
- Quicklink to open the relevant translation key in the translation file.
- Auto-formatting based on `i18n-tasks normalize` for consistent formatting.

## Requirements

- `i18n-tasks` gem installed for formatting and providing a consistent `en.yml` file.
