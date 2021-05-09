import {
  compilation,
  Compiler as Webpack4Compiler,
} from 'webpack4';
import {
  Compiler as Webpack5Compiler,
  Compilation,
} from 'webpack5';

import {
  WebpackManifestPlugin,
  getCompilerHooks,
} from 'webpack-manifest-plugin';
import { v4 } from 'uuid';

import { resolve, join } from 'path';
import {
  PluginHeaderFields,
  generatePluginFile,
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
      pluginTemplate: resolve(
        __dirname,
        'default-template.php'
      ),
      headerFields: {},
      entryToRootId: {},
    };

    this.options = Object.assign({}, defaults, options);
  }

  apply(compiler: Webpack4Compiler | Webpack5Compiler) {
    const pluginName = WordpressShortcodeWebpackPlugin.name;
    const wpPluginName = this.options.wordpressPluginName;
    const dummyManifestFilename = v4();

    // Naming convention required by Wordpress
    const outputFileName = join(
      wpPluginName,
      `${wpPluginName}.php`
    );

    // Create a custom manifest using WebpackManifestPlugin.
    createManifestPlugin(
      dummyManifestFilename,
      wpPluginName,
      compiler as Webpack5Compiler
    );

    let isWp5 = 'webpack' in compiler;

    if (!isWp5) {
      const webpack4Compiler = compiler as Webpack4Compiler;
      webpack4Compiler.hooks.emit.tap(
        pluginName,
        (compilation) =>
          webpack4CompilationHook(
            compilation,
            webpack4Compiler,
            pluginName,
            wpPluginName,
            outputFileName,
            this.options
          )
      );
    } else {
      const webpack5Compiler = compiler as Webpack5Compiler;
      webpack5Compiler.hooks.thisCompilation.tap(
        pluginName,
        (compilation) =>
          webpack5CompilationHook(
            compilation,
            webpack5Compiler,
            pluginName,
            wpPluginName,
            outputFileName,
            this.options
          )
      );
    }
  }
}

// Compilation hook for Webpack 5. There are subtle differences between the
// interface that Webpack exposes for plugins between 4 and 5. The hook
// names are different, the way you add and remove assets is different, and
// the types of the compiler and compilation are different. To paper over the
// difference, we maintain slightly different versions of the hook for WP4 and 5.
function webpack5CompilationHook(
  compilation: Compilation,
  compiler: Webpack5Compiler,
  pluginName: string,
  wpPluginName: string,
  outputFileName: string,
  options: PluginOptions
) {
  const { beforeEmit, afterEmit } = getCompilerHooks(
    // @ts-ignore
    compiler
  );

  const RawSource = compiler.webpack.sources.RawSource;

  beforeEmit.tap(pluginName, (manifest: Manifest) => {
    // This is the "main" file of the Wordpress plugin. We do all of the
    // work of applying our header, manifest, and loaders to the specified
    // template here.
    const pluginFile = generatePluginFile(
      wpPluginName,
      manifest,
      options,
      // @ts-ignore
      compiler
    );

    compilation.emitAsset(
      outputFileName,
      new RawSource(pluginFile)
    );

    const manifestFiles = Object.values(
      manifest.entries
    ).reduce((all, val) => [...all, ...val]);

    // We're also gonna fork all entry content into our plugin folder
    // We don't know what other apps are being deployed out of this build
    // folder so we opt to copy them.
    for (const chunk of compilation.chunks) {
      for (const file of chunk.files) {
        // Make sure we don't add anything that's not in our manifest.
        if (!manifestFiles.includes(file)) continue;

        const dupedFileName = join(
          wpPluginName,
          'assets',
          file
        );

        compilation.emitAsset(
          dupedFileName,
          new RawSource(compilation.assets[file].source())
        );
      }
    }
  });

  // We do this because we don't have a way to asynchronously process the output
  // generated during the `beforeEmit` hook provided by WebpackManifestPlugin.
  // So, we use the `additionalAssets` flag, which runs a second time
  // whenever any `processAssets` hook adds more files to the compilation.
  // This is a bit of a hack, and will be fixed by https://github.com/shellscape/webpack-manifest-plugin/pulls
  // See https://github.com/shellscape/webpack-manifest-plugin/issues/262 for more context.
  // We need to do asynchronous work because we want to create an archive
  // of the Wordpress plugin and all the good Zip libraries are either
  // promise or stream-based.

  // We use the raw number here so we don't take a direct dependency
  // on Webpack in our output. Good for bundle size, good for us.
  // From Compilation.PROCESS_ASSETS_STAGE_REPORT
  const PROCESS_ASSETS_STAGE_REPORT = 5000;
  compilation.hooks.processAssets.tapPromise(
    {
      stage: PROCESS_ASSETS_STAGE_REPORT,
      name: pluginName,
      additionalAssets: true,
    },
    async (assets) => {
      // We use this to test that this particular invocation of `processAssets` is
      // the one triggered by out `beforeEmit` hook.
      if (!assets[outputFileName]) return;

      const zipFile = await createZipFile(
        assets,
        wpPluginName
      );

      const zipFileName = `${wpPluginName}.zip`;
      compilation.emitAsset(
        zipFileName,
        new RawSource(zipFile)
      );
    }
  );

  // Clean up our manifest after we're done with it
  afterEmit.tap(pluginName, (manifest: Manifest) => {
    compilation.deleteAsset(manifest.id!);
  });
}

