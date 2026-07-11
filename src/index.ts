import crypto from 'crypto'
import esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import { JSDOM } from 'jsdom'
import lodashTemplate from 'lodash/template'

export interface Configuration {
    files: HtmlFileConfiguration[],
}

export interface HtmlFileConfiguration {
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

type AssetList = {[k: string]: {
    dest: string
    htmlFile: string
}}

const defaultHtmlTemplate =
`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
  </body>
</html>`

const REGEXES = {
    DIR_REGEX: '(?<dir>\\S+\\/?)',
    HASH_REGEX: '(?<hash>[A-Z2-7]{8})',
    NAME_REGEX: '(?<name>[^\\s\\/]+)',
}

// This function joins a path, and in case of windows, it converts backward slashes ('\') forward slashes ('/').
function posixJoin(...paths: string[]): string {
    const joined = path.join(...paths)
    if (path.sep === '/') {
        return joined
    }
    return joined.split(path.sep).join(path.posix.sep)
}

function escapeRegExp(text: string): string {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
}

function appendHtmlStr(el: HTMLElement, html: string, pre = false) {
    const doc = new JSDOM(html).window.document
    el[pre ? 'prepend': 'append'](...doc.head.children, ...doc.body.children)
}

export const htmlPlugin = (configuration: Configuration = { files: [], }): esbuild.Plugin => {
    let logInfo = false

    function collectEntrypoints(build: esbuild.PluginBuild, htmlFileConfiguration: HtmlFileConfiguration, metafile?: esbuild.Metafile) {
        if (!metafile) throw new Error('metafile is missing!')
        const initEntryPts = (htmlFileConfiguration.entryPoints ?? build.initialOptions.entryPoints as string[])
            .map(ep => ep.replace(/\\/g, '/'))

        // Flatten the output, instead of returning an array, let's return an object that contains the path of the output file as path
        const entryPoints = Object.entries(metafile?.outputs || {}).filter(([, value]) => value.entryPoint
            && initEntryPts.includes(value.entryPoint)).map(out => ({ path: out[0], ...out[1] }))

        if (entryPoints.length < initEntryPts.length) {
            for (const htmlFileEntry of initEntryPts) if (!entryPoints.some(ep => ep.entryPoint === htmlFileEntry))
                console.log(`⚠️ for "${htmlFileConfiguration.filename}", entrypoint "${htmlFileEntry}" was requested, but not found.`)
        }

        return entryPoints
    }

    function findNameRelatedOutputFiles(entrypoint: { path: string }, metafile?: esbuild.Metafile, entryNames?: string) {
        const pathOfMatchedOutput = path.parse(entrypoint.path)

        // Search for all files that are "related" to the output (.css and map files, for example files, as assets are dealt with otherwise).
        if (entryNames) {
            // If entryNames is set, the related output files are more difficult to find, as the filename can also contain a hash.
            // The hash could also be part of the path, which could make it even more difficult
            // We therefore try to extract the dir, name and hash from the "main"-output, and try to find all files with
            // the same [name] and [dir].
            // This should always include the "main"-output, as well as all relatedOutputs
            const joinedPathOfMatch = posixJoin(pathOfMatchedOutput.dir, pathOfMatchedOutput.name)
            const findVariablesRegexString = escapeRegExp(entryNames)
                .replace('\\[hash\\]', REGEXES.HASH_REGEX)
                .replace('\\[name\\]', REGEXES.NAME_REGEX)
                .replace('\\[dir\\]', REGEXES.DIR_REGEX)
            const findVariablesRegex = new RegExp(findVariablesRegexString)
            const match = findVariablesRegex.exec(joinedPathOfMatch)

            const name = match?.groups?.['name']
            const dir = match?.groups?.['dir']

            return Object.entries(metafile?.outputs || {}).filter(([pathOfCurrentOutput,]) => {
                if (entryNames) {
                    // if a entryName is set, we need to parse the output filename, get the name and dir,
                    // and find files that match the same criteria
                    const findFilesWithSameVariablesRegexString = escapeRegExp(entryNames.replace('[name]', name ?? '').replace('[dir]', dir ?? ''))
                        .replace('\\[hash\\]', REGEXES.HASH_REGEX)
                    const findFilesWithSameVariablesRegex = new RegExp(findFilesWithSameVariablesRegexString)
                    return findFilesWithSameVariablesRegex.test(pathOfCurrentOutput)
                }
            }).map(outputData => {
                // Flatten the output, instead of returning an array, let's return an object that contains the path of the output file as path
                return { path: outputData[0], ...outputData[1] }
            })
        } else {
            // If entryNames is not set, the related files are always next to the "main" output, and have the same filename, but the extension differs
            return Object.entries(metafile?.outputs || {}).filter(([key,]) => {
                return path.parse(key).name === pathOfMatchedOutput.name && path.parse(key).dir === pathOfMatchedOutput.dir
            }).map(outputData => {
                // Flatten the output, instead of returning an array, let's return an object that contains the path of the output file as path
                return { path: outputData[0], ...outputData[1] }
            })
        }
    }

    async function renderTemplate({ htmlTemplate, htmlFile, define }: HtmlFileConfiguration) {
        const template = htmlFile
            ? await fs.readFile(htmlFile, {encoding: 'utf8'})
            : htmlTemplate || defaultHtmlTemplate

        const compiledTemplateFn = lodashTemplate(template, { interpolate: /<%=([\s\S]+?)%>/g })
        return compiledTemplateFn({ define })
    }

    // use the same joinWithPublicPath function as esbuild:
    //  https://github.com/evanw/esbuild/blob/a1ff9d144cdb8d50ea2fa79a1d11f43d5bd5e2d8/internal/bundler/bundler.go#L533
    function joinWithPublicPath(publicPath: string, relPath: string) {
        relPath = path.normalize(relPath)

        if (!publicPath) {
            publicPath = '.'
        }

        let slash = '/'
        if (publicPath.endsWith('/')) {
            slash = ''
        }
        return `${publicPath}${slash}${relPath}`
    }

    async function injectFiles(dom: JSDOM, assets: { path: string }[], outDir: string, publicPath: string | undefined, htmlFileConfiguration: HtmlFileConfiguration, foundAssets: AssetList) {
        const document = dom.window.document
        if(htmlFileConfiguration.appendBody) appendHtmlStr(document.body, htmlFileConfiguration.appendBody)
        for (const script of htmlFileConfiguration?.extraScripts || []) {
            const scriptTag = document.createElement('script')
            if (typeof script === 'string') {
                scriptTag.setAttribute('src', script)
            } else {
                scriptTag.setAttribute('src', script.src)
                Object.entries(script.attrs || {}).forEach(([key, value]) => {
                    scriptTag.setAttribute(key, value)
                })
            }

            document.body.append(scriptTag)
        }
        for (const outputFile of assets) {
            const filepath = outputFile.path

            let targetPath: string
            if (publicPath) {
                targetPath = joinWithPublicPath(publicPath, path.relative(outDir, filepath))
            } else {
                const htmlFileDirectory = posixJoin(outDir, htmlFileConfiguration.filename)
                targetPath = path.relative(path.dirname(htmlFileDirectory), filepath)
            }
            if (htmlFileConfiguration.hash) {
                const hashableContents = htmlFileConfiguration.hash === true ? `${Date.now()}` : htmlFileConfiguration.hash
                targetPath = `${targetPath}?${crypto.createHash('md5').update(hashableContents).digest('hex')}`
            }
            const ext = path.parse(filepath).ext

            // Inline the JavaScript and CSS files if the option is set.
            const { inline } = htmlFileConfiguration

            const isInline = () => {
                if (!inline) {
                    return false
                }
                const extension = ext.replace('.', '') as 'css' | 'js'
                return (
                    (typeof inline === 'boolean' && inline === true) ||
                    (typeof inline === 'object' && inline[extension] === true) ||
                    (typeof inline === 'function' && inline(filepath))
                )
            }

            if (ext === '.js') {
                const scriptTag = document.createElement('script')

                // Check if the JavaScript should be inlined.
                if (isInline()) {
                    if (logInfo) { console.log('Inlining script', filepath) }
                    // Read the content of the JavaScript file, then append to the script tag
                    const scriptContent = await fs.readFile(
                        filepath,
                        'utf-8'
                    )
                    scriptTag.textContent = scriptContent
                } else {
                    // If not inlined, set the 'src' attribute as usual.
                    scriptTag.setAttribute('src', targetPath)
                }

                if (htmlFileConfiguration.scriptLoading === 'module') {
                    // If module, add type="module"
                    scriptTag.setAttribute('type', 'module')
                } else if (
                    !isInline() && (!htmlFileConfiguration.scriptLoading || htmlFileConfiguration.scriptLoading === 'defer')
                ) {
                    // if scriptLoading is unset or defer, use defer
                    scriptTag.setAttribute('defer', '')
                }

                document.body.append(scriptTag)
            } else if (ext === '.css') {
                // Check if the CSS should be inlined -> if so, use style tags instead of link tags.
                if (isInline()) {
                    const styleTag = document.createElement('style')
                    const styleContent = await fs.readFile(
                        filepath,
                        'utf-8'
                    )
                    styleTag.textContent = styleContent
                    document.head.append(styleTag)

                    // no need to set any attributes
                    continue
                }

                const linkTag = document.createElement('link')
                //@ts-expect-error Temp prop
                linkTag._int = true
                linkTag.setAttribute('rel', 'stylesheet')
                linkTag.setAttribute('href', targetPath)
                document.head.appendChild(linkTag)
            } else {
                if (logInfo) { console.log(`Warning: found file ${targetPath}, but it was neither .js nor .css`) }
            }
        }
        if(htmlFileConfiguration.appendHead) appendHtmlStr(document.head, htmlFileConfiguration.appendHead)
        if(htmlFileConfiguration.prependBody) appendHtmlStr(document.body, htmlFileConfiguration.prependBody, true)

        const htmlAtRoot = posixJoin(htmlFileConfiguration.filename).indexOf(path.sep) === -1

        //Find & replace all source links
        for(const el of document.querySelectorAll('img,object,link')) {
            //@ts-expect-error Skip internal
            if(el._int) continue

            let srcProp = 'src'
            switch(el.tagName) {
            case 'OBJECT': srcProp = 'data'; break
            case 'LINK': srcProp = 'href'
            }
            let src = el.getAttribute(srcProp)
            if(!src || src.indexOf('://') !== -1) continue //Absolute URI
            if(src.startsWith('/')) src = src.slice(1) //Relative to working dir
            else src = path.join(htmlFileConfiguration.htmlFile ? //Relative to file dir
                path.dirname(htmlFileConfiguration.htmlFile) : '', src)

            let name = path.basename(src)
            const dest = posixJoin(path.dirname(path.join(outDir, htmlFileConfiguration.filename)), name)
            if(!htmlAtRoot) name = publicPath ? joinWithPublicPath(publicPath, name) : '/' + name
            src = path.resolve(src)
            el.setAttribute(srcProp, name)
            foundAssets[src] = {dest, htmlFile: htmlFileConfiguration.filename}
        }
    }

    return {
        name: 'esbuild-html-plugin',
        setup(build) {
            if (build.initialOptions.metafile === false) {
                throw new Error('metafile is explicitly disabled. esbuild-html-plugin needs this to be enabled.')
            }
            // we need the metafile. If it's not set, we can set it to `true`
            build.initialOptions.metafile = true
            if (!build.initialOptions.outdir) {
                throw new Error('outdir must be set')
            }

            //Add HTML files to watch list
            let watched = false
            build.onLoad({filter: /./}, () => {
                if(!watched) {
                    watched = true
                    const watchFiles = []
                    for(const f of configuration.files) if(f.htmlFile)
                        watchFiles.push(path.resolve(f.htmlFile))
                    return {watchFiles}
                }
            })

            build.onEnd(async result => {
                const startTime = Date.now()
                watched = false

                if (build.initialOptions.logLevel == 'debug' || build.initialOptions.logLevel == 'info') {
                    logInfo = true
                }
                if (logInfo) { console.log() }

                // Note: we can safely disable this rule here, as we already asserted this in setup.onStart
                const outdir = build.initialOptions.outdir!
                const publicPath = build.initialOptions.publicPath
                const foundAssets: AssetList = {}

                for (const htmlFileConfiguration of configuration.files) {
                    // First, search for outputs with the configured entryPoints
                    const collectedEntrypoints = collectEntrypoints(build, htmlFileConfiguration, result.metafile)

                    // All output files relevant for this html file
                    let collectedOutputFiles: (esbuild.Metafile['outputs'][string] & { path: string })[] = []

                    for (const entrypoint of collectedEntrypoints) {
                        if (!entrypoint) {
                            throw new Error(`Found no match for ${htmlFileConfiguration.entryPoints}`)
                        }
                        const relatedOutputFiles = new Map()
                        relatedOutputFiles.set(entrypoint.path, entrypoint)
                        if (htmlFileConfiguration.findRelatedCssFiles !== false && entrypoint.cssBundle) {
                            relatedOutputFiles.set(entrypoint.cssBundle, { path: entrypoint.cssBundle })
                        }
                        if (htmlFileConfiguration.findRelatedOutputFiles) {
                            findNameRelatedOutputFiles(entrypoint, result.metafile, build.initialOptions.entryNames).forEach((item) => {
                                relatedOutputFiles.set(item.path, item)
                            })
                        }

                        collectedOutputFiles = [...collectedOutputFiles, ...relatedOutputFiles.values()]
                    }

                    const templatingResult = await renderTemplate(htmlFileConfiguration)

                    // Next, we insert the found files into the htmlTemplate - if no htmlTemplate was specified, we default to a basic one.
                    const dom = new JSDOM(templatingResult)
                    const document = dom.window.document

                    if (htmlFileConfiguration.title) {
                        // If a title was given, we pass the title as well
                        document.title = htmlFileConfiguration.title
                    }

                    if (htmlFileConfiguration.favicon) {
                        // Injects a favicon if present
                        const fileExt = path.extname(htmlFileConfiguration.favicon)
                        const faviconName = 'favicon' + fileExt
                        try {
                            await fs.copyFile(htmlFileConfiguration.favicon, `${outdir}/${faviconName}`)
                        } catch(e) {
                            if ((e as {code: string}).code === 'ENOENT')
                                throw new Error('favicon specified but does not exist')
                            throw e
                        }

                        const linkTag = document.createElement('link')
                        //@ts-expect-error Temp prop
                        linkTag._int = true
                        linkTag.setAttribute('rel', 'icon')

                        let faviconPublicPath = `/${faviconName}`
                        if (publicPath) {
                            faviconPublicPath = joinWithPublicPath(publicPath, faviconPublicPath)
                        }
                        linkTag.setAttribute('href', faviconPublicPath)
                        document.head.appendChild(linkTag)
                    }

                    await injectFiles(dom, collectedOutputFiles, outdir, publicPath, htmlFileConfiguration, foundAssets)

                    const out = posixJoin(outdir, htmlFileConfiguration.filename)
                    await fs.mkdir(path.dirname(out), {
                        recursive: true,
                    })
                    await fs.writeFile(out, dom.serialize())
                    const stat = await fs.stat(out)
                    if (logInfo) { console.log(`  ${out} - ${stat.size}`) }
                }

                //Write assets
                for(const src in foundAssets) {
                    const asset = foundAssets[src]
                    try {
                        await fs.copyFile(src, asset.dest)
                    } catch(e) {
                        throw new Error(`Could not include asset ${src} required by ${asset.htmlFile}`, {cause: e})
                    }
                }

                if (logInfo) console.log(`  HTML Plugin Done in ${Date.now() - startTime}ms`)
            })
        }
    }
}
