import { Compiler } from 'webpack';
import {
  WebpackManifestPlugin,
  getCompilerHooks,
} from 'webpack-manifest-plugin';
import { v4 } from 'uuid';
import { indentText, readFile } from './utils';
import { resolve, join } from 'path';
import {
  createPluginHeader,
  PluginHeaderFields,
  createAssetManifest,
  createAddAction,
  createShortcodeDefinitions,
  createShortcodeRegistration,
} from './template';
import yazl from 'yazl';

export interface PluginOptions {
  // What to name the plugin.
  wordpressPluginName: string;
  // Prefix of the generated shortcodes. Defaults to `wordpressPluginName`.
  shortcodePrefix?: string;
  // Template of the plugin file that will be generated. Defaults to `default-template.php`.
  pluginTemplate?: string;
  // Header fields for the Wordpress plugin.
  // See https://developer.wordpress.org/plugins/plugin-basics/header-requirements/#header-fields
  headerFields?: PluginHeaderFields;
  // Map of entry point to root element ID.
  // Each root element defaults to id "root", unless an
  // alternate mapping is provided here.
  entryToRootId?: {
    [entry: string]: string;
  };
}

export interface Manifest {
  id: string;
  entries: {
    [key: string]: Entry;
  };
}

type Entry = string[];

export class WordpressShortcodeWebpackPlugin {
  constructor(public options: PluginOptions) {
    if (!options.wordpressPluginName) {
      throw new Error('wordpressPluginName is required');
    }

    const defaults = {
      shortcodePrefix: options.wordpressPluginName,
      pluginTemplate: resolve('./src/default-template.php'),
      headerFields: {},
      entryToRootId: {},
    };

    this.options = Object.assign({}, defaults, options);
  }

  apply(compiler: Compiler) {
    const pluginName = WordpressShortcodeWebpackPlugin.name;
    const { webpack } = compiler;
    const { RawSource } = webpack.sources;
    const wpPluginName = this.options.wordpressPluginName;

    const dummyManifestFilename = v4();

    // We're going to create a new instance of WebpackManifestPlugin that allows us to create
    // a manifest to our spec
    new WebpackManifestPlugin({
      // We don't actually care about the file that gets written, we're going to make a unique name so we can delete it
      fileName: dummyManifestFilename,
      basePath: `${wpPluginName}/assets`,
      generate: (_, __, entries) => {
        const entrypointFiles: {
          [key: string]: Entry;
        } = {};
        Object.keys(entries).forEach((entrypoint) => {
          entrypointFiles[entrypoint] = entries[
            entrypoint
          ].filter(
            (fileName) => !fileName.endsWith('.map')
          );
        });

        return {
          entries: entrypointFiles,
          // Bit of a hack so we can clean this file up by ID later
          id: dummyManifestFilename,
        };
      },
    }).apply(compiler);

    const outputFileName = `${wpPluginName}/${wpPluginName}.php`;

    // Clean up our manifest after we're done with it
    compiler.hooks.thisCompilation.tap(
      pluginName,
      (compilation) => {
        const { beforeEmit, afterEmit } = getCompilerHooks(
          compiler
        );

        // This is kinda a bummer. WebpackManifestPlugin only exposes sync hooks
        // but we want to do some async work to build our zip archive. This means
        // we either need to dupe WebpackManifestPlugin to generate our own manifest
        // or hack around the hooks it provides in order to create our archive.

        // -AND- because WebpackManifestPlugin registers for stage Infinity, we can't
        // register to a later processAssets stage to do something after it finishes.
        beforeEmit.tap(pluginName, (manifest: Manifest) => {
          // Read in our template file
          const pluginFileContent = readFile(
            compiler.inputFileSystem,
            this.options.pluginTemplate!
          );

          const utilsPath = resolve(
            './src/load-assets.php'
          );

          const loadAssetsUtils = readFile(
            compiler.inputFileSystem,
            utilsPath
          );

          const templatedFile = pluginFileContent
            .replace(
              '{{plugin_header}}',
              createPluginHeader({
                ...this.options.headerFields,
                pluginName: wpPluginName,
              })
            )
            .replace(
              '{{asset_manifest}}',
              createAssetManifest(manifest)
            )
            .replace(
              '{{shortcode_definitions}}',
              createShortcodeDefinitions(
                manifest,
                this.options.entryToRootId
              )
            )
            .replace(
              '{{shortcode_registration}}',
              createShortcodeRegistration(
                this.options.shortcodePrefix!,
                wpPluginName,
                manifest
              )
            )
            .replace(
              '{{loading_script_utils}}',
              indentText(loadAssetsUtils, 1)
            )
            .replace(
              '{{add_action}}',
              createAddAction(wpPluginName)
            );

          compilation.emitAsset(
            outputFileName,
            new RawSource(templatedFile)
          );

          // We're also gonna fork all entry content into our plugin folder
          // We don't know what other apps are being deployed out of this build
          // folder so we opt to copy them.
          for (const chunk of compilation.chunks) {
            for (const file of chunk.files) {
              const dupedFileName = join(
                wpPluginName,
                'assets',
                file
              );

              compilation.emitAsset(
                dupedFileName,
                new RawSource(
                  compilation.assets[file].source()
                )
              );
            }
          }

          // OK we've got an asset directory that looks how we want it. Lets
          // zip it up for easy install.
        });

        afterEmit.tap(pluginName, (manifest: Manifest) => {
          compilation.deleteAsset(manifest.id!);
        });

        compilation.hooks.processAssets.tapPromise(
          {
            stage:
              webpack.Compilation
                .PROCESS_ASSETS_STAGE_REPORT,
            name: pluginName,
            additionalAssets: true,
          },
          async (assets) => {
            // This is a hack to work around  WebpackManifestPlugin's late
            // processAssets binding. Because we add all our assets in the same
            // hook, we get a list of them here.
            if (!assets[outputFileName]) return;

            const archive = new yazl.ZipFile();

            for (const [assetPath, asset] of Object.entries(
              assets
            )) {
              // Make sure no other assets got caught up in this run
              if (!assetPath.startsWith(wpPluginName))
                continue;

              // OK we're dealing with something we want to zip
              archive.addBuffer(
                asset.buffer(),
                // TODO: Clean this up
                assetPath.replace(`${wpPluginName}/`, '')
              );
            }

            archive.end();

            return new Promise((resolve, reject) => {
              const bufs: Buffer[] = [];
              archive.outputStream.on('data', (buf) =>
                bufs.push(buf)
              );

              archive.outputStream.on('error', (error) =>
                reject(error)
              );

              archive.outputStream.on('end', () => {
                const outFile = Buffer.concat(bufs);

                // TODO: Get from config
                const outFileName =
                  this.options.wordpressPluginName + '.zip';

                compilation.emitAsset(
                  outFileName,
                  new RawSource(outFile)
                );

                resolve();
              });
            });
          }
        );
      }
    );
  }
}
