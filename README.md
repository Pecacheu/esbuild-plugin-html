# @pecacheu/esbuild-plugin-html
[![npm](https://img.shields.io/npm/v/@pecacheu/esbuild-plugin-html?color=green&style=flat-square)](https://www.npmjs.com/package/@pecacheu/esbuild-plugin-html)

![Simple banner containing the name of the project in a html self-closing tag](.github/banner.png)

`@pecacheu/esbuild-plugin-html` is a plugin to generate HTML files with
[esbuild](https://esbuild.github.io/).  All specified entry points, and their
related files (such as `.css`-files) are automatically injected into the HTML
file.  `@pecacheu/esbuild-plugin-html` is inspired by
[jantimon/html-webpack-plugin](https://github.com/jantimon/html-webpack-plugin).

Is any feature missing? 
[Please create a ticket.](https://github.com/craftamap/esbuild-plugin-html/issues/new)

# Fork details
This is a fork of [@craftamap/esbuild-plugin-html](https://github.com/craftamap/esbuild-plugin-html) with a few helpful additions, namely:
- feat: Make entryPoints default to esbuild entryPoints option
- feat: Automatically watch HTML files for changes
- feat: Add appendHead/appendBody (for use in place of `template` when loading from a file but adding extras)
- feat: Automatically include assets from img, object, and link tags
- fix: Dependency conflict & typo

> [!TIP]
> For a build script that implements this plugin with sensible defaults and easy configuration for your web app or other esbuild project, have a look at [the RaiUtils package's Build module](https://www.npmjs.com/package/raiutils).

## Requirements

This plugin requires at least `esbuild` v0.12.26. The minimum node version
supported is Node.js 18. 

Deno is officially not supported - however, it has been reported that the plugin
does work with Deno.

## Installation

```bash
yarn add -D @pecacheu/esbuild-plugin-html
# or
npm install --save-dev @pecacheu/esbuild-plugin-html
```

## Usage

This plugin works by analyzing the
[`metafile`](https://esbuild.github.io/api/#metafile) esbuild provides. This
metafile contains information about all entryPoints and their output files.
This way, this plugin can map input files to their output file (javascript as
well as css).

`esbuild-plugin-html` uses the [jsdom](https://github.com/jsdom/jsdom)
under the hood to create a model of your HTML from the provided template. In
this model, all discovered resources are injected. The plugin also uses [lodash
templates](https://lodash.com/docs/4.17.15#template) to insert custom user
data into the template.

`esbuild-plugin-html` requires to have some options set in your
esbuild script:

- `outdir` must be set. The html files are generated within the `outdir`.
- `metafile` must be set to `true` (the plugin does this automatically, if it's
  not set to `false` on purpose).

⚠️: you can set a specific output name for resources using esbuild's
`entryNames` feature. While this plugin tries to support this as best as it
can, it may or may not work reliable. If you encounter any issues with it, 
[please create a ticket.](https://github.com/craftamap/esbuild-plugin-html/issues/new)

### Sample Configuration

```js
const esbuild = require('esbuild');
const { htmlPlugin } = require('@pecacheu/esbuild-plugin-html');

const options = {
    entryPoints: ['src/index.jsx'],
    bundle: true,
    metafile: true, // will be set for you
    outdir: 'dist/', // needs to be set
    plugins: [
        htmlPlugin({
            files: [
                {
                    // defaults to options.entryPoints
                    entryPoints: [
                        'src/index.jsx',
                    ],
                    filename: 'index.html',
                    htmlTemplate: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body>
                <div id="root">
                </div>
            </body>
            </html>
          `,
                },
                {
                    entryPoints: [
                        'src/auth/auth.jsx',
                    ],
                    filename: 'auth.html',
                    title: 'Login',
                    scriptLoading: 'module',
                    favicon: './public/favicon.ico',
                    hash: true,
                },
                {
                    entryPoints: [
                        'src/installation/installation.jsx',
                    ],
                    filename: 'installation.html',
                    title: 'title',
                    scriptLoading: 'module',
                    define: {
                        "version": "0.3.0",
                    },
                    htmlTemplate: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body>
                You are using version <%- define.version %>
                <div id="root">
                </div>
            </body>
            </html>
          `,
                },
            ]
        })
    ]
}

esbuild.build(options).catch(() => process.exit(1))
```

### Configuration Options

```ts
interface Configuration {
    files: HtmlFileConfiguration[],
}

interface HtmlFileConfiguration {
    /** Output filename, eg. index.html (relative to the output directory) */
    filename: string,
    /** Entry points to inject into the HTML, eg. ['src/index.jsx'] */
    entryPoints?: string[],
    /** Optional title to inject into head */
    title?: string,
    /** HTML template string. Defaults to a blank template, unless `htmlFile` is set */
    htmlTemplate?: string,
    /** Read the template from an HTML file on disk instead of `htmlTemplate` */
    htmlFile?: string,
    /** A map of custom variable definitions for lodash */
    define?: Record<string, string>,
    /** How to load injected script tags. Defaults to defer */
    scriptLoading?: 'blocking' | 'defer' | 'module',
    /** Optional favicon to inject into head */
    favicon?: string,
    /** Whether to find related output CSS files and inject them into the HTML.
     * Defaults to true */
    findRelatedCssFiles?: boolean,
    /** Whether to find output files that are related to the entry points
     * @deprecated Use `findRelatedCssFiles` instead */
    findRelatedOutputFiles?: boolean,
    /** Inline content of JS files, CSS files, or both */
    inline?: boolean | {
        css?: boolean
        js?: boolean
    } | ((filepath: string) => boolean),
    /** Extra script tags to include in the HTML file */
    extraScripts?: (string | {
        src: string,
        attrs?: { [key: string]: string }
    })[],
    /** Extra HTML to append to the document head */
    appendHead?: string,
    /** Extra HTML to prepend to the document body */
    prependBody?: string,
    /** Extra HTML to append to the document body */
    appendBody?: string,
    hash?: boolean | string,
}
```

In case a `publicPath` is specified in the esbuild configuration,
`esbuild-plugin-html` will use absolute paths with the provided `publicPath`.

You can also change the verbosity of the plugin by changing esbuild's verbosity.

#### Default HTML template

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
  </body>
</html>
```

## Contributing

Contributions are always welcome. 

Currently `tsc` is used to build the project.

Commits should be messaged according to [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## Kudos: Other `*.html`-Plugins

There exist some other `*.html`-plugins for esbuild. Those work differently
than `esbuild-plugin-html`, and might be a better fit for you:

- [@esbuilder/html](https://www.npmjs.com/package/@esbuilder/html) -
  loader-based approach (use `*.html`-file as entry point, and start
  subprocesses with `esbuild`)
- [@chialab/esbuild-plugin-html](https://www.npmjs.com/package/@chialab/esbuild-plugin-html)
  - loader-based approach