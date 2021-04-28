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

interface PluginOptions {
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
  entryToRoot?: {
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
  constructor(public options: PluginOptions) {}

  apply(compiler: Compiler) {
    const pluginName = WordpressShortcodeWebpackPlugin.name;
    const { webpack } = compiler;
    // // const { Compilation } = webpack;
    const { RawSource } = webpack.sources;

    const dummyManifestFilename = v4();

    // We're going to create a new instance of WebpackManifestPlugin that allows us to create
    // a manifest to our spec
    new WebpackManifestPlugin({
      // We don't actually care about the file that gets written, we're going to make a unique name so we can delete it
      fileName: dummyManifestFilename,
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

    // Clean up our manifest after we're done with it
    compiler.hooks.thisCompilation.tap(
      pluginName,
      (compilation) => {
        const { beforeEmit, afterEmit } = getCompilerHooks(
          compiler
        );

        beforeEmit.tap(pluginName, (manifest: Manifest) => {
          const inputPath = resolve(
            './src/default-template.php'
          );

          // Read in our template file
          const pluginFileContent = readFile(
            compiler.inputFileSystem,
            inputPath
          );

          const utilsPath = resolve(
            './src/partials/load-assets.partial.php'
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
                pluginName: this.options
                  .wordpressPluginName,
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
                this.options.entryToRoot
              )
            )
            .replace(
              '{{shortcode_registration}}',
              createShortcodeRegistration(
                this.options.shortcodePrefix ||
                  this.options.wordpressPluginName,
                this.options.wordpressPluginName,
                manifest
              )
            )
            .replace(
              '{{loading_script_utils}}',
              indentText(loadAssetsUtils, 1)
            )
            .replace(
              '{{add_action}}',
              createAddAction(
                this.options.wordpressPluginName
              )
            );

          // TODO: Read in from options
          const outputPath = this.options
            .wordpressPluginName;

          const outputFileName = join(
            outputPath,
            `${this.options.wordpressPluginName}.php`
          );

          compilation.emitAsset(
            outputFileName,
            new RawSource(templatedFile)
          );
        });

        afterEmit.tap(pluginName, (manifest: Manifest) => {
          compilation.deleteAsset(manifest.id!);
        });
      }
    );
  }
}