// Compilation hook for Webpack 4. Deprecated.
function webpack4CompilationHook(
  compilation: compilation.Compilation,
  compiler: Webpack4Compiler,
  pluginName: string,
  wpPluginName: string,
  outputFileName: string,
  options: PluginOptions
) {
  const { beforeEmit, afterEmit } = getCompilerHooks(
    // @ts-ignore
    compiler
  );

  beforeEmit.tap(pluginName, (manifest: Manifest) => {
    // This is the "main" file of the Wordpress plugin. We do all of the
    // work of applying our header, manifest, and loaders to the specified
    // template here.
    const pluginFile = generatePluginFile(
      wpPluginName,
      manifest,
      options,
      // @ts-ignore
      compiler
    );

    compilation.assets[outputFileName] = {
      source: () => pluginFile,
      size: () => pluginFile.length,
    };

    const manifestFiles = Object.values(
      manifest.entries
    ).reduce((all, val) => [...all, ...val]);

    // We're also gonna fork all entry content into our plugin folder
    // We don't know what other apps are being deployed out of this build
    // folder so we opt to copy them.
    for (const chunk of compilation.chunks) {
      for (const file of chunk.files) {
        // Make sure we don't add anything that's not in our manifest.
        if (!manifestFiles.includes(file)) continue;

        const dupedFileName = join(
          wpPluginName,
          'assets',
          file
        );

        compilation.assets[dupedFileName] =
          compilation.assets[file];
      }
    }
  });

  // We do this because we don't have a way to asynchronously process the output
  // generated during the `beforeEmit` hook provided by WebpackManifestPlugin.
  // So, we use the `additionalAssets` flag, which runs a second time
  // whenever any `processAssets` hook adds more files to the compilation.
  // This is a bit of a hack, and will be fixed by https://github.com/shellscape/webpack-manifest-plugin/pulls
  // See https://github.com/shellscape/webpack-manifest-plugin/issues/262 for more context.
  // We need to do asynchronous work because we want to create an archive
  // of the Wordpress plugin and all the good Zip libraries are either
  // promise or stream-based.
  compiler.hooks.emit.tapPromise(
    {
      name: pluginName,
    },
    async (compilation) => {
      // We use this to test that this particular invocation of `processAssets` is
      // the one triggered by out `beforeEmit` hook.
      if (!compilation.assets[outputFileName]) return;

      const zipFile = await createZipFile(
        compilation.assets,
        wpPluginName
      );

      const zipFileName = `${wpPluginName}.zip`;
      compilation.assets[zipFileName] = {
        source: () => zipFile,
        size: () => zipFile.length,
      };
    }
  );

  // Clean up our manifest after we're done with it
  afterEmit.tap(pluginName, (manifest: Manifest) => {
    delete compilation.assets[manifest.id];
  });
}

// We're going to create a new instance of WebpackManifestPlugin that allows us to create
// a manifest to our specifications. This is a simple way for us to figure out
// the "real" list of files that are generated in our build.
function createManifestPlugin(
  manifestName: string,
  wpPluginName: string,
  compiler: Webpack5Compiler
) {
  new WebpackManifestPlugin({
    // We don't actually care about the file that gets written, we're going to make a unique name so we can delete it
    fileName: manifestName,
    basePath: `${wpPluginName}/assets`,
    generate: (_, __, entries) => {
      const entrypointFiles: {
        [key: string]: Entry;
      } = {};
      Object.keys(entries).forEach((entrypoint) => {
        entrypointFiles[entrypoint] = entries[
          entrypoint
        ].filter((fileName) => !fileName.endsWith('.map'));
      });

      return {
        entries: entrypointFiles,
        // Bit of a hack so we can clean this file up by ID later
        id: manifestName,
      };
    },
    // @ts-ignore
  }).apply(compiler);
}

async function createZipFile<T>(
  // Type CompilationAssets, but Webpack doesn't export the type :(
  assets: T,
  wpPluginName: string
): Promise<Buffer> {
  const archive = new yazl.ZipFile();

  for (const [assetPath, asset] of Object.entries(assets)) {
    // Make sure no other assets got caught up in this run
    if (!assetPath.startsWith(wpPluginName)) continue;

    // .buffer is WP5, .source is WP4
    const assetBuffer =
      'buffer' in asset
        ? asset.buffer()
        : Buffer.from(asset.source());

    // OK we're dealing with something we want to zip
    archive.addBuffer(
      assetBuffer,
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

      resolve(outFile);
    });
  });
}
